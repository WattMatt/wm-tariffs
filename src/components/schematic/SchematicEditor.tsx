import { useEffect, useRef, useState } from "react";
import { Canvas as FabricCanvas, Circle, Line, Text, FabricImage, Rect } from "fabric";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Zap, Link2, Trash2, Move, Upload, Plus, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CsvImportDialog from "@/components/site/CsvImportDialog";
import { MeterDataExtractor } from "./MeterDataExtractor";

interface SchematicEditorProps {
  schematicId: string;
  schematicUrl: string;
  siteId: string;
  extractedMeters?: any[];
  onExtractedMetersUpdate?: (meters: any[]) => void;
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

export default function SchematicEditor({ 
  schematicId, 
  schematicUrl, 
  siteId, 
  extractedMeters: propExtractedMeters = [],
  onExtractedMetersUpdate 
}: SchematicEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [activeTool, setActiveTool] = useState<"select" | "meter" | "connection" | "move">("select");
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawnRegions, setDrawnRegions] = useState<any[]>([]);
  const [meterPositions, setMeterPositions] = useState<MeterPosition[]>([]);
  const [drawingRect, setDrawingRect] = useState<any>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStartPoint, setDrawStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [lines, setLines] = useState<SchematicLine[]>([]);
  const [meters, setMeters] = useState<any[]>([]);
  const [selectedMeterForConnection, setSelectedMeterForConnection] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddMeterDialogOpen, setIsAddMeterDialogOpen] = useState(false);
  const [pendingMeterPosition, setPendingMeterPosition] = useState<{ x: number; y: number } | null>(null);
  const [isCsvDialogOpen, setIsCsvDialogOpen] = useState(false);
  const [extractedMeters, setExtractedMeters] = useState<any[]>(propExtractedMeters);

  // Sync extracted meters from props
  useEffect(() => {
    setExtractedMeters(propExtractedMeters);
  }, [propExtractedMeters]);
  const [selectedMeterIndex, setSelectedMeterIndex] = useState<number | null>(null);
  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [detectedRectangles, setDetectedRectangles] = useState<any[]>([]);

  useEffect(() => {
    fetchMeters();
    fetchMeterPositions();
    fetchLines();
  }, [schematicId]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 1400,
      height: 900,
      backgroundColor: "#f8f9fa",
    });

    // Enable mouse wheel zoom
    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let newZoom = canvas.getZoom();
      newZoom *= 0.999 ** delta;
      if (newZoom > 10) newZoom = 10;
      if (newZoom < 0.5) newZoom = 0.5;
      
      const pointer = canvas.getPointer(opt.e);
      canvas.zoomToPoint(pointer, newZoom);
      setZoom(newZoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Enable panning with click + drag (when not clicking on objects or in select mode)
    let isPanningLocal = false;
    let lastX = 0;
    let lastY = 0;

    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent;
      const target = opt.target;
      
      // Handle drawing mode for regions - ONLY in drawing mode
      if (isDrawingMode && evt.button === 0) {
        const pointer = canvas.getPointer(opt.e);
        setIsDrawing(true);
        setDrawStartPoint({ x: pointer.x, y: pointer.y });
        
        const rect = new Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: 'rgba(59, 130, 246, 0.2)',
          stroke: '#3b82f6',
          strokeWidth: 2,
          selectable: false,
          evented: false,
        });
        
        canvas.add(rect);
        setDrawingRect(rect);
        canvas.selection = false;
        return;
      }
      
      // Only allow panning when NOT in drawing mode
      if (!isDrawingMode) {
        // Pan with middle/right mouse button, or left click on empty space
        if ((evt.button === 0 && !target) || evt.button === 1 || evt.button === 2) {
          isPanningLocal = true;
          lastX = evt.clientX;
          lastY = evt.clientY;
          canvas.selection = false;
          canvas.defaultCursor = 'grabbing';
        }
      }
    });

    canvas.on('mouse:move', (opt) => {
      // Handle drawing mode - takes priority
      if (isDrawing && drawingRect && drawStartPoint) {
        const pointer = canvas.getPointer(opt.e);
        const width = pointer.x - drawStartPoint.x;
        const height = pointer.y - drawStartPoint.y;
        
        if (width < 0) {
          drawingRect.set({ left: pointer.x });
        }
        if (height < 0) {
          drawingRect.set({ top: pointer.y });
        }
        
        drawingRect.set({
          width: Math.abs(width),
          height: Math.abs(height)
        });
        
        canvas.renderAll();
        return;
      }
      
      // Only allow panning when not in drawing mode
      if (isPanningLocal && !isDrawingMode) {
        const evt = opt.e as MouseEvent;
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] += evt.clientX - lastX;
          vpt[5] += evt.clientY - lastY;
          canvas.requestRenderAll();
          lastX = evt.clientX;
          lastY = evt.clientY;
        }
      }
    });

    canvas.on('mouse:up', async () => {
      // Handle drawing mode completion
      if (isDrawing && drawingRect && drawStartPoint) {
        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();
        
        const left = drawingRect.left || 0;
        const top = drawingRect.top || 0;
        const width = drawingRect.width || 0;
        const height = drawingRect.height || 0;
        
        // Only extract if region is large enough (at least 20x20 pixels)
        if (width > 20 && height > 20) {
          const region = {
            x: (left / canvasWidth) * 100,
            y: (top / canvasHeight) * 100,
            width: (width / canvasWidth) * 100,
            height: (height / canvasHeight) * 100
          };
          
          // Extract meter data from this region
          try {
            toast.info('Extracting meter data from selected region...');
            
            const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
              body: { 
                imageUrl: schematicUrl,
                filePath: null,
                mode: 'extract-region',
                region
              }
            });
            
            if (error) throw error;
            
            if (data && data.meter) {
              // Add extracted meter to the list with position at center of drawn region
              const newMeter = {
                ...data.meter,
                status: 'pending' as const,
                position: {
                  x: region.x + (region.width / 2),
                  y: region.y + (region.height / 2)
                }
              };
              
              const updatedMeters = [...extractedMeters, newMeter];
              setExtractedMeters(updatedMeters);
              if (onExtractedMetersUpdate) {
                onExtractedMetersUpdate(updatedMeters);
              }
              toast.success(`Extracted meter: ${data.meter.meter_number}`);
            }
          } catch (error) {
            console.error('Error extracting from region:', error);
            toast.error('Failed to extract meter data from region');
          }
        } else {
          toast.error('Region too small - draw a larger area around the meter');
        }
        
        // Clean up drawing
        canvas.remove(drawingRect);
        setDrawingRect(null);
        setIsDrawing(false);
        setDrawStartPoint(null);
        canvas.renderAll();
        return;
      }
      
      if (isPanningLocal) {
        isPanningLocal = false;
        canvas.selection = true;
        canvas.defaultCursor = 'grab';
      }
    });

    // Set default cursor to grab (or crosshair in drawing mode)
    canvas.defaultCursor = isDrawingMode ? 'crosshair' : 'grab';
    canvas.hoverCursor = isDrawingMode ? 'crosshair' : 'grab';

    // Prevent context menu on right click
    canvas.getElement().addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    setFabricCanvas(canvas);

    // Load background image
    FabricImage.fromURL(schematicUrl, {
      crossOrigin: 'anonymous'
    }).then((img) => {
      // Resize canvas to match image aspect ratio, maintaining max dimensions
      const maxWidth = 1400;
      const maxHeight = 900;
      const imgWidth = img.width!;
      const imgHeight = img.height!;
      
      const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
      const canvasWidth = imgWidth * scale;
      const canvasHeight = imgHeight * scale;
      
      canvas.setDimensions({ width: canvasWidth, height: canvasHeight });
      
      img.scale(scale);
      img.set({ left: 0, top: 0 });
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

  // Update cursor when drawing mode changes
  useEffect(() => {
    if (fabricCanvas) {
      fabricCanvas.defaultCursor = isDrawingMode ? 'crosshair' : 'grab';
      fabricCanvas.hoverCursor = isDrawingMode ? 'crosshair' : 'grab';
    }
  }, [isDrawingMode, fabricCanvas]);

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

    // Render extracted meters (from AI extraction)
    extractedMeters.forEach((meter, index) => {
      if (!meter.position) return;
      
      const canvasWidth = fabricCanvas.getWidth();
      const canvasHeight = fabricCanvas.getHeight();
      
      // Convert percentage position to pixel position
      const x = (meter.position.x / 100) * canvasWidth;
      const y = (meter.position.y / 100) * canvasHeight;
      
      // Color based on status
      let color = '#eab308'; // yellow for pending
      if (meter.status === 'approved') color = '#22c55e'; // green
      else if (meter.status === 'rejected') color = '#ef4444'; // red
      
      const circle = new Circle({
        left: x,
        top: y,
        fill: color,
        radius: 20,
        stroke: color === '#22c55e' ? '#166534' : color === '#ef4444' ? '#991b1b' : '#854d0e',
        strokeWidth: 3,
        originX: 'center',
        originY: 'center',
        hasControls: false,
        selectable: activeTool === 'move',
        hoverCursor: activeTool === 'move' ? 'move' : 'pointer',
        opacity: 0.9,
      });

      const text = new Text(`${index + 1}`, {
        left: x,
        top: y - 5,
        fontSize: 14,
        fill: '#fff',
        fontWeight: 'bold',
        originX: 'center',
        originY: 'center',
        selectable: false,
      });

      const label = new Text(meter.meter_number.substring(0, 10), {
        left: x,
        top: y + 30,
        fontSize: 10,
        fill: '#000',
        originX: 'center',
        selectable: false,
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
      });

      circle.set('data', { type: 'extracted', index });
      
      // Handle dragging for extracted meters
      if (activeTool === 'move') {
        circle.on('moving', () => {
          text.set({
            left: circle.left,
            top: (circle.top || 0) - 5,
          });
          label.set({
            left: circle.left,
            top: (circle.top || 0) + 30,
          });
        });

        circle.on('modified', () => {
          // Update position in extracted meters state
          const newX = ((circle.left || 0) / canvasWidth) * 100;
          const newY = ((circle.top || 0) / canvasHeight) * 100;
          
          const updatedMeters = [...extractedMeters];
          updatedMeters[index] = {
            ...updatedMeters[index],
            position: { x: newX, y: newY }
          };
          setExtractedMeters(updatedMeters);
          if (onExtractedMetersUpdate) {
            onExtractedMetersUpdate(updatedMeters);
          }
          toast.success('Meter position updated');
        });
      }

      fabricCanvas.add(circle);
      fabricCanvas.add(text);
      fabricCanvas.add(label);
    });

    // Render saved meter positions
    meterPositions.forEach(pos => {
      const meter = meters.find(m => m.id === pos.meter_id);
      const meterType = meter?.meter_type || 'unknown';
      
      let color = '#3b82f6'; // default blue
      if (meterType.includes('bulk')) color = '#ef4444'; // red
      else if (meterType.includes('check')) color = '#f59e0b'; // orange
      else if (meterType.includes('sub')) color = '#10b981'; // green

      // Convert percentage positions to pixel positions for canvas
      const canvasWidth = fabricCanvas.getWidth();
      const canvasHeight = fabricCanvas.getHeight();
      const x = (pos.x_position / 100) * canvasWidth;
      const y = (pos.y_position / 100) * canvasHeight;

      const circle = new Circle({
        left: x,
        top: y,
        fill: color,
        radius: 15,
        originX: 'center',
        originY: 'center',
        hasControls: false,
        selectable: activeTool === 'move',
        hoverCursor: activeTool === 'move' ? 'move' : (activeTool === 'connection' ? 'pointer' : 'default'),
      });

      const text = new Text(pos.label || meter?.meter_number || 'M', {
        left: x,
        top: y + 25,
        fontSize: 12,
        fill: '#000',
        originX: 'center',
        selectable: false,
      });

      circle.set('data', { meterId: pos.meter_id, positionId: pos.id });
      
      circle.on('mousedown', () => {
        if (activeTool === 'connection') {
          handleMeterClickForConnection(pos.meter_id, x, y);
        }
      });

      // Handle dragging for move tool
      if (activeTool === 'move') {
        circle.on('moving', () => {
          text.set({
            left: circle.left,
            top: (circle.top || 0) + 25,
          });
        });

        circle.on('modified', async () => {
          // Convert pixel positions back to percentages for storage
          const canvasWidth = fabricCanvas.getWidth();
          const canvasHeight = fabricCanvas.getHeight();
          const xPercent = ((circle.left || 0) / canvasWidth) * 100;
          const yPercent = ((circle.top || 0) / canvasHeight) * 100;

          // Update position in database after drag
          const { error } = await supabase
            .from('meter_positions')
            .update({
              x_position: xPercent,
              y_position: yPercent,
            })
            .eq('id', pos.id);

          if (!error) {
            toast.success('Meter position updated');
            fetchMeterPositions();
          } else {
            toast.error('Failed to update position');
          }
        });
      }

      fabricCanvas.add(circle);
      fabricCanvas.add(text);
    });

    fabricCanvas.renderAll();
  }, [fabricCanvas, meterPositions, lines, meters, activeTool, extractedMeters]);

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
    if (!childPos || !fabricCanvas) return;

    // Convert percentage positions to pixel for line drawing
    const canvasWidth = fabricCanvas.getWidth();
    const canvasHeight = fabricCanvas.getHeight();
    const fromX = (childPos.x_position / 100) * canvasWidth;
    const fromY = (childPos.y_position / 100) * canvasHeight;

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
        from_x: fromX,
        from_y: fromY,
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
    // Convert pixel positions to percentages
    const canvasWidth = fabricCanvas?.getWidth() || 1400;
    const canvasHeight = fabricCanvas?.getHeight() || 900;
    const xPercent = (pendingMeterPosition.x / canvasWidth) * 100;
    const yPercent = (pendingMeterPosition.y / canvasHeight) * 100;

    const { error: posError } = await supabase
      .from("meter_positions")
      .insert({
        schematic_id: schematicId,
        meter_id: newMeter.id,
        x_position: xPercent,
        y_position: yPercent,
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
    if (!fabricCanvas) {
      toast.error("Canvas not ready");
      setIsSaving(false);
      return;
    }

    const canvasWidth = fabricCanvas.getWidth();
    const canvasHeight = fabricCanvas.getHeight();
    const objects = fabricCanvas.getObjects() || [];
    
    const updates = objects
      .filter(obj => obj.type === 'circle' && obj.get('data'))
      .map(async (obj: any) => {
        const data = obj.get('data');
        
        // Convert pixel positions to percentages for storage
        const xPercent = ((obj.left || 0) / canvasWidth) * 100;
        const yPercent = ((obj.top || 0) / canvasHeight) * 100;
        
        return supabase
          .from("meter_positions")
          .update({
            x_position: xPercent,
            y_position: yPercent
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

  const handleZoomIn = () => {
    if (!fabricCanvas) return;
    const newZoom = Math.min(zoom * 1.2, 10);
    fabricCanvas.setZoom(newZoom);
    setZoom(newZoom);
    fabricCanvas.renderAll();
  };

  const handleZoomOut = () => {
    if (!fabricCanvas) return;
    const newZoom = Math.max(zoom * 0.8, 0.5);
    fabricCanvas.setZoom(newZoom);
    setZoom(newZoom);
    fabricCanvas.renderAll();
  };

  const handleResetZoom = () => {
    if (!fabricCanvas) return;
    fabricCanvas.setZoom(1);
    fabricCanvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    setZoom(1);
    fabricCanvas.renderAll();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <Button
          variant={activeTool === "select" ? "default" : "outline"}
          onClick={() => setActiveTool("select")}
          size="sm"
        >
          <Zap className="w-4 h-4 mr-2" />
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
          variant={activeTool === "move" ? "default" : "outline"}
          onClick={() => setActiveTool("move")}
          size="sm"
        >
          <Move className="w-4 h-4 mr-2" />
          Move
        </Button>
        <Button
          variant={activeTool === "connection" ? "default" : "outline"}
          onClick={() => setActiveTool("connection")}
          size="sm"
        >
          <Link2 className="w-4 h-4 mr-2" />
          Connect
        </Button>
        <MeterDataExtractor
          siteId={siteId}
          schematicId={schematicId}
          imageUrl={schematicUrl}
          onMetersExtracted={() => {
            fetchMeters();
            fetchMeterPositions();
          }}
          extractedMeters={extractedMeters}
          onMetersUpdate={(meters) => {
            setExtractedMeters(meters);
            onExtractedMetersUpdate?.(meters);
          }}
          selectedMeterIndex={selectedMeterIndex}
          onMeterSelect={setSelectedMeterIndex}
          detectedRectangles={detectedRectangles}
          onRectanglesUpdate={setDetectedRectangles}
          isDrawingMode={isDrawingMode}
          onDrawingModeChange={setIsDrawingMode}
          drawnRegions={drawnRegions}
          onDrawnRegionsUpdate={setDrawnRegions}
        />
        <div className="flex-1" />
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" onClick={handleZoomOut}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Badge variant="outline" className="px-3">
            {Math.round(zoom * 100)}%
          </Badge>
          <Button variant="outline" size="sm" onClick={handleZoomIn}>
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleResetZoom}>
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
        <Button onClick={handleClearLines} variant="destructive" size="sm">
          <Trash2 className="w-4 h-4 mr-2" />
          Clear Lines
        </Button>
        <Button onClick={handleSave} disabled={isSaving} size="sm">
          <Save className="w-4 h-4 mr-2" />
          Save
        </Button>
      </div>

      <div className="text-sm text-muted-foreground space-y-1">
        <div>
          {activeTool === "meter" && "Click on the schematic to place a new meter"}
          {activeTool === "move" && "Drag meters to reposition them on the schematic"}
          {activeTool === "connection" && "Click on two meters to connect them"}
          {activeTool === "select" && !isDrawingMode && "View mode - select a tool to edit"}
          {isDrawingMode && "✏️ Draw mode: Click and drag to draw a box around a meter to extract its data"}
        </div>
        <div className="text-xs">
          💡 Scroll wheel to zoom • {isDrawingMode ? "Exit draw mode to pan" : "Click + drag to pan"}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="text-xs font-medium text-muted-foreground mr-2 flex items-center">Saved Meters:</div>
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
        
        {extractedMeters.length > 0 && (
          <>
            <div className="w-px h-6 bg-border mx-2" />
            <div className="text-xs font-medium text-muted-foreground mr-2 flex items-center">Extracted Meters:</div>
            <Badge variant="outline">
              <div className="w-3 h-3 rounded-full bg-[#eab308] border-2 border-[#854d0e] mr-2" />
              Pending
            </Badge>
            <Badge variant="outline">
              <div className="w-3 h-3 rounded-full bg-[#22c55e] border-2 border-[#166534] mr-2 shadow-sm shadow-green-500/50" />
              Approved
            </Badge>
            <Badge variant="outline">
              <div className="w-3 h-3 rounded-full bg-[#ef4444] border-2 border-[#991b1b] mr-2" />
              Rejected
            </Badge>
          </>
        )}
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
                    <SelectItem value="solar">Solar Generation</SelectItem>
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
