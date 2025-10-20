import { useState, useEffect } from "react";
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
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Play, Download, Trash2, FileText, CheckCircle2, AlertCircle, Eye, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";

interface CsvBulkIngestionToolProps {
  siteId: string;
  onDataChange?: () => void;
}

interface CsvPreview {
  headers: string[];
  rows: string[][];
  detectedColumns: {
    dateColumn: number;
    timeColumn?: number;
    valueColumn: number;
    metadataColumns: number[];
  };
}

interface FileItem {
  file?: File;
  name: string;
  path?: string;
  meterId: string | null;
  meterNumber?: string;
  size?: number;
  status: "pending" | "uploaded" | "parsing" | "success" | "error";
  errorMessage?: string;
  readingsInserted?: number;
  duplicatesSkipped?: number;
  parseErrors?: number;
  isNew?: boolean;
  preview?: CsvPreview;
  metadataFieldNames?: Record<number, string>;
  contentHash?: string;
}

export default function CsvBulkIngestionTool({ siteId, onDataChange }: CsvBulkIngestionToolProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [meters, setMeters] = useState<any[]>([]);
  const [separator, setSeparator] = useState<string>("tab");
  const [dateFormat, setDateFormat] = useState<string>("auto");
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("upload");
  const [previewingFile, setPreviewingFile] = useState<FileItem | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      loadMeters().then(() => {
        loadSavedFiles();
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (activeTab === "parse" && meters.length > 0) {
      loadSavedFiles();
    }
  }, [activeTab, meters.length]);

  const loadMeters = async () => {
    const { data } = await supabase
      .from("meters")
      .select("id, meter_number, serial_number, name")
      .eq("site_id", siteId)
      .order("meter_number");
    
    if (data) {
      setMeters(data);
      return data;
    }
    return [];
  };

  const loadSavedFiles = async () => {
    try {
      const { data, error } = await supabase.storage
        .from('meter-csvs')
        .list(siteId, {
          limit: 1000,
          sortBy: { column: 'created_at', order: 'desc' }
        });

      if (error) throw error;

      const filesList: FileItem[] = [];
      
    if (data) {
      for (const folder of data) {
        if (folder.name && !folder.name.includes('.')) {
          const { data: meterFiles } = await supabase.storage
            .from('meter-csvs')
            .list(`${siteId}/${folder.name}`, {
              limit: 1000,
              sortBy: { column: 'created_at', order: 'desc' }
            });

          if (meterFiles) {
            const meter = meters.find(m => m.id === folder.name);
            meterFiles.forEach(file => {
              if (file.name.endsWith('.csv')) {
                filesList.push({
                  name: file.name,
                  path: `${siteId}/${folder.name}/${file.name}`,
                  meterId: folder.name,
                  meterNumber: meter?.meter_number,
                  size: file.metadata?.size,
                  status: "uploaded",
                  isNew: false
                });
              }
            });
          }
        }
      }
    }

      setFiles(prev => [...prev.filter(f => f.isNew), ...filesList]);
    } catch (err: any) {
      console.error("Failed to load files:", err);
    }
  };

  const generateFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const parseCsvPreview = async (file: File, sep: string): Promise<CsvPreview | null> => {
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim()).slice(0, 10); // First 10 lines
      
      const separatorChar = sep === "tab" ? "\t" : 
                           sep === "comma" ? "," : 
                           sep === "semicolon" ? ";" : 
                           sep === "space" ? " " : "\t";
      
      const rows = lines.map(line => {
        if (separatorChar === " ") {
          return line.split(/\s+/).filter(col => col.trim());
        }
        const escapedSep = separatorChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const splitRegex = new RegExp(escapedSep + '+');
        return line.split(splitRegex).filter(col => col.trim());
      });
      
      const headers = rows[0] || [];
      const dataRows = rows.slice(1);
      
      // Auto-detect columns
      const detectedColumns = {
        dateColumn: 0,
        timeColumn: headers.length > 2 ? 1 : undefined,
        valueColumn: headers.length > 2 ? 2 : 1,
        metadataColumns: Array.from({ length: Math.max(0, headers.length - 3) }, (_, i) => i + 3)
      };
      
      return { headers, rows: dataRows, detectedColumns };
    } catch (err) {
      console.error("Preview parse error:", err);
      return null;
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles) return;

    const newFiles: FileItem[] = [];
    const existingHashes = new Set(files.map(f => f.contentHash).filter(Boolean));

    for (const file of Array.from(selectedFiles)) {
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

      // Generate content hash
      const contentHash = await generateFileHash(file);
      const isDuplicate = existingHashes.has(contentHash);

      // Generate preview
      const preview = await parseCsvPreview(file, separator);

      // Skip duplicate files entirely
      if (!isDuplicate) {
        newFiles.push({
          file,
          name: file.name,
          meterId: matchedMeter?.id || null,
          meterNumber: matchedMeter?.meter_number,
          size: file.size,
          status: "pending",
          isNew: true,
          preview,
          metadataFieldNames: {},
          contentHash
        });
        existingHashes.add(contentHash);
      }
    }

    const duplicateCount = Array.from(selectedFiles).length - newFiles.length;
    if (duplicateCount > 0) {
      toast.warning(`${duplicateCount} duplicate file(s) detected and automatically removed`);
    }

    setFiles(prev => [...prev, ...newFiles]);
    event.target.value = "";
  };

  const updateFileMapping = (index: number, meterId: string) => {
    const meter = meters.find(m => m.id === meterId);
    setFiles(prev =>
      prev.map((f, i) => i === index ? { ...f, meterId, meterNumber: meter?.meter_number } : f)
    );
  };

  const updateMetadataFieldName = (fileIndex: number, columnIndex: number, fieldName: string) => {
    setFiles(prev =>
      prev.map((f, i) => 
        i === fileIndex 
          ? { 
              ...f, 
              metadataFieldNames: { 
                ...f.metadataFieldNames, 
                [columnIndex]: fieldName 
              } 
            } 
          : f
      )
    );
  };

  const handlePreviewFile = async (fileItem: FileItem) => {
    setPreviewingFile(fileItem);
    
    if (!fileItem.preview && fileItem.file) {
      setIsLoadingPreview(true);
      const preview = await parseCsvPreview(fileItem.file, separator);
      setFiles(prev =>
        prev.map(f => f.name === fileItem.name ? { ...f, preview } : f)
      );
      setIsLoadingPreview(false);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUploadAll = async () => {
    const pendingFiles = files.filter(f => f.status === "pending" && f.meterId && f.file);
    
    if (pendingFiles.length === 0) {
      toast.error("No files ready to upload");
      return;
    }

    setIsProcessing(true);

    // Get site and client info for naming
    const { data: siteData } = await supabase
      .from('sites')
      .select('name, client_id, clients(code)')
      .eq('id', siteId)
      .single();

    const clientCode = siteData?.clients?.code || 'UNKNOWN';
    const siteName = siteData?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'SITE';

    for (const fileItem of pendingFiles) {
      try {
        // Get meter details
        const meter = meters.find(m => m.id === fileItem.meterId);
        const meterSerial = meter?.serial_number?.replace(/[^a-zA-Z0-9]/g, '_') || 
                           meter?.meter_number?.replace(/[^a-zA-Z0-9]/g, '_') || 
                           'METER';
        
        // Create readable filename: ClientCode_SiteName_MeterSerial_ShortHash.csv
        const shortHash = fileItem.contentHash?.substring(0, 8) || Date.now().toString();
        const fileName = `${clientCode}_${siteName}_${meterSerial}_${shortHash}.csv`;
        const filePath = `${siteId}/${fileItem.meterId}/${fileName}`;
        
        // Check if file with same hash already exists and delete old duplicates
        const { data: existingFiles } = await supabase.storage
          .from('meter-csvs')
          .list(`${siteId}/${fileItem.meterId}`);

        const duplicateFiles = existingFiles?.filter(f => 
          f.name.includes(shortHash) || f.name.includes(fileItem.contentHash || '')
        ) || [];

        // Delete old duplicate files before uploading new one
        if (duplicateFiles.length > 0) {
          const pathsToDelete = duplicateFiles.map(f => `${siteId}/${fileItem.meterId}/${f.name}`);
          await supabase.storage
            .from('meter-csvs')
            .remove(pathsToDelete);
          toast.info(`${fileItem.meterNumber}: Removed ${duplicateFiles.length} old duplicate(s)`);
        }

        const { error: uploadError } = await supabase.storage
          .from('meter-csvs')
          .upload(filePath, fileItem.file!, { upsert: false });

        if (uploadError) {
          if (uploadError.message.includes('already exists')) {
            toast.info(`${fileItem.meterNumber}: Already exists, skipped`);
            continue;
          }
          throw uploadError;
        }

        setFiles(prev =>
          prev.map(f =>
            f.name === fileItem.name && f.isNew
              ? { ...f, status: "uploaded", path: filePath, isNew: false }
              : f
          )
        );

        toast.success(`${fileItem.meterNumber}: Uploaded as ${fileName}`);
      } catch (err: any) {
        setFiles(prev =>
          prev.map(f =>
            f.name === fileItem.name
              ? { ...f, status: "error", errorMessage: err.message }
              : f
          )
        );
        toast.error(`${fileItem.meterNumber}: Upload failed`);
      }
    }

    setIsProcessing(false);
    setActiveTab("parse");
  };

  const handleCleanupDuplicates = async () => {
    try {
      setIsProcessing(true);
      toast.info("Scanning for duplicate files...");

      const savedFiles = files.filter(f => f.path);
      const filesByHash: Record<string, { path: string; size: number }[]> = {};
      
      // Download each file and generate content hash
      for (const file of savedFiles) {
        try {
          const { data, error } = await supabase.storage
            .from('meter-csvs')
            .download(file.path!);

          if (error || !data) continue;

          // Generate hash from file content
          const buffer = await data.arrayBuffer();
          const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

          if (!filesByHash[contentHash]) filesByHash[contentHash] = [];
          filesByHash[contentHash].push({ 
            path: file.path!, 
            size: file.size || 0 
          });
        } catch (err) {
          console.error(`Failed to process ${file.path}:`, err);
        }
      }

      // Delete duplicates (keep first file of each hash group)
      let deletedCount = 0;
      for (const [hash, duplicates] of Object.entries(filesByHash)) {
        if (duplicates.length > 1) {
          // Sort by size (smaller first to keep the first uploaded)
          duplicates.sort((a, b) => a.size - b.size);
          
          // Delete all but the first
          for (let i = 1; i < duplicates.length; i++) {
            const { error } = await supabase.storage
              .from('meter-csvs')
              .remove([duplicates[i].path]);
            
            if (!error) {
              deletedCount++;
              console.log(`Deleted duplicate: ${duplicates[i].path}`);
            }
          }
        }
      }

      await loadSavedFiles();
      toast.success(`Cleaned up ${deletedCount} duplicate file(s)`);
    } catch (err: any) {
      console.error("Cleanup error:", err);
      toast.error("Cleanup failed: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleFileSelection = (filePath: string) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    const selectableFiles = files.filter(f => f.path);
    if (selectedFiles.size === selectableFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(selectableFiles.map(f => f.path!)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.size === 0) {
      toast.error("No files selected");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedFiles.size} selected file(s) from storage?\n\nNote: This will remove the CSV files but meter readings already parsed into the database will remain.`
    );

    if (!confirmed) return;

    try {
      setIsProcessing(true);
      const pathsToDelete = Array.from(selectedFiles);
      
      const { error } = await supabase.storage
        .from('meter-csvs')
        .remove(pathsToDelete);

      if (error) throw error;

      // Clear selection and reload files from storage
      setSelectedFiles(new Set());
      await loadSavedFiles();
      
      toast.success(`Deleted ${pathsToDelete.length} file(s) from storage and list`);
    } catch (err: any) {
      console.error("Bulk delete error:", err);
      toast.error("Bulk delete failed: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleParseAll = async () => {
    const uploadedFiles = files.filter(f => 
      (f.status === "uploaded" || f.status === "error") && f.path
    );
    
    if (uploadedFiles.length === 0) {
      toast.error("No files to parse");
      return;
    }

    setIsProcessing(true);

    for (const fileItem of uploadedFiles) {
      setFiles(prev =>
        prev.map(f => f.path === fileItem.path ? { ...f, status: "parsing" } : f)
      );

      try {
        const { data, error } = await supabase.functions.invoke('process-meter-csv', {
          body: {
            meterId: fileItem.meterId,
            filePath: fileItem.path,
            separator: separator === "tab" ? "\t" : 
                      separator === "comma" ? "," : 
                      separator === "semicolon" ? ";" : 
                      separator === "space" ? " " : "\t",
            dateFormat: dateFormat
          }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error);

        setFiles(prev =>
          prev.map(f =>
            f.path === fileItem.path
              ? {
                  ...f,
                  status: "success",
                  readingsInserted: data.readingsInserted,
                  duplicatesSkipped: data.duplicatesSkipped,
                  parseErrors: data.parseErrors
                }
              : f
          )
        );

        const totalProcessed = data.readingsInserted + data.duplicatesSkipped;
        const newPercent = totalProcessed > 0 ? ((data.readingsInserted / totalProcessed) * 100).toFixed(1) : "0";
        const existingPercent = totalProcessed > 0 ? ((data.duplicatesSkipped / totalProcessed) * 100).toFixed(1) : "0";

        toast.success(
          `${fileItem.meterNumber}: ✓ ${data.readingsInserted} new (${newPercent}%) | ${data.duplicatesSkipped} already in DB (${existingPercent}%)`,
          { duration: 6000 }
        );
      } catch (err: any) {
        setFiles(prev =>
          prev.map(f =>
            f.path === fileItem.path
              ? { ...f, status: "error", errorMessage: err.message }
              : f
          )
        );
        toast.error(`${fileItem.meterNumber}: Parse failed`);
      }
    }

    setIsProcessing(false);
    onDataChange?.();
  };

  const handleRetryParse = async (fileItem: FileItem) => {
    if (!fileItem.path) return;

    setIsProcessing(true);
    
    setFiles(prev =>
      prev.map(f => f.path === fileItem.path ? { ...f, status: "parsing" } : f)
    );

    try {
      const { data, error } = await supabase.functions.invoke('process-meter-csv', {
        body: {
          meterId: fileItem.meterId,
          filePath: fileItem.path,
          separator: separator === "tab" ? "\t" : 
                    separator === "comma" ? "," : 
                    separator === "semicolon" ? ";" : 
                    separator === "space" ? " " : "\t",
          dateFormat: dateFormat
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      setFiles(prev =>
        prev.map(f =>
          f.path === fileItem.path
            ? {
                ...f,
                status: "success",
                readingsInserted: data.readingsInserted,
                duplicatesSkipped: data.duplicatesSkipped,
                parseErrors: data.parseErrors
              }
            : f
        )
      );

      const totalProcessed = data.readingsInserted + data.duplicatesSkipped;
      const newPercent = totalProcessed > 0 ? ((data.readingsInserted / totalProcessed) * 100).toFixed(1) : "0";
      const existingPercent = totalProcessed > 0 ? ((data.duplicatesSkipped / totalProcessed) * 100).toFixed(1) : "0";

      toast.success(
        `${fileItem.meterNumber}: ✓ ${data.readingsInserted} new (${newPercent}%) | ${data.duplicatesSkipped} already in DB (${existingPercent}%)`,
        { duration: 6000 }
      );
    } catch (err: any) {
      setFiles(prev =>
        prev.map(f =>
          f.path === fileItem.path
            ? { ...f, status: "error", errorMessage: err.message }
            : f
        )
      );
      toast.error(`${fileItem.meterNumber}: Parse failed`);
    }

    setIsProcessing(false);
    onDataChange?.();
  };

  const handleDownload = async (fileItem: FileItem) => {
    if (!fileItem.path) return;

    try {
      const { data, error } = await supabase.storage
        .from('meter-csvs')
        .download(fileItem.path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileItem.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error("Download failed");
    }
  };

  const handleDeleteFile = async (fileItem: FileItem, index: number) => {
    if (!fileItem.path) {
      removeFile(index);
      toast.success("File removed from list");
      return;
    }

    const confirmed = window.confirm(
      `Delete "${fileItem.name}" from storage?\n\nNote: This will remove the CSV file but meter readings already parsed into the database will remain.`
    );

    if (!confirmed) return;

    try {
      setIsProcessing(true);

      // Delete from storage
      const { error } = await supabase.storage
        .from('meter-csvs')
        .remove([fileItem.path]);

      if (error) throw error;

      // Remove from local state and reload
      setFiles(prev => prev.filter((_, i) => i !== index));
      await loadSavedFiles();
      
      toast.success(`File deleted from storage: ${fileItem.name}`);
    } catch (err: any) {
      console.error("Delete error:", err);
      toast.error("Delete failed: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const getMeterLabel = (meter: any) => {
    return `${meter.meter_number}${meter.serial_number ? ` (${meter.serial_number})` : ""}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-destructive" />;
      case "parsing":
        return <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />;
      default:
        return <FileText className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="default" className="gap-2">
          <Upload className="w-4 h-4" />
          CSV Bulk Ingestion
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>CSV Bulk Ingestion Tool</DialogTitle>
          <DialogDescription>
            Upload multiple CSV files, preview and transform your data, and ingest with a single click
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload">1. Upload Files</TabsTrigger>
            <TabsTrigger value="parse">2. Parse & Ingest</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="flex-1 overflow-y-auto space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b">
              <div>
                <Label>Select CSV Files</Label>
                <input
                  type="file"
                  accept=".csv,.txt"
                  multiple
                  onChange={handleFileSelect}
                  disabled={isProcessing}
                  className="mt-1 block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
                />
              </div>
              <div>
                <Label>Column Separator (for preview)</Label>
                <Select value={separator} onValueChange={setSeparator}>
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
            </div>

            {files.filter(f => f.status === "pending").length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Upload className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Select one or more .csv or .txt files to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">
                    {files.filter(f => f.status === "pending").length} file(s) ready to upload
                  </h3>
                  <Button
                    onClick={handleUploadAll}
                    disabled={isProcessing || files.filter(f => f.status === "pending" && f.meterId).length === 0}
                  >
                    Upload All
                  </Button>
                </div>

                {files.filter(f => f.status === "pending").map((fileItem, index) => {
                  const actualIndex = files.indexOf(fileItem);
                  return (
                    <Collapsible key={actualIndex}>
                      <Card className="border-border/50">
                        <CardContent className="pt-4">
                          <div className="flex items-center gap-3">
                            {getStatusIcon(fileItem.status)}
                            
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{fileItem.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {fileItem.size ? `${(fileItem.size / 1024).toFixed(1)} KB` : 'Unknown size'}
                                {fileItem.preview && ` • ${fileItem.preview.headers.length} columns detected`}
                              </p>
                            </div>

                            <Select
                              value={fileItem.meterId || ""}
                              onValueChange={(value) => updateFileMapping(actualIndex, value)}
                              disabled={isProcessing}
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

                            <CollapsibleTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handlePreviewFile(fileItem)}
                              >
                                <Settings2 className="w-4 h-4" />
                              </Button>
                            </CollapsibleTrigger>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeFile(actualIndex)}
                              disabled={isProcessing}
                            >
                              <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardContent>
                      
                      <CollapsibleContent>
                        <CardContent className="pt-0 border-t">
                          {isLoadingPreview ? (
                            <div className="py-4 text-center text-sm text-muted-foreground">
                              Loading preview...
                            </div>
                          ) : fileItem.preview ? (
                            <div className="space-y-3 py-4">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <Eye className="w-4 h-4" />
                                Data Structure Preview
                              </div>
                              
                              <ScrollArea className="h-48 rounded-md border">
                                <div className="p-2">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b">
                                        {fileItem.preview.headers.map((header, idx) => (
                                          <th key={idx} className="px-2 py-1 text-left font-medium bg-muted/50">
                                            <div className="space-y-1">
                                              <div className="truncate max-w-[120px]">{header}</div>
                                              <Badge variant="outline" className="text-[10px] h-4">
                                                {idx === fileItem.preview!.detectedColumns.dateColumn ? "Date" :
                                                 idx === fileItem.preview!.detectedColumns.timeColumn ? "Time" :
                                                 idx === fileItem.preview!.detectedColumns.valueColumn ? "kWh" :
                                                 "Metadata"}
                                              </Badge>
                                            </div>
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {fileItem.preview.rows.slice(0, 5).map((row, rowIdx) => (
                                        <tr key={rowIdx} className="border-b">
                                          {row.map((cell, cellIdx) => (
                                            <td key={cellIdx} className="px-2 py-1 truncate max-w-[120px]">
                                              {cell}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </ScrollArea>
                              
                              {fileItem.preview.detectedColumns.metadataColumns.length > 0 && (
                                <div className="space-y-2">
                                  <Label className="text-xs">Metadata Field Names (optional - for reconciliation)</Label>
                                  <div className="grid grid-cols-2 gap-2">
                                    {fileItem.preview.detectedColumns.metadataColumns.map((colIdx) => (
                                      <div key={colIdx} className="space-y-1">
                                        <Label className="text-[10px] text-muted-foreground">
                                          Column {colIdx + 1}: {fileItem.preview!.headers[colIdx]}
                                        </Label>
                                        <Input
                                          placeholder="e.g., Active_Energy, Reactive_Power"
                                          value={fileItem.metadataFieldNames?.[colIdx] || ""}
                                          onChange={(e) => updateMetadataFieldName(actualIndex, colIdx, e.target.value)}
                                          className="h-7 text-xs"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground">
                                    These names will be used to identify fields during reconciliation
                                  </p>
                                </div>
                              )}
                              
                              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-2">
                                <p className="font-medium">What will be stored in database:</p>
                                <div className="space-y-1">
                                  <p className="text-muted-foreground font-medium">Core Fields:</p>
                                  <ul className="list-disc list-inside space-y-0.5 text-muted-foreground ml-2">
                                    <li>Date & Time → <code className="text-[10px] bg-background px-1 rounded">reading_timestamp</code></li>
                                    <li>kWh Value → <code className="text-[10px] bg-background px-1 rounded">kwh_value</code></li>
                                    <li>kVA Value → <code className="text-[10px] bg-background px-1 rounded">kva_value</code> (if present)</li>
                                  </ul>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-muted-foreground font-medium">Metadata (preserved for reconciliation):</p>
                                  <ul className="list-disc list-inside space-y-0.5 text-muted-foreground ml-2">
                                    <li>Source File → <code className="text-[10px] bg-background px-1 rounded">metadata.source_file</code></li>
                                    {fileItem.preview.detectedColumns.metadataColumns.length > 0 && (
                                      <>
                                        {fileItem.preview.detectedColumns.metadataColumns.map((colIdx) => (
                                          <li key={colIdx}>
                                            {fileItem.preview!.headers[colIdx] || `Column ${colIdx + 1}`} → 
                                            <code className="text-[10px] bg-background px-1 rounded ml-1">
                                              metadata.imported_fields.{fileItem.metadataFieldNames?.[colIdx] || fileItem.preview!.headers[colIdx] || `Column_${colIdx + 1}`}
                                            </code>
                                          </li>
                                        ))}
                                      </>
                                    )}
                                  </ul>
                                </div>
                                <p className="text-[10px] text-muted-foreground pt-1 border-t">
                                  ✓ All columns will be stored - nothing is excluded from the database
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="py-4 text-center text-sm text-muted-foreground">
                              No preview available
                            </div>
                          )}
                        </CardContent>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="parse" className="flex-1 overflow-y-auto space-y-4">
            <Card className="bg-muted/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings2 className="w-4 h-4" />
                  Parsing Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Column Separator</Label>
                    <Select value={separator} onValueChange={setSeparator} disabled={isProcessing}>
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
                    <Label>Date Format</Label>
                    <Select value={dateFormat} onValueChange={setDateFormat} disabled={isProcessing}>
                      <SelectTrigger className="bg-background mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto-detect</SelectItem>
                        <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="rounded-md bg-background p-3 text-xs text-muted-foreground">
                  <p className="font-medium mb-1">Metadata Preservation:</p>
                  <p>All columns beyond Date, Time, and kWh will be automatically captured as metadata fields and preserved for reconciliation analysis.</p>
                </div>
              </CardContent>
            </Card>

            {files.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>No files available. Upload files first.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedFiles.size > 0 && selectedFiles.size === files.filter(f => f.path).length}
                      onChange={toggleSelectAll}
                      disabled={isProcessing || files.filter(f => f.path).length === 0}
                      className="w-4 h-4 rounded border-input"
                    />
                    <h3 className="font-semibold text-sm">
                      All Files ({files.length} total)
                      {selectedFiles.size > 0 && ` • ${selectedFiles.size} selected`}
                    </h3>
                  </div>
                  <div className="flex gap-2">
                    {selectedFiles.size > 0 && (
                      <Button
                        onClick={handleBulkDelete}
                        disabled={isProcessing}
                        variant="destructive"
                        size="sm"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Selected ({selectedFiles.size})
                      </Button>
                    )}
                    <Button
                      onClick={handleParseAll}
                      disabled={isProcessing || files.filter(f => f.status === "uploaded" || f.status === "error").length === 0}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Parse All Ready Files
                    </Button>
                  </div>
                </div>

                {files.map((fileItem, index) => (
                  <Card key={index} className="border-border/50">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3">
                        {fileItem.path && (
                          <input
                            type="checkbox"
                            checked={selectedFiles.has(fileItem.path)}
                            onChange={() => toggleFileSelection(fileItem.path!)}
                            disabled={isProcessing}
                            className="w-4 h-4 rounded border-input"
                          />
                        )}
                        {getStatusIcon(fileItem.status)}
                        
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{fileItem.name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{fileItem.meterNumber || "No meter assigned"}</span>
                            {fileItem.size && <span>• {(fileItem.size / 1024).toFixed(1)} KB</span>}
                            {fileItem.preview && <span>• {fileItem.preview.headers.length} cols</span>}
                          </div>
                          {fileItem.errorMessage && (
                            <p className="text-xs text-destructive mt-1">{fileItem.errorMessage}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {fileItem.status === "pending" && (
                            <Badge variant="secondary">Ready to Upload</Badge>
                          )}
                          
                          {fileItem.status === "uploaded" && (
                            <Badge variant="outline">Ready to Parse</Badge>
                          )}
                          
                          {fileItem.status === "success" && (
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-green-600 border-green-600">
                                ✓ {fileItem.readingsInserted} new
                              </Badge>
                              {fileItem.duplicatesSkipped !== undefined && fileItem.duplicatesSkipped > 0 && (
                                <>
                                  <Badge variant="outline" className="text-muted-foreground border-muted-foreground text-xs">
                                    {fileItem.duplicatesSkipped} existing
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground">
                                    ({((fileItem.readingsInserted / (fileItem.readingsInserted + fileItem.duplicatesSkipped)) * 100).toFixed(0)}% new)
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                          
                          {fileItem.status === "error" && (
                            <Badge variant="outline" className="text-destructive border-destructive">
                              Failed
                            </Badge>
                          )}

                          {fileItem.status === "parsing" && (
                            <Badge variant="outline">Parsing...</Badge>
                          )}

                          {(fileItem.status === "error" || fileItem.status === "uploaded") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRetryParse(fileItem)}
                              disabled={isProcessing}
                              title="Parse this file"
                            >
                              <Play className="w-4 h-4" />
                            </Button>
                          )}

                          {fileItem.path && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownload(fileItem)}
                              title="Download file"
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteFile(fileItem, index)}
                            disabled={isProcessing}
                            title="Delete file"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
