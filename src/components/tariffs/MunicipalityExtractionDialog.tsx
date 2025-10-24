import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Trash2, Eye, Plus, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, RotateCw, GripVertical } from "lucide-react";
import { pdfjs } from 'react-pdf';
import { toast } from "sonner";
import { Canvas as FabricCanvas, Rect as FabricRect, FabricImage, Circle } from "fabric";
import { supabase } from "@/integrations/supabase/client";

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface MunicipalityData {
  name: string;
  nersaIncrease: number;
}

interface AcceptedMunicipality extends MunicipalityData {
  id: string;
  tariffStructures?: any[];
}

interface MunicipalityExtractionDialogProps {
  open: boolean;
  onClose: () => void;
  pdfFile: File;
  onComplete: (municipalities: MunicipalityData[]) => void;
  initialMunicipalities?: AcceptedMunicipality[];
}

export default function MunicipalityExtractionDialog({
  open,
  onClose,
  pdfFile,
  onComplete,
  initialMunicipalities = []
}: MunicipalityExtractionDialogProps) {
  const [pdfPageImages, setPdfPageImages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const selectionModeRef = useRef(false);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<any | null>(null);
  const [acceptedMunicipalities, setAcceptedMunicipalities] = useState<AcceptedMunicipality[]>(initialMunicipalities);
  const [editingMunicipalityId, setEditingMunicipalityId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const selectionRectRef = useRef<FabricRect | null>(null);
  const startMarkerRef = useRef<Circle | null>(null);
  const [zoom, setZoom] = useState(1);
  const currentImageRef = useRef<FabricImage | null>(null);
  const [isAcceptedPanelCollapsed, setIsAcceptedPanelCollapsed] = useState(false);
  const [appendSelectionDrawn, setAppendSelectionDrawn] = useState(false);
  const [draggedTariffIndex, setDraggedTariffIndex] = useState<number | null>(null);
  const [isAppendMode, setIsAppendMode] = useState(false);

  // Convert PDF to individual page images
  const convertPdfToImages = async (pdfFile: File): Promise<string[]> => {
    setIsConvertingPdf(true);
    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const loadingTask = pdfjs.getDocument(arrayBuffer);
      const pdf = await loadingTask.promise;
      
      const scale = 2.0;
      const pageImages: string[] = [];
      
      // Render each page as a separate image
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        if (!context) throw new Error('Could not get canvas context');
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({
          canvasContext: context,
          viewport: viewport,
          canvas: canvas
        }).promise;
        
        pageImages.push(canvas.toDataURL('image/png', 1.0));
      }
      
      setTotalPages(pdf.numPages);
      return pageImages;
    } catch (error) {
      console.error('Error converting PDF to images:', error);
      toast.error('Failed to convert PDF to images');
      throw error;
    } finally {
      setIsConvertingPdf(false);
    }
  };

  // Convert PDF when dialog opens
  useEffect(() => {
    if (open && pdfFile) {
      convertPdfToImages(pdfFile).then(images => {
        setPdfPageImages(images);
        setCurrentPage(0);
      }).catch(error => {
        console.error('Failed to convert PDF:', error);
      });
    }
  }, [open, pdfFile]);

  // Initialize Fabric canvas
  useEffect(() => {
    if (!canvasRef.current || pdfPageImages.length === 0) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 1200,
      height: 700,
      backgroundColor: "#f8f9fa",
    });

    // Load the current page image
    const loadCurrentPage = () => {
      // Remove existing image
      if (currentImageRef.current) {
        canvas.remove(currentImageRef.current);
      }
      
      // Clear any selection state
      drawStartPointRef.current = null;
      if (selectionRectRef.current) {
        canvas.remove(selectionRectRef.current);
        selectionRectRef.current = null;
      }
      if (startMarkerRef.current) {
        canvas.remove(startMarkerRef.current);
        startMarkerRef.current = null;
      }

      FabricImage.fromURL(pdfPageImages[currentPage]).then((img) => {
        // Scale image to fit canvas
        const scale = Math.min(
          canvas.width! / img.width!,
          canvas.height! / img.height!
        );
        
        img.scale(scale * 0.9);
        img.set({
          left: (canvas.width! - img.width! * img.scaleX!) / 2,
          top: (canvas.height! - img.height! * img.scaleY!) / 2,
          selectable: false,
          evented: false,
        });
        
        currentImageRef.current = img;
        canvas.add(img);
        canvas.sendObjectToBack(img);
        canvas.renderAll();
      });
    };

    loadCurrentPage();

    // Mouse wheel zoom
    canvas.on('mouse:wheel', (opt) => {
      let newZoom = canvas.getZoom();
      newZoom *= 0.999 ** opt.e.deltaY;
      if (newZoom > 30) newZoom = 30;
      if (newZoom < 0.3) newZoom = 0.3;
      
      const pointer = canvas.getPointer(opt.e);
      canvas.zoomToPoint(pointer, newZoom);
      setZoom(newZoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Panning variables
    let isPanningLocal = false;
    let lastX = 0;
    let lastY = 0;

    // Mouse down - handle selection drawing (two-click approach) and panning
    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent;
      const target = opt.target;
      
      // Use ref to get current selection mode value
      const isInSelectionMode = selectionModeRef.current;
      console.log('Mouse down - selectionModeRef.current:', isInSelectionMode, 'button:', evt.button, 'target type:', target?.type);
      
      // SELECTION MODE: Handle two-click region drawing
      if (isInSelectionMode && evt.button === 0) {
        console.log('Inside selection mode handler');
        // Only process clicks on empty canvas or the image
        const isInteractiveObject = target && target.type !== 'image';
        if (isInteractiveObject) {
          console.log('Clicked on interactive object, ignoring');
          return;
        }
        
        const pointer = canvas.getPointer(opt.e);
        
        console.log('Selection click at:', pointer, 'drawStartPointRef:', drawStartPointRef.current);
        
        // First click - set start point
        if (!drawStartPointRef.current) {
          console.log('Setting start point');
          drawStartPointRef.current = { x: pointer.x, y: pointer.y };
          
          // Show a marker at start point
          const marker = new Circle({
            left: pointer.x,
            top: pointer.y,
            radius: 5,
            fill: '#3b82f6',
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
        
        // Second click - create rectangle and extract
        console.log('Second click - creating rectangle');
        const startPoint = drawStartPointRef.current;
        
        const left = Math.min(startPoint.x, pointer.x);
        const top = Math.min(startPoint.y, pointer.y);
        const width = Math.abs(pointer.x - startPoint.x);
        const height = Math.abs(pointer.y - startPoint.y);
        
        if (width < 10 || height < 10) {
          toast.error('Selection too small');
          // Clean up
          if (startMarkerRef.current) {
            canvas.remove(startMarkerRef.current);
            startMarkerRef.current = null;
          }
          drawStartPointRef.current = null;
          return;
        }
        
        const rect = new FabricRect({
          left,
          top,
          width,
          height,
          fill: 'rgba(59, 130, 246, 0.2)',
          stroke: '#3b82f6',
          strokeWidth: 2,
          selectable: true,
          evented: true,
        });
        
        canvas.add(rect);
        selectionRectRef.current = rect;
        canvas.renderAll();
        
        // Clean up marker
        if (startMarkerRef.current) {
          canvas.remove(startMarkerRef.current);
          startMarkerRef.current = null;
        }
        
        // Exit selection mode
        setSelectionMode(false);
        selectionModeRef.current = false;
        drawStartPointRef.current = null;
        
        // In append mode, set flag to show Extract button
        if (isAppendMode) {
          setAppendSelectionDrawn(true);
          toast.success('Region selected! Click "Extract" to append data.');
        } else {
          // Don't automatically extract - wait for user to click Extract button
          toast.success('Region selected! Click "Extract Data" to process.');
        }
        
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }
      
      // PANNING: Only allow when NOT in selection mode
      if (!selectionModeRef.current && !target) {
        if (evt.button === 0 || evt.button === 1 || evt.button === 2) {
          isPanningLocal = true;
          lastX = evt.clientX;
          lastY = evt.clientY;
          canvas.selection = false;
        }
      }
    });

    // Mouse move - show preview rectangle and handle panning
    canvas.on('mouse:move', (opt) => {
      // SELECTION MODE: Show preview rectangle
      if (selectionModeRef.current && drawStartPointRef.current && !selectionRectRef.current) {
        const pointer = canvas.getPointer(opt.e);
        const startPoint = drawStartPointRef.current;
        
        // Remove old preview
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
        
        const preview = new FabricRect({
          left,
          top,
          width,
          height,
          fill: 'rgba(59, 130, 246, 0.1)',
          stroke: '#3b82f6',
          strokeWidth: 1,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
        });
        
        (preview as any).isPreview = true;
        canvas.add(preview);
        canvas.renderAll();
        return;
      }
      
      // PANNING: Only when not in selection mode
      if (isPanningLocal && !selectionModeRef.current) {
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

    // Mouse up - clean up panning state
    canvas.on('mouse:up', () => {
      if (isPanningLocal) {
        isPanningLocal = false;
        canvas.selection = true;
      }
    });

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [pdfPageImages, currentPage]);

  // When page changes, reload the current page on canvas
  useEffect(() => {
    if (!fabricCanvas || pdfPageImages.length === 0) return;

    // Remove existing image
    if (currentImageRef.current) {
      fabricCanvas.remove(currentImageRef.current);
    }
    
    // Clear any selection state
    drawStartPointRef.current = null;
    if (selectionRectRef.current) {
      fabricCanvas.remove(selectionRectRef.current);
      selectionRectRef.current = null;
    }
    if (startMarkerRef.current) {
      fabricCanvas.remove(startMarkerRef.current);
      startMarkerRef.current = null;
    }
    setSelectionMode(false);
    selectionModeRef.current = false;

    // Reset zoom and pan
    fabricCanvas.setZoom(1);
    fabricCanvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    setZoom(1);

    FabricImage.fromURL(pdfPageImages[currentPage]).then((img) => {
      if (!fabricCanvas) return;
      
      const scale = Math.min(
        fabricCanvas.width! / img.width!,
        fabricCanvas.height! / img.height!
      );
      
      img.scale(scale * 0.9);
      img.set({
        left: (fabricCanvas.width! - img.width! * img.scaleX!) / 2,
        top: (fabricCanvas.height! - img.height! * img.scaleY!) / 2,
        selectable: false,
        evented: false,
      });
      
      currentImageRef.current = img;
      fabricCanvas.add(img);
      fabricCanvas.sendObjectToBack(img);
      fabricCanvas.renderAll();
    });
  }, [currentPage, fabricCanvas]);

  const handleExtractFromRegion = async (canvas: FabricCanvas, rect: FabricRect, appendMode = false) => {
    if (pdfPageImages.length === 0) return;

    setIsExtracting(true);
    
    // Store existing data if in append mode
    const existingData = appendMode ? extractedData : null;
    
    try {
      // Get the image object from canvas
      const objects = canvas.getObjects();
      const imageObj = objects.find(obj => obj.type === 'image') as FabricImage;
      
      if (!imageObj) throw new Error('Image not found on canvas');
      
      // Get the current bounding rect to capture any transformations (move/resize)
      const boundingRect = rect.getBoundingRect();
      
      // Calculate coordinates in original image space
      const zoom = canvas.getZoom();
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      
      const imgScaleX = imageObj.scaleX || 1;
      const imgScaleY = imageObj.scaleY || 1;
      const imgLeft = imageObj.left || 0;
      const imgTop = imageObj.top || 0;
      
      // Convert rect coordinates to image coordinates using the bounding rect
      const rectLeft = (boundingRect.left - imgLeft) / (imgScaleX * zoom);
      const rectTop = (boundingRect.top - imgTop) / (imgScaleY * zoom);
      const rectWidth = boundingRect.width / (imgScaleX * zoom);
      const rectHeight = boundingRect.height / (imgScaleY * zoom);
      
      // Crop the current page image
      const img = new Image();
      img.src = pdfPageImages[currentPage];
      await new Promise((resolve) => { img.onload = resolve; });
      
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = rectWidth;
      croppedCanvas.height = rectHeight;
      const ctx = croppedCanvas.getContext('2d');
      
      if (!ctx) throw new Error('Could not get canvas context');
      
      ctx.drawImage(
        img,
        rectLeft, rectTop, rectWidth, rectHeight,
        0, 0, rectWidth, rectHeight
      );
      
      const croppedImageUrl = croppedCanvas.toDataURL('image/png');
      
      // Upload to storage
      const response = await fetch(croppedImageUrl);
      const blob = await response.blob();
      const timestamp = Date.now();
      const fileName = `municipality-extract-${timestamp}.png`;
      
      const { error: uploadError } = await supabase.storage
        .from('tariff-extractions')
        .upload(fileName, blob, {
          contentType: 'image/png',
          upsert: false
        });
      
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage
        .from('tariff-extractions')
        .getPublicUrl(fileName);
      
      // Call AI to extract municipality data
      toast.info("Analyzing selected region with AI...");
      const { data, error } = await supabase.functions.invoke("extract-tariff-data", {
        body: { 
          imageUrl: publicUrl,
          phase: "extractMunicipality"
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Extraction failed");
      
      console.log("Raw AI response:", JSON.stringify(data, null, 2));
      
      // Transform the AI response to match UI expectations
      const rawData = data.tariffData || {
        municipalityName: data.municipality?.name || "",
        nersaIncrease: data.municipality?.nersaIncrease || 0,
        tariffStructures: []
      };
      
      console.log("Raw tariff structures count:", rawData.tariffStructures?.length);
      
      // Map the tariff structures to the format expected by the UI
      const transformedTariffStructures = (rawData.tariffStructures || []).map((tariff: any, index: number) => {
        console.log(`Processing tariff ${index}:`, {
          name: tariff.tariffName || tariff.name,
          blocksCount: tariff.blocks?.length,
          chargesCount: tariff.charges?.length
        });
        
        const transformed: any = {
          tariffName: tariff.tariffName || tariff.name || "",
          blocks: tariff.blocks || []
        };
        
        // Process charges array and categorize them
        const charges = tariff.charges || [];
        transformed.fixedEnergy = [];
        transformed.seasonalEnergy = [];
        transformed.touPeriods = tariff.touPeriods || [];
        transformed.demandCharges = [];
        
        charges.forEach((charge: any) => {
          const chargeType = charge.chargeType?.toLowerCase() || '';
          
          if (chargeType.includes('basic') || chargeType.includes('monthly')) {
            // Basic charge (only one)
            transformed.basicCharge = {
              amount: charge.chargeAmount || 0,
              unit: charge.unit || 'R/month'
            };
          } else if (chargeType.includes('demand')) {
            // Demand charges (seasonal)
            transformed.demandCharges.push({
              season: charge.season || 'All Year',
              rate: charge.chargeAmount || 0,
              unit: charge.unit || 'R/kVA'
            });
          } else if (chargeType.includes('energy') || chargeType.includes('fixed')) {
            // Fixed energy charges
            transformed.fixedEnergy.push({
              description: charge.description || 'Energy Charge',
              rate: charge.chargeAmount || 0,
              unit: charge.unit || 'c/kWh'
            });
          }
        });
        
        console.log(`Transformed tariff ${index}:`, transformed);
        return transformed;
      });
      
      const newData = {
        municipalityName: rawData.municipalityName || "",
        nersaIncrease: rawData.nersaIncrease || 0,
        tariffStructures: transformedTariffStructures
      };
      
      console.log("Final transformed data:", JSON.stringify(newData, null, 2));
      
      // If in append mode, merge the tariff structures
      if (appendMode && existingData) {
        const mergedData = {
          ...existingData,
          // Keep existing municipality name and NERSA increase if they exist
          municipalityName: existingData.municipalityName || newData.municipalityName,
          nersaIncrease: existingData.nersaIncrease || newData.nersaIncrease,
          // Append new tariff structures to existing ones
          tariffStructures: [
            ...(existingData.tariffStructures || []),
            ...(newData.tariffStructures || [])
          ],
          // Keep custom fields if they exist
          customFields: existingData.customFields || []
        };
        setExtractedData(mergedData);
        toast.success(`Added ${newData.tariffStructures?.length || 0} new tariff structure(s)!`);
      } else {
        setExtractedData(newData);
        toast.success("Municipality data extracted!");
      }
    } catch (error: any) {
      console.error("Extraction failed:", error);
      toast.error(error.message || "Failed to extract municipality data");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleStartSelection = (appendMode: boolean = false) => {
    if (fabricCanvas) {
      // Remove any existing selection rectangle
      if (selectionRectRef.current) {
        fabricCanvas.remove(selectionRectRef.current);
        selectionRectRef.current = null;
      }
      // Remove any start marker
      if (startMarkerRef.current) {
        fabricCanvas.remove(startMarkerRef.current);
        startMarkerRef.current = null;
      }
      // Remove preview rectangles
      const objects = fabricCanvas.getObjects();
      objects.forEach(obj => {
        if ((obj as any).isPreview) {
          fabricCanvas.remove(obj);
        }
      });
      fabricCanvas.renderAll();
    }
    
    console.log('handleStartSelection called, appendMode:', appendMode);
    drawStartPointRef.current = null;
    if (!appendMode) {
      setExtractedData(null);
    }
    setIsAppendMode(appendMode);
    setAppendSelectionDrawn(false);
    setSelectionMode(true);
    selectionModeRef.current = true;
    console.log('Selection mode activated, ref is now:', selectionModeRef.current);
    toast.info(appendMode ? "Select region to append more data" : "Click once to start, then click again to complete the selection");
  };

  const handleCancelSelection = () => {
    if (fabricCanvas) {
      if (selectionRectRef.current) {
        fabricCanvas.remove(selectionRectRef.current);
        selectionRectRef.current = null;
      }
      if (startMarkerRef.current) {
        fabricCanvas.remove(startMarkerRef.current);
        startMarkerRef.current = null;
      }
      // Remove preview rectangles
      const objects = fabricCanvas.getObjects();
      objects.forEach(obj => {
        if ((obj as any).isPreview) {
          fabricCanvas.remove(obj);
        }
      });
      fabricCanvas.renderAll();
    }
    drawStartPointRef.current = null;
    setSelectionMode(false);
    selectionModeRef.current = false;
    setEditingMunicipalityId(null);
  };

  const handleZoomIn = () => {
    if (!fabricCanvas) return;
    let newZoom = fabricCanvas.getZoom() * 1.2;
    if (newZoom > 10) newZoom = 10;
    fabricCanvas.setZoom(newZoom);
    setZoom(newZoom);
    fabricCanvas.renderAll();
  };

  const handleZoomOut = () => {
    if (!fabricCanvas) return;
    let newZoom = fabricCanvas.getZoom() / 1.2;
    if (newZoom < 0.5) newZoom = 0.5;
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

  const handleAcceptExtraction = () => {
    if (!extractedData) return;
    
    const municipalityData: AcceptedMunicipality = {
      name: extractedData.municipalityName || extractedData.name || "",
      nersaIncrease: extractedData.nersaIncrease || 0,
      tariffStructures: extractedData.tariffStructures || [],
      id: editingMunicipalityId || `${Date.now()}-${Math.random()}`
    };
    
    if (editingMunicipalityId) {
      // Update existing municipality
      setAcceptedMunicipalities(prev => 
        prev.map(m => m.id === editingMunicipalityId ? municipalityData : m)
      );
      setEditingMunicipalityId(null);
      toast.success(`${municipalityData.name} updated!`);
    } else {
      // Add new municipality
      setAcceptedMunicipalities(prev => [...prev, municipalityData]);
      const tariffCount = (extractedData.tariffStructures || []).length;
      toast.success(`${municipalityData.name} added with ${tariffCount} tariff${tariffCount !== 1 ? 's' : ''}!`);
    }
    
    setExtractedData(null);
    
    if (fabricCanvas && selectionRectRef.current) {
      fabricCanvas.remove(selectionRectRef.current);
      selectionRectRef.current = null;
      fabricCanvas.renderAll();
    }
  };

  const handleViewMunicipality = (municipality: AcceptedMunicipality) => {
    setEditingMunicipalityId(municipality.id);
    setExtractedData({
      name: municipality.name,
      municipalityName: municipality.name,
      nersaIncrease: municipality.nersaIncrease,
      tariffStructures: municipality.tariffStructures || []
    });
    toast.info(`Editing ${municipality.name} - click "Update Municipality" to save changes`);
  };

  const handleDeleteMunicipality = (id: string) => {
    setAcceptedMunicipalities(prev => prev.filter(m => m.id !== id));
    toast.success("Municipality removed");
  };

  const handleComplete = () => {
    if (acceptedMunicipalities.length === 0) {
      toast.error("Please add at least one municipality");
      return;
    }
    
    onComplete(acceptedMunicipalities);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] h-[90vh] p-0 flex flex-col">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>Extract Municipality Data from PDF</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex px-6 gap-4">
          {/* Left: Source Document - Half Width */}
          <Card className="overflow-hidden flex flex-col w-1/2 flex-shrink-0">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  Source Document {totalPages > 0 && `(Page ${currentPage + 1} of ${totalPages})`}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleZoomIn}
                    disabled={pdfPageImages.length === 0}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleZoomOut}
                    disabled={pdfPageImages.length === 0}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleResetZoom}
                    disabled={pdfPageImages.length === 0}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-4 bg-muted/20">
              {isConvertingPdf ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                  <p className="text-sm text-muted-foreground">Converting PDF...</p>
                </div>
              ) : (
                <canvas
                  ref={canvasRef}
                  style={{ cursor: selectionMode ? 'crosshair' : 'default' }}
                />
              )}
            </CardContent>
            <div className="border-t p-3 space-y-2">
              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-2 pb-2 border-b">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                    disabled={currentPage === 0 || selectionMode}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {currentPage + 1} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                    disabled={currentPage === totalPages - 1 || selectionMode}
                  >
                    Next
                  </Button>
                </div>
              )}
              
              {selectionMode ? (
                <>
                  <p className="text-xs text-muted-foreground text-center mb-2">
                    Click once to start, then click again to complete the selection
                  </p>
                  <Button
                    size="sm"
                    onClick={handleCancelSelection}
                    variant="outline"
                    className="w-full"
                  >
                    Cancel Selection
                  </Button>
                </>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleStartSelection(false)}
                    disabled={pdfPageImages.length === 0 || isExtracting}
                    className="flex-1"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Select Region
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (fabricCanvas && selectionRectRef.current) {
                        setExtractedData(null);
                        handleExtractFromRegion(fabricCanvas, selectionRectRef.current);
                      }
                    }}
                    disabled={!fabricCanvas || !selectionRectRef.current || isExtracting}
                    variant="outline"
                    className="flex-1"
                  >
                    <RotateCw className="h-4 w-4 mr-2" />
                    Rescan
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Right Column: Stacked Extracted Data (top) and Accepted Municipalities (bottom) */}
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            {/* Top: Extracted Data */}
            <Card className="overflow-hidden flex flex-col flex-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Extracted Data</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto flex flex-col">
              {isExtracting ? (
                <div className="flex flex-col items-center justify-center h-full p-6">
                  <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                  <h3 className="font-semibold mb-2">Extracting Municipality Data</h3>
                  <p className="text-sm text-muted-foreground text-center">
                    Analyzing selected region with AI...
                  </p>
                </div>
              ) : extractedData ? (
                <>
                  <ScrollArea className="flex-1">
                    <div className="space-y-4 p-1">
                      <div>
                        <Label className="text-xs">Municipality Name</Label>
                        <Input
                          value={extractedData.municipalityName || ""}
                          onChange={(e) => setExtractedData({ ...extractedData, municipalityName: e.target.value })}
                          className="h-9 mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">NERSA Increase (%)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={extractedData.nersaIncrease || 0}
                          onChange={(e) => setExtractedData({ ...extractedData, nersaIncrease: parseFloat(e.target.value) || 0 })}
                          className="h-9 mt-1"
                        />
                      </div>
                      
                      {extractedData.tariffStructures && extractedData.tariffStructures.length > 0 && (
                        <div className="space-y-4 mt-4">
                         <Label className="text-xs font-semibold">Extracted Tariff Structures ({extractedData.tariffStructures.length})</Label>
                        {extractedData.tariffStructures.map((tariff: any, tariffIdx: number) => (
                          <Card 
                            key={tariffIdx} 
                            className="p-4 bg-muted/20 border-2 cursor-move"
                            draggable
                            onDragStart={() => setDraggedTariffIndex(tariffIdx)}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (draggedTariffIndex === null || draggedTariffIndex === tariffIdx) return;
                              
                              const updated = [...extractedData.tariffStructures];
                              const draggedItem = updated[draggedTariffIndex];
                              updated.splice(draggedTariffIndex, 1);
                              updated.splice(tariffIdx, 0, draggedItem);
                              
                              setExtractedData({ ...extractedData, tariffStructures: updated });
                              setDraggedTariffIndex(tariffIdx);
                            }}
                            onDragEnd={() => setDraggedTariffIndex(null)}
                            style={{
                              opacity: draggedTariffIndex === tariffIdx ? 0.5 : 1,
                            }}
                          >
                            <div className="space-y-3">
                              <div className="flex items-start gap-2">
                                <GripVertical className="h-5 w-5 text-muted-foreground mt-6 flex-shrink-0" />
                                <div className="flex-1">
                                  <Label className="text-xs">Tariff Name</Label>
                                  <Input
                                    value={tariff.tariffName || ""}
                                    onChange={(e) => {
                                      const updated = [...extractedData.tariffStructures];
                                      updated[tariffIdx].tariffName = e.target.value;
                                      setExtractedData({ ...extractedData, tariffStructures: updated });
                                    }}
                                    className="h-9 mt-1"
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    const updated = [...extractedData.tariffStructures];
                                    updated.splice(tariffIdx, 1);
                                    setExtractedData({ ...extractedData, tariffStructures: updated });
                                    toast.success("Tariff removed");
                                  }}
                                  className="mt-5 text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              
                              {/* Energy Blocks Section */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-medium">Energy Blocks</Label>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const updated = [...extractedData.tariffStructures];
                                      if (!updated[tariffIdx].blocks) {
                                        updated[tariffIdx].blocks = [];
                                      }
                                      updated[tariffIdx].blocks.push({
                                        blockNumber: (updated[tariffIdx].blocks?.length || 0) + 1,
                                        kwhFrom: 0,
                                        kwhTo: 0,
                                        energyChargeCents: 0,
                                        description: `Block ${(updated[tariffIdx].blocks?.length || 0) + 1}`
                                      });
                                      setExtractedData({ ...extractedData, tariffStructures: updated });
                                    }}
                                    className="h-7 text-xs"
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add Block
                                  </Button>
                                </div>
                                {tariff.blocks && tariff.blocks.length > 0 ? (
                                  tariff.blocks.map((block: any, blockIdx: number) => (
                                    <div key={blockIdx} className="p-2 bg-background rounded border space-y-2">
                                      <div className="grid grid-cols-3 gap-2">
                                        <div>
                                          <Label className="text-xs">From (kWh)</Label>
                                          <Input
                                            type="number"
                                            value={block.kwhFrom || 0}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].blocks[blockIdx].kwhFrom = parseInt(e.target.value) || 0;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">To (kWh)</Label>
                                          <Input
                                            type="number"
                                            value={block.kwhTo || 0}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].blocks[blockIdx].kwhTo = parseInt(e.target.value) || 0;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">c/kWh</Label>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            value={block.energyChargeCents || 0}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].blocks[blockIdx].energyChargeCents = parseFloat(e.target.value) || 0;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          const updated = [...extractedData.tariffStructures];
                                          updated[tariffIdx].blocks.splice(blockIdx, 1);
                                          setExtractedData({ ...extractedData, tariffStructures: updated });
                                        }}
                                        className="h-6 text-xs text-destructive hover:text-destructive w-full"
                                      >
                                        <Trash2 className="h-3 w-3 mr-1" />
                                        Remove Block
                                      </Button>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
                                    No energy blocks. Click "Add Block" to create one.
                                  </p>
                                )}
                              </div>

                              {/* Fixed Energy Charges Section */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-medium">Fixed Energy</Label>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const updated = [...extractedData.tariffStructures];
                                      if (!updated[tariffIdx].fixedEnergy) {
                                        updated[tariffIdx].fixedEnergy = [];
                                      }
                                      updated[tariffIdx].fixedEnergy.push({
                                        chargeType: "Energy Charge",
                                        amount: 0,
                                        unit: "c/kWh"
                                      });
                                      setExtractedData({ ...extractedData, tariffStructures: updated });
                                    }}
                                    className="h-7 text-xs"
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add Charge
                                  </Button>
                                </div>
                                {tariff.fixedEnergy && tariff.fixedEnergy.length > 0 ? (
                                  tariff.fixedEnergy.map((charge: any, chargeIdx: number) => (
                                    <div key={chargeIdx} className="p-2 bg-background rounded border space-y-2">
                                      <div>
                                        <Label className="text-xs">Charge Type</Label>
                                        <Input
                                          value={charge.chargeType || ""}
                                          onChange={(e) => {
                                            const updated = [...extractedData.tariffStructures];
                                            updated[tariffIdx].fixedEnergy[chargeIdx].chargeType = e.target.value;
                                            setExtractedData({ ...extractedData, tariffStructures: updated });
                                          }}
                                          className="h-8 mt-1"
                                        />
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <Label className="text-xs">Amount</Label>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            value={charge.amount || 0}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].fixedEnergy[chargeIdx].amount = parseFloat(e.target.value) || 0;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">Unit</Label>
                                          <Input
                                            value={charge.unit || ""}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].fixedEnergy[chargeIdx].unit = e.target.value;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          const updated = [...extractedData.tariffStructures];
                                          updated[tariffIdx].fixedEnergy.splice(chargeIdx, 1);
                                          setExtractedData({ ...extractedData, tariffStructures: updated });
                                        }}
                                        className="h-6 text-xs text-destructive hover:text-destructive w-full"
                                      >
                                        <Trash2 className="h-3 w-3 mr-1" />
                                        Remove Charge
                                      </Button>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
                                    No fixed energy charges.
                                  </p>
                                )}
                              </div>

                              {/* Seasonal Energy Charges Section */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-medium">Seasonal Energy</Label>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const updated = [...extractedData.tariffStructures];
                                      if (!updated[tariffIdx].seasonalEnergy) {
                                        updated[tariffIdx].seasonalEnergy = [];
                                      }
                                      updated[tariffIdx].seasonalEnergy.push({
                                        season: "",
                                        rate: 0,
                                        unit: "c/kWh"
                                      });
                                      setExtractedData({ ...extractedData, tariffStructures: updated });
                                    }}
                                    className="h-7 text-xs"
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add Seasonal Charge
                                  </Button>
                                </div>
                                {tariff.seasonalEnergy && tariff.seasonalEnergy.length > 0 ? (
                                  tariff.seasonalEnergy.map((charge: any, chargeIdx: number) => (
                                    <div key={chargeIdx} className="p-2 bg-background rounded border space-y-2">
                                      <div>
                                        <Label className="text-xs">Season</Label>
                                        <Input
                                          value={charge.season || ""}
                                          onChange={(e) => {
                                            const updated = [...extractedData.tariffStructures];
                                            updated[tariffIdx].seasonalEnergy[chargeIdx].season = e.target.value;
                                            setExtractedData({ ...extractedData, tariffStructures: updated });
                                          }}
                                          className="h-8 mt-1"
                                          placeholder="e.g., Summer, Winter"
                                        />
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <Label className="text-xs">Rate</Label>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            value={charge.rate || 0}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].seasonalEnergy[chargeIdx].rate = parseFloat(e.target.value) || 0;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">Unit</Label>
                                          <Input
                                            value={charge.unit || ""}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].seasonalEnergy[chargeIdx].unit = e.target.value;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          const updated = [...extractedData.tariffStructures];
                                          updated[tariffIdx].seasonalEnergy.splice(chargeIdx, 1);
                                          setExtractedData({ ...extractedData, tariffStructures: updated });
                                        }}
                                        className="h-6 text-xs text-destructive hover:text-destructive w-full"
                                      >
                                        <Trash2 className="h-3 w-3 mr-1" />
                                        Remove Charge
                                      </Button>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
                                    No seasonal energy charges.
                                  </p>
                                )}
                              </div>

                              {/* Time-of-Use Energy Section */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-medium">Time-of-Use Energy</Label>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const updated = [...extractedData.tariffStructures];
                                      if (!updated[tariffIdx].touPeriods) {
                                        updated[tariffIdx].touPeriods = [];
                                      }
                                      updated[tariffIdx].touPeriods.push({
                                        periodName: "",
                                        rate: 0,
                                        timeStart: "",
                                        timeEnd: ""
                                      });
                                      setExtractedData({ ...extractedData, tariffStructures: updated });
                                    }}
                                    className="h-7 text-xs"
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add TOU Period
                                  </Button>
                                </div>
                                {tariff.touPeriods && tariff.touPeriods.length > 0 ? (
                                  tariff.touPeriods.map((period: any, periodIdx: number) => (
                                    <div key={periodIdx} className="p-2 bg-background rounded border space-y-2">
                                      <div>
                                        <Label className="text-xs">Period Name</Label>
                                        <Input
                                          value={period.periodName || ""}
                                          onChange={(e) => {
                                            const updated = [...extractedData.tariffStructures];
                                            updated[tariffIdx].touPeriods[periodIdx].periodName = e.target.value;
                                            setExtractedData({ ...extractedData, tariffStructures: updated });
                                          }}
                                          className="h-8 mt-1"
                                          placeholder="e.g., Peak, Off-Peak"
                                        />
                                      </div>
                                      <div className="grid grid-cols-3 gap-2">
                                        <div>
                                          <Label className="text-xs">Rate (c/kWh)</Label>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            value={period.rate || 0}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].touPeriods[periodIdx].rate = parseFloat(e.target.value) || 0;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">Start Time</Label>
                                          <Input
                                            type="time"
                                            value={period.timeStart || ""}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].touPeriods[periodIdx].timeStart = e.target.value;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">End Time</Label>
                                          <Input
                                            type="time"
                                            value={period.timeEnd || ""}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].touPeriods[periodIdx].timeEnd = e.target.value;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          const updated = [...extractedData.tariffStructures];
                                          updated[tariffIdx].touPeriods.splice(periodIdx, 1);
                                          setExtractedData({ ...extractedData, tariffStructures: updated });
                                        }}
                                        className="h-6 text-xs text-destructive hover:text-destructive w-full"
                                      >
                                        <Trash2 className="h-3 w-3 mr-1" />
                                        Remove TOU Period
                                      </Button>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
                                    No time-of-use periods.
                                  </p>
                                )}
                              </div>

                              {/* Basic Charge Section */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-medium">Basic Charge (Fixed Monthly)</Label>
                                  {!tariff.basicCharge && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        const updated = [...extractedData.tariffStructures];
                                        updated[tariffIdx].basicCharge = { amount: 0, unit: "R/month" };
                                        setExtractedData({ ...extractedData, tariffStructures: updated });
                                      }}
                                      className="h-7 text-xs"
                                    >
                                      <Plus className="h-3 w-3 mr-1" />
                                      Add Basic Charge
                                    </Button>
                                  )}
                                </div>
                                {tariff.basicCharge ? (
                                  <div className="p-2 bg-background rounded border space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <Label className="text-xs">Amount</Label>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={tariff.basicCharge?.amount || 0}
                                          onChange={(e) => {
                                            const updated = [...extractedData.tariffStructures];
                                            if (!updated[tariffIdx].basicCharge) {
                                              updated[tariffIdx].basicCharge = { amount: 0, unit: "R/month" };
                                            }
                                            updated[tariffIdx].basicCharge.amount = parseFloat(e.target.value) || 0;
                                            setExtractedData({ ...extractedData, tariffStructures: updated });
                                          }}
                                          className="h-8"
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-xs">Unit</Label>
                                        <Input
                                          value={tariff.basicCharge?.unit || "R/month"}
                                          onChange={(e) => {
                                            const updated = [...extractedData.tariffStructures];
                                            if (!updated[tariffIdx].basicCharge) {
                                              updated[tariffIdx].basicCharge = { amount: 0, unit: "R/month" };
                                            }
                                            updated[tariffIdx].basicCharge.unit = e.target.value;
                                            setExtractedData({ ...extractedData, tariffStructures: updated });
                                          }}
                                          className="h-8"
                                        />
                                      </div>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        const updated = [...extractedData.tariffStructures];
                                        updated[tariffIdx].basicCharge = undefined;
                                        setExtractedData({ ...extractedData, tariffStructures: updated });
                                      }}
                                      className="h-6 text-xs text-destructive hover:text-destructive w-full"
                                    >
                                      <Trash2 className="h-3 w-3 mr-1" />
                                      Remove Basic Charge
                                    </Button>
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
                                    No basic charge.
                                  </p>
                                )}
                              </div>

                              {/* Demand Charges Section */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-medium">Demand Charges (Seasonal)</Label>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const updated = [...extractedData.tariffStructures];
                                      if (!updated[tariffIdx].demandCharges) {
                                        updated[tariffIdx].demandCharges = [];
                                      }
                                      updated[tariffIdx].demandCharges.push({
                                        season: "",
                                        rate: 0,
                                        unit: "R/kVA"
                                      });
                                      setExtractedData({ ...extractedData, tariffStructures: updated });
                                    }}
                                    className="h-7 text-xs"
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add Demand Charge
                                  </Button>
                                </div>
                                {tariff.demandCharges && tariff.demandCharges.length > 0 ? (
                                  tariff.demandCharges.map((charge: any, chargeIdx: number) => (
                                    <div key={chargeIdx} className="p-2 bg-background rounded border space-y-2">
                                      <div>
                                        <Label className="text-xs">Season</Label>
                                        <Input
                                          value={charge.season || ""}
                                          onChange={(e) => {
                                            const updated = [...extractedData.tariffStructures];
                                            updated[tariffIdx].demandCharges[chargeIdx].season = e.target.value;
                                            setExtractedData({ ...extractedData, tariffStructures: updated });
                                          }}
                                          className="h-8 mt-1"
                                          placeholder="e.g., Summer, Winter"
                                        />
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <Label className="text-xs">Rate</Label>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            value={charge.rate || 0}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].demandCharges[chargeIdx].rate = parseFloat(e.target.value) || 0;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">Unit</Label>
                                          <Input
                                            value={charge.unit || ""}
                                            onChange={(e) => {
                                              const updated = [...extractedData.tariffStructures];
                                              updated[tariffIdx].demandCharges[chargeIdx].unit = e.target.value;
                                              setExtractedData({ ...extractedData, tariffStructures: updated });
                                            }}
                                            className="h-8"
                                          />
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          const updated = [...extractedData.tariffStructures];
                                          updated[tariffIdx].demandCharges.splice(chargeIdx, 1);
                                          setExtractedData({ ...extractedData, tariffStructures: updated });
                                        }}
                                        className="h-6 text-xs text-destructive hover:text-destructive w-full"
                                      >
                                        <Trash2 className="h-3 w-3 mr-1" />
                                        Remove Charge
                                      </Button>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
                                    No demand charges.
                                  </p>
                                )}
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                    
                    {/* Add tariff button when no tariffs exist */}
                    {(!extractedData.tariffStructures || extractedData.tariffStructures.length === 0) && (
                      <div className="mt-4">
                        <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
                          No tariff structures. Click the button below to add one.
                        </p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                
                {/* Action buttons - Always visible at bottom */}
                <div className="flex gap-2 p-4 border-t bg-background">
                  <Button
                    onClick={() => {
                      if (appendSelectionDrawn && fabricCanvas && selectionRectRef.current) {
                        // Extract the selected region and append
                        handleExtractFromRegion(fabricCanvas, selectionRectRef.current, true);
                        setAppendSelectionDrawn(false);
                        setIsAppendMode(false);
                      } else {
                        // Start selection mode
                        handleStartSelection(true);
                      }
                    }}
                    variant="outline"
                    size="sm"
                    disabled={isExtracting || (selectionMode && !appendSelectionDrawn)}
                    className="flex-1"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {appendSelectionDrawn ? 'Extract' : 'Append'}
                  </Button>
                  <Button
                    onClick={() => {
                      const updated = [...(extractedData.tariffStructures || [])];
                      updated.push({
                        tariffName: "",
                        blocks: [],
                        fixedEnergy: [],
                        seasonalEnergy: [],
                        touPeriods: [],
                        demandCharges: []
                      });
                      setExtractedData({ ...extractedData, tariffStructures: updated });
                    }}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Tariff
                  </Button>
                  <Button
                    onClick={handleAcceptExtraction}
                    size="sm"
                    className="flex-1"
                  >
                    {editingMunicipalityId ? 'Update Municipality' : 'Add Municipality'}
                  </Button>
                </div>
              </>
            ) : selectionRectRef.current ? (
                <div className="flex flex-col items-center justify-center h-full p-6 gap-4">
                  <p className="text-sm text-muted-foreground text-center">
                    Region selected. Click the button below to extract municipality data.
                  </p>
                  <Button
                    onClick={() => {
                      if (fabricCanvas && selectionRectRef.current) {
                        handleExtractFromRegion(fabricCanvas, selectionRectRef.current);
                      }
                    }}
                    disabled={!fabricCanvas || !selectionRectRef.current}
                    className="w-full"
                  >
                    Extract Data
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Click "Select Region" and draw a box around municipality data to extract it.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

            {/* Bottom: Accepted Municipalities - Collapsible */}
            <Card className={`overflow-hidden flex flex-col transition-all duration-300 ${isAcceptedPanelCollapsed ? 'h-12' : 'flex-1'}`}>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                {!isAcceptedPanelCollapsed && (
                  <CardTitle className="text-sm">Accepted Municipalities ({acceptedMunicipalities.length})</CardTitle>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setIsAcceptedPanelCollapsed(!isAcceptedPanelCollapsed)}
                  className="h-8 w-8 ml-auto"
                >
                  {isAcceptedPanelCollapsed ? <ChevronLeft className="h-4 w-4 -rotate-90" /> : <ChevronRight className="h-4 w-4 -rotate-90" />}
                </Button>
              </CardHeader>
            {!isAcceptedPanelCollapsed && (
              <CardContent className="flex-1 overflow-y-auto p-0">
                <ScrollArea className="h-full">
                  <div className="space-y-2 p-4">
                    {acceptedMunicipalities.map((municipality) => (
                      <div
                        key={municipality.id}
                        className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-sm">{municipality.name}</div>
                          <div className="text-xs text-muted-foreground">
                            NERSA Increase: {municipality.nersaIncrease}%
                            {municipality.tariffStructures && municipality.tariffStructures.length > 0 && (
                              <span className="ml-2">• {municipality.tariffStructures.length} tariff{municipality.tariffStructures.length !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleViewMunicipality(municipality)}
                            className="h-8 w-8"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDeleteMunicipality(municipality.id)}
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {acceptedMunicipalities.length === 0 && (
                      <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
                        No municipalities added yet
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            )}
            </Card>
          </div>
        </div>

        <div className="flex justify-between gap-3 p-6 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleComplete}
            disabled={acceptedMunicipalities.length === 0}
          >
            Complete ({acceptedMunicipalities.length} municipalities)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
