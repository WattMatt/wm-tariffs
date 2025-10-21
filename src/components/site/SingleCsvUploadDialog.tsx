import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";

interface SingleCsvUploadDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  meterId: string;
  meterNumber: string;
  siteId: string;
  onUploadComplete?: () => void;
}

export default function SingleCsvUploadDialog({
  isOpen,
  onOpenChange,
  meterId,
  meterNumber,
  siteId,
  onUploadComplete,
}: SingleCsvUploadDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [separator, setSeparator] = useState<string>("tab");
  const [headerRowNumber, setHeaderRowNumber] = useState<string>("1");
  const [isUploading, setIsUploading] = useState(false);

  const generateFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.csv') && !file.name.toLowerCase().endsWith('.txt')) {
        toast.error("Please select a CSV or TXT file");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }

    setIsUploading(true);

    try {
      // Generate content hash
      const contentHash = await generateFileHash(selectedFile);

      // Check for duplicate
      const { data: existingFile } = await supabase
        .from("meter_csv_files")
        .select("id, file_name")
        .eq("site_id", siteId)
        .eq("content_hash", contentHash)
        .maybeSingle();

      if (existingFile) {
        toast.error(`This file has already been uploaded as ${existingFile.file_name}`);
        setIsUploading(false);
        return;
      }

      // Get site and client info for naming
      const { data: siteData } = await supabase
        .from("sites")
        .select("name, client_id, clients(code)")
        .eq("id", siteId)
        .single();

      const clientCode = siteData?.clients?.code || "UNKNOWN";
      const siteName = siteData?.name?.replace(/[^a-zA-Z0-9]/g, "_") || "SITE";

      // Get meter details
      const { data: meter } = await supabase
        .from("meters")
        .select("serial_number, meter_number")
        .eq("id", meterId)
        .single();

      const meterSerial =
        meter?.serial_number?.replace(/[^a-zA-Z0-9]/g, "_") ||
        meter?.meter_number?.replace(/[^a-zA-Z0-9]/g, "_") ||
        "METER";

      // Create readable filename
      const shortHash = contentHash.substring(0, 8);
      const fileName = `${clientCode}_${siteName}_${meterSerial}_${shortHash}.csv`;
      const filePath = `${siteId}/${meterId}/${fileName}`;

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from("meter-csvs")
        .upload(filePath, selectedFile, { upsert: false });

      if (uploadError) {
        if (uploadError.message.includes("already exists")) {
          toast.error("This file already exists");
        } else {
          throw uploadError;
        }
        setIsUploading(false);
        return;
      }

      // Track the file in database
      const { data: user } = await supabase.auth.getUser();
      const { error: trackError } = await supabase
        .from("meter_csv_files")
        .insert({
          site_id: siteId,
          meter_id: meterId,
          file_name: fileName,
          file_path: filePath,
          content_hash: contentHash,
          file_size: selectedFile.size,
          uploaded_by: user?.user?.id,
          parse_status: "uploaded",
          separator: separator,
          header_row_number: parseInt(headerRowNumber) || 1,
        });

      if (trackError) {
        throw new Error(`Failed to track file in database: ${trackError.message}`);
      }

      toast.success(`File uploaded successfully as ${fileName}`);
      setSelectedFile(null);
      onOpenChange(false);
      onUploadComplete?.();
    } catch (err: any) {
      console.error("Upload error:", err);
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      setSelectedFile(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload CSV File</DialogTitle>
          <DialogDescription>
            Upload a CSV file for meter: {meterNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Selection */}
          <div>
            <Label>Select CSV File</Label>
            <div className="mt-2">
              <Input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileSelect}
                disabled={isUploading}
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground mt-2">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
          </div>

          {/* File Interpretation Settings */}
          <div className="space-y-3 p-4 border rounded-md bg-muted/20">
            <div className="text-sm font-semibold">File Interpretation</div>
            
            <div>
              <Label>Column Separator</Label>
              <Select value={separator} onValueChange={setSeparator} disabled={isUploading}>
                <SelectTrigger className="bg-background mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tab">Tab</SelectItem>
                  <SelectItem value="comma">Comma (,)</SelectItem>
                  <SelectItem value="semicolon">Semicolon (;)</SelectItem>
                  <SelectItem value="space">Space</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Header Row Number</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={headerRowNumber}
                onChange={(e) => setHeaderRowNumber(e.target.value)}
                disabled={isUploading}
                className="bg-background mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Row number where column headers are located (1 = first row)
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
