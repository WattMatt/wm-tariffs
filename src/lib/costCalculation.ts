import { supabase } from "@/integrations/supabase/client";

export interface CostCalculationResult {
  energyCost: number;
  fixedCharges: number;
  demandCharges: number;
  totalCost: number;
  avgCostPerKwh: number;
  tariffName: string;
  hasError: boolean;
  errorMessage?: string;
  tariffPeriodsUsed?: Array<{
    tariffId: string;
    tariffName: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    dateFrom: string;
    dateTo: string;
    kwh: number;
    cost: number;
  }>;
}

export interface MeterReading {
  kwh_value: number;
  reading_timestamp: string;
}

/**
 * Calculate prorated basic charges based on calendar month days.
 * Tariffs are applied on calendar month basis (1st to last day),
 * but billing cycles run 21st to 20th, so we prorate by actual days.
 * 
 * @param dateFrom - Start of billing period
 * @param dateTo - End of billing period  
 * @param monthlyCharge - The monthly basic charge amount from the tariff
 * @returns Total prorated basic charges
 */
function calculateProratedBasicCharges(
  dateFrom: Date,
  dateTo: Date,
  monthlyCharge: number
): number {
  let totalCharges = 0;
  let current = new Date(dateFrom);
  
  while (current <= dateTo) {
    const year = current.getFullYear();
    const month = current.getMonth();
    
    // Get the total days in this calendar month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Calculate the start and end of our period within this month
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month, daysInMonth);
    
    // Find overlap between our period and this calendar month
    const periodStartInMonth = new Date(Math.max(current.getTime(), monthStart.getTime()));
    const periodEndInMonth = new Date(Math.min(dateTo.getTime(), monthEnd.getTime()));
    
    // Calculate days in this month that fall within our period
    const daysInPeriod = Math.floor(
      (periodEndInMonth.getTime() - periodStartInMonth.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;
    
    // Prorate the basic charge for this month
    const proratedCharge = (monthlyCharge * daysInPeriod) / daysInMonth;
    totalCharges += proratedCharge;
    
    // Move to the first day of the next month
    current = new Date(year, month + 1, 1);
  }
  
  return totalCharges;
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
  totalKwh?: number,
  maxKva?: number
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
        demandCharges: 0,
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
          demandCharges: 0,
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
              demandCharges: 0,
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
          demandCharges: 0,
          totalCost: 0,
          avgCostPerKwh: 0,
          tariffName: tariff.name,
          hasError: true,
          errorMessage: "Tariff has no pricing structure defined (no blocks, TOU periods, or seasonal charges)",
        };
      }
    }

    // Add fixed charges (prorated by calendar month days)
    let fixedCharges = 0;
    if (tariff.tariff_charges) {
      console.log('🔍 [Cost Calculation Debug] Tariff Charges:', tariff.tariff_charges);
      console.log('🔍 [Cost Calculation Debug] Date Range:', { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() });
      
      const monthlyCharge = tariff.tariff_charges.reduce((sum: number, charge: any) => {
        if (charge.charge_type === "basic_monthly" || charge.charge_type === "basic_charge") {
          console.log('🔍 [Cost Calculation Debug] Found basic charge:', charge);
          return sum + Number(charge.charge_amount);
        }
        return sum;
      }, 0);
      
      console.log('🔍 [Cost Calculation Debug] Monthly Charge Total:', monthlyCharge);
      fixedCharges = calculateProratedBasicCharges(dateFrom, dateTo, monthlyCharge);
      console.log('🔍 [Cost Calculation Debug] Prorated Fixed Charges:', fixedCharges);
    }

    // Add demand charges (kVA-based)
    let demandCharges = 0;
    if (tariff.tariff_charges) {
      // Use provided maxKva, or fallback to database query
      let maxKvaValue = maxKva || 0;
      
      if (!maxKvaValue) {
        // Fallback: Try to fetch from meter_readings.kva_value column
        const { data: kvaData } = await supabase
          .from("meter_readings")
          .select("kva_value")
          .eq("meter_id", meterId)
          .gte("reading_timestamp", dateFrom.toISOString())
          .lte("reading_timestamp", dateTo.toISOString())
          .order("kva_value", { ascending: false })
          .limit(1)
          .maybeSingle();

        maxKvaValue = kvaData?.kva_value || 0;
      }
      
      console.log('🔍 [Cost Calculation Debug] Max kVA value:', maxKvaValue, '(provided:', maxKva, ')');

      if (maxKvaValue > 0) {
        // Determine season for demand charge
        const startMonth = dateFrom.getMonth() + 1;
        const endMonth = dateTo.getMonth() + 1;
        const isHighSeason = (startMonth >= 6 && startMonth <= 8) || (endMonth >= 6 && endMonth <= 8);

        const demandChargeType = isHighSeason ? "demand_high_season" : "demand_low_season";
        const demandCharge = tariff.tariff_charges.find(
          (c: any) => c.charge_type === demandChargeType
        );

        if (demandCharge) {
          demandCharges = maxKvaValue * Number(demandCharge.charge_amount);
          console.log('🔍 [Cost Calculation Debug] Demand charge calculated:', demandCharges, '= kVA:', maxKvaValue, '× rate:', demandCharge.charge_amount);
        }
      }
    }

    const totalCost = energyCost + fixedCharges + demandCharges;
    const avgCostPerKwh = calculatedTotalKwh > 0 ? totalCost / calculatedTotalKwh : 0;

    return {
      energyCost,
      fixedCharges,
      demandCharges,
      totalCost,
      avgCostPerKwh,
      tariffName: tariff.name,
      hasError: false,
    };
  } catch (error: any) {
    return {
      energyCost: 0,
      fixedCharges: 0,
      demandCharges: 0,
      totalCost: 0,
      avgCostPerKwh: 0,
      tariffName: "Error",
      hasError: true,
      errorMessage: error.message || "Unknown error",
    };
  }
}

