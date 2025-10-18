import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Check, X, Edit } from "lucide-react";
import { PdfToImageConverter } from "./PdfToImageConverter";

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
}

export const MeterDataExtractor = ({ siteId, schematicId, imageUrl, onMetersExtracted }: MeterDataExtractorProps) => {
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedMeters, setExtractedMeters] = useState<ExtractedMeterData[]>([]);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedMeter, setEditedMeter] = useState<ExtractedMeterData | null>(null);
  const [convertedImageUrl, setConvertedImageUrl] = useState<string | null>(null);
  const [selectedMeterIndex, setSelectedMeterIndex] = useState<number | null>(null);

  const isPdf = imageUrl.toLowerCase().includes('.pdf');
  
  const approvedCount = extractedMeters.filter(m => m.status === 'approved').length;
  const totalCount = extractedMeters.length;

  const extractMetersFromSchematic = async () => {
    if (!convertedImageUrl && isPdf) {
      toast.error('Please convert PDF to image first');
      return;
    }

    setIsExtracting(true);
    try {
      console.log('Extracting meters from schematic');
      
      // Use converted image if available, otherwise use original
      const urlToProcess = convertedImageUrl || imageUrl;
      
      const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
        body: { 
          imageUrl: urlToProcess,
          filePath: null // We're using data URL now
        }
      });

      if (error) {
        console.error('Edge function error:', error);
        throw error;
      }

      if (!data || !data.meters) {
        throw new Error('No meter data returned');
      }

      console.log('Extracted meters:', data.meters);
      
      // Distribute meters across the schematic in a grid pattern for visual placement
      const metersWithPosition = data.meters.map((meter: any, index: number) => {
        const cols = Math.ceil(Math.sqrt(data.meters.length));
        const row = Math.floor(index / cols);
        const col = index % cols;
        
        return {
          ...meter,
          status: 'pending' as const,
          position: {
            x: 10 + (col * (80 / cols)),
            y: 10 + (row * (80 / (Math.ceil(data.meters.length / cols))))
          }
        };
      });
      
      setExtractedMeters(metersWithPosition);
      setShowApprovalDialog(true);
      toast.success(`Extracted ${data.meters.length} meters - review and approve each one`);
    } catch (error) {
      console.error('Error extracting meters:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to extract meter data from schematic');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleImageGenerated = (imageDataUrl: string) => {
    console.log('PDF converted to image, ready for extraction');
    setConvertedImageUrl(imageDataUrl);
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
      setExtractedMeters(updated);
      setEditingIndex(null);
      setEditedMeter(null);
    }
  };

  const handleRemoveMeter = (index: number) => {
    const updated = [...extractedMeters];
    updated[index].status = 'rejected';
    setExtractedMeters(updated);
    setSelectedMeterIndex(null);
  };

  const handleApproveMeter = (index: number) => {
    const updated = [...extractedMeters];
    updated[index].status = 'approved';
    setExtractedMeters(updated);
    setSelectedMeterIndex(null);
    toast.success(`Approved: ${updated[index].meter_number}`);
  };

  const handleSelectMeter = (index: number) => {
    setSelectedMeterIndex(index);
    setEditingIndex(null);
    setEditedMeter(null);
  };

  const handleApproveAndSave = async () => {
    const approvedMeters = extractedMeters.filter(m => m.status === 'approved');
    
    if (approvedMeters.length === 0) {
      toast.error('Please approve at least one meter before saving');
      return;
    }

    try {
      // Insert all approved meters
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

      const { error } = await supabase
        .from("meters")
        .insert(metersToInsert);

      if (error) throw error;

      toast.success(`Successfully saved ${approvedMeters.length} approved meters`);
      setShowApprovalDialog(false);
      setExtractedMeters([]);
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
    <>
      {isPdf && !convertedImageUrl && (
        <PdfToImageConverter
          pdfUrl={imageUrl}
          onImageGenerated={handleImageGenerated}
        />
      )}
      
      <Button
        onClick={extractMetersFromSchematic}
        disabled={isExtracting || (isPdf && !convertedImageUrl)}
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
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Review Extracted Meters ({approvedCount}/{totalCount} approved)
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 grid grid-cols-2 gap-4 overflow-hidden">
            {/* Left side: Visual schematic with markers */}
            <div className="space-y-2 flex flex-col">
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-yellow-500 border-2 border-yellow-600" />
                  <span>Pending</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-green-600" />
                  <span>Approved</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-red-600" />
                  <span>Rejected</span>
                </div>
              </div>
              
              <div className="relative flex-1 border rounded-lg overflow-auto bg-muted/20">
                {convertedImageUrl && (
                  <>
                    <img 
                      src={convertedImageUrl} 
                      alt="Schematic" 
                      className="w-full h-auto"
                    />
                    
                    {/* Meter markers */}
                    {extractedMeters.map((meter, index) => (
                      <div
                        key={index}
                        className={`absolute w-8 h-8 rounded-full ${getMeterStatusColor(meter.status)} border-2 cursor-pointer hover:scale-125 transition-transform flex items-center justify-center text-white font-bold text-sm shadow-lg ${
                          selectedMeterIndex === index ? 'ring-4 ring-blue-500' : ''
                        }`}
                        style={{
                          left: `${meter.position?.x || 0}%`,
                          top: `${meter.position?.y || 0}%`,
                          transform: 'translate(-50%, -50%)'
                        }}
                        onClick={() => handleSelectMeter(index)}
                        title={meter.meter_number}
                      >
                        {index + 1}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* Right side: Meter details */}
            <div className="flex flex-col gap-2 overflow-auto">
              {selectedMeterIndex !== null ? (
                <div className="border rounded-lg p-4 space-y-4 bg-background">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">
                      Meter #{selectedMeterIndex + 1}: {extractedMeters[selectedMeterIndex].meter_number}
                    </h3>
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
                  </div>

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
                </div>
              ) : (
                <div className="border rounded-lg p-8 text-center text-muted-foreground">
                  Click on a numbered marker on the schematic to review meter details
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {approvedCount > 0 && `${approvedCount} meter${approvedCount !== 1 ? 's' : ''} approved`}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => {
                setShowApprovalDialog(false);
                setExtractedMeters([]);
                setConvertedImageUrl(null);
              }}>
                Cancel
              </Button>
              <Button 
                onClick={handleApproveAndSave} 
                disabled={approvedCount === 0}
              >
                Save {approvedCount > 0 ? `${approvedCount} Approved` : 'Approved'} Meter{approvedCount !== 1 ? 's' : ''}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
