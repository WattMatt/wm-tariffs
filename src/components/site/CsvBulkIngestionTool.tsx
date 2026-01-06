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
import { Checkbox } from "@/components/ui/checkbox";
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

interface ParseQueue {
  startQueue: (items: any[]) => void;
  cancelQueue: () => void;
  isProcessing: boolean;
  progress: { completed: number; total: number; currentFile: string; isActive: boolean };
}

interface CsvBulkIngestionToolProps {
  siteId: string;
  onDataChange?: () => void;
  parseQueue?: ParseQueue;
  reparseMeterIds?: string[]; // When provided, opens in reparse mode with only these meters' files
  onReparseDialogClose?: () => void; // Callback when reparse dialog closes
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
  datetimeColumn: number | string | null; // Column containing datetime - NO DEFAULT, must be set by user
  datetimeFormat: string | null; // Format for datetime parsing - NO DEFAULT, must be set by user
  renamedHeaders?: Record<string, string> | null; // Custom names for columns
  columnDataTypes?: Record<string, 'datetime' | 'float' | 'int' | 'string' | 'boolean'> | null; // Data type for each column
  columnSplits?: Record<number, string> | null; // Split configuration for columns
  splitColumnNames?: Record<string, string> | null; // Custom names for split parts
  splitColumnDataTypes?: Record<string, 'datetime' | 'float' | 'int' | 'string' | 'boolean'> | null; // Data types for split parts
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

export default function CsvBulkIngestionTool({ siteId, onDataChange, parseQueue, reparseMeterIds, onReparseDialogClose }: CsvBulkIngestionToolProps) {
  const isReparseMode = reparseMeterIds && reparseMeterIds.length > 0;
  const [isOpen, setIsOpen] = useState(isReparseMode ? true : false);
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
    datetimeColumn: null,
    datetimeFormat: null,
    renamedHeaders: null,
    columnDataTypes: null
  });
  const [columnSplits, setColumnSplits] = useState<Record<number, string>>({});
  const [splitColumnNames, setSplitColumnNames] = useState<Record<string, string>>({});
  const [splitColumnDataTypes, setSplitColumnDataTypes] = useState<Record<string, 'datetime' | 'float' | 'int' | 'string' | 'boolean'>>({});
  const [editingHeader, setEditingHeader] = useState<{id: string, value: string} | null>(null);
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({});

  // Helper function to apply column splits
  const applySplits = (row: any[], columnIndex: number): any[] => {
    const splitType = columnSplits[columnIndex];
    if (!splitType || splitType === 'none') return [row[columnIndex]];
    
    const cell = row[columnIndex]?.toString() || '';
    const delimiterMap: Record<string, string | RegExp> = {
      tab: '\t',
      comma: ',',
      semicolon: ';',
      space: /\s+/
    };
    
    const delimiter = delimiterMap[splitType];
    if (delimiter instanceof RegExp) {
      return cell.split(delimiter);
    }
    return cell.split(delimiter);
  };
  
  // Get all available columns - simplified, no split columns
  const getAvailableColumns = () => {
    if (!previewData) return [];
    
    return previewData.headers.map((header, idx) => ({
      id: idx.toString(),
      name: columnMapping.renamedHeaders?.[idx.toString()] || header || `Col ${idx + 1}`,
      isSplit: false
    }));
  };
  const [activeTab, setActiveTab] = useState<string>(isReparseMode ? "parse" : "upload");
  const [previewingFile, setPreviewingFile] = useState<FileItem | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Open dialog when entering reparse mode
  useEffect(() => {
    if (reparseMeterIds && reparseMeterIds.length > 0) {
      setIsOpen(true);
      setActiveTab("parse");
    }
  }, [reparseMeterIds]);

  // Handle dialog close
  const handleDialogClose = (open: boolean) => {
    setIsOpen(open);
    if (!open && isReparseMode && onReparseDialogClose) {
      onReparseDialogClose();
    }
  };

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
  }, [isOpen, activeTab, siteId]);

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
      
      let query = supabase
        .from('meter_csv_files')
        .select(`
          *,
          meters(meter_number)
        `)
        .eq('site_id', siteId)
        .order('created_at', { ascending: false });

      // Filter by reparseMeterIds if in reparse mode
      if (reparseMeterIds && reparseMeterIds.length > 0) {
        query = query.in('meter_id', reparseMeterIds);
        console.log(`Filtering for ${reparseMeterIds.length} meters in reparse mode`);
      }

      const { data: files, error } = await query;

      if (error) throw error;

      console.log(`Found ${files?.length || 0} files in database`);

      const filesList: FileItem[] = (files || []).map(file => ({
        name: file.file_name,
        path: file.file_path,
        meterId: file.meter_id,
        meterNumber: file.meters?.meter_number || 'Unknown',
        size: file.file_size,
        status: file.parse_status === 'parsed' ? 'success' : 
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

    console.log(`🔄 Processing ${selectedFiles.length} selected file(s)...`);
    const failedFiles: { name: string; error: string }[] = [];
    const duplicateFiles: string[] = [];

    for (const file of Array.from(selectedFiles)) {
      try {
        console.log(`📄 Processing file: ${file.name}`);
        
        const fileName = file.name.replace(/\.csv$/i, "");
        const numberMatch = fileName.match(/\d+/);
        const fileNumber = numberMatch ? numberMatch[0] : null;

        console.log(`  - Extracted number: ${fileNumber}`);

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
          console.log(`  ✓ Matched to meter ${matchedMeter.meter_number}`);
        } else {
          console.warn(`  ✗ No match found`);
        }

        // Generate content hash
        const contentHash = await generateFileHash(file);
        const isDuplicate = existingHashes.has(contentHash);

        if (isDuplicate) {
          console.log(`  ⚠️ Duplicate detected (skipping)`);
          duplicateFiles.push(file.name);
          continue;
        }

        // Generate preview
        const preview = await parseCsvPreview(file, separator);

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
        console.log(`  ✅ Successfully added to queue`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`  ❌ Failed to process ${file.name}:`, error);
        failedFiles.push({ name: file.name, error: errorMessage });
      }
    }

    console.log(`✅ File processing complete: ${newFiles.length} added, ${duplicateFiles.length} duplicates, ${failedFiles.length} failed`);

    // Show user feedback
    if (duplicateFiles.length > 0) {
      toast.warning(`${duplicateFiles.length} duplicate file(s) detected and skipped`);
    }
    
    if (failedFiles.length > 0) {
      toast.error(`Failed to process ${failedFiles.length} file(s): ${failedFiles.map(f => f.name).join(', ')}`);
    }
    if (newFiles.length > 0) {
      setFiles(prev => [...prev, ...newFiles]);
      toast.success(`Added ${newFiles.length} new file(s) for upload`);
    } else if (failedFiles.length === 0 && duplicateFiles.length === 0) {
      toast.info('No files to add');
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
        
        // Generate hierarchical storage path
        const { generateStoragePath } = await import("@/lib/storagePaths");
        const { bucket, path: filePath } = await generateStoragePath(
          siteId,
          'Metering',
          'Meters/CSVs',
          fileName
        );
        
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

        // Use upsert: true to overwrite any orphaned files left from failed deletions
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(filePath, fileItem.file!, { upsert: true });

        if (uploadError) {
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
            parse_status: 'uploaded',
            separator: separator,
            header_row_number: parseInt(headerRowNumber) || 1
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
            .from('client-files')
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
              .from('client-files')
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
        .from('client-files')
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
      
      // Initialize with detected values - NO DEFAULTS for datetimeColumn
      const initialHeaders: Record<string, string> = {};
      const initialDataTypes: Record<string, 'datetime' | 'float' | 'int' | 'string' | 'boolean'> = {};
      
      headers.forEach((header, idx) => {
        initialHeaders[idx.toString()] = header;
        // Auto-detect data types based on column name and content
        const lower = header.toLowerCase();
        if (idx === dateColIdx) {
          initialDataTypes[idx.toString()] = 'datetime';
        } else if (lower.includes('kwh') || lower.includes('kva') || lower.includes('(kwh)') || lower.includes('(kva)')) {
          initialDataTypes[idx.toString()] = 'float';
        }
      });
      
      setColumnMapping({
        datetimeColumn: dateColIdx >= 0 ? dateColIdx : null, // Set detected datetime column, or null if not found
        datetimeFormat: dateTimeFormat || null,
        renamedHeaders: initialHeaders,
        columnDataTypes: initialDataTypes
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
      
      // Step 1: Get all CSV file paths from the database (the actual storage paths)
      const { data: csvFileRecords, error: fetchError } = await supabase
        .from('meter_csv_files')
        .select('file_path, parsed_file_path')
        .eq('site_id', siteId);

      let deletedFilesCount = 0;
      const allFilePaths: string[] = [];

      // Step 2: Collect all file paths (both original and parsed files)
      if (csvFileRecords && csvFileRecords.length > 0) {
        for (const record of csvFileRecords) {
          if (record.file_path) {
            allFilePaths.push(record.file_path);
          }
          if (record.parsed_file_path) {
            allFilePaths.push(record.parsed_file_path);
          }
        }
      }

      console.log(`Found ${allFilePaths.length} files to delete from storage`);

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
          console.log(`Deleted ${deletedFilesCount} files from storage`);
        }
      }

      // Step 4: Delete from tracking table
      await supabase
        .from('meter_csv_files')
        .delete()
        .eq('site_id', siteId);

      // Step 5: Delete all meter readings
      const { data, error } = await supabase.rpc('delete_site_readings', {
        p_site_id: siteId
      });

      if (error) throw error;

      // Extract the count - RPC returns array of objects with total_deleted column
      const totalDeleted = Array.isArray(data) && data.length > 0 ? data[0].total_deleted : 0;

      // Step 6: Delete all hierarchical meter readings for this site
      const { data: siteMeters } = await supabase
        .from('meters')
        .select('id')
        .eq('site_id', siteId);

      let hierarchicalDeleted = 0;
      if (siteMeters && siteMeters.length > 0) {
        const meterIds = siteMeters.map(m => m.id);
        // Delete in batches to avoid timeout
        const batchSize = 50;
        for (let i = 0; i < meterIds.length; i += batchSize) {
          const batch = meterIds.slice(i, i + batchSize);
          const { count } = await supabase
            .from('hierarchical_meter_readings')
            .delete({ count: 'exact' })
            .in('meter_id', batch);
          hierarchicalDeleted += count || 0;
        }
      }
      
      // Clear local state completely
      setFiles([]);
      
      toast.success(
        `Complete clear: ${totalDeleted.toLocaleString()} readings, ${hierarchicalDeleted.toLocaleString()} hierarchical readings, ${deletedFilesCount} CSV file(s) removed`,
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

    // If parseQueue is provided, use background processing
    if (parseQueue) {
      const queueItems = filesToParse.map(fileItem => ({
        meterId: fileItem.meterId!,
        meterNumber: fileItem.meterNumber || "Unknown",
        filePath: fileItem.path!,
        separator: separator === "tab" ? "\t" : 
                  separator === "comma" ? "," : 
                  separator === "semicolon" ? ";" : 
                  separator === "space" ? " " : "\t",
        timeInterval: parseInt(timeInterval),
        headerRowNumber: parseInt(headerRowNumber),
        columnMapping: { ...columnMapping, columnSplits, splitColumnNames, splitColumnDataTypes }
      }));
      
      parseQueue.startQueue(queueItems);
      return;
    }

    // Fallback: inline processing (when parseQueue not provided)
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
          timeInterval: parseInt(timeInterval),
          headerRowNumber: parseInt(headerRowNumber),
          columnMapping: { ...columnMapping, columnSplits, splitColumnNames, splitColumnDataTypes }
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
            timeInterval: parseInt(timeInterval),
            headerRowNumber: parseInt(headerRowNumber),
            columnMapping: { ...columnMapping, columnSplits, splitColumnNames, splitColumnDataTypes }
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
        .from('client-files')
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
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      {!isReparseMode && (
        <DialogTrigger asChild>
          <Button variant="default" className="gap-2">
            <Upload className="w-4 h-4" />
            CSV Bulk Ingestion
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{isReparseMode ? `Reparse CSV Files (${reparseMeterIds?.length || 0} meters)` : 'CSV Bulk Ingestion Tool'}</DialogTitle>
          <DialogDescription>
            {isReparseMode 
              ? 'Review column mappings and reparse CSV files for selected meters'
              : 'Upload multiple CSV files, preview and transform your data, and ingest with a single click'
            }
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
                  
                  // Get available meters for this file (exclude meters assigned to OTHER pending files)
                  const assignedMeterIds = files
                    .filter((f, idx) => f.status === "pending" && idx !== actualIndex && f.meterId)
                    .map(f => f.meterId);
                  
                  const availableMeters = meters.filter(meter => 
                    !assignedMeterIds.includes(meter.id) || meter.id === fileItem.meterId
                  );
                  
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
                                  <CommandEmpty>
                                    {availableMeters.length === 0 
                                      ? "All meters are already assigned to other files."
                                      : "No meter found."}
                                  </CommandEmpty>
                                  <CommandGroup className="max-h-[300px] overflow-auto">
                                    {availableMeters.map((meter) => (
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
                                    <li>All Values → <code className="text-[10px] bg-background px-1 rounded">metadata.imported_fields</code></li>
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
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="text-sm font-semibold text-foreground">File Interpretation</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border rounded-md bg-muted/20">
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
                      <Label>Header Row Number</Label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={headerRowNumber}
                        onChange={(e) => setHeaderRowNumber(e.target.value)}
                        disabled={isProcessing}
                        className="bg-background mt-1"
                        placeholder="Enter header row number (0 for no headers)"
                      />
                    </div>
                  </div>
                </div>

                {previewData && (
                  <div className="space-y-3 mt-4">
                    <div className="text-sm font-semibold text-foreground">Column Interpretation</div>
                    <div className="p-4 border rounded-md bg-muted/20 space-y-4">
                      {/* Column Data Types */}
                      <div className="text-xs font-medium text-muted-foreground mt-4 mb-2">Column Data Types & Names</div>
                      {previewData.headers.map((header, idx) => {
                        const displayName = columnMapping.renamedHeaders?.[idx.toString()] || header || `Column ${idx + 1}`;
                        const columnId = idx.toString();
                        const currentDataType = columnMapping.columnDataTypes?.[columnId] || 'string';
                        
                        return (
                          <div key={idx} className="p-3 border rounded-md bg-background">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={visibleColumns[columnId] !== false}
                                onCheckedChange={(checked) => {
                                  setVisibleColumns(prev => ({
                                    ...prev,
                                    [columnId]: checked === true
                                  }));
                                }}
                                className="shrink-0 mt-6"
                              />
                              <div className="flex-1">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <Label className="text-xs mb-1">Column Name</Label>
                                    <Input
                                      value={displayName}
                                      onChange={(e) => {
                                        const newMapping = {...columnMapping};
                                        newMapping.renamedHeaders = {
                                          ...newMapping.renamedHeaders,
                                          [idx.toString()]: e.target.value
                                        };
                                        setColumnMapping(newMapping);
                                      }}
                                      className="h-8 text-xs"
                                      placeholder="Column name"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs mb-1">Data Type</Label>
                                    <Select
                                      value={currentDataType}
                                      onValueChange={(type: 'datetime' | 'string' | 'int' | 'float' | 'boolean') => {
                                        const newMapping = {...columnMapping};
                                        newMapping.columnDataTypes = {
                                          ...newMapping.columnDataTypes,
                                          [columnId]: type
                                        };
                                        // If setting to datetime, derive datetimeColumn
                                        if (type === 'datetime') {
                                          newMapping.datetimeColumn = idx;
                                        } else if (newMapping.datetimeColumn === idx) {
                                          // Clear datetimeColumn if this column was datetime but now changed
                                          newMapping.datetimeColumn = null;
                                        }
                                        setColumnMapping(newMapping);
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-xs bg-background">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-background z-50">
                                        <SelectItem value="datetime">Datetime</SelectItem>
                                        <SelectItem value="string">String</SelectItem>
                                        <SelectItem value="int">Integer</SelectItem>
                                        <SelectItem value="float">Float</SelectItem>
                                        <SelectItem value="boolean">Boolean</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  {currentDataType === 'datetime' && (
                                    <div className="md:col-span-2">
                                      <Label className="text-xs mb-1">DateTime Format</Label>
                                      <Select
                                        value={columnMapping.datetimeFormat || ""}
                                        onValueChange={(val) => {
                                          const newMapping = {...columnMapping};
                                          newMapping.datetimeFormat = val || null;
                                          setColumnMapping(newMapping);
                                        }}
                                      >
                                        <SelectTrigger className="h-8 text-xs bg-background">
                                          <SelectValue placeholder="Auto-detect" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-background z-50">
                                          <SelectItem value="YYYY-MM-DD HH:mm:ss">YYYY-MM-DD HH:mm:ss</SelectItem>
                                          <SelectItem value="YYYY-MM-DD HH:mm">YYYY-MM-DD HH:mm</SelectItem>
                                          <SelectItem value="DD/MM/YYYY HH:mm:ss">DD/MM/YYYY HH:mm:ss</SelectItem>
                                          <SelectItem value="DD/MM/YYYY HH:mm">DD/MM/YYYY HH:mm</SelectItem>
                                          <SelectItem value="MM/DD/YYYY HH:mm:ss">MM/DD/YYYY HH:mm:ss</SelectItem>
                                          <SelectItem value="YYYY/MM/DD HH:mm:ss">YYYY/MM/DD HH:mm:ss</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  )}
                                  <div>
                                    <Label className="text-xs mb-1">Split Column By</Label>
                                    <Select 
                                      value={columnSplits[idx] || 'none'} 
                                      onValueChange={(val) => setColumnSplits(prev => ({...prev, [idx]: val}))}
                                    >
                                      <SelectTrigger className="h-8 text-xs bg-background">
                                        <SelectValue placeholder="No split" />
                                      </SelectTrigger>
                                      <SelectContent className="bg-background z-50">
                                        <SelectItem value="none">No split</SelectItem>
                                        <SelectItem value="tab">Split by Tab</SelectItem>
                                        <SelectItem value="comma">Split by Comma</SelectItem>
                                        <SelectItem value="semicolon">Split by Semicolon</SelectItem>
                                        <SelectItem value="space">Split by Space</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                {/* Split Part Names - shown when column is split */}
                                {columnSplits[idx] && columnSplits[idx] !== 'none' && previewData?.rows[0] && (
                                  <div className="mt-3 p-3 border rounded-md bg-accent/5">
                                    <Label className="text-xs mb-2 block text-muted-foreground">Split Part Configuration</Label>
                                    <div className="space-y-2">
                                      {applySplits(previewData.rows[0], idx).map((part, partIdx) => {
                                        const columnKey = `${idx}-${partIdx}`;
                                        return (
                                          <div key={columnKey} className="flex items-center gap-2">
                                            <Input
                                              value={splitColumnNames[columnKey] || ''}
                                              onChange={(e) => setSplitColumnNames(prev => ({
                                                ...prev,
                                                [columnKey]: e.target.value
                                              }))}
                                              className="h-7 text-xs flex-1"
                                              placeholder={`Part ${partIdx + 1} (${part?.toString().substring(0, 10) || '...'})`}
                                            />
                                            <Select
                                              value={splitColumnDataTypes[columnKey] || 'string'}
                                              onValueChange={(val: 'datetime' | 'float' | 'int' | 'string' | 'boolean') => 
                                                setSplitColumnDataTypes(prev => ({...prev, [columnKey]: val}))
                                              }
                                            >
                                              <SelectTrigger className="h-7 text-xs w-28 bg-background">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent className="bg-background z-50">
                                                <SelectItem value="datetime">Datetime</SelectItem>
                                                <SelectItem value="float">Float</SelectItem>
                                                <SelectItem value="int">Integer</SelectItem>
                                                <SelectItem value="string">String</SelectItem>
                                                <SelectItem value="boolean">Boolean</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
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
                  <div className="h-64 w-full rounded-md border overflow-auto">
                    <table className="text-xs border-collapse w-full">
                      <thead className="sticky top-0 z-10 bg-background">
                        <tr className="border-b">
                          {previewData.headers.flatMap((header, idx) => {
                            const displayName = columnMapping.renamedHeaders?.[idx.toString()] || header || `Col ${idx + 1}`;
                            const columnId = idx.toString();
                            
                            // Check visibility for column
                            if (visibleColumns[columnId] === false) return [];
                            
                            const splitType = columnSplits[idx];
                            if (splitType && splitType !== 'none' && previewData.rows[0]) {
                              const splitParts = applySplits(previewData.rows[0], idx);
                              return splitParts.map((_, partIdx) => {
                                const columnKey = `${idx}-${partIdx}`;
                                const splitName = splitColumnNames[columnKey] || `${displayName} [${partIdx + 1}]`;
                                return (
                                  <th key={columnKey} className="px-3 py-2 text-left font-medium whitespace-nowrap border-r bg-accent/10">
                                    <div className="font-semibold text-xs">
                                      {splitName}
                                    </div>
                                  </th>
                                );
                              });
                            }
                            
                            return (
                              <th key={idx} className="px-3 py-2 text-left font-medium whitespace-nowrap border-r">
                                <div className="font-semibold text-xs">
                                  {displayName}
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.rows.slice(0, 10).map((row, rowIdx) => (
                          <tr key={rowIdx} className="border-b hover:bg-muted/30">
                            {previewData.headers.flatMap((_, colIdx) => {
                              const columnId = colIdx.toString();
                              if (visibleColumns[columnId] === false) return [];
                              
                              const splitParts = applySplits(row, colIdx);
                              return splitParts.map((part, partIdx) => (
                                <td key={`${colIdx}-${partIdx}`} className="px-3 py-2 whitespace-nowrap border-r">
                                  {part?.toString() || '—'}
                                </td>
                              ));
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
