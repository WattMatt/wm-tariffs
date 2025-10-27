import { useEffect, useRef, useState } from "react";
import { Canvas as FabricCanvas, Circle, Line, Text, FabricImage, Rect } from "fabric";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Zap, Link2, Trash2, Move, Upload, Plus, ZoomIn, ZoomOut, Maximize2, Pencil, Scan, Check } from "lucide-react";
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
  filePath?: string;
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
  filePath,
  extractedMeters: propExtractedMeters = [],
  onExtractedMetersUpdate 
}: SchematicEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeTool, setActiveTool] = useState<"select" | "meter" | "connection" | "move" | "draw">("select");
  const activeToolRef = useRef<"select" | "meter" | "connection" | "move" | "draw">("select");
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawnRegions, setDrawnRegions] = useState<Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth?: number;
    imageHeight?: number;
    displayLeft?: number;
    displayTop?: number;
    displayWidth?: number;
    displayHeight?: number;
    fabricRect: any;
    fabricLabel?: any;
  }>>([]);
  const [meterPositions, setMeterPositions] = useState<MeterPosition[]>([]);
  const drawingRectRef = useRef<any>(null);
  const drawStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const startMarkerRef = useRef<any>(null);
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
  const [isEditMeterDialogOpen, setIsEditMeterDialogOpen] = useState(false);
  const [isConfirmMeterDialogOpen, setIsConfirmMeterDialogOpen] = useState(false);
  const [editingMeter, setEditingMeter] = useState<any>(null);
  
  // Legend visibility toggles
  const [legendVisibility, setLegendVisibility] = useState({
    bulk_meter: true,
    check_meter: true,
    main_board_zone: true,
    mini_sub_zone: true,
    council_connection_zone: true,
    submeter: true,
    other: true
  });

  // Load initial data on mount
  useEffect(() => {
    fetchMeters();
    fetchMeterPositions();
    fetchLines();
  }, [schematicId, siteId]);

  // Sync drawing mode state and ref when tool changes
  useEffect(() => {
    activeToolRef.current = activeTool;
    const newDrawingMode = activeTool === 'draw';
    setIsDrawingMode(newDrawingMode);
  }, [activeTool]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 1400,
      height: 900,
      backgroundColor: "#f8f9fa",
    });

    // Mouse wheel: Zoom in non-draw modes, Pan in draw mode
    canvas.on('mouse:wheel', (opt) => {
      const currentTool = activeToolRef.current;
      const delta = opt.e.deltaY;
      
      if (currentTool === 'draw') {
        // In draw mode: use wheel to pan vertically
        opt.e.preventDefault();
        opt.e.stopPropagation();
        
        const vpt = canvas.viewportTransform;
        if (vpt) {
          // Pan vertically with wheel
          vpt[5] -= delta;
          canvas.requestRenderAll();
        }
      } else {
        // In other modes: use wheel to zoom
        let newZoom = canvas.getZoom();
        newZoom *= 0.999 ** delta;
        if (newZoom > 10) newZoom = 10;
        if (newZoom < 0.5) newZoom = 0.5;
        
        const pointer = canvas.getPointer(opt.e);
        canvas.zoomToPoint(pointer, newZoom);
        setZoom(newZoom);
        opt.e.preventDefault();
        opt.e.stopPropagation();
      }
    });

    // Enable panning with click + drag (when not clicking on objects or in select mode)
    let isPanningLocal = false;
    let lastX = 0;
    let lastY = 0;

    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent;
      const target = opt.target;
      const currentTool = activeToolRef.current;
      
      // DRAWING TOOL: Left-click for drawing regions (double-click approach)
      if (currentTool === 'draw' && evt.button === 0) {
        const isInteractiveObject = target && target.type !== 'image';
        if (!isInteractiveObject) {
          const pointer = canvas.getPointer(opt.e);
          
          // First click - set start point
          if (!drawStartPointRef.current) {
            console.log('Setting start point:', pointer);
            drawStartPointRef.current = { x: pointer.x, y: pointer.y };
            
            // Show a marker at start point
            const marker = new Circle({
              left: pointer.x,
              top: pointer.y,
              radius: 5,
              fill: '#f59e0b',
              stroke: '#ffffff',
              strokeWidth: 2,
              selectable: false,
              evented: false,
              originX: 'center',
              originY: 'center',
            });
            
            canvas.add(marker);
            startMarkerRef.current = marker;
            canvas.renderAll();
            toast.info('Click again to set the end point');
            evt.preventDefault();
            evt.stopPropagation();
            return;
          }
          
          // Second click - set end point and create persistent region
          console.log('Setting end point:', pointer);
          const startPoint = drawStartPointRef.current;
          
          // Create rectangle for the region
          const left = Math.min(startPoint.x, pointer.x);
          const top = Math.min(startPoint.y, pointer.y);
          const width = Math.abs(pointer.x - startPoint.x);
          const height = Math.abs(pointer.y - startPoint.y);
          
          // Check if region is large enough
          if (width < 20 || height < 20) {
            toast.error('Region too small - draw a larger area');
            // Clean up
            if (startMarkerRef.current) {
              canvas.remove(startMarkerRef.current);
              startMarkerRef.current = null;
            }
            drawStartPointRef.current = null;
            canvas.renderAll();
            evt.preventDefault();
            evt.stopPropagation();
            return;
          }
          
          const canvasWidth = canvas.getWidth();
          const canvasHeight = canvas.getHeight();
          
          // Create persistent rectangle with distinct styling
          const rect = new Rect({
            left,
            top,
            width,
            height,
            fill: 'rgba(245, 158, 11, 0.15)', // Orange with low opacity
            stroke: '#f59e0b', // Orange border
            strokeWidth: 2,
            selectable: false,
            evented: false,
          });
          
          canvas.add(rect);
          
          // Add region number label
          const regionNumber = drawnRegions.length + 1;
          const label = new Text(`${regionNumber}`, {
            left: left + 8,
            top: top + 8,
            fontSize: 16,
            fill: '#f59e0b',
            fontWeight: 'bold',
            selectable: false,
            evented: false,
          });
          
          canvas.add(label);
          canvas.renderAll();
          
          // Calculate region in ABSOLUTE pixels of the original image
          // This matches how tariff extraction does it - convert from displayed canvas coordinates
          // to original image pixel coordinates
          const originalImageWidth = (canvas as any).originalImageWidth || canvasWidth;
          const originalImageHeight = (canvas as any).originalImageHeight || canvasHeight;
          const displayScale = (canvas as any).displayScale || 1;
          
          // Convert from canvas display coordinates to original image pixel coordinates
          const scaleX = originalImageWidth / canvasWidth;
          const scaleY = originalImageHeight / canvasHeight;
          
          const newRegion = {
            id: `region-${Date.now()}-${regionNumber}`,
            // Store as absolute pixels in original image space
            x: left * scaleX,
            y: top * scaleY,
            width: width * scaleX,
            height: height * scaleY,
            imageWidth: originalImageWidth,
            imageHeight: originalImageHeight,
            // Also store display coordinates for canvas rendering
            displayLeft: left,
            displayTop: top,
            displayWidth: width,
            displayHeight: height,
            fabricRect: rect,
            fabricLabel: label
          };
          
          console.log('🎯 Region coordinates:', {
            display: { left, top, width, height },
            original: {
              x: Math.round(newRegion.x),
              y: Math.round(newRegion.y),
              width: Math.round(newRegion.width),
              height: Math.round(newRegion.height)
            },
            imageSize: { w: originalImageWidth, h: originalImageHeight }
          });
          
          setDrawnRegions(prev => [...prev, newRegion]);
          toast.success(`Region ${regionNumber} added`);
          
          // Clean up drawing markers
          if (startMarkerRef.current) {
            canvas.remove(startMarkerRef.current);
            startMarkerRef.current = null;
          }
          // Remove preview rectangles
          const objects = canvas.getObjects();
          objects.forEach(obj => {
            if ((obj as any).isPreview) {
              canvas.remove(obj);
            }
          });
          
          drawStartPointRef.current = null;
          canvas.renderAll();
          
          evt.preventDefault();
          evt.stopPropagation();
          return;
        }
      }
      
      // PANNING: Allow in all modes (including draw mode with middle mouse)
      // In draw mode: middle mouse button ALWAYS allows panning (even during rectangle selection)
      // In other modes: any mouse button for panning
      if (currentTool === 'draw') {
        // In draw mode, always allow panning with middle mouse button
        if (evt.button === 1) {
          isPanningLocal = true;
          lastX = evt.clientX;
          lastY = evt.clientY;
          canvas.selection = false;
          evt.preventDefault();
          evt.stopPropagation();
        }
      } else if (!target) {
        // In other modes, allow panning with any button
        if (evt.button === 0 || evt.button === 1 || evt.button === 2) {
          isPanningLocal = true;
          lastX = evt.clientX;
          lastY = evt.clientY;
          canvas.selection = false;
        }
      }
    });

    canvas.on('mouse:move', (opt) => {
      const currentTool = activeToolRef.current;
      
      // PANNING: Handle panning first, before any other logic
      if (isPanningLocal) {
        const evt = opt.e as MouseEvent;
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] += evt.clientX - lastX;
          vpt[5] += evt.clientY - lastY;
          canvas.requestRenderAll();
          lastX = evt.clientX;
          lastY = evt.clientY;
        }
        return; // Don't process other mouse movements while panning
      }
      
      // DRAWING MODE: Show preview rectangle from start point to current mouse position
      // Only show preview if NOT panning
      if (currentTool === 'draw' && drawStartPointRef.current && !drawingRectRef.current) {
        const pointer = canvas.getPointer(opt.e);
        const startPoint = drawStartPointRef.current;
        
        // Remove old preview if exists
        const objects = canvas.getObjects();
        const oldPreview = objects.find(obj => (obj as any).isPreview);
        if (oldPreview) {
          canvas.remove(oldPreview);
        }
        
        // Create preview rectangle
        const left = Math.min(startPoint.x, pointer.x);
        const top = Math.min(startPoint.y, pointer.y);
        const width = Math.abs(pointer.x - startPoint.x);
        const height = Math.abs(pointer.y - startPoint.y);
        
        const preview = new Rect({
          left,
          top,
          width,
          height,
          fill: 'rgba(245, 158, 11, 0.1)',
          stroke: '#f59e0b',
          strokeWidth: 1,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
        });
        
        (preview as any).isPreview = true;
        canvas.add(preview);
        canvas.renderAll();
      }
    });

    canvas.on('mouse:up', async () => {
      // Clean up panning state
      if (isPanningLocal) {
        isPanningLocal = false;
        canvas.selection = true;
      }
    });
    
    // Function to handle extraction from a drawn region
    const handleExtractFromRegion = async (canvas: FabricCanvas, rect: any) => {
      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();
      
      const left = rect.left || 0;
      const top = rect.top || 0;
      const width = rect.width || 0;
      const height = rect.height || 0;
      
      console.log('Extracting from region:', { left, top, width, height });
      
      // Only extract if region is large enough (at least 20x20 pixels)
      if (width > 20 && height > 20) {
        const region = {
          x: (left / canvasWidth) * 100,
          y: (top / canvasHeight) * 100,
          width: (width / canvasWidth) * 100,
          height: (height / canvasHeight) * 100
        };
        
        console.log('Region percentages:', region);
        
        // Extract meter data from this region
        try {
          toast.info('Extracting meter data from selected region...');
          
          const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
            body: { 
              imageUrl: schematicUrl,
              filePath: filePath || null,
              mode: 'extract-region',
              region
            }
          });
          
          if (error) {
            console.error('Edge function error:', error);
            throw error;
          }
          
          console.log('Extraction response:', data);
          
          if (data && data.meter) {
            // Add extracted meter to the list with position at center of drawn region
            // Store the entire region for side-by-side comparison
            const newMeter = {
              ...data.meter,
              status: 'pending' as const,
              position: {
                x: region.x + (region.width / 2),
                y: region.y + (region.height / 2)
              },
              extractedRegion: region, // Store the drawn region for display
              scale_x: 1,
              scale_y: 1
            };
            
            const updatedMeters = [...extractedMeters, newMeter];
            setExtractedMeters(updatedMeters);
            if (onExtractedMetersUpdate) {
              onExtractedMetersUpdate(updatedMeters);
            }
            toast.success(`Extracted meter: ${data.meter.meter_number}`);
          } else {
            toast.error('No meter data found in selected region');
          }
        } catch (error) {
          console.error('Error extracting from region:', error);
          toast.error('Failed to extract meter data from region');
        }
      } else {
        toast.error('Region too small - draw a larger area around the meter');
      }
      
      // Clean up drawing markers
      if (startMarkerRef.current) {
        canvas.remove(startMarkerRef.current);
        startMarkerRef.current = null;
      }
      if (drawingRectRef.current) {
        canvas.remove(drawingRectRef.current);
        drawingRectRef.current = null;
      }
      // Remove preview rectangles
      const objects = canvas.getObjects();
      objects.forEach(obj => {
        if ((obj as any).isPreview) {
          canvas.remove(obj);
        }
      });
      
      drawStartPointRef.current = null;
      canvas.renderAll();
    };

    // Set default cursor based on active tool (will be updated when tool changes)
    canvas.defaultCursor = 'grab';
    canvas.hoverCursor = 'grab';

    // Prevent context menu on right click
    canvas.getElement().addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Prevent default middle-click behavior (auto-scroll, etc.) to allow panning
    canvas.getElement().addEventListener('auxclick', (e) => {
      if (e.button === 1) { // Middle mouse button
        e.preventDefault();
        e.stopPropagation();
      }
    });
    
    // Also prevent mousedown default for middle button
    canvas.getElement().addEventListener('mousedown', (e) => {
      if (e.button === 1) { // Middle mouse button
        e.preventDefault();
      }
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
      
      console.log('📐 Image loaded and canvas resized:', {
        imageSize: { w: imgWidth, h: imgHeight },
        canvasSize: { w: Math.round(canvasWidth), h: Math.round(canvasHeight) },
        scale: scale.toFixed(3),
        aspectRatio: (canvasWidth / canvasHeight).toFixed(2)
      });
      
      // Store original image dimensions for region coordinate conversion
      (canvas as any).originalImageWidth = imgWidth;
      (canvas as any).originalImageHeight = imgHeight;
      (canvas as any).displayScale = scale;
      
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

  // Update cursor when tool changes
  useEffect(() => {
    if (fabricCanvas) {
      fabricCanvas.defaultCursor = activeTool === 'draw' ? 'crosshair' : 'grab';
      fabricCanvas.hoverCursor = activeTool === 'draw' ? 'crosshair' : 'grab';
      fabricCanvas.renderAll();
    }
  }, [activeTool, fabricCanvas]);

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
    extractedMeters.forEach((meter, meterIndex) => {
      if (!meter.position) {
        console.log(`⚠️ Meter ${meterIndex} has no position, skipping`);
        return;
      }
      
      // Capture the index in a constant to avoid closure issues
      const capturedIndex = meterIndex;
      
      const canvasWidth = fabricCanvas.getWidth();
      const canvasHeight = fabricCanvas.getHeight();
      
      // Convert percentage position to pixel position
      const x = (meter.position.x / 100) * canvasWidth;
      const y = (meter.position.y / 100) * canvasHeight;
      
      const scaleX = meter.scale_x || 1.0;
      const scaleY = meter.scale_y || 1.0;

      console.log(`🎨 Rendering meter ${capturedIndex} "${meter.meter_number}":`, {
        percentPos: meter.position,
        pixelPos: { x: Math.round(x), y: Math.round(y) },
        scale: { x: scaleX.toFixed(2), y: scaleY.toFixed(2) },
        canvas: { w: canvasWidth, h: canvasHeight }
      });
      
      // Color based on status and data quality
      let borderColor = '#dc2626'; // RED for pending/unconfirmed
      let fillColor = '#ffffff';
      
      // Check for fields that need verification
      const needsVerification = Object.values(meter).some((val: any) => 
        typeof val === 'string' && (val.includes('VERIFY:') || val === 'NOT_VISIBLE' || val === '*')
      );
      
      if (meter.status === 'approved') {
        borderColor = '#16a34a'; // GREEN for confirmed
        fillColor = '#f0fdf4';
      } else if (needsVerification) {
        borderColor = '#f59e0b'; // ORANGE for needs verification
        fillColor = '#fff7ed';
      }
      
      // Calculate card size based on extracted region if available
      let cardWidth = 200; // default
      let cardHeight = 140; // default
      let useTopLeftOrigin = false;
      
      if (meter.extractedRegion) {
        // Use the region dimensions to size the card
        cardWidth = (meter.extractedRegion.width / 100) * canvasWidth;
        cardHeight = (meter.extractedRegion.height / 100) * canvasHeight;
        
        // Don't enforce minimum size - use actual region size
        // This ensures the card matches the drawn rectangle exactly
        useTopLeftOrigin = true; // Position from top-left to match drawn rectangle
      }
      
      const rowHeight = cardHeight / 7; // 7 rows of data
      
      // Background rectangle with scaling enabled - ALWAYS moveable
      const background = new Rect({
        left: x,
        top: y,
        width: cardWidth,
        height: cardHeight,
        fill: fillColor,
        stroke: borderColor,
        strokeWidth: 3, // Thicker border for visibility
        hasControls: true, // Always allow controls
        selectable: true, // Always selectable for dragging
        hoverCursor: 'move',
        originX: useTopLeftOrigin ? 'left' : 'center',  // Top-left for extracted regions
        originY: useTopLeftOrigin ? 'top' : 'center',   // Top-left for extracted regions
        lockRotation: true,
        scaleX: scaleX,
        scaleY: scaleY,
      });

      // Store the actual meter data and index directly in the fabric object
      background.set('data', { 
        type: 'extracted', 
        index: capturedIndex,
        meterNumber: meter.meter_number,
        meterData: meter 
      });
      
      // Add double-click handler to open edit dialog
      background.on('mousedblclick', () => {
        const objectData = background.get('data') as any;
        console.log(`🎯 Double-clicked meter:`, {
          index: objectData.index,
          meterNumber: objectData.meterNumber,
          capturedIndex
        });
        setSelectedMeterIndex(objectData.index);
        setIsConfirmMeterDialogOpen(true);
      });

      // Create table rows with labels and values
      const fields = [
        { label: 'NO:', value: meter.meter_number || 'N/A' },
        { label: 'NAME:', value: meter.name || 'VACANT' },
        { label: 'AREA:', value: meter.area || 'N/A' },
        { label: 'RATING:', value: meter.rating || 'N/A' },
        { label: 'CABLE:', value: meter.cable_specification || 'N/A' },
        { label: 'SERIAL:', value: meter.serial_number || 'N/A' },
        { label: 'CT:', value: meter.ct_type || 'N/A' }
      ];

      const textElements: Text[] = [];
      // Calculate font size based on card height for better scaling
      // Further reduce font size for smaller rectangles
      const fontSize = Math.max(5, Math.min(8, rowHeight * 0.3));
      
      // Make first column narrower - just enough for labels
      const labelColumnWidth = 35; // Reduced from 50 to 35
      
      // Calculate base positions based on origin type
      const baseLeftOffset = useTopLeftOrigin ? 3 * scaleX : (-(cardWidth * scaleX) / 2 + 3 * scaleX);
      const baseTopOffset = useTopLeftOrigin ? 2 * scaleY : (-(cardHeight * scaleY) / 2 + 2 * scaleY);
      const valueLeftOffset = useTopLeftOrigin ? (labelColumnWidth + 3) * scaleX : (-(cardWidth * scaleX) / 2 + (labelColumnWidth + 3) * scaleX);
      
      fields.forEach((field, i) => {
        // Label text (left column)
        const labelText = new Text(field.label, {
          left: x + baseLeftOffset,
          top: y + baseTopOffset + i * rowHeight * scaleY,
          fontSize: fontSize,
          fill: '#000',
          fontWeight: 'bold',
          fontFamily: 'Arial',
          selectable: false,
          evented: false,
          scaleX: scaleX,
          scaleY: scaleY,
        });
        textElements.push(labelText);

        // Value text (right column) - adjust truncation based on card width
        const maxValueLength = Math.floor(cardWidth / 8);
        const valueDisplay = field.value.length > maxValueLength ? field.value.substring(0, maxValueLength) + '...' : field.value;
        const valueText = new Text(valueDisplay, {
          left: x + valueLeftOffset,
          top: y + baseTopOffset + i * rowHeight * scaleY,
          fontSize: fontSize,
          fill: '#000',
          fontFamily: 'Arial',
          selectable: false,
          evented: false,
          scaleX: scaleX,
          scaleY: scaleY,
        });
        textElements.push(valueText);

        // Horizontal separator line
        if (i < fields.length - 1) {
          const separatorY = useTopLeftOrigin 
            ? y + (i + 1) * rowHeight * scaleY
            : y - (cardHeight * scaleY) / 2 + (i + 1) * rowHeight * scaleY;
          const separatorX1 = useTopLeftOrigin ? x : x - (cardWidth * scaleX) / 2;
          const separatorX2 = useTopLeftOrigin ? x + cardWidth * scaleX : x + (cardWidth * scaleX) / 2;
          
          const separator = new Line(
            [separatorX1, separatorY, separatorX2, separatorY],
            {
              stroke: borderColor,
              strokeWidth: 1,
              selectable: false,
              evented: false,
            }
          );
          textElements.push(separator as any);
        }
      });

      // Vertical separator between label and value columns
      const vertX = useTopLeftOrigin ? x + labelColumnWidth * scaleX : x - (cardWidth * scaleX) / 2 + labelColumnWidth * scaleX;
      const vertY1 = useTopLeftOrigin ? y : y - (cardHeight * scaleY) / 2;
      const vertY2 = useTopLeftOrigin ? y + cardHeight * scaleY : y + (cardHeight * scaleY) / 2;
      
      const verticalSeparator = new Line(
        [vertX, vertY1, vertX, vertY2],
        {
          stroke: borderColor,
          strokeWidth: 1,
          selectable: false,
          evented: false,
        }
      );
      
      
      // Handle dragging for extracted meters - ALWAYS enabled
      const updateTextPositions = () => {
        const newLeft = background.left || x;
        const newTop = background.top || y;
        const newScaleX = background.scaleX || 1;
        const newScaleY = background.scaleY || 1;
        
        // Calculate scaled dimensions
        const scaledWidth = cardWidth * newScaleX;
        const scaledHeight = cardHeight * newScaleY;
        const scaledRowHeight = rowHeight * newScaleY;
        
        // Calculate offsets based on origin type with NEW scaled dimensions
        const newBaseLeftOffset = useTopLeftOrigin ? 3 * newScaleX : (-scaledWidth / 2 + 3 * newScaleX);
        const newBaseTopOffset = useTopLeftOrigin ? 2 * newScaleY : (-scaledHeight / 2 + 2 * newScaleY);
        const newValueLeftOffset = useTopLeftOrigin ? (labelColumnWidth + 3) * newScaleX : (-scaledWidth / 2 + (labelColumnWidth + 3) * newScaleX);
        
        // Move and scale all text elements with the background
        textElements.forEach((text, i) => {
          const fieldIndex = Math.floor(i / 2);
          const isLabel = i % 2 === 0;
          const isSeparator = text instanceof Line;
          
          if (!isSeparator) {
            text.set({
              left: newLeft + (isLabel ? newBaseLeftOffset : newValueLeftOffset),
              top: newTop + newBaseTopOffset + fieldIndex * scaledRowHeight,
              scaleX: newScaleX,
              scaleY: newScaleY,
            });
          } else {
            // Update line positions with scale
            if (i === textElements.length - 1) {
              // Vertical separator
              const vertX = useTopLeftOrigin ? newLeft + labelColumnWidth * newScaleX : newLeft - scaledWidth / 2 + labelColumnWidth * newScaleX;
              const vertY1 = useTopLeftOrigin ? newTop : newTop - scaledHeight / 2;
              const vertY2 = useTopLeftOrigin ? newTop + scaledHeight : newTop + scaledHeight / 2;
              text.set({
                x1: vertX,
                y1: vertY1,
                x2: vertX,
                y2: vertY2,
              });
            } else {
              // Horizontal separators
              const separatorFieldIndex = Math.floor((i - 1) / 3);
              const separatorY = useTopLeftOrigin 
                ? newTop + (separatorFieldIndex + 1) * scaledRowHeight
                : newTop - scaledHeight / 2 + (separatorFieldIndex + 1) * scaledRowHeight;
              const separatorX1 = useTopLeftOrigin ? newLeft : newLeft - scaledWidth / 2;
              const separatorX2 = useTopLeftOrigin ? newLeft + scaledWidth : newLeft + scaledWidth / 2;
              text.set({
                x1: separatorX1,
                y1: separatorY,
                x2: separatorX2,
                y2: separatorY,
              });
            }
          }
        });
        
        // Update vertical separator
        const newVertX = useTopLeftOrigin ? newLeft + labelColumnWidth * newScaleX : newLeft - scaledWidth / 2 + labelColumnWidth * newScaleX;
        const newVertY1 = useTopLeftOrigin ? newTop : newTop - scaledHeight / 2;
        const newVertY2 = useTopLeftOrigin ? newTop + scaledHeight : newTop + scaledHeight / 2;
        
        verticalSeparator.set({
          x1: newVertX,
          y1: newVertY1,
          x2: newVertX,
          y2: newVertY2,
        });
        
        fabricCanvas.renderAll();
      };

      background.on('moving', updateTextPositions);
      background.on('scaling', updateTextPositions);

      background.on('modified', () => {
        // Update position and scale in extracted meters state
        const newX = ((background.left || 0) / canvasWidth) * 100;
        const newY = ((background.top || 0) / canvasHeight) * 100;
        const scaleX = background.scaleX || 1;
        const scaleY = background.scaleY || 1;
        
        const updatedMeters = [...extractedMeters];
        updatedMeters[capturedIndex] = {
          ...updatedMeters[capturedIndex],
          position: { x: newX, y: newY },
          scale_x: scaleX,
          scale_y: scaleY
        };
        setExtractedMeters(updatedMeters);
        if (onExtractedMetersUpdate) {
          onExtractedMetersUpdate(updatedMeters);
        }
        toast.success('Meter position updated');
      });

      fabricCanvas.add(background);
      textElements.forEach(el => fabricCanvas.add(el));
      fabricCanvas.add(verticalSeparator);
    });

    // Render saved meter positions
    meterPositions.forEach(pos => {
      const meter = meters.find(m => m.id === pos.meter_id);
      const meterType = meter?.meter_type || 'unknown';
      const zone = meter?.zone;
      
      // Determine border color based on zone or meter type
      let borderColor = '#3b82f6'; // default blue
      let categoryKey = 'other';
      
      if (zone === 'main_board') {
        borderColor = '#9333ea'; // purple for Main Board zone
        categoryKey = 'main_board_zone';
      } else if (zone === 'mini_sub') {
        borderColor = '#06b6d4'; // cyan for Mini Sub zone
        categoryKey = 'mini_sub_zone';
      } else if (meterType.includes('bulk')) {
        borderColor = '#ef4444'; // red
        categoryKey = 'bulk_meter';
      } else if (meterType.includes('check')) {
        borderColor = '#f59e0b'; // orange
        categoryKey = 'check_meter';
      } else if (meterType.includes('sub')) {
        borderColor = '#10b981'; // green
        categoryKey = 'submeter';
      }
      
      // Skip rendering if this category is hidden
      if (!legendVisibility[categoryKey as keyof typeof legendVisibility]) {
        return;
      }

      // Convert percentage positions to pixel positions for canvas
      const canvasWidth = fabricCanvas.getWidth();
      const canvasHeight = fabricCanvas.getHeight();
      const x = (pos.x_position / 100) * canvasWidth;
      const y = (pos.y_position / 100) * canvasHeight;

      // Create table-like card
      const cardWidth = 200;
      const cardHeight = zone ? 160 : 140; // Increase height if zone is present
      const rowHeight = 20;
      
      // Background rectangle with scaling enabled
      const background = new Rect({
        left: x,
        top: y,
        width: cardWidth,
        height: cardHeight,
        fill: '#ffffff',
        stroke: borderColor,
        strokeWidth: 2,
        hasControls: activeTool === 'move',
        selectable: activeTool === 'move',
        hoverCursor: activeTool === 'move' ? 'move' : (activeTool === 'connection' ? 'pointer' : 'default'),
        originX: 'center',
        originY: 'center',
        lockRotation: true,
        scaleX: (pos as any).scale_x ? Number((pos as any).scale_x) : 1.0,
        scaleY: (pos as any).scale_y ? Number((pos as any).scale_y) : 1.0,
      });

      background.set('data', { meterId: pos.meter_id, positionId: pos.id });
      
      background.on('mousedown', () => {
        if (activeTool === 'connection') {
          handleMeterClickForConnection(pos.meter_id, x, y);
        } else if (activeTool === 'select') {
          // Open edit dialog for this meter
          setEditingMeter(meter);
          setIsEditMeterDialogOpen(true);
        }
      });

      // Create table rows with labels and values
      const fields = [
        { label: 'NO:', value: meter?.meter_number || 'N/A' },
        { label: 'NAME:', value: meter?.name || 'VACANT' },
        { label: 'AREA:', value: meter?.area?.toString() || 'N/A' },
        { label: 'RATING:', value: meter?.rating || 'N/A' },
        { label: 'CABLE:', value: meter?.cable_specification || 'N/A' },
        { label: 'SERIAL:', value: meter?.serial_number || 'N/A' },
        { label: 'CT:', value: meter?.ct_type || 'N/A' }
      ];

      // Add zone field if present
      if (zone) {
        const zoneName = zone === 'main_board' ? 'MAIN BOARD' : zone === 'mini_sub' ? 'MINI SUB' : zone;
        fields.splice(2, 0, { label: 'ZONE:', value: zoneName });
      }

      const textElements: Text[] = [];
      const savedScaleX = (pos as any).scale_x ? Number((pos as any).scale_x) : 1.0;
      const savedScaleY = (pos as any).scale_y ? Number((pos as any).scale_y) : 1.0;
      
      fields.forEach((field, i) => {
        // Label text (left column)
        const labelText = new Text(field.label, {
          left: x - (cardWidth * savedScaleX) / 2 + 5 * savedScaleX,
          top: y - (cardHeight * savedScaleY) / 2 + i * rowHeight * savedScaleY + 3 * savedScaleY,
          fontSize: 9,
          fill: '#000',
          fontWeight: 'bold',
          fontFamily: 'Arial',
          selectable: false,
          evented: false,
          scaleX: savedScaleX,
          scaleY: savedScaleY,
        });
        textElements.push(labelText);

        // Value text (right column) - truncate if too long
        const valueDisplay = field.value.length > 20 ? field.value.substring(0, 20) + '...' : field.value;
        const valueText = new Text(valueDisplay, {
          left: x - (cardWidth * savedScaleX) / 2 + 55 * savedScaleX,
          top: y - (cardHeight * savedScaleY) / 2 + i * rowHeight * savedScaleY + 3 * savedScaleY,
          fontSize: 9,
          fill: '#000',
          fontFamily: 'Arial',
          selectable: false,
          evented: false,
          scaleX: savedScaleX,
          scaleY: savedScaleY,
        });
        textElements.push(valueText);

        // Horizontal separator line
        if (i < fields.length - 1) {
          const separator = new Line(
            [x - (cardWidth * savedScaleX) / 2, y - (cardHeight * savedScaleY) / 2 + (i + 1) * rowHeight * savedScaleY, 
             x + (cardWidth * savedScaleX) / 2, y - (cardHeight * savedScaleY) / 2 + (i + 1) * rowHeight * savedScaleY],
            {
              stroke: borderColor,
              strokeWidth: 1,
              selectable: false,
              evented: false,
            }
          );
          textElements.push(separator as any);
        }
      });

      // Vertical separator between label and value columns
      const verticalSeparator = new Line(
        [x - (cardWidth * savedScaleX) / 2 + 50 * savedScaleX, y - (cardHeight * savedScaleY) / 2, 
         x - (cardWidth * savedScaleX) / 2 + 50 * savedScaleX, y + (cardHeight * savedScaleY) / 2],
        {
          stroke: borderColor,
          strokeWidth: 1,
          selectable: false,
          evented: false,
        }
      );

      // Handle dragging and scaling for move tool
      if (activeTool === 'move') {
        const updateTextPositions = () => {
          const newLeft = background.left || x;
          const newTop = background.top || y;
          const scaleX = background.scaleX || 1;
          const scaleY = background.scaleY || 1;
          
          // Move and scale all text elements with the background
          textElements.forEach((text, i) => {
            const fieldIndex = Math.floor(i / 2);
            const isLabel = i % 2 === 0;
            const isSeparator = text instanceof Line;
            
            if (!isSeparator) {
              text.set({
                left: newLeft - (cardWidth * scaleX) / 2 + (isLabel ? 5 : 55) * scaleX,
                top: newTop - (cardHeight * scaleY) / 2 + fieldIndex * rowHeight * scaleY + 3 * scaleY,
                scaleX: scaleX,
                scaleY: scaleY,
              });
            } else {
              // Update line positions with scale
              if (i === textElements.length - 1) {
                // Vertical separator
                text.set({
                  x1: newLeft - (cardWidth * scaleX) / 2 + 50 * scaleX,
                  y1: newTop - (cardHeight * scaleY) / 2,
                  x2: newLeft - (cardWidth * scaleX) / 2 + 50 * scaleX,
                  y2: newTop + (cardHeight * scaleY) / 2,
                });
              } else {
                // Horizontal separators
                const separatorFieldIndex = Math.floor((i - 1) / 3);
                text.set({
                  x1: newLeft - (cardWidth * scaleX) / 2,
                  y1: newTop - (cardHeight * scaleY) / 2 + (separatorFieldIndex + 1) * rowHeight * scaleY,
                  x2: newLeft + (cardWidth * scaleX) / 2,
                  y2: newTop - (cardHeight * scaleY) / 2 + (separatorFieldIndex + 1) * rowHeight * scaleY,
                });
              }
            }
          });
          
          verticalSeparator.set({
            x1: newLeft - (cardWidth * scaleX) / 2 + 50 * scaleX,
            y1: newTop - (cardHeight * scaleY) / 2,
            x2: newLeft - (cardWidth * scaleX) / 2 + 50 * scaleX,
            y2: newTop + (cardHeight * scaleY) / 2,
          });
          
          fabricCanvas.renderAll();
        };

        background.on('moving', updateTextPositions);
        background.on('scaling', updateTextPositions);

        background.on('modified', async () => {
          // Convert pixel positions back to percentages for storage
          const canvasWidth = fabricCanvas.getWidth();
          const canvasHeight = fabricCanvas.getHeight();
          const xPercent = ((background.left || 0) / canvasWidth) * 100;
          const yPercent = ((background.top || 0) / canvasHeight) * 100;
          const scaleX = background.scaleX || 1;
          const scaleY = background.scaleY || 1;

          // Update position and scale in database after drag/resize
          const { error } = await supabase
            .from('meter_positions')
            .update({
              x_position: xPercent,
              y_position: yPercent,
              scale_x: scaleX,
              scale_y: scaleY,
            })
            .eq('id', pos.id);

          if (!error) {
            toast.success('Meter card updated');
            fetchMeterPositions();
          } else {
            toast.error('Failed to update meter card');
          }
        });
      }

      fabricCanvas.add(background);
      textElements.forEach(el => fabricCanvas.add(el));
      fabricCanvas.add(verticalSeparator);
    });

    fabricCanvas.renderAll();
  }, [fabricCanvas, meterPositions, lines, meters, activeTool, extractedMeters, legendVisibility]);

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
      .select(`
        id,
        meter_id,
        x_position,
        y_position,
        label,
        scale_x,
        scale_y,
        meters(
          meter_number,
          meter_type,
          name,
          area,
          rating,
          cable_specification,
          serial_number,
          ct_type
        )
      `)
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
        zone: formData.get("zone") as string || null,
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

  const handleUpdateMeter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMeter) return;

    const formData = new FormData(e.target as HTMLFormElement);
    const updatedData = {
      meter_number: formData.get('meter_number') as string,
      name: formData.get('name') as string,
      area: formData.get('area') ? Number(formData.get('area')) : null,
      rating: formData.get('rating') as string,
      cable_specification: formData.get('cable_specification') as string,
      serial_number: formData.get('serial_number') as string,
      ct_type: formData.get('ct_type') as string,
      meter_type: formData.get('meter_type') as string,
      zone: formData.get('zone') as string || null,
    };

    const { error } = await supabase
      .from('meters')
      .update(updatedData)
      .eq('id', editingMeter.id);

    if (error) {
      toast.error('Failed to update meter');
      return;
    }

    toast.success('Meter updated successfully');
    setIsEditMeterDialogOpen(false);
    setEditingMeter(null);
    fetchMeters();
    fetchMeterPositions();
  };

  const handleScanAll = async () => {
    if (!schematicUrl) return;
    setIsSaving(true);
    
    try {
      // Case A: No regions drawn - scan entire PDF
      if (drawnRegions.length === 0) {
        const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
          body: { imageUrl: schematicUrl, mode: 'full-extraction' }
        });
        if (error) throw error;
        if (data?.meters) {
          const scanned = data.meters.map((m: any) => ({
            ...m,
            status: 'pending',
            position: m.position || { x: 50, y: 50 },
            scale_x: m.scale_x || 1,
            scale_y: m.scale_y || 1
          }));
          onExtractedMetersUpdate?.([...extractedMeters, ...scanned]);
          toast.success(`Scanned ${scanned.length} meters`);
        }
      } 
      // Case B: Regions drawn - scan each region
      else {
        let allExtractedMeters: any[] = [];
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < drawnRegions.length; i++) {
          const region = drawnRegions[i];
          
          // Ensure imageWidth and imageHeight are present (they might be missing from old regions)
          const imageWidth = region.imageWidth || (fabricCanvas as any)?.originalImageWidth || 2000;
          const imageHeight = region.imageHeight || (fabricCanvas as any)?.originalImageHeight || 2000;
          
          console.log(`🔍 Scanning region ${i + 1}:`, {
            pixels: {
              x: Math.round(region.x),
              y: Math.round(region.y),
              width: Math.round(region.width),
              height: Math.round(region.height)
            },
            imageSize: { w: imageWidth, h: imageHeight }
          });
          toast.info(`Scanning region ${i + 1} of ${drawnRegions.length}...`);
          
          try {
            const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
              body: { 
                imageUrl: schematicUrl,
                filePath: filePath || null,
                mode: 'extract-region',
                region: {
                  x: region.x,
                  y: region.y,
                  width: region.width,
                  height: region.height,
                  imageWidth: imageWidth,
                  imageHeight: imageHeight
                }
              }
            });
            
            if (error) {
              console.error(`Error scanning region ${i + 1}:`, error);
              errorCount++;
              continue;
            }
            
            if (data && data.meter) {
              // Store region coordinates as percentages for rendering
              // Position should be top-left corner, not center
              const newMeter = {
                ...data.meter,
                status: 'pending' as const,
                position: {
                  x: (region.x / imageWidth) * 100,  // Top-left X as percentage
                  y: (region.y / imageHeight) * 100   // Top-left Y as percentage
                },
                extractedRegion: {
                  x: (region.x / imageWidth) * 100,
                  y: (region.y / imageHeight) * 100,
                  width: (region.width / imageWidth) * 100,
                  height: (region.height / imageHeight) * 100
                },
                scale_x: 1,
                scale_y: 1
              };
              allExtractedMeters.push(newMeter);
              successCount++;
            }
          } catch (err) {
            console.error(`Failed to scan region ${i + 1}:`, err);
            errorCount++;
          }
        }
        
        // Add all extracted meters to state
        if (allExtractedMeters.length > 0) {
          const updatedMeters = [...extractedMeters, ...allExtractedMeters];
          setExtractedMeters(updatedMeters);
          if (onExtractedMetersUpdate) {
            onExtractedMetersUpdate(updatedMeters);
          }
        }
        
        // Show result toast
        if (successCount > 0 && errorCount === 0) {
          toast.success(`Extracted ${successCount} meters from ${drawnRegions.length} regions`);
          // Clear regions after successful extraction
          handleClearRegions();
        } else if (successCount > 0 && errorCount > 0) {
          toast.warning(`Extracted ${successCount} meters, ${errorCount} regions failed`);
          // Clear regions after extraction (even with some errors)
          handleClearRegions();
        } else {
          toast.error(`Failed to extract meters from all regions`);
        }
      }
    } catch (e) {
      console.error('Scan failed:', e);
      toast.error('Scan failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearRegions = () => {
    if (drawnRegions.length === 0) {
      toast.info('No regions to clear');
      return;
    }
    
    // Remove all region rectangles and labels from canvas
    if (fabricCanvas) {
      drawnRegions.forEach(region => {
        if (region.fabricRect) {
          fabricCanvas.remove(region.fabricRect);
        }
        if ((region as any).fabricLabel) {
          fabricCanvas.remove((region as any).fabricLabel);
        }
      });
      fabricCanvas.renderAll();
    }
    
    setDrawnRegions([]);
    toast.success('All regions cleared');
  };

  return (
    <div className="space-y-4">
      {/* Action buttons and Save/Edit in separate sections */}
      <div className="flex gap-2 items-start justify-between">
        {/* Left side: Action buttons that can wrap */}
        <div className="flex gap-2 items-center flex-wrap flex-1">
          <Button onClick={handleScanAll} disabled={!isEditMode || isSaving} variant="outline">
            <Scan className="w-4 h-4 mr-2" />
            {isSaving ? 'Scanning...' : (drawnRegions.length > 0 ? 'Scan All Regions' : 'Scan All Meters')}
          </Button>
          <Button
            variant={activeTool === "draw" ? "default" : "outline"}
            onClick={() => {
              if (activeTool === "draw") {
                // If already in draw mode, toggle it off and clear all regions
                setActiveTool("select");
                
                // Clear regions silently if there are any
                if (drawnRegions.length > 0) {
                  if (fabricCanvas) {
                    drawnRegions.forEach(region => {
                      if (region.fabricRect) {
                        fabricCanvas.remove(region.fabricRect);
                      }
                      if ((region as any).fabricLabel) {
                        fabricCanvas.remove((region as any).fabricLabel);
                      }
                    });
                    fabricCanvas.renderAll();
                  }
                  setDrawnRegions([]);
                  toast.info("Region selection disabled - all regions cleared");
                } else {
                  toast.info("Region selection disabled");
                }
              } else {
                // Enable draw mode
                setActiveTool("draw");
                toast.info("Left-click to draw regions. Hold middle mouse + drag to pan.", { duration: 4000 });
              }
            }}
            disabled={!isEditMode}
            size="sm"
            className="gap-2"
          >
            <Scan className="w-4 h-4" />
            Select Regions {drawnRegions.length > 0 && `(${drawnRegions.length})`}
          </Button>
          {drawnRegions.length > 0 && (
            <Button
              variant="destructive"
              onClick={handleClearRegions}
              disabled={!isEditMode}
              size="sm"
              className="gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Clear Regions
            </Button>
          )}
          <Button
            variant={activeTool === "meter" ? "default" : "outline"}
            onClick={() => setActiveTool("meter")}
            disabled={!isEditMode}
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Meter
          </Button>
          <Button
            variant={activeTool === "move" ? "default" : "outline"}
            onClick={() => setActiveTool("move")}
            disabled={!isEditMode}
            size="sm"
          >
            <Move className="w-4 h-4 mr-2" />
            Move
          </Button>
          <Button
            variant={activeTool === "connection" ? "default" : "outline"}
            onClick={() => setActiveTool("connection")}
            disabled={!isEditMode}
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
            detectedRectangles={[]}
            onRectanglesUpdate={() => {}}
            isDrawingMode={isDrawingMode}
            onDrawingModeChange={setIsDrawingMode}
            drawnRegions={drawnRegions}
            onDrawnRegionsUpdate={setDrawnRegions}
          />
          <Button onClick={handleClearLines} variant="destructive" size="sm" disabled={!isEditMode}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Lines
          </Button>
        </div>
        
        {/* Right side: Save and Edit buttons - always stay top right */}
        <div className="flex gap-2 items-center shrink-0">
          <Button onClick={handleSave} disabled={!isEditMode || isSaving} variant="outline" size="sm">
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
          <Button
            variant={isEditMode ? "default" : "outline"}
            onClick={() => {
              setIsEditMode(!isEditMode);
              if (!isEditMode) {
                setActiveTool("select");
                toast.success("Edit mode enabled");
              } else {
                // Cancel edit mode and reset active tool
                setActiveTool("select");
                toast.info("Edit mode cancelled - unsaved changes discarded");
              }
            }}
            size="sm"
          >
            <Zap className="w-4 h-4 mr-2" />
            {isEditMode ? "Cancel" : "Edit"}
          </Button>
        </div>
      </div>

      {/* Legend and PDF Controls in two panes */}
      <div className="flex gap-4 mb-2">
        {/* Left pane - Legends */}
        <div className="flex-1 space-y-3 p-2">
          {/* Top row - Zones */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="text-xs font-medium text-muted-foreground mr-2 flex items-center">Zones:</div>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 ${!legendVisibility.council_connection_zone ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, council_connection_zone: !prev.council_connection_zone }))}
            >
              <div className="w-3 h-3 rounded-full bg-[#ec4899] mr-2" />
              Council Connection
            </Badge>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 ${!legendVisibility.mini_sub_zone ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, mini_sub_zone: !prev.mini_sub_zone }))}
            >
              <div className="w-3 h-3 rounded-full bg-[#06b6d4] mr-2" />
              Mini Sub
            </Badge>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 ${!legendVisibility.main_board_zone ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, main_board_zone: !prev.main_board_zone }))}
            >
              <div className="w-3 h-3 rounded-full bg-[#9333ea] mr-2" />
              Main Board
            </Badge>
          </div>
          
          {/* Middle row - Meters */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="text-xs font-medium text-muted-foreground mr-2 flex items-center">Meters:</div>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 ${!legendVisibility.bulk_meter ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, bulk_meter: !prev.bulk_meter }))}
            >
              <div className="w-3 h-3 rounded-full bg-[#ef4444] mr-2" />
              Bulk Meter
            </Badge>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 ${!legendVisibility.check_meter ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, check_meter: !prev.check_meter }))}
            >
              <div className="w-3 h-3 rounded-full bg-[#f59e0b] mr-2" />
              Check Meter
            </Badge>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 ${!legendVisibility.submeter ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, submeter: !prev.submeter }))}
            >
              <div className="w-3 h-3 rounded-full bg-[#10b981] mr-2" />
              Tenant Meter
            </Badge>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 ${!legendVisibility.other ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, other: !prev.other }))}
            >
              <div className="w-3 h-3 rounded-full bg-[#3b82f6] mr-2" />
              Other
            </Badge>
          </div>
          
          {/* Bottom row - Extracted Meters Status (Always visible, greyed out when not applicable) */}
          <div className={`flex gap-3 flex-wrap items-center transition-opacity ${extractedMeters.length === 0 ? 'opacity-40' : ''}`}>
            <div className="text-xs font-medium text-muted-foreground mr-2 flex items-center">Extracted:</div>
            <Badge variant="outline">
              <div className="w-3 h-3 rounded-full bg-[#dc2626] border-2 border-[#dc2626] mr-2" />
              Unconfirmed
            </Badge>
            <Badge variant="outline">
              <div className="w-3 h-3 rounded-full bg-[#f59e0b] border-2 border-[#f59e0b] mr-2" />
              Needs Review
            </Badge>
            <Badge variant="outline">
              <div className="w-3 h-3 rounded-full bg-[#16a34a] border-2 border-[#16a34a] mr-2" />
              Confirmed
            </Badge>
          </div>
        </div>

        {/* Right pane - PDF Zoom Controls */}
        <div className="flex items-end pb-2">
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
        </div>
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
                <Label htmlFor="zone">Zone</Label>
                <Select name="zone">
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select zone (optional)" />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="main_board">Main Board</SelectItem>
                    <SelectItem value="mini_sub">Mini Sub</SelectItem>
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

      {/* Meter Confirmation Dialog for Extracted Meters */}
      <Dialog open={isConfirmMeterDialogOpen} onOpenChange={setIsConfirmMeterDialogOpen}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-red-600">⚠️ Verify Meter Data</span>
              {selectedMeterIndex !== null && extractedMeters[selectedMeterIndex] && (
                <Badge variant="outline" className="ml-2">
                  {extractedMeters[selectedMeterIndex].meter_number}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              <strong className="text-red-600">CRITICAL:</strong> Verify every field carefully. This data will be used for billing and legal compliance. Check serial numbers twice.
            </DialogDescription>
          </DialogHeader>
          
          {selectedMeterIndex !== null && extractedMeters[selectedMeterIndex] && (
            <div className="grid grid-cols-2 gap-6">
              {/* Left side: Extracted region from PDF */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">Scanned Area from PDF</Label>
                <div className="border-2 border-primary rounded-lg overflow-hidden bg-muted">
                  {extractedMeters[selectedMeterIndex].extractedRegion ? (
                    <div 
                      className="relative w-full" 
                      style={{
                        height: '600px',
                        backgroundImage: `url(${schematicUrl})`,
                        backgroundSize: `${100 / (extractedMeters[selectedMeterIndex].extractedRegion.width / 100)}% auto`,
                        backgroundPosition: `-${extractedMeters[selectedMeterIndex].extractedRegion.x / (extractedMeters[selectedMeterIndex].extractedRegion.width / 100)}% -${extractedMeters[selectedMeterIndex].extractedRegion.y / (extractedMeters[selectedMeterIndex].extractedRegion.height / 100)}%`,
                        backgroundRepeat: 'no-repeat',
                      }}
                    >
                      {/* Border highlight showing the extracted region */}
                      <div className="absolute inset-2 border-2 border-green-500 pointer-events-none"></div>
                    </div>
                  ) : (
                    <div className="relative w-full h-[600px] flex items-center justify-center text-muted-foreground">
                      No region data available
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  This is the exact area you drew on the PDF - verify all fields match this region
                </p>
              </div>

              {/* Right side: Form fields */}
              <form onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                
                // Update the extracted meter with verified data
                const updated = [...extractedMeters];
                updated[selectedMeterIndex] = {
                  ...updated[selectedMeterIndex],
                  meter_number: formData.get('meter_number') as string,
                  name: formData.get('name') as string,
                  area: formData.get('area') as string,
                  rating: formData.get('rating') as string,
                  cable_specification: formData.get('cable_specification') as string,
                  serial_number: formData.get('serial_number') as string,
                  ct_type: formData.get('ct_type') as string,
                  meter_type: formData.get('meter_type') as string,
                  zone: formData.get('zone') as string || null,
                  status: 'approved'
                };
                
                onExtractedMetersUpdate?.(updated);
                setIsConfirmMeterDialogOpen(false);
                setSelectedMeterIndex(null);
                toast.success('Meter data verified and confirmed');
              }} className="space-y-4">
                <Label className="text-base font-semibold">Extracted Data - Verify Each Field</Label>
                
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                  <div className="space-y-2">
                    <Label htmlFor="confirm_meter_number" className="flex items-center gap-2">
                      NO (Meter Number) *
                      {extractedMeters[selectedMeterIndex].meter_number?.includes('VERIFY:') && (
                        <Badge variant="destructive" className="text-xs">NEEDS VERIFICATION</Badge>
                      )}
                    </Label>
                    <Input 
                      id="confirm_meter_number" 
                      name="meter_number" 
                      required 
                      defaultValue={extractedMeters[selectedMeterIndex].meter_number?.replace('VERIFY:', '') || ''}
                      placeholder="DB-01W"
                      className={extractedMeters[selectedMeterIndex].meter_number?.includes('VERIFY:') ? 'border-red-500' : ''}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm_name">NAME *</Label>
                    <Input 
                      id="confirm_name" 
                      name="name" 
                      required 
                      defaultValue={extractedMeters[selectedMeterIndex].name?.replace('VERIFY:', '') || ''}
                      placeholder="CAR WASH"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm_area">AREA (with m²) *</Label>
                    <Input 
                      id="confirm_area" 
                      name="area" 
                      required 
                      defaultValue={extractedMeters[selectedMeterIndex].area?.replace('VERIFY:', '').replace('NOT_VISIBLE', '') || ''}
                      placeholder="187m²"
                      className={extractedMeters[selectedMeterIndex].area?.includes('NOT_VISIBLE') ? 'border-orange-500' : ''}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm_rating">RATING *</Label>
                    <Input 
                      id="confirm_rating" 
                      name="rating" 
                      required 
                      defaultValue={extractedMeters[selectedMeterIndex].rating?.replace('VERIFY:', '') || ''}
                      placeholder="80A TP"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm_cable_specification">CABLE SPECIFICATION *</Label>
                    <Input 
                      id="confirm_cable_specification" 
                      name="cable_specification" 
                      required 
                      defaultValue={extractedMeters[selectedMeterIndex].cable_specification?.replace('VERIFY:', '') || ''}
                      placeholder="4C x 16mm² ALU ECC CABLE"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm_serial_number" className="flex items-center gap-2">
                      SERIAL NUMBER * 
                      <Badge variant="destructive" className="text-xs">VERIFY TWICE</Badge>
                    </Label>
                    <Input 
                      id="confirm_serial_number" 
                      name="serial_number" 
                      required 
                      defaultValue={extractedMeters[selectedMeterIndex].serial_number?.replace('VERIFY:', '').replace('NOT_VISIBLE', '') || ''}
                      placeholder="34020113A"
                      className="font-mono text-lg border-red-300 focus:border-red-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm_ct_type">CT TYPE *</Label>
                    <Input 
                      id="confirm_ct_type" 
                      name="ct_type" 
                      required 
                      defaultValue={extractedMeters[selectedMeterIndex].ct_type?.replace('VERIFY:', '') || ''}
                      placeholder="DOL or 150/5A"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm_meter_type">METER TYPE *</Label>
                    <Select name="meter_type" required defaultValue={extractedMeters[selectedMeterIndex].meter_type || 'distribution'}>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select meter type" />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        <SelectItem value="council_bulk">Council Bulk Supply (Main Incoming)</SelectItem>
                        <SelectItem value="check_meter">Check Meter (Verification)</SelectItem>
                        <SelectItem value="distribution">Distribution Meter</SelectItem>
                        <SelectItem value="solar">Solar Generation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm_zone">ZONE</Label>
                    <Select name="zone">
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select zone (optional)" />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        <SelectItem value="main_board">Main Board</SelectItem>
                        <SelectItem value="mini_sub">Mini Sub</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-2 pt-4 border-t">
                  <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700">
                    <Check className="h-4 w-4 mr-2" />
                    Confirm & Approve
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => {
                      setIsConfirmMeterDialogOpen(false);
                      setSelectedMeterIndex(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="button" 
                    variant="destructive" 
                    onClick={() => {
                      if (selectedMeterIndex !== null) {
                        const updated = extractedMeters.filter((_, i) => i !== selectedMeterIndex);
                        onExtractedMetersUpdate?.(updated);
                        setIsConfirmMeterDialogOpen(false);
                        setSelectedMeterIndex(null);
                        toast.success('Meter rejected and removed');
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Reject
                  </Button>
                </div>
              </form>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Meter Dialog for Database Meters */}
      <Dialog open={isEditMeterDialogOpen} onOpenChange={setIsEditMeterDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Meter Details</DialogTitle>
            <DialogDescription>
              Update the meter information
            </DialogDescription>
          </DialogHeader>
          {editingMeter && (
            <form onSubmit={handleUpdateMeter} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_meter_number">NO (Meter Number) *</Label>
                  <Input 
                    id="edit_meter_number" 
                    name="meter_number" 
                    required 
                    defaultValue={editingMeter.meter_number}
                    placeholder="DB-03" 
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_name">NAME *</Label>
                  <Input 
                    id="edit_name" 
                    name="name" 
                    required 
                    defaultValue={editingMeter.name || ''}
                    placeholder="ACKERMANS" 
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_area">AREA (m²)</Label>
                  <Input 
                    id="edit_area" 
                    name="area" 
                    type="number" 
                    step="0.01" 
                    defaultValue={editingMeter.area || ''}
                    placeholder="406" 
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_rating">RATING *</Label>
                  <Input 
                    id="edit_rating" 
                    name="rating" 
                    required 
                    defaultValue={editingMeter.rating || ''}
                    placeholder="100A TP" 
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label htmlFor="edit_cable_specification">CABLE *</Label>
                  <Input 
                    id="edit_cable_specification" 
                    name="cable_specification" 
                    required 
                    defaultValue={editingMeter.cable_specification || ''}
                    placeholder="4C x 50mm² ALU ECC CABLE" 
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_serial_number">SERIAL *</Label>
                  <Input 
                    id="edit_serial_number" 
                    name="serial_number" 
                    required 
                    defaultValue={editingMeter.serial_number || ''}
                    placeholder="35777285" 
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_ct_type">CT *</Label>
                  <Input 
                    id="edit_ct_type" 
                    name="ct_type" 
                    required 
                    defaultValue={editingMeter.ct_type || ''}
                    placeholder="DOL" 
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_meter_type">Meter Type *</Label>
                  <Select name="meter_type" required defaultValue={editingMeter.meter_type}>
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
                  <Label htmlFor="edit_zone">Zone</Label>
                  <Select name="zone" defaultValue={editingMeter.zone || ''}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select zone (optional)" />
                    </SelectTrigger>
                    <SelectContent className="bg-background z-50">
                      <SelectItem value="main_board">Main Board</SelectItem>
                      <SelectItem value="mini_sub">Mini Sub</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_location">Location</Label>
                  <Input 
                    id="edit_location" 
                    name="location" 
                    defaultValue={editingMeter.location || ''}
                    placeholder="Building A, Floor 2" 
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label htmlFor="edit_tariff">Tariff</Label>
                  <Input 
                    id="edit_tariff" 
                    name="tariff" 
                    defaultValue={editingMeter.tariff || ''}
                    placeholder="Business Standard" 
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  Update Meter
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setIsEditMeterDialogOpen(false);
                    setEditingMeter(null);
                  }}
                >
                  Cancel
                </Button>
                <Button 
                  type="button" 
                  variant="destructive" 
                  onClick={async () => {
                    if (!editingMeter || !confirm(`Are you sure you want to delete meter ${editingMeter.meter_number}? This will also delete all associated readings and positions.`)) return;
                    
                    // Delete meter position first
                    const { error: posError } = await supabase
                      .from('meter_positions')
                      .delete()
                      .eq('meter_id', editingMeter.id);
                    
                    if (posError) {
                      console.error('Error deleting meter position:', posError);
                    }
                    
                    // Delete meter connections
                    await supabase
                      .from('meter_connections')
                      .delete()
                      .or(`child_meter_id.eq.${editingMeter.id},parent_meter_id.eq.${editingMeter.id}`);
                    
                    // Delete the meter (readings will be cascade deleted by database)
                    const { error } = await supabase
                      .from('meters')
                      .delete()
                      .eq('id', editingMeter.id);
                    
                    if (error) {
                      toast.error('Failed to delete meter');
                      console.error('Delete error:', error);
                      return;
                    }
                    
                    toast.success('Meter deleted successfully');
                    setIsEditMeterDialogOpen(false);
                    setEditingMeter(null);
                    fetchMeters();
                    fetchMeterPositions();
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            </form>
          )}
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
