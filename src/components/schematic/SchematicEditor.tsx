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
import { Canvas as FabricCanvas, Circle, Line, Text, FabricImage, Rect, Polygon, util, Point, Polyline } from "fabric";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Zap, Link2, Trash2, Upload, Plus, ZoomIn, ZoomOut, Maximize2, Pencil, Scan, Check, Edit, ChevronLeft, ChevronRight, Loader2, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CsvImportDialog from "@/components/site/CsvImportDialog";
import { MeterDataExtractor } from "./MeterDataExtractor";
import { MeterFormFields } from "./MeterFormFields";
import { MeterConnectionsManager } from "./MeterConnectionsManager";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";


interface SchematicEditorProps {
  schematicId: string;
  schematicUrl: string;
  siteId: string;
  filePath?: string;
  extractedMeters?: any[];
  onExtractedMetersUpdate?: (meters: any[]) => void;
  highlightedMeterId?: string;
}

interface MeterPosition {
  id: string;
  meter_id: string;
  x_position: number;
  y_position: number;
  label: string;
}


// Helper function to calculate snap points for a meter card
const calculateSnapPoints = (left: number, top: number, width: number, height: number) => {
  const snapRadius = 8; // Half the width of the snap point circle
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  
  return {
    top: { x: centerX, y: top - height / 2 + snapRadius },
    right: { x: left + width + width, y: centerY },
    bottom: { x: centerX, y: top + height + height / 2 - snapRadius },
    left: { x: left - width, y: centerY }
  };
};

// Helper function to find the nearest snap point within threshold distance
const findNearestSnapPoint = (
  canvas: FabricCanvas,
  pointer: { x: number; y: number },
  threshold: number = 10
): { x: number; y: number; meterId: string } | null => {
  let nearestPoint: { x: number; y: number; meterId: string } | null = null;
  let minDistance = threshold;
  
  // Find all snap point circles on the canvas
  canvas.getObjects().forEach((obj: any) => {
    if (obj.isSnapPoint && obj.type === 'circle') {
      const snapX = obj.left;
      const snapY = obj.top;
      
      const distance = Math.sqrt(
        Math.pow(pointer.x - snapX, 2) + Math.pow(pointer.y - snapY, 2)
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestPoint = { x: snapX, y: snapY, meterId: obj.meterId };
      }
    }
  });
  
  return nearestPoint;
};

