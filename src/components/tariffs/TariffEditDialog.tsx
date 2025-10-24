import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import TariffStructureForm from "./TariffStructureForm";

interface TariffEditDialogProps {
  tariffId: string;
  tariffName: string;
  mode: "view" | "edit";
  supplyAuthorityId: string;
  onClose: () => void;
  onSave?: () => void;
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

export default function TariffEditDialog({ 
  tariffId, 
  tariffName, 
  mode, 
  supplyAuthorityId,
  onClose,
  onSave 
}: TariffEditDialogProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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
          .filter(c => c.charge_type === "network_charge")
          .map(c => ({
            season: c.description,
            rate: c.charge_amount,
            unit: c.unit
          })),
        touSeasons: groupTouPeriods(touPeriods || []),
        basicCharge: (charges || []).find(c => c.charge_type === "basic_monthly")
          ? {
              amount: charges.find(c => c.charge_type === "basic_monthly")!.charge_amount,
              unit: charges.find(c => c.charge_type === "basic_monthly")!.unit
            }
          : undefined,
        demandCharges: (charges || [])
          .filter(c => c.charge_type === "demand_kva")
          .map(c => ({
            season: c.description,
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

  const handleSubmit = async (data: TariffData) => {
    setIsSaving(true);

    try {
      // Update tariff structure
      const { error: tariffError } = await supabase
        .from("tariff_structures")
        .update({
          name: data.tariffName,
          tariff_type: data.tariffType,
          meter_configuration: data.meterConfiguration,
          description: data.description,
          effective_from: data.effectiveFrom,
          uses_tou: data.touSeasons.length > 0,
          tou_type: data.touSeasons.length > 0 ? "custom" : null
        })
        .eq("id", tariffId);

      if (tariffError) throw tariffError;

      // Delete existing related data
      await Promise.all([
        supabase.from("tariff_blocks").delete().eq("tariff_structure_id", tariffId),
        supabase.from("tariff_charges").delete().eq("tariff_structure_id", tariffId),
        supabase.from("tariff_time_periods").delete().eq("tariff_structure_id", tariffId)
      ]);

      // Insert new blocks
      if (data.blocks.length > 0) {
        const blocksToInsert = data.blocks.map(block => ({
          tariff_structure_id: tariffId,
          block_number: block.blockNumber,
          kwh_from: block.kwhFrom,
          kwh_to: block.kwhTo,
          energy_charge_cents: block.energyChargeCents
        }));

        const { error: blocksError } = await supabase
          .from("tariff_blocks")
          .insert(blocksToInsert);

        if (blocksError) throw blocksError;
      }

      // Insert seasonal energy charges
      if (data.seasonalEnergy.length > 0) {
        const chargesToInsert = data.seasonalEnergy.map(charge => ({
          tariff_structure_id: tariffId,
          charge_type: "network_charge",
          description: charge.season,
          charge_amount: charge.rate,
          unit: charge.unit
        }));

        const { error: chargesError } = await supabase
          .from("tariff_charges")
          .insert(chargesToInsert);

        if (chargesError) throw chargesError;
      }

      // Insert TOU periods
      if (data.touSeasons.length > 0) {
        const touToInsert = data.touSeasons.flatMap(season => [
          {
            tariff_structure_id: tariffId,
            season: season.season,
            day_type: "weekday",
            period_type: "peak",
            start_hour: 7,
            end_hour: 10,
            energy_charge_cents: season.peak
          },
          {
            tariff_structure_id: tariffId,
            season: season.season,
            day_type: "weekday",
            period_type: "standard",
            start_hour: 10,
            end_hour: 18,
            energy_charge_cents: season.standard
          },
          {
            tariff_structure_id: tariffId,
            season: season.season,
            day_type: "weekday",
            period_type: "off_peak",
            start_hour: 18,
            end_hour: 7,
            energy_charge_cents: season.offPeak
          }
        ]);

        const { error: touError } = await supabase
          .from("tariff_time_periods")
          .insert(touToInsert);

        if (touError) throw touError;
      }

      // Insert basic charge
      if (data.basicCharge) {
        const { error: basicChargeError } = await supabase
          .from("tariff_charges")
          .insert({
            tariff_structure_id: tariffId,
            charge_type: "basic_monthly",
            description: "Monthly Basic Charge",
            charge_amount: data.basicCharge.amount,
            unit: data.basicCharge.unit
          });

        if (basicChargeError) throw basicChargeError;
      }

      // Insert demand charges
      if (data.demandCharges.length > 0) {
        const demandChargesToInsert = data.demandCharges.map(charge => ({
          tariff_structure_id: tariffId,
          charge_type: "demand_kva",
          description: charge.season,
          charge_amount: charge.rate,
          unit: charge.unit
        }));

        const { error: demandError } = await supabase
          .from("tariff_charges")
          .insert(demandChargesToInsert);

        if (demandError) throw demandError;
      }

      toast.success("Tariff updated successfully");
      onSave?.();
      onClose();
    } catch (error: any) {
      toast.error(`Failed to update tariff: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "view" ? "View Tariff Structure" : "Edit Tariff Structure"}
          </DialogTitle>
          <DialogDescription>
            {mode === "view" 
              ? `Viewing details for ${tariffName}`
              : `Editing tariff structure for ${tariffName}`
            }
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : tariffData ? (
          <TariffStructureForm 
            onSubmit={handleSubmit}
            isLoading={isSaving}
            initialData={tariffData}
            readOnly={mode === "view"}
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
