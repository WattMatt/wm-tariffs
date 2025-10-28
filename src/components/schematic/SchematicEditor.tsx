/**
 * SchematicEditor Component
 * 
 * An interactive schematic editor built with Fabric.js v6 for React.
 * Handles meter placement, repositioning, connection drawing, and region extraction.
 * 
 * ==================================================================================
 * CRITICAL: FABRIC.JS + REACT STATE MANAGEMENT PATTERN
 * ==================================================================================
 * 
 * This component uses Fabric.js for canvas manipulation, which creates a unique
 * challenge: Fabric.js event handlers (mouse:down, mouse:move, mouse:up) are
 * registered ONCE when the canvas is initialized but need access to the LATEST
 * React state values.
 * 
 * THE PROBLEM - Stale Closures:
 * --------------------------------
 * When Fabric.js event handlers are registered, they capture the current values
 * of state variables at registration time. If state changes later, the handlers
 * still reference the OLD values, causing bugs like:
 * - Drawing mode not activating properly
 * - Repositioning mode using stale meter data
 * - Tool changes not being reflected in interactions
 * 
 * THE SOLUTION - Refs for Event Handlers:
 * ----------------------------------------
 * We use a dual system:
 * 1. STATE for UI rendering and React lifecycle
 * 2. REFS for Fabric.js event handler access (always current)
 * 
 * PATTERN TO FOLLOW:
 * ------------------
 * For ANY state that needs to be accessed in Fabric.js event handlers:
 * 
 * 1. Create BOTH a state AND a ref:
 *    const [activeTool, setActiveTool] = useState("select");
 *    const activeToolRef = useRef("select");
 * 
 * 2. Sync ref with state using useEffect:
 *    useEffect(() => {
 *      activeToolRef.current = activeTool;
 *    }, [activeTool]);
 * 
 * 3. In Fabric.js event handlers, ALWAYS use the ref:
 *    canvas.on('mouse:down', (opt) => {
 *      const currentTool = activeToolRef.current; // NOT activeTool!
 *      // ... handle interaction based on currentTool
 *    });
 * 
 * 4. Update state normally in React event handlers:
 *    <Button onClick={() => setActiveTool("draw")}>Draw</Button>
 * 
 * EXAMPLES IN THIS COMPONENT:
 * ----------------------------
 * - activeTool / activeToolRef (lines ~307)
 * - repositioningMeter / repositioningMeterRef (lines ~351, ~356)
 * - repositionStartPoint / repositionStartPointRef (lines ~352, ~357)
 * - isRepositionDragging / isRepositionDraggingRef (lines ~353, ~358)
 * 
 * WHY THIS WORKS:
 * ---------------
 * - Refs are mutable and persist across renders without triggering re-renders
 * - When we update a ref via useEffect, ALL event handlers immediately see the new value
 * - State still drives UI updates and React's declarative model
 * - No need to re-register event handlers when state changes
 * 
 * WHEN TO USE THIS PATTERN:
 * --------------------------
 * Use refs for Fabric.js event handler access when:
 * ✅ State determines canvas interaction behavior (tool modes, edit states)
 * ✅ State changes frequently and event handlers need current values
 * ✅ You encounter "stale closure" bugs where handlers use old data
 * 
 * DO NOT overuse refs:
 * ❌ For UI-only state that Fabric.js never accesses
 * ❌ For derived values that can be computed from other state
 * ❌ For simple callbacks that don't depend on changing state
 * 
 * DEBUGGING TIPS:
 * ---------------
 * If canvas interactions behave unexpectedly:
 * 1. Check if event handlers read from state instead of refs
 * 2. Verify useEffect syncs are in place for all critical refs
 * 3. Add console.logs comparing state vs ref values in handlers
 * 4. Ensure refs are updated BEFORE any asynchronous operations
 * 
 * ==================================================================================
 */

import { useEffect, useRef, useState } from "react";
import { Canvas as FabricCanvas, Circle, Line, Text, FabricImage, Rect, Polygon, util, Point } from "fabric";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Zap, Link2, Trash2, Upload, Plus, ZoomIn, ZoomOut, Maximize2, Pencil, Scan, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CsvImportDialog from "@/components/site/CsvImportDialog";
import { MeterDataExtractor } from "./MeterDataExtractor";
import { MeterFormFields } from "./MeterFormFields";

// Helper function to calculate snap points for a meter card
const calculateSnapPoints = (left: number, top: number, width: number, height: number) => {
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  
  return {
    top: { x: centerX, y: top },
    right: { x: left + width, y: centerY },
    bottom: { x: centerX, y: top + height },
    left: { x: left, y: centerY }
  };
};

// Helper function to find nearest snap point
const findNearestSnapPoint = (targetX: number, targetY: number, snapPoints: ReturnType<typeof calculateSnapPoints>) => {
  let nearest = { ...snapPoints.top, edge: 'top' };
  let minDistance = Math.hypot(snapPoints.top.x - targetX, snapPoints.top.y - targetY);
  
  Object.entries(snapPoints).forEach(([edge, point]) => {
    const distance = Math.hypot(point.x - targetX, point.y - targetY);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = { ...point, edge };
    }
  });
  
  return nearest;
};

// Helper function to create an arrow head polygon
const createArrowHead = (fromX: number, fromY: number, toX: number, toY: number, color: string) => {
  const headLength = 15;
  const headWidth = 10;
  
  // Calculate angle
  const angle = Math.atan2(toY - fromY, toX - fromX);
  
  // Calculate arrow head points
  const point1 = {
    x: toX - headLength * Math.cos(angle - Math.PI / 6),
    y: toY - headLength * Math.sin(angle - Math.PI / 6)
  };
  
  const point2 = {
    x: toX - headLength * Math.cos(angle + Math.PI / 6),
    y: toY - headLength * Math.sin(angle + Math.PI / 6)
  };
  
  return new Polygon([
    { x: toX, y: toY },
    { x: point1.x, y: point1.y },
    { x: point2.x, y: point2.y }
  ], {
    fill: color,
    selectable: false,
    evented: false,
  });
};

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

// Helper function to create meter card as an image matching reference format
async function createMeterCardImage(
  fields: Array<{ label: string; value: string }>,
  borderColor: string,
  targetWidth: number = 200,
  targetHeight: number = 140
): Promise<string> {
  // Create at higher resolution for better text clarity
  const baseWidth = 600;  // Increased width to prevent text cropping
  const baseHeight = 210; // Increased height proportionally
  
  const canvas = document.createElement('canvas');
  canvas.width = baseWidth;
  canvas.height = baseHeight;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return '';
  
  const rowHeight = baseHeight / fields.length;
  const labelColumnWidth = 180; // Proportional to base width
  
  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, baseWidth, baseHeight);
  
  // Main outer border
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, baseWidth, baseHeight);
  
  // Draw each row
  fields.forEach((field, i) => {
    const y = i * rowHeight;
    
    // Vertical separator between label and value columns
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(labelColumnWidth, y);
    ctx.lineTo(labelColumnWidth, y + rowHeight);
    ctx.stroke();
    
    // Horizontal separator line (except after last row)
    if (i < fields.length - 1) {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y + rowHeight);
      ctx.lineTo(baseWidth, y + rowHeight);
      ctx.stroke();
    }
    
    // Label text (left column) - bold
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(field.label, 12, y + rowHeight / 2);
    
    // Value text (right column) - normal weight with adequate padding
    ctx.font = 'normal 16px Arial, sans-serif';
    const valueX = labelColumnWidth + 12;
    const maxValueWidth = baseWidth - valueX - 12; // Leave padding on right
    
    // Measure and truncate if needed
    let valueDisplay = field.value;
    let textWidth = ctx.measureText(valueDisplay).width;
    
    if (textWidth > maxValueWidth) {
      // Truncate with ellipsis
      while (textWidth > maxValueWidth && valueDisplay.length > 0) {
        valueDisplay = valueDisplay.slice(0, -1);
        textWidth = ctx.measureText(valueDisplay + '...').width;
      }
      valueDisplay += '...';
    }
    
    ctx.fillText(valueDisplay, valueX, y + rowHeight / 2);
  });
  
  return canvas.toDataURL();
}

