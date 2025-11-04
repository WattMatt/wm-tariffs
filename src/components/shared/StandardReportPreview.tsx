import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  // Fetch PDF URL when dialog opens
  useEffect(() => {
    if (open && report?.file_path) {
      setIsLoading(true);

      try {
        const { data } = supabase.storage
          .from(storageBucket)
          .getPublicUrl(report.file_path);

        // Add cache busting timestamp
        const urlWithCacheBust = `${data.publicUrl}?t=${Date.now()}`;
        setPdfUrl(urlWithCacheBust);
        setIsLoading(false);
      } catch (error) {
        console.error("Error fetching PDF URL:", error);
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

  const handlePrint = () => {
    if (!pdfUrl) return;
    
    // Open PDF in new window for printing
    const printWindow = window.open(pdfUrl, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    } else {
      toast.error("Please allow pop-ups to print the report");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold">
              {report?.report_name || "Report Preview"}
            </DialogTitle>
            
            <div className="flex items-center gap-2">
              {/* Print button */}
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                disabled={!pdfUrl || isLoading}
              >
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
              
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

        {/* PDF Viewer Area - Native Browser Viewer */}
        <div className="flex-1 overflow-hidden bg-muted rounded-lg">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Loading PDF...</p>
              </div>
            </div>
          ) : pdfUrl ? (
            <iframe
              src={pdfUrl}
              className="w-full h-full border-0"
              title="PDF Preview"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">No PDF to display</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
