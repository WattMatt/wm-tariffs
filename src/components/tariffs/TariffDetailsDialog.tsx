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

export default function TariffDetailsDialog({ tariffId, tariffName, onClose }: TariffDetailsDialogProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [tariff, setTariff] = useState<any>(null);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [charges, setCharges] = useState<any[]>([]);
  const [touPeriods, setTouPeriods] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, [tariffId]);

  const fetchData = async () => {
    try {
      setIsLoading(true);

      // Fetch tariff
      const { data: tariffData, error: tariffError } = await supabase
        .from("tariff_structures")
        .select("*")
        .eq("id", tariffId)
        .single();

      if (tariffError) throw tariffError;

      // Fetch blocks
      const { data: blocksData } = await supabase
        .from("tariff_blocks")
        .select("*")
        .eq("tariff_structure_id", tariffId)
        .order("block_number", { ascending: true });

      // Fetch charges
      const { data: chargesData } = await supabase
        .from("tariff_charges")
        .select("*")
        .eq("tariff_structure_id", tariffId);

      // Fetch TOU periods
      const { data: touData } = await supabase
        .from("tariff_time_periods")
        .select("*")
        .eq("tariff_structure_id", tariffId)
        .order("season", { ascending: true });

      setTariff(tariffData);
      setBlocks(blocksData || []);
      setCharges(chargesData || []);
      setTouPeriods(touData || []);

      console.log("Loaded:", {
        blocks: blocksData?.length || 0,
        charges: chargesData?.length || 0,
        tou: touData?.length || 0
      });
    } catch (error: any) {
      console.error("Error loading tariff:", error);
      toast.error(`Failed to load tariff: ${error.message}`);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>View Tariff Structure</DialogTitle>
            <DialogDescription>Loading tariff details...</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!tariff) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>View Tariff Structure</DialogTitle>
          </DialogHeader>
          <div className="text-center py-8 text-destructive">
            Failed to load tariff data
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>View Tariff Structure</DialogTitle>
          <DialogDescription>Viewing details for {tariffName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <Label>Tariff Name</Label>
              <Input value={tariff.name} disabled className="mt-1" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tariff Type</Label>
                <Input value={tariff.tariff_type} disabled className="mt-1" />
              </div>
              <div>
                <Label>Meter Configuration</Label>
                <Input value={tariff.meter_configuration || "N/A"} disabled className="mt-1" />
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Input value={tariff.description || "No description"} disabled className="mt-1" />
            </div>

            <div>
              <Label>Effective From</Label>
              <Input value={tariff.effective_from} disabled className="mt-1" />
            </div>
          </div>

          {/* Blocks */}
          {blocks.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="text-lg font-semibold mb-3">Energy Blocks ({blocks.length})</h3>
                <div className="space-y-2">
                  {blocks.map((block) => (
                    <div key={block.id} className="grid grid-cols-4 gap-3 p-3 bg-muted/50 rounded-lg">
                      <div>
                        <Label className="text-xs text-muted-foreground">Block</Label>
                        <div className="font-medium">{block.block_number}</div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">From (kWh)</Label>
                        <div className="font-medium">{block.kwh_from}</div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">To (kWh)</Label>
                        <div className="font-medium">{block.kwh_to || "∞"}</div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Rate</Label>
                        <div className="font-medium">{block.energy_charge_cents} c/kWh</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Charges */}
          {charges.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="text-lg font-semibold mb-3">Tariff Charges ({charges.length})</h3>
                <div className="space-y-2">
                  {charges.map((charge) => (
                    <div key={charge.id} className="p-3 bg-muted/50 rounded-lg">
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Charge Type</Label>
                          <div className="font-medium">{charge.charge_type.replace(/_/g, ' ').toUpperCase()}</div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Amount</Label>
                          <div className="font-medium">{charge.charge_amount} {charge.unit}</div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Description</Label>
                          <div className="font-medium">{charge.description || "N/A"}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* TOU Periods */}
          {touPeriods.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="text-lg font-semibold mb-3">Time-of-Use Periods ({touPeriods.length})</h3>
                <div className="space-y-2">
                  {touPeriods.map((period) => (
                    <div key={period.id} className="p-3 bg-muted/50 rounded-lg">
                      <div className="grid grid-cols-5 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Season</Label>
                          <div className="font-medium">{period.season}</div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Period Type</Label>
                          <div className="font-medium">{period.period_type.replace(/_/g, ' ')}</div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Day Type</Label>
                          <div className="font-medium">{period.day_type}</div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Hours</Label>
                          <div className="font-medium">{period.start_hour}:00 - {period.end_hour}:00</div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Rate</Label>
                          <div className="font-medium">{period.energy_charge_cents} c/kWh</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {blocks.length === 0 && charges.length === 0 && touPeriods.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No detailed tariff structure data available for this tariff.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
