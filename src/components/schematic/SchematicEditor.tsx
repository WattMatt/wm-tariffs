import { useEffect, useRef, useState } from "react";
import { Canvas as FabricCanvas, Circle, Line, Text, FabricImage } from "fabric";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Zap, Link2, Trash2, Move, Upload, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CsvImportDialog from "@/components/site/CsvImportDialog";

interface SchematicEditorProps {
  schematicId: string;
  schematicUrl: string;
  siteId: string;
}

interface MeterPosition {
  id: string;
  meter_id: string;
  x_position: number;
  y_position: number;
  label: string;
}

interface SchematicLine {
  id: string;
  from_x: number;
  from_y: number;
  to_x: number;
  to_y: number;
  color: string;
  stroke_width: number;
}

export default function SchematicEditor({ schematicId, schematicUrl, siteId }: SchematicEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [activeTool, setActiveTool] = useState<"select" | "meter" | "connection">("select");
  const [meterPositions, setMeterPositions] = useState<MeterPosition[]>([]);
  const [lines, setLines] = useState<SchematicLine[]>([]);
  const [meters, setMeters] = useState<any[]>([]);
  const [selectedMeterForConnection, setSelectedMeterForConnection] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddMeterDialogOpen, setIsAddMeterDialogOpen] = useState(false);
  const [pendingMeterPosition, setPendingMeterPosition] = useState<{ x: number; y: number } | null>(null);
  const [isCsvDialogOpen, setIsCsvDialogOpen] = useState(false);
  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);

  useEffect(() => {
    fetchMeters();
    fetchMeterPositions();
    fetchLines();
  }, [schematicId]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 1200,
      height: 800,
      backgroundColor: "#f8f9fa",
    });

    setFabricCanvas(canvas);

    // Load background image
    FabricImage.fromURL(schematicUrl, {
      crossOrigin: 'anonymous'
    }).then((img) => {
      img.scaleToWidth(1200);
      img.selectable = false;
      img.evented = false;
      canvas.add(img);
      canvas.sendObjectToBack(img);
      canvas.renderAll();
    });

    return () => {
      canvas.dispose();
    };
  }, [schematicUrl]);

  useEffect(() => {
    if (!fabricCanvas) return;
    
    // Clear existing objects (except background)
    const objects = fabricCanvas.getObjects();
    objects.forEach(obj => {
      if (obj.type !== 'image') {
        fabricCanvas.remove(obj);
      }
    });

    // Render saved lines
    lines.forEach(line => {
      const fabricLine = new Line([line.from_x, line.from_y, line.to_x, line.to_y], {
        stroke: line.color,
        strokeWidth: line.stroke_width,
        selectable: false,
        evented: false,
      });
      fabricCanvas.add(fabricLine);
    });

    // Render meter positions
    meterPositions.forEach(pos => {
      const meter = meters.find(m => m.id === pos.meter_id);
      const meterType = meter?.meter_type || 'unknown';
      
      let color = '#3b82f6'; // default blue
      if (meterType.includes('bulk')) color = '#ef4444'; // red
      else if (meterType.includes('check')) color = '#f59e0b'; // orange
      else if (meterType.includes('sub')) color = '#10b981'; // green

      const circle = new Circle({
        left: pos.x_position,
        top: pos.y_position,
        fill: color,
        radius: 15,
        originX: 'center',
        originY: 'center',
        hasControls: false,
      });

      const text = new Text(pos.label || meter?.meter_number || 'M', {
        left: pos.x_position,
        top: pos.y_position + 25,
        fontSize: 12,
        fill: '#000',
        originX: 'center',
        selectable: false,
      });

      circle.set('data', { meterId: pos.meter_id, positionId: pos.id });
      
      circle.on('mousedown', () => {
        if (activeTool === 'connection') {
          handleMeterClickForConnection(pos.meter_id, pos.x_position, pos.y_position);
        }
      });

      fabricCanvas.add(circle);
      fabricCanvas.add(text);
    });

    fabricCanvas.renderAll();
  }, [fabricCanvas, meterPositions, lines, meters, activeTool]);

  const fetchMeters = async () => {
    const { data } = await supabase
      .from("meters")
      .select("*")
      .eq("site_id", siteId);
    
    setMeters(data || []);
  };

  const fetchMeterPositions = async () => {
    const { data } = await supabase
      .from("meter_positions")
      .select("*")
      .eq("schematic_id", schematicId);
    
    setMeterPositions(data || []);
  };

  const fetchLines = async () => {
    const { data } = await supabase
      .from("schematic_lines")
      .select("*")
      .eq("schematic_id", schematicId);
    
    setLines(data || []);
  };

  const handleMeterClickForConnection = (meterId: string, x: number, y: number) => {
    if (!selectedMeterForConnection) {
      setSelectedMeterForConnection(meterId);
      toast.info("Select the parent meter to connect to");
    } else {
      // Create connection
      createConnection(selectedMeterForConnection, meterId, x, y);
      setSelectedMeterForConnection(null);
    }
  };

  const createConnection = async (childId: string, parentId: string, toX: number, toY: number) => {
    const childPos = meterPositions.find(p => p.meter_id === childId);
    if (!childPos) return;

    // Save meter connection
    const { error: connError } = await supabase
      .from("meter_connections")
      .insert({
        child_meter_id: childId,
        parent_meter_id: parentId,
        connection_type: 'submeter'
      });

    if (connError) {
      toast.error("Failed to create meter connection");
      return;
    }

    // Save line
    const { error: lineError } = await supabase
      .from("schematic_lines")
      .insert({
        schematic_id: schematicId,
        from_x: childPos.x_position,
        from_y: childPos.y_position,
        to_x: toX,
        to_y: toY,
        color: '#3b82f6',
        stroke_width: 3
      });

    if (!lineError) {
      toast.success("Connection created");
      fetchLines();
    }
  };

  const handleCanvasClick = async (e: any) => {
    if (activeTool !== 'meter') return;

    const pointer = fabricCanvas?.getPointer(e.e);
    if (!pointer) return;

    // Open dialog to create new meter at this position
    setPendingMeterPosition({ x: pointer.x, y: pointer.y });
    setIsAddMeterDialogOpen(true);
  };

  const handleCreateMeter = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!pendingMeterPosition) return;

    const formData = new FormData(e.currentTarget);
    
    // Create the meter first
    const { data: newMeter, error: meterError } = await supabase
      .from("meters")
      .insert({
        site_id: siteId,
        meter_number: formData.get("meter_number") as string,
        name: formData.get("name") as string,
        meter_type: formData.get("meter_type") as string,
        area: formData.get("area") ? parseFloat(formData.get("area") as string) : null,
        rating: formData.get("rating") as string,
        cable_specification: formData.get("cable_specification") as string,
        serial_number: formData.get("serial_number") as string,
        ct_type: formData.get("ct_type") as string,
        location: formData.get("location") as string,
        tariff: formData.get("tariff") as string,
        is_revenue_critical: false,
      })
      .select()
      .single();

    if (meterError || !newMeter) {
      toast.error("Failed to create meter");
      return;
    }

    // Then create the position on schematic
    const { error: posError } = await supabase
      .from("meter_positions")
      .insert({
        schematic_id: schematicId,
        meter_id: newMeter.id,
        x_position: pendingMeterPosition.x,
        y_position: pendingMeterPosition.y,
        label: newMeter.meter_number
      });

    if (!posError) {
      toast.success("Meter created and placed on schematic");
      setIsAddMeterDialogOpen(false);
      setPendingMeterPosition(null);
      fetchMeters();
      fetchMeterPositions();
    } else {
      toast.error("Failed to place meter on schematic");
    }
  };

  useEffect(() => {
    if (!fabricCanvas) return;

    if (activeTool === 'meter') {
      fabricCanvas.on('mouse:down', handleCanvasClick);
    } else {
      fabricCanvas.off('mouse:down', handleCanvasClick);
    }

    return () => {
      fabricCanvas.off('mouse:down', handleCanvasClick);
    };
  }, [fabricCanvas, activeTool, meters, meterPositions]);

  const handleSave = async () => {
    setIsSaving(true);
    
    // Update meter positions based on canvas state
    const objects = fabricCanvas?.getObjects() || [];
    const updates = objects
      .filter(obj => obj.type === 'circle' && obj.get('data'))
      .map(async (obj: any) => {
        const data = obj.get('data');
        return supabase
          .from("meter_positions")
          .update({
            x_position: obj.left,
            y_position: obj.top
          })
          .eq("id", data.positionId);
      });

    await Promise.all(updates);
    toast.success("Schematic saved");
    setIsSaving(false);
  };

  const handleClearLines = async () => {
    const { error } = await supabase
      .from("schematic_lines")
      .delete()
      .eq("schematic_id", schematicId);

    if (!error) {
      toast.success("All connections cleared");
      fetchLines();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <Button
          variant={activeTool === "select" ? "default" : "outline"}
          onClick={() => setActiveTool("select")}
          size="sm"
        >
          <Move className="w-4 h-4 mr-2" />
          Select
        </Button>
        <Button
          variant={activeTool === "meter" ? "default" : "outline"}
          onClick={() => setActiveTool("meter")}
          size="sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Meter
        </Button>
        <Button
          variant={activeTool === "connection" ? "default" : "outline"}
          onClick={() => setActiveTool("connection")}
          size="sm"
        >
          <Link2 className="w-4 h-4 mr-2" />
          Connect
        </Button>
        <div className="flex-1" />
        <Button onClick={handleClearLines} variant="destructive" size="sm">
          <Trash2 className="w-4 h-4 mr-2" />
          Clear Lines
        </Button>
        <Button onClick={handleSave} disabled={isSaving} size="sm">
          <Save className="w-4 h-4 mr-2" />
          Save
        </Button>
      </div>

      <div className="text-sm text-muted-foreground">
        {activeTool === "meter" && "Click on the schematic to place a new meter"}
        {activeTool === "connection" && "Click on two meters to connect them"}
        {activeTool === "select" && "Drag meters to reposition them"}
      </div>

      <div className="flex gap-2">
        <Badge variant="outline">
          <div className="w-3 h-3 rounded-full bg-[#ef4444] mr-2" />
          Bulk Meter
        </Badge>
        <Badge variant="outline">
          <div className="w-3 h-3 rounded-full bg-[#f59e0b] mr-2" />
          Check Meter
        </Badge>
        <Badge variant="outline">
          <div className="w-3 h-3 rounded-full bg-[#10b981] mr-2" />
          Submeter
        </Badge>
        <Badge variant="outline">
          <div className="w-3 h-3 rounded-full bg-[#3b82f6] mr-2" />
          Other
        </Badge>
      </div>

      <div className="border border-border rounded-lg overflow-hidden shadow-lg">
        <canvas ref={canvasRef} />
      </div>

      {meterPositions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {meterPositions.map((pos) => {
            const meter = meters.find(m => m.id === pos.meter_id);
            return (
              <Button
                key={pos.id}
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedMeterId(meter?.id);
                  setIsCsvDialogOpen(true);
                }}
                className="justify-between"
              >
                <span className="font-mono text-xs">{meter?.meter_number}</span>
                <Upload className="w-3 h-3" />
              </Button>
            );
          })}
        </div>
      )}

      {activeTool === 'connection' && selectedMeterForConnection && (
        <div className="p-4 bg-primary/10 rounded-lg">
          <p className="text-sm">
            Connection mode: Select the parent meter to connect to
          </p>
        </div>
      )}

      <Dialog open={isAddMeterDialogOpen} onOpenChange={setIsAddMeterDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Meter to Schematic</DialogTitle>
            <DialogDescription>
              Create a new meter and place it at the selected position
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateMeter} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="meter_number">NO (Meter Number) *</Label>
                <Input id="meter_number" name="meter_number" required placeholder="DB-03" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">NAME *</Label>
                <Input id="name" name="name" required placeholder="ACKERMANS" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="area">AREA (m²) *</Label>
                <Input 
                  id="area" 
                  name="area" 
                  type="number" 
                  step="0.01" 
                  required 
                  placeholder="406" 
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rating">RATING *</Label>
                <Input id="rating" name="rating" required placeholder="100A TP" />
              </div>

              <div className="space-y-2 col-span-2">
                <Label htmlFor="cable_specification">CABLE *</Label>
                <Input 
                  id="cable_specification" 
                  name="cable_specification" 
                  required 
                  placeholder="4C x 50mm² ALU ECC CABLE" 
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="serial_number">SERIAL *</Label>
                <Input id="serial_number" name="serial_number" required placeholder="35777285" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ct_type">CT *</Label>
                <Input id="ct_type" name="ct_type" required placeholder="DOL" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="meter_type">Meter Type *</Label>
                <Select name="meter_type" required>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="council_bulk">Council Bulk Supply</SelectItem>
                    <SelectItem value="check_meter">Check Meter</SelectItem>
                    <SelectItem value="distribution">Distribution Meter</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input id="location" name="location" placeholder="Building A, Floor 2" />
              </div>

              <div className="space-y-2 col-span-2">
                <Label htmlFor="tariff">Tariff</Label>
                <Input id="tariff" name="tariff" placeholder="Business Standard" />
              </div>
            </div>

            <Button type="submit" className="w-full">
              Create Meter & Place on Schematic
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {selectedMeterId && (
        <CsvImportDialog
          isOpen={isCsvDialogOpen}
          onClose={() => {
            setIsCsvDialogOpen(false);
            setSelectedMeterId(null);
          }}
          meterId={selectedMeterId}
          onImportComplete={() => {
            toast.success("Readings imported successfully");
          }}
        />
      )}
    </div>
  );
}