// Helper function to snap a point to 45-degree angle increments
const snapToAngle = (
  fromPoint: { x: number; y: number },
  toPoint: { x: number; y: number }
): { x: number; y: number } => {
  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  // Calculate current angle in radians
  const currentAngle = Math.atan2(dy, dx);
  
  // Convert to degrees
  const currentAngleDeg = currentAngle * (180 / Math.PI);
  
  // Snap to nearest 45-degree increment
  const snappedAngleDeg = Math.round(currentAngleDeg / 45) * 45;
  
  // Convert back to radians
  const snappedAngle = snappedAngleDeg * (Math.PI / 180);
  
  // Calculate new position at the snapped angle
  return {
    x: fromPoint.x + Math.cos(snappedAngle) * distance,
    y: fromPoint.y + Math.sin(snappedAngle) * distance
  };
};

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
  ctx.lineWidth = 6;
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
      
      // Hide rotation control
      img.setControlVisible('mtr', false);
      
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
): Promise<{ previewUrl: string; blob: Blob }> {
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
      
      // Store blob in memory instead of uploading to temp
      // Convert to base64 data URL for sending to edge function
      const dataUrl = cropCanvas.toDataURL('image/png');
      
      cropCanvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('Failed to create blob'));
          return;
        }
        
        try {
          console.log('✅ Created blob for snippet (will upload on save)');
          
          // Return both the data URL (for edge function) and the blob (for later upload)
          resolve({ previewUrl: dataUrl, blob });
        } catch (err) {
          console.error('❌ Blob creation failed:', err);
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
  onExtractedMetersUpdate,
  highlightedMeterId
}: SchematicEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 1400, height: 900 });
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
  const selectionBoxRef = useRef<any>(null); // For drag multi-select box
  const isPanningRef = useRef(false);
  const lastPanPositionRef = useRef<{ x: number; y: number } | null>(null);
  const [meters, setMeters] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<{ current: number; total: number } | null>(null);
  const [isAddMeterDialogOpen, setIsAddMeterDialogOpen] = useState(false);
  const [pendingMeterPosition, setPendingMeterPosition] = useState<{ x: number; y: number } | null>(null);
  const [isInitialDataLoaded, setIsInitialDataLoaded] = useState(false);
  const [isCsvDialogOpen, setIsCsvDialogOpen] = useState(false);
  const [extractedMeters, setExtractedMeters] = useState<any[]>(propExtractedMeters);
  const [meterCardObjects, setMeterCardObjects] = useState<Map<number, any>>(new Map()); // Maps meter index to Fabric object

  // Sync extracted meters from props
  useEffect(() => {
    setExtractedMeters(propExtractedMeters);
  }, [propExtractedMeters]);
  
  // Set cursor to crosshair when in connection mode
  useEffect(() => {
    if (fabricCanvas) {
      if (activeTool === 'connection') {
        fabricCanvas.defaultCursor = 'crosshair';
        fabricCanvas.hoverCursor = 'crosshair';
      } else {
        fabricCanvas.defaultCursor = 'default';
        fabricCanvas.hoverCursor = 'move';
        
        // Clean up snap highlight when exiting connection mode
        const existingHighlight = fabricCanvas.getObjects().find((obj: any) => obj.isSnapHighlight);
        if (existingHighlight) {
          fabricCanvas.remove(existingHighlight);
        }
      }
      fabricCanvas.renderAll();
    }
  }, [activeTool, fabricCanvas]);
  const [selectedMeterIndex, setSelectedMeterIndex] = useState<number | null>(null);
  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);
  const [selectedMeterIds, setSelectedMeterIds] = useState<string[]>([]); // For bulk selection with Shift+click
  const [isSelectionMode, setIsSelectionMode] = useState(false); // Track whether selection mode is active
  const [deletionProgress, setDeletionProgress] = useState<{ current: number; total: number } | null>(null);
  
  // Scanning queue state
  type QueuedScan = { meterId: string; meterNumber: string; snippetUrl: string; };
  const [scanQueue, setScanQueue] = useState<QueuedScan[]>([]);
  const [currentlyScanning, setCurrentlyScanning] = useState<QueuedScan | null>(null);
  const [scannedCount, setScannedCount] = useState(0);
  const isProcessingQueue = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const [areMeterCardsLoaded, setAreMeterCardsLoaded] = useState(false);
  const [isEditMeterDialogOpen, setIsEditMeterDialogOpen] = useState(false);
  const [isBulkEditDialogOpen, setIsBulkEditDialogOpen] = useState(false);
  const [currentBulkEditIndex, setCurrentBulkEditIndex] = useState(0);
  const [bulkEditMeterIds, setBulkEditMeterIds] = useState<string[]>([]);
  const [selectedConnectionKeys, setSelectedConnectionKeys] = useState<string[]>([]);
  const [isConfirmMeterDialogOpen, setIsConfirmMeterDialogOpen] = useState(false);
  const [editingMeter, setEditingMeter] = useState<any>(null);
  const [isViewMeterDialogOpen, setIsViewMeterDialogOpen] = useState(false);
  const [viewingMeter, setViewingMeter] = useState<any>(null);
  const [showUnconfirmed, setShowUnconfirmed] = useState(true);
  const [showConfirmed, setShowConfirmed] = useState(true);
  const [showMeterCards, setShowMeterCards] = useState(true);
  const [showConnections, setShowConnections] = useState(true);
  const [showBackground, setShowBackground] = useState(true);
  const [isConnectionsDialogOpen, setIsConnectionsDialogOpen] = useState(false);
  const [connectionStart, setConnectionStart] = useState<{ meterId: string; position: { x: number; y: number } } | null>(null);
  const [connectionPoints, setConnectionPoints] = useState<Array<{ meterId: string; position: { x: number; y: number } }>>([]);
  const [meterConnections, setMeterConnections] = useState<any[]>([]);
  const [schematicLines, setSchematicLines] = useState<any[]>([]);
  const connectionLineRef = useRef<Line | Polyline | null>(null);
  const connectionStartNodeRef = useRef<Circle | null>(null);
  const connectionNodesRef = useRef<Circle[]>([]);
  
  // Ref for connectionStart to prevent stale closures in Fabric.js handlers
  const connectionStartRef = useRef<{ meterId: string; position: { x: number; y: number } } | null>(null);
  const connectionPointsRef = useRef<Array<{ meterId: string; position: { x: number; y: number } }>>([]);
  
  // FABRIC.JS EVENT HANDLER PATTERN: State + refs for complex interactions
  // State drives UI updates, refs provide current values to mouse event handlers
  
  // Ref for drawnRegions to prevent stale closures in Fabric.js handlers
  const drawnRegionsRef = useRef<typeof drawnRegions>([]);
  
  // Ref for selected meter IDs to prevent stale closures in Fabric.js handlers
  const selectedMeterIdsRef = useRef<string[]>([]);
  
  // Ref for selection mode to prevent stale closures in Fabric.js handlers
  const isSelectionModeRef = useRef(false);
  
  // Ref for edit mode to prevent stale closures in Fabric.js handlers
  const isEditModeRef = useRef(false);
  
  // Legend visibility toggles
  const [legendVisibility, setLegendVisibility] = useState({
    bulk_meter: true,
    check_meter: true,
    main_board_zone: true,
    mini_sub_zone: true,
    council_connection_zone: true,
    tenant_meter: true,
    other: true
  });

  // Load initial data on mount
  useEffect(() => {
    const loadInitialData = async () => {
      setIsInitialDataLoaded(false);
      await Promise.all([
        fetchMeters(),
        fetchMeterPositions(),
        fetchMeterConnections(),
        fetchSchematicLines()
      ]);
      setIsInitialDataLoaded(true);
    };
    loadInitialData();
  }, [schematicId, siteId]);

  // Real-time subscription for schematic_lines changes
  useEffect(() => {
    const channel = supabase
      .channel('schematic-lines-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'schematic_lines',
          filter: `schematic_id=eq.${schematicId}`
        },
        () => {
          console.log('🔄 Schematic lines changed, refreshing...');
          fetchSchematicLines();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [schematicId]);

  // FABRIC.JS EVENT HANDLER PATTERN: Sync activeTool state to ref
  // This ensures canvas event handlers always read the current tool selection
  useEffect(() => {
    activeToolRef.current = activeTool;
    const newDrawingMode = activeTool === 'draw';
    setIsDrawingMode(newDrawingMode);
    
    // Handle object selectability based on tool mode
    if (fabricCanvas) {
      if (activeTool === 'draw') {
        // In draw mode: enable selection but only for rectangles
        fabricCanvas.selection = true;
        fabricCanvas.getObjects().forEach((obj: any) => {
          // Only rectangles with regionId are selectable in draw mode
          if (obj.type === 'rect' && obj.regionId) {
            obj.selectable = true;
            obj.evented = true;
          } else {
            obj.selectable = false;
            obj.evented = false;
          }
        });
      } else {
        // In other modes: disable drag selection box
        fabricCanvas.selection = false;
        fabricCanvas.getObjects().forEach((obj: any) => {
          // Allow meter cards to be draggable in edit mode
          if (obj.type === 'image' && obj.data?.meterId && isEditMode) {
            obj.selectable = true;
            obj.evented = true;
          } else {
            obj.selectable = false;
            obj.evented = true; // Keep events for click handling
          }
        });
      }
      fabricCanvas.renderAll();
    }
  }, [activeTool, fabricCanvas, isEditMode]);

  // FABRIC.JS EVENT HANDLER PATTERN: Sync connectionStart state to ref
  // This ensures canvas event handlers always read the current connection start
  useEffect(() => {
    connectionStartRef.current = connectionStart;
  }, [connectionStart]);

  // Sync connectionPointsRef with connectionPoints state
  useEffect(() => {
    connectionPointsRef.current = connectionPoints;
  }, [connectionPoints]);

  // Update meter card selectability and controls when edit mode changes
  useEffect(() => {
    if (fabricCanvas) {
      fabricCanvas.getObjects().forEach((obj: any) => {
        // Update meter card images (they have meterId in their data)
        if (obj.type === 'image' && obj.data?.meterId) {
          obj.set({
            selectable: isEditMode,
            hasControls: isEditMode,
            hoverCursor: isEditMode ? 'move' : 'pointer'
          });
          // Hide rotation control in edit mode
          if (isEditMode) {
            obj.setControlVisible('mtr', false);
          }
        }
      });
      fabricCanvas.renderAll();
    }
  }, [isEditMode, fabricCanvas]);

  // Add/remove snap points when connection tool is activated/deactivated
  useEffect(() => {
    if (!fabricCanvas) return;

    // Remove all existing snap points
    const objectsToRemove: any[] = [];
    fabricCanvas.getObjects().forEach((obj: any) => {
      if (obj.isSnapPoint) {
        objectsToRemove.push(obj);
      }
    });
    objectsToRemove.forEach(obj => fabricCanvas.remove(obj));

    // Clear connection state when switching away from connection mode
    if (activeTool !== 'connection') {
      // Clean up any preview nodes and lines
      connectionNodesRef.current.forEach(node => fabricCanvas.remove(node));
      connectionNodesRef.current = [];
      
      if (connectionLineRef.current) {
        fabricCanvas.remove(connectionLineRef.current);
        connectionLineRef.current = null;
      }
      
      if (connectionStartNodeRef.current) {
        fabricCanvas.remove(connectionStartNodeRef.current);
        connectionStartNodeRef.current = null;
      }
      
      setConnectionPoints([]);
      setConnectionStart(null);
    }

    // Add snap points if in connection mode
    if (activeTool === 'connection') {
      fabricCanvas.getObjects().forEach((obj: any) => {
        if (obj.type === 'image' && obj.data?.meterId) {
          const bounds = obj.getBoundingRect();
          const snapPoints = calculateSnapPoints(bounds.left, bounds.top, bounds.width, bounds.height);
          
          Object.values(snapPoints).forEach((point: any) => {
            const snapCircle = new Circle({
              left: point.x,
              top: point.y,
              radius: 8,
              fill: '#3b82f6',
              originX: 'center',
              originY: 'center',
              selectable: false,
              evented: true,
              opacity: 0.9,
              hoverCursor: 'crosshair'
            });
            (snapCircle as any).isSnapPoint = true;
            (snapCircle as any).meterId = obj.data.meterId;
            
            fabricCanvas.add(snapCircle);
          });
        }
      });
    }

    fabricCanvas.renderAll();
  }, [activeTool, fabricCanvas]);


  // FABRIC.JS EVENT HANDLER PATTERN: Sync repositioning state to refs
  // Critical for the reposition feature - without this, mouse handlers use stale meter data

  // Sync drawnRegions to ref
  useEffect(() => {
    drawnRegionsRef.current = drawnRegions;
  }, [drawnRegions]);

  // Sync selectedMeterIds to ref
  useEffect(() => {
    selectedMeterIdsRef.current = selectedMeterIds;
  }, [selectedMeterIds]);

  // Sync isSelectionMode to ref
  useEffect(() => {
    isSelectionModeRef.current = isSelectionMode;
  }, [isSelectionMode]);

  // Sync isEditMode to ref
  useEffect(() => {
    isEditModeRef.current = isEditMode;
  }, [isEditMode]);

  // Update border colors when toggling edit mode
  useEffect(() => {
    if (!fabricCanvas || !meters.length) return;
    
    fabricCanvas.getObjects().forEach((obj: any) => {
      // Only update meter card images (not rectangles, lines, etc.)
      if (obj.type === 'image' && obj.data?.meterId) {
        const meterId = obj.data.meterId;
        const meter = meters.find(m => m.id === meterId);
        
        if (meter) {
          let borderColor = '#3b82f6'; // default blue
          
          if (isEditMode) {
            // Edit mode: Show confirmation status colors
            const confirmationStatus = (meter as any).confirmation_status || 'unconfirmed';
            
            if (confirmationStatus === 'confirmed') {
              borderColor = '#22c55e'; // green for confirmed
            } else {
              borderColor = '#ef4444'; // red for unconfirmed
            }
            
            obj.set({
              stroke: borderColor,
              strokeWidth: 4
            });
          } else {
            // Normal mode: Show zone colors
            const zone = meter.zone;
            
            if (zone === 'main_board') {
              borderColor = '#9333ea'; // purple for Main Board
              obj.set({
                stroke: borderColor,
                strokeWidth: 3
              });
            } else if (zone === 'mini_sub') {
              borderColor = '#06b6d4'; // cyan for Mini Sub
              obj.set({
                stroke: borderColor,
                strokeWidth: 3
              });
            } else if (zone === 'council') {
              borderColor = '#ec4899'; // pink for Council
              obj.set({
                stroke: borderColor,
                strokeWidth: 3
              });
            } else {
              // No zone: no border in normal mode
              obj.set({
                stroke: undefined,
                strokeWidth: 0
              });
            }
          }
        }
      }
    });
    
    fabricCanvas.renderAll();
  }, [isEditMode, fabricCanvas, meters]);

  // Control visibility based on confirmation status filters and meter cards toggle
  useEffect(() => {
    if (!fabricCanvas || !meters.length) return;
    
    fabricCanvas.getObjects().forEach((obj: any) => {
      if (obj.type === 'image' && obj.data?.meterId) {
        const meterId = obj.data.meterId;
        const meter = meters.find(m => m.id === meterId);
        
        if (meter) {
          const confirmationStatus = (meter as any).confirmation_status || 'unconfirmed';
          const shouldShow = 
            showMeterCards &&
            ((confirmationStatus === 'confirmed' && showConfirmed) ||
            (confirmationStatus === 'unconfirmed' && showUnconfirmed));
          
          obj.set({ visible: shouldShow });
        }
      }
    });
    
    fabricCanvas.renderAll();
  }, [showMeterCards, showConfirmed, showUnconfirmed, fabricCanvas, meters]);

  // Track container size and update canvas dimensions responsively
  useEffect(() => {
    if (!containerRef.current) return;

    const updateCanvasSize = () => {
      if (!containerRef.current) return;
      
      const containerWidth = containerRef.current.clientWidth;
      // Maintain 16:10 aspect ratio (close to original 1400:900)
      const containerHeight = Math.round(containerWidth * (900 / 1400));
      
      setCanvasDimensions({
        width: containerWidth,
        height: containerHeight
      });
    };

    // Initial size calculation
    updateCanvasSize();

    // Create ResizeObserver to track container size changes
    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: canvasDimensions.width,
      height: canvasDimensions.height,
      backgroundColor: "#f8f9fa",
      selection: true,
      renderOnAddRemove: true,
      enableRetinaScaling: true,
      controlsAboveOverlay: true,
      preserveObjectStacking: true,
    });
    
    // Add native mousedown listener with capture to intercept middle mouse button
    const handleNativeMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        
        // Middle mouse button starts panning
        isPanningRef.current = true;
        lastPanPositionRef.current = { x: e.clientX, y: e.clientY };
        canvas.selection = false;
      }
    };
    
    window.addEventListener('mousedown', handleNativeMouseDown, true);
    
    // Add mouseup listener to handle pan end even if mouse is released outside canvas
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 1 && isPanningRef.current) {
        isPanningRef.current = false;
        lastPanPositionRef.current = null;
        canvas.selection = true;
      }
    };
    window.addEventListener('mouseup', handleMouseUp);

    // Handle scroll/wheel events for navigation and zoom - CONSISTENT ACROSS ALL MODES
    canvas.on('mouse:wheel', (opt) => {
      const evt = opt.e as WheelEvent;
      evt.preventDefault();
      evt.stopPropagation();

      const delta = evt.deltaY;
      
      // CTRL + SCROLL: Pan up/down with dampening for smooth control
      if (evt.ctrlKey || evt.metaKey) {
        // Apply dampening multiplier (0.5) for smoother pan speed across devices
        canvas.relativePan(new Point(0, -delta * 0.5));
        
        // Update controls after pan
        requestAnimationFrame(() => {
          const activeObj = canvas.getActiveObject();
          if (activeObj) {
            activeObj.setCoords();
            canvas.requestRenderAll();
          }
        });
      }
      // SHIFT + SCROLL: Pan left/right with dampening for smooth control
      else if (evt.shiftKey) {
        // Apply dampening multiplier (0.5) for smoother pan speed across devices
        canvas.relativePan(new Point(-delta * 0.5, 0));
        
        // Update controls after pan
        requestAnimationFrame(() => {
          const activeObj = canvas.getActiveObject();
          if (activeObj) {
            activeObj.setCoords();
            canvas.requestRenderAll();
          }
        });
      }
      // SCROLL alone: Zoom in/out with fixed step-based multiplier
      else {
        let newZoom = canvas.getZoom();
        
        // Use consistent zoom steps: 1.1 for zoom in (delta < 0), 0.9 for zoom out (delta > 0)
        // This provides smooth, predictable zoom regardless of device or scroll speed
        const zoomStep = delta < 0 ? 1.1 : 0.9;
        newZoom *= zoomStep;
        
        // Clamp zoom between 50% and 1000% for usability
        newZoom = Math.min(Math.max(0.5, newZoom), 10);
        
        // Zoom to cursor position using original event coordinates (not affected by snap logic)
        const point = new Point(evt.offsetX, evt.offsetY);
        canvas.zoomToPoint(point, newZoom);
        
        setZoom(newZoom);
      }
    });


    // Mouse handlers for drawing rectangles when in draw mode AND drag multi-select
    let isDrawing = false;
    let isDragSelecting = false;
    let clickTarget: any = null; // Track target clicked for deferred selection
    let startPoint: { x: number; y: number } | null = null;
    
    canvas.on('mouse:down', (opt) => {
      const currentTool = activeToolRef.current;
      const evt = opt.e as MouseEvent;
      const target = opt.target;
      
      // Middle mouse button is handled by native window listener
      // to prevent browser default behavior
      if (evt.button === 1) {
        return;
      }
      
      // Handle connection drawing mode with snap
      if (currentTool === 'connection') {
        let pointer = canvas.getPointer(opt.e);
        
        // Handle connection line selection (single click without active drawing)
        if (!connectionStartRef.current && target && ((target as any).isConnectionLine || (target as any).isConnectionNode)) {
          const clickedConnectionKey = (target as any).connectionKey;
          
          if (clickedConnectionKey) {
            // Toggle selection
            if (selectedConnectionKeys.includes(clickedConnectionKey)) {
              setSelectedConnectionKeys(prev => prev.filter(k => k !== clickedConnectionKey));
              toast.info('Connection deselected');
            } else {
              setSelectedConnectionKeys([...selectedConnectionKeys, clickedConnectionKey]);
              toast.info('Connection selected');
            }
            return;
          }
        }
        
        // Skip if clicking on a connection node (to allow dragging)
        if (target && (target as any).isConnectionNode && (target as any).connectedLines) {
          // In connection mode, don't select the node - just use it as a connection point
          if (currentTool === 'connection') {
            // Continue processing for connection endpoint
          } else {
            // In other modes, allow dragging
            return;
          }
        }
        
        // Check if clicking on an existing connection line (to add a node)
        if (!connectionStartRef.current && target && (target as any).isConnectionLine) {
          const line = target as Line;
          const lineCoords = line.calcLinePoints();
          
          // Apply snap to create node at click position (unless Shift is held)
          if (!evt.shiftKey) {
            const snappedPoint = findNearestSnapPoint(canvas, pointer, 15);
            if (snappedPoint) {
              pointer = new Point(snappedPoint.x, snappedPoint.y);
            }
          }
          
          // Get the line's start and end points
          const x1 = line.x1 || 0;
          const y1 = line.y1 || 0;
          const x2 = line.x2 || 0;
          const y2 = line.y2 || 0;
          
          // Remove the original line
          canvas.remove(line);
          
          // Create two new line segments
          const line1 = new Line(
            [x1, y1, pointer.x, pointer.y],
            {
              stroke: '#0ea5e9',
              strokeWidth: 3,
              selectable: false,
              evented: true,
              hoverCursor: 'crosshair',
            }
          );
          (line1 as any).isConnectionLine = true;
          
          const line2 = new Line(
            [pointer.x, pointer.y, x2, y2],
            {
              stroke: '#0ea5e9',
              strokeWidth: 3,
              selectable: false,
              evented: true,
              hoverCursor: 'crosshair',
            }
          );
          (line2 as any).isConnectionLine = true;
          
          // Add lines above background
          const objects = canvas.getObjects();
          const backgroundIndex = objects.findIndex(obj => (obj as any).isBackgroundImage);
          if (backgroundIndex !== -1) {
            canvas.insertAt(backgroundIndex + 1, line1);
            canvas.insertAt(backgroundIndex + 2, line2);
          } else {
            canvas.add(line1, line2);
          }
          
          // Create draggable node at the split point
          const node = new Circle({
            left: pointer.x,
            top: pointer.y,
            radius: 5,
            fill: '#0ea5e9',
            stroke: '#ffffff',
            strokeWidth: 2,
            originX: 'center',
            originY: 'center',
            selectable: true,
            evented: true,
            hasControls: false,
            hasBorders: false,
            hoverCursor: 'move',
          });
          (node as any).isConnectionNode = true;
          (node as any).connectedLines = [line1, line2]; // Store references to connected lines
          
          canvas.add(node);
          canvas.renderAll();
          
          toast.success('Node added to line');
          return;
        }
        
        // Apply snap-to-point logic (15px threshold)
        // When clicking on a connection node in connection mode, check if there's a snap point underneath
        let snappedPoint = findNearestSnapPoint(canvas, pointer, 15);
        
        // If clicking on a connection node in connection mode, override to allow snap point connection
        if (currentTool === 'connection' && target && (target as any).isConnectionNode) {
          // Try to find snap point at this exact location (smaller threshold for precision)
          const snapAtNode = findNearestSnapPoint(canvas, pointer, 8);
          if (snapAtNode) {
            snappedPoint = snapAtNode;
          }
          // Deselect the node so it doesn't get selected during connection drawing
          canvas.discardActiveObject();
          canvas.renderAll();
        }
        
        if (!connectionStartRef.current) {
          // First click - start the line (only on snap point)
          if (!snappedPoint) {
            toast.error('Please click on a meter connection point');
            return;
          }
          
          pointer = new Point(snappedPoint.x, snappedPoint.y);
          
          setConnectionStart({ 
            meterId: snappedPoint.meterId,
            position: pointer 
          });
          setConnectionPoints([]);
          
          // Create start node marker
          const startNode = new Circle({
            left: pointer.x,
            top: pointer.y,
            radius: 5,
            fill: '#10b981',
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
          });
          connectionStartNodeRef.current = startNode;
          canvas.add(startNode);
          canvas.renderAll();
          
          toast.info('Click to add nodes, or click a meter connection point to finish');
        } else {
          // Subsequent clicks - check if ending on a snap point
          // Allow bypassing snap with Shift key
          const shouldSnap = snappedPoint && !evt.shiftKey;
          
          if (shouldSnap && snappedPoint.meterId !== connectionStartRef.current.meterId) {
            // Complete the connection on a different meter's snap point
            pointer = new Point(snappedPoint.x, snappedPoint.y);
            
            // Get all points: start + intermediate + end
            const allPoints = [
              connectionStartRef.current.position,
              ...connectionPointsRef.current.map(p => p.position),
              pointer
            ];
            
            // Create line segments between consecutive points
            const backgroundIndex = canvas.getObjects().findIndex(obj => (obj as any).isBackgroundImage);
            const lineSegments: Line[] = [];
            
            for (let i = 0; i < allPoints.length - 1; i++) {
              const lineSegment = new Line(
                [allPoints[i].x, allPoints[i].y, allPoints[i + 1].x, allPoints[i + 1].y],
                {
                  stroke: '#000000',
                  strokeWidth: 2,
                  selectable: false,
                  evented: true,
                  hoverCursor: 'crosshair',
                }
              );
              (lineSegment as any).isConnectionLine = true;
              lineSegments.push(lineSegment);
              
              // Add line above background
              if (backgroundIndex !== -1) {
                canvas.insertAt(backgroundIndex + 1 + i, lineSegment);
              } else {
                canvas.add(lineSegment);
                canvas.sendObjectToBack(lineSegment);
              }
            }
            
            // Create nodes at all points with references to connected line segments
            allPoints.forEach((point, index) => {
              const isEndpoint = index === 0 || index === allPoints.length - 1;
              const node = new Circle({
                left: point.x,
                top: point.y,
                radius: 5,
                fill: '#000000',
                originX: 'center',
                originY: 'center',
                selectable: !isEndpoint,
                evented: !isEndpoint, // Only intermediate nodes are evented for dragging
                hasControls: false,
                hasBorders: false,
                hoverCursor: isEndpoint ? 'default' : 'move',
              });
              (node as any).isConnectionNode = true;
              
              // Store references to connected line segments
              const connectedLines: Line[] = [];
              if (index > 0) connectedLines.push(lineSegments[index - 1]); // Line coming in
              if (index < allPoints.length - 1) connectedLines.push(lineSegments[index]); // Line going out
              (node as any).connectedLines = connectedLines;
              
              canvas.add(node);
            });
            
            // Capture connection data before async operations
            const parentMeterId = connectionStartRef.current!.meterId;
            const childMeterId = snappedPoint.meterId;
            
            // Save connection to database
            const saveConnection = async () => {
              try {
                console.log('💾 Saving connection:', { parentMeterId, childMeterId, pointsCount: allPoints.length });
                
                // 1. Check if meter connection already exists
                const { data: existingConnection } = await supabase
                  .from('meter_connections')
                  .select('id')
                  .eq('parent_meter_id', parentMeterId)
                  .eq('child_meter_id', childMeterId)
                  .maybeSingle();
                
                // Only insert if connection doesn't exist
                if (!existingConnection) {
                  const { error: connectionError } = await supabase
                    .from('meter_connections')
                    .insert({
                      parent_meter_id: parentMeterId,
                      child_meter_id: childMeterId
                    });
                  
                  if (connectionError) {
                    console.error('❌ Error saving meter connection:', connectionError);
                    toast.error('Failed to save meter connection: ' + connectionError.message);
                    return;
                  }
                } else {
                  console.log('ℹ️ Meter connection already exists, adding visual line only');
                }
                
                console.log('✅ Meter connection saved');
                
                // 2. Save line segments with node positions
                const lineData = [];
                // Get canvas dimensions for percentage conversion
                const canvasWidth = canvas.getWidth();
                const canvasHeight = canvas.getHeight();
                
                for (let i = 0; i < allPoints.length - 1; i++) {
                  // Convert pixel coordinates to percentages (like meter cards)
                  const fromXPercent = (allPoints[i].x / canvasWidth) * 100;
                  const fromYPercent = (allPoints[i].y / canvasHeight) * 100;
                  const toXPercent = (allPoints[i + 1].x / canvasWidth) * 100;
                  const toYPercent = (allPoints[i + 1].y / canvasHeight) * 100;
                  
                  lineData.push({
                    schematic_id: schematicId,
                    from_x: fromXPercent,
                    from_y: fromYPercent,
                    to_x: toXPercent,
                    to_y: toYPercent,
                    line_type: 'connection',
                    color: '#000000',
                    stroke_width: 2,
                    metadata: {
                      parent_meter_id: parentMeterId,
                      child_meter_id: childMeterId,
                      node_index: i
                    }
                  });
                }
                
                console.log('📊 Saving line segments:', lineData.length);
                
                const { error: linesError } = await supabase
                  .from('schematic_lines')
                  .insert(lineData);
                
                if (linesError) {
                  console.error('❌ Error saving line segments:', linesError);
                  toast.error('Failed to save line geometry: ' + linesError.message);
                  return;
                }
                
                console.log('✅ Line segments saved');
                
                // Refresh connections
                await fetchMeterConnections();
                await fetchSchematicLines();
                
                toast.success('Connection saved successfully');
              } catch (error) {
                console.error('❌ Error saving connection:', error);
                toast.error('Failed to save connection: ' + (error as Error).message);
              }
            };
            
            // Execute save (don't await to avoid blocking UI)
            saveConnection();
            
            // Clean up intermediate nodes
            connectionNodesRef.current.forEach(node => canvas.remove(node));
            connectionNodesRef.current = [];
            
            // Clean up preview line
            if (connectionLineRef.current) {
              canvas.remove(connectionLineRef.current);
              connectionLineRef.current = null;
            }
            
            // Remove snap highlight if exists
            const existingHighlight = canvas.getObjects().find((obj: any) => obj.isSnapHighlight);
            if (existingHighlight) {
              canvas.remove(existingHighlight);
            }
            
            setConnectionStart(null);
            setConnectionPoints([]);
            connectionStartNodeRef.current = null;
            canvas.renderAll();
            
            toast.success('Connection created');
          } else if (!shouldSnap) {
            // Add intermediate node (not on a snap point or Shift is held to bypass snap)
            // Apply 45-degree angle snapping when Shift is held
            if (evt.shiftKey) {
              const lastPoint = connectionPointsRef.current.length > 0 
                ? connectionPointsRef.current[connectionPointsRef.current.length - 1].position
                : connectionStartRef.current.position;
              
              const snappedAnglePoint = snapToAngle(lastPoint, pointer);
              pointer = new Point(snappedAnglePoint.x, snappedAnglePoint.y);
            }
            
            const newPoint = { meterId: '', position: pointer };
            setConnectionPoints([...connectionPointsRef.current, newPoint]);
            
            // Create intermediate node marker
            const intermediateNode = new Circle({
              left: pointer.x,
              top: pointer.y,
              radius: 5,
              fill: '#f59e0b',
              stroke: '#ffffff',
              strokeWidth: 2,
              originX: 'center',
              originY: 'center',
              selectable: false,
              evented: false,
            });
            connectionNodesRef.current.push(intermediateNode);
            canvas.add(intermediateNode);
            canvas.renderAll();
            
            toast.info('Node added. Click to continue or click a meter point to finish');
          } else if (snappedPoint.meterId === connectionStartRef.current.meterId) {
            toast.error('Cannot connect a meter to itself');
          }
        }
        return;
      }
      
      // Handle drag multi-select in selection mode
      if (isSelectionModeRef.current) {
        const pointer = canvas.getPointer(opt.e);
        startPoint = { x: pointer.x, y: pointer.y };
        clickTarget = target; // Store the target for potential click-to-select
        
        // Only start drag selection immediately if clicking on empty space or background
        if (!target || (target as any).isBackgroundImage) {
          // Clear all selections when clicking on empty space
          if (canvas) {
            canvas.getObjects().forEach((obj: any) => {
              if (obj.type === 'rect' && obj.regionId) {
                obj.set({ stroke: '#3b82f6', strokeWidth: 2 });
              }
              // Remove selection marker rectangles
              if (obj.type === 'rect' && obj.selectionMarker) {
                canvas.remove(obj);
              }
            });
            canvas.renderAll();
          }
          setSelectedRegionIndices([]);
          setSelectedMeterIds([]);
          setSelectedConnectionKeys([]);
          
          isDragSelecting = true;
          return;
        }
        // If clicking on a meter/region, wait to see if user drags (handled in mouse:move)
        return; // Don't proceed with immediate selection toggle
      }
      
      
      // Handle selection: single-click when selection mode is active
      const shouldHandleSelection = isSelectionModeRef.current && target;
      if (shouldHandleSelection) {
        // Handle region rectangle selection
        if (target.type === 'rect' && (target as any).regionId) {
          const regionId = (target as any).regionId;
          const regionIndex = drawnRegionsRef.current.findIndex(r => r.id === regionId);
          
          if (regionIndex !== -1) {
            setSelectedRegionIndices(prev => {
              if (prev.includes(regionIndex)) {
                // Deselect
                (target as any).set({ stroke: '#3b82f6', strokeWidth: 2 });
                canvas.renderAll();
                const updated = prev.filter(i => i !== regionIndex);
                toast.info(`Region deselected (${updated.length} selected)`);
                return updated;
              } else {
                // Select
                (target as any).set({ stroke: '#10b981', strokeWidth: 3 });
                canvas.renderAll();
                const updated = [...prev, regionIndex];
                toast.info(`Region selected (${updated.length} selected)`);
                return updated;
              }
            });
            return; // Don't proceed with other mouse:down logic
          }
        }
        
        // Handle meter card selection
        if (target.type === 'image' && (target as any).data?.meterId) {
          const meterId = (target as any).data.meterId;
          
          setSelectedMeterIds(prev => {
            if (prev.includes(meterId)) {
              // Deselect - remove selection rectangle
              const selectionRect = canvas.getObjects().find((obj: any) => 
                obj.type === 'rect' && obj.selectionMarker && obj.data?.meterId === meterId
              );
              if (selectionRect) {
                canvas.remove(selectionRect);
              }
              canvas.renderAll();
              const updated = prev.filter(id => id !== meterId);
              toast.info(`Meter deselected (${updated.length} selected)`);
              return updated;
            } else {
              // Select - add green selection rectangle overlay
              const bounds = target.getBoundingRect();
              const selectionRect = new Rect({
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
                fill: 'transparent',
                stroke: '#10b981',
                strokeWidth: 4,
                selectable: false,
                evented: false,
                data: { meterId: meterId }
              });
              (selectionRect as any).selectionMarker = true;
              canvas.add(selectionRect);
              canvas.renderAll();
              const updated = [...prev, meterId];
              toast.info(`Meter selected (${updated.length} selected)`);
              return updated;
            }
          });
          return; // Don't proceed with other mouse:down logic
        }
      }
      
      // Only handle drawing if in draw mode
      if (currentTool !== 'draw') return;
      
      // Don't start drawing if clicking on an existing rectangle (to move it)
      if (target && target.type === 'rect' && (target as any).regionId) return;
      
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
      const evt = opt.e as MouseEvent;
      let pointer = canvas.getPointer(opt.e);
      
      // Handle middle mouse button panning
      if (isPanningRef.current && lastPanPositionRef.current) {
        const deltaX = evt.clientX - lastPanPositionRef.current.x;
        const deltaY = evt.clientY - lastPanPositionRef.current.y;
        
        canvas.relativePan(new Point(deltaX, deltaY));
        
        lastPanPositionRef.current = { x: evt.clientX, y: evt.clientY };
        canvas.renderAll();
        return;
      }
      
      // Handle connection line preview with snap
      if (activeToolRef.current === 'connection' && connectionStartRef.current) {
        // Apply snap-to-point logic (15px threshold)
        const snappedPoint = findNearestSnapPoint(canvas, pointer, 15);
        
        // Remove previous snap highlight
        const existingHighlight = canvas.getObjects().find((obj: any) => obj.isSnapHighlight);
        if (existingHighlight) {
          canvas.remove(existingHighlight);
        }
        
        // Add visual feedback when snapping
        if (snappedPoint) {
          pointer = new Point(snappedPoint.x, snappedPoint.y);
          
          // Create a highlight circle at the snap point
          const highlight = new Circle({
            left: snappedPoint.x,
            top: snappedPoint.y,
            radius: 12,
            fill: 'transparent',
            stroke: '#10b981',
            strokeWidth: 3,
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
          });
          (highlight as any).isSnapHighlight = true;
          canvas.add(highlight);
        } else if (evt.shiftKey) {
          // Apply 45-degree angle snapping when Shift is held and not on a snap point
          const lastPoint = connectionPointsRef.current.length > 0 
            ? connectionPointsRef.current[connectionPointsRef.current.length - 1].position
            : connectionStartRef.current.position;
          
          const snappedAnglePoint = snapToAngle(lastPoint, pointer);
          pointer = new Point(snappedAnglePoint.x, snappedAnglePoint.y);
        }
        
        // Remove previous preview line
        if (connectionLineRef.current) {
          canvas.remove(connectionLineRef.current);
        }
        
        // Create preview polyline through all points
        const allPoints = [
          connectionStartRef.current.position,
          ...connectionPointsRef.current.map(p => p.position),
          pointer
        ];
        
        // Flatten points for polyline
        const points = allPoints.map(p => new Point(p.x, p.y));
        
        const previewLine = new Polyline(points, {
          stroke: '#10b981',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          fill: '',
          selectable: false,
          evented: false,
        });
        
        connectionLineRef.current = previewLine;
        canvas.add(previewLine);
        canvas.renderAll();
        return;
      }
      
      // Check if user is dragging in selection mode
      // Enable drag selection if they started with click and are now moving
      if (isSelectionModeRef.current && startPoint && !isDragSelecting) {
        const distance = Math.sqrt(
          Math.pow(pointer.x - startPoint.x, 2) + Math.pow(pointer.y - startPoint.y, 2)
        );
        
        // Start selection if moved more than 5 pixels (prevents accidental drags)
        if (distance > 5) {
          isDragSelecting = true;
          clickTarget = null; // Clear click target since we're now dragging
        }
      }
      
      // Handle drag multi-select box
      if (isDragSelecting && startPoint) {
        // Remove previous selection box
        if (selectionBoxRef.current) {
          canvas.remove(selectionBoxRef.current);
        }
        
        // Create new selection box preview
        const left = Math.min(startPoint.x, pointer.x);
        const top = Math.min(startPoint.y, pointer.y);
        const width = Math.abs(pointer.x - startPoint.x);
        const height = Math.abs(pointer.y - startPoint.y);
        
        const selectionBox = new Rect({
          left,
          top,
          width,
          height,
          fill: 'rgba(234, 179, 8, 0.2)',
          stroke: '#eab308',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
        });
        
        selectionBoxRef.current = selectionBox;
        canvas.add(selectionBox);
        canvas.renderAll();
        return;
      }
      
      if (!isDrawing || !startPoint || activeToolRef.current !== 'draw') return;
      
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
      
      // Handle middle mouse button pan end
      if (evt.button === 1 && isPanningRef.current) {
        isPanningRef.current = false;
        lastPanPositionRef.current = null;
        canvas.selection = true; // Re-enable selection
        console.log('🖐️ Middle mouse pan ended', { button: evt.button, wasPanning: true });
        return;
      }
      
      // Handle drag multi-select completion
      if (isDragSelecting && startPoint) {
        const pointer = canvas.getPointer(opt.e);
        
        // Calculate selection box dimensions
        const left = Math.min(startPoint.x, pointer.x);
        const top = Math.min(startPoint.y, pointer.y);
        const width = Math.abs(pointer.x - startPoint.x);
        const height = Math.abs(pointer.y - startPoint.y);
        
        // Find all meter cards and connections that intersect with the selection box
        const selectedMeterIdsInBox: string[] = [];
        const selectedConnectionKeysInBox: string[] = [];
        canvas.getObjects().forEach((obj: any) => {
          if (obj.type === 'image' && obj.data?.meterId) {
            const bounds = obj.getBoundingRect();
            
            // Check if meter card intersects with selection box
            const intersects = !(
              bounds.left + bounds.width < left ||
              bounds.left > left + width ||
              bounds.top + bounds.height < top ||
              bounds.top > top + height
            );
            
            if (intersects) {
              selectedMeterIdsInBox.push(obj.data.meterId);
            }
          }
          
          // Check if connection lines intersect with selection box
          if (obj.type === 'line' && (obj as any).isConnectionLine) {
            const line = obj as Line;
            const x1 = line.x1 || 0;
            const y1 = line.y1 || 0;
            const x2 = line.x2 || 0;
            const y2 = line.y2 || 0;
            
            // Check if line intersects with selection box (simplified: check if any endpoint is inside)
            const point1Inside = x1 >= left && x1 <= left + width && y1 >= top && y1 <= top + height;
            const point2Inside = x2 >= left && x2 <= left + width && y2 >= top && y2 <= top + height;
            
            if (point1Inside || point2Inside) {
              const connectionKey = (obj as any).connectionKey;
              if (connectionKey && !selectedConnectionKeysInBox.includes(connectionKey)) {
                selectedConnectionKeysInBox.push(connectionKey);
              }
            }
          }
          
          // Check if connection nodes intersect with selection box
          if (obj.type === 'circle' && (obj as any).isConnectionNode) {
            const node = obj as Circle;
            const nodeX = node.left || 0;
            const nodeY = node.top || 0;
            
            // Check if node is inside selection box
            if (nodeX >= left && nodeX <= left + width && nodeY >= top && nodeY <= top + height) {
              const connectionKey = (obj as any).connectionKey;
              if (connectionKey && !selectedConnectionKeysInBox.includes(connectionKey)) {
                selectedConnectionKeysInBox.push(connectionKey);
              }
            }
          }
        });
        
        // Add selection rectangles for newly selected meters
        if (selectedMeterIdsInBox.length > 0) {
          setSelectedMeterIds(prev => {
            // Remove selection markers for deselected meters
            const deselectedIds = prev.filter(id => !selectedMeterIdsInBox.includes(id));
            deselectedIds.forEach(meterId => {
              const selectionRect = canvas.getObjects().find((obj: any) => 
                obj.type === 'rect' && obj.selectionMarker && obj.data?.meterId === meterId
              );
              if (selectionRect) {
                canvas.remove(selectionRect);
              }
            });
            
            // Add selection markers for newly selected meters
            const newSelections = selectedMeterIdsInBox.filter(id => !prev.includes(id));
            newSelections.forEach(meterId => {
              const meterObj = canvas.getObjects().find((obj: any) => 
                obj.type === 'image' && obj.data?.meterId === meterId
              );
              if (meterObj) {
                const bounds = meterObj.getBoundingRect();
                const selectionRect = new Rect({
                  left: bounds.left,
                  top: bounds.top,
                  width: bounds.width,
                  height: bounds.height,
                  fill: 'transparent',
                  stroke: '#10b981',
                  strokeWidth: 4,
                  selectable: false,
                  evented: false,
                  data: { meterId: meterId }
                });
                (selectionRect as any).selectionMarker = true;
                canvas.add(selectionRect);
              }
            });
            
            canvas.renderAll();
            return selectedMeterIdsInBox;
          });
        }
        
        // Add selected connections
        if (selectedConnectionKeysInBox.length > 0) {
          setSelectedConnectionKeys(prev => {
            const combined = [...new Set([...prev, ...selectedConnectionKeysInBox])];
            return combined;
          });
        }
        
        // Show toast with total selections
        const totalSelected = selectedMeterIdsInBox.length + selectedConnectionKeysInBox.length;
        if (totalSelected > 0) {
          toast.info(`Selected ${selectedMeterIdsInBox.length} meter(s) and ${selectedConnectionKeysInBox.length} connection(s)`);
        }
        
        // Remove selection box
        if (selectionBoxRef.current) {
          canvas.remove(selectionBoxRef.current);
          selectionBoxRef.current = null;
        }
        
        isDragSelecting = false;
        startPoint = null;
        clickTarget = null;
        canvas.renderAll();
        return;
      }
      
      // Handle click (no drag) on empty space - clear all selections
      if (clickTarget && (!clickTarget.type || (clickTarget as any).isBackgroundImage) && !isDragSelecting && isSelectionModeRef.current) {
        // Clear all selections
        if (canvas) {
          canvas.getObjects().forEach((obj: any) => {
            if (obj.type === 'rect' && obj.regionId) {
              obj.set({ stroke: '#3b82f6', strokeWidth: 2 });
            }
            // Remove selection marker rectangles
            if (obj.type === 'rect' && obj.selectionMarker) {
              canvas.remove(obj);
            }
          });
          canvas.renderAll();
        }
        setSelectedRegionIndices([]);
        setSelectedMeterIds([]);
        setSelectedConnectionKeys([]);
        
        clickTarget = null;
        startPoint = null;
        canvas.renderAll();
        return;
      }
      
      // Handle click (no drag) - toggle selection of the clicked target
      if (clickTarget && !isDragSelecting && isSelectionModeRef.current) {
        const target = clickTarget;
        
        // Handle region rectangle selection
        if (target.type === 'rect' && (target as any).regionId) {
          const regionId = (target as any).regionId;
          const regionIndex = drawnRegionsRef.current.findIndex(r => r.id === regionId);
          
          if (regionIndex !== -1) {
            setSelectedRegionIndices(prev => {
              if (prev.includes(regionIndex)) {
                // Deselect
                (target as any).set({ stroke: '#3b82f6', strokeWidth: 2 });
                canvas.renderAll();
                const updated = prev.filter(i => i !== regionIndex);
                toast.info(`Region deselected (${updated.length} selected)`);
                return updated;
              } else {
                // Select
                (target as any).set({ stroke: '#10b981', strokeWidth: 3 });
                canvas.renderAll();
                const updated = [...prev, regionIndex];
                toast.info(`Region selected (${updated.length} selected)`);
                return updated;
              }
            });
          }
        }
        
        // Handle meter card selection
        if (target.type === 'image' && (target as any).data?.meterId) {
          const meterId = (target as any).data.meterId;
          
          setSelectedMeterIds(prev => {
            if (prev.includes(meterId)) {
              // Deselect - remove selection rectangle
              const selectionRect = canvas.getObjects().find((obj: any) => 
                obj.type === 'rect' && obj.selectionMarker && obj.data?.meterId === meterId
              );
              if (selectionRect) {
                canvas.remove(selectionRect);
              }
              canvas.renderAll();
              const updated = prev.filter(id => id !== meterId);
              toast.info(`Meter deselected (${updated.length} selected)`);
              return updated;
            } else {
              // Select - add green selection rectangle overlay
              const bounds = target.getBoundingRect();
              const selectionRect = new Rect({
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
                fill: 'transparent',
                stroke: '#10b981',
                strokeWidth: 4,
                selectable: false,
                evented: false,
                data: { meterId: meterId }
              });
              (selectionRect as any).selectionMarker = true;
              canvas.add(selectionRect);
              canvas.renderAll();
              const updated = [...prev, meterId];
              toast.info(`Meter selected (${updated.length} selected)`);
              return updated;
            }
          });
        }
        
        clickTarget = null;
        startPoint = null;
        canvas.renderAll();
        return;
      }
      
      // Clear click target if we get here
      clickTarget = null;
      
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
            lockScalingFlip: true,
            cornerStyle: 'circle',
            cornerSize: 14,
            cornerColor: '#3b82f6',
            cornerStrokeColor: '#ffffff',
            transparentCorners: false,
            borderColor: '#3b82f6',
            borderScaleFactor: 1,
            borderDashArray: [5, 5],
            hoverCursor: 'move',
            moveCursor: 'move',
            padding: 5,
          });
          
          // Hide rotation control
          permanentRect.setControlVisible('mtr', false);
          
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
          
          setDrawnRegions(prev => {
            const updated = [...prev, newRegion];
            console.log('Region added to drawnRegions', { total: updated.length, regionId });
            return updated;
          });
          
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
        
        // Calculate width/height of card in canvas pixels using actual element dimensions
        const cardWidth = (img.width || 200) * scaleX;
        const cardHeight = (img.height || 140) * scaleY;
        
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
      
      // Handle connection node position updates
      if (obj && obj.type === 'circle' && (obj as any).isConnectionNode) {
        const node = obj as Circle;
        const connectedLines = (node as any).connectedLines as Line[];
        
        if (connectedLines && connectedLines.length > 0) {
          const canvasWidth = canvas.getWidth();
          const canvasHeight = canvas.getHeight();
          
          // Update database for each connected line
          connectedLines.forEach(async (line) => {
            const lineId = (line as any).lineId;
            if (!lineId) return;
            
            // Convert pixel coordinates to percentages
            const fromXPercent = ((line.x1 || 0) / canvasWidth) * 100;
            const fromYPercent = ((line.y1 || 0) / canvasHeight) * 100;
            const toXPercent = ((line.x2 || 0) / canvasWidth) * 100;
            const toYPercent = ((line.y2 || 0) / canvasHeight) * 100;
            
            // Update the database
            const { error } = await supabase
              .from('schematic_lines')
              .update({
                from_x: fromXPercent,
                from_y: fromYPercent,
                to_x: toXPercent,
                to_y: toYPercent,
              })
              .eq('id', lineId);
            
            if (error) {
              console.error('Error updating connection node position:', error);
            }
          });
        }
      }
    });
    
    // Handle connection node movement - update connected lines
    canvas.on('object:moving', (opt) => {
      if (!opt.target) return;
      
      // Handle connection node movement
      if ((opt.target as any).isConnectionNode) {
        const node = opt.target as Circle;
        const connectedLines = (node as any).connectedLines as Line[];
        
        if (connectedLines && connectedLines.length > 0) {
          // For a node with connections:
          // - connectedLines[0] is the line coming IN (node is at x2, y2)
          // - connectedLines[1] is the line going OUT (node is at x1, y1)
          connectedLines.forEach((line, index) => {
            if (connectedLines.length === 1) {
              // Node has only one connection (could be start or end)
              // Check which end the node is at
              const distToStart = Math.sqrt(
                Math.pow((line.x1 || 0) - node.left!, 2) + 
                Math.pow((line.y1 || 0) - node.top!, 2)
              );
              const distToEnd = Math.sqrt(
                Math.pow((line.x2 || 0) - node.left!, 2) + 
                Math.pow((line.y2 || 0) - node.top!, 2)
              );
              
              if (distToEnd < distToStart) {
                line.set({ x2: node.left, y2: node.top });
              } else {
                line.set({ x1: node.left, y1: node.top });
              }
            } else {
              // Node has two connections (intermediate node)
              if (index === 0) {
                // First line: node is at end
                line.set({ x2: node.left, y2: node.top });
              } else {
                // Second line: node is at start
                line.set({ x1: node.left, y1: node.top });
              }
            }
          });
          canvas.renderAll();
        }
      }
    });
    
    // Handle double-click on intermediate nodes to delete them
    canvas.on('mouse:dblclick', async (opt) => {
      const currentTool = activeToolRef.current;
      const target = opt.target;
      
      // Only allow in connection mode
      if (currentTool !== 'connection') return;
      
      // Check if double-clicking on a connection node
      if (target && (target as any).isConnectionNode) {
        const node = target as Circle;
        const connectedLines = (node as any).connectedLines as Line[];
        const connectionKey = (node as any).connectionKey;
        
        // Only delete intermediate nodes (those with 2 connected lines)
        if (connectedLines && connectedLines.length === 2 && connectionKey) {
          const line1 = connectedLines[0];
          const line2 = connectedLines[1];
          
          // Get the endpoints of the merged line
          const x1 = line1.x1 || 0;
          const y1 = line1.y1 || 0;
          const x2 = line2.x2 || 0;
          const y2 = line2.y2 || 0;
          
          try {
            // Parse connectionKey to get parent and child meter IDs
            const [parentMeterId, childMeterId] = connectionKey.split('-');
            
            // Fetch all line segments for this connection
            const { data: allLines, error: fetchError } = await supabase
              .from('schematic_lines')
              .select('*')
              .eq('schematic_id', schematicId)
              .eq('line_type', 'connection');
            
            if (fetchError) throw fetchError;
            
            // Filter to get lines for this specific connection and sort by node_index
            const connectionLines = (allLines || [])
              .filter((line: any) => 
                line.metadata?.parent_meter_id === parentMeterId &&
                line.metadata?.child_meter_id === childMeterId
              )
              .sort((a: any, b: any) => 
                (a.metadata?.node_index || 0) - (b.metadata?.node_index || 0)
              );
            
            // Find the two line segments to be merged by matching coordinates
            let line1Index = -1;
            let line2Index = -1;
            
            for (let i = 0; i < connectionLines.length - 1; i++) {
              const lineA = connectionLines[i];
              const lineB = connectionLines[i + 1];
              
              // Check if these two consecutive lines match our canvas lines
              // line1 ends at the node, line2 starts at the node
              const matchesLine1 = Math.abs(lineA.to_x - node.left!) < 0.1 && 
                                   Math.abs(lineA.to_y - node.top!) < 0.1;
              const matchesLine2 = Math.abs(lineB.from_x - node.left!) < 0.1 && 
                                   Math.abs(lineB.from_y - node.top!) < 0.1;
              
              if (matchesLine1 && matchesLine2) {
                line1Index = i;
                line2Index = i + 1;
                break;
              }
            }
            
            if (line1Index === -1 || line2Index === -1) {
              throw new Error('Could not find matching line segments in database');
            }
            
            const dbLine1 = connectionLines[line1Index];
            const dbLine2 = connectionLines[line2Index];
            
            // Delete the two old line segments
            const { error: deleteError } = await supabase
              .from('schematic_lines')
              .delete()
              .in('id', [dbLine1.id, dbLine2.id]);
            
            if (deleteError) throw deleteError;
            
            // Insert the new merged line segment
            const { error: insertError } = await supabase
              .from('schematic_lines')
              .insert({
                schematic_id: schematicId,
                from_x: x1,
                from_y: y1,
                to_x: x2,
                to_y: y2,
                line_type: 'connection',
                color: dbLine1.color || '#000000',
                stroke_width: dbLine1.stroke_width || 2,
                metadata: {
                  parent_meter_id: parentMeterId,
                  child_meter_id: childMeterId,
                  node_index: typeof dbLine1.metadata === 'object' && dbLine1.metadata && 'node_index' in dbLine1.metadata 
                    ? (dbLine1.metadata.node_index as number) 
                    : 0
                }
              });
            
            if (insertError) throw insertError;
            
            // Update node_index for remaining segments after the deleted ones
            for (let i = line2Index + 1; i < connectionLines.length; i++) {
              const lineToUpdate = connectionLines[i];
              const currentMetadata = typeof lineToUpdate.metadata === 'object' && lineToUpdate.metadata 
                ? lineToUpdate.metadata 
                : {};
              const currentNodeIndex = 'node_index' in currentMetadata 
                ? (currentMetadata.node_index as number) 
                : 0;
              const newNodeIndex = currentNodeIndex - 1;
              
              await supabase
                .from('schematic_lines')
                .update({
                  metadata: {
                    ...currentMetadata,
                    node_index: newNodeIndex
                  }
                })
                .eq('id', lineToUpdate.id);
            }
            
            // Refresh the schematic lines to update the canvas
            await fetchSchematicLines();
            
            toast.success('Node deleted and database updated');
          } catch (error) {
            console.error('Error deleting node:', error);
            toast.error('Failed to delete node: ' + (error as Error).message);
          }
        }
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
    setIsCanvasReady(false);

    // Track if canvas is still mounted
    let isMounted = true;

    // Load background image
    FabricImage.fromURL(schematicUrl, {
      crossOrigin: 'anonymous'
    }).then((img) => {
      // Guard: Check if component is still mounted before proceeding
      if (!isMounted) {
        console.log('Component unmounted during image load, skipping canvas setup');
        return;
      }
      
      requestAnimationFrame(() => {
        // Double-check mount status after requestAnimationFrame
        if (!isMounted || !canvasRef.current) {
          return;
        }
        
        const container = canvasRef.current.parentElement;
        const containerWidth = container?.clientWidth || 1400;
        
        // Use full container width without height constraint
        const imgWidth = img.width!;
        const imgHeight = img.height!;
        
        // Scale to use full container width
        const scale = containerWidth / imgWidth;
        const canvasWidth = containerWidth;
        const canvasHeight = imgHeight * scale;
        
        // Store original image dimensions for region coordinate conversion
        (canvas as any).originalImageWidth = imgWidth;
        (canvas as any).originalImageHeight = imgHeight;
        
        // Guard: Only set dimensions if canvas hasn't been disposed
        try {
          canvas.setDimensions({ width: canvasWidth, height: canvasHeight });
        } catch (err) {
          console.warn('Canvas already disposed, skipping dimension update');
          return;
        }
        
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
        
        // Mark canvas as ready after image is loaded and canvas is resized
        setIsCanvasReady(true);
      });
    }).catch((err) => {
      console.error('Failed to load background image:', err);
    });

    return () => {
      isMounted = false;
      window.removeEventListener('mousedown', handleNativeMouseDown, true);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.dispose();
    };
  }, [schematicUrl]);

  // Resize canvas when dimensions change (without reinitializing)
  useEffect(() => {
    if (!fabricCanvas || !isCanvasReady) return;

    const currentWidth = fabricCanvas.getWidth();
    const currentHeight = fabricCanvas.getHeight();
    
    // Calculate scale factors
    const scaleX = canvasDimensions.width / currentWidth;
    const scaleY = canvasDimensions.height / currentHeight;

    // Resize canvas
    fabricCanvas.setDimensions({
      width: canvasDimensions.width,
      height: canvasDimensions.height
    });

    // Scale all objects proportionally
    fabricCanvas.getObjects().forEach((obj: any) => {
      if (obj.left !== undefined && obj.top !== undefined) {
        obj.set({
          left: obj.left * scaleX,
          top: obj.top * scaleY,
        });
        
        // Scale object size if it has dimensions
        if (obj.scaleX !== undefined) {
          obj.set({ scaleX: obj.scaleX * scaleX });
        }
        if (obj.scaleY !== undefined) {
          obj.set({ scaleY: obj.scaleY * scaleY });
        }
        
        // Handle line objects specially
        if (obj.type === 'line') {
          obj.set({
            x1: (obj.x1 || 0) * scaleX,
            y1: (obj.y1 || 0) * scaleY,
            x2: (obj.x2 || 0) * scaleX,
            y2: (obj.y2 || 0) * scaleY,
          });
        }
        
        obj.setCoords();
      }
    });

    fabricCanvas.renderAll();
  }, [canvasDimensions, fabricCanvas, isCanvasReady]);


  // DELETE KEY: Remove selected meter card in edit mode
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleDeleteKey = async (e: KeyboardEvent) => {
      if (!isEditMode) return;
      
      // Don't trigger delete if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target && (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable
      )) {
        return;
      }
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObject = fabricCanvas.getActiveObject();
        if (activeObject && (activeObject as any).data) {
          const data = (activeObject as any).data;
          if (data.meterId && data.positionId) {
            if (confirm(`Delete this meter card? This will remove the meter from the schematic but not from the database.`)) {
              // Delete the meter position
              const { error } = await supabase
                .from('meter_positions')
                .delete()
                .eq('id', data.positionId);
              
              if (error) {
                toast.error('Failed to delete meter card');
                console.error('Delete error:', error);
                return;
              }
              
              fabricCanvas.remove(activeObject);
              toast.success('Meter card removed from schematic');
              fetchMeterPositions();
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleDeleteKey);
    return () => {
      window.removeEventListener('keydown', handleDeleteKey);
    };
  }, [fabricCanvas, isEditMode]);

  // ESCAPE KEY: Cancel connection drawing
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleEscapeKey = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target && (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable
      )) {
        return;
      }
      
      if (e.key === 'Escape' && activeTool === 'connection' && (connectionPoints.length > 0 || connectionStart)) {
        // Clean up preview nodes and lines
        connectionNodesRef.current.forEach(node => fabricCanvas.remove(node));
        connectionNodesRef.current = [];
        
        if (connectionLineRef.current) {
          fabricCanvas.remove(connectionLineRef.current);
          connectionLineRef.current = null;
        }
        
        if (connectionStartNodeRef.current) {
          fabricCanvas.remove(connectionStartNodeRef.current);
          connectionStartNodeRef.current = null;
        }
        
        // Reset state
        setConnectionPoints([]);
        setConnectionStart(null);
        fabricCanvas.renderAll();
        
        toast.info('Connection cancelled');
      }
    };

    window.addEventListener('keydown', handleEscapeKey);
    return () => {
      window.removeEventListener('keydown', handleEscapeKey);
    };
  }, [fabricCanvas, activeTool, connectionPoints, connectionStart]);


  // Update cursor when tool changes
  useEffect(() => {
    if (fabricCanvas) {
      fabricCanvas.defaultCursor = activeTool === 'draw' ? 'crosshair' : 'grab';
      fabricCanvas.hoverCursor = activeTool === 'draw' ? 'crosshair' : 'grab';
      fabricCanvas.renderAll();
    }
  }, [activeTool, fabricCanvas]);

  useEffect(() => {
    if (!fabricCanvas || !isInitialDataLoaded || !isCanvasReady) return;
    
    // Clear all objects except the background schematic image, connection lines, and connection nodes
    const objects = fabricCanvas.getObjects();
    objects.forEach(obj => {
      // Keep background image, connection lines, and connection nodes
      const shouldKeep = (obj as any).isBackgroundImage || 
                        (obj as any).isConnectionLine || 
                        (obj as any).isConnectionNode;
      if (!shouldKeep) {
        fabricCanvas.remove(obj);
      }
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
      
      const strokeWidth = isSelected ? 8 : 6;
      
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
            stroke: borderColor,
            strokeWidth: strokeWidth,
          });
          
          // Hide rotation control
          img.setControlVisible('mtr', false);
          
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

          // Add border overlay for consistent stroke width
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

          fabricCanvas.add(img);
          fabricCanvas.bringObjectToFront(img);
          
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
                radius: 8,
                fill: '#3b82f6',
                originX: 'center',
                originY: 'center',
                selectable: false,
                evented: true,
                opacity: 0.9,
                hoverCursor: 'crosshair'
              });
              (snapCircle as any).isSnapPoint = true;
              (snapCircle as any).meterId = meter.id;
              
              fabricCanvas.add(snapCircle);
            });
          }
          
          fabricCanvas.renderAll();
        };
      });
    });

    // Render saved meter positions
    // Track meter card loading promises
    const meterCardPromises: Promise<void>[] = [];
    setAreMeterCardsLoaded(false);
    
    meterPositions.forEach(pos => {
      const meter = meters.find(m => m.id === pos.meter_id);
      
      // Skip if meter not found (could be deleted)
      if (!meter) {
        console.warn(`Meter not found for position: ${pos.meter_id}`);
        return;
      }
      
      const meterType = meter?.meter_type || 'unknown';
      const zone = meter?.zone;
      
      // Determine border color based on mode
      const confirmationStatus = (meter as any).confirmation_status || 'unconfirmed';
      let borderColor = '#3b82f6'; // default blue
      let categoryKey = 'other';
      
      if (isEditMode) {
        // Edit mode: Show confirmation status colors
        if (confirmationStatus === 'confirmed') {
          borderColor = '#22c55e'; // green for confirmed
        } else {
          borderColor = '#ef4444'; // red for unconfirmed
        }
      } else {
        // Normal mode: Show zone colors
        if (zone === 'main_board') {
          borderColor = '#9333ea'; // purple for Main Board
        } else if (zone === 'mini_sub') {
          borderColor = '#06b6d4'; // cyan for Mini Sub
        } else if (zone === 'council') {
          borderColor = '#ec4899'; // pink for Council
        } else {
          // No zone: no border in normal mode
          borderColor = 'transparent';
        }
      }
      
      // Determine zone category
      let zoneCategory: string | null = null;
      if (zone === 'main_board') {
        zoneCategory = 'main_board_zone';
      } else if (zone === 'mini_sub') {
        zoneCategory = 'mini_sub_zone';
      } else if (zone === 'council') {
        zoneCategory = 'council_connection_zone';
      }
      
      // Determine meter type category
      let meterTypeCategory: string = 'other';
      if (meterType.includes('bulk')) {
        meterTypeCategory = 'bulk_meter';
      } else if (meterType.includes('check')) {
        meterTypeCategory = 'check_meter';
      } else if (meterType.includes('tenant')) {
        meterTypeCategory = 'tenant_meter';
      }
      
      // Apply both filters: meter must pass zone filter (if it has a zone) AND meter type filter
      if (zoneCategory && !legendVisibility[zoneCategory as keyof typeof legendVisibility]) {
        return; // Zone filter hides it
      }
      if (!legendVisibility[meterTypeCategory as keyof typeof legendVisibility]) {
        return; // Meter type filter hides it
      }
      
      // Skip rendering based on confirmation status toggles
      if (confirmationStatus === 'confirmed' && !showConfirmed) {
        return;
      }
      if (confirmationStatus !== 'confirmed' && !showUnconfirmed) {
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
        const zoneName = zone === 'main_board' ? 'MAIN BOARD' : zone === 'mini_sub' ? 'MINI SUB' : zone === 'council' ? 'COUNCIL' : zone;
        fields.splice(2, 0, { label: 'ZONE:', value: zoneName });
      }

      const savedScaleX = (pos as any).scale_x ? Number((pos as any).scale_x) : 1.0;
      const savedScaleY = (pos as any).scale_y ? Number((pos as any).scale_y) : 1.0;
      
      // Generate meter card image
      const cardPromise = new Promise<void>((resolve) => {
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
            hoverCursor: isEditMode ? 'move' : 'pointer',
            lockRotation: true,
            stroke: borderColor,
            strokeWidth: isEditMode ? 8 : 6,
          });
          
          // Hide rotation control
          img.setControlVisible('mtr', false);
          
          img.set('data', { meterId: pos.meter_id, positionId: pos.id });
          
          // Add double-click handler to open edit dialog
          img.on('mousedblclick', () => {
            console.log('Double-click on meter card:', { 
              isEditMode: isEditModeRef.current, 
              meterNumber: meter.meter_number,
              scannedSnippetUrl: meter.scanned_snippet_url
            });
            if (!isEditModeRef.current) return;
            // Map scanned_snippet_url to scannedImageSnippet for the form
            const meterData = {
              ...meter,
              scannedImageSnippet: meter.scanned_snippet_url || undefined
            };
            console.log('Setting editing meter:', meterData);
            setEditingMeter(meterData);
            setIsEditMeterDialogOpen(true);
          });

          // Single click for viewing details
          img.on('mousedown', () => {
            if (!isEditModeRef.current && activeTool === 'select' && !isSelectionModeRef.current) {
              // View meter details in normal mode (but not in selection mode or edit mode)
              setViewingMeter(meter);
              setIsViewMeterDialogOpen(true);
            }
          });

          // Handle dragging and scaling in edit mode
          if (isEditMode) {
            // Update selection rectangle and connection lines during movement
            img.on('moving', () => {
              const selectionRect = fabricCanvas.getObjects().find((obj: any) => 
                obj.type === 'rect' && obj.selectionMarker && obj.data?.meterId === pos.meter_id
              );
              if (selectionRect) {
                const bounds = img.getBoundingRect();
                selectionRect.set({
                  left: bounds.left,
                  top: bounds.top,
                  width: bounds.width,
                  height: bounds.height
                });
              }
              
              // Update connection lines connected to this meter
              const currentX = img.left || 0;
              const currentY = img.top || 0;
              const actualWidth = cardWidth * baseScaleX * savedScaleX;
              const actualHeight = cardHeight * baseScaleY * savedScaleY;
              
              // Calculate new snap points based on current position
              const snapPoints = calculateSnapPoints(
                currentX - actualWidth / 2,
                currentY - actualHeight / 2,
                actualWidth,
                actualHeight
              );
              
              // Find and update all connection lines attached to this meter
              fabricCanvas.getObjects().forEach((obj: any) => {
                if (obj.isConnectionLine) {
                  const lineMetadata = schematicLines.find(line => 
                    line.from_x === obj.x1 && line.from_y === obj.y1 &&
                    line.to_x === obj.x2 && line.to_y === obj.y2
                  );
                  
                  if (lineMetadata?.metadata) {
                    const parentId = lineMetadata.metadata.parent_meter_id;
                    const childId = lineMetadata.metadata.child_meter_id;
                    const nodeIndex = lineMetadata.metadata.node_index || 0;
                    
                    // Check if this line is connected to the meter being moved
                    if (parentId === pos.meter_id && nodeIndex === 0) {
                      // This is the first segment from this meter, update start point
                      obj.set({ x1: snapPoints.bottom.x, y1: snapPoints.bottom.y });
                    } else if (childId === pos.meter_id) {
                      // This line ends at this meter, check if it's the last segment
                      const allSegments = schematicLines.filter(line =>
                        line.metadata?.parent_meter_id === parentId &&
                        line.metadata?.child_meter_id === childId
                      );
                      const maxIndex = Math.max(...allSegments.map(s => s.metadata?.node_index || 0));
                      
                      if (nodeIndex === maxIndex) {
                        // Last segment, update end point
                        obj.set({ x2: snapPoints.top.x, y2: snapPoints.top.y });
                      }
                    }
                  }
                }
                
                // Update connection nodes that are endpoints
                if (obj.isConnectionNode && obj.connectedLines) {
                  obj.connectedLines.forEach((line: any) => {
                    const lineMetadata = schematicLines.find(l => 
                      l.from_x === line.x1 && l.from_y === line.y1 &&
                      l.to_x === line.x2 && l.to_y === line.y2
                    );
                    
                    if (lineMetadata?.metadata) {
                      const parentId = lineMetadata.metadata.parent_meter_id;
                      const childId = lineMetadata.metadata.child_meter_id;
                      const nodeIndex = lineMetadata.metadata.node_index || 0;
                      
                      if (parentId === pos.meter_id && nodeIndex === 0) {
                        obj.set({ left: snapPoints.bottom.x, top: snapPoints.bottom.y });
                      } else if (childId === pos.meter_id) {
                        const allSegments = schematicLines.filter(line =>
                          line.metadata?.parent_meter_id === parentId &&
                          line.metadata?.child_meter_id === childId
                        );
                        const maxIndex = Math.max(...allSegments.map(s => s.metadata?.node_index || 0));
                        
                        if (nodeIndex === maxIndex) {
                          obj.set({ left: snapPoints.top.x, top: snapPoints.top.y });
                        }
                      }
                    }
                  });
                }
              });
              
              fabricCanvas.renderAll();
            });
            
            // Update selection rectangle during scaling
            img.on('scaling', () => {
              const selectionRect = fabricCanvas.getObjects().find((obj: any) => 
                obj.type === 'rect' && obj.selectionMarker && obj.data?.meterId === pos.meter_id
              );
              if (selectionRect) {
                const bounds = img.getBoundingRect();
                selectionRect.set({
                  left: bounds.left,
                  top: bounds.top,
                  width: bounds.width,
                  height: bounds.height
                });
              }
            });
            
            img.on('modified', async () => {
              // Update selection rectangle after modification
              const selectionRect = fabricCanvas.getObjects().find((obj: any) => 
                obj.type === 'rect' && obj.selectionMarker && obj.data?.meterId === pos.meter_id
              );
              if (selectionRect) {
                const bounds = img.getBoundingRect();
                selectionRect.set({
                  left: bounds.left,
                  top: bounds.top,
                  width: bounds.width,
                  height: bounds.height
                });
                fabricCanvas.renderAll();
              }
              
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
                // Update connection line positions in database
                const currentX = img.left || 0;
                const currentY = img.top || 0;
                const actualWidth = cardWidth * baseScaleX * savedScaleX;
                const actualHeight = cardHeight * baseScaleY * savedScaleY;
                
                const snapPoints = calculateSnapPoints(
                  currentX - actualWidth / 2,
                  currentY - actualHeight / 2,
                  actualWidth,
                  actualHeight
                );
                
                // Find all schematic lines connected to this meter
                const linesToUpdate: any[] = [];
                schematicLines.forEach(line => {
                  const parentId = line.metadata?.parent_meter_id;
                  const childId = line.metadata?.child_meter_id;
                  const nodeIndex = line.metadata?.node_index || 0;
                  
                  if (parentId === pos.meter_id && nodeIndex === 0) {
                    // First segment from this meter
                    linesToUpdate.push({
                      id: line.id,
                      from_x: snapPoints.bottom.x,
                      from_y: snapPoints.bottom.y
                    });
                  } else if (childId === pos.meter_id) {
                    // Check if it's the last segment to this meter
                    const allSegments = schematicLines.filter(l =>
                      l.metadata?.parent_meter_id === parentId &&
                      l.metadata?.child_meter_id === childId
                    );
                    const maxIndex = Math.max(...allSegments.map(s => s.metadata?.node_index || 0));
                    
                    if (nodeIndex === maxIndex) {
                      linesToUpdate.push({
                        id: line.id,
                        to_x: snapPoints.top.x,
                        to_y: snapPoints.top.y
                      });
                    }
                  }
                });
                
                // Update all affected lines in database
                for (const lineUpdate of linesToUpdate) {
                  const updateData: any = {};
                  if (lineUpdate.from_x !== undefined) {
                    updateData.from_x = lineUpdate.from_x;
                    updateData.from_y = lineUpdate.from_y;
                  }
                  if (lineUpdate.to_x !== undefined) {
                    updateData.to_x = lineUpdate.to_x;
                    updateData.to_y = lineUpdate.to_y;
                  }
                  
                  await supabase
                    .from('schematic_lines')
                    .update(updateData)
                    .eq('id', lineUpdate.id);
                }
                
                if (linesToUpdate.length > 0) {
                  await fetchSchematicLines();
                }
                
                toast.success('Meter card updated');
                fetchMeterPositions();
              } else {
                toast.error('Failed to update meter card');
              }
            });
          }

          fabricCanvas.add(img);
          fabricCanvas.bringObjectToFront(img);
          
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
                radius: 8,
                fill: '#3b82f6',
                originX: 'center',
                originY: 'center',
                selectable: false,
                evented: true,
                opacity: 0.9,
                hoverCursor: 'crosshair'
              });
              (snapCircle as any).isSnapPoint = true;
              (snapCircle as any).meterId = pos.meter_id;
              
            fabricCanvas.add(snapCircle);
          });
        }
        
        fabricCanvas.renderAll();
        resolve(); // Resolve when this meter card is fully loaded
      };
    });
      });
      
      meterCardPromises.push(cardPromise);
    });

    // Wait for all meter cards to load before marking as ready
    Promise.all(meterCardPromises).then(() => {
      setAreMeterCardsLoaded(true);
      console.log('✅ All meter cards loaded');
    });

    fabricCanvas.renderAll();
  }, [fabricCanvas, isInitialDataLoaded, isCanvasReady, meterPositions, meters, activeTool, extractedMeters, legendVisibility, selectedExtractedMeterIds, showConfirmed, showUnconfirmed]);

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

  const fetchMeterConnections = async () => {
    const { data: siteMeters } = await supabase
      .from('meters')
      .select('id')
      .eq('site_id', siteId);

    if (!siteMeters) return;

    const meterIds = siteMeters.map(m => m.id);

    const { data, error } = await supabase
      .from('meter_connections')
      .select('*')
      .or(`child_meter_id.in.(${meterIds.join(',')}),parent_meter_id.in.(${meterIds.join(',')})`);

    if (error) {
      console.error('Error fetching connections:', error);
      return;
    }

    setMeterConnections(data || []);
  };

  const fetchSchematicLines = async () => {
    const { data, error } = await supabase
      .from('schematic_lines')
      .select('*')
      .eq('schematic_id', schematicId)
      .eq('line_type', 'connection');

    if (error) {
      console.error('Error fetching schematic lines:', error);
      return;
    }

    setSchematicLines(data || []);
  };

  // Render connection lines on canvas when connections or positions change
  useEffect(() => {
    if (!fabricCanvas || !isInitialDataLoaded || !isCanvasReady) return;

    // Remove existing connection lines and nodes
    fabricCanvas.getObjects().forEach((obj: any) => {
      if (obj.isConnectionLine || obj.isConnectionNode) {
        fabricCanvas.remove(obj);
      }
    });
    
    // If no connections or connections are hidden, just return after removing them
    if (!schematicLines.length || !showConnections) {
      fabricCanvas.renderAll();
      return;
    }

    // Find background image index for proper layering
    const backgroundIndex = fabricCanvas.getObjects().findIndex(obj => (obj as any).isBackgroundImage);

    // Group line segments by connection (parent_meter_id + child_meter_id)
    const connectionGroups = new Map<string, any[]>();
    schematicLines.forEach(line => {
      const parentId = line.metadata?.parent_meter_id;
      const childId = line.metadata?.child_meter_id;
      if (!parentId || !childId) return;
      
      const key = `${parentId}-${childId}`;
      if (!connectionGroups.has(key)) {
        connectionGroups.set(key, []);
      }
      connectionGroups.get(key)!.push(line);
    });

    // Render each connection group
    connectionGroups.forEach((lines, connectionKey) => {
      // Sort by node_index to ensure correct order
      const sortedLines = lines.sort((a, b) => 
        (a.metadata?.node_index || 0) - (b.metadata?.node_index || 0)
      );

      const lineSegments: Line[] = [];
      const nodePositions: Array<{ x: number; y: number }> = [];

      // Create line segments and collect node positions
      // Get canvas dimensions for percentage to pixel conversion
      const canvasWidth = fabricCanvas.getWidth();
      const canvasHeight = fabricCanvas.getHeight();
      
      sortedLines.forEach((lineData, index) => {
        const isSelected = selectedConnectionKeys.includes(connectionKey);
        
        // Convert percentage coordinates to pixels (like meter cards)
        const fromX = (lineData.from_x / 100) * canvasWidth;
        const fromY = (lineData.from_y / 100) * canvasHeight;
        const toX = (lineData.to_x / 100) * canvasWidth;
        const toY = (lineData.to_y / 100) * canvasHeight;
        
        const lineSegment = new Line(
          [fromX, fromY, toX, toY],
          {
            stroke: isSelected ? '#ef4444' : (lineData.color || '#000000'),
            strokeWidth: lineData.stroke_width || 6,
            selectable: false,
            evented: true,
            hoverCursor: 'pointer',
          }
        );
        (lineSegment as any).isConnectionLine = true;
        (lineSegment as any).connectionKey = connectionKey;
        (lineSegment as any).lineId = lineData.id; // Store line ID for database updates
        
        // Add click handler for selecting connections in select mode
        lineSegment.on('mousedown', (e: any) => {
          if (activeToolRef.current === 'select' && isSelectionModeRef.current) {
            if (e.e.shiftKey) {
              // Shift key: toggle selection
              setSelectedConnectionKeys(prev => 
                prev.includes(connectionKey) 
                  ? prev.filter(k => k !== connectionKey)
                  : [...prev, connectionKey]
              );
            } else {
              // No shift: replace selection
              setSelectedConnectionKeys([connectionKey]);
            }
            toast.info(`Connection ${e.e.shiftKey ? 'toggled' : 'selected'}`);
            e.e.stopPropagation();
          }
        });
        lineSegments.push(lineSegment);
        
        // Add line above background
        if (backgroundIndex !== -1) {
          fabricCanvas.insertAt(backgroundIndex + 1, lineSegment);
        } else {
          fabricCanvas.add(lineSegment);
        }
        
        // Bring selected connection to front
        if (isSelected) {
          fabricCanvas.bringObjectToFront(lineSegment);
        }

        // Collect unique node positions (already converted to pixels)
        if (index === 0) {
          nodePositions.push({ x: fromX, y: fromY });
        }
        nodePositions.push({ x: toX, y: toY });
      });

      // Create nodes at all positions
      nodePositions.forEach((pos, index) => {
        const isEndpoint = index === 0 || index === nodePositions.length - 1;
        const isSelected = selectedConnectionKeys.includes(connectionKey);
        const node = new Circle({
          left: pos.x,
          top: pos.y,
          radius: 4,
          fill: isSelected ? '#ef4444' : '#000000',
          originX: 'center',
          originY: 'center',
          selectable: !isEndpoint,
          evented: true,
          hasControls: false,
          hasBorders: false,
          hoverCursor: isEndpoint ? 'pointer' : 'move',
        });
        (node as any).isConnectionNode = true;
        (node as any).connectionKey = connectionKey;
        
        // Add click handler for selecting connections in select mode
        node.on('mousedown', (e: any) => {
          if (activeToolRef.current === 'select' && isSelectionModeRef.current) {
            if (e.e.shiftKey) {
              // Shift key: toggle selection
              setSelectedConnectionKeys(prev => 
                prev.includes(connectionKey) 
                  ? prev.filter(k => k !== connectionKey)
                  : [...prev, connectionKey]
              );
            } else {
              // No shift: replace selection
              setSelectedConnectionKeys([connectionKey]);
            }
            toast.info(`Connection ${e.e.shiftKey ? 'toggled' : 'selected'}`);
            e.e.stopPropagation();
          }
        });
        
        // Store references to connected line segments
        const connectedLines: Line[] = [];
        if (index > 0) connectedLines.push(lineSegments[index - 1]);
        if (index < nodePositions.length - 1) connectedLines.push(lineSegments[index]);
        (node as any).connectedLines = connectedLines;
        
        fabricCanvas.add(node);
        
        // Bring selected connection nodes to front
        if (isSelected) {
          fabricCanvas.bringObjectToFront(node);
        }
      });
    });

    fabricCanvas.renderAll();
  }, [fabricCanvas, isInitialDataLoaded, isCanvasReady, schematicLines, selectedConnectionKeys, showConnections]);

  // Effect to highlight a specific meter when highlightedMeterId is provided
  useEffect(() => {
    if (!fabricCanvas || !highlightedMeterId || !areMeterCardsLoaded) return;

    console.log('🔍 Looking for meter with ID:', highlightedMeterId);
    
    // Log all meter objects to see their structure
    const allObjects = fabricCanvas.getObjects();
    console.log('📊 Total canvas objects:', allObjects.length);
    
    const imageObjects = allObjects.filter((obj: any) => obj.type === 'image');
    console.log('🖼️ Image objects:', imageObjects.length);
    
    imageObjects.forEach((obj: any, index) => {
      console.log(`Image ${index}:`, {
        type: obj.type,
        hasData: !!obj.data,
        meterId: obj.data?.meterId,
        positionId: obj.data?.positionId
      });
    });

    // Find the meter card object on the canvas (meter cards are type 'image' with data.meterId)
    const meterObjects = fabricCanvas.getObjects().filter((obj: any) => 
      obj.type === 'image' && obj.data?.meterId === highlightedMeterId
    );

    console.log('🎯 Found meter objects:', meterObjects.length);

    if (meterObjects.length > 0) {
      const meterCard = meterObjects[0] as any;
      
      console.log('✅ Meter found, highlighting it');
      
      // Select the meter card with enhanced visibility
      fabricCanvas.setActiveObject(meterCard);
      
      // Make the selection border more visible
      meterCard.set({
        borderColor: '#ff0000',
        borderScaleFactor: 3,
        cornerColor: '#ff0000',
        cornerSize: 12,
        transparentCorners: false,
        cornerStrokeColor: '#ffffff',
        borderOpacityWhenMoving: 1,
      });
      
      fabricCanvas.renderAll();
      
      toast.success('Meter located on schematic');
    } else {
      console.log('❌ Meter not found on this schematic');
      toast.error('Meter not found on this schematic');
    }
  }, [fabricCanvas, highlightedMeterId, areMeterCardsLoaded]);

  // Toggle background visibility
  useEffect(() => {
    if (!fabricCanvas) return;
    
    fabricCanvas.getObjects().forEach((obj: any) => {
      if (obj.isBackgroundImage) {
        obj.set({ visible: showBackground });
      }
    });
    
    fabricCanvas.renderAll();
  }, [fabricCanvas, showBackground]);


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
    
    // Reset edit mode and all selection states
    setIsEditMode(false);
    setActiveTool("select");
    activeToolRef.current = "select";
    setIsSelectionMode(false);
    setIsDrawingMode(false);
    
    // Clear all selections
    setSelectedExtractedMeterIds([]);
    setSelectedMeterIds([]);
    setSelectedRegionIndices([]);
    setSelectedConnectionKeys([]);
  };


  const handleZoomIn = () => {
    if (!fabricCanvas) return;
    const newZoom = Math.min(zoom * 1.25, 10);
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

  const navigateToPreviousMeter = async () => {
    if (bulkEditMeterIds.length === 0 || currentBulkEditIndex === 0) return;
    
    const newIndex = currentBulkEditIndex - 1;
    const { data: meterData, error } = await supabase
      .from('meters')
      .select('*')
      .eq('id', bulkEditMeterIds[newIndex])
      .single();
    
    if (error || !meterData) {
      toast.error('Failed to load meter');
      return;
    }
    
    setCurrentBulkEditIndex(newIndex);
    setEditingMeter({
      ...meterData,
      scannedImageSnippet: meterData.scanned_snippet_url || undefined
    });
  };

  const navigateToNextMeter = async () => {
    if (bulkEditMeterIds.length === 0 || currentBulkEditIndex >= bulkEditMeterIds.length - 1) return;
    
    const newIndex = currentBulkEditIndex + 1;
    const { data: meterData, error } = await supabase
      .from('meters')
      .select('*')
      .eq('id', bulkEditMeterIds[newIndex])
      .single();
    
    if (error || !meterData) {
      toast.error('Failed to load meter');
      return;
    }
    
    setCurrentBulkEditIndex(newIndex);
    setEditingMeter({
      ...meterData,
      scannedImageSnippet: meterData.scanned_snippet_url || undefined
    });
  };


  const handleUpdateMeter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMeter) return;

    const formData = new FormData(e.target as HTMLFormElement);
    let meterNumber = formData.get('meter_number') as string;
    
    // Generate unique meter number if empty
    if (!meterNumber || meterNumber.trim() === '') {
      // Query existing AUTO-METER numbers to find next available
      const { data: existingMeters } = await supabase
        .from("meters")
        .select("meter_number")
        .eq("site_id", siteId)
        .like("meter_number", "AUTO-%");
      
      // Find the next available AUTO-METER number
      const autoNumbers = (existingMeters || [])
        .map(m => {
          const match = m.meter_number.match(/AUTO-METER-(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => n > 0);
      
      const nextNumber = autoNumbers.length > 0 ? Math.max(...autoNumbers) + 1 : 1;
      meterNumber = `AUTO-METER-${String(nextNumber).padStart(3, '0')}`;
      
      toast.info(`Generated meter number: ${meterNumber}`);
    }
    
    // Check if another meter (not this one) has the same meter_number
    const { data: duplicateMeter } = await supabase
      .from("meters")
      .select("id, meter_number")
      .eq("site_id", siteId)
      .eq("meter_number", meterNumber)
      .neq("id", editingMeter.id)
      .maybeSingle();
    
    if (duplicateMeter) {
      toast.error(`Meter number "${meterNumber}" is already used by another meter. Please use a unique meter number.`);
      return;
    }
    
    // Get tariff_structure_id and ensure it's valid UUID or null
    const tariffValue = formData.get('tariff_structure_id') as string;
    const isValidUUID = tariffValue && tariffValue !== 'none' && tariffValue.length === 36 && tariffValue.includes('-');
    
    const updatedData = {
      meter_number: meterNumber,
      name: formData.get('name') as string,
      area: formData.get('area') ? Number(formData.get('area')) : null,
      rating: formData.get('rating') as string,
      cable_specification: formData.get('cable_specification') as string,
      serial_number: formData.get('serial_number') as string,
      ct_type: formData.get('ct_type') as string,
      meter_type: formData.get('meter_type') as string,
      zone: formData.get('zone') as string || null,
      location: formData.get('location') as string || null,
      tariff_structure_id: isValidUUID ? tariffValue : null,
      confirmation_status: 'confirmed', // Automatically approve on save
    };

    const { error } = await supabase
      .from('meters')
      .update(updatedData)
      .eq('id', editingMeter.id);

    if (error) {
      console.error('Error updating meter:', error);
      toast.error('Failed to save meter');
      return;
    }

    toast.success('Meter saved and approved');
    
    // If in bulk edit mode, move to next meter
    if (bulkEditMeterIds.length > 0 && currentBulkEditIndex < bulkEditMeterIds.length - 1) {
      await navigateToNextMeter();
    } else if (bulkEditMeterIds.length > 0) {
      // Last meter in bulk edit
      toast.success(`All ${bulkEditMeterIds.length} meters saved and approved!`);
      setIsEditMeterDialogOpen(false);
      setEditingMeter(null);
      setBulkEditMeterIds([]);
      setCurrentBulkEditIndex(0);
      setSelectedMeterIds([]);
    } else {
      // Single meter edit
      setIsEditMeterDialogOpen(false);
      setEditingMeter(null);
    }
    
    fetchMeters();
    fetchMeterPositions();
  };

  const handleScanAll = async () => {
    if (!schematicUrl) return;
    setIsSaving(true);
    
    console.log('=== handleScanAll START ===', { 
      drawnRegionsCount: drawnRegions.length, 
      siteId, 
      schematicId,
      schematicUrl 
    });
    
    try {
      // Case A: No regions drawn - scan entire PDF
      if (drawnRegions.length === 0) {
        console.log('Case A: No regions drawn, doing full extraction');
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
        console.log('Case B: Processing', drawnRegions.length, 'drawn regions');
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
            
            // Store both the preview URL and blob
            const croppedImageData = croppedImageUrl;
            const previewUrl = croppedImageData.previewUrl;
            const snippetBlob = croppedImageData.blob;
            
            // Calculate position percentages for this region
            // Rectangles use top-left origin, but meter cards use center origin
            // So we need to add half the card dimensions to center the position
            const canvasWidth = fabricCanvas?.getWidth() || 1000;
            const canvasHeight = fabricCanvas?.getHeight() || 1000;
            
            // Base meter card size is 200x140
            const baseMeterWidth = 200;
            const baseMeterHeight = 140;
            
            // Convert region dimensions to percentages
            const regionWidthPercent = (region.displayWidth / canvasWidth) * 100;
            const regionHeightPercent = (region.displayHeight / canvasHeight) * 100;
            
            // Calculate top-left corner as percentage
            const topLeftXPercent = (region.x / imageWidth) * 100;
            const topLeftYPercent = (region.y / imageHeight) * 100;
            
            // Adjust to center origin (add half the card dimensions)
            const xPercent = topLeftXPercent + (regionWidthPercent / 2);
            const yPercent = topLeftYPercent + (regionHeightPercent / 2);
            
            // Try to extract meter data
            let extractedMeterData: any = null;
            try {
              const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
                body: { 
                  imageUrl: previewUrl,
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
            // Generate a unique meter number if none was extracted
            let meterNumber = extractedMeterData?.meter_number;
            
            if (!meterNumber) {
              // Generate a unique meter number: Check existing meters and create sequential number
              const { data: existingMeters } = await supabase
                .from("meters")
                .select("meter_number")
                .eq("site_id", siteId)
                .like("meter_number", "AUTO-%");
              
              // Find the next available AUTO-METER number
              const autoNumbers = (existingMeters || [])
                .map(m => {
                  const match = m.meter_number.match(/AUTO-METER-(\d+)/);
                  return match ? parseInt(match[1], 10) : 0;
                })
                .filter(n => n > 0);
              
              const nextNumber = autoNumbers.length > 0 ? Math.max(...autoNumbers) + 1 : 1;
              meterNumber = `AUTO-METER-${String(nextNumber).padStart(3, '0')}`;
              
              toast.info(`No meter number found - generated ${meterNumber}`);
            }
            
            // Validate meter_type - use council_meter as default
            let meterType = extractedMeterData?.meter_type || "council_meter";
            const validMeterTypes = ["council_meter", "bulk_meter", "check_meter", "tenant_meter", "other"];
            if (!validMeterTypes.includes(meterType)) {
              console.warn(`Invalid meter_type "${meterType}", defaulting to "council_meter"`);
              meterType = "council_meter";
            }
            
            // Check if meter with this number already exists for this site
            const { data: existingMeter } = await supabase
              .from("meters")
              .select("id")
              .eq("site_id", siteId)
              .eq("meter_number", meterNumber)
              .maybeSingle();
            
            let newMeter;
            
            if (existingMeter) {
              // Update existing meter with new data
              console.log(`Updating existing meter ${meterNumber}`);
              const { data: updatedMeter, error: updateError} = await supabase
                .from("meters")
                .update({
                  name: extractedMeterData?.name || "VACANT",
                  meter_type: meterType,
                  zone: extractedMeterData?.zone || null,
                  area: extractedMeterData?.area ? parseFloat(extractedMeterData.area.replace('m²', '')) : null,
                  rating: extractedMeterData?.rating || null,
                  cable_specification: extractedMeterData?.cable_specification || null,
                  serial_number: extractedMeterData?.serial_number || null,
                  ct_type: extractedMeterData?.ct_type || null,
                  scanned_snippet_url: null, // Will be set after upload
                  confirmation_status: 'unconfirmed', // Re-scanned meters are unconfirmed
                })
                .eq("id", existingMeter.id)
                .select()
                .single();
              
              if (updateError) {
                console.error(`Failed to update existing meter ${meterNumber}:`, updateError);
                errorCount++;
                continue;
              }
              newMeter = updatedMeter;
              toast.info(`Updated existing meter ${meterNumber}`);
            } else {
              // Create new meter
              const { data: createdMeter, error: meterError } = await supabase
                .from("meters")
                .insert({
                  site_id: siteId,
                  meter_number: meterNumber,
                  name: extractedMeterData?.name || "VACANT",
                  meter_type: meterType,
                  zone: extractedMeterData?.zone || null,
                  area: extractedMeterData?.area ? parseFloat(extractedMeterData.area.replace('m²', '')) : null,
                  rating: extractedMeterData?.rating || null,
                  cable_specification: extractedMeterData?.cable_specification || null,
                  serial_number: extractedMeterData?.serial_number || null,
                  ct_type: extractedMeterData?.ct_type || null,
                  location: null,
                  tariff: null,
                  is_revenue_critical: false,
                  scanned_snippet_url: null, // Will be set after upload
                  confirmation_status: 'unconfirmed', // New scanned meters are unconfirmed
                })
                .select()
                .single();
              
              if (meterError) {
                console.error(`Failed to create meter for region ${i + 1}:`, meterError);
                errorCount++;
                continue;
              }
              newMeter = createdMeter;
              if (extractedMeterData) {
                toast.success(`Created meter ${meterNumber} with AI data`);
              } else {
                toast.info(`Created empty meter ${meterNumber} - edit to populate`);
              }
            }
            
            if (!newMeter) {
              errorCount++;
              continue;
            }
            
            // Upload snippet directly to hierarchical location
            if (snippetBlob) {
              try {
                // Generate proper hierarchical path for the snippet
                const { generateStoragePath, sanitizeName } = await import("@/lib/storagePaths");
                const snippetFileName = `${sanitizeName(newMeter.meter_number)}_snippet.png`;
                const { bucket: snippetBucket, path: snippetPath } = await generateStoragePath(siteId, 'Metering', 'Meters', snippetFileName);
                
                // Upload directly to final location
                const { error: uploadError } = await supabase.storage
                  .from(snippetBucket)
                  .upload(snippetPath, snippetBlob, {
                    contentType: 'image/png',
                    upsert: true
                  });
                
                if (!uploadError) {
                  // Get public URL
                  const { data: { publicUrl } } = supabase.storage
                    .from(snippetBucket)
                    .getPublicUrl(snippetPath);
                  
                  // Update meter with snippet URL
                  await supabase
                    .from('meters')
                    .update({ scanned_snippet_url: publicUrl })
                    .eq('id', newMeter.id);
                  
                  console.log(`✅ Uploaded snippet to ${snippetPath}`);
                } else {
                  console.error('Error uploading snippet:', uploadError);
                }
              } catch (snippetError) {
                console.error('Failed to upload snippet:', snippetError);
              }
            }
            
            // Calculate scale based on drawn rectangle size
            // (canvas dimensions and base meter size already declared above)
            
            // Convert region display dimensions to scale factors
            const scaleX = region.displayWidth / baseMeterWidth;
            const scaleY = region.displayHeight / baseMeterHeight;
            
            // Create meter position on schematic with proper scale
            const { error: posError } = await supabase
              .from("meter_positions")
              .insert({
                schematic_id: schematicId,
                meter_id: newMeter.id,
                x_position: xPercent,
                y_position: yPercent,
                label: meterNumber,
                scale_x: scaleX,
                scale_y: scaleY
              });
            
            if (posError) {
              console.error(`Failed to create position for region ${i + 1}:`, posError);
              errorCount++;
            } else {
              successCount++;
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

  // Add selected meters to scanning queue
  const handleQueueSelectedMeters = async () => {
    if (selectedMeterIds.length === 0) {
      toast.error('No meters selected');
      return;
    }

    // Fetch meter data for selected meters
    const { data: metersData, error } = await supabase
      .from('meters')
      .select('id, meter_number, scanned_snippet_url')
      .in('id', selectedMeterIds);

    if (error) {
      toast.error('Failed to fetch meter data');
      return;
    }

    // Filter meters that have snippet URLs
    const metersWithSnippets = metersData.filter(m => m.scanned_snippet_url);
    
    if (metersWithSnippets.length === 0) {
      toast.error('Selected meters have no scanned images to extract from');
      return;
    }

    const newQueueItems: QueuedScan[] = metersWithSnippets.map(m => ({
      meterId: m.id,
      meterNumber: m.meter_number,
      snippetUrl: m.scanned_snippet_url!,
    }));

    setScanQueue(prev => [...prev, ...newQueueItems]);
    toast.success(`Added ${newQueueItems.length} meter(s) to scan queue`);
  };

  // Process scan queue
  useEffect(() => {
    if (isProcessingQueue.current || scanQueue.length === 0 || currentlyScanning) return;
    
    const processNext = async () => {
      isProcessingQueue.current = true;
      const [nextScan, ...remainingQueue] = scanQueue;
      
      setCurrentlyScanning(nextScan);
      setScanQueue(remainingQueue);

      try {
        const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
          body: { 
            imageUrl: nextScan.snippetUrl,
            mode: 'extract-region',
            region: {
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              imageWidth: 100,
              imageHeight: 100,
            }
          }
        });

        if (error) throw error;

        if (data?.meters && data.meters.length > 0) {
          const extractedData = data.meters[0];
          
          // Update meter with extracted data
          const { error: updateError } = await supabase
            .from('meters')
            .update({
              name: extractedData.name || null,
              area: extractedData.area ? parseFloat(extractedData.area) : null,
              rating: extractedData.rating || null,
              cable_specification: extractedData.cable_specification || null,
              serial_number: extractedData.serial_number || null,
              ct_type: extractedData.ct_type || null,
              meter_type: extractedData.meter_type || 'council_meter',
              zone: extractedData.zone || null,
              location: extractedData.location || null,
            })
            .eq('id', nextScan.meterId);

          if (updateError) throw updateError;
          
          setScannedCount(prev => prev + 1);
          toast.success(`Scanned ${nextScan.meterNumber}`);
        } else {
          toast.warning(`No data extracted from ${nextScan.meterNumber}`);
        }

        await fetchMeters();
        await fetchMeterPositions();
      } catch (err) {
        console.error('Scan error:', err);
        toast.error(`Failed to scan ${nextScan.meterNumber}`);
      } finally {
        setCurrentlyScanning(null);
        isProcessingQueue.current = false;
      }
    };

    processNext();
  }, [scanQueue, currentlyScanning]);

  // Reset scanned count when queue is empty
  useEffect(() => {
    if (scanQueue.length === 0 && !currentlyScanning) {
      setScannedCount(0);
    }
  }, [scanQueue.length, currentlyScanning]);

  return (
    <div className="space-y-2">
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
          <Button
            variant={isSelectionMode ? "default" : "outline"}
            onClick={() => {
              const hasSelections = selectedRegionIndices.length > 0 || selectedMeterIds.length > 0 || selectedConnectionKeys.length > 0;
              
              if (isSelectionMode && hasSelections) {
                // Clear all selections and reset visual styling
                if (fabricCanvas) {
                  fabricCanvas.getObjects().forEach((obj: any) => {
                    if (obj.type === 'rect' && obj.regionId) {
                      obj.set({ stroke: '#3b82f6', strokeWidth: 2 });
                    }
                    // Remove selection marker rectangles
                    if (obj.type === 'rect' && obj.selectionMarker) {
                      fabricCanvas.remove(obj);
                    }
                  });
                  fabricCanvas.renderAll();
                }
                setSelectedRegionIndices([]);
                setSelectedMeterIds([]);
                setSelectedConnectionKeys([]);
                setIsSelectionMode(false);
                toast.info("Selection cleared");
              } else {
                // Toggle selection mode and reset other tools
                setIsSelectionMode(!isSelectionMode);
                // Reset activeTool to "select" if coming from another mode
                if (activeTool !== "select") {
                  setActiveTool("select");
                }
                if (!isSelectionMode) {
                  toast.info("Click to select meters or connections, hold SHIFT and drag for multiple", { duration: 4000 });
                }
              }
            }}
            disabled={!isEditMode}
            size="sm"
            className="gap-2"
          >
            <Check className="w-4 h-4" />
            Select {(selectedRegionIndices.length + selectedMeterIds.length + selectedConnectionKeys.length) > 0 && `(${selectedRegionIndices.length + selectedMeterIds.length + selectedConnectionKeys.length})`}
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
                // Enable draw mode and disable selection mode
                setActiveTool("draw");
                setIsSelectionMode(false);
                toast.info("Click to draw regions. Use SCROLL to pan, CTRL+SCROLL to zoom, SHIFT+SCROLL for horizontal.", { duration: 4000 });
              }
            }}
            disabled={!isEditMode}
            size="sm"
            className="gap-2"
          >
            <Scan className="w-4 h-4" />
            Regions {drawnRegions.length > 0 && `(${drawnRegions.length})`}
          </Button>
          <Button
            variant={activeTool === "connection" ? "default" : "outline"}
            onClick={() => {
              const newTool = activeTool === "connection" ? "select" : "connection";
              setActiveTool(newTool);
              // Disable selection mode when entering connection mode
              if (newTool === "connection") {
                setIsSelectionMode(false);
                toast.info("Click snap points to draw connections between meters");
              }
            }}
            disabled={!isEditMode}
            size="sm"
            className="gap-2"
          >
            <Link2 className="w-4 h-4" />
            Connections
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
            variant="outline"
            onClick={() => {
              if (!isEditMode) {
                setIsEditMode(true);
                setActiveTool("select");
                toast.success("Edit mode enabled");
              } else {
                // Cancel edit mode and reset all selections
                setIsEditMode(false);
                setActiveTool("select");
                activeToolRef.current = "select";
                setIsSelectionMode(false);
                setIsDrawingMode(false);
                
                // Clear all selections
                setSelectedExtractedMeterIds([]);
                setSelectedMeterIds([]);
                setSelectedRegionIndices([]);
                setSelectedConnectionKeys([]);
                
                // Deselect all canvas objects
                if (fabricCanvas) {
                  fabricCanvas.discardActiveObject();
                  fabricCanvas.renderAll();
                }
                
                toast.info("Edit mode cancelled - unsaved changes discarded");
              }
            }}
            size="sm"
          >
            <Zap className="w-4 h-4 mr-2" />
            {isEditMode ? "Close" : "Edit"}
          </Button>
        </div>
      </div>

      {/* Second row: Bulk Action buttons (visible when in selection mode with selected items) */}
      {isSelectionMode && (selectedRegionIndices.length > 0 || selectedMeterIds.length > 0 || selectedConnectionKeys.length > 0) && (
        <div className="flex gap-2 items-center flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              // Fetch all meter data for bulk editing
              const { data: metersData, error } = await supabase
                .from('meters')
                .select('*')
                .in('id', selectedMeterIds)
                .order('meter_number');
              
              if (error || !metersData || metersData.length === 0) {
                toast.error('Failed to load meters for editing');
                return;
              }
              
              // Set up bulk editing state and map scanned_snippet_url to scannedImageSnippet
              setBulkEditMeterIds(metersData.map(m => m.id));
              setCurrentBulkEditIndex(0);
              setEditingMeter({
                ...metersData[0],
                scannedImageSnippet: metersData[0].scanned_snippet_url || undefined
              });
              setIsEditMeterDialogOpen(true);
            }}
            disabled={selectedMeterIds.length === 0 || selectedConnectionKeys.length > 0 || selectedRegionIndices.length > 0}
            className="gap-2"
          >
            <Edit className="w-4 h-4" />
            Edit {selectedMeterIds.length > 0 && `(${selectedMeterIds.length})`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleQueueSelectedMeters}
            disabled={selectedMeterIds.length === 0 || selectedConnectionKeys.length > 0 || selectedRegionIndices.length > 0}
            className="gap-2"
          >
            <Scan className="w-4 h-4" />
            Scan {selectedMeterIds.length > 0 && `(${selectedMeterIds.length})`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={deletionProgress !== null}
            onClick={async () => {
              const totalToDelete = selectedRegionIndices.length + selectedMeterIds.length + selectedConnectionKeys.length;
              let currentDeleted = 0;
              
              setDeletionProgress({ current: 0, total: totalToDelete });
              
              // Delete regions
              if (selectedRegionIndices.length > 0 && fabricCanvas) {
                selectedRegionIndices.forEach(index => {
                  const region = drawnRegions[index];
                  if (region?.fabricRect) {
                    fabricCanvas.remove(region.fabricRect);
                  }
                  currentDeleted++;
                  setDeletionProgress({ current: currentDeleted, total: totalToDelete });
                });
                const updatedRegions = drawnRegions.filter((_, i) => !selectedRegionIndices.includes(i));
                setDrawnRegions(updatedRegions);
                setSelectedRegionIndices([]);
              }
              
              // Delete connections
              if (selectedConnectionKeys.length > 0) {
                for (const connectionKey of selectedConnectionKeys) {
                  // Remove visual lines from canvas
                  if (fabricCanvas) {
                    const linesToRemove = fabricCanvas.getObjects().filter((obj: any) => {
                      if (obj.type !== 'line') return false;
                      const lineKey = `${obj.data?.parent_meter_id}-${obj.data?.child_meter_id}`;
                      return lineKey === connectionKey;
                    });
                    linesToRemove.forEach(line => fabricCanvas.remove(line));
                  }
                  
                  // Delete from database - schematic lines
                  const linesToDelete = schematicLines.filter(line => {
                    const key = `${line.metadata?.parent_meter_id}-${line.metadata?.child_meter_id}`;
                    return key === connectionKey;
                  });
                  
                  for (const line of linesToDelete) {
                    await supabase
                      .from('schematic_lines')
                      .delete()
                      .eq('id', line.id);
                  }
                  
                  // Delete from database - meter connections
                  const [parentId, childId] = connectionKey.split('-');
                  await supabase
                    .from('meter_connections')
                    .delete()
                    .match({ parent_meter_id: parentId, child_meter_id: childId });
                  
                  currentDeleted++;
                  setDeletionProgress({ current: currentDeleted, total: totalToDelete });
                }
                setSelectedConnectionKeys([]);
                await fetchSchematicLines();
                await fetchMeterConnections();
              }
              
              // Delete meters
              if (selectedMeterIds.length > 0) {
                // First, fetch meter data to get snippet URLs for deletion
                const { data: metersToDelete, error: fetchError } = await supabase
                  .from('meters')
                  .select('id, scanned_snippet_url')
                  .in('id', selectedMeterIds);
                
                if (!fetchError && metersToDelete) {
                  // Delete snippet images from storage
                  for (const meter of metersToDelete) {
                    if (meter.scanned_snippet_url) {
                      try {
                        // Parse URL format: https://[project].supabase.co/storage/v1/object/public/[bucket]/[path]
                        const urlParts = meter.scanned_snippet_url.split('/storage/v1/object/public/');
                        if (urlParts.length === 2) {
                          const [bucket, ...pathParts] = urlParts[1].split('/');
                          const filePath = pathParts.join('/');
                          
                          if (bucket && filePath) {
                            console.log(`Deleting snippet from bucket: ${bucket}, path: ${filePath}`);
                            const { error: storageError } = await supabase.storage
                              .from(bucket)
                              .remove([filePath]);
                            
                            if (storageError) {
                              console.error(`Error deleting snippet from ${bucket}/${filePath}:`, storageError);
                              toast.error(`Failed to delete snippet for meter ${meter.id}`);
                            } else {
                              console.log(`Successfully deleted snippet: ${filePath}`);
                            }
                          }
                        }
                      } catch (err) {
                        console.error('Error parsing snippet URL:', err);
                      }
                    }
                  }
                }
                
                if (fabricCanvas) {
                  selectedMeterIds.forEach(meterId => {
                    // Remove selection rectangle
                    const selectionRect = fabricCanvas.getObjects().find((obj: any) => 
                      obj.type === 'rect' && obj.selectionMarker && obj.data?.meterId === meterId
                    );
                    if (selectionRect) {
                      fabricCanvas.remove(selectionRect);
                    }
                    
                    // Remove meter card image
                    const meterCard = fabricCanvas.getObjects().find((obj: any) => 
                      obj.type === 'image' && obj.data?.meterId === meterId
                    );
                    if (meterCard) {
                      fabricCanvas.remove(meterCard);
                    }
                    
                    // Remove any snap point indicators
                    const snapPoints = fabricCanvas.getObjects().filter((obj: any) => 
                      obj.data?.snapPoint && obj.data?.meterId === meterId
                    );
                    snapPoints.forEach(sp => fabricCanvas.remove(sp));
                  });
                }
                
                for (const meterId of selectedMeterIds) {
                  // Delete meter positions for this schematic
                  await supabase
                    .from('meter_positions')
                    .delete()
                    .eq('meter_id', meterId)
                    .eq('schematic_id', schematicId);
                  
                  // Delete meter connections where this meter is involved
                  await supabase
                    .from('meter_connections')
                    .delete()
                    .or(`parent_meter_id.eq.${meterId},child_meter_id.eq.${meterId}`);
                  
                  // Delete the meter itself (this does NOT delete CSVs or documents)
                  await supabase
                    .from('meters')
                    .delete()
                    .eq('id', meterId);
                  
                  currentDeleted++;
                  setDeletionProgress({ current: currentDeleted, total: totalToDelete });
                  
                  // Force canvas update after each meter deletion
                  if (fabricCanvas) fabricCanvas.renderAll();
                }
                setSelectedMeterIds([]);
                
                await fetchMeters();
                await fetchMeterPositions();
                await fetchMeterConnections();
              }
              
              if (fabricCanvas) fabricCanvas.renderAll();
              
              // Build success message
              const parts = [];
              if (selectedRegionIndices.length > 0) parts.push(`${selectedRegionIndices.length} region(s)`);
              if (selectedConnectionKeys.length > 0) parts.push(`${selectedConnectionKeys.length} connection(s)`);
              if (selectedMeterIds.length > 0) parts.push(`${selectedMeterIds.length} meter(s)`);
              toast.success(`Deleted ${parts.join(', ')}`);
              
              setDeletionProgress(null);
            }}
            className="gap-2"
          >
            {deletionProgress ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Delete ({deletionProgress.current}/{deletionProgress.total})
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Delete ({selectedRegionIndices.length + selectedMeterIds.length + selectedConnectionKeys.length})
              </>
            )}
          </Button>
        </div>
      )}

      {/* Scan Queue Status */}
      {(scanQueue.length > 0 || currentlyScanning) && (
        <div className="flex gap-2 items-center">
          <Badge variant="secondary" className="gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Scanning: {currentlyScanning ? currentlyScanning.meterNumber : 'Processing...'}
          </Badge>
          <Badge variant="outline">
            Queue: {scanQueue.length} | Scanned: {scannedCount}
          </Badge>
        </div>
      )}

      {/* Third row: Other Action buttons */}
      <div className="flex gap-2 items-center flex-wrap">
        {activeTool === "draw" && (
          <>
            <Button 
              onClick={handleScanAll} 
              disabled={!isEditMode || isSaving || drawnRegions.length === 0} 
              variant="outline" 
              size="sm"
              title={drawnRegions.length === 0 ? "Draw regions first to scan" : ""}
            >
              <Scan className="w-4 h-4 mr-2" />
              {(() => {
                const buttonText = 'Scan Regions';
                if (extractionProgress) {
                  return `${buttonText} (${extractionProgress.current}/${extractionProgress.total})`;
                } else if (isSaving) {
                  return 'Scanning...';
                }
                return buttonText;
              })()}
            </Button>
            <Button
              variant="outline"
              onClick={handleClearRegions}
              disabled={!isEditMode || drawnRegions.length === 0}
              size="sm"
              className="gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Clear Regions
            </Button>
          </>
        )}
        {activeTool === "connection" && (
          <>
            <Button
              variant="outline"
              onClick={() => setIsConnectionsDialogOpen(true)}
              disabled={!isEditMode}
              size="sm"
              className="gap-2"
            >
              <Link2 className="w-4 h-4" />
              Manage
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (selectedConnectionKeys.length > 0) {
                  // Delete only selected connections
                  if (!confirm(`Delete ${selectedConnectionKeys.length} selected connection(s)?`)) return;
                  
                  for (const connectionKey of selectedConnectionKeys) {
                    const linesToDelete = schematicLines.filter(line => {
                      const key = `${line.metadata?.parent_meter_id}-${line.metadata?.child_meter_id}`;
                      return key === connectionKey;
                    });
                    
                    for (const line of linesToDelete) {
                      await supabase
                        .from('schematic_lines')
                        .delete()
                        .eq('id', line.id);
                    }
                    
                    const [parentId, childId] = connectionKey.split('-');
                    await supabase
                      .from('meter_connections')
                      .delete()
                      .match({ parent_meter_id: parentId, child_meter_id: childId });
                  }
                  
                  setSelectedConnectionKeys([]);
                  await fetchSchematicLines();
                  await fetchMeterConnections();
                  toast.success(`Deleted ${selectedConnectionKeys.length} connection(s)`);
                } else {
                  // Clear all connections
                  // Delete all schematic lines
                  const { error: linesError } = await supabase
                    .from('schematic_lines')
                    .delete()
                    .eq('schematic_id', schematicId);

                  if (linesError) {
                    console.error('Error clearing lines:', linesError);
                    return;
                  }

                  // Delete all meter connections for this site
                  // First get all meters for this site
                  const { data: siteMeters } = await supabase
                    .from('meters')
                    .select('id')
                    .eq('site_id', siteId);

                  if (siteMeters && siteMeters.length > 0) {
                    const meterIds = siteMeters.map(m => m.id);
                    
                    // Delete all connections involving any of these meters
                    const { error: connectionsError } = await supabase
                      .from('meter_connections')
                      .delete()
                      .or(`child_meter_id.in.(${meterIds.join(',')}),parent_meter_id.in.(${meterIds.join(',')})`);
                    
                    if (connectionsError) {
                      console.error('Error clearing connections:', connectionsError);
                    }
                  }

                  await fetchSchematicLines();
                  await fetchMeterConnections();
                }
              }}
              disabled={!isEditMode}
              size="sm"
              className="gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {selectedConnectionKeys.length > 0 ? 'Delete' : 'Clear'}
            </Button>
          </>
        )}
      </div>

      {/* Legend and PDF Controls in two panes */}
      <div className="flex gap-4 mb-2">
        {/* Left pane - Legends */}
        <div className="flex-1 p-2">
          {/* Single horizontal row with all legends and separators */}
          <div className="flex gap-3 flex-wrap items-center">
            {/* Zones */}
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 select-none ${!legendVisibility.council_connection_zone ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, council_connection_zone: !prev.council_connection_zone }))}
              onDoubleClick={() => {
                const isOnlyActive = legendVisibility.council_connection_zone && 
                  !legendVisibility.bulk_meter && !legendVisibility.check_meter && 
                  !legendVisibility.main_board_zone && !legendVisibility.mini_sub_zone && 
                  !legendVisibility.tenant_meter && !legendVisibility.other;
                
                if (isOnlyActive) {
                  setLegendVisibility({
                    bulk_meter: true,
                    check_meter: true,
                    main_board_zone: true,
                    mini_sub_zone: true,
                    council_connection_zone: true,
                    tenant_meter: true,
                    other: true
                  });
                } else {
                  setLegendVisibility({
                    bulk_meter: false,
                    check_meter: false,
                    main_board_zone: false,
                    mini_sub_zone: false,
                    council_connection_zone: true,
                    tenant_meter: false,
                    other: false
                  });
                }
              }}
            >
              <div className="w-3 h-3 rounded-full bg-[#ec4899] mr-2" />
              Council
            </Badge>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 select-none ${!legendVisibility.mini_sub_zone ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, mini_sub_zone: !prev.mini_sub_zone }))}
              onDoubleClick={() => {
                const isOnlyActive = legendVisibility.mini_sub_zone && 
                  !legendVisibility.bulk_meter && !legendVisibility.check_meter && 
                  !legendVisibility.main_board_zone && !legendVisibility.council_connection_zone && 
                  !legendVisibility.tenant_meter && !legendVisibility.other;
                
                if (isOnlyActive) {
                  setLegendVisibility({
                    bulk_meter: true,
                    check_meter: true,
                    main_board_zone: true,
                    mini_sub_zone: true,
                    council_connection_zone: true,
                    tenant_meter: true,
                    other: true
                  });
                } else {
                  setLegendVisibility({
                    bulk_meter: false,
                    check_meter: false,
                    main_board_zone: false,
                    mini_sub_zone: true,
                    council_connection_zone: false,
                    tenant_meter: false,
                    other: false
                  });
                }
              }}
            >
              <div className="w-3 h-3 rounded-full bg-[#06b6d4] mr-2" />
              Mini Sub
            </Badge>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 select-none ${!legendVisibility.main_board_zone ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, main_board_zone: !prev.main_board_zone }))}
              onDoubleClick={() => {
                const isOnlyActive = legendVisibility.main_board_zone && 
                  !legendVisibility.bulk_meter && !legendVisibility.check_meter && 
                  !legendVisibility.mini_sub_zone && !legendVisibility.council_connection_zone && 
                  !legendVisibility.tenant_meter && !legendVisibility.other;
                
                if (isOnlyActive) {
                  setLegendVisibility({
                    bulk_meter: true,
                    check_meter: true,
                    main_board_zone: true,
                    mini_sub_zone: true,
                    council_connection_zone: true,
                    tenant_meter: true,
                    other: true
                  });
                } else {
                  setLegendVisibility({
                    bulk_meter: false,
                    check_meter: false,
                    main_board_zone: true,
                    mini_sub_zone: false,
                    council_connection_zone: false,
                    tenant_meter: false,
                    other: false
                  });
                }
              }}
            >
              <div className="w-3 h-3 rounded-full bg-[#9333ea] mr-2" />
              Main Board
            </Badge>
            
            <Separator orientation="vertical" className="h-6 mx-1" />
            
            {/* Meters */}
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 select-none ${!legendVisibility.bulk_meter ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, bulk_meter: !prev.bulk_meter }))}
              onDoubleClick={() => {
                const isOnlyActive = legendVisibility.bulk_meter && 
                  !legendVisibility.check_meter && !legendVisibility.main_board_zone && 
                  !legendVisibility.mini_sub_zone && !legendVisibility.council_connection_zone && 
                  !legendVisibility.tenant_meter && !legendVisibility.other;
                
                if (isOnlyActive) {
                  setLegendVisibility({
                    bulk_meter: true,
                    check_meter: true,
                    main_board_zone: true,
                    mini_sub_zone: true,
                    council_connection_zone: true,
                    tenant_meter: true,
                    other: true
                  });
                } else {
                  setLegendVisibility({
                    bulk_meter: true,
                    check_meter: false,
                    main_board_zone: false,
                    mini_sub_zone: false,
                    council_connection_zone: false,
                    tenant_meter: false,
                    other: false
                  });
                }
              }}
            >
              <div className="w-3 h-3 rounded-full bg-[#ef4444] mr-2" />
              Bulk Meter
            </Badge>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 select-none ${!legendVisibility.check_meter ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, check_meter: !prev.check_meter }))}
              onDoubleClick={() => {
                const isOnlyActive = legendVisibility.check_meter && 
                  !legendVisibility.bulk_meter && !legendVisibility.main_board_zone && 
                  !legendVisibility.mini_sub_zone && !legendVisibility.council_connection_zone && 
                  !legendVisibility.tenant_meter && !legendVisibility.other;
                
                if (isOnlyActive) {
                  setLegendVisibility({
                    bulk_meter: true,
                    check_meter: true,
                    main_board_zone: true,
                    mini_sub_zone: true,
                    council_connection_zone: true,
                    tenant_meter: true,
                    other: true
                  });
                } else {
                  setLegendVisibility({
                    bulk_meter: false,
                    check_meter: true,
                    main_board_zone: false,
                    mini_sub_zone: false,
                    council_connection_zone: false,
                    tenant_meter: false,
                    other: false
                  });
                }
              }}
            >
              <div className="w-3 h-3 rounded-full bg-[#f59e0b] mr-2" />
              Check Meter
            </Badge>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 select-none ${!legendVisibility.tenant_meter ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, tenant_meter: !prev.tenant_meter }))}
              onDoubleClick={() => {
                const isOnlyActive = legendVisibility.tenant_meter && 
                  !legendVisibility.bulk_meter && !legendVisibility.check_meter && 
                  !legendVisibility.main_board_zone && !legendVisibility.mini_sub_zone && 
                  !legendVisibility.council_connection_zone && !legendVisibility.other;
                
                if (isOnlyActive) {
                  setLegendVisibility({
                    bulk_meter: true,
                    check_meter: true,
                    main_board_zone: true,
                    mini_sub_zone: true,
                    council_connection_zone: true,
                    tenant_meter: true,
                    other: true
                  });
                } else {
                  setLegendVisibility({
                    bulk_meter: false,
                    check_meter: false,
                    main_board_zone: false,
                    mini_sub_zone: false,
                    council_connection_zone: false,
                    tenant_meter: true,
                    other: false
                  });
                }
              }}
            >
              <div className="w-3 h-3 rounded-full bg-[#10b981] mr-2" />
              Tenant Meter
            </Badge>
            
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 select-none ${!legendVisibility.other ? 'opacity-40' : ''}`}
              onClick={() => setLegendVisibility(prev => ({ ...prev, other: !prev.other }))}
              onDoubleClick={() => {
                const isOnlyActive = legendVisibility.other && 
                  !legendVisibility.bulk_meter && !legendVisibility.check_meter && 
                  !legendVisibility.main_board_zone && !legendVisibility.mini_sub_zone && 
                  !legendVisibility.council_connection_zone && !legendVisibility.tenant_meter;
                
                if (isOnlyActive) {
                  setLegendVisibility({
                    bulk_meter: true,
                    check_meter: true,
                    main_board_zone: true,
                    mini_sub_zone: true,
                    council_connection_zone: true,
                    tenant_meter: true,
                    other: true
                  });
                } else {
                  setLegendVisibility({
                    bulk_meter: false,
                    check_meter: false,
                    main_board_zone: false,
                    mini_sub_zone: false,
                    council_connection_zone: false,
                    tenant_meter: false,
                    other: true
                  });
                }
              }}
            >
              <div className="w-3 h-3 rounded-full bg-[#3b82f6] mr-2" />
              Other
            </Badge>
            
            <Separator orientation="vertical" className="h-6 mx-1" />
            
            {/* Extracted Meters Status */}
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all select-none ${
                (() => {
                  const positionedMeterIds = meterPositions.map((pos: any) => pos.meter_id);
                  const positionedMeters = meters.filter((m: any) => positionedMeterIds.includes(m.id));
                  return positionedMeters.length > 0 && positionedMeters.every((m: any) => m.confirmation_status === 'confirmed');
                })()
                  ? 'opacity-40 cursor-not-allowed' 
                  : !showUnconfirmed 
                    ? 'opacity-40' 
                    : 'hover:bg-muted'
              }`}
              onClick={() => {
                const positionedMeterIds = meterPositions.map((pos: any) => pos.meter_id);
                const positionedMeters = meters.filter((m: any) => positionedMeterIds.includes(m.id));
                if (!(positionedMeters.length > 0 && positionedMeters.every((m: any) => m.confirmation_status === 'confirmed'))) {
                  setShowUnconfirmed(!showUnconfirmed);
                }
              }}
              onDoubleClick={() => {
                const positionedMeterIds = meterPositions.map((pos: any) => pos.meter_id);
                const positionedMeters = meters.filter((m: any) => positionedMeterIds.includes(m.id));
                if (!(positionedMeters.length > 0 && positionedMeters.every((m: any) => m.confirmation_status === 'confirmed'))) {
                  if (showUnconfirmed && !showConfirmed) {
                    setShowUnconfirmed(true);
                    setShowConfirmed(true);
                  } else {
                    setShowUnconfirmed(true);
                    setShowConfirmed(false);
                  }
                }
              }}
            >
              <div className="w-3 h-3 rounded-full bg-[#dc2626] border-2 border-[#dc2626] mr-2" />
              Unconfirmed
            </Badge>
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all select-none ${
                (() => {
                  const positionedMeterIds = meterPositions.map((pos: any) => pos.meter_id);
                  const positionedMeters = meters.filter((m: any) => positionedMeterIds.includes(m.id));
                  return positionedMeters.length > 0 && positionedMeters.every((m: any) => m.confirmation_status === 'confirmed');
                })()
                  ? 'opacity-40 cursor-not-allowed' 
                  : !showConfirmed 
                    ? 'opacity-40' 
                    : 'hover:bg-muted'
              }`}
              onClick={() => {
                const positionedMeterIds = meterPositions.map((pos: any) => pos.meter_id);
                const positionedMeters = meters.filter((m: any) => positionedMeterIds.includes(m.id));
                if (!(positionedMeters.length > 0 && positionedMeters.every((m: any) => m.confirmation_status === 'confirmed'))) {
                  setShowConfirmed(!showConfirmed);
                }
              }}
              onDoubleClick={() => {
                const positionedMeterIds = meterPositions.map((pos: any) => pos.meter_id);
                const positionedMeters = meters.filter((m: any) => positionedMeterIds.includes(m.id));
                if (!(positionedMeters.length > 0 && positionedMeters.every((m: any) => m.confirmation_status === 'confirmed'))) {
                  if (showConfirmed && !showUnconfirmed) {
                    setShowUnconfirmed(true);
                    setShowConfirmed(true);
                  } else {
                    setShowUnconfirmed(false);
                    setShowConfirmed(true);
                  }
                }
              }}
            >
              <div className="w-3 h-3 rounded-full bg-[#16a34a] border-2 border-[#16a34a] mr-2" />
              Confirmed
            </Badge>
            
            <Separator orientation="vertical" className="h-6 mx-1" />
            
            {/* Meter Cards Visibility Toggle */}
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 select-none ${!showMeterCards ? 'opacity-40' : 'hover:bg-muted'}`}
              onClick={() => setShowMeterCards(!showMeterCards)}
            >
              <ImageIcon className="w-3 h-3 mr-2" />
              Meter Cards
            </Badge>
            
            {/* Connections Visibility Toggle */}
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 select-none ${!showConnections ? 'opacity-40' : 'hover:bg-muted'}`}
              onClick={() => setShowConnections(!showConnections)}
            >
              <Link2 className="w-3 h-3 mr-2" />
              Connections
            </Badge>
            
            {/* Background Visibility Toggle */}
            <Badge 
              variant="outline" 
              className={`cursor-pointer transition-all hover:scale-105 select-none ${!showBackground ? 'opacity-40' : 'hover:bg-muted'}`}
              onClick={() => setShowBackground(!showBackground)}
            >
              <ImageIcon className="w-3 h-3 mr-2" />
              Background
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

      <div ref={containerRef} className="w-full border border-border rounded-lg overflow-hidden shadow-lg relative">
        <canvas ref={canvasRef} className="block w-full" />
        {!isCanvasReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Loading schematic...</p>
            </div>
          </div>
        )}
      </div>


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
                    <SelectItem value="council_meter">Council Meter</SelectItem>
                    <SelectItem value="bulk_meter">Bulk Meter</SelectItem>
                    <SelectItem value="check_meter">Check Meter</SelectItem>
                    <SelectItem value="tenant_meter">Tenant Meter</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
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
                    <Select name="meter_type" required defaultValue={extractedMeters[selectedMeterIndex].meter_type || 'council_meter'}>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select meter type" />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        <SelectItem value="council_meter">Council Meter</SelectItem>
                        <SelectItem value="bulk_meter">Bulk Meter (Main Incoming)</SelectItem>
                        <SelectItem value="check_meter">Check Meter (Verification)</SelectItem>
                        <SelectItem value="tenant_meter">Tenant Meter</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
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
      <Dialog open={isEditMeterDialogOpen} onOpenChange={(open) => {
        setIsEditMeterDialogOpen(open);
        if (!open) {
          setEditingMeter(null);
          setBulkEditMeterIds([]);
          setCurrentBulkEditIndex(0);
        }
      }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="sr-only">
            <DialogTitle>Edit Meter Details</DialogTitle>
          </DialogHeader>
          {editingMeter && (
            <form onSubmit={handleUpdateMeter} className="flex-1 flex flex-col min-h-0">
              <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
                {/* Left Pane - Scanned Area */}
                {editingMeter.scannedImageSnippet && (
                  <div className="w-1/2 flex flex-col p-4 min-h-0">
                    <Label className="text-sm font-semibold mb-2">Scanned Area from PDF</Label>
                    <div className="border rounded overflow-auto bg-white flex-1 min-h-0">
                      <img 
                        src={editingMeter.scannedImageSnippet} 
                        alt="Scanned meter region" 
                        className="w-full h-auto"
                      />
                    </div>
                  </div>
                )}
                
                {/* Right Pane - Form Fields with Header */}
                <div className={`${editingMeter.scannedImageSnippet ? 'w-1/2' : 'w-full'} flex flex-col min-h-0`}>
                  <div className="flex items-center justify-between mb-4 px-4 pt-2">
                    <h2 className="text-lg font-semibold">Edit Meter Details</h2>
                    {bulkEditMeterIds.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={navigateToPreviousMeter}
                          disabled={currentBulkEditIndex === 0}
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          {currentBulkEditIndex + 1} / {bulkEditMeterIds.length}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={navigateToNextMeter}
                          disabled={currentBulkEditIndex >= bulkEditMeterIds.length - 1}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto px-4">
                    <MeterFormFields
                      key={editingMeter.id + '-' + (editingMeter.updated_at || Date.now())}
                      idPrefix="edit"
                      defaultValues={editingMeter}
                      showLocationAndTariff={true}
                      siteId={siteId}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    if (!editingMeter.scannedImageSnippet) {
                      toast.error('No scanned image available for re-extraction');
                      return;
                    }
                    
                    try {
                      toast.info('Re-extracting meter data from image...');
                      
                      const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
                        body: { 
                          imageUrl: editingMeter.scannedImageSnippet,
                          mode: 'extract-region',
                          region: {
                            x: 0,
                            y: 0,
                            width: 100,
                            height: 100,
                            imageWidth: 100,
                            imageHeight: 100
                          }
                        }
                      });
                      
                      if (error) throw error;
                      
                      if (data?.meter) {
                        // Update the editing meter with newly extracted data, including timestamp for key
                        setEditingMeter({
                          ...editingMeter,
                          meter_number: data.meter.meter_number || editingMeter.meter_number,
                          name: data.meter.name || editingMeter.name,
                          area: data.meter.area || editingMeter.area,
                          rating: data.meter.rating || editingMeter.rating,
                          cable_specification: data.meter.cable_specification || editingMeter.cable_specification,
                          serial_number: data.meter.serial_number || editingMeter.serial_number,
                          ct_type: data.meter.ct_type || editingMeter.ct_type,
                          meter_type: data.meter.meter_type || editingMeter.meter_type,
                          zone: data.meter.zone || editingMeter.zone,
                          updated_at: Date.now(), // Force form re-render
                        });
                        toast.success('Meter data re-extracted successfully!');
                      } else {
                        toast.error('No meter data found in image');
                      }
                    } catch (error: any) {
                      console.error('Re-extraction error:', error);
                      toast.error(error.message || 'Failed to re-extract meter data');
                    }
                  }}
                  className="flex-1"
                  disabled={!editingMeter.scannedImageSnippet}
                >
                  Re-extract Data
                </Button>
                <Button type="submit" className="flex-1">
                  Save
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setIsEditMeterDialogOpen(false);
                    setEditingMeter(null);
                    setBulkEditMeterIds([]);
                    setCurrentBulkEditIndex(0);
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
                    
                    // If in bulk edit mode, handle navigation
                    if (bulkEditMeterIds.length > 0) {
                      // Remove the deleted meter from the list
                      const updatedIds = bulkEditMeterIds.filter(id => id !== editingMeter.id);
                      setBulkEditMeterIds(updatedIds);
                      
                      if (updatedIds.length === 0) {
                        // No more meters to edit
                        setIsEditMeterDialogOpen(false);
                        setEditingMeter(null);
                        setCurrentBulkEditIndex(0);
                        setSelectedMeterIds([]);
                      } else if (currentBulkEditIndex >= updatedIds.length) {
                        // We were on the last meter, go to the new last meter
                        const newIndex = updatedIds.length - 1;
                        setCurrentBulkEditIndex(newIndex);
                        const { data: nextMeterData } = await supabase
                          .from('meters')
                          .select('*')
                          .eq('id', updatedIds[newIndex])
                          .single();
                        if (nextMeterData) setEditingMeter(nextMeterData);
                      } else {
                        // Load the next meter at the same index
                        const { data: nextMeterData } = await supabase
                          .from('meters')
                          .select('*')
                          .eq('id', updatedIds[currentBulkEditIndex])
                          .single();
                        if (nextMeterData) setEditingMeter(nextMeterData);
                      }
                    } else {
                      // Single meter edit
                      setIsEditMeterDialogOpen(false);
                      setEditingMeter(null);
                    }
                    
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

      {/* Bulk Edit Dialog for Multiple Meters */}
      <Dialog open={isBulkEditDialogOpen} onOpenChange={setIsBulkEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Edit {selectedMeterIds.length} Meters</DialogTitle>
            <DialogDescription>
              Update common fields for all selected meters. Leave fields empty to keep existing values.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target as HTMLFormElement);
            
            const updates: any = {};
            const zone = formData.get('zone');
            const location = formData.get('location');
            const tariff = formData.get('tariff');
            const meter_type = formData.get('meter_type');
            
            if (zone) updates.zone = zone as string;
            if (location) updates.location = location as string;
            if (tariff) updates.tariff = tariff as string;
            if (meter_type) updates.meter_type = meter_type as string;
            
            if (Object.keys(updates).length === 0) {
              toast.error('Please fill in at least one field to update');
              return;
            }
            
            // Update all selected meters
            for (const meterId of selectedMeterIds) {
              const { error } = await supabase
                .from('meters')
                .update(updates)
                .eq('id', meterId);
                
              if (error) {
                console.error('Error updating meter:', error);
                toast.error(`Failed to update some meters`);
                return;
              }
            }
            
            toast.success(`Updated ${selectedMeterIds.length} meter(s)`);
            setIsBulkEditDialogOpen(false);
            setSelectedMeterIds([]);
            fetchMeters();
            fetchMeterPositions();
          }} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bulk_meter_type">Meter Type</Label>
                <Select name="meter_type">
                  <SelectTrigger>
                    <SelectValue placeholder="Select type (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep_existing">Keep existing</SelectItem>
                    <SelectItem value="council_meter">Council Meter</SelectItem>
                    <SelectItem value="bulk_meter">Bulk Meter</SelectItem>
                    <SelectItem value="check_meter">Check Meter</SelectItem>
                    <SelectItem value="tenant_meter">Tenant Meter</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bulk_zone">Zone</Label>
                <Select name="zone">
                  <SelectTrigger>
                    <SelectValue placeholder="Select zone (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep_existing">Keep existing</SelectItem>
                    <SelectItem value="council_connection_zone">Council Connection Zone</SelectItem>
                    <SelectItem value="main_board_zone">Main Board Zone</SelectItem>
                    <SelectItem value="mini_sub_zone">Mini Sub Zone</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bulk_location">Location</Label>
                <Input 
                  id="bulk_location"
                  name="location" 
                  placeholder="Leave empty to keep existing"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bulk_tariff">Tariff</Label>
                <Input 
                  id="bulk_tariff"
                  name="tariff" 
                  placeholder="Leave empty to keep existing"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsBulkEditDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                Update {selectedMeterIds.length} Meter(s)
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Meter Details Dialog */}
      <Dialog open={isViewMeterDialogOpen} onOpenChange={setIsViewMeterDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Meter Details</DialogTitle>
          </DialogHeader>
          {viewingMeter && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Meter Number</label>
                  <p className="text-lg font-semibold">{viewingMeter.meter_number}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Name</label>
                  <p className="text-lg font-semibold">{viewingMeter.name || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Meter Type</label>
                  <p className="text-lg capitalize">{viewingMeter.meter_type?.replace('_', ' ')}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Zone</label>
                  <p className="text-lg capitalize">{viewingMeter.zone?.replace('_', ' ') || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Area</label>
                  <p className="text-lg">{viewingMeter.area ? `${viewingMeter.area} m²` : 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Rating</label>
                  <p className="text-lg">{viewingMeter.rating || 'N/A'}</p>
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-muted-foreground">Cable Specification</label>
                  <p className="text-base">{viewingMeter.cable_specification || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Serial Number</label>
                  <p className="text-lg">{viewingMeter.serial_number || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">CT Type</label>
                  <p className="text-lg">{viewingMeter.ct_type || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Location</label>
                  <p className="text-lg">{viewingMeter.location || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Tariff</label>
                  <p className="text-lg">{viewingMeter.tariff || 'N/A'}</p>
                </div>
                {viewingMeter.phase && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Phase</label>
                    <p className="text-lg">{viewingMeter.phase}</p>
                  </div>
                )}
                {viewingMeter.supply_level && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Supply Level</label>
                    <p className="text-lg">{viewingMeter.supply_level}</p>
                  </div>
                )}
              </div>
            </div>
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

      <MeterConnectionsManager
        open={isConnectionsDialogOpen}
        onOpenChange={setIsConnectionsDialogOpen}
        siteId={siteId}
        schematicId={schematicId}
        onConnectionsChanged={fetchSchematicLines}
      />
    </div>
  );
}
