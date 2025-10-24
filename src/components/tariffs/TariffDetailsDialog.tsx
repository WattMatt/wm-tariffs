import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import TariffStructureForm from "./TariffStructureForm";

interface TariffDetailsDialogProps {
  tariffId: string;
  tariffName: string;
  onClose: () => void;
}

interface TariffData {
  tariffName: string;
  tariffType: string;
  meterConfiguration: string;
  description: string;
  effectiveFrom: string;
  blocks: any[];
  seasonalEnergy: any[];
  touSeasons: any[];
  basicCharge?: any;
  demandCharges: any[];
}

export default function TariffDetailsDialog({ tariffId, tariffName, onClose }: TariffDetailsDialogProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [tariffData, setTariffData] = useState<TariffData | null>(null);

  useEffect(() => {
    fetchTariffData();
  }, [tariffId]);

  const fetchTariffData = async () => {
    setIsLoading(true);

    try {
      // Fetch tariff structure
      const { data: tariff, error: tariffError } = await supabase
        .from("tariff_structures")
        .select("*")
        .eq("id", tariffId)
        .single();

      if (tariffError) throw tariffError;

      // Fetch blocks
      const { data: blocks } = await supabase
        .from("tariff_blocks")
        .select("*")
        .eq("tariff_structure_id", tariffId)
        .order("block_number", { ascending: true });

      // Fetch charges
      const { data: charges } = await supabase
        .from("tariff_charges")
        .select("*")
        .eq("tariff_structure_id", tariffId);

      // Fetch TOU periods
      const { data: touPeriods } = await supabase
        .from("tariff_time_periods")
        .select("*")
        .eq("tariff_structure_id", tariffId)
        .order("season", { ascending: true });

      // Transform data to match form structure
      const formData: TariffData = {
        tariffName: tariff.name,
        tariffType: tariff.tariff_type,
        meterConfiguration: tariff.meter_configuration || "prepaid",
        description: tariff.description || "",
        effectiveFrom: tariff.effective_from,
        blocks: (blocks || []).map(block => ({
          blockNumber: block.block_number,
          kwhFrom: block.kwh_from,
          kwhTo: block.kwh_to,
          energyChargeCents: block.energy_charge_cents
        })),
        seasonalEnergy: (charges || [])
          .filter(c => c.charge_type.includes('energy'))
          .map(c => ({
            season: c.description.replace(' Energy Charge', ''),
            rate: c.charge_amount,
            unit: c.unit
          })),
        touSeasons: groupTouPeriods(touPeriods || []),
        basicCharge: (charges || []).find(c => c.charge_type === 'basic_monthly' || c.charge_type === 'basic_charge')
          ? {
              amount: charges.find(c => c.charge_type === 'basic_monthly' || c.charge_type === 'basic_charge')!.charge_amount,
              unit: charges.find(c => c.charge_type === 'basic_monthly' || c.charge_type === 'basic_charge')!.unit
            }
          : undefined,
        demandCharges: (charges || [])
          .filter(c => c.charge_type.includes('demand'))
          .map(c => ({
            season: c.description.replace(' Demand Charge', ''),
            rate: c.charge_amount,
            unit: c.unit
          }))
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

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>View Tariff Structure</DialogTitle>
          <DialogDescription>
            Viewing details for {tariffName}
          </DialogDescription>
        </DialogHeader>

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