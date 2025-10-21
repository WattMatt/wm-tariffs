import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Check, X, Edit, Pencil } from "lucide-react";
import { PdfToImageConverter } from "./PdfToImageConverter";

interface ExtractedMeterData {
  meter_number: string;
  name: string;
  area: string | null; // Changed to string to preserve "m²" unit
  rating: string;
  cable_specification: string;
  serial_number: string;
  ct_type: string;
  meter_type: string;
  location?: string;
  tariff?: string;
  status?: 'pending' | 'approved' | 'rejected';
  position?: { x: number; y: number };
}

interface MeterDataExtractorProps {
  siteId: string;
  schematicId: string;
  imageUrl: string;
  onMetersExtracted: () => void;
  onConvertedImageReady?: (imageUrl: string) => void;
  extractedMeters: ExtractedMeterData[];
  onMetersUpdate: (meters: ExtractedMeterData[]) => void;
  selectedMeterIndex: number | null;
  onMeterSelect: (index: number | null) => void;
  detectedRectangles: any[]; // Kept for compatibility but unused
  onRectanglesUpdate: (rectangles: any[]) => void; // Kept for compatibility but unused
  isDrawingMode: boolean;
  onDrawingModeChange: (mode: boolean) => void;
  drawnRegions: any[];
  onDrawnRegionsUpdate: (regions: any[]) => void;
}

