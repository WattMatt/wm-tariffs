import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

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
  charges: any[];
  touPeriods: any[];
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

      const formattedData = {
        tariffName: tariff.name,
        tariffType: tariff.tariff_type,
        meterConfiguration: tariff.meter_configuration || "prepaid",
        description: tariff.description || "",
        effectiveFrom: tariff.effective_from,
        blocks: blocks || [],
        charges: charges || [],
        touPeriods: touPeriods || []
      };

      console.log('TariffDetailsDialog - Fetched data:', {
        blocks: formattedData.blocks.length,
        charges: formattedData.charges.length,
        touPeriods: formattedData.touPeriods.length,
        chargesData: formattedData.charges
      });

      setTariffData(formattedData);
    } catch (error: any) {
      toast.error(`Failed to load tariff: ${error.message}`);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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
          <div className="space-y-6">
            {/* Debug Info */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm">
              <strong>Debug:</strong> Blocks: {tariffData.blocks.length}, Charges: {tariffData.charges.length}, TOU: {tariffData.touPeriods.length}
            </div>
            
            {/* Basic Information */}
            <div className="space-y-4">
              <div>
                <Label>Tariff Name</Label>
                <Input value={tariffData.tariffName} disabled className="mt-1" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tariff Type</Label>
                  <Input value={tariffData.tariffType} disabled className="mt-1" />
                </div>
                <div>
                  <Label>Meter Configuration</Label>
                  <Input value={tariffData.meterConfiguration} disabled className="mt-1" />
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <Input value={tariffData.description || "No description"} disabled className="mt-1" />
              </div>

              <div>
                <Label>Effective From</Label>
                <Input value={tariffData.effectiveFrom} disabled className="mt-1" />
              </div>
            </div>

            {/* Energy Blocks */}
            {tariffData.blocks.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-lg font-semibold mb-4">Energy Blocks</h3>
                  <div className="space-y-3">
                    {tariffData.blocks.map((block, index) => (
                      <div key={index} className="grid grid-cols-4 gap-2 p-3 bg-muted/50 rounded-lg">
                        <div>
                          <Label className="text-xs">Block {block.block_number}</Label>
                        </div>
                        <div>
                          <Label className="text-xs">From (kWh)</Label>
                          <Input value={block.kwh_from} disabled className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs">To (kWh)</Label>
                          <Input value={block.kwh_to || "∞"} disabled className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs">Rate (c/kWh)</Label>
                          <Input value={block.energy_charge_cents} disabled className="mt-1" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Charges */}
            {tariffData.charges.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-lg font-semibold mb-4">Charges</h3>
                  <div className="space-y-3">
                    {tariffData.charges.map((charge, index) => (
                      <div key={index} className="grid grid-cols-4 gap-2 p-3 bg-muted/50 rounded-lg">
                        <div className="col-span-2">
                          <Label className="text-xs">Type</Label>
                          <Input value={charge.charge_type.replace(/_/g, ' ').toUpperCase()} disabled className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs">Amount</Label>
                          <Input value={charge.charge_amount} disabled className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs">Unit</Label>
                          <Input value={charge.unit} disabled className="mt-1" />
                        </div>
                        {charge.description && (
                          <div className="col-span-4">
                            <Label className="text-xs">Description</Label>
                            <Input value={charge.description} disabled className="mt-1" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* TOU Periods */}
            {tariffData.touPeriods.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-lg font-semibold mb-4">Time-of-Use Periods</h3>
                  <div className="space-y-3">
                    {tariffData.touPeriods.map((period, index) => (
                      <div key={index} className="grid grid-cols-5 gap-2 p-3 bg-muted/50 rounded-lg">
                        <div>
                          <Label className="text-xs">Season</Label>
                          <Input value={period.season} disabled className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs">Period</Label>
                          <Input value={period.period_type.replace(/_/g, ' ')} disabled className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs">Day Type</Label>
                          <Input value={period.day_type} disabled className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs">Hours</Label>
                          <Input value={`${period.start_hour}:00 - ${period.end_hour}:00`} disabled className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs">Rate (c/kWh)</Label>
                          <Input value={period.energy_charge_cents} disabled className="mt-1" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tariffData.blocks.length === 0 && tariffData.charges.length === 0 && tariffData.touPeriods.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No tariff data available
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Failed to load tariff data
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}