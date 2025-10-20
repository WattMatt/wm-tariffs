import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Trash2, FileText } from "lucide-react";
import Papa from "papaparse";
import { Card, CardContent } from "@/components/ui/card";

interface BulkUploadDialogProps {
  siteId: string;
  onDataChange?: () => void;
}

interface FileMapping {
  file: File;
  meterId: string | null;
  status: "pending" | "uploading" | "success" | "error";
  readingsCount?: number;
  errorMessage?: string;
}

export default function BulkUploadDialog({ siteId, onDataChange }: BulkUploadDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [meters, setMeters] = useState<any[]>([]);
  const [fileMappings, setFileMappings] = useState<FileMapping[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleDialogOpen = async (open: boolean) => {
    setIsOpen(open);
    if (open) {
      // Fetch meters when dialog opens
      const { data, error } = await supabase
        .from("meters")
        .select("id, meter_number, serial_number, name, meter_type")
        .eq("site_id", siteId)
        .order("meter_number");

      if (!error && data) {
        setMeters(data);
      }
    } else {
      // Reset when closing
      setFileMappings([]);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newMappings: FileMapping[] = Array.from(files).map((file) => {
      // Try auto-matching
      const fileName = file.name.replace(/\.csv$/i, "");
      const numberMatch = fileName.match(/\d+/);
      const fileNumber = numberMatch ? numberMatch[0] : null;

      const matchedMeter = meters.find((m) => {
        const serial = m.serial_number?.toLowerCase() || "";
        const meterNum = m.meter_number?.toLowerCase() || "";
        const name = m.name?.toLowerCase() || "";
        const fileNameLower = fileName.toLowerCase();

        return (
          serial === fileNameLower ||
          meterNum === fileNameLower ||
          name === fileNameLower ||
          (fileNumber &&
            (serial.includes(fileNumber) ||
              meterNum.includes(fileNumber) ||
              serial === fileNumber ||
              meterNum === fileNumber))
        );
      });

      return {
        file,
        meterId: matchedMeter?.id || null,
        status: "pending" as const,
      };
    });

    setFileMappings((prev) => [...prev, ...newMappings]);
    event.target.value = "";
  };

  const updateMapping = (index: number, meterId: string) => {
    setFileMappings((prev) =>
      prev.map((mapping, i) => (i === index ? { ...mapping, meterId } : mapping))
    );
  };

  const removeMapping = (index: number) => {
    setFileMappings((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    const validMappings = fileMappings.filter((m) => m.meterId);
    if (validMappings.length === 0) {
      toast.error("Please assign meters to at least one file");
      return;
    }

    setIsUploading(true);

    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;

      for (let i = 0; i < validMappings.length; i++) {
        const mapping = validMappings[i];
        const meter = meters.find((m) => m.id === mapping.meterId);

        setFileMappings((prev) =>
          prev.map((m) => (m.file === mapping.file ? { ...m, status: "uploading" as const } : m))
        );

        try {
          // Upload CSV to storage
          const filePath = `${siteId}/${mapping.meterId}/${Date.now()}_${mapping.file.name}`;
          
          const { error: uploadError } = await supabase.storage
            .from('meter-csvs')
            .upload(filePath, mapping.file);

          if (uploadError) throw uploadError;

          // Call backend to process
          const { data, error: processError } = await supabase.functions.invoke(
            'process-meter-csv',
            {
              body: {
                meterId: mapping.meterId,
                filePath,
              },
            }
          );

          if (processError) throw processError;

          if (!data.success) {
            throw new Error(data.error || 'Processing failed');
          }

          setFileMappings((prev) =>
            prev.map((m) =>
              m.file === mapping.file
                ? {
                    ...m,
                    status: "success" as const,
                    readingsCount: data.readingsInserted,
                  }
                : m
            )
          );

          toast.success(
            `${meter?.meter_number}: ${data.readingsInserted} readings imported${
              data.duplicatesSkipped > 0 ? `, ${data.duplicatesSkipped} duplicates skipped` : ""
            }${data.parseErrors > 0 ? `, ${data.parseErrors} parse errors` : ""}`
          );
        } catch (err: any) {
          console.error("Upload error:", err);
          setFileMappings((prev) =>
            prev.map((m) =>
              m.file === mapping.file
                ? {
                    ...m,
                    status: "error" as const,
                    errorMessage: err.message,
                  }
                : m
            )
          );
          toast.error(`${meter?.meter_number}: ${err.message}`);
        }
      }

      const successCount = fileMappings.filter((m) => m.status === "success").length;
      toast.success(`Upload complete! ${successCount} files processed successfully`);
      onDataChange?.();
    } finally {
      setIsUploading(false);
    }
  };

  const getMeterLabel = (meter: any) => {
    return `${meter.meter_number}${meter.serial_number ? ` (${meter.serial_number})` : ""}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="w-4 h-4" />
          Bulk Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk CSV Upload</DialogTitle>
          <DialogDescription>
            Select CSV files and assign each to its corresponding meter
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <input
              type="file"
              accept=".csv"
              multiple
              onChange={handleFileSelect}
              disabled={isUploading}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
            />
          </div>

          {fileMappings.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm">File to Meter Mapping</h3>
              {fileMappings.map((mapping, index) => (
                <Card key={index} className="border-border/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{mapping.file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(mapping.file.size / 1024).toFixed(1)} KB
                        </p>
                      </div>

                      <Select
                        value={mapping.meterId || ""}
                        onValueChange={(value) => updateMapping(index, value)}
                        disabled={isUploading || mapping.status !== "pending"}
                      >
                        <SelectTrigger className="w-[250px]">
                          <SelectValue placeholder="Select meter..." />
                        </SelectTrigger>
                        <SelectContent>
                          {meters.map((meter) => (
                            <SelectItem key={meter.id} value={meter.id}>
                              {getMeterLabel(meter)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {mapping.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeMapping(index)}
                          disabled={isUploading}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}

                      {mapping.status === "uploading" && (
                        <span className="text-sm text-blue-600">Uploading...</span>
                      )}
                      {mapping.status === "success" && (
                        <span className="text-sm text-green-600">
                          ✓ {mapping.readingsCount} readings
                        </span>
                      )}
                      {mapping.status === "error" && (
                        <span className="text-sm text-destructive">✗ Failed</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <Button
              onClick={handleUpload}
              disabled={isUploading || fileMappings.filter((m) => m.meterId).length === 0}
              className="flex-1"
            >
              {isUploading ? "Uploading..." : `Upload ${fileMappings.filter((m) => m.meterId).length} Files`}
            </Button>
            <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isUploading}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