export const MeterDataExtractor = ({ 
  siteId, 
  schematicId, 
  imageUrl, 
  onMetersExtracted,
  onConvertedImageReady,
  extractedMeters,
  onMetersUpdate,
  selectedMeterIndex,
  onMeterSelect,
  // detectedRectangles and onRectanglesUpdate kept for compatibility but unused
  isDrawingMode,
  onDrawingModeChange,
  // drawnRegions and onDrawnRegionsUpdate kept for compatibility but unused
}: MeterDataExtractorProps) => {
  const [isDetecting, setIsDetecting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedMeter, setEditedMeter] = useState<ExtractedMeterData | null>(null);
  const [convertedImageUrl, setConvertedImageUrl] = useState<string | null>(null);

  const isPdf = imageUrl.toLowerCase().includes('.pdf');
  const approvedCount = extractedMeters.filter(m => m.status === 'approved').length;
  const totalCount = extractedMeters.length;

  const handleImageGenerated = (imageDataUrl: string) => {
    console.log('PDF converted to image, ready for extraction');
    setConvertedImageUrl(imageDataUrl);
    onConvertedImageReady?.(imageDataUrl);
    toast.success('PDF converted! Now click "Start Drawing" to begin extracting meters.');
  };

  const handleEditMeter = (index: number) => {
    setEditingIndex(index);
    setEditedMeter({ ...extractedMeters[index] });
  };

  const handleSaveEdit = () => {
    if (editingIndex !== null && editedMeter) {
      const updated = [...extractedMeters];
      updated[editingIndex] = editedMeter;
      onMetersUpdate(updated);
      setEditingIndex(null);
      setEditedMeter(null);
    }
  };

  const handleRemoveMeter = (index: number) => {
    const updated = [...extractedMeters];
    updated[index].status = 'rejected';
    onMetersUpdate(updated);
    onMeterSelect(null);
  };

  const handleApproveMeter = (index: number) => {
    const updated = [...extractedMeters];
    updated[index].status = 'approved';
    onMetersUpdate(updated);
    onMeterSelect(null);
    toast.success(`Approved: ${updated[index].meter_number}`);
  };


  const handleApproveAndSave = async () => {
    const approvedMeters = extractedMeters.filter(m => m.status === 'approved');
    
    if (approvedMeters.length === 0) {
      toast.error('Please approve at least one meter before saving');
      return;
    }

    try {
      // Insert all approved meters with their positions
      const metersToInsert = approvedMeters.map(meter => ({
        site_id: siteId,
        meter_number: meter.meter_number,
        name: meter.name,
        area: meter.area ? parseFloat(meter.area.replace(/[^\d.]/g, '')) : null, // Extract number from "187m²"
        rating: meter.rating,
        cable_specification: meter.cable_specification,
        serial_number: meter.serial_number,
        ct_type: meter.ct_type,
        meter_type: meter.meter_type,
        location: meter.location,
        tariff: meter.tariff,
      }));

      const { data: insertedMeters, error: meterError } = await supabase
        .from("meters")
        .insert(metersToInsert)
        .select();

      if (meterError) throw meterError;

      // Now save meter positions to link them to the schematic
      if (insertedMeters && insertedMeters.length > 0) {
        const positionsToInsert = insertedMeters.map((meter, idx) => {
          const originalMeter = approvedMeters[idx];
          return {
            schematic_id: schematicId,
            meter_id: meter.id,
            x_position: originalMeter.position?.x || 50,
            y_position: originalMeter.position?.y || 50,
            label: originalMeter.name
          };
        });

        const { error: posError } = await supabase
          .from("meter_positions")
          .insert(positionsToInsert);

        if (posError) {
          console.error("Warning: Failed to save meter positions:", posError);
          toast.error("Meters saved but positions could not be linked to schematic");
        }
      }

      toast.success(`Successfully saved ${approvedMeters.length} approved meters with positions`);
      onMetersUpdate([]);
      setConvertedImageUrl(null);
      onMetersExtracted();
    } catch (error) {
      console.error("Error saving meters:", error);
      toast.error("Failed to save meters to database");
    }
  };

  const getMeterStatusColor = (status?: 'pending' | 'approved' | 'rejected') => {
    switch (status) {
      case 'approved': return 'bg-green-500 border-green-600';
      case 'rejected': return 'bg-red-500 border-red-600';
      default: return 'bg-yellow-500 border-yellow-600';
    }
  };

  // Render meter details panel
  const renderMeterDetailsPanel = () => {
    if (selectedMeterIndex === null) return null;

    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Meter #{selectedMeterIndex + 1}: {extractedMeters[selectedMeterIndex].meter_number}</span>
            <div className="flex gap-2">
              {editingIndex !== selectedMeterIndex && (
                <>
                  <Button
                    size="sm"
                    onClick={() => handleEditMeter(selectedMeterIndex)}
                    variant="outline"
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  {extractedMeters[selectedMeterIndex].status !== 'approved' && (
                    <Button
                      size="sm"
                      onClick={() => handleApproveMeter(selectedMeterIndex)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => handleRemoveMeter(selectedMeterIndex)}
                    variant="destructive"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reject
                  </Button>
                </>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {editingIndex === selectedMeterIndex ? (
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
                  type="text"
                  value={editedMeter?.area || ""}
                  onChange={(e) => setEditedMeter(prev => prev ? { ...prev, area: e.target.value } : null)}
                  placeholder="187m²"
                />
              </div>
              <div>
                <Label>Rating</Label>
                <Input
                  value={editedMeter?.rating || ""}
                  onChange={(e) => setEditedMeter(prev => prev ? { ...prev, rating: e.target.value } : null)}
                />
              </div>
              <div className="col-span-2">
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
                    <SelectItem value="council_bulk">Council Bulk</SelectItem>
                    <SelectItem value="check_meter">Check Meter</SelectItem>
                    <SelectItem value="solar">Solar Generation</SelectItem>
                    <SelectItem value="distribution">Distribution</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 flex gap-2">
                <Button onClick={handleSaveEdit} size="sm" className="gap-2">
                  <Check className="h-4 w-4" />
                  Save Changes
                </Button>
                <Button onClick={() => {
                  setEditingIndex(null);
                  setEditedMeter(null);
                }} size="sm" variant="outline">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="font-medium">Name:</span> {extractedMeters[selectedMeterIndex].name}</div>
              <div><span className="font-medium">Area:</span> {extractedMeters[selectedMeterIndex].area}</div>
              <div><span className="font-medium">Rating:</span> {extractedMeters[selectedMeterIndex].rating}</div>
              <div><span className="font-medium">Type:</span> {extractedMeters[selectedMeterIndex].meter_type}</div>
              <div className="col-span-2"><span className="font-medium">Cable:</span> {extractedMeters[selectedMeterIndex].cable_specification}</div>
              <div><span className="font-medium">Serial:</span> {extractedMeters[selectedMeterIndex].serial_number}</div>
              <div><span className="font-medium">CT:</span> {extractedMeters[selectedMeterIndex].ct_type}</div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {isPdf && !convertedImageUrl && (
        <Card className="border-border/50 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-1">Step 1: Convert PDF to Image</h3>
                <p className="text-xs text-muted-foreground">Your schematic is a PDF. Convert it to an image first for meter extraction.</p>
              </div>
            </div>
            <PdfToImageConverter
              pdfUrl={imageUrl}
              onImageGenerated={handleImageGenerated}
            />
          </CardContent>
        </Card>
      )}
      
      {!isDrawingMode && extractedMeters.length === 0 && (!isPdf || convertedImageUrl) && (
        <Card className="border-border/50 bg-green-50/50 dark:bg-green-950/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/40">
                <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-sm mb-1">Ready to Extract Meters</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Click the <span className="font-semibold text-primary">"Draw to Extract"</span> tool button above, 
                  then draw rectangles around each meter box. The AI will automatically extract all meter details.
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Select "Draw to Extract" tool from the toolbar</li>
                  <li>Left click + drag to draw rectangles around meters</li>
                  <li>Review and approve each extracted meter</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {isDrawingMode && extractedMeters.length === 0 && (
        <Card className="border-border/50 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 animate-pulse">
                <Pencil className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-sm mb-1">Draw Mode Active</h3>
                <p className="text-xs text-muted-foreground">
                  Draw tight rectangles around meter label boxes. Each drawn region will be analyzed by AI to extract:
                  NO, NAME, AREA, RATING, CABLE, SERIAL, and CT information.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      <div className="flex items-center justify-between">
        {extractedMeters.length > 0 && (
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              {approvedCount}/{totalCount} approved
            </div>
            <Button 
              onClick={handleApproveAndSave} 
              disabled={approvedCount === 0}
              className="gap-2"
            >
              <Check className="h-4 w-4" />
              Save {approvedCount > 0 ? `${approvedCount} Approved` : 'Approved'} Meter{approvedCount !== 1 ? 's' : ''}
            </Button>
          </div>
        )}
      </div>

      {renderMeterDetailsPanel()}
    </div>
  );
};
