import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Save, X, RefreshCw, Loader2, ZoomIn, ZoomOut, Wand2, ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Document, Page, pdfjs } from 'react-pdf';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfSection {
  id: string;
  title: string;
  content: string;
  type: 'text' | 'page-break';
  editable: boolean;
}

interface SplitViewReportEditorProps {
  sections: PdfSection[];
  onSave: (sections: PdfSection[]) => void;
  onCancel: () => void;
  generatePdfPreview: (sections: PdfSection[]) => Promise<string>;
  generateFinalPdf?: (sections: PdfSection[]) => Promise<void>;
}

interface SelectionArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function SplitViewReportEditor({ 
  sections, 
  onSave, 
  onCancel,
  generatePdfPreview,
  generateFinalPdf
}: SplitViewReportEditorProps) {
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionArea, setSelectionArea] = useState<SelectionArea | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Generate initial PDF preview on mount
  useEffect(() => {
    const initPreview = async () => {
      setIsGenerating(true);
      try {
        console.log('Generating PDF preview...');
        const url = await generatePdfPreview(sections);
        console.log('PDF URL generated:', url);
        console.log('PDF URL type:', typeof url);
        console.log('Is blob URL?', url.startsWith('blob:'));
        setPdfUrl(url);
        setInitialLoadDone(true);
      } catch (error) {
        console.error("Error generating initial PDF:", error);
      } finally {
        setIsGenerating(false);
      }
    };
    initPreview();
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsSelecting(true);
    setStartPoint({ x, y });
    setSelectionArea(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || !startPoint || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const width = x - startPoint.x;
    const height = y - startPoint.y;
    
    // Draw selection rectangle
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(startPoint.x, startPoint.y, width, height);
    ctx.fillRect(startPoint.x, startPoint.y, width, height);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || !startPoint) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const width = x - startPoint.x;
    const height = y - startPoint.y;
    
    if (Math.abs(width) > 10 && Math.abs(height) > 10) {
      setSelectionArea({
        x: Math.min(startPoint.x, x),
        y: Math.min(startPoint.y, y),
        width: Math.abs(width),
        height: Math.abs(height)
      });
    }
    
    setIsSelecting(false);
    setStartPoint(null);
  };

  const handleApplyChanges = async () => {
    if (!prompt.trim() || !selectionArea) return;
    
    setIsGenerating(true);
    try {
      // TODO: Send prompt and selection area to AI for processing
      console.log('Applying changes:', { prompt, selectionArea });
      // For now, just regenerate the preview
      // In the future, this will call an AI service to modify the selected area
    } catch (error) {
      console.error("Error applying changes:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearSelection = () => {
    setSelectionArea(null);
    setPrompt("");
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const handleSave = async () => {
    if (generateFinalPdf) {
      setIsGenerating(true);
      try {
        await generateFinalPdf(sections);
      } catch (error) {
        console.error("Error generating final PDF:", error);
      } finally {
        setIsGenerating(false);
      }
    } else {
      onSave(sections);
    }
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 10, 200));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 10, 50));
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const goToPrevPage = () => {
    setPageNumber((prev) => Math.max(prev - 1, 1));
  };

  const goToNextPage = () => {
    setPageNumber((prev) => Math.min(prev + 1, numPages));
  };

  const handleRefresh = async () => {
    setIsGenerating(true);
    try {
      const url = await generatePdfPreview(sections);
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      setPdfUrl(url);
    } catch (error) {
      console.error("Error refreshing PDF:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Update canvas size to match PDF page dimensions
  useEffect(() => {
    const updateCanvasSize = () => {
      if (!pdfContainerRef.current || !canvasRef.current) return;
      
      // Find the actual PDF page element
      const pageElement = pdfContainerRef.current.querySelector('.react-pdf__Page__canvas');
      if (pageElement) {
        const rect = pageElement.getBoundingClientRect();
        const canvas = canvasRef.current;
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        // Position canvas to match the PDF page
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
    };
    
    // Use a slight delay to ensure PDF is rendered
    const timer = setTimeout(updateCanvasSize, 100);
    window.addEventListener('resize', updateCanvasSize);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [zoom, pdfUrl, pageNumber]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {/* Header */}
      <div className="h-14 border-b flex items-center justify-between px-4 bg-muted/10">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">AI Report Workshop</h2>
          {isGenerating && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Processing...</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} size="sm" disabled={isGenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                {generateFinalPdf ? 'Generate & Save PDF' : 'Save Changes'}
              </>
            )}
          </Button>
          <Button onClick={onCancel} variant="outline" size="sm" disabled={isGenerating}>
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        </div>
      </div>

      {/* Split View */}
      <div className="h-[800px]">
        <ResizablePanelGroup direction="horizontal">
          {/* Left Panel - AI Workshop */}
          <ResizablePanel defaultSize={35} minSize={25}>
            <div className="h-full flex flex-col">
              <div className="h-10 border-b flex items-center px-4 bg-muted/30">
                <Wand2 className="w-4 h-4 mr-2" />
                <span className="text-sm font-medium">AI Workshop</span>
              </div>
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  <Card className="p-4 bg-muted/30">
                    <h3 className="text-sm font-semibold mb-2">How to use:</h3>
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>Select an area on the PDF by clicking and dragging</li>
                      <li>Describe what you want to change</li>
                      <li>Click "Apply Changes" to modify that section</li>
                    </ol>
                  </Card>

                  {selectionArea && (
                    <Card className="p-4 border-primary/50">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold">Area Selected</h3>
                        <Button 
                          onClick={handleClearSelection} 
                          variant="ghost" 
                          size="sm"
                          className="h-6"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">
                        Position: ({Math.round(selectionArea.x)}, {Math.round(selectionArea.y)})<br />
                        Size: {Math.round(selectionArea.width)} × {Math.round(selectionArea.height)}px
                      </p>
                      <div className="space-y-2">
                        <label className="text-xs font-medium">What would you like to change?</label>
                        <Textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder="E.g., 'Make the text bold and increase font size' or 'Change this graph to a pie chart'"
                          className="min-h-[120px] text-sm"
                        />
                        <Button 
                          onClick={handleApplyChanges}
                          disabled={!prompt.trim() || isGenerating}
                          className="w-full"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <Wand2 className="w-4 h-4 mr-2" />
                              Apply Changes
                            </>
                          )}
                        </Button>
                      </div>
                    </Card>
                  )}

                  {!selectionArea && (
                    <Card className="p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        Select an area on the PDF to get started
                      </p>
                    </Card>
                  )}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Panel - PDF Viewer with Selection */}
          <ResizablePanel defaultSize={65} minSize={40}>
            <div className="h-full flex flex-col">
              <div className="h-10 border-b flex items-center justify-between px-4 bg-muted/30">
                <span className="text-sm font-medium">PDF Preview</span>
                <div className="flex items-center gap-2">
                  {numPages > 0 && (
                    <>
                      <Button 
                        onClick={goToPrevPage} 
                        variant="ghost" 
                        size="icon"
                        className="h-7 w-7"
                        disabled={pageNumber <= 1}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-xs font-medium min-w-[4rem] text-center">
                        {pageNumber} / {numPages}
                      </span>
                      <Button 
                        onClick={goToNextPage} 
                        variant="ghost" 
                        size="icon"
                        className="h-7 w-7"
                        disabled={pageNumber >= numPages}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      <div className="w-px h-5 bg-border mx-1" />
                    </>
                  )}
                  <Button 
                    onClick={handleZoomOut} 
                    variant="ghost" 
                    size="icon"
                    className="h-7 w-7"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="text-xs font-medium min-w-[3rem] text-center">
                    {zoom}%
                  </span>
                  <Button 
                    onClick={handleZoomIn} 
                    variant="ghost" 
                    size="icon"
                    className="h-7 w-7"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                  <div className="w-px h-5 bg-border mx-1" />
                  <Button onClick={handleRefresh} variant="ghost" size="icon" className="h-7 w-7">
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 bg-muted/20">
                {pdfUrl ? (
                  <div className="p-4">
                    <div 
                      ref={pdfContainerRef}
                      className="relative mx-auto"
                    >
                      <Document
                        file={pdfUrl}
                        onLoadSuccess={onDocumentLoadSuccess}
                        onLoadError={(error) => {
                          console.error('PDF load error:', error);
                          console.error('PDF URL that failed:', pdfUrl);
                        }}
                        loading={
                          <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                          </div>
                        }
                        error={
                          <div className="flex items-center justify-center py-20">
                            <div className="text-center space-y-4">
                              <p className="text-sm text-destructive">Failed to load PDF</p>
                              <Button onClick={handleRefresh} variant="outline" size="sm">
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Try Again
                              </Button>
                            </div>
                          </div>
                        }
                      >
                        <Page
                          pageNumber={pageNumber}
                          scale={zoom / 100}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                          loading={
                            <div className="flex items-center justify-center py-20">
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            </div>
                          }
                        />
                      </Document>
                      <canvas
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        className="absolute pointer-events-auto"
                        style={{ 
                          cursor: isSelecting ? 'crosshair' : 'default',
                          top: 0,
                          left: 0
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center space-y-2">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Loading PDF...</p>
                    </div>
                  </div>
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
