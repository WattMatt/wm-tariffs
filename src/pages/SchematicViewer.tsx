import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Edit, Check, X, MapPin } from "lucide-react";
import { toast } from "sonner";
import SchematicEditor from "@/components/schematic/SchematicEditor";
import { MeterDataExtractor } from "@/components/schematic/MeterDataExtractor";
import { QuickMeterDialog } from "@/components/schematic/QuickMeterDialog";

interface SchematicData {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  file_type: string;
  page_number: number;
  total_pages: number;
  site_id: string;
  sites: { name: string; clients: { name: string } | null } | null;
}

interface MeterPosition {
  id: string;
  x_position: number;
  y_position: number;
  label: string | null;
  meters: {
    meter_number: string;
    meter_type: string;
  } | null;
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
  isDragging?: boolean;
}

interface EditableMeterFields {
  meter_number: string;
  name: string;
  area: string;
  rating: string;
  cable_specification: string;
  serial_number: string;
  ct_type: string;
}

export default function SchematicViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [schematic, setSchematic] = useState<SchematicData | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [meterPositions, setMeterPositions] = useState<MeterPosition[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [extractedMeters, setExtractedMeters] = useState<ExtractedMeterData[]>([]);
  const [selectedMeterIndex, setSelectedMeterIndex] = useState<number | null>(null);
  const [convertedImageUrl, setConvertedImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [draggedMeterIndex, setDraggedMeterIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isEditingMeter, setIsEditingMeter] = useState(false);
  const [editedMeterData, setEditedMeterData] = useState<EditableMeterFields | null>(null);
  const [isPlacingMeter, setIsPlacingMeter] = useState(false);
  const [showQuickMeterDialog, setShowQuickMeterDialog] = useState(false);
  const [clickedPosition, setClickedPosition] = useState<{ x: number; y: number } | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  useEffect(() => {
    if (id) {
      fetchSchematic();
      fetchMeterPositions();
    }
  }, [id]);

  const fetchSchematic = async () => {
    const { data, error } = await supabase
      .from("schematics")
      .select("*, sites(name, clients(name))")
      .eq("id", id)
      .single();

    if (error) {
      toast.error("Failed to load schematic");
      navigate("/schematics");
      return;
    }

    setSchematic(data);

    // Check if this is a PDF with a converted image
    if (data.file_type === "application/pdf" && data.converted_image_path) {
      // Use the converted image
      const { data: imageUrlData } = supabase.storage
        .from("schematics")
        .getPublicUrl(data.converted_image_path);
      
      setConvertedImageUrl(imageUrlData.publicUrl);
      setImageUrl(imageUrlData.publicUrl);
    } else if (data.file_type === "application/pdf" && !data.converted_image_path) {
      // PDF without converted image - trigger conversion
      const { data: pdfUrlData } = supabase.storage
        .from("schematics")
        .getPublicUrl(data.file_path);
      
      setImageUrl(pdfUrlData.publicUrl);
      
      // Auto-convert PDF in background
      convertPdfToImage(data.id, data.file_path);
    } else {
      // Regular image file
      const { data: urlData } = supabase.storage
        .from("schematics")
        .getPublicUrl(data.file_path);

      setImageUrl(urlData.publicUrl);
    }
  };

  const convertPdfToImage = async (schematicId: string, filePath: string) => {
    console.log("Converting PDF to image in browser...");
    setIsConverting(true);
    toast.info("Converting PDF to image...");
    
    try {
      // Download the PDF from storage
      const { data: pdfBlob, error: downloadError } = await supabase
        .storage
        .from('schematics')
        .download(filePath);
      
      if (downloadError || !pdfBlob) {
        throw new Error('Failed to download PDF');
      }

      // Convert blob to array buffer
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Load PDF with PDF.js
      const { getDocument, GlobalWorkerOptions, version } = await import('pdfjs-dist');
      
      // Use the matching worker version
      GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
      
      const loadingTask = getDocument({ data: uint8Array });
      const pdf = await loadingTask.promise;
      
      // Get first page
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2.0 });
      
      // Create canvas
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: false });
      
      if (!context) throw new Error('Could not get canvas context');
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      // Render PDF page to canvas
      await page.render({
        canvasContext: context,
        viewport: viewport,
      } as any).promise;
      
      // Convert canvas to blob with timeout
      const imageBlob = await new Promise<Blob>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Blob conversion timeout')), 10000);
        canvas.toBlob(
          (blob) => {
            clearTimeout(timeout);
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
          },
          'image/png',
          0.95
        );
      });
      
      // Generate unique filename for converted image
      const imagePath = `${filePath.replace('.pdf', '')}_converted.png`;
      
      // Upload converted image to storage
      const { error: uploadError } = await supabase
        .storage
        .from('schematics')
        .upload(imagePath, imageBlob, {
          contentType: 'image/png',
          upsert: true,
        });
      
      if (uploadError) throw uploadError;
      
      // Update schematic record with converted image path
      const { error: updateError } = await supabase
        .from('schematics')
        .update({ converted_image_path: imagePath })
        .eq('id', schematicId);
      
      if (updateError) throw updateError;
      
      toast.success("PDF converted to image successfully!");
      fetchSchematic();
    } catch (error: any) {
      console.error("PDF conversion error:", error);
      toast.error(`Failed to convert PDF: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsConverting(false);
    }
  };

  const fetchMeterPositions = async () => {
    const { data } = await supabase
      .from("meter_positions")
      .select("*, meters(meter_number, meter_type)")
      .eq("schematic_id", id);

    setMeterPositions(data || []);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY * -0.01;
    const newZoom = Math.min(Math.max(0.5, zoom + delta), 10);
    setZoom(newZoom);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only pan if not clicking on a meter marker
    if ((e.button === 0 || e.button === 1) && !(e.target as HTMLElement).closest('.meter-marker')) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      if (containerRef.current) {
        containerRef.current.style.cursor = 'grabbing';
      }
    }
  };

  const handleMeterMarkerMouseDown = (e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return; // Only left click
    e.stopPropagation();
    
    setDraggedMeterIndex(index);
    
    if (imageRef.current) {
      const imageRect = imageRef.current.getBoundingClientRect();
      const meterPos = extractedMeters[index].position || { x: 0, y: 0 };
      
      // Calculate current marker position in pixels
      const markerX = (meterPos.x / 100) * imageRect.width + imageRect.left;
      const markerY = (meterPos.y / 100) * imageRect.height + imageRect.top;
      
      // Store offset from mouse to marker center
      setDragOffset({
        x: e.clientX - markerX,
        y: e.clientY - markerY
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggedMeterIndex !== null && imageRef.current) {
      // Dragging a meter marker
      e.stopPropagation();
      const imageRect = imageRef.current.getBoundingClientRect();
      
      // Calculate new position relative to image
      const newX = ((e.clientX - dragOffset.x - imageRect.left) / imageRect.width) * 100;
      const newY = ((e.clientY - dragOffset.y - imageRect.top) / imageRect.height) * 100;
      
      // Clamp to image bounds
      const clampedX = Math.max(0, Math.min(100, newX));
      const clampedY = Math.max(0, Math.min(100, newY));
      
      const updated = [...extractedMeters];
      updated[draggedMeterIndex] = {
        ...updated[draggedMeterIndex],
        position: { x: clampedX, y: clampedY }
      };
      setExtractedMeters(updated);
    } else if (isDragging) {
      // Panning the view
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    if (draggedMeterIndex !== null) {
      setDraggedMeterIndex(null);
      toast.success('Marker position updated');
    }
    setIsDragging(false);
    if (containerRef.current) {
      containerRef.current.style.cursor = 'grab';
    }
  };

  const handleMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false);
      if (containerRef.current) {
        containerRef.current.style.cursor = 'grab';
      }
    }
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMeterSelect = (index: number) => {
    setSelectedMeterIndex(index);
    setIsEditingMeter(false);
    setEditedMeterData(null);
  };

  const handleStartEdit = () => {
    if (selectedMeterIndex !== null) {
      const meter = extractedMeters[selectedMeterIndex];
      setEditedMeterData({
        meter_number: meter.meter_number,
        name: meter.name,
        area: meter.area?.toString() || '',
        rating: meter.rating,
        cable_specification: meter.cable_specification,
        serial_number: meter.serial_number,
        ct_type: meter.ct_type,
      });
      setIsEditingMeter(true);
    }
  };

  const handleSaveEdit = () => {
    if (selectedMeterIndex !== null && editedMeterData) {
      const updated = [...extractedMeters];
      updated[selectedMeterIndex] = {
        ...updated[selectedMeterIndex],
        meter_number: editedMeterData.meter_number,
        name: editedMeterData.name,
        area: editedMeterData.area ? parseFloat(editedMeterData.area) : null,
        rating: editedMeterData.rating,
        cable_specification: editedMeterData.cable_specification,
        serial_number: editedMeterData.serial_number,
        ct_type: editedMeterData.ct_type,
      };
      setExtractedMeters(updated);
      setIsEditingMeter(false);
      setEditedMeterData(null);
      toast.success('Meter data updated');
    }
  };

  const handleCancelEdit = () => {
    setIsEditingMeter(false);
    setEditedMeterData(null);
  };

  const handleSchematicClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPlacingMeter || !imageRef.current) return;
    
    // Don't trigger if clicking on existing markers
    if ((e.target as HTMLElement).closest('.meter-marker')) return;
    
    const imageRect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - imageRect.left) / imageRect.width) * 100;
    const y = ((e.clientY - imageRect.top) / imageRect.height) * 100;
    
    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(100, x));
    const clampedY = Math.max(0, Math.min(100, y));
    
    setClickedPosition({ x: clampedX, y: clampedY });
    setShowQuickMeterDialog(true);
  };

  const handleMeterPlaced = () => {
    fetchMeterPositions();
    setIsPlacingMeter(false);
  };

  useEffect(() => {
    // Reset image loaded state when converted image changes
    if (convertedImageUrl) {
      setImageLoaded(false);
      console.log('🔄 Converted image URL changed, resetting imageLoaded to false');
    }
  }, [convertedImageUrl]);

  // Ensure markers show when extractedMeters updates
  useEffect(() => {
    if (extractedMeters.length > 0) {
      console.log('📍 Extracted meters updated:', extractedMeters.length, 'meters');
      console.log('🖼️ Image loaded state:', imageLoaded);
      console.log('🎯 First meter position:', extractedMeters[0]?.position);
    }
  }, [extractedMeters, imageLoaded]);

  const getMeterColor = (type: string) => {
    switch (type) {
      case "council_bulk":
        return "bg-primary";
      case "check_meter":
        return "bg-warning";
      case "distribution":
        return "bg-accent";
      default:
        return "bg-muted";
    }
  };

  const getMeterStatusColor = (status?: 'pending' | 'approved' | 'rejected') => {
    switch (status) {
      case 'approved': return 'bg-green-500 border-green-700 shadow-green-500/50';
      case 'rejected': return 'bg-red-500 border-red-700 shadow-red-500/50';
      default: return 'bg-yellow-500 border-yellow-700 shadow-yellow-500/50';
    }
  };

  if (!schematic) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Loading schematic...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate("/schematics")}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{schematic.name}</h1>
              <p className="text-sm text-muted-foreground">
                {schematic.sites?.name} {schematic.sites?.clients && `• ${schematic.sites.clients.name}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!editMode && (
              <Button
                variant={isPlacingMeter ? "default" : "outline"}
                size="sm"
                onClick={() => setIsPlacingMeter(!isPlacingMeter)}
              >
                <MapPin className="w-4 h-4 mr-2" />
                {isPlacingMeter ? "Cancel Placement" : "Place Meter"}
              </Button>
            )}
            <Button 
              variant={editMode ? "default" : "outline"} 
              size="sm" 
              onClick={() => {
                setEditMode(!editMode);
                setIsPlacingMeter(false);
              }}
            >
              <Edit className="w-4 h-4 mr-2" />
              {editMode ? "View Mode" : "Edit Mode"}
            </Button>
            {!editMode && extractedMeters.length === 0 && (
              <>
                <div className="text-xs text-muted-foreground">
                  Zoom: {Math.round(zoom * 100)}%
                </div>
                <Button variant="outline" size="sm" onClick={handleResetView}>
                  Reset View
                </Button>
              </>
            )}
          </div>
        </div>

        {schematic.description && (
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{schematic.description}</p>
            </CardContent>
          </Card>
        )}

        <Card className="border-border/50">
          <CardContent className="p-6">
            {editMode ? (
              <SchematicEditor
                schematicId={id!}
                schematicUrl={imageUrl}
                siteId={schematic.site_id}
                extractedMeters={extractedMeters}
                onExtractedMetersUpdate={setExtractedMeters}
              />
            ) : (
              <div className="space-y-4">
                {/* Placement Mode Banner */}
                {isPlacingMeter && (
                  <div className="bg-primary/10 border-2 border-primary rounded-lg p-4 text-center">
                    <MapPin className="w-6 h-6 mx-auto mb-2 text-primary" />
                    <p className="font-semibold text-primary">Click anywhere on the schematic to place a meter</p>
                    <p className="text-sm text-muted-foreground mt-1">You can then select an existing meter or create a new one</p>
                  </div>
                )}

                {/* Main Schematic View */}
                <div className={meterPositions.length > 0 ? "grid grid-cols-[1fr_400px] gap-4" : ""}>
                  {/* Schematic with markers */}
                  <div 
                    ref={containerRef}
                    className="relative overflow-hidden bg-muted/20 rounded-lg border-2 border-border/50"
                    style={{ 
                      minHeight: '700px',
                      cursor: isPlacingMeter ? 'crosshair' : 'default'
                    }}
                    onClick={handleSchematicClick}
                  >
                    <div 
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <div className="relative">
                        {/* Show converted image or original image */}
                        {convertedImageUrl || schematic.file_type !== "application/pdf" ? (
                          <div className="relative inline-block">
                            <img
                              ref={imageRef}
                              src={convertedImageUrl || imageUrl}
                              alt={schematic.name}
                              className="max-w-full h-auto"
                              draggable={false}
                            />
                            
                            {/* Existing Meter Position Markers */}
                            {meterPositions.map((position) => (
                              <div
                                key={position.id}
                                className="meter-marker absolute rounded-full border-3 border-white shadow-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-all"
                                style={{
                                  left: `${position.x_position}%`,
                                  top: `${position.y_position}%`,
                                  transform: "translate(-50%, -50%)",
                                  width: '28px',
                                  height: '28px',
                                  backgroundColor: position.meters?.meter_type === 'council_bulk' ? 'hsl(var(--primary))' :
                                                  position.meters?.meter_type === 'check_meter' ? '#f59e0b' :
                                                  '#8b5cf6',
                                  zIndex: 30,
                                }}
                                title={`${position.meters?.meter_number} - ${position.label || ""}`}
                              >
                                <span className="text-[9px] font-bold text-white leading-none">{position.meters?.meter_number?.substring(0, 3)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center p-16">
                            <div className="text-center">
                              <div className="mb-4 text-6xl">📄</div>
                              <p className="text-lg font-medium mb-2">Converting PDF...</p>
                              <p className="text-sm text-muted-foreground">
                                This may take a few moments for large files
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Meter Details Side Panel - Only show when meters extracted */}
                  {extractedMeters.length > 0 && (
                    <div className="space-y-4">
                      {selectedMeterIndex !== null ? (
                        <Card className="border-border/50 sticky top-4">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center justify-between">
                              <span>Meter #{selectedMeterIndex + 1}</span>
                              <Badge 
                                variant={
                                  extractedMeters[selectedMeterIndex].status === 'approved' ? 'default' : 
                                  extractedMeters[selectedMeterIndex].status === 'rejected' ? 'destructive' : 
                                  'secondary'
                                }
                              >
                                {extractedMeters[selectedMeterIndex].status || 'pending'}
                              </Badge>
                            </CardTitle>
                            <CardDescription className="font-mono text-sm">
                              {extractedMeters[selectedMeterIndex].meter_number}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {isEditingMeter && editedMeterData ? (
                              // Edit Mode
                              <div className="space-y-3">
                                <div>
                                  <Label className="text-xs">Meter Number</Label>
                                  <Input
                                    value={editedMeterData.meter_number}
                                    onChange={(e) => setEditedMeterData({ ...editedMeterData, meter_number: e.target.value })}
                                    className="text-sm"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">Name</Label>
                                  <Input
                                    value={editedMeterData.name}
                                    onChange={(e) => setEditedMeterData({ ...editedMeterData, name: e.target.value })}
                                    className="text-sm"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label className="text-xs">Area (m²)</Label>
                                    <Input
                                      type="number"
                                      value={editedMeterData.area}
                                      onChange={(e) => setEditedMeterData({ ...editedMeterData, area: e.target.value })}
                                      className="text-sm"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">Rating</Label>
                                    <Input
                                      value={editedMeterData.rating}
                                      onChange={(e) => setEditedMeterData({ ...editedMeterData, rating: e.target.value })}
                                      className="text-sm"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <Label className="text-xs">Cable Specification</Label>
                                  <Input
                                    value={editedMeterData.cable_specification}
                                    onChange={(e) => setEditedMeterData({ ...editedMeterData, cable_specification: e.target.value })}
                                    className="text-sm"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label className="text-xs">Serial Number</Label>
                                    <Input
                                      value={editedMeterData.serial_number}
                                      onChange={(e) => setEditedMeterData({ ...editedMeterData, serial_number: e.target.value })}
                                      className="text-sm"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">CT Type</Label>
                                    <Input
                                      value={editedMeterData.ct_type}
                                      onChange={(e) => setEditedMeterData({ ...editedMeterData, ct_type: e.target.value })}
                                      className="text-sm"
                                    />
                                  </div>
                                </div>
                                <div className="flex gap-2 pt-2">
                                  <Button onClick={handleSaveEdit} size="sm" className="flex-1">
                                    <Check className="h-4 w-4 mr-1" />
                                    Save
                                  </Button>
                                  <Button onClick={handleCancelEdit} size="sm" variant="outline" className="flex-1">
                                    <X className="h-4 w-4 mr-1" />
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              // View Mode
                              <>
                            {/* Structured meter info table like reference image */}
                            <div className="border border-border rounded-lg overflow-hidden">
                              <div className="grid grid-cols-[120px_1fr]">
                                <div className="bg-muted px-3 py-2 border-b border-r border-border font-semibold text-sm">NO:</div>
                                <div className="px-3 py-2 border-b border-border font-mono text-sm">{extractedMeters[selectedMeterIndex].meter_number}</div>
                                
                                <div className="bg-muted px-3 py-2 border-b border-r border-border font-semibold text-sm">NAME:</div>
                                <div className="px-3 py-2 border-b border-border text-sm font-medium">{extractedMeters[selectedMeterIndex].name}</div>
                                
                                <div className="bg-muted px-3 py-2 border-b border-r border-border font-semibold text-sm">AREA:</div>
                                <div className="px-3 py-2 border-b border-border text-sm">{extractedMeters[selectedMeterIndex].area ? `${extractedMeters[selectedMeterIndex].area}m²` : 'N/A'}</div>
                                
                                <div className="bg-muted px-3 py-2 border-b border-r border-border font-semibold text-sm">RATING:</div>
                                <div className="px-3 py-2 border-b border-border text-sm">{extractedMeters[selectedMeterIndex].rating || 'N/A'}</div>
                                
                                <div className="bg-muted px-3 py-2 border-b border-r border-border font-semibold text-sm">CABLE:</div>
                                <div className="px-3 py-2 border-b border-border text-sm">{extractedMeters[selectedMeterIndex].cable_specification || 'N/A'}</div>
                                
                                <div className="bg-muted px-3 py-2 border-b border-r border-border font-semibold text-sm">SERIAL:</div>
                                <div className="px-3 py-2 border-b border-border font-mono text-sm">{extractedMeters[selectedMeterIndex].serial_number || 'N/A'}</div>
                                
                                <div className="bg-muted px-3 py-2 border-r border-border font-semibold text-sm">CT:</div>
                                <div className="px-3 py-2 text-sm">{extractedMeters[selectedMeterIndex].ct_type || 'N/A'}</div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <div className="text-muted-foreground text-xs mb-1">Rating</div>
                                <div className="font-medium">{extractedMeters[selectedMeterIndex].rating}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground text-xs mb-1">Type</div>
                                <div className="font-medium">{extractedMeters[selectedMeterIndex].meter_type}</div>
                              </div>
                              <div className="col-span-2">
                                <div className="text-muted-foreground text-xs mb-1">Cable</div>
                                <div className="font-medium text-xs">{extractedMeters[selectedMeterIndex].cable_specification}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground text-xs mb-1">Serial</div>
                                <div className="font-medium">{extractedMeters[selectedMeterIndex].serial_number}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground text-xs mb-1">CT Type</div>
                                <div className="font-medium">{extractedMeters[selectedMeterIndex].ct_type}</div>
                              </div>
                            </div>

                            <div className="flex flex-col gap-2 pt-2">
                              <Button
                                onClick={handleStartEdit}
                                variant="outline"
                                size="sm"
                                className="w-full"
                              >
                                <Edit className="h-4 w-4 mr-2" />
                                Edit Meter Data
                              </Button>
                              {extractedMeters[selectedMeterIndex].status !== 'approved' && (
                                <Button
                                  onClick={() => {
                                    const updated = [...extractedMeters];
                                    updated[selectedMeterIndex].status = 'approved';
                                    setExtractedMeters(updated);
                                    toast.success(`Approved: ${updated[selectedMeterIndex].meter_number}`);
                                  }}
                                  className="w-full bg-green-600 hover:bg-green-700"
                                  size="sm"
                                >
                                  <Check className="h-4 w-4 mr-2" />
                                  Approve Meter
                                </Button>
                              )}
                              <Button
                                onClick={() => {
                                  const updated = [...extractedMeters];
                                  updated[selectedMeterIndex].status = 'rejected';
                                  setExtractedMeters(updated);
                                  setSelectedMeterIndex(null);
                                  toast.error(`Rejected: ${updated[selectedMeterIndex].meter_number}`);
                                }}
                                variant="destructive"
                                size="sm"
                                className="w-full"
                              >
                                <X className="h-4 w-4 mr-2" />
                                Reject Meter
                              </Button>
                            </div>
                              </>
                            )}
                          </CardContent>
                        </Card>
                      ) : (
                        <Card className="border-border/50">
                          <CardContent className="p-8 text-center text-muted-foreground">
                            <p className="text-sm">Click on a meter marker to review details</p>
                          </CardContent>
                        </Card>
                      )}

                      {/* Summary Card */}
                      <Card className="border-border/50">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm">Progress</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total Meters</span>
                            <span className="font-medium">{extractedMeters.length}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Approved</span>
                            <span className="font-medium text-green-600">
                              {extractedMeters.filter(m => m.status === 'approved').length}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Rejected</span>
                            <span className="font-medium text-red-600">
                              {extractedMeters.filter(m => m.status === 'rejected').length}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {meterPositions.length > 0 && (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Mapped Meters</CardTitle>
              <CardDescription>
                {meterPositions.length} meter{meterPositions.length !== 1 ? "s" : ""} linked to
                this schematic
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {meterPositions.map((position) => (
                  <div
                    key={position.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                  >
                    <div
                      className={`w-3 h-3 rounded-full ${getMeterColor(
                        position.meters?.meter_type || ""
                      )}`}
                    />
                    <div>
                      <p className="font-mono text-sm font-medium">
                        {position.meters?.meter_number}
                      </p>
                      {position.label && (
                        <p className="text-xs text-muted-foreground">{position.label}</p>
                      )}
                     </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Meter Placement Dialog */}
        {clickedPosition && (
          <QuickMeterDialog
            open={showQuickMeterDialog}
            onClose={() => {
              setShowQuickMeterDialog(false);
              setClickedPosition(null);
            }}
            siteId={schematic.site_id}
            schematicId={id!}
            position={clickedPosition}
            onMeterPlaced={handleMeterPlaced}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
