import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Plus, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface QuickMeterDialogProps {
  open: boolean;
  onClose: () => void;
  siteId: string;
  position: { x: number; y: number };
  schematicId: string;
  onMeterPlaced: () => void;
}

export const QuickMeterDialog = ({
  open,
  onClose,
  siteId,
  position,
  schematicId,
  onMeterPlaced,
}: QuickMeterDialogProps) => {
  const [activeTab, setActiveTab] = useState<"existing" | "new">("existing");
  const [meters, setMeters] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // New meter form
  const [newMeter, setNewMeter] = useState({
    meter_number: "",
    name: "",
    meter_type: "tenant_meter" as const,
    area: "",
    rating: "",
    cable_specification: "",
    serial_number: "",
    ct_type: "",
    phase: "",
    mccb_size: "",
    ct_ratio: "",
    supply_level: "",
    supply_description: "",
  });

  useEffect(() => {
    if (open) {
      fetchMeters();
    }
  }, [open, siteId]);

  const fetchMeters = async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from("meters")
      .select("*")
      .eq("site_id", siteId)
      .order("meter_number");
    setMeters(data || []);
    setIsLoading(false);
  };

  const filteredMeters = meters.filter(
    (meter) =>
      meter.meter_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      meter.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectExistingMeter = async (meterId: string) => {
    setIsSaving(true);
    try {
      const meter = meters.find((m) => m.id === meterId);
      
      // Check if meter already has a position on this schematic
      const { data: existingPos } = await supabase
        .from("meter_positions")
        .select("id")
        .eq("schematic_id", schematicId)
        .eq("meter_id", meterId)
        .single();

      if (existingPos) {
        // Update existing position
        const { error } = await supabase
          .from("meter_positions")
          .update({
            x_position: position.x,
            y_position: position.y,
          })
          .eq("id", existingPos.id);

        if (error) throw error;
        toast.success("Meter position updated");
      } else {
        // Create new position
        const { error } = await supabase
          .from("meter_positions")
          .insert({
            schematic_id: schematicId,
            meter_id: meterId,
            x_position: position.x,
            y_position: position.y,
            label: meter?.name || meter?.meter_number,
          });

        if (error) throw error;
        toast.success("Meter placed on schematic");
      }

      onMeterPlaced();
      handleClose();
    } catch (error) {
      console.error("Error placing meter:", error);
      toast.error("Failed to place meter");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateNewMeter = async () => {
    if (!newMeter.meter_number || !newMeter.name) {
      toast.error("Meter number and name are required");
      return;
    }

    setIsSaving(true);
    try {
      // Create meter
      const { data: createdMeter, error: meterError } = await supabase
        .from("meters")
        .insert({
          site_id: siteId,
          meter_number: newMeter.meter_number,
          name: newMeter.name,
          meter_type: newMeter.meter_type,
          area: newMeter.area ? parseFloat(newMeter.area) : null,
          rating: newMeter.rating || null,
          cable_specification: newMeter.cable_specification || null,
          serial_number: newMeter.serial_number || null,
          ct_type: newMeter.ct_type || null,
          phase: newMeter.phase || null,
          mccb_size: newMeter.mccb_size ? parseInt(newMeter.mccb_size) : null,
          ct_ratio: newMeter.ct_ratio || null,
          supply_level: newMeter.supply_level || null,
          supply_description: newMeter.supply_description || null,
        })
        .select()
        .single();

      if (meterError) throw meterError;

      // Place it on schematic
      const { error: posError } = await supabase
        .from("meter_positions")
        .insert({
          schematic_id: schematicId,
          meter_id: createdMeter.id,
          x_position: position.x,
          y_position: position.y,
          label: newMeter.name,
        });

      if (posError) throw posError;

      toast.success("Meter created and placed");
      onMeterPlaced();
      handleClose();
    } catch (error) {
      console.error("Error creating meter:", error);
      toast.error("Failed to create meter");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setSearchTerm("");
    setNewMeter({
      meter_number: "",
      name: "",
      meter_type: "tenant_meter",
      area: "",
      rating: "",
      cable_specification: "",
      serial_number: "",
      ct_type: "",
      phase: "",
      mccb_size: "",
      ct_ratio: "",
      supply_level: "",
      supply_description: "",
    });
    setActiveTab("existing");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Place Meter at Position ({position.x.toFixed(1)}%, {position.y.toFixed(1)}%)</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="existing">Select Existing Meter</TabsTrigger>
            <TabsTrigger value="new">Create New Meter</TabsTrigger>
          </TabsList>

          <TabsContent value="existing" className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search meters..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            <ScrollArea className="h-[400px] rounded-md border p-4">
              {isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : filteredMeters.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  {searchTerm ? "No meters found" : "No meters available"}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredMeters.map((meter) => (
                    <Button
                      key={meter.id}
                      variant="outline"
                      className="w-full justify-start h-auto p-4"
                      onClick={() => handleSelectExistingMeter(meter.id)}
                      disabled={isSaving}
                    >
                      <div className="text-left space-y-1 w-full">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold">{meter.meter_number}</span>
                          <span className="text-xs px-2 py-1 bg-muted rounded">{meter.meter_type}</span>
                        </div>
                        <div className="text-sm text-muted-foreground">{meter.name}</div>
                        {meter.rating && (
                          <div className="text-xs text-muted-foreground">Rating: {meter.rating}</div>
                        )}
                      </div>
                    </Button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="new" className="space-y-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Meter Number *</Label>
                    <Input
                      value={newMeter.meter_number}
                      onChange={(e) => setNewMeter({ ...newMeter, meter_number: e.target.value })}
                      placeholder="e.g., DB-01"
                    />
                  </div>
                  <div>
                    <Label>Meter Type *</Label>
                    <Select
                      value={newMeter.meter_type}
                      onValueChange={(value: any) => setNewMeter({ ...newMeter, meter_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bulk_meter">Bulk Meter</SelectItem>
                        <SelectItem value="check_meter">Check Meter</SelectItem>
                        <SelectItem value="tenant_meter">Tenant Meter</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Name/Location *</Label>
                  <Input
                    value={newMeter.name}
                    onChange={(e) => setNewMeter({ ...newMeter, name: e.target.value })}
                    placeholder="e.g., Main Board, Ackermans"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Area (m²)</Label>
                    <Input
                      type="number"
                      value={newMeter.area}
                      onChange={(e) => setNewMeter({ ...newMeter, area: e.target.value })}
                      placeholder="e.g., 406"
                    />
                  </div>
                  <div>
                    <Label>Rating</Label>
                    <Input
                      value={newMeter.rating}
                      onChange={(e) => setNewMeter({ ...newMeter, rating: e.target.value })}
                      placeholder="e.g., 100A TP"
                    />
                  </div>
                </div>

                <div>
                  <Label>Cable Specification</Label>
                  <Input
                    value={newMeter.cable_specification}
                    onChange={(e) => setNewMeter({ ...newMeter, cable_specification: e.target.value })}
                    placeholder="e.g., 4C x 50mm² ALU"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Serial Number</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newMeter.serial_number}
                        onChange={(e) => setNewMeter({ ...newMeter, serial_number: e.target.value })}
                        placeholder="e.g., 35777285"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setNewMeter({ ...newMeter, serial_number: 'Virtual' })}
                        className="shrink-0"
                        title="Set serial number as Virtual"
                      >
                        Virtual
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label>CT Type</Label>
                    <Input
                      value={newMeter.ct_type}
                      onChange={(e) => setNewMeter({ ...newMeter, ct_type: e.target.value })}
                      placeholder="e.g., 150/5A"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Phase</Label>
                    <Select
                      value={newMeter.phase}
                      onValueChange={(value) => setNewMeter({ ...newMeter, phase: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select phase" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Single Phase (1)</SelectItem>
                        <SelectItem value="3">Three Phase (3)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>MCCB Size (A)</Label>
                    <Input
                      type="number"
                      value={newMeter.mccb_size}
                      onChange={(e) => setNewMeter({ ...newMeter, mccb_size: e.target.value })}
                      placeholder="e.g., 200"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>CT Ratio</Label>
                    <Input
                      value={newMeter.ct_ratio}
                      onChange={(e) => setNewMeter({ ...newMeter, ct_ratio: e.target.value })}
                      placeholder="e.g., 200/5 or DOL"
                    />
                  </div>
                  <div>
                    <Label>Supply Level</Label>
                    <Input
                      value={newMeter.supply_level}
                      onChange={(e) => setNewMeter({ ...newMeter, supply_level: e.target.value })}
                      placeholder="e.g., MDB-1"
                    />
                  </div>
                </div>

                <div>
                  <Label>Supply Description</Label>
                  <Input
                    value={newMeter.supply_description}
                    onChange={(e) => setNewMeter({ ...newMeter, supply_description: e.target.value })}
                    placeholder="Additional description"
                  />
                </div>

                <Button
                  onClick={handleCreateNewMeter}
                  disabled={isSaving || !newMeter.meter_number || !newMeter.name}
                  className="w-full"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Create & Place Meter
                    </>
                  )}
                </Button>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
