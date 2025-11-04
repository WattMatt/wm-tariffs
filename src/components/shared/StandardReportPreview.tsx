import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface StandardReportPreviewProps {
  report: any; // Must have: file_path, report_name
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageBucket?: string;
}

export function StandardReportPreview({
  report,
  open,
  onOpenChange,
  storageBucket = "site-reports",
}: StandardReportPreviewProps) {
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  // Fetch PDF URL when dialog opens
  useEffect(() => {
    if (open && report?.file_path) {
      setIsLoading(true);
      setHasError(false);
      setPageNumber(1);

      try {
        const { data } = supabase.storage
          .from(storageBucket)
          .getPublicUrl(report.file_path);

        // Add cache busting timestamp
        const urlWithCacheBust = `${data.publicUrl}?t=${Date.now()}`;
        setPdfUrl(urlWithCacheBust);
        console.log("Loading PDF from:", urlWithCacheBust);
      } catch (error) {
        console.error("Error fetching PDF URL:", error);
        setHasError(true);
        setIsLoading(false);
        toast.error("Failed to load PDF preview");
      }
    }

    // Cleanup on unmount
    return () => {
      if (pdfUrl) {
        setPdfUrl("");
      }
    };
  }, [open, report?.file_path, storageBucket]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setIsLoading(false);
    setHasError(false);
    console.log(`PDF loaded successfully: ${numPages} pages`);
  };

  const onDocumentLoadError = (error: Error) => {
    console.error("Error loading PDF:", error);
    setIsLoading(false);
    setHasError(true);
    toast.error("Failed to load PDF. You can download it instead.");
  };

  const handleDownload = async () => {
    if (!report?.file_path) return;

    setIsDownloading(true);
    try {
      const { data, error } = await supabase.storage
        .from(storageBucket)
        .download(report.file_path);

      if (error) throw error;

      // Create download link
      const url = window.URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = report.report_name || "report.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success("Report downloaded successfully");
    } catch (error) {
      console.error("Error downloading PDF:", error);
      toast.error("Failed to download report");
    } finally {
      setIsDownloading(false);
    }
  };

  const goToPrevPage = () => {
    setPageNumber((prev) => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setPageNumber((prev) => Math.min(numPages, prev + 1));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold">
              {report?.report_name || "Report Preview"}
            </DialogTitle>
            
            <div className="flex items-center gap-2">
              {/* Page counter - only show for multi-page PDFs */}
              {numPages > 1 && !isLoading && !hasError && (
                <span className="text-sm text-muted-foreground mr-2">
                  Page {pageNumber} of {numPages}
                </span>
              )}
              
              {/* Download button */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* PDF Viewer Area */}
        <div className="flex-1 overflow-auto bg-muted rounded-lg p-4">
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Loading PDF...</p>
              </div>
            </div>
          )}

          {hasError && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-4">
                <p className="text-sm text-destructive">
                  Unable to display PDF preview
                </p>
                <Button onClick={handleDownload} disabled={isDownloading}>
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Download PDF Instead
                </Button>
              </div>
            </div>
          )}

          {!isLoading && !hasError && pdfUrl && (
            <div className="flex flex-col items-center">
              <Document
                file={pdfUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                loading={
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                }
              >
                <Page
                  pageNumber={pageNumber}
                  width={700}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  className="shadow-lg"
                />
              </Document>
            </div>
          )}
        </div>

        {/* Navigation Controls - only show for multi-page PDFs */}
        {numPages > 1 && !isLoading && !hasError && (
          <div className="flex-shrink-0 flex items-center justify-center gap-4 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPrevPage}
              disabled={pageNumber <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>

            <span className="text-sm font-medium">
              {pageNumber} / {numPages}
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={goToNextPage}
              disabled={pageNumber >= numPages}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
