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
  phase?: string;
  mccb_size?: number;
  ct_ratio?: string;
  supply_level?: string;
  supply_description?: string;
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
        phase: meter.phase,
        mccb_size: meter.mccb_size,
        ct_ratio: meter.ct_ratio,
        supply_level: meter.supply_level,
        supply_description: meter.supply_description,
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

    </div>
  );
};
