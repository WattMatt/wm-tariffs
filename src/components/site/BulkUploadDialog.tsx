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
      for (let i = 0; i < validMappings.length; i++) {
        const mapping = validMappings[i];
        const meter = meters.find((m) => m.id === mapping.meterId);

        // Update status
        setFileMappings((prev) =>
          prev.map((m) => (m.file === mapping.file ? { ...m, status: "uploading" as const } : m))
        );

        try {
          // Parse CSV
          const csvText = await mapping.file.text();
          const parsed = Papa.parse(csvText, {
            header: false,
            skipEmptyLines: true,
            dynamicTyping: false,
          });

          const rows = parsed.data as string[][];

          // Get existing timestamps
          const { data: existingReadings } = await supabase
            .from("meter_readings")
            .select("reading_timestamp")
            .eq("meter_id", mapping.meterId);

          const existingTimestamps = new Set(
            existingReadings?.map((r) => new Date(r.reading_timestamp).toISOString()) || []
          );

          // Process rows
          const readings: any[] = [];
          let skipped = 0;
          let parseErrors = 0;

          for (const row of rows) {
            if (row.length < 3) continue;

            try {
              const dateStr = row[0]?.trim();
              const timeStr = row[1]?.trim();
              const valueStr = row[2]?.trim()?.replace(",", ".");

              if (!dateStr || !timeStr || !valueStr) continue;

              const timestamp = `${dateStr} ${timeStr}`;
              const date = new Date(timestamp);
              if (isNaN(date.getTime())) {
                parseErrors++;
                continue;
              }

              const value = parseFloat(valueStr);
              if (isNaN(value)) {
                parseErrors++;
                continue;
              }

              const isoTimestamp = date.toISOString();

              if (existingTimestamps.has(isoTimestamp)) {
                skipped++;
                continue;
              }

              readings.push({
                meter_id: mapping.meterId,
                reading_timestamp: isoTimestamp,
                kwh_value: value,
                uploaded_by: (await supabase.auth.getUser()).data.user?.id,
              });
            } catch (err) {
              console.error("Row parse error:", err);
              parseErrors++;
            }
          }

          console.log(`${mapping.file.name}: ${rows.length} rows, ${readings.length} valid, ${skipped} duplicates, ${parseErrors} parse errors`);

          // Insert in batches
          if (readings.length > 0) {
            const batchSize = 1000;
            for (let j = 0; j < readings.length; j += batchSize) {
              const batch = readings.slice(j, j + batchSize);
              const { error: insertError } = await supabase.from("meter_readings").insert(batch);

              if (insertError) throw insertError;
            }
          }

          // Update success
          setFileMappings((prev) =>
            prev.map((m) =>
              m.file === mapping.file
                ? {
                    ...m,
                    status: "success" as const,
                    readingsCount: readings.length,
                  }
                : m
            )
          );

          toast.success(
            `${meter?.meter_number}: ${readings.length} readings imported${
              skipped > 0 ? `, ${skipped} duplicates skipped` : ""
            }${parseErrors > 0 ? `, ${parseErrors} parse errors` : ""}`
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
          toast.error(`${meter?.meter_number}: Upload failed - ${err.message}`);
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
