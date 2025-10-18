import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Edit, Check, X } from "lucide-react";
import { toast } from "sonner";
import SchematicEditor from "@/components/schematic/SchematicEditor";
import { MeterDataExtractor } from "@/components/schematic/MeterDataExtractor";

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

    // Get public URL for the file
    const { data: urlData } = supabase.storage
      .from("schematics")
      .getPublicUrl(data.file_path);

    setImageUrl(urlData.publicUrl);
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
    const newZoom = Math.min(Math.max(0.5, zoom + delta), 3);
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
  };

  useEffect(() => {
    // Reset image loaded state when converted image changes
    if (convertedImageUrl) {
      setImageLoaded(false);
    }
  }, [convertedImageUrl]);

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
      case 'approved': return 'bg-green-500 border-green-600';
      case 'rejected': return 'bg-red-500 border-red-600';
      default: return 'bg-yellow-500 border-yellow-600';
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
            <Button 
              variant={editMode ? "default" : "outline"} 
              size="sm" 
              onClick={() => setEditMode(!editMode)}
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
              />
            ) : (
              <div className="space-y-4">
                {/* Meter Extraction Controls - Only show if no meters extracted yet */}
                {extractedMeters.length === 0 && (
                  <MeterDataExtractor
                    siteId={schematic.site_id}
                    schematicId={id!}
                    imageUrl={imageUrl}
                    onMetersExtracted={fetchMeterPositions}
                    onConvertedImageReady={setConvertedImageUrl}
                    extractedMeters={extractedMeters}
                    onMetersUpdate={setExtractedMeters}
                    selectedMeterIndex={selectedMeterIndex}
                    onMeterSelect={setSelectedMeterIndex}
                  />
                )}

                {/* Status Legend - Show when meters are extracted */}
                {extractedMeters.length > 0 && (
                  <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="text-sm font-medium">Review Extracted Meters:</div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-yellow-500 border-2 border-yellow-600" />
                          <span className="text-xs">Pending</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-green-600" />
                          <span className="text-xs">Approved</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-red-600" />
                          <span className="text-xs">Rejected</span>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground border-l pl-3 ml-2">
                        💡 Drag markers to correct positions
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm text-muted-foreground">
                        Zoom: {Math.round(zoom * 100)}% | Scroll to zoom, Drag to pan
                      </div>
                      <Button size="sm" variant="outline" onClick={handleResetView}>
                        Reset View
                      </Button>
                    </div>
                  </div>
                )}

                {/* Main Schematic View */}
                <div className={extractedMeters.length > 0 ? "grid grid-cols-[1fr_400px] gap-4" : ""}>
                  {/* Schematic with markers */}
                  <div 
                    ref={containerRef}
                    className="relative overflow-hidden bg-muted/20 rounded-lg border-2 border-border/50"
                    style={{ 
                      minHeight: '700px',
                      cursor: extractedMeters.length > 0 ? (isDragging ? 'grabbing' : 'grab') : 'default'
                    }}
                    onWheel={extractedMeters.length > 0 ? handleWheel : undefined}
                    onMouseDown={extractedMeters.length > 0 ? handleMouseDown : undefined}
                    onMouseMove={extractedMeters.length > 0 ? handleMouseMove : undefined}
                    onMouseUp={extractedMeters.length > 0 ? handleMouseUp : undefined}
                    onMouseLeave={extractedMeters.length > 0 ? handleMouseLeave : undefined}
                  >
                    <div 
                      className="absolute inset-0 flex items-center justify-center"
                      style={{
                        transform: extractedMeters.length > 0 ? `translate(${pan.x}px, ${pan.y}px)` : 'none',
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                      }}
                    >
                      <div
                        className="relative"
                        style={{
                          transform: extractedMeters.length > 0 ? `scale(${zoom})` : 'scale(1)',
                          transformOrigin: 'center center',
                          transition: 'transform 0.2s ease-out'
                        }}
                      >
                        {schematic.file_type === "application/pdf" ? (
                          convertedImageUrl ? (
                            <div className="relative inline-block">
                              <img
                                ref={imageRef}
                                src={convertedImageUrl}
                                alt={schematic.name}
                                className="max-w-none pointer-events-none select-none"
                                style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
                                draggable={false}
                                onLoad={() => {
                                  console.log('Image loaded, dimensions:', imageRef.current?.naturalWidth, imageRef.current?.naturalHeight);
                                  setImageLoaded(true);
                                }}
                              />
                              
                              {/* Extracted Meter Markers - positioned relative to image */}
                              {imageLoaded && extractedMeters.map((meter, index) => {
                                return (
                                  <div
                                    key={index}
                                    className={`meter-marker absolute rounded-full border-4 transition-all flex flex-col items-center justify-center text-white font-bold shadow-xl ${
                                      draggedMeterIndex === index ? 'cursor-move scale-110' :
                                      selectedMeterIndex === index 
                                        ? 'ring-4 ring-blue-400 ring-offset-2 cursor-move' 
                                        : 'hover:scale-110 cursor-move'
                                    } ${getMeterStatusColor(meter.status)}`}
                                    style={{
                                      left: `${meter.position?.x || 0}%`,
                                      top: `${meter.position?.y || 0}%`,
                                      width: `${selectedMeterIndex === index ? 64 : 48}px`,
                                      height: `${selectedMeterIndex === index ? 64 : 48}px`,
                                      fontSize: `${selectedMeterIndex === index ? 16 : 14}px`,
                                      transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                                      transformOrigin: 'center',
                                      zIndex: draggedMeterIndex === index ? 100 : selectedMeterIndex === index ? 50 : 30,
                                      pointerEvents: 'auto',
                                      opacity: draggedMeterIndex === index ? 0.8 : 1
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (draggedMeterIndex === null) {
                                        handleMeterSelect(index);
                                      }
                                    }}
                                    onMouseDown={(e) => handleMeterMarkerMouseDown(e, index)}
                                    title={`${meter.meter_number} - ${meter.name} (Drag to reposition)`}
                                  >
                                    <span className="text-xs leading-none mb-0.5">{index + 1}</span>
                                    <span className="text-[8px] leading-none font-mono opacity-90">{meter.meter_number}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="flex items-center justify-center p-16">
                              <div className="text-center text-muted-foreground">
                                <p className="text-lg font-medium mb-2">PDF Schematic</p>
                                <p className="text-sm">
                                  Convert PDF to image above to extract meters
                                </p>
                              </div>
                            </div>
                          )
                        ) : (
                          <>
                            <img
                              src={imageUrl}
                              alt={schematic.name}
                              className="max-w-full h-auto"
                            />
                            
                            {/* Existing Meter Position Markers */}
                            {meterPositions.map((position) => (
                              <div
                                key={position.id}
                                className={`absolute w-6 h-6 rounded-full ${getMeterColor(
                                  position.meters?.meter_type || ""
                                )} border-2 border-white shadow-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-transform`}
                                style={{
                                  left: `${position.x_position}%`,
                                  top: `${position.y_position}%`,
                                  transform: "translate(-50%, -50%)",
                                }}
                                title={`${position.meters?.meter_number} - ${position.label || ""}`}
                              >
                                <span className="text-[8px] font-bold text-white">M</span>
                              </div>
                            ))}
                          </>
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
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <div className="text-muted-foreground text-xs mb-1">Name</div>
                                <div className="font-medium">{extractedMeters[selectedMeterIndex].name}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground text-xs mb-1">Area</div>
                                <div className="font-medium">{extractedMeters[selectedMeterIndex].area}m²</div>
                              </div>
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
      </div>
    </DashboardLayout>
  );
}
