import { supabase } from "@/integrations/supabase/client";

export interface CostCalculationResult {
  energyCost: number;
  fixedCharges: number;
  totalCost: number;
  avgCostPerKwh: number;
  tariffName: string;
  hasError: boolean;
  errorMessage?: string;
}

export interface MeterReading {
  kwh_value: number;
  reading_timestamp: string;
}

/**
 * Calculate electricity cost for a meter based on its assigned tariff
 * @param meterId - Meter ID
 * @param tariffId - Tariff structure ID
 * @param dateFrom - Start date for calculation
 * @param dateTo - End date for calculation
 * @param totalKwh - Optional pre-calculated total kWh (for efficiency)
 * @returns Cost calculation result
 */
export async function calculateMeterCost(
  meterId: string,
  tariffId: string,
  dateFrom: Date,
  dateTo: Date,
  totalKwh?: number
): Promise<CostCalculationResult> {
  try {
    // Fetch tariff structure details
    const { data: tariff, error: tariffError } = await supabase
      .from("tariff_structures")
      .select("*, tariff_blocks(*), tariff_charges(*), tariff_time_periods(*)")
      .eq("id", tariffId)
      .single();

    if (tariffError || !tariff) {
      return {
        energyCost: 0,
        fixedCharges: 0,
        totalCost: 0,
        avgCostPerKwh: 0,
        tariffName: "Unknown",
        hasError: true,
        errorMessage: "Tariff structure not found",
      };
    }

    // Fetch meter readings if not provided
    let readings: MeterReading[] = [];
    let calculatedTotalKwh = totalKwh || 0;

    // Determine if we need individual readings with timestamps
    const hasBothSeasonsCharge = tariff.tariff_charges?.some((c: any) => 
      c.charge_type === "energy_both_seasons"
    );
    
    const hasSeasonalCharges = tariff.tariff_charges?.some((c: any) => 
      c.charge_type === "energy_low_season" || c.charge_type === "energy_high_season"
    );
    
    const needsIndividualReadings = 
      (tariff.uses_tou && tariff.tariff_time_periods?.length > 0);

    if (needsIndividualReadings) {
      // For TOU tariffs and seasonal tariffs, we need individual readings with timestamps
      const { data: readingsData, error: readingsError } = await supabase
        .from("meter_readings")
        .select("kwh_value, reading_timestamp")
        .eq("meter_id", meterId)
        .gte("reading_timestamp", dateFrom.toISOString())
        .lte("reading_timestamp", dateTo.toISOString());

      if (readingsError) {
        return {
          energyCost: 0,
          fixedCharges: 0,
          totalCost: 0,
          avgCostPerKwh: 0,
          tariffName: tariff.name,
          hasError: true,
          errorMessage: "Failed to fetch readings",
        };
      }

      readings = readingsData || [];
      calculatedTotalKwh = readings.reduce((sum, r) => sum + Number(r.kwh_value), 0);
    } else if (!totalKwh) {
      // For block tariffs, calculate total if not provided
      const { data: readingsData } = await supabase
        .from("meter_readings")
        .select("kwh_value")
        .eq("meter_id", meterId)
        .gte("reading_timestamp", dateFrom.toISOString())
        .lte("reading_timestamp", dateTo.toISOString());

      calculatedTotalKwh = (readingsData || []).reduce((sum, r) => sum + Number(r.kwh_value), 0);
    }

    let energyCost = 0;

    // Check if this is a TOU tariff
    if (tariff.uses_tou && tariff.tariff_time_periods?.length > 0) {
      // TOU calculation based on time periods
      for (const reading of readings) {
        const timestamp = new Date(reading.reading_timestamp);
        const hour = timestamp.getHours();
        const dayOfWeek = timestamp.getDay();
        const month = timestamp.getMonth() + 1;

        // Determine season (June-Aug = high demand, Sep-May = low demand)
        const season = month >= 6 && month <= 8 ? "high_demand" : "low_demand";

        // Determine day type
        let dayType = "weekday";
        if (dayOfWeek === 0) dayType = "sunday";
        else if (dayOfWeek === 6) dayType = "saturday";

        // Find matching TOU period
        const period = tariff.tariff_time_periods.find((p: any) => {
          const seasonMatch = p.season === "all_year" || p.season === season;
          const dayMatch =
            p.day_type === "all_days" ||
            p.day_type === dayType ||
            (p.day_type === "weekend" && (dayOfWeek === 0 || dayOfWeek === 6));
          const hourMatch = hour >= p.start_hour && hour < p.end_hour;

          return seasonMatch && dayMatch && hourMatch;
        });

        if (period) {
          energyCost += (Number(reading.kwh_value) * period.energy_charge_cents) / 100;
        }
      }
    } else {
      // Standard block-based calculation
      let remainingKwh = calculatedTotalKwh;

      if (tariff.tariff_blocks && tariff.tariff_blocks.length > 0) {
        const sortedBlocks = [...tariff.tariff_blocks].sort(
          (a: any, b: any) => a.block_number - b.block_number
        );

        for (const block of sortedBlocks) {
          const blockSize = block.kwh_to ? block.kwh_to - block.kwh_from : Infinity;
          const kwhInBlock = Math.min(remainingKwh, blockSize);

          if (kwhInBlock > 0) {
            energyCost += (kwhInBlock * block.energy_charge_cents) / 100;
            remainingKwh -= kwhInBlock;
          }

          if (remainingKwh <= 0) break;
        }
      } else if (tariff.tariff_charges && tariff.tariff_charges.length > 0) {
        // Check for both seasons charge first (single rate for all consumption)
        const bothSeasonsCharge = tariff.tariff_charges.find(
          (c: any) => c.charge_type === "energy_both_seasons"
        );

        if (bothSeasonsCharge) {
          // Apply single rate to all consumption
          energyCost = (calculatedTotalKwh * Number(bothSeasonsCharge.charge_amount)) / 100;
        } else {
          // Seasonal flat-rate: apply rate to TOTAL consumption
          const seasonalCharges = {
            low_season: tariff.tariff_charges.find(
              (c: any) => c.charge_type === "energy_low_season"
            ),
            high_season: tariff.tariff_charges.find(
              (c: any) => c.charge_type === "energy_high_season"
            ),
          };

          if (seasonalCharges.low_season || seasonalCharges.high_season) {
            // Determine predominant season based on date range
            const startMonth = dateFrom.getMonth() + 1;
            const endMonth = dateTo.getMonth() + 1;
            
            // If entire range is in high season (Jun-Aug), use high rate
            const entirelyHighSeason = startMonth >= 6 && startMonth <= 8 && endMonth >= 6 && endMonth <= 8;
            
            const applicableCharge = entirelyHighSeason && seasonalCharges.high_season
              ? seasonalCharges.high_season
              : (seasonalCharges.low_season || seasonalCharges.high_season);
            
            if (applicableCharge) {
              energyCost = (calculatedTotalKwh * Number(applicableCharge.charge_amount)) / 100;
            }
          } else {
            // No valid pricing structure found
            return {
              energyCost: 0,
              fixedCharges: 0,
              totalCost: 0,
              avgCostPerKwh: 0,
              tariffName: tariff.name,
              hasError: true,
              errorMessage: "Tariff has no pricing structure defined (no blocks, TOU periods, or seasonal charges)",
            };
          }
        }
      } else {
        // No valid pricing structure found
        return {
          energyCost: 0,
          fixedCharges: 0,
          totalCost: 0,
          avgCostPerKwh: 0,
          tariffName: tariff.name,
          hasError: true,
          errorMessage: "Tariff has no pricing structure defined (no blocks, TOU periods, or seasonal charges)",
        };
      }
    }

    // Add fixed charges
    let fixedCharges = 0;
    if (tariff.tariff_charges) {
      fixedCharges = tariff.tariff_charges.reduce((sum: number, charge: any) => {
        if (charge.charge_type === "basic_monthly") {
          return sum + Number(charge.charge_amount);
        }
        return sum;
      }, 0);
    }

    const totalCost = energyCost + fixedCharges;
    const avgCostPerKwh = calculatedTotalKwh > 0 ? totalCost / calculatedTotalKwh : 0;

    return {
      energyCost,
      fixedCharges,
      totalCost,
      avgCostPerKwh,
      tariffName: tariff.name,
      hasError: false,
    };
  } catch (error: any) {
    return {
      energyCost: 0,
      fixedCharges: 0,
      totalCost: 0,
      avgCostPerKwh: 0,
      tariffName: "Error",
      hasError: true,
      errorMessage: error.message || "Unknown error",
    };
  }
}
