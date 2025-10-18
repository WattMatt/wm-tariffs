import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Check, X, Edit } from "lucide-react";

interface ExtractedMeterData {
  meter_number: string;
  name: string;
  area: number | null;
  rating: string;
  cable_specification: string;
  serial_number: string;
  ct_type: string;
  meter_type: string;
  location?: string;
  tariff?: string;
}

interface MeterDataExtractorProps {
  siteId: string;
  schematicId: string;
  imageUrl: string;
  onMetersExtracted: () => void;
}

export const MeterDataExtractor = ({ siteId, schematicId, imageUrl, onMetersExtracted }: MeterDataExtractorProps) => {
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedMeters, setExtractedMeters] = useState<ExtractedMeterData[]>([]);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedMeter, setEditedMeter] = useState<ExtractedMeterData | null>(null);

  const extractMetersFromSchematic = async () => {
    setIsExtracting(true);
    try {
      console.log('Extracting meters from schematic:', imageUrl);
      
      const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
        body: { imageUrl }
      });

      if (error) {
        console.error('Edge function error:', error);
        throw error;
      }

      if (!data || !data.meters) {
        throw new Error('No meter data returned');
      }

      console.log('Extracted meters:', data.meters);
      setExtractedMeters(data.meters);
      setShowApprovalDialog(true);
      toast.success(`Extracted ${data.meters.length} meters from schematic`);
    } catch (error) {
      console.error('Error extracting meters:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to extract meter data from schematic');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleEditMeter = (index: number) => {
    setEditingIndex(index);
    setEditedMeter({ ...extractedMeters[index] });
  };

  const handleSaveEdit = () => {
    if (editingIndex !== null && editedMeter) {
      const updated = [...extractedMeters];
      updated[editingIndex] = editedMeter;
      setExtractedMeters(updated);
      setEditingIndex(null);
      setEditedMeter(null);
    }
  };

  const handleRemoveMeter = (index: number) => {
    setExtractedMeters(prev => prev.filter((_, i) => i !== index));
  };

  const handleApproveAndSave = async () => {
    try {
      // Insert all meters
      const metersToInsert = extractedMeters.map(meter => ({
        site_id: siteId,
        meter_number: meter.meter_number,
        name: meter.name,
        area: meter.area,
        rating: meter.rating,
        cable_specification: meter.cable_specification,
        serial_number: meter.serial_number,
        ct_type: meter.ct_type,
        meter_type: meter.meter_type,
        location: meter.location,
        tariff: meter.tariff,
      }));

      const { error } = await supabase
        .from("meters")
        .insert(metersToInsert);

      if (error) throw error;

      toast.success(`Successfully saved ${extractedMeters.length} meters`);
      setShowApprovalDialog(false);
      setExtractedMeters([]);
      onMetersExtracted();
    } catch (error) {
      console.error("Error saving meters:", error);
      toast.error("Failed to save meters to database");
    }
  };

  return (
    <>
      <Button
        onClick={extractMetersFromSchematic}
        disabled={isExtracting}
        className="gap-2"
      >
        {isExtracting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Extracting Data...
          </>
        ) : (
          "Extract Meters from Schematic"
        )}
      </Button>

      <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Extracted Meters ({extractedMeters.length})</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {extractedMeters.map((meter, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{meter.meter_number} - {meter.name}</h3>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEditMeter(index)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveMeter(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {editingIndex === index ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Meter Number</Label>
                      <Input
                        value={editedMeter?.meter_number || ""}
                        onChange={(e) => setEditedMeter(prev => prev ? { ...prev, meter_number: e.target.value } : null)}
                      />
                    </div>
                    <div>
                      <Label>Name</Label>
                      <Input
                        value={editedMeter?.name || ""}
                        onChange={(e) => setEditedMeter(prev => prev ? { ...prev, name: e.target.value } : null)}
                      />
                    </div>
                    <div>
                      <Label>Area (m²)</Label>
                      <Input
                        type="number"
                        value={editedMeter?.area || ""}
                        onChange={(e) => setEditedMeter(prev => prev ? { ...prev, area: parseFloat(e.target.value) || null } : null)}
                      />
                    </div>
                    <div>
                      <Label>Rating</Label>
                      <Input
                        value={editedMeter?.rating || ""}
                        onChange={(e) => setEditedMeter(prev => prev ? { ...prev, rating: e.target.value } : null)}
                      />
                    </div>
                    <div>
                      <Label>Cable Specification</Label>
                      <Input
                        value={editedMeter?.cable_specification || ""}
                        onChange={(e) => setEditedMeter(prev => prev ? { ...prev, cable_specification: e.target.value } : null)}
                      />
                    </div>
                    <div>
                      <Label>Serial Number</Label>
                      <Input
                        value={editedMeter?.serial_number || ""}
                        onChange={(e) => setEditedMeter(prev => prev ? { ...prev, serial_number: e.target.value } : null)}
                      />
                    </div>
                    <div>
                      <Label>CT Type</Label>
                      <Input
                        value={editedMeter?.ct_type || ""}
                        onChange={(e) => setEditedMeter(prev => prev ? { ...prev, ct_type: e.target.value } : null)}
                      />
                    </div>
                    <div>
                      <Label>Meter Type</Label>
                      <Select
                        value={editedMeter?.meter_type || ""}
                        onValueChange={(value) => setEditedMeter(prev => prev ? { ...prev, meter_type: value } : null)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="main">Main</SelectItem>
                          <SelectItem value="sub_main">Sub Main</SelectItem>
                          <SelectItem value="distribution">Distribution</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Button onClick={handleSaveEdit} size="sm" className="gap-2">
                        <Check className="h-4 w-4" />
                        Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="font-medium">Area:</span> {meter.area}m²</div>
                    <div><span className="font-medium">Rating:</span> {meter.rating}</div>
                    <div className="col-span-2"><span className="font-medium">Cable:</span> {meter.cable_specification}</div>
                    <div><span className="font-medium">Serial:</span> {meter.serial_number}</div>
                    <div><span className="font-medium">CT:</span> {meter.ct_type}</div>
                    <div><span className="font-medium">Type:</span> {meter.meter_type}</div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApprovalDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleApproveAndSave} disabled={extractedMeters.length === 0}>
              Approve & Save All ({extractedMeters.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
