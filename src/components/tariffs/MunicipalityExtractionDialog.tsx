import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Trash2, Eye, Plus, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
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
}

interface MunicipalityExtractionDialogProps {
  open: boolean;
  onClose: () => void;
  pdfFile: File;
  onComplete: (municipalities: MunicipalityData[]) => void;
}

export default function MunicipalityExtractionDialog({
  open,
  onClose,
  pdfFile,
  onComplete
}: MunicipalityExtractionDialogProps) {
  const [convertedPdfImage, setConvertedPdfImage] = useState<string | null>(null);
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<MunicipalityData | null>(null);
  const [acceptedMunicipalities, setAcceptedMunicipalities] = useState<AcceptedMunicipality[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const selectionRectRef = useRef<FabricRect | null>(null);
  const startMarkerRef = useRef<Circle | null>(null);
  const [zoom, setZoom] = useState(1);

  // Convert PDF to image (all pages stitched vertically)
  const convertPdfToImage = async (pdfFile: File): Promise<string> => {
    setIsConvertingPdf(true);
    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const loadingTask = pdfjs.getDocument(arrayBuffer);
      const pdf = await loadingTask.promise;
      
      const scale = 2.0;
      const pageCanvases: HTMLCanvasElement[] = [];
      let maxWidth = 0;
      let totalHeight = 0;
      
      // Render all pages
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
        
        pageCanvases.push(canvas);
        maxWidth = Math.max(maxWidth, viewport.width);
        totalHeight += viewport.height;
      }
      
      // Stitch all pages vertically
      const stitchedCanvas = document.createElement('canvas');
      stitchedCanvas.width = maxWidth;
      stitchedCanvas.height = totalHeight;
      const stitchedContext = stitchedCanvas.getContext('2d');
      
      if (!stitchedContext) throw new Error('Could not get stitched canvas context');
      
      let currentY = 0;
      for (const pageCanvas of pageCanvases) {
        stitchedContext.drawImage(pageCanvas, 0, currentY);
        currentY += pageCanvas.height;
      }
      
      return stitchedCanvas.toDataURL('image/png', 1.0);
    } catch (error) {
      console.error('Error converting PDF to image:', error);
      toast.error('Failed to convert PDF to image');
      throw error;
    } finally {
      setIsConvertingPdf(false);
    }
  };

  // Convert PDF when dialog opens
  useEffect(() => {
    if (open && pdfFile) {
      convertPdfToImage(pdfFile).then(imageUrl => {
        setConvertedPdfImage(imageUrl);
      }).catch(error => {
        console.error('Failed to convert PDF:', error);
      });
    }
  }, [open, pdfFile]);

  // Initialize Fabric canvas with PDF image
  useEffect(() => {
    if (!canvasRef.current || !convertedPdfImage) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 1200,
      height: 700,
      backgroundColor: "#f8f9fa",
    });

    // Load the PDF image onto the canvas
    FabricImage.fromURL(convertedPdfImage).then((img) => {
      // Scale image to fit canvas
      const scale = Math.min(
        canvas.width! / img.width!,
        canvas.height! / img.height!
      );
      
      img.scale(scale * 0.9); // Scale down a bit to add margins
      img.set({
        left: (canvas.width! - img.width! * img.scaleX!) / 2,
        top: (canvas.height! - img.height! * img.scaleY!) / 2,
        selectable: false,
        evented: false,
      });
      
      canvas.add(img);
      canvas.sendObjectToBack(img);
      canvas.renderAll();
    });

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
      
      // SELECTION MODE: Handle two-click region drawing
      if (selectionMode && evt.button === 0) {
        // Only process clicks on empty canvas or the image
        const isInteractiveObject = target && target.type !== 'image';
        if (isInteractiveObject) return;
        
        const pointer = canvas.getPointer(opt.e);
        
        // First click - set start point
        if (!drawStartPointRef.current) {
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
        drawStartPointRef.current = null;
        
        // Trigger extraction
        handleExtractFromRegion(canvas, rect);
        
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }
      
      // PANNING: Only allow when NOT in selection mode
      if (!selectionMode && !target) {
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
      if (selectionMode && drawStartPointRef.current && !selectionRectRef.current) {
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
      if (isPanningLocal && !selectionMode) {
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
  }, [convertedPdfImage]);

  const handleExtractFromRegion = async (canvas: FabricCanvas, rect: FabricRect) => {
    if (!convertedPdfImage) return;

    setIsExtracting(true);
    try {
      // Get the image object from canvas
      const objects = canvas.getObjects();
      const imageObj = objects.find(obj => obj.type === 'image') as FabricImage;
      
      if (!imageObj) throw new Error('Image not found on canvas');
      
      // Calculate coordinates in original image space
      const zoom = canvas.getZoom();
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      
      const imgScaleX = imageObj.scaleX || 1;
      const imgScaleY = imageObj.scaleY || 1;
      const imgLeft = imageObj.left || 0;
      const imgTop = imageObj.top || 0;
      
      // Convert rect coordinates to image coordinates
      const rectLeft = (rect.left! - imgLeft) / (imgScaleX * zoom);
      const rectTop = (rect.top! - imgTop) / (imgScaleY * zoom);
      const rectWidth = rect.width! / (imgScaleX * zoom);
      const rectHeight = rect.height! / (imgScaleY * zoom);
      
      // Crop the original image
      const img = new Image();
      img.src = convertedPdfImage;
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
      
      setExtractedData({
        name: data.municipality?.name || "",
        nersaIncrease: data.municipality?.nersaIncrease || 0
      });
      
      toast.success("Municipality data extracted!");
    } catch (error: any) {
      console.error("Extraction failed:", error);
      toast.error(error.message || "Failed to extract municipality data");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleStartSelection = () => {
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
    
    drawStartPointRef.current = null;
    setExtractedData(null);
    setSelectionMode(true);
    toast.info("Click once to start, then click again to complete the selection");
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
    
    const newMunicipality: AcceptedMunicipality = {
      ...extractedData,
      id: `${Date.now()}-${Math.random()}`
    };
    
    setAcceptedMunicipalities(prev => [...prev, newMunicipality]);
    setExtractedData(null);
    
    if (fabricCanvas && selectionRectRef.current) {
      fabricCanvas.remove(selectionRectRef.current);
      selectionRectRef.current = null;
      fabricCanvas.renderAll();
    }
    
    toast.success(`${extractedData.name} added to list!`);
  };

  const handleViewMunicipality = (municipality: AcceptedMunicipality) => {
    setExtractedData({
      name: municipality.name,
      nersaIncrease: municipality.nersaIncrease
    });
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

        <div className="flex-1 overflow-hidden flex flex-col px-6 gap-4">
          {/* Top Section: Left (PDF) + Right (Extracted Data) */}
          <div className="grid grid-cols-2 gap-4 h-[60%]">
            {/* Left: PDF Preview with Selection */}
            <Card className="overflow-hidden flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Source Document</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleZoomIn}
                      disabled={!convertedPdfImage}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleZoomOut}
                      disabled={!convertedPdfImage}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleResetZoom}
                      disabled={!convertedPdfImage}
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
                  <Button
                    size="sm"
                    onClick={handleStartSelection}
                    disabled={!convertedPdfImage || isExtracting}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Select Region
                  </Button>
                )}
              </div>
            </Card>

            {/* Right: Extracted Data */}
            <Card className="overflow-hidden flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Extracted Data</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto">
                {isExtracting ? (
                  <div className="flex flex-col items-center justify-center h-full p-6">
                    <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                    <h3 className="font-semibold mb-2">Extracting Municipality Data</h3>
                    <p className="text-sm text-muted-foreground text-center">
                      Analyzing selected region with AI...
                    </p>
                  </div>
                ) : extractedData ? (
                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs">Municipality Name</Label>
                      <Input
                        value={extractedData.name}
                        onChange={(e) => setExtractedData({ ...extractedData, name: e.target.value })}
                        className="h-9 mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">NERSA Increase (%)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={extractedData.nersaIncrease}
                        onChange={(e) => setExtractedData({ ...extractedData, nersaIncrease: parseFloat(e.target.value) || 0 })}
                        className="h-9 mt-1"
                      />
                    </div>
                    <Button
                      onClick={handleAcceptExtraction}
                      className="w-full"
                    >
                      Accept & Add to List
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
          </div>

          {/* Bottom Section: Accepted Municipalities List */}
          <Card className="h-[35%] overflow-hidden flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Accepted Municipalities ({acceptedMunicipalities.length})</CardTitle>
            </CardHeader>
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
          </Card>
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
