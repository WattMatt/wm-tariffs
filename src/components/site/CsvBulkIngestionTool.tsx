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
import { Upload, Play, Download, Trash2, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface CsvBulkIngestionToolProps {
  siteId: string;
  onDataChange?: () => void;
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
}

export default function CsvBulkIngestionTool({ siteId, onDataChange }: CsvBulkIngestionToolProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [meters, setMeters] = useState<any[]>([]);
  const [separator, setSeparator] = useState<string>("tab");
  const [dateFormat, setDateFormat] = useState<string>("auto");
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("upload");

  useEffect(() => {
    if (isOpen) {
      loadMeters();
      loadSavedFiles();
    }
  }, [isOpen]);

  useEffect(() => {
    if (activeTab === "parse") {
      loadSavedFiles();
    }
  }, [activeTab]);

  const loadMeters = async () => {
    const { data } = await supabase
      .from("meters")
      .select("id, meter_number, serial_number, name")
      .eq("site_id", siteId)
      .order("meter_number");
    
    if (data) setMeters(data);
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
          if (folder.id) {
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

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles) return;

    const newFiles: FileItem[] = Array.from(selectedFiles).map((file) => {
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
        name: file.name,
        meterId: matchedMeter?.id || null,
        meterNumber: matchedMeter?.meter_number,
        size: file.size,
        status: "pending" as const,
        isNew: true
      };
    });

    setFiles(prev => [...prev, ...newFiles]);
    event.target.value = "";
  };

  const updateFileMapping = (index: number, meterId: string) => {
    const meter = meters.find(m => m.id === meterId);
    setFiles(prev =>
      prev.map((f, i) => i === index ? { ...f, meterId, meterNumber: meter?.meter_number } : f)
    );
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

    for (const fileItem of pendingFiles) {
      try {
        const filePath = `${siteId}/${fileItem.meterId}/${Date.now()}_${fileItem.name}`;
        
        const { error: uploadError } = await supabase.storage
          .from('meter-csvs')
          .upload(filePath, fileItem.file!);

        if (uploadError) throw uploadError;

        setFiles(prev =>
          prev.map(f =>
            f.name === fileItem.name && f.isNew
              ? { ...f, status: "uploaded", path: filePath, isNew: false }
              : f
          )
        );

        toast.success(`${fileItem.meterNumber}: Uploaded`);
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

        toast.success(
          `${fileItem.meterNumber}: ${data.readingsInserted} readings imported`
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

      toast.success(
        `${fileItem.meterNumber}: ${data.readingsInserted} readings imported`
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
      return;
    }

    try {
      const { error } = await supabase.storage
        .from('meter-csvs')
        .remove([fileItem.path]);

      if (error) throw error;

      setFiles(prev => prev.filter((_, i) => i !== index));
      toast.success("File deleted");
    } catch (err: any) {
      toast.error("Delete failed");
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
                    <Card key={actualIndex} className="border-border/50">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(fileItem.status)}
                          
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{fileItem.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {fileItem.size ? `${(fileItem.size / 1024).toFixed(1)} KB` : 'Unknown size'}
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
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="parse" className="flex-1 overflow-y-auto space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b">
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

            {files.filter(f => f.status !== "pending").length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>No uploaded files yet. Upload files first.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">
                    {files.filter(f => f.status === "uploaded" || f.status === "error").length} file(s) ready to parse
                  </h3>
                  <Button
                    onClick={handleParseAll}
                    disabled={isProcessing || files.filter(f => f.status === "uploaded" || f.status === "error").length === 0}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Parse All
                  </Button>
                </div>

                {files.filter(f => f.status !== "pending").map((fileItem, index) => {
                  const actualIndex = files.indexOf(fileItem);
                  return (
                    <Card key={actualIndex} className="border-border/50">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(fileItem.status)}
                          
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{fileItem.name}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{fileItem.meterNumber}</span>
                              {fileItem.size && <span>• {(fileItem.size / 1024).toFixed(1)} KB</span>}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {fileItem.status === "success" && (
                              <Badge variant="outline" className="text-green-600 border-green-600">
                                {fileItem.readingsInserted} imported
                              </Badge>
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
                              >
                                <Play className="w-4 h-4" />
                              </Button>
                            )}

                            {fileItem.path && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDownload(fileItem)}
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteFile(fileItem, actualIndex)}
                              disabled={isProcessing}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
