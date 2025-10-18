import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { toast } from "sonner";

interface SchematicData {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  file_type: string;
  page_number: number;
  total_pages: number;
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

export default function SchematicViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [schematic, setSchematic] = useState<SchematicData | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [meterPositions, setMeterPositions] = useState<MeterPosition[]>([]);
  const [zoom, setZoom] = useState(100);

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

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 20, 200));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 20, 50));
  };

  const handleResetZoom = () => {
    setZoom(100);
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
            <Button variant="outline" size="sm" onClick={handleZoomOut}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Badge variant="outline" className="px-4">
              {zoom}%
            </Badge>
            <Button variant="outline" size="sm" onClick={handleZoomIn}>
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleResetZoom}>
              <Maximize2 className="w-4 h-4" />
            </Button>
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
            <div className="relative overflow-auto bg-muted/20 rounded-lg">
              <div
                className="relative inline-block"
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: "top left",
                }}
              >
                {schematic.file_type === "application/pdf" ? (
                  <div className="flex items-center justify-center p-16 bg-background rounded">
                    <div className="text-center">
                      <p className="text-lg font-medium mb-2">PDF Viewer</p>
                      <p className="text-sm text-muted-foreground mb-4">
                        PDF files require a specialized viewer
                      </p>
                      <Button
                        onClick={() => window.open(imageUrl, "_blank")}
                        variant="outline"
                      >
                        Open in New Tab
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <img
                      src={imageUrl}
                      alt={schematic.name}
                      className="max-w-full h-auto"
                    />
                    
                    {/* Meter Position Markers */}
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
