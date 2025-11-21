import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import TariffStructureForm from "./TariffStructureForm";

interface TariffDetailsDialogProps {
  tariffId: string;
  tariffName: string;
  onClose: () => void;
}

interface TariffPeriod {
  id: string;
  effective_from: string;
  effective_to: string | null;
  supply_authority_id: string;
}

interface TariffData {
  tariffName: string;
  tariffType: string;
  meterConfiguration: string;
  description: string;
  effectiveFrom: string;
  effectiveTo: string;
  blocks: any[];
  seasonalEnergy: any[];
  touSeasons: any[];
  basicCharge?: any;
  demandCharges: any[];
}

export default function TariffDetailsDialog({ tariffId, tariffName, onClose }: TariffDetailsDialogProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [tariffData, setTariffData] = useState<TariffData | null>(null);
  const [availablePeriods, setAvailablePeriods] = useState<TariffPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState(tariffId);

  useEffect(() => {
    fetchAvailablePeriods();
  }, []);

  useEffect(() => {
    if (selectedPeriodId) {
      fetchTariffData(selectedPeriodId);
    }
  }, [selectedPeriodId]);

  const fetchAvailablePeriods = async () => {
    try {
      // First get the supply_authority_id from the initial tariff
      const { data: initialTariff, error: initialError } = await supabase
        .from("tariff_structures")
        .select("supply_authority_id, name")
        .eq("id", tariffId)
        .single();

      if (initialError) throw initialError;

      // Fetch all tariff periods with the same name and supply authority
      const { data: periods, error: periodsError } = await supabase
        .from("tariff_structures")
        .select("id, effective_from, effective_to, supply_authority_id")
        .eq("name", initialTariff.name)
        .eq("supply_authority_id", initialTariff.supply_authority_id)
        .order("effective_from", { ascending: false });

      if (periodsError) throw periodsError;

      setAvailablePeriods(periods || []);
    } catch (error: any) {
      toast.error(`Failed to load tariff periods: ${error.message}`);
    }
  };

  const fetchTariffData = async (periodId: string) => {
    setIsLoading(true);

    try {
      // Fetch tariff structure
      const { data: tariff, error: tariffError } = await supabase
        .from("tariff_structures")
        .select("*")
        .eq("id", periodId)
        .single();

      if (tariffError) throw tariffError;

      // Fetch blocks
      const { data: blocks } = await supabase
        .from("tariff_blocks")
        .select("*")
        .eq("tariff_structure_id", periodId)
        .order("block_number", { ascending: true });

      // Fetch charges
      const { data: charges } = await supabase
        .from("tariff_charges")
        .select("*")
        .eq("tariff_structure_id", periodId);

      // Fetch TOU periods
      const { data: touPeriods } = await supabase
        .from("tariff_time_periods")
        .select("*")
        .eq("tariff_structure_id", periodId)
        .order("season", { ascending: true });

      // Transform data to match form structure
      const basicChargeData = (charges || []).find(c => 
        c.charge_type === 'basic_monthly' || c.charge_type === 'basic_charge'
      );
      
      const formData: TariffData = {
        tariffName: tariff.name,
        tariffType: tariff.tariff_type,
        meterConfiguration: tariff.meter_configuration || "prepaid",
        description: tariff.description || "",
        effectiveFrom: tariff.effective_from,
        effectiveTo: tariff.effective_to || tariff.effective_from,
        blocks: (blocks || []).map(block => ({
          blockNumber: block.block_number,
          kwhFrom: block.kwh_from,
          kwhTo: block.kwh_to,
          energyChargeCents: block.energy_charge_cents
        })),
        seasonalEnergy: (charges || [])
          .filter(c => c.charge_type.startsWith('energy_') && !c.charge_type.includes('tou'))
          .map(c => {
            // Extract season from charge_type (e.g., "energy_high_season" -> "High Season")
            const seasonPart = c.charge_type.replace('energy_', '').replace('_', ' ');
            const season = seasonPart.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            return {
              season: season,
              rate: c.charge_amount,
              unit: c.unit
            };
          }),
        touSeasons: groupTouPeriods(touPeriods || []),
        basicCharge: basicChargeData
          ? {
              amount: basicChargeData.charge_amount,
              unit: basicChargeData.unit
            }
          : undefined,
        demandCharges: (charges || [])
          .filter(c => c.charge_type.startsWith('demand_'))
          .map(c => {
            // Extract season from charge_type (e.g., "demand_high_season" -> "High Season")
            const seasonPart = c.charge_type.replace('demand_', '').replace('_', ' ');
            const season = seasonPart.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            return {
              season: season,
              rate: c.charge_amount,
              unit: c.unit
            };
          })
      };

      setTariffData(formData);
    } catch (error: any) {
      toast.error(`Failed to load tariff: ${error.message}`);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const groupTouPeriods = (periods: any[]) => {
    const grouped = new Map<string, any>();

    periods.forEach(period => {
      const key = period.season;
      if (!grouped.has(key)) {
        grouped.set(key, {
          season: period.season,
          peak: 0,
          standard: 0,
          offPeak: 0
        });
      }

      const seasonData = grouped.get(key);
      if (period.period_type === "peak") {
        seasonData.peak = period.energy_charge_cents;
      } else if (period.period_type === "standard") {
        seasonData.standard = period.energy_charge_cents;
      } else if (period.period_type === "off_peak") {
        seasonData.offPeak = period.energy_charge_cents;
      }
    });

    return Array.from(grouped.values());
  };

  const formatDateRange = (from: string, to: string | null) => {
    const fromDate = new Date(from).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const toDate = to ? new Date(to).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Present';
    return `${fromDate} - ${toDate}`;
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>View Tariff Structure</DialogTitle>
          <DialogDescription>
            Viewing details for {tariffName}
          </DialogDescription>
        </DialogHeader>

        {availablePeriods.length > 1 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Tariff Period</label>
            <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availablePeriods.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {formatDateRange(period.effective_from, period.effective_to)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : tariffData ? (
          <TariffStructureForm 
            onSubmit={() => {}}
            isLoading={false}
            initialData={tariffData}
            readOnly={true}
          />
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Failed to load tariff data
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
