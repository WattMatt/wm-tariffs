import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Check, X, Edit } from "lucide-react";
import { PdfToImageConverter } from "./PdfToImageConverter";

interface DetectedRectangle {
  id: string;
  position: { x: number; y: number };
  bounds: { width: number; height: number };
  hasData: boolean;
  extractedData?: Partial<ExtractedMeterData>;
  isExtracting?: boolean;
}

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
  detectedRectangles: DetectedRectangle[];
  onRectanglesUpdate: (rectangles: DetectedRectangle[]) => void;
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
  detectedRectangles,
  onRectanglesUpdate
}: MeterDataExtractorProps) => {
  const [isDetecting, setIsDetecting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedMeter, setEditedMeter] = useState<ExtractedMeterData | null>(null);
  const [convertedImageUrl, setConvertedImageUrl] = useState<string | null>(null);
  const [extractionPhase, setExtractionPhase] = useState<'idle' | 'detecting' | 'extracting'>('idle');

  const isPdf = imageUrl.toLowerCase().includes('.pdf');
  const approvedCount = extractedMeters.filter(m => m.status === 'approved').length;
  const totalCount = extractedMeters.length;

  const detectRectangles = async () => {
    if (!convertedImageUrl && isPdf) {
      toast.error('Please convert PDF to image first');
      return;
    }

    setIsDetecting(true);
    setExtractionPhase('detecting');
    
    try {
      const urlToProcess = convertedImageUrl || imageUrl;
      
      const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
        body: { 
          imageUrl: urlToProcess,
          filePath: null,
          mode: 'detect-rectangles'
        }
      });

      if (error) throw new Error(error.message || 'Failed to detect rectangles');
      if (!data || !data.rectangles) throw new Error('No rectangles returned');

      console.log('Detected rectangles:', data.rectangles);
      onRectanglesUpdate(data.rectangles);
      toast.success(`Detected ${data.rectangles.length} meter boxes - click each to extract data`);
    } catch (error) {
      console.error('Error detecting rectangles:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to detect meter boxes');
    } finally {
      setIsDetecting(false);
    }
  };

  const extractSingleMeter = async (rectangleId: string) => {
    const rectangle = detectedRectangles.find(r => r.id === rectangleId);
    if (!rectangle) return;

    // Mark this rectangle as extracting
    const updated = detectedRectangles.map(r => 
      r.id === rectangleId ? { ...r, isExtracting: true } : r
    );
    onRectanglesUpdate(updated);

    try {
      const urlToProcess = convertedImageUrl || imageUrl;
      
      const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
        body: { 
          imageUrl: urlToProcess,
          filePath: null,
          mode: 'extract-single',
          rectangleId,
          rectangleBounds: rectangle.position
        }
      });

      if (error) throw new Error(error.message || 'Failed to extract meter data');
      if (!data || !data.meter) throw new Error('No meter data returned');

      // Update rectangle with extracted data
      const updatedRects = detectedRectangles.map(r => 
        r.id === rectangleId 
          ? { ...r, hasData: true, extractedData: data.meter, isExtracting: false }
          : r
      );
      onRectanglesUpdate(updatedRects);
      
      toast.success(`Extracted data for meter box ${rectangleId}`);
    } catch (error) {
      console.error('Error extracting meter:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to extract meter data');
      
      // Mark as failed
      const updatedRects = detectedRectangles.map(r => 
        r.id === rectangleId 
          ? { ...r, hasData: false, isExtracting: false }
          : r
      );
      onRectanglesUpdate(updatedRects);
    }
  };

  const extractMetersFromSchematic = async () => {
    if (!convertedImageUrl && isPdf) {
      toast.error('Please convert PDF to image first');
      return;
    }

    setIsExtracting(true);
    setExtractionProgress(0);
    
    // Progress simulator
    const progressInterval = setInterval(() => {
      setExtractionProgress(prev => Math.min(prev + 1, 95));
    }, 1000);

    try {
      console.log('Extracting meters from schematic');
      
      // Use converted image if available, otherwise use original
      const urlToProcess = convertedImageUrl || imageUrl;
      
      // Create abort controller with 100 second timeout (slightly longer than edge function's 90s)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.error('Request timeout after 100 seconds');
      }, 100000);

      const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
        body: { 
          imageUrl: urlToProcess,
          filePath: null // We're using data URL now
        }
      });

      clearTimeout(timeoutId);
      clearInterval(progressInterval);
      setExtractionProgress(100);

      if (error) {
        console.error('Edge function error:', error);
        if (error.message?.includes('Failed to send a request')) {
          throw new Error('Connection failed. The extraction service may be busy. Please try again.');
        }
        if (error.message?.includes('aborted')) {
          throw new Error('Extraction timed out after 100 seconds. The schematic may be too complex. Try with a simpler schematic or smaller file.');
        }
        throw new Error(error.message || 'Failed to extract meters');
      }

      if (!data || !data.meters) {
        throw new Error('No meter data returned from extraction service');
      }

      console.log('Extracted meters:', data.meters);
      
      // Validate positions from AI extraction - positions should be 0-100 percentages
      const metersWithPosition = data.meters.map((meter: any, index: number) => {
        let position = meter.position;
        
        // Validate position exists and has proper format
        if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
          console.warn(`⚠️ Meter ${index + 1} (${meter.meter_number}) missing valid position from AI`);
          // Center position as fallback with warning
          position = {
            x: 50,
            y: 50
          };
        }
        
        // Ensure positions are within 0-100 range
        position.x = Math.max(0, Math.min(100, position.x));
        position.y = Math.max(0, Math.min(100, position.y));
        
        return {
          ...meter,
          status: 'pending' as const,
          position
        };
      });
      
      onMetersUpdate(metersWithPosition);
      toast.success(`Extracted ${data.meters.length} meters - review and approve each one`);
    } catch (error) {
      console.error('Error extracting meters:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to extract meter data from schematic';
      toast.error(errorMessage, { duration: 5000 });
    } finally {
      setIsExtracting(false);
      setExtractionProgress(0);
    }
  };

  const handleImageGenerated = (imageDataUrl: string) => {
    console.log('PDF converted to image, ready for extraction');
    setConvertedImageUrl(imageDataUrl);
    onConvertedImageReady?.(imageDataUrl);
    toast.success('PDF converted! Now click "Extract Meters" to analyze.');
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
        area: meter.area,
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
              <div><span className="font-medium">Area:</span> {extractedMeters[selectedMeterIndex].area}m²</div>
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
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <PdfToImageConverter
              pdfUrl={imageUrl}
              onImageGenerated={handleImageGenerated}
            />
          </CardContent>
        </Card>
      )}
      
      <div className="flex items-center justify-between">
        <div className="flex-1 flex gap-2">
          <Button
            onClick={detectRectangles}
            disabled={isDetecting || isExtracting || (isPdf && !convertedImageUrl) || detectedRectangles.length > 0}
            className="gap-2"
          >
            {isDetecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Detecting Meter Boxes...
              </>
            ) : (
              "1. Detect Meter Boxes"
            )}
          </Button>
          
          {detectedRectangles.length > 0 && (
            <Button
              onClick={extractMetersFromSchematic}
              disabled={isExtracting || (isPdf && !convertedImageUrl)}
              variant="secondary"
              className="gap-2"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Extracting All... {extractionProgress}%
                </>
              ) : (
                "Extract All (Legacy)"
              )}
            </Button>
          )}
          {isExtracting && (
            <p className="text-xs text-muted-foreground mt-2">
              AI is analyzing the schematic diagram. This may take up to 90 seconds for complex schematics.
            </p>
          )}
        </div>

        {extractedMeters.length > 0 && (
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              {approvedCount}/{totalCount} approved
            </div>
            <Button 
              onClick={handleApproveAndSave} 
              disabled={approvedCount === 0}
            >
              Save {approvedCount > 0 ? `${approvedCount} Approved` : 'Approved'} Meter{approvedCount !== 1 ? 's' : ''}
            </Button>
          </div>
        )}
      </div>

      {renderMeterDetailsPanel()}
    </div>
  );
};