/**
 * Calculate electricity cost for a meter across multiple tariff periods
 * This function handles scenarios where the date range spans multiple tariff effective periods
 * @param meterId - Meter ID
 * @param supplyAuthorityId - Supply authority ID
 * @param tariffName - Tariff name (not ID, to support multiple periods)
 * @param dateFrom - Start date for calculation
 * @param dateTo - End date for calculation
 * @returns Cost calculation result with breakdown by period
 */
export async function calculateMeterCostAcrossPeriods(
  meterId: string,
  supplyAuthorityId: string,
  tariffName: string,
  dateFrom: Date,
  dateTo: Date,
  totalKwh?: number,
  maxKva?: number
): Promise<CostCalculationResult> {
  try {
    // Fetch all applicable tariff periods for this date range
    const { data: tariffPeriods, error: periodsError } = await supabase.rpc(
      'get_applicable_tariff_periods',
      {
        p_supply_authority_id: supplyAuthorityId,
        p_tariff_name: tariffName,
        p_date_from: dateFrom.toISOString(),
        p_date_to: dateTo.toISOString()
      }
    );

    if (periodsError || !tariffPeriods || tariffPeriods.length === 0) {
      return {
        energyCost: 0,
        fixedCharges: 0,
        demandCharges: 0,
        totalCost: 0,
        avgCostPerKwh: 0,
        tariffName: tariffName,
        hasError: true,
        errorMessage: `No tariff periods found for "${tariffName}" in the specified date range`,
      };
    }

    // If only one period, use the standard calculation
    if (tariffPeriods.length === 1) {
      const result = await calculateMeterCost(
        meterId,
        tariffPeriods[0].tariff_id,
        dateFrom,
        dateTo,
        totalKwh,
        maxKva
      );
      return {
        ...result,
        tariffPeriodsUsed: [{
          tariffId: tariffPeriods[0].tariff_id,
          tariffName: tariffPeriods[0].tariff_name,
          effectiveFrom: tariffPeriods[0].effective_from,
          effectiveTo: tariffPeriods[0].effective_to,
          dateFrom: dateFrom.toISOString(),
          dateTo: dateTo.toISOString(),
          kwh: 0,
          cost: result.totalCost
        }]
      };
    }

    // Multiple periods - split date range and calculate for each segment
    
    let totalEnergyCost = 0;
    let totalFixedCharges = 0;
    let totalDemandCharges = 0;
    let calculatedTotalKwh = 0;
    const periodBreakdown: Array<{
      tariffId: string;
      tariffName: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      dateFrom: string;
      dateTo: string;
      kwh: number;
      cost: number;
    }> = [];

    for (let i = 0; i < tariffPeriods.length; i++) {
      const period = tariffPeriods[i];
      const periodEffectiveFrom = new Date(period.effective_from);
      const periodEffectiveTo = period.effective_to ? new Date(period.effective_to) : dateTo;

      // Calculate the segment date range (intersection of requested range and period validity)
      const segmentStart = new Date(Math.max(dateFrom.getTime(), periodEffectiveFrom.getTime()));
      const segmentEnd = new Date(Math.min(dateTo.getTime(), periodEffectiveTo.getTime()));

      // Skip if segment is invalid
      if (segmentStart > segmentEnd) {
        continue;
      }

      // Fetch readings for this segment
      const { data: readingsData } = await supabase
        .from("meter_readings")
        .select("kwh_value")
        .eq("meter_id", meterId)
        .gte("reading_timestamp", segmentStart.toISOString())
        .lte("reading_timestamp", segmentEnd.toISOString());

      const segmentKwh = (readingsData || []).reduce((sum, r) => sum + Number(r.kwh_value), 0);

      // Calculate cost for this segment - pass maxKva for demand charges
      const segmentResult = await calculateMeterCost(
        meterId,
        period.tariff_id,
        segmentStart,
        segmentEnd,
        segmentKwh,
        maxKva
      );

      if (!segmentResult.hasError) {
        totalEnergyCost += segmentResult.energyCost;
        totalFixedCharges += segmentResult.fixedCharges;
        totalDemandCharges += segmentResult.demandCharges;
        calculatedTotalKwh += segmentKwh;

        periodBreakdown.push({
          tariffId: period.tariff_id,
          tariffName: period.tariff_name,
          effectiveFrom: period.effective_from,
          effectiveTo: period.effective_to,
          dateFrom: segmentStart.toISOString(),
          dateTo: segmentEnd.toISOString(),
          kwh: segmentKwh,
          cost: segmentResult.totalCost
        });
      }
    }

    const totalCost = totalEnergyCost + totalFixedCharges + totalDemandCharges;
    const avgCostPerKwh = calculatedTotalKwh > 0 ? totalCost / calculatedTotalKwh : 0;

    return {
      energyCost: totalEnergyCost,
      fixedCharges: totalFixedCharges,
      demandCharges: totalDemandCharges,
      totalCost,
      avgCostPerKwh,
      tariffName,
      hasError: false,
      tariffPeriodsUsed: periodBreakdown
    };
  } catch (error: any) {
    return {
      energyCost: 0,
      fixedCharges: 0,
      demandCharges: 0,
      totalCost: 0,
      avgCostPerKwh: 0,
      tariffName,
      hasError: true,
      errorMessage: error.message || "Unknown error in multi-period calculation",
    };
  }
}
