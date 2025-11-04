import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Download, Trash2, Loader2, Eye } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StandardReportPreview } from "@/components/shared/StandardReportPreview";

interface SavedReport {
  id: string;
  file_name: string;
  file_path: string;
  created_at: string;
  file_size: number | null;
}

interface SavedReportsListProps {
  siteId: string;
  onRefresh?: () => void;
}

export default function SavedReportsList({ siteId, onRefresh }: SavedReportsListProps) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reportToDelete, setReportToDelete] = useState<SavedReport | null>(null);
  const [previewReport, setPreviewReport] = useState<SavedReport | null>(null);

  const fetchReports = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("site_documents")
        .select("id, file_name, file_path, created_at, file_size")
        .eq("site_id", siteId)
        .eq("document_type", "report")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setReports(data || []);
    } catch (error) {
      console.error("Error fetching reports:", error);
      toast.error("Failed to load saved reports");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [siteId]);

  const handleDownload = async (report: SavedReport) => {
    try {
      const { data, error } = await supabase.storage
        .from("site-documents")
        .download(report.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = report.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Report downloaded successfully");
    } catch (error) {
      console.error("Error downloading report:", error);
      toast.error("Failed to download report");
    }
  };

  const handleDelete = async () => {
    if (!reportToDelete) return;

    setDeletingId(reportToDelete.id);
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from("site-documents")
        .remove([reportToDelete.file_path]);

      if (storageError) throw storageError;

      // Delete from database
      const { error: dbError } = await supabase
        .from("site_documents")
        .delete()
        .eq("id", reportToDelete.id);

      if (dbError) throw dbError;

      toast.success("Report deleted successfully");
      fetchReports();
      onRefresh?.();
    } catch (error) {
      console.error("Error deleting report:", error);
      toast.error("Failed to delete report");
    } finally {
      setDeletingId(null);
      setReportToDelete(null);
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "Unknown";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="p-4 border rounded-lg bg-muted/30 text-center">
        <FileText className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No saved reports yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Generate and save reports to see them here
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <p className="text-sm font-medium mb-3">Saved Reports ({reports.length})</p>
        {reports.map((report) => (
          <div
            key={report.id}
            className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{report.file_name}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(report.created_at), "dd MMM yyyy, HH:mm")} • {formatFileSize(report.file_size)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewReport(report)}
                disabled={deletingId === report.id}
                title="Preview report"
              >
                <Eye className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDownload(report)}
                disabled={deletingId === report.id}
                title="Download report"
              >
                <Download className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReportToDelete(report)}
                disabled={deletingId === report.id}
                title="Delete report"
              >
                {deletingId === report.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={!!reportToDelete} onOpenChange={() => setReportToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{reportToDelete?.file_name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PDF Preview Dialog */}
      {previewReport && (
        <StandardReportPreview
          report={{
            file_path: previewReport.file_path,
            report_name: previewReport.file_name,
          }}
          open={!!previewReport}
          onOpenChange={(open) => !open && setPreviewReport(null)}
          storageBucket="site-documents"
        />
      )}
    </>
  );
}
