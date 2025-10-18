import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Edit } from "lucide-react";
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
    if ((e.button === 0 || e.button === 1) && !(e.target as HTMLElement).closest('.meter-marker')) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      if (containerRef.current) {
        containerRef.current.style.cursor = 'grabbing';
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
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
              <>
                {/* Meter Extraction Controls */}
                {extractedMeters.length === 0 && (
                  <div className="mb-4">
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
                  </div>
                )}

                {/* Schematic Viewer with Pan/Zoom */}
                <div 
                  ref={containerRef}
                  className="relative overflow-hidden bg-muted/20 rounded-lg cursor-grab select-none"
                  style={{ minHeight: '600px' }}
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
                        transform: extractedMeters.length > 0 ? `scale(${zoom})` : `scale(1)`,
                        transformOrigin: 'center center',
                        transition: 'transform 0.2s ease-out'
                      }}
                    >
                      {schematic.file_type === "application/pdf" ? (
                        convertedImageUrl ? (
                          <>
                            <img
                              src={convertedImageUrl}
                              alt={schematic.name}
                              className="max-w-none pointer-events-none"
                              style={{ minWidth: '1000px', minHeight: '750px' }}
                              draggable={false}
                            />
                            
                            {/* Extracted Meter Markers */}
                            {extractedMeters.map((meter, index) => (
                              <div
                                key={index}
                                className={`meter-marker absolute w-10 h-10 rounded-full ${getMeterStatusColor(meter.status)} border-2 cursor-pointer hover:scale-125 transition-all flex items-center justify-center text-white font-bold text-sm shadow-lg ${
                                  selectedMeterIndex === index ? 'ring-4 ring-blue-500 scale-125' : ''
                                }`}
                                style={{
                                  left: `${meter.position?.x || 0}%`,
                                  top: `${meter.position?.y || 0}%`,
                                  transform: 'translate(-50%, -50%)',
                                  zIndex: selectedMeterIndex === index ? 20 : 10
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMeterSelect(index);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                title={`${meter.meter_number} - Click to review`}
                              >
                                {index + 1}
                              </div>
                            ))}
                          </>
                        ) : (
                          <div className="flex items-center justify-center p-16 bg-background rounded">
                            <div className="text-center">
                              <p className="text-lg font-medium mb-2">PDF Schematic</p>
                              <p className="text-sm text-muted-foreground">
                                Convert PDF to image to extract meters
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
              </>
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
