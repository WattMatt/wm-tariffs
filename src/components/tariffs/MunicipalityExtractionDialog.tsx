import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Trash2, Eye, Plus } from "lucide-react";
import { pdfjs } from 'react-pdf';
import { toast } from "sonner";
import { Canvas as FabricCanvas, Rect as FabricRect } from "fabric";
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
  const [selectionRect, setSelectionRect] = useState<FabricRect | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<MunicipalityData | null>(null);
  const [acceptedMunicipalities, setAcceptedMunicipalities] = useState<AcceptedMunicipality[]>([]);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Convert PDF to image (all pages stitched vertically)
  const convertPdfToImage = async (pdfFile: File): Promise<string> => {
    setIsConvertingPdf(true);
    try {
      console.log('Converting PDF to image:', pdfFile.name);
      
      const arrayBuffer = await pdfFile.arrayBuffer();
      const loadingTask = pdfjs.getDocument(arrayBuffer);
      const pdf = await loadingTask.promise;
      
      console.log(`PDF loaded with ${pdf.numPages} pages, converting all pages...`);
      
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
      
      console.log('All pages stitched, converting to data URL...');
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

  // Initialize Fabric canvas for selection
  useEffect(() => {
    if (!canvasContainerRef.current || !convertedPdfImage || !imageRef.current) return;

    const img = imageRef.current;
    const rect = img.getBoundingClientRect();

    const canvas = new FabricCanvas(canvasContainerRef.current.querySelector('canvas')!, {
      width: rect.width,
      height: rect.height,
      selection: false,
    });

    canvas.backgroundColor = 'transparent';
    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [convertedPdfImage]);

  // Handle selection mode
  useEffect(() => {
    if (!fabricCanvas) return;

    if (selectionMode) {
      let isDrawing = false;
      let startX = 0;
      let startY = 0;

      const handleMouseDown = (e: any) => {
        isDrawing = true;
        const pointer = fabricCanvas.getPointer(e.e);
        startX = pointer.x;
        startY = pointer.y;

        const rect = new FabricRect({
          left: startX,
          top: startY,
          width: 0,
          height: 0,
          fill: 'rgba(59, 130, 246, 0.2)',
          stroke: 'rgb(59, 130, 246)',
          strokeWidth: 2,
          selectable: false,
        });

        fabricCanvas.add(rect);
        setSelectionRect(rect);
      };

      const handleMouseMove = (e: any) => {
        if (!isDrawing || !selectionRect) return;
        
        const pointer = fabricCanvas.getPointer(e.e);
        const width = pointer.x - startX;
        const height = pointer.y - startY;

        if (width > 0) {
          selectionRect.set({ width });
        } else {
          selectionRect.set({ left: pointer.x, width: Math.abs(width) });
        }

        if (height > 0) {
          selectionRect.set({ height });
        } else {
          selectionRect.set({ top: pointer.y, height: Math.abs(height) });
        }

        fabricCanvas.renderAll();
      };

      const handleMouseUp = async () => {
        if (isDrawing && selectionRect && imageRef.current) {
          isDrawing = false;
          setSelectionMode(false);
          
          // Calculate relative coordinates
          const rect = imageRef.current.getBoundingClientRect();
          const scaleX = imageRef.current.naturalWidth / rect.width;
          const scaleY = imageRef.current.naturalHeight / rect.height;
          
          const cropRegion = {
            x: (selectionRect.left || 0) * scaleX,
            y: (selectionRect.top || 0) * scaleY,
            width: (selectionRect.width || 0) * scaleX,
            height: (selectionRect.height || 0) * scaleY,
          };
          
          // Extract from the selected region
          await handleExtractFromRegion(cropRegion);
        }
      };

      fabricCanvas.on('mouse:down', handleMouseDown);
      fabricCanvas.on('mouse:move', handleMouseMove);
      fabricCanvas.on('mouse:up', handleMouseUp);

      return () => {
        fabricCanvas.off('mouse:down', handleMouseDown);
        fabricCanvas.off('mouse:move', handleMouseMove);
        fabricCanvas.off('mouse:up', handleMouseUp);
      };
    }
  }, [selectionMode, fabricCanvas]);

  const handleExtractFromRegion = async (cropRegion: { x: number; y: number; width: number; height: number }) => {
    if (!convertedPdfImage || !imageRef.current) return;

    setIsExtracting(true);
    try {
      // Crop the image to the selected region
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = cropRegion.width;
      croppedCanvas.height = cropRegion.height;
      const ctx = croppedCanvas.getContext('2d');
      
      if (!ctx) throw new Error('Could not get canvas context');
      
      const img = new Image();
      img.src = convertedPdfImage;
      await new Promise((resolve) => { img.onload = resolve; });
      
      ctx.drawImage(
        img,
        cropRegion.x,
        cropRegion.y,
        cropRegion.width,
        cropRegion.height,
        0,
        0,
        cropRegion.width,
        cropRegion.height
      );
      
      const croppedImageUrl = croppedCanvas.toDataURL('image/png');
      
      // Upload to storage
      const response = await fetch(croppedImageUrl);
      const blob = await response.blob();
      const timestamp = Date.now();
      const fileName = `municipality-extract-${timestamp}.png`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
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
      fabricCanvas.clear();
      setSelectionRect(null);
    }
    setExtractedData(null);
    setSelectionMode(true);
    toast.info("Draw a box around the municipality information you want to extract.");
  };

  const handleAcceptExtraction = () => {
    if (!extractedData) return;
    
    const newMunicipality: AcceptedMunicipality = {
      ...extractedData,
      id: `${Date.now()}-${Math.random()}`
    };
    
    setAcceptedMunicipalities(prev => [...prev, newMunicipality]);
    setExtractedData(null);
    
    if (fabricCanvas) {
      fabricCanvas.clear();
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
                  <Button
                    size="sm"
                    onClick={handleStartSelection}
                    disabled={isConvertingPdf || selectionMode || isExtracting}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Select Region
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0 relative">
                {isConvertingPdf ? (
                  <div className="flex flex-col items-center justify-center h-full p-6">
                    <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                    <p className="text-sm text-muted-foreground">Converting PDF...</p>
                  </div>
                ) : convertedPdfImage ? (
                  <ScrollArea className="h-full w-full">
                    <div ref={canvasContainerRef} className="relative inline-block">
                      <img
                        ref={imageRef}
                        src={convertedPdfImage}
                        alt="PDF Preview"
                        className="w-full"
                      />
                      <canvas
                        className="absolute top-0 left-0 pointer-events-auto"
                        style={{ cursor: selectionMode ? 'crosshair' : 'default' }}
                      />
                    </div>
                  </ScrollArea>
                ) : null}
              </CardContent>
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
                          className="h-8 w-8"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {acceptedMunicipalities.length === 0 && (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      No municipalities added yet. Extract and accept municipalities to build your list.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 p-6 pt-0">
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
