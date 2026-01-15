import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Save, X, RefreshCw, Loader2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import { Document, Page, pdfjs } from 'react-pdf';
import { toast } from "sonner";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfSection {
  id: string;
  title: string;
  content: string;
  type: 'text' | 'page-break' | 'chart';
  editable: boolean;
}

interface SplitViewReportEditorProps {
  sections: PdfSection[];
  siteId: string;
  dateFrom?: string;
  dateTo?: string;
  onSave: (sections: PdfSection[]) => void;
  onCancel: () => void;
  generatePdfPreview: (sections: PdfSection[]) => Promise<string>;
  generateFinalPdf?: (sections: PdfSection[]) => Promise<void>;
}

export function SplitViewReportEditor({ 
  sections, 
  siteId,
  dateFrom,
  dateTo,
  onSave, 
  onCancel,
  generatePdfPreview,
  generateFinalPdf
}: SplitViewReportEditorProps) {
  const [localSections, setLocalSections] = useState<PdfSection[]>(sections);
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);

  // Generate initial PDF preview on mount
  useEffect(() => {
    const initPreview = async () => {
      setIsGenerating(true);
      try {
        const url = await generatePdfPreview(localSections);
        setPdfUrl(url);
      } catch (error) {
        console.error("Error generating initial PDF:", error);
      } finally {
        setIsGenerating(false);
      }
    };
    initPreview();
  }, []);

  const handleSave = async () => {
    if (generateFinalPdf) {
      setIsGenerating(true);
      try {
        await generateFinalPdf(localSections);
      } catch (error) {
        console.error("Error generating final PDF:", error);
        toast.error("Failed to generate final PDF");
      } finally {
        setIsGenerating(false);
      }
    } else {
      onSave(localSections);
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

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 1 && value <= numPages) {
      setPageNumber(value);
    }
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const handleRefresh = async () => {
    setIsGenerating(true);
    try {
      const url = await generatePdfPreview(localSections);
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
          <h2 className="text-lg font-semibold">Report Preview</h2>
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

      {/* PDF Viewer */}
      <div className="flex-1 flex flex-col min-h-0">
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
                <div className="flex items-center gap-1 text-xs font-medium">
                  <input
                    type="number"
                    min={1}
                    max={numPages}
                    value={pageNumber}
                    onChange={handlePageInputChange}
                    onKeyDown={handlePageInputKeyDown}
                    className="w-10 h-6 text-center text-xs border rounded bg-background [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span>/ {numPages}</span>
                </div>
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
        <div className="flex-1 bg-muted/20 overflow-auto">
          {pdfUrl ? (
            <div className="h-full flex items-center justify-center p-4">
              <div className="relative">
                <Document
                  file={pdfUrl}
                  onLoadSuccess={onDocumentLoadSuccess}
                  onLoadError={(error) => {
                    console.error('PDF load error:', error);
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
        </div>
      </div>
    </div>
  );
}
