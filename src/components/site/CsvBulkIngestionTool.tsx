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
import { Upload, Play, Download, Trash2, FileText, CheckCircle2, AlertCircle, Eye, Settings2, Database, Loader2, Search, Check, ChevronsUpDown } from "lucide-react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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

interface ColumnMapping {
  dateColumn: number | string; // string for split columns like "0_split_1"
  timeColumn: number | string;
  valueColumn: number | string;
  kvaColumn: number | string;
  dateFormat: string;
  timeFormat: string;
  dateTimeFormat?: string; // Format for combined datetime columns
  renamedHeaders?: Record<string, string>; // key can be "0_split_1" for split columns
  splitColumns?: Record<number, { 
    separator: string; 
    parts: Array<{ name: string; columnId: string }> 
  }>;
  columnDataTypes?: Record<string, 'datetime' | 'float' | 'int' | 'string'>; // data type for each column
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
  const [dateTimeFormat, setDateTimeFormat] = useState<string>("YYYY-MM-DD HH:mm:ss");
  const [timeInterval, setTimeInterval] = useState<string>("30");
  const [headerRowNumber, setHeaderRowNumber] = useState<string>("1");
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewData, setPreviewData] = useState<{ rows: string[][], headers: string[] } | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    dateColumn: "0",
    timeColumn: "1",
    valueColumn: "2",
    kvaColumn: "-1",
    dateFormat: "auto",
    timeFormat: "auto",
    dateTimeFormat: "YYYY-MM-DD HH:mm:ss",
    renamedHeaders: {},
    splitColumns: {},
    columnDataTypes: {}
  });
  const [editingHeader, setEditingHeader] = useState<{id: string, value: string} | null>(null);
  const [splitPreview, setSplitPreview] = useState<{index: number, parts: string[]} | null>(null);
  const [tempColumnState, setTempColumnState] = useState<{
    columnIdx: number;
    newName: string;
    splitSeparator: string;
    splitParts: Array<{ name: string; columnId: string }>;
    assignedType: 'date' | 'time' | 'value' | 'kva' | 'none';
    dataType: 'datetime' | 'float' | 'int' | 'string';
  } | null>(null);
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  
  // Get all available columns including split parts
  const getAvailableColumns = () => {
    if (!previewData) return [];
    
    const columns: Array<{ id: string; name: string; isSplit: boolean }> = [];
    
    previewData.headers.forEach((header, idx) => {
      const splitConfig = columnMapping.splitColumns?.[idx];
      
      if (splitConfig) {
        // Add each split part as a separate column
        splitConfig.parts.forEach((part) => {
          columns.push({
            id: part.columnId,
            name: part.name || `${header} (Part ${part.columnId.split('_')[2]})`,
            isSplit: true
          });
        });
      } else {
        // Regular column
        const displayName = columnMapping.renamedHeaders?.[idx] || header || `Col ${idx + 1}`;
        columns.push({
          id: idx.toString(),
          name: displayName,
          isSplit: false
        });
      }
    });
    
    return columns;
  };
  const [activeTab, setActiveTab] = useState<string>("upload");
  const [previewingFile, setPreviewingFile] = useState<FileItem | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Load fresh data from database whenever dialog opens or tab changes
  useEffect(() => {
    if (isOpen) {
      loadMeters();
      loadSavedFiles(); // Always load from database to reflect current state
      
      // Set up realtime subscription for live updates
      const channel = supabase
        .channel('meter-csv-files-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'meter_csv_files',
            filter: `site_id=eq.${siteId}`
          },
          (payload) => {
            console.log('CSV file changed:', payload);
            loadSavedFiles(); // Reload when files change
          }
        )
        .subscribe();
      
      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [isOpen, activeTab, siteId]); // Refresh when dialog opens or tab changes

  // Regenerate previews when separator changes
  useEffect(() => {
    const regeneratePreviews = async () => {
      const pendingFiles = files.filter(f => f.status === "pending" && f.file);
      
      if (pendingFiles.length === 0) return;
      
      const updatedFiles = await Promise.all(
        files.map(async (fileItem) => {
          if (fileItem.status === "pending" && fileItem.file) {
            const preview = await parseCsvPreview(fileItem.file, separator);
            return { ...fileItem, preview };
          }
          return fileItem;
        })
      );
      
      setFiles(updatedFiles);
    };
    
    regeneratePreviews();
  }, [separator]);

  const loadMeters = async () => {
    console.log('Loading meters for site:', siteId);
    const { data, error } = await supabase
      .from("meters")
      .select("id, meter_number, serial_number, name")
      .eq("site_id", siteId)
      .order("meter_number");
    
    if (error) {
      console.error('Error loading meters:', error);
      toast.error('Failed to load meters');
      return [];
    }
    
    if (data) {
      console.log(`Loaded ${data.length} meters:`, data.slice(0, 3));
      setMeters(data);
      return data;
    }
    return [];
  };

  const loadSavedFiles = async () => {
    try {
      console.log('Loading saved files from database for site:', siteId);
      
      const { data: files, error } = await supabase
        .from('meter_csv_files')
        .select(`
          *,
          meters(meter_number)
        `)
        .eq('site_id', siteId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      console.log(`Found ${files?.length || 0} files in database`);

      const filesList: FileItem[] = (files || []).map(file => ({
        name: file.file_name,
        path: file.file_path,
        meterId: file.meter_id,
        meterNumber: file.meters?.meter_number || 'Unknown',
        size: file.file_size,
        status: file.parse_status === 'success' ? 'success' : 
                file.parse_status === 'error' ? 'error' : 
                file.parse_status === 'parsing' ? 'parsing' : 'uploaded',
        isNew: false,
        readingsInserted: file.readings_inserted || 0,
        duplicatesSkipped: file.duplicates_skipped || 0,
        parseErrors: file.parse_errors || 0,
        errorMessage: file.error_message,
        contentHash: file.content_hash
      }));

      setFiles(filesList);
    } catch (err: any) {
      console.error("Failed to load files:", err);
      toast.error("Failed to load files");
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
          // For space separator, collapse multiple spaces but keep structure
          return line.split(/\s+/);
        }
        // Split by single separator to preserve empty columns
        return line.split(separatorChar);
      });
      
      // Detect if first row is metadata by checking column count consistency
      // If first row has significantly fewer columns than second row, skip it
      let headers = rows[0] || [];
      let dataRows = rows.slice(1);
      
      if (rows.length > 1 && rows[0].length < rows[1].length * 0.5) {
        console.log('Detected metadata row, skipping first row');
        console.log('Row 1 columns:', rows[0].length, rows[0]);
        console.log('Row 2 columns:', rows[1].length, rows[1]);
        headers = rows[1];
        dataRows = rows.slice(2);
      }
      
      console.log(`CSV Preview - Headers (${headers.length} columns):`, headers);
      console.log(`CSV Preview - First data row (${dataRows[0]?.length || 0} columns):`, dataRows[0]);
      
      // Auto-detect columns - look for Date/Time columns
      let dateColumn = headers.findIndex(h => h.toLowerCase().includes('date'));
      if (dateColumn === -1) dateColumn = 0;
      
      let timeColumn = headers.findIndex(h => h.toLowerCase().includes('time'));
      if (timeColumn === dateColumn) timeColumn = -1;
      
      // Look for kWh value column
      let valueColumn = headers.findIndex(h => 
        h.toLowerCase().includes('kwh') || h.toLowerCase().includes('p1')
      );
      if (valueColumn === -1) valueColumn = timeColumn !== -1 ? 2 : 1;
      
      // All other columns are metadata
      const metadataColumns = headers
        .map((_, idx) => idx)
        .filter(idx => idx !== dateColumn && idx !== timeColumn && idx !== valueColumn);
      
      const detectedColumns = {
        dateColumn,
        timeColumn: timeColumn !== -1 ? timeColumn : undefined,
        valueColumn,
        metadataColumns
      };
      
      console.log('Detected columns:', detectedColumns);
      
      return { headers, rows: dataRows, detectedColumns };
    } catch (err) {
      console.error("Preview parse error:", err);
      return null;
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles) return;

    // Ensure meters are loaded
    if (meters.length === 0) {
      console.warn('Meters not loaded yet, loading now...');
      await loadMeters();
    }

    console.log(`Processing ${selectedFiles.length} files with ${meters.length} meters available`);

    const newFiles: FileItem[] = [];
    // Only check duplicates against valid files (exclude error status and missing files)
    const existingHashes = new Set(
      files
        .filter(f => f.status !== 'error' && f.contentHash)
        .map(f => f.contentHash!)
    );

    for (const file of Array.from(selectedFiles)) {
      const fileName = file.name.replace(/\.csv$/i, "");
      const numberMatch = fileName.match(/\d+/);
      const fileNumber = numberMatch ? numberMatch[0] : null;

      console.log(`Matching file: ${file.name}, extracted number: ${fileNumber}`);

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

      if (matchedMeter) {
        console.log(`✓ Matched ${file.name} to meter ${matchedMeter.meter_number}`);
      } else {
        console.warn(`✗ No match found for ${file.name}`);
      }

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
      toast.warning(`${duplicateCount} duplicate file(s) detected and skipped`);
    }

    if (newFiles.length > 0) {
      setFiles(prev => [...prev, ...newFiles]);
      toast.success(`Added ${newFiles.length} new file(s) for upload`);
    }
    
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
        
        // Check if file with this hash already exists in database
        const { data: existingFile } = await supabase
          .from('meter_csv_files')
          .select('id, file_name')
          .eq('site_id', siteId)
          .eq('content_hash', fileItem.contentHash!)
          .maybeSingle();

        if (existingFile) {
          toast.info(`${fileItem.meterNumber}: Duplicate detected (${existingFile.file_name}), skipped`);
          continue;
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

        // Track the file in database immediately
        const { data: user } = await supabase.auth.getUser();
        const { error: trackError } = await supabase
          .from('meter_csv_files')
          .insert({
            site_id: siteId,
            meter_id: fileItem.meterId,
            file_name: fileName,
            file_path: filePath,
            content_hash: fileItem.contentHash!,
            file_size: fileItem.size,
            uploaded_by: user?.user?.id,
            parse_status: 'uploaded'
          });

        if (trackError) {
          console.error('Failed to track file:', trackError);
          throw new Error(`Failed to track file in database: ${trackError.message}`);
        }

        console.log(`✓ Successfully uploaded and tracked: ${fileName}`);

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
    
    // Reload files to show in parse tab
    await loadSavedFiles();
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

  const handleCleanupOrphans = async () => {
    const confirmed = window.confirm(
      `Delete all CSV files where the meter no longer exists?\n\nThis will scan all storage files and remove any that belong to deleted meters.`
    );
    if (!confirmed) return;

    try {
      setIsProcessing(true);
      toast.info("Scanning for orphaned files...");

      // Get tracked files where meter no longer exists
      const { data: orphanedFiles, error } = await supabase
        .from('meter_csv_files')
        .select('file_path, meter_id, meters!inner(id)')
        .eq('site_id', siteId)
        .is('meters.id', null);

      if (error) throw error;

      if (!orphanedFiles || orphanedFiles.length === 0) {
        toast.info("No orphaned files found");
        return;
      }

      const pathsToDelete = orphanedFiles.map(f => f.file_path);

      // Delete using edge function
      const { data, error: deleteError } = await supabase.functions.invoke('delete-meter-csvs', {
        body: { filePaths: pathsToDelete }
      });

      if (deleteError) throw deleteError;
      if (!data.success) throw new Error(data.error || 'Deletion failed');

      // Remove from tracking table
      await supabase
        .from('meter_csv_files')
        .delete()
        .in('file_path', pathsToDelete);

      await loadSavedFiles();
      toast.success(`✓ Deleted ${data.deletedCount} orphaned file(s)`);
    } catch (err: any) {
      console.error("Orphan cleanup error:", err);
      toast.error("Orphan cleanup failed: " + err.message);
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
      
      toast.info(`Deleting ${pathsToDelete.length} file(s)...`);
      
      // Use edge function with service role for guaranteed deletion
      const { data, error } = await supabase.functions.invoke('delete-meter-csvs', {
        body: { filePaths: pathsToDelete }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Deletion failed');

      // Remove from tracking table
      await supabase
        .from('meter_csv_files')
        .delete()
        .in('file_path', pathsToDelete);

      // Clear selection and reload files from storage
      setSelectedFiles(new Set());
      await loadSavedFiles();
      
      toast.success(`✓ Successfully deleted ${data.deletedCount} file(s) from storage`);
    } catch (err: any) {
      console.error("Bulk delete error:", err);
      toast.error("Bulk delete failed: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const loadFilePreview = async (fileItem: FileItem) => {
    if (!fileItem.path) return;
    
    try {
      setPreviewFile(fileItem);
      
      // Download file from storage
      const { data: fileData, error } = await supabase.storage
        .from('meter-csvs')
        .download(fileItem.path);
      
      if (error || !fileData) {
        toast.error("Failed to load file preview");
        return;
      }
      
      const text = await fileData.text();
      const lines = text.split('\n').filter(l => l.trim()).slice(0, 20); // First 20 lines
      
      const separatorChar = separator === "tab" ? "\t" : 
                           separator === "comma" ? "," : 
                           separator === "semicolon" ? ";" : 
                           separator === "space" ? " " : "\t";
      
      const rows = lines.map(line => {
        if (separatorChar === " ") {
          return line.split(/\s+/);
        }
        return line.split(separatorChar);
      });
      
      // Extract headers based on header row number
      const headerRow = parseInt(headerRowNumber);
      const headers = headerRow > 0 && headerRow <= rows.length 
        ? rows[headerRow - 1] 
        : rows[0].map((_, idx) => `Column ${idx + 1}`);
      
      // Data rows start after header
      const dataRows = headerRow > 0 ? rows.slice(headerRow) : rows;
      
      setPreviewData({ rows: dataRows, headers });
      
      // Auto-detect columns - always run on preview load to refresh mapping
      const dateColIdx = headers.findIndex(h => 
        h.toLowerCase().includes('date') || 
        h.toLowerCase().includes('datum') ||
        h.toLowerCase().includes('time')
      );
      const valueColIdx = headers.findIndex(h => {
        const lower = h.toLowerCase();
        return lower.includes('kwh') || 
               lower.includes('p1') || 
               lower.includes('energy') || 
               lower.includes('active') ||
               lower.includes('wh') ||
               (lower.includes('p') && lower.includes('(kwh)'));
      });
      const kvaColIdx = headers.findIndex(h => {
        const lower = h.toLowerCase();
        return lower.includes('kva') || 
               lower.includes('s (kva)') || 
               lower.includes('apparent') ||
               (lower.includes('s') && lower.includes('(kva)'));
      });
      
      // Initialize with detected values, but all columns are available
      const initialHeaders: Record<string, string> = {};
      headers.forEach((header, idx) => {
        initialHeaders[idx] = header;
      });
      
      setColumnMapping({
        dateColumn: dateColIdx >= 0 ? dateColIdx.toString() : "-1",
        timeColumn: "-1", // No separate time column by default if date contains timestamp
        valueColumn: valueColIdx >= 0 ? valueColIdx.toString() : "-1",
        kvaColumn: kvaColIdx >= 0 ? kvaColIdx.toString() : "-1",
        dateFormat: columnMapping.dateFormat,
        timeFormat: columnMapping.timeFormat,
        dateTimeFormat: dateTimeFormat,
        renamedHeaders: initialHeaders,
        splitColumns: {},
        columnDataTypes: {}
      });
    } catch (err: any) {
      console.error("Preview error:", err);
      toast.error("Failed to load preview");
    }
  };

  // Refresh preview when settings change
  useEffect(() => {
    if (previewFile) {
      loadFilePreview(previewFile);
    }
  }, [separator, headerRowNumber]);

  const handleClearDatabase = async () => {
    setIsClearing(true);
    try {
      toast.info("Clearing all data - this may take a few minutes...", { duration: 10000 });
      
      // Step 1: List ALL files in storage for this site (recursively through meter folders)
      const { data: meterFolders, error: listError } = await supabase.storage
        .from('meter-csvs')
        .list(siteId);

      let deletedFilesCount = 0;
      const allFilePaths: string[] = [];

      // Step 2: For each meter folder, list all CSV files
      if (meterFolders && meterFolders.length > 0) {
        for (const folder of meterFolders) {
          const { data: files } = await supabase.storage
            .from('meter-csvs')
            .list(`${siteId}/${folder.name}`);
          
          if (files) {
            allFilePaths.push(...files.map(f => `${siteId}/${folder.name}/${f.name}`));
          }
        }
      }

      // Step 3: Delete files from storage if any exist
      if (allFilePaths.length > 0) {
        const { data: deleteData, error: deleteError } = await supabase.functions.invoke('delete-meter-csvs', {
          body: { filePaths: allFilePaths }
        });

        if (deleteError) {
          console.error("Error deleting files:", deleteError);
          toast.warning("Some files may not have been deleted from storage");
        } else if (deleteData?.success) {
          deletedFilesCount = deleteData.deletedCount || 0;
        }
      }

      // Step 4: Delete from tracking table
      await supabase
        .from('meter_csv_files')
        .delete()
        .eq('site_id', siteId);

      // Step 4: Delete all meter readings
      const { data, error } = await supabase.rpc('delete_site_readings', {
        p_site_id: siteId
      });

      if (error) throw error;

      // Extract the count - RPC returns array of objects with total_deleted column
      const totalDeleted = Array.isArray(data) && data.length > 0 ? data[0].total_deleted : 0;
      
      // Clear local state completely
      setFiles([]);
      
      toast.success(
        `Complete clear: ${totalDeleted.toLocaleString()} readings deleted, ${deletedFilesCount} CSV file(s) removed`,
        { duration: 5000 }
      );
      
      setShowClearConfirm(false);
      setTimeout(() => onDataChange?.(), 1000);
    } catch (error: any) {
      console.error("Error clearing data:", error);
      toast.error(`Failed to clear data: ${error.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  const handleParseAll = async (forceParse: boolean = false) => {
    // Parse files that haven't been successfully parsed, OR force re-parse all
    const filesToParse = forceParse 
      ? files.filter(f => f.path) // Force: parse ALL files
      : files.filter(f => (f.status === "uploaded" || f.status === "error") && f.path); // Normal: only unparsed
    
    if (filesToParse.length === 0) {
      toast.error("No files available to parse");
      return;
    }

    const message = forceParse
      ? `⚠️ FORCE RE-PARSE ${filesToParse.length} file(s)?\n\nThis will re-process ALL files, including previously parsed ones.\nExisting readings may be duplicated.`
      : `Parse ${filesToParse.length} pending/failed file(s)?`;
    
    if (!window.confirm(message)) return;

    setIsProcessing(true);

    for (const fileItem of filesToParse) {
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
          dateFormat: columnMapping.dateFormat,
          timeInterval: parseInt(timeInterval),
          headerRowNumber: parseInt(headerRowNumber),
          columnMapping: columnMapping
        }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error);

        // Validation: Don't mark as success if ZERO readings were inserted
        const totalProcessed = data.readingsInserted + data.duplicatesSkipped;
        const hasValidData = totalProcessed > 0;

        setFiles(prev =>
          prev.map(f =>
            f.path === fileItem.path
              ? {
                  ...f,
                  status: hasValidData ? "success" : "error",
                  errorMessage: hasValidData ? undefined : "No valid data found - check column mapping and date/time formats",
                  readingsInserted: data.readingsInserted,
                  duplicatesSkipped: data.duplicatesSkipped,
                  parseErrors: data.parseErrors
                }
              : f
          )
        );

        if (!hasValidData) {
          toast.error(
            `${fileItem.meterNumber}: ⚠️ Parse completed but NO DATA was extracted. Check your column mappings and formats.`,
            { duration: 10000 }
          );
        } else {
          const newPercent = ((data.readingsInserted / totalProcessed) * 100).toFixed(1);
          const existingPercent = ((data.duplicatesSkipped / totalProcessed) * 100).toFixed(1);
          
          toast.success(
            `${fileItem.meterNumber}: ✓ ${data.readingsInserted} new (${newPercent}%) | ${data.duplicatesSkipped} already in DB (${existingPercent}%)`,
            { duration: 6000 }
          );
        }
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
            dateFormat: columnMapping.dateFormat,
            timeInterval: parseInt(timeInterval),
            headerRowNumber: parseInt(headerRowNumber),
            columnMapping: columnMapping
          }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      // Validation: Don't mark as success if ZERO readings were inserted
      const totalProcessed = data.readingsInserted + data.duplicatesSkipped;
      const hasValidData = totalProcessed > 0;

      setFiles(prev =>
        prev.map(f =>
          f.path === fileItem.path
            ? {
                ...f,
                status: hasValidData ? "success" : "error",
                errorMessage: hasValidData ? undefined : "No valid data found - check column mapping and date/time formats",
                readingsInserted: data.readingsInserted,
                duplicatesSkipped: data.duplicatesSkipped,
                parseErrors: data.parseErrors
              }
            : f
        )
      );

      if (!hasValidData) {
        toast.error(
          `${fileItem.meterNumber}: ⚠️ Parse completed but NO DATA was extracted. Check your column mappings and formats.`,
          { duration: 10000 }
        );
      } else {
        const newPercent = ((data.readingsInserted / totalProcessed) * 100).toFixed(1);
        const existingPercent = ((data.duplicatesSkipped / totalProcessed) * 100).toFixed(1);
        
        toast.success(
          `${fileItem.meterNumber}: ✓ ${data.readingsInserted} new (${newPercent}%) | ${data.duplicatesSkipped} already in DB (${existingPercent}%)`,
          { duration: 6000 }
        );
      }
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

      // Use edge function with service role for guaranteed deletion
      const { data, error } = await supabase.functions.invoke('delete-meter-csvs', {
        body: { filePaths: [fileItem.path] }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Deletion failed');

      // Remove from tracking table
      await supabase
        .from('meter_csv_files')
        .delete()
        .eq('file_path', fileItem.path);

      // Remove from local state and reload
      setFiles(prev => prev.filter((_, i) => i !== index));
      await loadSavedFiles();
      
      toast.success(`✓ File deleted from storage: ${fileItem.name}`);
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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload">1. Upload Files</TabsTrigger>
            <TabsTrigger value="parse">2. Parse & Ingest</TabsTrigger>
            <TabsTrigger value="clear">3. Clear Database</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="flex-1 overflow-y-auto space-y-4">
            <div className="pb-4 border-b">
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

            <div className="space-y-4">
              {files.filter(f => !f.isNew && f.path).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-muted-foreground">
                      Already in Storage ({files.filter(f => !f.isNew && f.path).length} files)
                    </h3>
                  </div>
                  <ScrollArea className="h-[200px] rounded-md border bg-muted/30">
                    <div className="p-3 space-y-1">
                      {files.filter(f => !f.isNew && f.path).map((fileItem, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs p-2 rounded hover:bg-background/50">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{fileItem.name}</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {fileItem.meterNumber || "No meter"}
                            </Badge>
                          </div>
                          <span className="text-muted-foreground shrink-0 ml-2">
                            {fileItem.size ? `${(fileItem.size / 1024).toFixed(1)} KB` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {files.filter(f => f.status === "pending").length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Upload className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>Select one or more .csv or .txt files to get started</p>
                  {files.filter(f => !f.isNew && f.path).length > 0 && (
                    <p className="text-xs mt-2">Files already in storage are shown above</p>
                  )}
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

                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn(
                                    "w-[250px] justify-between",
                                    !fileItem.meterId && "text-muted-foreground"
                                  )}
                                  disabled={isProcessing}
                                >
                                  {fileItem.meterId
                                    ? getMeterLabel(meters.find((m) => m.id === fileItem.meterId)!)
                                    : "Select meter..."}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[300px] p-0">
                                <Command>
                                  <CommandInput placeholder="Search by meter number..." />
                                  <CommandEmpty>No meter found.</CommandEmpty>
                                  <CommandGroup className="max-h-[300px] overflow-auto">
                                    {meters.map((meter) => (
                                      <CommandItem
                                        key={meter.id}
                                        value={`${meter.meter_number} ${meter.serial_number || ''} ${meter.name || ''}`}
                                        onSelect={() => {
                                          updateFileMapping(actualIndex, meter.id);
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            fileItem.meterId === meter.id
                                              ? "opacity-100"
                                              : "opacity-0"
                                          )}
                                        />
                                        <div className="flex flex-col">
                                          <span className="font-medium">{meter.meter_number}</span>
                                          <span className="text-xs text-muted-foreground">
                                            {meter.name || 'Unnamed'}{meter.serial_number && ` • S/N: ${meter.serial_number}`}
                                          </span>
                                        </div>
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </Command>
                              </PopoverContent>
                            </Popover>

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
                              
                              <div className="h-48 w-full rounded-md border overflow-auto">
                                <table className="text-xs border-collapse">
                                  <thead className="sticky top-0 z-10">
                                    <tr className="border-b">
                                      {fileItem.preview.headers.map((header, idx) => (
                                        <th key={idx} className="px-3 py-2 text-left font-medium bg-muted whitespace-nowrap">
                                          <div className="space-y-1">
                                            <div className="font-semibold">{header || `Column ${idx + 1}`}</div>
                                            <Badge variant="outline" className="text-[10px] h-4">
                                              {idx === fileItem.preview.detectedColumns.dateColumn ? 'Date' :
                                               idx === fileItem.preview.detectedColumns.timeColumn ? 'Time' :
                                               idx === fileItem.preview.detectedColumns.valueColumn ? 'kWh Value' :
                                               'Other'}
                                            </Badge>
                                          </div>
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {fileItem.preview.rows.slice(0, 5).map((row, rowIdx) => (
                                      <tr key={rowIdx} className="border-b hover:bg-muted/30">
                                        {fileItem.preview.headers.map((_, colIdx) => (
                                          <td key={colIdx} className="px-3 py-2 whitespace-nowrap">
                                            {row[colIdx] || ''}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              
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
            </div>
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                    <Label>DateTime Format (for combined date+time columns)</Label>
                    <Select value={dateTimeFormat} onValueChange={setDateTimeFormat} disabled={isProcessing}>
                      <SelectTrigger className="bg-background mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="YYYY-MM-DD HH:mm:ss">YYYY-MM-DD HH:mm:ss</SelectItem>
                        <SelectItem value="YYYY-MM-DD HH:mm">YYYY-MM-DD HH:mm</SelectItem>
                        <SelectItem value="DD/MM/YYYY HH:mm:ss">DD/MM/YYYY HH:mm:ss</SelectItem>
                        <SelectItem value="DD/MM/YYYY HH:mm">DD/MM/YYYY HH:mm</SelectItem>
                        <SelectItem value="MM/DD/YYYY HH:mm:ss">MM/DD/YYYY HH:mm:ss</SelectItem>
                        <SelectItem value="MM/DD/YYYY HH:mm">MM/DD/YYYY HH:mm</SelectItem>
                        <SelectItem value="YYYY/MM/DD HH:mm:ss">YYYY/MM/DD HH:mm:ss</SelectItem>
                        <SelectItem value="DD-MM-YYYY HH:mm:ss">DD-MM-YYYY HH:mm:ss</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Row Time Interval</Label>
                    <Select value={timeInterval} onValueChange={setTimeInterval} disabled={isProcessing}>
                      <SelectTrigger className="bg-background mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="10">10 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">60 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Header Row Number</Label>
                    <Select value={headerRowNumber} onValueChange={setHeaderRowNumber} disabled={isProcessing}>
                      <SelectTrigger className="bg-background mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">No headers - All rows are data</SelectItem>
                        <SelectItem value="1">Row 1 is header</SelectItem>
                        <SelectItem value="2">Row 2 is header</SelectItem>
                        <SelectItem value="3">Row 3 is header</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="rounded-md bg-background p-3 text-xs text-muted-foreground space-y-2">
                  <div>
                    <p className="font-medium mb-1">Header Row:</p>
                    <p>If your CSV has a header row with column names, select "Yes" to skip it and use the names for metadata fields. If all rows contain data, select "No".</p>
                  </div>
                  <div>
                    <p className="font-medium mb-1">DateTime Format:</p>
                    <p>For columns containing combined date and time (e.g., "2023-09-08 14:30:00"), select the format that matches your data. The parser will use this to correctly extract dates and times. Common formats: YYYY-MM-DD HH:mm:ss for ISO format, DD/MM/YYYY HH:mm for European format.</p>
                  </div>
                  <div>
                    <p className="font-medium mb-1">Row Time Interval:</p>
                    <p>Only used when no time information is present in your data. Each row will be assigned a sequential time based on the selected interval starting from 00:00.</p>
                  </div>
                  <div>
                    <p className="font-medium mb-1">Column Assignment:</p>
                    <p>Click any column header to assign it as Date, Time, kWh, kVA, or other data types. You can also set the data type (string, int, float, datetime) for proper storage.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* File Preview & Column Mapping */}
            {previewFile && previewData && (
              <Card className="bg-muted/30">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      Preview: {previewFile.name}
                    </CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => setPreviewFile(null)}>
                      ×
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs text-muted-foreground mb-2">
                    Click column headers to set type, rename, or split columns. Changes update instantly.
                  </div>
                  
                  <div className="h-64 w-full rounded-md border overflow-auto">
                    <table className="text-xs border-collapse w-full">
                      <thead className="sticky top-0 z-10 bg-background">
                        <tr className="border-b">
                          {previewData.headers.map((header, idx) => {
                            const displayName = columnMapping.renamedHeaders?.[idx] || header || `Col ${idx + 1}`;
                            const isSplit = columnMapping.splitColumns?.[idx];
                            
                            if (isSplit) {
                              // Render each split part as a separate header
                              return isSplit.parts.map((part, partIdx) => (
                                <th key={`${idx}_${partIdx}`} className="px-3 py-2 text-left font-medium whitespace-nowrap border-r bg-muted/20">
                                  <Popover open={openPopover === `col_${idx}_split_${partIdx}`} onOpenChange={(open) => {
                                    if (open) {
                                      setOpenPopover(`col_${idx}_split_${partIdx}`);
                                      // Initialize temp state for split part
                                      const currentAssignment = 
                                        part.columnId === columnMapping.dateColumn ? 'date' :
                                        part.columnId === columnMapping.timeColumn ? 'time' :
                                        part.columnId === columnMapping.valueColumn ? 'value' :
                                        part.columnId === columnMapping.kvaColumn ? 'kva' : 'none';
                                      
                                      const currentDataType = columnMapping.columnDataTypes?.[part.columnId] || 'string';
                                      
                                      setTempColumnState({
                                        columnIdx: idx,
                                        newName: part.name,
                                        splitSeparator: 'split',
                                        splitParts: isSplit.parts,
                                        assignedType: currentAssignment,
                                        dataType: currentDataType
                                      });
                                    } else {
                                      setOpenPopover(null);
                                      setTempColumnState(null);
                                    }
                                  }}>
                                    <PopoverTrigger asChild>
                                      <button className="w-full text-left space-y-1 hover:bg-muted/50 p-1 rounded cursor-pointer transition-colors">
                                        <div className="font-semibold text-xs">
                                          {part.name}
                                        </div>
                                        <div className="flex gap-1 flex-wrap">
                                          {part.columnId === columnMapping.dateColumn && (
                                            <Badge variant="default" className="text-[10px] h-4">DateTime</Badge>
                                          )}
                                          {part.columnId === columnMapping.timeColumn && (
                                            <Badge variant="secondary" className="text-[10px] h-4">Time</Badge>
                                          )}
                                          {part.columnId === columnMapping.valueColumn && (
                                            <Badge variant="default" className="text-[10px] h-4">Primary Value</Badge>
                                          )}
                                          {part.columnId === columnMapping.kvaColumn && (
                                            <Badge variant="secondary" className="text-[10px] h-4">kVA</Badge>
                                          )}
                                        </div>
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64 p-3 bg-background border shadow-lg z-50" align="start">
                                      <div className="space-y-3">
                                        {/* Column Assignment for split part */}
                                        <div>
                                          <div className="text-xs font-medium mb-2">Assign as:</div>
                                          <div className="space-y-1">
                                            <Button
                                              size="sm"
                                              variant={tempColumnState?.assignedType === 'date' ? "default" : "ghost"}
                                              className="w-full justify-start text-xs h-7"
                                              onClick={() => setTempColumnState(prev => prev ? {...prev, assignedType: 'date'} : null)}
                                            >
                                              DateTime Column
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant={tempColumnState?.assignedType === 'time' ? "secondary" : "ghost"}
                                              className="w-full justify-start text-xs h-7"
                                              onClick={() => setTempColumnState(prev => prev ? {...prev, assignedType: 'time'} : null)}
                                            >
                                              Time Column
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant={tempColumnState?.assignedType === 'value' ? "default" : "ghost"}
                                              className="w-full justify-start text-xs h-7"
                                              onClick={() => setTempColumnState(prev => prev ? {...prev, assignedType: 'value'} : null)}
                                            >
                                              Primary Value (kWh)
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant={tempColumnState?.assignedType === 'kva' ? "secondary" : "ghost"}
                                              className="w-full justify-start text-xs h-7"
                                              onClick={() => setTempColumnState(prev => prev ? {...prev, assignedType: 'kva'} : null)}
                                            >
                                              Secondary Value (kVA)
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant={tempColumnState?.assignedType === 'none' ? "outline" : "ghost"}
                                              className="w-full justify-start text-xs h-7"
                                              onClick={() => setTempColumnState(prev => prev ? {...prev, assignedType: 'none'} : null)}
                                            >
                                              Keep as Extra Data
                                            </Button>
                                          </div>
                                        </div>

                                        {/* Rename split part */}
                                        <div className="border-t pt-2">
                                          <Label className="text-xs">Rename Part:</Label>
                                          <Input
                                            value={tempColumnState?.newName || part.name}
                                            onChange={(e) => setTempColumnState(prev => prev ? {...prev, newName: e.target.value} : null)}
                                            className="h-7 text-xs mt-1"
                                            placeholder="Enter part name"
                                          />
                                        </div>

                                        {/* Apply Button */}
                                        <div className="border-t pt-2">
                                          <Button
                                            size="sm"
                                            className="w-full text-xs h-8"
                                            onClick={() => {
                                              if (!tempColumnState) return;
                                              
                                              const newMapping = {...columnMapping};
                                              
                                              // Clear previous assignment of this split part
                                              if (part.columnId === newMapping.dateColumn) newMapping.dateColumn = "-1";
                                              if (part.columnId === newMapping.timeColumn) newMapping.timeColumn = "-1";
                                              if (part.columnId === newMapping.valueColumn) newMapping.valueColumn = "-1";
                                              if (part.columnId === newMapping.kvaColumn) newMapping.kvaColumn = "-1";
                                              
                                              // Apply new assignment
                                              if (tempColumnState.assignedType === 'date') newMapping.dateColumn = part.columnId;
                                              if (tempColumnState.assignedType === 'time') newMapping.timeColumn = part.columnId;
                                              if (tempColumnState.assignedType === 'value') newMapping.valueColumn = part.columnId;
                                              if (tempColumnState.assignedType === 'kva') newMapping.kvaColumn = part.columnId;
                                              
                                              // Apply rename to split part
                                              const newSplits = {...newMapping.splitColumns};
                                              if (newSplits[idx]) {
                                                newSplits[idx].parts[partIdx] = {
                                                  ...newSplits[idx].parts[partIdx],
                                                  name: tempColumnState.newName
                                                };
                                                newMapping.splitColumns = newSplits;
                                              }
                                              
                                              // Apply data type
                                              newMapping.columnDataTypes = {
                                                ...newMapping.columnDataTypes,
                                                [part.columnId]: tempColumnState.dataType
                                              };
                                              
                                              setColumnMapping(newMapping);
                                              setOpenPopover(null);
                                              setTempColumnState(null);
                                              toast.success("Split part settings applied");
                                            }}
                                          >
                                            Apply Changes
                                          </Button>
                                        </div>
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                </th>
                              ));
                            }
                            
                            return (
                              <th key={idx} className="px-3 py-2 text-left font-medium whitespace-nowrap border-r">
                                <Popover open={openPopover === `col_${idx}`} onOpenChange={(open) => {
                                  if (open) {
                                    setOpenPopover(`col_${idx}`);
                                    // Initialize temp state when opening
                                    const currentAssignment = 
                                      idx.toString() === columnMapping.dateColumn ? 'date' :
                                      idx.toString() === columnMapping.timeColumn ? 'time' :
                                      idx.toString() === columnMapping.valueColumn ? 'value' :
                                      idx.toString() === columnMapping.kvaColumn ? 'kva' : 'none';
                                    
                                    const currentDataType = columnMapping.columnDataTypes?.[idx.toString()] || 'string';
                                    
                                    setTempColumnState({
                                      columnIdx: idx,
                                      newName: displayName,
                                      splitSeparator: columnMapping.splitColumns?.[idx] ? 'split' : 'none',
                                      splitParts: columnMapping.splitColumns?.[idx]?.parts || [],
                                      assignedType: currentAssignment,
                                      dataType: currentDataType
                                    });
                                  } else {
                                    setOpenPopover(null);
                                    setTempColumnState(null);
                                  }
                                }}>
                                  <PopoverTrigger asChild>
                                    <button className="w-full text-left space-y-1 hover:bg-muted/50 p-1 rounded cursor-pointer transition-colors">
                                      <div className="font-semibold text-xs">
                                        {displayName}
                                        {isSplit && <span className="text-[10px] text-muted-foreground ml-1">✂️</span>}
                                      </div>
                                      <div className="flex gap-1 flex-wrap">
                                        {idx.toString() === columnMapping.dateColumn && (
                                          <Badge variant="default" className="text-[10px] h-4">DateTime</Badge>
                                        )}
                                        {idx.toString() === columnMapping.timeColumn && (
                                          <Badge variant="secondary" className="text-[10px] h-4">Time</Badge>
                                        )}
                                        {idx.toString() === columnMapping.valueColumn && (
                                          <Badge variant="default" className="text-[10px] h-4">Primary Value</Badge>
                                        )}
                                        {idx.toString() === columnMapping.kvaColumn && (
                                          <Badge variant="secondary" className="text-[10px] h-4">kVA</Badge>
                                        )}
                                      </div>
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-64 p-3 bg-background border shadow-lg z-50" align="start">
                                    <div className="space-y-3">
                                      {/* Column Assignment Section */}
                                      <div>
                                        <div className="text-xs font-medium mb-2">Assign as:</div>
                                        <div className="space-y-1">
                                          <Button
                                            size="sm"
                                            variant={tempColumnState?.assignedType === 'date' ? "default" : "ghost"}
                                            className="w-full justify-start text-xs h-7"
                                            onClick={() => setTempColumnState(prev => prev ? {...prev, assignedType: 'date'} : null)}
                                          >
                                            DateTime Column
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant={tempColumnState?.assignedType === 'time' ? "secondary" : "ghost"}
                                            className="w-full justify-start text-xs h-7"
                                            onClick={() => setTempColumnState(prev => prev ? {...prev, assignedType: 'time'} : null)}
                                          >
                                            Time Column
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant={tempColumnState?.assignedType === 'value' ? "default" : "ghost"}
                                            className="w-full justify-start text-xs h-7"
                                            onClick={() => setTempColumnState(prev => prev ? {...prev, assignedType: 'value'} : null)}
                                          >
                                            Primary Value (kWh)
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant={tempColumnState?.assignedType === 'kva' ? "secondary" : "ghost"}
                                            className="w-full justify-start text-xs h-7"
                                            onClick={() => setTempColumnState(prev => prev ? {...prev, assignedType: 'kva'} : null)}
                                          >
                                            Secondary Value (kVA)
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant={tempColumnState?.assignedType === 'none' ? "outline" : "ghost"}
                                            className="w-full justify-start text-xs h-7"
                                            onClick={() => setTempColumnState(prev => prev ? {...prev, assignedType: 'none'} : null)}
                                          >
                                            Keep as Extra Data
                                          </Button>
                                        </div>
                                      </div>

                                      {/* Rename Section */}
                                      <div className="border-t pt-2">
                                        <Label className="text-xs">Rename Column:</Label>
                                        <Input
                                          value={tempColumnState?.newName || displayName}
                                          onChange={(e) => setTempColumnState(prev => prev ? {...prev, newName: e.target.value} : null)}
                                          className="h-7 text-xs mt-1"
                                          placeholder="Enter column name"
                                        />
                                      </div>

                                      {/* Data Type Section */}
                                      <div className="border-t pt-2">
                                        <Label className="text-xs">Data Type:</Label>
                                        <Select
                                          value={tempColumnState?.dataType || "string"}
                                          onValueChange={(type: 'datetime' | 'float' | 'int' | 'string') => {
                                            setTempColumnState(prev => prev ? {...prev, dataType: type} : null);
                                          }}
                                        >
                                          <SelectTrigger className="h-7 text-xs mt-1 bg-background">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent className="bg-background z-50">
                                            <SelectItem value="string">String (Text)</SelectItem>
                                            <SelectItem value="int">Integer (Whole Number)</SelectItem>
                                            <SelectItem value="float">Float (Decimal)</SelectItem>
                                            <SelectItem value="datetime">DateTime</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>

                                      {/* Data Type Section */}
                                      <div className="border-t pt-2">
                                        <Label className="text-xs">Data Type:</Label>
                                        <Select
                                          value={tempColumnState?.dataType || "string"}
                                          onValueChange={(type: 'datetime' | 'float' | 'int' | 'string') => {
                                            setTempColumnState(prev => prev ? {...prev, dataType: type} : null);
                                          }}
                                        >
                                          <SelectTrigger className="h-7 text-xs mt-1 bg-background">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent className="bg-background z-50">
                                            <SelectItem value="string">String (Text)</SelectItem>
                                            <SelectItem value="int">Integer (Whole Number)</SelectItem>
                                            <SelectItem value="float">Float (Decimal)</SelectItem>
                                            <SelectItem value="datetime">DateTime</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>

                                      {/* Split Column Section */}
                                      <div className="border-t pt-2">
                                        <Label className="text-xs">Split Column By:</Label>
                                        <Select
                                          value={tempColumnState?.splitSeparator || "none"}
                                          onValueChange={(sep) => {
                                            if (sep === "none") {
                                              setTempColumnState(prev => prev ? {...prev, splitSeparator: 'none', splitParts: []} : null);
                                              setSplitPreview(null);
                                            } else {
                                              // Preview the split with actual separator
                                              const sampleValue = previewData.rows[0]?.[idx] || "";
                                              const sepChar = 
                                                sep === "space" ? " " :
                                                sep === "comma" ? "," :
                                                sep === "dash" ? "-" :
                                                sep === "slash" ? "/" : ":";
                                              const parts = sampleValue.split(sepChar);
                                              setSplitPreview({index: idx, parts});
                                              
                                              // Initialize split parts
                                              setTempColumnState(prev => prev ? {
                                                ...prev,
                                                splitSeparator: sep,
                                                splitParts: parts.map((_, partIdx) => ({
                                                  name: `${header} Part ${partIdx + 1}`,
                                                  columnId: `${idx}_split_${partIdx}`
                                                }))
                                              } : null);
                                            }
                                          }}
                                        >
                                          <SelectTrigger className="h-7 text-xs mt-1 bg-background">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent className="bg-background z-50">
                                            <SelectItem value="none">Don't split</SelectItem>
                                            <SelectItem value="space">Space ( )</SelectItem>
                                            <SelectItem value="comma">Comma (,)</SelectItem>
                                            <SelectItem value="dash">Dash (-)</SelectItem>
                                            <SelectItem value="slash">Slash (/)</SelectItem>
                                            <SelectItem value="colon">Colon (:)</SelectItem>
                                          </SelectContent>
                                        </Select>
                                        
                                        {tempColumnState?.splitSeparator !== 'none' && tempColumnState?.splitParts.length > 0 && (
                                          <div className="mt-2 space-y-2">
                                            <div className="text-xs font-medium">Rename split parts:</div>
                                            {tempColumnState.splitParts.map((part, partIdx) => (
                                              <div key={part.columnId} className="flex gap-1">
                                                <Input
                                                  value={part.name}
                                                  onChange={(e) => {
                                                    setTempColumnState(prev => {
                                                      if (!prev) return null;
                                                      const newParts = [...prev.splitParts];
                                                      newParts[partIdx] = {...newParts[partIdx], name: e.target.value};
                                                      return {...prev, splitParts: newParts};
                                                    });
                                                  }}
                                                  className="h-6 text-xs"
                                                  placeholder={`Part ${partIdx + 1}`}
                                                />
                                                <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                                                  {splitPreview?.index === idx ? splitPreview.parts[partIdx] : `P${partIdx + 1}`}
                                                </Badge>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>

                                      {/* Apply Button */}
                                      <div className="border-t pt-2">
                                        <Button
                                          size="sm"
                                          className="w-full text-xs h-8"
                                          onClick={() => {
                                            if (!tempColumnState) return;
                                            
                                            const newMapping = {...columnMapping};
                                            
                                            // Clear previous assignment of this column
                                            if (idx.toString() === newMapping.dateColumn) newMapping.dateColumn = "-1";
                                            if (idx.toString() === newMapping.timeColumn) newMapping.timeColumn = "-1";
                                            if (idx.toString() === newMapping.valueColumn) newMapping.valueColumn = "-1";
                                            if (idx.toString() === newMapping.kvaColumn) newMapping.kvaColumn = "-1";
                                            
                                            // Apply new assignment
                                            if (tempColumnState.assignedType === 'date') newMapping.dateColumn = idx.toString();
                                            if (tempColumnState.assignedType === 'time') newMapping.timeColumn = idx.toString();
                                            if (tempColumnState.assignedType === 'value') newMapping.valueColumn = idx.toString();
                                            if (tempColumnState.assignedType === 'kva') newMapping.kvaColumn = idx.toString();
                                            
                                            // Apply rename
                                            newMapping.renamedHeaders = {
                                              ...newMapping.renamedHeaders,
                                              [idx]: tempColumnState.newName
                                            };
                                            
                                            // Apply split
                                            if (tempColumnState.splitSeparator !== 'none' && tempColumnState.splitParts.length > 0) {
                                              newMapping.splitColumns = {
                                                ...newMapping.splitColumns,
                                                [idx]: {
                                                  separator: tempColumnState.splitSeparator,
                                                  parts: tempColumnState.splitParts
                                                }
                                              };
                                            } else {
                                              const newSplits = {...newMapping.splitColumns};
                                              delete newSplits[idx];
                                              newMapping.splitColumns = newSplits;
                                            }
                                            
                                            // Apply data type
                                            newMapping.columnDataTypes = {
                                              ...newMapping.columnDataTypes,
                                              [idx.toString()]: tempColumnState.dataType
                                            };
                                            
                                            setColumnMapping(newMapping);
                                            setOpenPopover(null);
                                            setTempColumnState(null);
                                            toast.success("Column settings applied");
                                          }}
                                        >
                                          Apply Changes
                                        </Button>
                                      </div>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.rows.slice(0, 10).map((row, rowIdx) => (
                          <tr key={rowIdx} className="border-b hover:bg-muted/30">
                            {previewData.headers.map((_, colIdx) => {
                              const splitConfig = columnMapping.splitColumns?.[colIdx];
                              
                              if (splitConfig) {
                                // Render each split part as a separate cell
                                const cellValue = row[colIdx] || '';
                                const sepChar = 
                                  splitConfig.separator === "space" ? " " :
                                  splitConfig.separator === "comma" ? "," :
                                  splitConfig.separator === "dash" ? "-" :
                                  splitConfig.separator === "slash" ? "/" : ":";
                                const parts = cellValue.split(sepChar);
                                
                                return splitConfig.parts.map((part, partIdx) => (
                                  <td key={`${colIdx}_${partIdx}`} className="px-3 py-2 whitespace-nowrap border-r bg-muted/20">
                                    {parts[partIdx] || ''}
                                  </td>
                                ));
                              } else {
                                // Regular cell
                                return (
                                  <td key={colIdx} className="px-3 py-2 whitespace-nowrap border-r">
                                    {row[colIdx] || ''}
                                  </td>
                                );
                              }
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

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
                       onClick={handleCleanupDuplicates}
                       disabled={isProcessing}
                       variant="outline"
                       size="sm"
                     >
                       <Trash2 className="w-4 h-4 mr-2" />
                       Remove Duplicates
                     </Button>
                     <Button
                       onClick={handleCleanupOrphans}
                       disabled={isProcessing}
                       variant="outline"
                       size="sm"
                     >
                       <Trash2 className="w-4 h-4 mr-2" />
                       Cleanup Orphans
                     </Button>
                     <Button
                       onClick={() => handleParseAll(false)}
                       disabled={isProcessing || files.filter(f => f.status === "uploaded" || f.status === "error").length === 0}
                     >
                       <Play className="w-4 h-4 mr-2" />
                       Parse Ready Files
                     </Button>
                     <Button
                       onClick={() => handleParseAll(true)}
                       disabled={isProcessing || files.filter(f => f.path).length === 0}
                       variant="destructive"
                       size="sm"
                     >
                       <Play className="w-4 h-4 mr-2" />
                       Force Re-parse ALL
                     </Button>
                  </div>
                 </div>

                 {/* Parse Status Summary */}
                 <Card className="bg-muted/30 border-border/50">
                   <CardContent className="pt-4 pb-4">
                     <div className="grid grid-cols-3 gap-4 text-center">
                       <div>
                         <div className="text-2xl font-bold text-primary">
                           {files.filter(f => f.status === "uploaded" || f.status === "error").length}
                         </div>
                         <div className="text-xs text-muted-foreground mt-1">Ready to Parse</div>
                       </div>
                       <div>
                         <div className="text-2xl font-bold text-green-600">
                           {files.filter(f => f.status === "success").length}
                         </div>
                         <div className="text-xs text-muted-foreground mt-1">Already Parsed</div>
                       </div>
                       <div>
                         <div className="text-2xl font-bold">
                           {files.length}
                         </div>
                         <div className="text-xs text-muted-foreground mt-1">Total Files</div>
                       </div>
                     </div>
                     {files.filter(f => f.status === "success").some(f => f.readingsInserted !== undefined) && (
                       <div className="mt-4 pt-4 border-t border-border text-xs text-center">
                         <span className="text-muted-foreground">
                           Total readings in DB: {' '}
                         </span>
                         <span className="font-semibold text-primary">
                           {files.filter(f => f.status === "success").reduce((sum, f) => sum + (f.readingsInserted || 0), 0).toLocaleString()}
                         </span>
                       </div>
                     )}
                   </CardContent>
                 </Card>

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
                              {fileItem.readingsInserted === 0 && fileItem.duplicatesSkipped === 0 ? (
                                <Badge variant="destructive" className="text-xs">
                                  ⚠️ 0 readings - Check config
                                </Badge>
                              ) : (
                                <>
                                  <Badge variant="outline" className="text-green-600 border-green-600">
                                    ✓ Parsed Successfully
                                  </Badge>
                                  <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
                                    {fileItem.readingsInserted} new
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
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => loadFilePreview(fileItem)}
                                disabled={isProcessing}
                                title="Preview & configure"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDownload(fileItem)}
                                title="Download file"
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                            </>
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

          <TabsContent value="clear" className="flex-1 overflow-auto">
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                  <Database className="w-5 h-5" />
                  Clear All Data & Files
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This will permanently delete all meter readings AND all CSV files for this site.
                </p>
                
                <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                  <p className="text-sm font-medium">What will be cleared:</p>
                  <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                    <li>• All CSV files from storage</li>
                    <li>• All CSV file tracking records</li>
                    <li>• All meter reading records in the database</li>
                    <li>• All historical data and timestamps</li>
                    <li>• All calculated values and reconciliations</li>
                  </ul>
                </div>

                <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                  <p className="text-sm font-medium">What will NOT be cleared:</p>
                  <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                    <li>• Meter configurations</li>
                    <li>• Site settings and tariff structures</li>
                    <li>• User accounts and permissions</li>
                  </ul>
                </div>

                <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-destructive" />
                  <p className="text-sm font-medium text-destructive">
                    This action cannot be undone! You will start from a clean slate.
                  </p>
                </div>

                <Button
                  variant="destructive"
                  onClick={() => setShowClearConfirm(true)}
                  disabled={isClearing}
                  className="w-full"
                >
                  {isClearing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Clearing All Data...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Clear All Data & Files
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear All Data & Files?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete:
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>All CSV files from storage</li>
                  <li>All meter readings from the database</li>
                  <li>All parsing history and tracking records</li>
                </ul>
                <p className="mt-2 font-semibold">This action cannot be undone!</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleClearDatabase} 
                disabled={isClearing}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isClearing ? "Clearing..." : "Yes, clear everything"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