// Helper function to create and render a meter card on the canvas
async function renderMeterCardOnCanvas(
  canvas: FabricCanvas,
  meter: any,
  meterIndex: number,
  canvasWidth: number,
  canvasHeight: number
): Promise<any> {
  // Create meter card image from meter data
  const fields = [
    { label: 'NO', value: meter.meter_number || 'N/A' },
    { label: 'NAME', value: meter.name || 'N/A' },
    { label: 'AREA', value: meter.area || 'N/A' },
    { label: 'RATING', value: meter.rating || 'N/A' },
    { label: 'SERIAL', value: meter.serial_number || 'N/A' },
  ];
  
  const meterCardDataUrl = await createMeterCardImage(fields, '#0e74dd', 200, 140);
  
  // Convert extracted region percentage to canvas pixels
  const region = meter.extractedRegion;
  if (!region) {
    console.error('No extracted region found for meter');
    return null;
  }
  
  const left = (region.x / 100) * canvasWidth;
  const top = (region.y / 100) * canvasWidth;
  const targetWidth = (region.width / 100) * canvasWidth;
  const targetHeight = (region.height / 100) * canvasHeight;
  
  // Calculate scale to match the drawn region size
  // Base card is 200x140
  const scaleX = targetWidth / 200;
  const scaleY = targetHeight / 140;
  
  return new Promise((resolve) => {
    FabricImage.fromURL(meterCardDataUrl, {
      crossOrigin: 'anonymous'
    }).then((img) => {
      img.set({
        left,
        top,
        scaleX,
        scaleY,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        lockRotation: true,
        cornerColor: '#0e74dd',
        cornerSize: 12,
        transparentCorners: false,
        borderColor: '#0e74dd',
      });
      
      // Store meter index for reference
      (img as any).meterIndex = meterIndex;
      (img as any).meterCardType = 'extracted';
      
      canvas.add(img);
      canvas.renderAll();
      resolve(img);
    });
  });
}
async function cropRegionAndUpload(
  imageUrl: string,
  x: number,
  y: number,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  schematicId: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = async () => {
      // Use the ACTUAL loaded image dimensions, not the passed sourceWidth/sourceHeight
      const actualWidth = img.naturalWidth;
      const actualHeight = img.naturalHeight;
      
      console.log('🖼️ Image dimensions:', {
        passed: { width: sourceWidth, height: sourceHeight },
        actual: { width: actualWidth, height: actualHeight },
        cropRegion: { x, y, width, height }
      });
      
      // Scale the crop coordinates if the passed dimensions don't match actual dimensions
      const scaleX = actualWidth / sourceWidth;
      const scaleY = actualHeight / sourceHeight;
      
      const scaledX = x * scaleX;
      const scaledY = y * scaleY;
      const scaledWidth = width * scaleX;
      const scaledHeight = height * scaleY;
      
      console.log('✂️ Scaled crop region:', {
        original: { x, y, width, height },
        scaled: { x: scaledX, y: scaledY, width: scaledWidth, height: scaledHeight },
        scaleFactors: { x: scaleX, y: scaleY }
      });
      
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = scaledWidth;
      cropCanvas.height = scaledHeight;
      const ctx = cropCanvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      // Crop from the source image using scaled coordinates
      ctx.drawImage(
        img,
        scaledX, scaledY,
        scaledWidth, scaledHeight,
        0, 0,
        scaledWidth, scaledHeight
      );
      
      // Convert to blob for upload
      cropCanvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('Failed to create blob'));
          return;
        }
        
        try {
          // Upload to Supabase Storage
          const fileName = `${schematicId}_${Date.now()}_${Math.round(x)}_${Math.round(y)}.png`;
          console.log('📤 Uploading cropped image to storage:', fileName);
          
          const { data, error } = await supabase.storage
            .from('meter-snippets')
            .upload(fileName, blob, {
              contentType: 'image/png',
              upsert: false
            });
          
          if (error) {
            console.error('❌ Upload error:', error);
            reject(error);
            return;
          }
          
          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('meter-snippets')
            .getPublicUrl(fileName);
          
          console.log('✅ Upload successful, public URL:', publicUrl);
          resolve(publicUrl);
        } catch (err) {
          console.error('❌ Upload failed:', err);
          reject(err);
        }
      }, 'image/png');
    };
    
    img.onerror = () => {
      reject(new Error('Failed to load image for cropping'));
    };
    
    img.src = imageUrl;
  });
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
  
  // FABRIC.JS EVENT HANDLER PATTERN: State + Ref for tool selection
  // State drives UI, ref provides current value to canvas event handlers
  const [activeTool, setActiveTool] = useState<"select" | "meter" | "connection" | "draw">("select");
  const activeToolRef = useRef<"select" | "meter" | "connection" | "draw">("select");
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
  const [selectedExtractedMeterIds, setSelectedExtractedMeterIds] = useState<string[]>([]);
  const [selectedRegionIndices, setSelectedRegionIndices] = useState<number[]>([]);
  const [meterPositions, setMeterPositions] = useState<MeterPosition[]>([]);
  const drawingRectRef = useRef<any>(null);
  const drawStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const startMarkerRef = useRef<any>(null);
  const [lines, setLines] = useState<SchematicLine[]>([]);
  const [meters, setMeters] = useState<any[]>([]);
  const [selectedMeterForConnection, setSelectedMeterForConnection] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<{ current: number; total: number } | null>(null);
  const [isAddMeterDialogOpen, setIsAddMeterDialogOpen] = useState(false);
  const [pendingMeterPosition, setPendingMeterPosition] = useState<{ x: number; y: number } | null>(null);
  const [isCsvDialogOpen, setIsCsvDialogOpen] = useState(false);
  const [extractedMeters, setExtractedMeters] = useState<any[]>(propExtractedMeters);
  const [meterCardObjects, setMeterCardObjects] = useState<Map<number, any>>(new Map()); // Maps meter index to Fabric object

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
  
  // FABRIC.JS EVENT HANDLER PATTERN: Repositioning state + refs
  // These control the "Reposition & Rescale" feature where users redraw meter card bounds
  // State drives UI updates, refs provide current values to mouse event handlers
  const [repositioningMeter, setRepositioningMeter] = useState<{ meterId?: string, positionId?: string, meterIndex?: number, isSaved: boolean } | null>(null);
  const [repositionStartPoint, setRepositionStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [isRepositionDragging, setIsRepositionDragging] = useState(false);
  
  // Refs synced with repositioning state to prevent stale closures in Fabric.js handlers
  const repositioningMeterRef = useRef<{ meterId?: string, positionId?: string, meterIndex?: number, isSaved: boolean } | null>(null);
  const repositionStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const isRepositionDraggingRef = useRef(false);
  
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

  // FABRIC.JS EVENT HANDLER PATTERN: Sync activeTool state to ref
  // This ensures canvas event handlers always read the current tool selection
  useEffect(() => {
    activeToolRef.current = activeTool;
    const newDrawingMode = activeTool === 'draw';
    setIsDrawingMode(newDrawingMode);
    
    // Ensure canvas selection is enabled in draw mode to allow editing rectangles
    if (fabricCanvas && activeTool === 'draw') {
      fabricCanvas.selection = true;
    }
  }, [activeTool, fabricCanvas]);

  // FABRIC.JS EVENT HANDLER PATTERN: Sync repositioning state to refs
  // Critical for the reposition feature - without this, mouse handlers use stale meter data
  useEffect(() => {
    repositioningMeterRef.current = repositioningMeter;
    repositionStartPointRef.current = repositionStartPoint;
    isRepositionDraggingRef.current = isRepositionDragging;
  }, [repositioningMeter, repositionStartPoint, isRepositionDragging]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 1400,
      height: 900,
      backgroundColor: "#f8f9fa",
      selection: true, // Enable selection by default
      renderOnAddRemove: true, // Ensure immediate rendering
      enableRetinaScaling: true, // Better control rendering on high-DPI displays
    });

    // Handle scroll/wheel events for navigation and zoom - CONSISTENT ACROSS ALL MODES
    canvas.on('mouse:wheel', (opt) => {
      const evt = opt.e as WheelEvent;
      evt.preventDefault();
      evt.stopPropagation();

      const delta = evt.deltaY;
      
      // CTRL + SCROLL: Zoom in/out
      if (evt.ctrlKey || evt.metaKey) {
        let newZoom = canvas.getZoom();
        newZoom *= 0.999 ** delta;
        
        // Clamp zoom between 10% and 2000%
        newZoom = Math.min(Math.max(0.1, newZoom), 20);
        
        // Zoom to cursor position
        const point = new Point(evt.offsetX, evt.offsetY);
        canvas.zoomToPoint(point, newZoom);
        
        setZoom(newZoom);
      }
      // SHIFT + SCROLL: Pan left/right
      else if (evt.shiftKey) {
        canvas.relativePan(new Point(-delta, 0));
        
        // Update controls after pan
        requestAnimationFrame(() => {
          const activeObj = canvas.getActiveObject();
          if (activeObj) {
            activeObj.setCoords();
            canvas.requestRenderAll();
          }
        });
      }
      // SCROLL alone: Pan up/down
      else {
        canvas.relativePan(new Point(0, -delta));
        
        // Update controls after pan
        requestAnimationFrame(() => {
          const activeObj = canvas.getActiveObject();
          if (activeObj) {
            activeObj.setCoords();
            canvas.requestRenderAll();
          }
        });
      }
    });

    // Mouse handlers for drawing rectangles when in draw mode
    let isDrawing = false;
    let startPoint: { x: number; y: number } | null = null;
    
    canvas.on('mouse:down', (opt) => {
      const currentTool = activeToolRef.current;
      
      // Only handle drawing if in draw mode
      if (currentTool !== 'draw') return;
      
      const pointer = canvas.getPointer(opt.e);
      isDrawing = true;
      startPoint = { x: pointer.x, y: pointer.y };
      
      // Create start marker
      const marker = new Circle({
        left: pointer.x,
        top: pointer.y,
        radius: 5,
        fill: '#3b82f6',
        stroke: '#ffffff',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
      startMarkerRef.current = marker;
      canvas.add(marker);
      
      // Store start point in ref
      drawStartPointRef.current = startPoint;
    });
    
    canvas.on('mouse:move', (opt) => {
      if (!isDrawing || !startPoint || activeToolRef.current !== 'draw') return;
      
      const pointer = canvas.getPointer(opt.e);
      
      // Remove previous preview rectangle
      if (drawingRectRef.current) {
        canvas.remove(drawingRectRef.current);
      }
      
      // Create new preview rectangle
      const left = Math.min(startPoint.x, pointer.x);
      const top = Math.min(startPoint.y, pointer.y);
      const width = Math.abs(pointer.x - startPoint.x);
      const height = Math.abs(pointer.y - startPoint.y);
      
      const rect = new Rect({
        left,
        top,
        width,
        height,
        fill: 'rgba(59, 130, 246, 0.05)',
        stroke: '#3b82f6',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
      });
      
      drawingRectRef.current = rect;
      canvas.add(rect);
      canvas.renderAll();
    });

    canvas.on('mouse:up', async (opt) => {
      const evt = opt.e as MouseEvent;
      
      // Handle rectangle drawing completion
      if (isDrawing && startPoint && activeToolRef.current === 'draw') {
        const pointer = canvas.getPointer(opt.e);
        
        // Calculate rectangle dimensions
        const left = Math.min(startPoint.x, pointer.x);
        const top = Math.min(startPoint.y, pointer.y);
        const width = Math.abs(pointer.x - startPoint.x);
        const height = Math.abs(pointer.y - startPoint.y);
        
        // Only create region if rectangle is large enough
        if (width > 20 && height > 20) {
          // Get original image dimensions
          const canvasWidth = canvas.getWidth();
          const canvasHeight = canvas.getHeight();
          const originalImageWidth = (canvas as any).originalImageWidth || canvasWidth;
          const originalImageHeight = (canvas as any).originalImageHeight || canvasHeight;
          
          // Convert from canvas display to original image coordinates
          const scaleX = originalImageWidth / canvasWidth;
          const scaleY = originalImageHeight / canvasHeight;
          
          const regionId = `region-${Date.now()}`;
          
          // Create permanent rectangle
          const permanentRect = new Rect({
            left,
            top,
            width,
            height,
            fill: 'rgba(59, 130, 246, 0.05)',
            stroke: '#3b82f6',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true,
            lockRotation: true,
            cornerStyle: 'circle',
            cornerSize: 8,
            cornerColor: '#3b82f6',
            cornerStrokeColor: '#ffffff',
            transparentCorners: false,
            borderColor: '#3b82f6',
            borderDashArray: [5, 5],
            hoverCursor: 'move',
            moveCursor: 'move',
          });
          
          (permanentRect as any).regionId = regionId;
          
          // Store region data
          const newRegion = {
            id: regionId,
            x: left * scaleX,
            y: top * scaleY,
            width: width * scaleX,
            height: height * scaleY,
            imageWidth: originalImageWidth,
            imageHeight: originalImageHeight,
            displayLeft: left,
            displayTop: top,
            displayWidth: width,
            displayHeight: height,
            fabricRect: permanentRect
          };
          
          setDrawnRegions(prev => [...prev, newRegion]);
          
          // Remove preview and marker
          if (drawingRectRef.current) {
            canvas.remove(drawingRectRef.current);
            drawingRectRef.current = null;
          }
          if (startMarkerRef.current) {
            canvas.remove(startMarkerRef.current);
            startMarkerRef.current = null;
          }
          
          canvas.add(permanentRect);
          canvas.renderAll();
          
          toast.success('Region drawn successfully');
        } else {
          // Rectangle too small
          if (drawingRectRef.current) {
            canvas.remove(drawingRectRef.current);
            drawingRectRef.current = null;
          }
          if (startMarkerRef.current) {
            canvas.remove(startMarkerRef.current);
            startMarkerRef.current = null;
          }
          canvas.renderAll();
        }
        
        // Reset drawing state
        isDrawing = false;
        startPoint = null;
        drawStartPointRef.current = null;
        return;
      }
      
      // REPOSITIONING MODE: Apply new position and scale
      // CRITICAL: Use refs to check current repositioning state and start point
      // This ensures we have the latest values when completing the repositioning action
      if (repositioningMeterRef.current && repositionStartPointRef.current) {
        // Only apply changes if user actually dragged (checked via ref)
        if (!isRepositionDraggingRef.current) {
          // User just clicked without dragging, ignore
          setRepositionStartPoint(null);
          repositionStartPointRef.current = null;
          return;
        }

        const pointer = canvas.getPointer(opt.e);
        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();
        
        // Remove preview rectangle
        const existingPreview = canvas.getObjects().find((obj: any) => obj.repositionPreview);
        if (existingPreview) {
          canvas.remove(existingPreview);
        }
        
        // Check for zero-size rectangle
        if (Math.abs(pointer.x - repositionStartPointRef.current.x) < 1 || 
            Math.abs(pointer.y - repositionStartPointRef.current.y) < 1) {
          toast.error("Rectangle too small. Please draw a larger area.");
          fabricCanvas?.getObjects().forEach((obj: any) => {
            obj.set({ opacity: 1 });
          });
          canvas.renderAll();
          setRepositionStartPoint(null);
          repositionStartPointRef.current = null;
          setIsRepositionDragging(false);
          isRepositionDraggingRef.current = false;
          return;
        }
        
        const newX = Math.min(repositionStartPointRef.current.x, pointer.x) / canvasWidth;
        const newY = Math.min(repositionStartPointRef.current.y, pointer.y) / canvasHeight;
        const newScaleX = Math.abs(pointer.x - repositionStartPointRef.current.x) / canvasWidth;
        const newScaleY = Math.abs(pointer.y - repositionStartPointRef.current.y) / canvasHeight;
        
        console.log('Updating meter position:', {
          meterId: repositioningMeterRef.current.meterId,
          positionId: repositioningMeterRef.current.positionId,
          x: newX, y: newY,
          scaleX: newScaleX, scaleY: newScaleY
        });
        
        // Update database
        const updatePosition = async () => {
          try {
            const { error } = await supabase
              .from('meter_positions')
              .update({
                x_position: newX,
                y_position: newY,
                scale_x: newScaleX,
                scale_y: newScaleY,
                updated_at: new Date().toISOString()
              })
              .eq('id', repositioningMeterRef.current!.positionId);
            
            if (error) throw error;
            
            toast.success("Meter position updated successfully!");
            
            // Restore opacity and refresh
            fabricCanvas?.getObjects().forEach((obj: any) => {
              obj.set({ opacity: 1 });
            });
            canvas.renderAll();
            
            // Refresh positions
            await fetchMeterPositions();
            
          } catch (error: any) {
            console.error('Error updating meter position:', error);
            toast.error(error.message || "Failed to update meter position");
            
            // Restore opacity on error
            fabricCanvas?.getObjects().forEach((obj: any) => {
              obj.set({ opacity: 1 });
            });
            canvas.renderAll();
          }
        };
        
        updatePosition();
        
        // Restore canvas state
        if (fabricCanvas) {
          fabricCanvas.selection = true;
          fabricCanvas.defaultCursor = 'default';
        }
        
        setRepositioningMeter(null);
        setRepositionStartPoint(null);
        setIsRepositionDragging(false);
        repositioningMeterRef.current = null;
        repositionStartPointRef.current = null;
        isRepositionDraggingRef.current = false;
        return;
      }
      
      // No other mouse:up handling needed since we removed all mouse interaction
    });
    
    // Handle rectangle resize and move - update region data AND meter card changes
    canvas.on('object:modified', (e) => {
      const obj = e.target;
      
      // Handle region rectangles
      if (obj && obj.type === 'rect' && (obj as any).regionId) {
        const regionId = (obj as any).regionId;
        const rect = obj as Rect;
        
        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();
        const originalImageWidth = (canvas as any).originalImageWidth || canvasWidth;
        const originalImageHeight = (canvas as any).originalImageHeight || canvasHeight;
        
        const left = rect.left || 0;
        const top = rect.top || 0;
        const width = (rect.width || 0) * (rect.scaleX || 1);
        const height = (rect.height || 0) * (rect.scaleY || 1);
        
        // Convert from canvas display coordinates to original image pixel coordinates
        const scaleX = originalImageWidth / canvasWidth;
        const scaleY = originalImageHeight / canvasHeight;
        
        // Update the region in state
        setDrawnRegions(prev => prev.map(region => {
          if (region.id === regionId) {
            return {
              ...region,
              x: left * scaleX,
              y: top * scaleY,
              width: width * scaleX,
              height: height * scaleY,
              displayLeft: left,
              displayTop: top,
              displayWidth: width,
              displayHeight: height,
            };
          }
          return region;
        }));
        
        canvas.renderAll();
      }
      
      // Handle meter card objects  
      if (obj && obj.type === 'image' && (obj as any).meterCardType === 'extracted') {
        const meterIndex = (obj as any).meterIndex;
        const img = obj as FabricImage;
        
        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();
        const originalImageWidth = (canvas as any).originalImageWidth || canvasWidth;
        const originalImageHeight = (canvas as any).originalImageHeight || canvasHeight;
        
        const left = img.left || 0;
        const top = img.top || 0;
        const scaleX = img.scaleX || 1;
        const scaleY = img.scaleY || 1;
        
        // Calculate width/height of card in canvas pixels
        const cardWidth = 200 * scaleX;
        const cardHeight = 140 * scaleY;
        
        // Convert to percentages relative to original image
        const positionXPercent = (left / canvasWidth) * 100;
        const positionYPercent = (top / canvasHeight) * 100;
        const widthPercent = (cardWidth / canvasWidth) * 100;
        const heightPercent = (cardHeight / canvasHeight) * 100;
        
        // Update meter data
        setExtractedMeters(prev => {
          const updated = [...prev];
          if (updated[meterIndex]) {
            updated[meterIndex] = {
              ...updated[meterIndex],
              position: {
                x: positionXPercent,
                y: positionYPercent
              },
              extractedRegion: {
                ...updated[meterIndex].extractedRegion,
                x: positionXPercent,
                y: positionYPercent,
                width: widthPercent,
                height: heightPercent
              },
              scale_x: scaleX,
              scale_y: scaleY
            };
            
            if (onExtractedMetersUpdate) {
              onExtractedMetersUpdate(updated);
            }
          }
          return updated;
        });
        
        toast.success('Meter card position/size updated');
      }
    });
    
    // No need for object:moving handler since we removed labels
    
    // Function to handle extraction from a drawn region
    const handleExtractFromRegion = async (canvas: FabricCanvas, rect: any) => {
      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();
      
      const left = rect.left || 0;
      const top = rect.top || 0;
      const width = rect.width || 0;
      const height = rect.height || 0;
      
      if (width > 20 && height > 20) {
      // Get original image dimensions and scale from canvas
      const originalImageWidth = (canvas as any).originalImageWidth || canvasWidth;
      const originalImageHeight = (canvas as any).originalImageHeight || canvasHeight;
      
      // Convert from canvas display coordinates to original image pixel coordinates
      const scaleX = originalImageWidth / canvasWidth;
      const scaleY = originalImageHeight / canvasHeight;
      
      const imageLeft = left * scaleX;
      const imageTop = top * scaleY;
      const imageWidth = width * scaleX;
      const imageHeight = height * scaleY;
        
        try {
          toast.info('Extracting meter data from selected region...');
          
          const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
            body: { 
              imageUrl: schematicUrl,
              filePath: filePath || null,
              mode: 'extract-region',
              region: {
                x: imageLeft,
                y: imageTop,
                width: imageWidth,
                height: imageHeight,
                imageWidth: originalImageWidth,
                imageHeight: originalImageHeight
              }
            }
          });
          
          if (error) {
            console.error('Edge function error:', error);
            throw error;
          }
          
          if (data && data.meter) {
            // Store position as percentages for consistent rendering
            const positionXPercent = (imageLeft / originalImageWidth) * 100;
            const positionYPercent = (imageTop / originalImageHeight) * 100;
            const widthPercent = (imageWidth / originalImageWidth) * 100;
            const heightPercent = (imageHeight / originalImageHeight) * 100;
            
            // Add extracted meter to the list with position at center of drawn region
            const newMeter = {
              ...data.meter,
              status: 'pending' as const,
              position: {
                x: positionXPercent,
                y: positionYPercent
              },
              extractedRegion: {
                x: positionXPercent,
                y: positionYPercent,
                width: widthPercent,
                height: heightPercent
              },
              scale_x: 1,
              scale_y: 1
            };
            
            const updatedMeters = [...extractedMeters, newMeter];
            const newMeterIndex = updatedMeters.length - 1;
            
            setExtractedMeters(updatedMeters);
            if (onExtractedMetersUpdate) {
              onExtractedMetersUpdate(updatedMeters);
            }
            
            // Render the meter card on the canvas
            try {
              const meterCardObject = await renderMeterCardOnCanvas(
                canvas,
                newMeter,
                newMeterIndex,
                canvasWidth,
                canvasHeight
              );
              
              if (meterCardObject) {
                // Track this object for future updates
                setMeterCardObjects(prev => {
                  const updated = new Map(prev);
                  updated.set(newMeterIndex, meterCardObject);
                  return updated;
                });
              }
            } catch (err) {
              console.error('Failed to render meter card:', err);
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
      
      // Store original image dimensions for region coordinate conversion
      (canvas as any).originalImageWidth = imgWidth;
      (canvas as any).originalImageHeight = imgHeight;
      
      canvas.setDimensions({ width: canvasWidth, height: canvasHeight });
      
      img.scale(scale);
      img.set({ 
        left: 0, 
        top: 0,
        selectable: false,
        evented: false,
      });
      // Mark as background image
      (img as any).isBackgroundImage = true;
      canvas.add(img);
      canvas.sendObjectToBack(img);
      canvas.renderAll();
    });

    return () => {
      canvas.dispose();
    };
  }, [schematicUrl]);

  // ESCAPE KEY: Cancel repositioning mode
  // CRITICAL: Uses repositioningMeterRef to check current repositioning state
  // This ensures the handler can detect and cancel repositioning even when state has changed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && repositioningMeterRef.current) {
        e.preventDefault();
        
        // Restore opacity of all objects
        if (fabricCanvas) {
          fabricCanvas.getObjects().forEach((obj: any) => {
            obj.set({ opacity: 1 });
          });
          
          // Remove any preview rectangle
          const existingPreview = fabricCanvas.getObjects().find((obj: any) => obj.repositionPreview);
          if (existingPreview) {
            fabricCanvas.remove(existingPreview);
          }
          
          // Restore canvas state
          fabricCanvas.selection = true;
          fabricCanvas.defaultCursor = 'default';
          fabricCanvas.renderAll();
        }
        
        // Clear repositioning state
        setRepositioningMeter(null);
        setRepositionStartPoint(null);
        setIsRepositionDragging(false);
        repositioningMeterRef.current = null;
        repositionStartPointRef.current = null;
        isRepositionDraggingRef.current = false;
        
        toast.info("Repositioning cancelled");
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [fabricCanvas]);

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
    
    // Clear all objects except the background schematic image
    const objects = fabricCanvas.getObjects();
    objects.forEach(obj => {
      // Keep only the marked background image
      if (!(obj as any).isBackgroundImage) {
        fabricCanvas.remove(obj);
      }
    });

    // Render saved lines with arrow heads
    lines.forEach(line => {
      const fabricLine = new Line([line.from_x, line.from_y, line.to_x, line.to_y], {
        stroke: line.color,
        strokeWidth: line.stroke_width,
        selectable: false,
        evented: false,
      });
      fabricCanvas.add(fabricLine);
      
      // Add arrow head to show electricity flow direction (from child to parent)
      const arrowHead = createArrowHead(line.from_x, line.from_y, line.to_x, line.to_y, line.color);
      fabricCanvas.add(arrowHead);
    });

    // Render extracted meters (from AI extraction)
    extractedMeters.forEach((meter, meterIndex) => {
      if (!meter.position && !meter.extractedRegion) {
        return;
      }
      
      const capturedIndex = meterIndex;
      
      const canvasWidth = fabricCanvas.getWidth();
      const canvasHeight = fabricCanvas.getHeight();
      
      let x, y, cardWidth, cardHeight;
      
      // Use extractedRegion for absolute positioning if available
      if (meter.extractedRegion) {
        // Convert percentage to absolute pixels
        x = (meter.extractedRegion.x / 100) * canvasWidth;
        y = (meter.extractedRegion.y / 100) * canvasHeight;
        cardWidth = (meter.extractedRegion.width / 100) * canvasWidth;
        cardHeight = (meter.extractedRegion.height / 100) * canvasHeight;
      } else if (meter.position) {
        // Fallback to position if no region data - center origin
        x = (meter.position.x / 100) * canvasWidth - 100; // Center to top-left conversion
        y = (meter.position.y / 100) * canvasHeight - 70;
        cardWidth = 200;
        cardHeight = 140;
      } else {
        return;
      }
      
      // NO SCALING - use absolute dimensions directly
      let borderColor = '#dc2626';
      let fillColor = '#ffffff';
      
      // Check for fields that need verification
      const needsVerification = Object.values(meter).some((val: any) => 
        typeof val === 'string' && (val.includes('VERIFY:') || val === 'NOT_VISIBLE' || val === '*')
      );
      
      // Check if this meter is selected
      const isSelected = selectedExtractedMeterIds.includes(`extracted-${capturedIndex}`);
      
      if (isSelected) {
        borderColor = '#8b5cf6'; // PURPLE for selected
        fillColor = 'rgba(139, 92, 246, 0.1)';
      } else if (meter.status === 'approved') {
        borderColor = '#16a34a'; // GREEN for confirmed
        fillColor = '#f0fdf4';
      } else if (needsVerification) {
        borderColor = '#f59e0b'; // ORANGE for needs verification
        fillColor = '#fff7ed';
      }
      
      const strokeWidth = isSelected ? 4 : 3;
      
      const rowHeight = cardHeight / 7;

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

      // Generate meter card image
      createMeterCardImage(fields, borderColor, cardWidth, cardHeight).then(imageDataUrl => {
        // Load image from data URL
        const imgElement = document.createElement('img');
        imgElement.src = imageDataUrl;
        
        imgElement.onload = () => {
          // Calculate scale to fit the target rectangle
          const scaleX = cardWidth / imgElement.width;
          const scaleY = cardHeight / imgElement.height;
          
          // Create fabric image with scaling to fit rectangle
          const img = new FabricImage(imgElement, {
            left: x,
            top: y,
            originX: 'center',
            originY: 'center',
            scaleX: scaleX,
            scaleY: scaleY,
            hasControls: isEditMode,
            selectable: isEditMode,
            hoverCursor: isEditMode ? 'move' : 'pointer',
            lockRotation: true,
            lockScalingX: true,
            lockScalingY: true,
          });
          
          // Store the actual meter data
          img.set('data', { 
            type: 'extracted', 
            index: capturedIndex,
            meterNumber: meter.meter_number,
            meterData: meter 
          });
          
          // Add double-click handler to open edit dialog
          img.on('mousedblclick', () => {
            if (!isEditMode) return;
            const objectData = img.get('data') as any;
            const meterIndex = objectData.index;
            const meter = extractedMeters[meterIndex];
            console.log('🔍 Opening dialog for meter:', {
              index: meterIndex,
              hasScannedSnippet: !!meter?.scannedImageSnippet,
              snippetUrl: meter?.scannedImageSnippet,
              fullMeter: meter
            });
            setSelectedMeterIndex(meterIndex);
            setIsConfirmMeterDialogOpen(true);
          });

          // Add shift+click multi-select handler
          img.on('mousedown', (e) => {
            if (e.e.shiftKey && isEditMode) {
              handleToggleSelectMeter(capturedIndex);
              e.e.stopPropagation();
              e.e.preventDefault();
            }
          });

          // Handle drag repositioning
          img.on('modified', () => {
            // Update position in extracted meters state
            const newX = ((img.left || 0) / canvasWidth) * 100;
            const newY = ((img.top || 0) / canvasHeight) * 100;
            
            const updatedMeters = [...extractedMeters];
            updatedMeters[capturedIndex] = {
              ...updatedMeters[capturedIndex],
              position: { x: newX, y: newY },
            };
            setExtractedMeters(updatedMeters);
            if (onExtractedMetersUpdate) {
              onExtractedMetersUpdate(updatedMeters);
            }
            toast.success('Meter position updated');
          });

          // Add border overlay if selected
          if (isSelected) {
            const border = new Rect({
              left: x,
              top: y,
              width: cardWidth,
              height: cardHeight,
              fill: 'transparent',
              stroke: borderColor,
              strokeWidth: strokeWidth,
              selectable: false,
              evented: false,
              originX: 'left',
              originY: 'top',
            });
            fabricCanvas.add(border);
          }

          fabricCanvas.add(img);
          
          // Add snap point indicators when in connection mode
          if (activeTool === 'connection') {
            const actualWidth = cardWidth * scaleX;
            const actualHeight = cardHeight * scaleY;
            const snapPoints = calculateSnapPoints(
              x - actualWidth / 2,
              y - actualHeight / 2,
              actualWidth,
              actualHeight
            );
            
            // Create small circles at each snap point
            Object.values(snapPoints).forEach(point => {
              const snapCircle = new Circle({
                left: point.x,
                top: point.y,
                radius: 6,
                fill: '#3b82f6',
                stroke: '#ffffff',
                strokeWidth: 2,
                originX: 'center',
                originY: 'center',
                selectable: false,
                evented: false,
                opacity: 0.8
              });
              (snapCircle as any).isSnapPoint = true;
              fabricCanvas.add(snapCircle);
            });
          }
          
          fabricCanvas.renderAll();
        };
      });
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

      // Create table data
      const cardWidth = 200;
      const cardHeight = zone ? 160 : 140;
      
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

      const savedScaleX = (pos as any).scale_x ? Number((pos as any).scale_x) : 1.0;
      const savedScaleY = (pos as any).scale_y ? Number((pos as any).scale_y) : 1.0;
      
      // Generate meter card image
      createMeterCardImage(fields, borderColor, cardWidth, cardHeight).then(imageDataUrl => {
        // Load image from data URL
        const imgElement = document.createElement('img');
        imgElement.src = imageDataUrl;
        
        imgElement.onload = () => {
          // Calculate base scale to fit the target rectangle
          const baseScaleX = cardWidth / imgElement.width;
          const baseScaleY = cardHeight / imgElement.height;
          
          // Apply both base scale and saved scale
          const img = new FabricImage(imgElement, {
            left: x,
            top: y,
            originX: 'center',
            originY: 'center',
            scaleX: baseScaleX * savedScaleX,
            scaleY: baseScaleY * savedScaleY,
            hasControls: isEditMode,
            selectable: isEditMode,
            hoverCursor: isEditMode ? 'move' : (activeTool === 'connection' ? 'pointer' : 'default'),
            lockRotation: true,
          });
          
          img.set('data', { meterId: pos.meter_id, positionId: pos.id });
          
          // Add double-click handler to open edit dialog
          img.on('mousedblclick', () => {
            if (!isEditMode) return;
            setEditingMeter(meter);
            setIsEditMeterDialogOpen(true);
          });

          // Single click for connection mode
          img.on('mousedown', () => {
            if (activeTool === 'connection') {
              handleMeterClickForConnection(pos.meter_id, x, y);
            }
          });

          // Handle dragging and scaling in edit mode
          if (isEditMode) {
            img.on('modified', async () => {
              // Convert pixel positions back to percentages for storage
              const canvasWidth = fabricCanvas.getWidth();
              const canvasHeight = fabricCanvas.getHeight();
              const xPercent = ((img.left || 0) / canvasWidth) * 100;
              const yPercent = ((img.top || 0) / canvasHeight) * 100;
              
              // Extract user scale (removing base scale)
              const currentScaleX = img.scaleX || 1;
              const currentScaleY = img.scaleY || 1;
              const userScaleX = currentScaleX / baseScaleX;
              const userScaleY = currentScaleY / baseScaleY;

              // Update position and scale in database after drag/resize
              const { error } = await supabase
                .from('meter_positions')
                .update({
                  x_position: xPercent,
                  y_position: yPercent,
                  scale_x: userScaleX,
                  scale_y: userScaleY,
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

          fabricCanvas.add(img);
          
          // Add snap point indicators when in connection mode
          if (activeTool === 'connection') {
            const actualWidth = cardWidth * baseScaleX * savedScaleX;
            const actualHeight = cardHeight * baseScaleY * savedScaleY;
            const snapPoints = calculateSnapPoints(
              x - actualWidth / 2,
              y - actualHeight / 2,
              actualWidth,
              actualHeight
            );
            
            // Create small circles at each snap point
            Object.values(snapPoints).forEach(point => {
              const snapCircle = new Circle({
                left: point.x,
                top: point.y,
                radius: 6,
                fill: '#3b82f6',
                stroke: '#ffffff',
                strokeWidth: 2,
                originX: 'center',
                originY: 'center',
                selectable: false,
                evented: false,
                opacity: 0.8
              });
              (snapCircle as any).isSnapPoint = true;
              fabricCanvas.add(snapCircle);
            });
          }
          
          fabricCanvas.renderAll();
        };
      });
    });

    fabricCanvas.renderAll();
  }, [fabricCanvas, meterPositions, lines, meters, activeTool, extractedMeters, legendVisibility, selectedExtractedMeterIds]);

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
    const parentPos = meterPositions.find(p => p.meter_id === parentId);
    if (!childPos || !parentPos || !fabricCanvas) return;

    // Convert percentage positions to pixel for line drawing
    const canvasWidth = fabricCanvas.getWidth();
    const canvasHeight = fabricCanvas.getHeight();
    
    // Calculate meter card dimensions (assuming standard card size)
    const cardWidth = 200;
    const cardHeight = 120;
    
    // Calculate positions and snap points for both meters
    const childX = (childPos.x_position / 100) * canvasWidth;
    const childY = (childPos.y_position / 100) * canvasHeight;
    const parentX = (parentPos.x_position / 100) * canvasWidth;
    const parentY = (parentPos.y_position / 100) * canvasHeight;
    
    const childSnapPoints = calculateSnapPoints(childX - cardWidth/2, childY - cardHeight/2, cardWidth, cardHeight);
    const parentSnapPoints = calculateSnapPoints(parentX - cardWidth/2, parentY - cardHeight/2, cardWidth, cardHeight);
    
    // Find nearest snap points on each meter
    const childSnap = findNearestSnapPoint(parentX, parentY, childSnapPoints);
    const parentSnap = findNearestSnapPoint(childX, childY, parentSnapPoints);

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

    // Save line with snapped coordinates
    const { error: lineError } = await supabase
      .from("schematic_lines")
      .insert({
        schematic_id: schematicId,
        from_x: childSnap.x,
        from_y: childSnap.y,
        to_x: parentSnap.x,
        to_y: parentSnap.y,
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
    toast.success("Schematic saved successfully");
    setIsSaving(false);
    setIsEditMode(false);
    setActiveTool("select");
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

  // Helper function to start repositioning mode for a meter
  const startRepositioningMode = (meterData: { meterId?: string, positionId?: string, meterIndex?: number, isSaved: boolean }) => {
    setRepositioningMeter(meterData);
    
    // Disable canvas selection and change cursor for drawing mode
    if (fabricCanvas) {
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
    }
    
    // Dim other objects for visual clarity
    fabricCanvas?.getObjects().forEach((obj: any) => {
      if (meterData.meterIndex !== undefined) {
        // For unsaved meters, compare against meter card object
        const meterCard = meterCardObjects.get(meterData.meterIndex);
        if (obj !== meterCard) {
          obj.set({ opacity: 0.2 });
        }
      } else if (meterData.meterId) {
        // For saved meters, compare against meterId in object data
        const objData = obj.get('data');
        if (!objData || objData.meterId !== meterData.meterId) {
          obj.set({ opacity: 0.2 });
        }
      }
    });
    fabricCanvas?.renderAll();
    toast.info("Draw a rectangle to reposition and rescale this meter card");
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
      // Case B: Regions drawn - scan each region and create meters
      else {
        let successCount = 0;
        let errorCount = 0;
        
        // Initialize progress tracking
        setExtractionProgress({ current: 0, total: drawnRegions.length });
        
        for (let i = 0; i < drawnRegions.length; i++) {
          const region = drawnRegions[i];
          
          // Update progress
          setExtractionProgress({ current: i + 1, total: drawnRegions.length });
          
          // Ensure imageWidth and imageHeight are present
          const imageWidth = region.imageWidth || (fabricCanvas as any)?.originalImageWidth || 2000;
          const imageHeight = region.imageHeight || (fabricCanvas as any)?.originalImageHeight || 2000;
          
          toast.info(`Scanning region ${i + 1} of ${drawnRegions.length}...`);
          
          try {
            const croppedImageUrl = await cropRegionAndUpload(
              schematicUrl,
              region.x,
              region.y,
              region.width,
              region.height,
              imageWidth,
              imageHeight,
              schematicId
            );
            
            // Calculate position percentages for this region
            const xPercent = (region.x / imageWidth) * 100;
            const yPercent = (region.y / imageHeight) * 100;
            
            // Try to extract meter data
            let extractedMeterData: any = null;
            try {
              const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
                body: { 
                  imageUrl: croppedImageUrl,
                  filePath: null,
                  mode: 'extract-region',
                  region: {
                    x: 0,
                    y: 0,
                    width: region.width,
                    height: region.height,
                    imageWidth: region.width,
                    imageHeight: region.height
                  }
                }
              });
              
              if (!error && data?.meter) {
                extractedMeterData = data.meter;
              }
            } catch (extractError) {
              console.warn(`AI extraction failed for region ${i + 1}, will create empty meter:`, extractError);
            }
            
            // Create meter in database (with extracted data or empty)
            const meterNumber = extractedMeterData?.meter_number || `METER-${Date.now()}-${i}`;
            const { data: newMeter, error: meterError } = await supabase
              .from("meters")
              .insert({
                site_id: siteId,
                meter_number: meterNumber,
                name: extractedMeterData?.name || "VACANT",
                meter_type: extractedMeterData?.meter_type || "submeter",
                zone: extractedMeterData?.zone || null,
                area: extractedMeterData?.area ? parseFloat(extractedMeterData.area.replace('m²', '')) : null,
                rating: extractedMeterData?.rating || null,
                cable_specification: extractedMeterData?.cable_specification || null,
                serial_number: extractedMeterData?.serial_number || null,
                ct_type: extractedMeterData?.ct_type || null,
                location: null,
                tariff: null,
                is_revenue_critical: false,
              })
              .select()
              .single();
            
            if (meterError || !newMeter) {
              console.error(`Failed to create meter for region ${i + 1}:`, meterError);
              errorCount++;
              continue;
            }
            
            // Create meter position on schematic
            const { error: posError } = await supabase
              .from("meter_positions")
              .insert({
                schematic_id: schematicId,
                meter_id: newMeter.id,
                x_position: xPercent,
                y_position: yPercent,
                label: meterNumber,
                scale_x: 1.0,
                scale_y: 1.0
              });
            
            if (posError) {
              console.error(`Failed to create position for region ${i + 1}:`, posError);
              errorCount++;
            } else {
              successCount++;
              if (extractedMeterData) {
                toast.success(`Created meter ${meterNumber} with AI data`);
              } else {
                toast.info(`Created empty meter ${meterNumber} - edit to populate`);
              }
            }
          } catch (err) {
            console.error(`Failed to process region ${i + 1}:`, err);
            errorCount++;
          }
        }
        
        // Refresh meters and positions
        await fetchMeters();
        await fetchMeterPositions();
        
        // Show result toast
        if (successCount > 0 && errorCount === 0) {
          toast.success(`Created ${successCount} meters from ${drawnRegions.length} regions`);
          handleClearRegions();
          setActiveTool("select");
        } else if (successCount > 0 && errorCount > 0) {
          toast.warning(`Created ${successCount} meters, ${errorCount} regions failed`);
          handleClearRegions();
          setActiveTool("select");
        } else {
          toast.error(`Failed to create meters from all regions`);
        }
      }
    } catch (e) {
      console.error('Scan failed:', e);
      toast.error('Scan failed');
    } finally {
      setIsSaving(false);
      setExtractionProgress(null);
    }
  };

  const handleClearRegions = () => {
    if (drawnRegions.length === 0) {
      toast.info('No regions to clear');
      return;
    }
    
    // Remove all region rectangles from canvas
    if (fabricCanvas) {
      drawnRegions.forEach(region => {
        if (region.fabricRect) {
          fabricCanvas.remove(region.fabricRect);
        }
      });
      fabricCanvas.renderAll();
    }
    
    setDrawnRegions([]);
    toast.success('All regions cleared');
  };

  const handleToggleSelectMeter = (index: number) => {
    const meterId = `extracted-${index}`;
    setSelectedExtractedMeterIds(prev => 
      prev.includes(meterId) 
        ? prev.filter(id => id !== meterId)
        : [...prev, meterId]
    );
  };

  const handleSelectAllMeters = () => {
    if (selectedExtractedMeterIds.length === extractedMeters.length) {
      setSelectedExtractedMeterIds([]);
    } else {
      setSelectedExtractedMeterIds(extractedMeters.map((_, i) => `extracted-${i}`));
    }
  };

  const handleBulkApprove = async () => {
    const selectedIndices = selectedExtractedMeterIds.map(id => parseInt(id.split('-')[1]));
    const metersToApprove = selectedIndices.map(i => extractedMeters[i]);
    
    try {
      for (const meter of metersToApprove) {
        const { error } = await supabase
          .from('meters')
          .insert({
            site_id: siteId,
            meter_number: meter.meter_number,
            name: meter.name,
            area: meter.area,
            rating: meter.rating,
            cable_specification: meter.cable_specification,
            serial_number: meter.serial_number,
            ct_type: meter.ct_type,
            meter_type: meter.meter_type,
            zone: meter.zone,
          });
        
        if (error) throw error;
      }
      
      // Remove approved meters
      const updatedMeters = extractedMeters.filter((_, i) => !selectedIndices.includes(i));
      setExtractedMeters(updatedMeters);
      onExtractedMetersUpdate?.(updatedMeters);
      setSelectedExtractedMeterIds([]);
      
      toast.success(`Approved ${metersToApprove.length} meters`);
      fetchMeters();
      fetchMeterPositions();
    } catch (error) {
      console.error('Bulk approve error:', error);
      toast.error('Failed to approve some meters');
    }
  };

  const handleBulkDelete = () => {
    const selectedIndices = selectedExtractedMeterIds.map(id => parseInt(id.split('-')[1]));
    const updatedMeters = extractedMeters.filter((_, i) => !selectedIndices.includes(i));
    setExtractedMeters(updatedMeters);
    onExtractedMetersUpdate?.(updatedMeters);
    setSelectedExtractedMeterIds([]);
    toast.success(`Deleted ${selectedIndices.length} extracted meters`);
  };

  return (
    <div className="space-y-4">
      {/* First row: Scan All and Select Regions with Save/Edit buttons */}
      <div className="flex gap-2 items-start justify-between">
        {/* Left side: Scan buttons and selection badges */}
        <div className="flex gap-2 items-center flex-wrap flex-1">
          {selectedExtractedMeterIds.length > 0 && (
            <>
              <Button 
                onClick={handleSelectAllMeters} 
                variant="outline" 
                size="sm"
              >
                {selectedExtractedMeterIds.length === extractedMeters.length ? 'Deselect All' : 'Select All'}
              </Button>
              <Button 
                onClick={handleBulkApprove} 
                variant="default" 
                size="sm"
                className="gap-2"
              >
                <Check className="w-4 h-4" />
                Approve {selectedExtractedMeterIds.length}
              </Button>
              <Button 
                onClick={handleBulkDelete} 
                variant="destructive" 
                size="sm"
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete {selectedExtractedMeterIds.length}
              </Button>
              <div className="h-6 w-px bg-border" />
            </>
          )}
          <Button onClick={handleScanAll} disabled={!isEditMode || isSaving} variant="outline" size="sm">
            <Scan className="w-4 h-4 mr-2" />
            {(() => {
              const buttonText = drawnRegions.length > 0 ? 'Scan All Regions' : 'Scan All Meters';
              if (extractionProgress) {
                return `${buttonText} (${extractionProgress.current}/${extractionProgress.total})`;
              } else if (isSaving) {
                return 'Scanning...';
              }
              return buttonText;
            })()}
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
                    });
                    fabricCanvas.renderAll();
                  }
                  setDrawnRegions([]);
                  toast.info("Region drawing disabled - all regions cleared");
                } else {
                  toast.info("Region drawing disabled");
                }
              } else {
                // Enable draw mode
                setActiveTool("draw");
                toast.info("Click to draw regions. Use SCROLL to pan, CTRL+SCROLL to zoom, SHIFT+SCROLL for horizontal.", { duration: 4000 });
              }
            }}
            disabled={!isEditMode}
            size="sm"
            className="gap-2"
          >
            <Scan className="w-4 h-4" />
            Draw Regions {drawnRegions.length > 0 && `(${drawnRegions.length})`}
          </Button>
          <Button
            variant={selectedRegionIndices.length > 0 ? "default" : "outline"}
            onClick={() => {
              if (selectedRegionIndices.length > 0) {
                setSelectedRegionIndices([]);
                toast.info("Region selection cleared");
              } else {
                toast.info("Shift+click on regions to select them", { duration: 4000 });
              }
            }}
            disabled={!isEditMode || drawnRegions.length === 0}
            size="sm"
            className="gap-2"
          >
            <Scan className="w-4 h-4" />
            Select Regions {selectedRegionIndices.length > 0 && `(${selectedRegionIndices.length})`}
          </Button>
          <Button
            variant={activeTool === "connection" ? "default" : "outline"}
            onClick={() => setActiveTool(activeTool === "connection" ? "select" : "connection")}
            disabled={!isEditMode}
            size="sm"
            className="gap-2"
          >
            <Link2 className="w-4 h-4" />
            Draw Connections
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

      {/* Second row: Action buttons */}
      <div className="flex gap-2 items-center flex-wrap">
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
        {activeTool === 'connection' && (
          <Button onClick={handleClearLines} variant="destructive" size="sm" disabled={!isEditMode}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Lines
          </Button>
        )}
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
              <div className="space-y-2">
                <Label className="text-base font-semibold">Scanned Area from PDF</Label>
                {(() => {
                  const meter = extractedMeters[selectedMeterIndex];
                  console.log('🖼️ Rendering snippet section:', {
                    hasSnippet: !!meter.scannedImageSnippet,
                    snippetUrl: meter.scannedImageSnippet,
                    hasRegion: !!meter.extractedRegion
                  });
                  return (
                    <div className="border-2 border-primary rounded-lg overflow-hidden bg-muted/30 min-h-[400px] max-h-[600px] flex items-center justify-center p-2">
                      {meter.scannedImageSnippet ? (
                        <div className="w-full h-full flex items-center justify-center bg-white rounded">
                          <img 
                            src={meter.scannedImageSnippet} 
                            alt="Scanned meter region" 
                            className="max-w-full max-h-[580px] object-contain"
                            style={{ display: 'block' }}
                            onLoad={(e) => {
                              console.log('✅ Image loaded:', meter.scannedImageSnippet);
                              console.log('📐 Image natural size:', {
                                width: e.currentTarget.naturalWidth,
                                height: e.currentTarget.naturalHeight,
                                displayed: {
                                  width: e.currentTarget.width,
                                  height: e.currentTarget.height
                                }
                              });
                            }}
                            onError={(e) => {
                              console.error('❌ Image failed to load:', meter.scannedImageSnippet);
                              toast.error('Failed to load scanned image snippet');
                            }}
                          />
                        </div>
                      ) : meter.extractedRegion ? (
                        <div 
                          className="relative w-full" 
                          style={{
                            height: '600px',
                            backgroundImage: `url(${schematicUrl})`,
                            backgroundSize: `${(100 / meter.extractedRegion.width) * 100}% auto`,
                            backgroundPosition: `${-meter.extractedRegion.x * (100 / meter.extractedRegion.width)}% ${-meter.extractedRegion.y * (100 / meter.extractedRegion.width)}%`,
                            backgroundRepeat: 'no-repeat',
                          }}
                        >
                          <div className="absolute inset-2 border-2 border-green-500 pointer-events-none"></div>
                        </div>
                      ) : (
                        <div className="relative w-full h-[600px] flex items-center justify-center text-muted-foreground">
                          <div className="text-center">
                            <p className="font-semibold">No region data available</p>
                            <p className="text-xs mt-2">Debug: Check console for details</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <p className="text-xs text-muted-foreground text-center italic">
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsConfirmMeterDialogOpen(false);
                      if (selectedMeterIndex !== null) {
                        startRepositioningMode({ 
                          meterIndex: selectedMeterIndex,
                          isSaved: false 
                        });
                      }
                    }}
                    className="flex-1"
                  >
                    Reposition & Rescale
                  </Button>
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
              <MeterFormFields 
                idPrefix="edit"
                defaultValues={editingMeter}
                showLocationAndTariff={true}
                scannedImageSnippet={editingMeter.scannedImageSnippet}
              />

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsEditMeterDialogOpen(false);
                    const position = meterPositions.find(p => p.meter_id === editingMeter.id);
                    if (position) {
                      startRepositioningMode({ 
                        meterId: editingMeter.id, 
                        positionId: position.id,
                        isSaved: true 
                      });
                    }
                  }}
                  className="flex-1"
                >
                  Reposition & Rescale
                </Button>
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

      {repositioningMeter && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-background/95 border-2 border-green-500 p-6 rounded-lg shadow-2xl z-50 text-center">
          <h3 className="text-lg font-semibold mb-2">Reposition & Rescale Meter Card</h3>
          <p className="text-muted-foreground mb-4">
            Draw a rectangle around the desired area for this meter card.
          </p>
          <p className="text-sm text-muted-foreground">
            Press <kbd className="px-2 py-1 bg-muted rounded">ESC</kbd> to cancel
          </p>
        </div>
      )}

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
