import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Upload, Loader2, Download, Trash2, Eye, GripVertical, Plus, X, Sparkles, RefreshCw, Square, XCircle, Folder, FolderPlus, ChevronRight, ChevronDown, Home, Edit2, FolderOpen, Link, FileType, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { pdfjs } from 'react-pdf';
import { Canvas as FabricCanvas, Image as FabricImage, Rect as FabricRect, Circle } from "fabric";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DatePicker } from "@/components/ui/date-picker";
import { generateStoragePath } from "@/lib/storagePaths";

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocumentsTabProps {
  siteId: string;
  onUploadProgressChange?: (progress: {
    isUploading: boolean;
    current: number;
    total: number;
    action: string;
  }) => void;
}

interface SiteDocument {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  document_type: string;
  upload_date: string;
  extraction_status: string;
  converted_image_path?: string | null;
  folder_path: string;
  is_folder: boolean;
  parent_folder_id?: string | null;
  meter_id?: string | null;
  document_extractions: Array<{
    period_start: string;
    period_end: string;
    total_amount: number;
    currency: string;
    extracted_data: any;
  }>;
  meters?: {
    id: string;
    meter_number: string;
    name: string | null;
  } | null;
}

interface FolderItem {
  id: string;
  name: string;
  path: string;
  children: FolderItem[];
  documents: SiteDocument[];
  isExpanded?: boolean;
}

export default function DocumentsTab({ siteId, onUploadProgressChange }: DocumentsTabProps) {
  const [documents, setDocuments] = useState<SiteDocument[]>([]);
  const [siteMeters, setSiteMeters] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadCancelled, setUploadCancelled] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [documentType, setDocumentType] = useState<string>("municipal_account");
  const [viewingExtraction, setViewingExtraction] = useState<any>(null);
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, action: '' });
  const [viewingDocument, setViewingDocument] = useState<SiteDocument | null>(null);
  const [documentImageUrl, setDocumentImageUrl] = useState<string | null>(null);
  const [editedData, setEditedData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isBulkExtracting, setIsBulkExtracting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [bulkEditQueue, setBulkEditQueue] = useState<string[]>([]);
  const [currentBulkEditIndex, setCurrentBulkEditIndex] = useState(0);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [isTypeChangeDialogOpen, setIsTypeChangeDialogOpen] = useState(false);
  const [selectedDocumentType, setSelectedDocumentType] = useState<"municipal_account" | "tenant_bill" | "other" | "report">("municipal_account");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(null);
  
  // Folder management state
  const [currentFolderPath, setCurrentFolderPath] = useState<string>('');
  const [folderTree, setFolderTree] = useState<FolderItem[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingSubfolderFor, setCreatingSubfolderFor] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [moveDestinationFolder, setMoveDestinationFolder] = useState<string>('');
  const [isMoving, setIsMoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadCancelledRef = useRef(false);
  
  // Helper function to update progress both locally and in parent
  const updateUploadProgress = (progress: { current: number; total: number; action: string }) => {
    setUploadProgress(progress);
    onUploadProgressChange?.({
      isUploading: true,
      ...progress
    });
  };

  // Helper function to clear upload progress
  const clearUploadProgress = () => {
    setUploadProgress({ current: 0, total: 0, action: '' });
    onUploadProgressChange?.({
      isUploading: false,
      current: 0,
      total: 0,
      action: ''
    });
  };
  
  // Fabric.js canvas state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const selectionModeRef = useRef(false);
  const drawStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const selectionRectRef = useRef<FabricRect | null>(null);
  const startMarkerRef = useRef<Circle | null>(null);
  const currentImageRef = useRef<FabricImage | null>(null);

  useEffect(() => {
    fetchDocuments();
    fetchSiteMeters();
  }, [siteId]);
  
  const fetchSiteMeters = async () => {
    try {
      const { data, error } = await supabase
        .from("meters")
        .select("*")
        .eq("site_id", siteId)
        .order("meter_number");
      
      if (error) throw error;
      setSiteMeters(data || []);
    } catch (error) {
      console.error("Error fetching meters:", error);
    }
  };

  const fetchDocuments = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("site_documents")
        .select(`
          *,
          document_extractions (
            period_start,
            period_end,
            total_amount,
            currency,
            extracted_data
          ),
          meters (
            id,
            meter_number,
            name
          )
        `)
        .eq("site_id", siteId)
        .order("upload_date", { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
      buildFolderTree(data || []);
    } catch (error) {
      console.error("Error fetching documents:", error);
      toast.error("Failed to load documents");
    } finally {
      setIsLoading(false);
    }
  };

  // Build folder tree from documents
  const buildFolderTree = (docs: SiteDocument[]) => {
    const tree: FolderItem[] = [];
    const folders = docs.filter(d => d.is_folder);
    const files = docs.filter(d => !d.is_folder);
    
    // Create folder structure
    folders.forEach(folder => {
      const pathParts = folder.folder_path.split('/').filter(Boolean);
      let currentLevel = tree;
      let currentPath = '';
      
      pathParts.forEach((part, index) => {
        currentPath += (currentPath ? '/' : '') + part;
        let existing = currentLevel.find(f => f.name === part);
        
        if (!existing) {
          existing = {
            id: folder.id,
            name: part,
            path: currentPath,
            children: [],
            documents: [],
            isExpanded: expandedFolders.has(currentPath)
          };
          currentLevel.push(existing);
        }
        
        currentLevel = existing.children;
      });
    });
    
    // Assign documents to folders
    const assignDocsToFolder = (folderItems: FolderItem[]) => {
      folderItems.forEach(folder => {
        folder.documents = files.filter(d => d.folder_path === folder.path);
        if (folder.children.length > 0) {
          assignDocsToFolder(folder.children);
        }
      });
    };
    
    assignDocsToFolder(tree);
    setFolderTree(tree);
  };

  // Create new folder or subfolder
  const handleCreateFolder = async (parentPath?: string) => {
    if (!newFolderName.trim()) {
      toast.error("Please enter a folder name");
      return;
    }

    try {
      const { data: user } = await supabase.auth.getUser();
      const targetPath = parentPath || currentFolderPath;
      const folderName = newFolderName.trim();
      const fullFolderPath = targetPath ? `${targetPath}/${folderName}` : folderName;

      // Create a placeholder file in storage to establish the folder structure
      const placeholderFileName = '.folderkeeper';
      const { bucket, path: placeholderPath } = await generateStoragePath(
        siteId,
        'Metering',
        `Documents/${fullFolderPath}`,
        placeholderFileName
      );

      // Upload a tiny placeholder file to create the folder in storage
      const placeholderBlob = new Blob(['folder'], { type: 'text/plain' });
      const { error: storageError } = await supabase.storage
        .from(bucket)
        .upload(placeholderPath, placeholderBlob);

      if (storageError && storageError.message !== 'The resource already exists') {
        throw storageError;
      }

      // Create database record for the folder
      const { error } = await supabase
        .from("site_documents")
        .insert({
          site_id: siteId,
          file_name: folderName,
          file_path: placeholderPath, // Store the placeholder path
          file_size: 0,
          document_type: 'other' as any,
          uploaded_by: user.user?.id || null,
          extraction_status: 'completed',
          folder_path: targetPath, // Parent folder path
          is_folder: true,
        });

      if (error) throw error;

      toast.success("Folder created successfully");
      setNewFolderName('');
      setIsCreatingFolder(false);
      setCreatingSubfolderFor(null);
      fetchDocuments();
    } catch (error) {
      console.error("Error creating folder:", error);
      toast.error("Failed to create folder");
    }
  };

  // Rename folder
  const handleRenameFolder = async (folderId: string, oldPath: string) => {
    if (!renameFolderName.trim()) {
      toast.error("Please enter a new folder name");
      return;
    }

    try {
      const pathParts = oldPath.split('/');
      pathParts[pathParts.length - 1] = renameFolderName.trim();
      const newPath = pathParts.join('/');

      // Update folder - only change file_name, not folder_path (it stays in the same location)
      const { error: folderError } = await supabase
        .from("site_documents")
        .update({
          file_name: renameFolderName.trim(),
        })
        .eq("id", folderId);

      if (folderError) throw folderError;

      // Update all documents in this folder and subfolders
      const docsToUpdate = documents.filter(d => 
        d.folder_path === oldPath || d.folder_path.startsWith(`${oldPath}/`)
      );

      for (const doc of docsToUpdate) {
        const updatedPath = doc.folder_path.replace(oldPath, newPath);
        await supabase
          .from("site_documents")
          .update({ folder_path: updatedPath })
          .eq("id", doc.id);
      }

      toast.success("Folder renamed successfully");
      setRenamingFolder(null);
      setRenameFolderName('');
      fetchDocuments();
    } catch (error) {
      console.error("Error renaming folder:", error);
      toast.error("Failed to rename folder");
    }
  };

  // Delete folder
  const handleDeleteFolder = async (folderId: string, folderPath: string) => {
    try {
      // Get all documents in this folder and subfolders
      const docsToDelete = documents.filter(d => 
        d.folder_path === folderPath || d.folder_path.startsWith(`${folderPath}/`)
      );

      // Delete from storage and database
      for (const doc of docsToDelete) {
        if (!doc.is_folder && doc.file_path) {
          await supabase.storage.from("client-files").remove([doc.file_path]);
        }
        await supabase.from("site_documents").delete().eq("id", doc.id);
      }

      // Delete the folder itself
      await supabase.from("site_documents").delete().eq("id", folderId);

      toast.success("Folder deleted successfully");
      fetchDocuments();
    } catch (error) {
      console.error("Error deleting folder:", error);
      toast.error("Failed to delete folder");
    }
  };

  // Toggle folder expansion
  const toggleFolder = (folderPath: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath);
      } else {
        newSet.add(folderPath);
      }
      return newSet;
    });
  };

  // Navigate to folder
  const navigateToFolder = (folderPath: string) => {
    setCurrentFolderPath(folderPath);
  };

  // Handle sorting
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Get sorted documents
  const getSortedDocuments = () => {
    const filtered = documents.filter(d => !d.is_folder && d.folder_path === currentFolderPath);
    
    if (!sortColumn || !sortDirection) return filtered;

    return [...filtered].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortColumn) {
        case "file_name":
          aValue = a.file_name.toLowerCase();
          bValue = b.file_name.toLowerCase();
          break;
        case "shop_number":
          aValue = a.document_extractions?.[0]?.extracted_data?.shop_number || "";
          bValue = b.document_extractions?.[0]?.extracted_data?.shop_number || "";
          break;
        case "document_type":
          aValue = a.document_type;
          bValue = b.document_type;
          break;
        case "upload_date":
          aValue = new Date(a.upload_date).getTime();
          bValue = new Date(b.upload_date).getTime();
          break;
        case "extraction_status":
          aValue = a.extraction_status;
          bValue = b.extraction_status;
          break;
        case "amount":
          aValue = a.document_extractions?.[0]?.total_amount || 0;
          bValue = b.document_extractions?.[0]?.total_amount || 0;
          break;
        default:
          return 0;
      }

      if (sortDirection === "asc") {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    });
  };

  // Sortable header component
  const SortableHeader = ({ column, children }: { column: string; children: React.ReactNode }) => {
    const isActive = sortColumn === column;
    const Icon = isActive
      ? sortDirection === "asc"
        ? ArrowUp
        : ArrowDown
      : ArrowUpDown;

    return (
      <TableHead>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 data-[state=open]:bg-accent"
          onClick={() => handleSort(column)}
        >
          {children}
          <Icon className={`ml-2 h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
        </Button>
      </TableHead>
    );
  };


  // Get available folders for move dialog
  const getAvailableFolders = (): string[] => {
    const folders = new Set<string>();
    folders.add('__root__'); // Use special value instead of empty string
    
    // Get all unique folder paths from documents
    documents.forEach(doc => {
      if (doc.is_folder) {
        // For folders, construct their full path
        const folderFullPath = doc.folder_path 
          ? `${doc.folder_path}/${doc.file_name}` 
          : doc.file_name;
        if (folderFullPath) {
          folders.add(folderFullPath);
        }
      }
    });
    
    return Array.from(folders).sort();
  };

  // Handle move selected documents to folder
  const handleMoveToFolder = async () => {
    if (selectedDocuments.size === 0) {
      toast.error("No documents selected");
      return;
    }

    setIsMoving(true);
    try {
      const selectedDocs = documents.filter(d => selectedDocuments.has(d.id) && !d.is_folder);
      // Convert "__root__" back to empty string for database
      const destinationPath = moveDestinationFolder === "__root__" ? "" : moveDestinationFolder;
      
      for (const doc of selectedDocs) {
        // Move the actual file in storage
        const oldPath = doc.file_path;
        const fileName = oldPath.split('/').pop() || doc.file_name;
        
        // Generate new storage path
        const subPath = destinationPath || 'Root';
        const { bucket, path: newPath } = await generateStoragePath(
          siteId,
          'Metering',
          `Documents/${subPath}`,
          fileName
        );

        // Copy file to new location
        const { data: fileData } = await supabase.storage
          .from(bucket)
          .download(oldPath);

        if (fileData) {
          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(newPath, fileData);

          if (uploadError) throw uploadError;

          // Delete old file
          await supabase.storage.from(bucket).remove([oldPath]);
        }

        // Handle converted image path if it exists
        let newConvertedImagePath = doc.converted_image_path;
        if (doc.converted_image_path) {
          const convertedFileName = doc.converted_image_path.split('/').pop() || 'converted.png';
          const { bucket: imgBucket, path: newImgPath } = await generateStoragePath(
            siteId,
            'Metering',
            `Documents/${subPath}`,
            convertedFileName
          );

          const { data: imgData } = await supabase.storage
            .from(imgBucket)
            .download(doc.converted_image_path);

          if (imgData) {
            await supabase.storage
              .from(imgBucket)
              .upload(newImgPath, imgData);

            await supabase.storage.from(imgBucket).remove([doc.converted_image_path]);
            newConvertedImagePath = newImgPath;
          }
        }

        // Update database record with new paths
        const { error } = await supabase
          .from("site_documents")
          .update({ 
            folder_path: destinationPath,
            file_path: newPath,
            converted_image_path: newConvertedImagePath
          })
          .eq("id", doc.id);

        if (error) throw error;
      }

      toast.success(`Moved ${selectedDocuments.size} document(s) to ${destinationPath || 'root'}`);
      setSelectedDocuments(new Set());
      setIsMoveDialogOpen(false);
      setMoveDestinationFolder('');
      fetchDocuments();
    } catch (error) {
      console.error("Error moving documents:", error);
      toast.error("Failed to move documents");
    } finally {
      setIsMoving(false);
    }
  };

  // Upload files from folder with structure
  const handleFolderUpload = async (files: File[]) => {
    setIsUploading(true);
    setUploadCancelled(false);
    uploadCancelledRef.current = false;
    updateUploadProgress({ current: 0, total: files.length, action: 'Uploading files' });

    try {
      const { data: user } = await supabase.auth.getUser();
      let successCount = 0;
      let failCount = 0;
      const uploadedDocuments: Array<{ id: string; path: string; documentType: string }> = [];

      for (let i = 0; i < files.length; i++) {
        // Check if upload was cancelled
        if (uploadCancelledRef.current) {
          toast.info(`Upload cancelled. ${successCount} of ${files.length} files uploaded.`);
          break;
        }

        const file = files[i] as any; // File with webkitRelativePath
        updateUploadProgress({ current: i + 1, total: files.length, action: 'Uploading files' });

        try {
          // Extract folder path from webkitRelativePath
          const relativePath = file.webkitRelativePath || file.name;
          const pathParts = relativePath.split('/');
          const fileName = pathParts[pathParts.length - 1];
          
          // Upload directly to current folder, not creating subfolders from upload
          const folderPath = currentFolderPath;

          const fileExt = fileName.split('.').pop()?.toLowerCase();
          const isPdf = fileExt === 'pdf';

          // Upload file to storage using proper hierarchical path
          const subPath = folderPath || 'Root';
          const uniqueFileName = `${Date.now()}-${fileName}`;
          const { bucket, path: storagePath } = await generateStoragePath(
            siteId,
            'Metering',
            `Documents/${subPath}`,
            uniqueFileName
          );
          
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(storagePath, file);

          if (uploadError) throw uploadError;

          let convertedImagePath: string | null = null;

          if (isPdf) {
            const imageBlob = await convertPdfToImage(file);
            const uniqueImageName = `${Date.now()}-converted.png`;
            const { bucket: imageBucket, path: imagePath } = await generateStoragePath(
              siteId,
              'Metering',
              `Documents/${subPath}`,
              uniqueImageName
            );
            
            const { error: imageUploadError } = await supabase.storage
              .from(imageBucket)
              .upload(imagePath, imageBlob);

            if (!imageUploadError) {
              convertedImagePath = imagePath;
            }
          }

          // Create document record
          const { data: document, error: docError } = await supabase
            .from("site_documents")
            .insert({
              site_id: siteId,
              file_name: fileName,
              file_path: uploadData.path,
              file_size: file.size,
              document_type: documentType as any,
              uploaded_by: user.user?.id || null,
              extraction_status: 'pending',
              converted_image_path: convertedImagePath,
              folder_path: folderPath,
              is_folder: false,
            })
            .select()
            .single();

          if (docError) throw docError;

          // Store document info for background extraction
          uploadedDocuments.push({
            id: document.id,
            path: convertedImagePath || uploadData.path,
            documentType: documentType
          });

          successCount++;
        } catch (error) {
          console.error(`Error uploading ${file.name}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} file(s) uploaded successfully. AI extraction started in background.`);
        
        // Queue extractions in background (fire and forget)
        uploadedDocuments.forEach(doc => {
          supabase.storage
            .from("client-files")
            .createSignedUrl(doc.path, 3600)
            .then(({ data: urlData }) => {
              if (urlData?.signedUrl) {
                supabase.functions.invoke("extract-document-data", {
                  body: {
                    documentId: doc.id,
                    fileUrl: urlData.signedUrl,
                    documentType: doc.documentType
                  }
                }).catch(err => console.error('Background extraction error:', err));
              }
            })
            .catch(err => console.error('Failed to get signed URL:', err));
        });
      }
      if (failCount > 0) {
        toast.error(`${failCount} file(s) failed to upload`);
      }

      setSelectedFiles([]);
      fetchDocuments();
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload folder");
    } finally {
      setIsUploading(false);
      setUploadCancelled(false);
      clearUploadProgress();
    }
  };


  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setSelectedFiles(Array.from(files));
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const filesArray = Array.from(files);
    setSelectedFiles(filesArray);
  };

  const convertPdfToImage = async (pdfFile: File): Promise<Blob> => {
    setIsConvertingPdf(true);
    try {
      console.log('Converting PDF to image:', pdfFile.name);
      
      // Read the PDF file as array buffer
      const arrayBuffer = await pdfFile.arrayBuffer();
      
      // Load the PDF
      const loadingTask = pdfjs.getDocument(arrayBuffer);
      const pdf = await loadingTask.promise;
      
      console.log('PDF loaded, converting first page to image...');
      
      // Get the first page
      const page = await pdf.getPage(1);
      
      // Set scale for high quality
      const scale = 2.0;
      const viewport = page.getViewport({ scale });
      
      // Create canvas
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (!context) {
        throw new Error('Could not get canvas context');
      }
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      // Render PDF page to canvas
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        canvas: canvas
      };
      
      await page.render(renderContext).promise;
      
      console.log('PDF rendered to canvas, converting to blob...');
      
      // Convert canvas to blob
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to convert canvas to blob'));
          }
        }, 'image/png', 1.0);
      });
    } finally {
      setIsConvertingPdf(false);
    }
  };

  const handleAssignMeter = async (documentId: string, meterId: string | null) => {
    try {
      const { error } = await supabase
        .from("site_documents")
        .update({ meter_id: meterId })
        .eq("id", documentId);

      if (error) throw error;

      // Update local state instead of refetching
      setDocuments(prevDocs => 
        prevDocs.map(doc => 
          doc.id === documentId 
            ? { ...doc, meter_id: meterId }
            : doc
        )
      );

      toast.success(meterId ? "Meter assigned successfully" : "Meter unassigned");
    } catch (error: any) {
      console.error("Error assigning meter:", error);
      toast.error("Failed to assign meter");
    }
  };

  const handleCancelUpload = () => {
    // Set cancellation flags
    setUploadCancelled(true);
    uploadCancelledRef.current = true;
    
    // Immediately reset all upload state
    setIsUploading(false);
    setSelectedFiles([]);
    clearUploadProgress();
    
    // Reset file input refs to allow new uploads
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const handleAutoAssignAll = async () => {
    if (selectedDocuments.size === 0) {
      toast.error("No documents selected");
      return;
    }

    setIsAutoAssigning(true);
    try {
      let assignedCount = 0;
      let skippedCount = 0;
      const assignedMeters = new Set<string>();

      // Get only the selected documents
      const selectedDocs = documents.filter(doc => selectedDocuments.has(doc.id));

      // First, track which meters are already assigned to documents
      for (const doc of documents) {
        if (!doc.is_folder && doc.meter_id) {
          assignedMeters.add(doc.meter_id);
        }
      }

      for (const doc of selectedDocs) {
        if (doc.is_folder) continue;
        
        // Skip if document already has a meter assigned
        if (doc.meter_id) {
          skippedCount++;
          continue;
        }
        
        // Get shop number from extraction data
        const extraction = doc.document_extractions?.[0];
        const shopNumber = extraction?.extracted_data?.shop_number;
        
        if (!shopNumber) {
          skippedCount++;
          continue;
        }

        // Find matching meter by meter_number
        const matchingMeter = siteMeters.find(
          (meter) => meter.meter_number.toLowerCase() === shopNumber.toLowerCase()
        );

        // Skip if meter is already assigned to another document
        if (matchingMeter && assignedMeters.has(matchingMeter.id)) {
          skippedCount++;
          continue;
        }

        if (matchingMeter) {
          const { error } = await supabase
            .from("site_documents")
            .update({ meter_id: matchingMeter.id })
            .eq("id", doc.id);

          if (!error) {
            assignedCount++;
            // Mark this meter as assigned
            assignedMeters.add(matchingMeter.id);
          } else {
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
      }

      toast.success(
        `Auto-assignment complete: ${assignedCount} assigned, ${skippedCount} skipped`
      );
      fetchDocuments();
      setSelectedDocuments(new Set()); // Clear selection after assignment
    } catch (error: any) {
      console.error("Error auto-assigning meters:", error);
      toast.error("Failed to auto-assign meters");
    } finally {
      setIsAutoAssigning(false);
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      toast.error("Please select at least one file");
      return;
    }

    // Check if we have folder structure (files with webkitRelativePath)
    const hasFolder = selectedFiles.some((f: any) => f.webkitRelativePath);
    
    if (hasFolder) {
      // Use folder upload handler
      await handleFolderUpload(selectedFiles);
      return;
    }

    setIsUploading(true);
    setUploadCancelled(false);
    uploadCancelledRef.current = false;
    updateUploadProgress({ current: 0, total: selectedFiles.length, action: 'Uploading files' });
    
    try {
      const { data: user } = await supabase.auth.getUser();
      let successCount = 0;
      let failCount = 0;
      const uploadedDocuments: Array<{ id: string; path: string; documentType: string }> = [];

      // Process files sequentially to show progress
      for (let i = 0; i < selectedFiles.length; i++) {
        // Check if upload was cancelled
        if (uploadCancelledRef.current) {
          toast.info(`Upload cancelled. ${successCount} of ${selectedFiles.length} files uploaded.`);
          break;
        }

        const file = selectedFiles[i];
        updateUploadProgress({ current: i + 1, total: selectedFiles.length, action: 'Uploading files' });
        
        try {
          const fileExt = file.name.split('.').pop()?.toLowerCase();
          const isPdf = fileExt === 'pdf';

          // Upload original file to storage using proper hierarchical path
          const subPath = currentFolderPath || 'Root';
          const uniqueFileName = `${Date.now()}-${file.name}`;
          const { bucket, path: storagePath } = await generateStoragePath(
            siteId,
            'Metering',
            `Documents/${subPath}`,
            uniqueFileName
          );
          
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(storagePath, file);

          if (uploadError) throw uploadError;

          let convertedImagePath: string | null = null;

          // If it's a PDF, convert to image and upload
          if (isPdf) {
            const imageBlob = await convertPdfToImage(file);
            const uniqueImageName = `${Date.now()}-converted.png`;
            const { bucket: imageBucket, path: imagePath } = await generateStoragePath(
              siteId,
              'Metering',
              `Documents/${subPath}`,
              uniqueImageName
            );
            
            const { error: imageUploadError } = await supabase.storage
              .from(imageBucket)
              .upload(imagePath, imageBlob);

            if (!imageUploadError) {
              convertedImagePath = imagePath;
            }
          }

          // Create document record with current folder path
          const { data: document, error: docError } = await supabase
            .from("site_documents")
            .insert({
              site_id: siteId,
              file_name: file.name,
              file_path: uploadData.path,
              file_size: file.size,
              document_type: documentType as any,
              uploaded_by: user.user?.id || null,
              extraction_status: 'pending',
              converted_image_path: convertedImagePath,
              folder_path: currentFolderPath,
              is_folder: false,
            })
            .select()
            .single();

          if (docError) throw docError;

          // Store document info for background extraction
          uploadedDocuments.push({
            id: document.id,
            path: convertedImagePath || uploadData.path,
            documentType: documentType
          });

          successCount++;
        } catch (error) {
          console.error(`Error uploading ${file.name}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} document(s) uploaded successfully. AI extraction started in background.`);
        
        // Queue extractions in background (fire and forget)
        uploadedDocuments.forEach(doc => {
          supabase.storage
            .from("client-files")
            .createSignedUrl(doc.path, 3600)
            .then(({ data: urlData }) => {
              if (urlData?.signedUrl) {
                supabase.functions.invoke("extract-document-data", {
                  body: {
                    documentId: doc.id,
                    fileUrl: urlData.signedUrl,
                    documentType: doc.documentType
                  }
                }).catch(err => console.error('Background extraction error:', err));
              }
            })
            .catch(err => console.error('Failed to get signed URL:', err));
        });
      }
      if (failCount > 0) {
        toast.error(`${failCount} document(s) failed to upload`);
      }

      setSelectedFiles([]);
      fetchDocuments();
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload documents");
    } finally {
      setIsUploading(false);
      setUploadCancelled(false);
      clearUploadProgress();
    }
  };

  const handleDownload = async (filePath: string, fileName: string) => {
    try {
      const { data } = await supabase.storage
        .from("client-files")
        .download(filePath);

      if (data) {
        const url = URL.createObjectURL(data);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Failed to download document");
    }
  };

  const handleDelete = async (id: string, filePath: string) => {
    try {
      await supabase.storage.from("client-files").remove([filePath]);
      await supabase.from("site_documents").delete().eq("id", id);
      toast.success("Document deleted");
      fetchDocuments();
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete document");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-accent">Extracted</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const currentFolderItems = documents.filter(d => d.folder_path === currentFolderPath);
      setSelectedDocuments(new Set(currentFolderItems.map(doc => doc.id)));
    } else {
      setSelectedDocuments(new Set());
    }
  };

  const handleSelectDocument = (docId: string, checked: boolean) => {
    const newSelected = new Set(selectedDocuments);
    if (checked) {
      newSelected.add(docId);
    } else {
      newSelected.delete(docId);
    }
    setSelectedDocuments(newSelected);
  };

  const handleBulkDelete = async () => {
    if (selectedDocuments.size === 0) return;

    try {
      const docsToDelete = documents.filter(doc => selectedDocuments.has(doc.id));
      
      await Promise.all(
        docsToDelete.map(async (doc) => {
          await supabase.storage.from("client-files").remove([doc.file_path]);
          await supabase.from("site_documents").delete().eq("id", doc.id);
        })
      );

      toast.success(`${selectedDocuments.size} document(s) deleted`);
      setSelectedDocuments(new Set());
      fetchDocuments();
    } catch (error) {
      console.error("Bulk delete error:", error);
      toast.error("Failed to delete documents");
    }
  };

  const handleBulkTypeChange = async () => {
    const documentsToUpdate = Array.from(selectedDocuments).filter(id => {
      const doc = documents.find(d => d.id === id);
      return doc && !doc.is_folder;
    });

    if (documentsToUpdate.length === 0) {
      toast.error("No documents selected");
      return;
    }

    setIsBulkExtracting(true);

    try {
      const { error } = await supabase
        .from('site_documents')
        .update({ document_type: selectedDocumentType })
        .in('id', documentsToUpdate);

      if (error) throw error;

      toast.success(`Updated ${documentsToUpdate.length} document(s)`);
      fetchDocuments();
      setSelectedDocuments(new Set());
    } catch (error) {
      console.error("Bulk type change error:", error);
      toast.error("Failed to update document types");
    } finally {
      setIsBulkExtracting(false);
      setIsTypeChangeDialogOpen(false);
    }
  };

  const handleBulkDownload = async () => {
    if (selectedDocuments.size === 0) return;

    try {
      const docsToDownload = documents.filter(doc => selectedDocuments.has(doc.id));
      
      for (const doc of docsToDownload) {
        await handleDownload(doc.file_path, doc.file_name);
        // Add small delay between downloads to avoid overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      toast.success(`Downloaded ${selectedDocuments.size} document(s)`);
    } catch (error) {
      console.error("Bulk download error:", error);
      toast.error("Failed to download documents");
    }
  };

  const handleBulkRescan = async () => {
    if (selectedDocuments.size === 0) return;

    const docsToRescan = documents.filter(doc => selectedDocuments.has(doc.id));

    setIsBulkExtracting(true);
    updateUploadProgress({ current: 0, total: docsToRescan.length, action: 'Re-scanning documents' });

    let successCount = 0;
    let failCount = 0;

    try {
      for (let i = 0; i < docsToRescan.length; i++) {
        const doc = docsToRescan[i];
        updateUploadProgress({ current: i + 1, total: docsToRescan.length, action: 'Re-scanning documents' });

        try {
          // Get signed URL for the document
          const pathToProcess = doc.converted_image_path || doc.file_path;
          const { data: urlData } = await supabase.storage
            .from("client-files")
            .createSignedUrl(pathToProcess, 3600);

          if (!urlData?.signedUrl) {
            throw new Error("Failed to get document URL");
          }

          // Call AI extraction
          const { error: extractionError } = await supabase.functions.invoke("extract-document-data", {
            body: {
              documentId: doc.id,
              fileUrl: urlData.signedUrl,
              documentType: doc.document_type
            }
          });

          if (extractionError) throw extractionError;
          
          successCount++;
        } catch (error) {
          console.error(`Error rescanning ${doc.file_name}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully re-scanned ${successCount} document(s)`);
      }
      if (failCount > 0) {
        toast.error(`Failed to re-scan ${failCount} document(s)`);
      }

      setSelectedDocuments(new Set());
      fetchDocuments();
    } catch (error) {
      console.error("Bulk rescan error:", error);
      toast.error("Failed to complete bulk re-scan");
    } finally {
      setIsBulkExtracting(false);
      clearUploadProgress();
    }
  };

  const handleViewDocument = async (doc: SiteDocument) => {
    setViewingDocument(doc);
    setViewingExtraction(doc.document_extractions?.[0] || null);
    
    if (doc.document_extractions?.[0]) {
      setEditedData({ ...doc.document_extractions[0] });
    }

    // Fetch the document image
    try {
      const pathToView = doc.converted_image_path || doc.file_path;
      const { data } = await supabase.storage
        .from("client-files")
        .createSignedUrl(pathToView, 3600);
      
      if (data?.signedUrl) {
        setDocumentImageUrl(data.signedUrl);
      }
    } catch (error) {
      console.error("Error fetching document image:", error);
      toast.error("Failed to load document image");
    }
  };

  const handleCloseDialog = () => {
    setViewingDocument(null);
    setViewingExtraction(null);
    setDocumentImageUrl(null);
    setEditedData(null);
    setSelectionMode(false);
    setIsEditing(false);
    setBulkEditQueue([]);
    setCurrentBulkEditIndex(0);
    selectionModeRef.current = false;
    if (fabricCanvas) {
      fabricCanvas.dispose();
      setFabricCanvas(null);
    }
  };

  const handleReset = () => {
    if (viewingExtraction) {
      setEditedData({ ...viewingExtraction });
      setIsEditing(false);
      toast.info("Changes reset");
    }
  };


  const handleSave = async () => {
    if (!editedData || !viewingDocument) return;

    // Validate line items if they exist
    if (editedData.extracted_data?.line_items && Array.isArray(editedData.extracted_data.line_items)) {
      for (const item of editedData.extracted_data.line_items) {
        if (item.current_reading && item.previous_reading && item.current_reading < item.previous_reading) {
          toast.error(`Line item "${item.description}": Current reading cannot be less than previous reading`);
          return;
        }
      }
    }

    setIsSaving(true);
    try {
      const extraction = viewingDocument.document_extractions?.[0];
      if (!extraction) {
        toast.error("No extraction found");
        return;
      }

      // Calculate total from line items if they exist
      let totalAmount = editedData.total_amount;
      if (editedData.extracted_data?.line_items && Array.isArray(editedData.extracted_data.line_items)) {
        totalAmount = editedData.extracted_data.line_items.reduce((sum, item) => sum + (item.amount || 0), 0);
      }

      // Update the extraction in the database
      const { error } = await supabase
        .from("document_extractions")
        .update({
          period_start: editedData.period_start,
          period_end: editedData.period_end,
          total_amount: totalAmount,
          currency: editedData.currency,
          extracted_data: editedData.extracted_data,
        })
        .eq("document_id", viewingDocument.id);

      if (error) throw error;

      toast.success("Changes saved successfully");
      await fetchDocuments();
      
      // Check if we're in bulk edit mode
      if (bulkEditQueue.length > 0 && currentBulkEditIndex < bulkEditQueue.length - 1) {
        // Move to next document in queue
        const nextIndex = currentBulkEditIndex + 1;
        setCurrentBulkEditIndex(nextIndex);
        const nextDocId = bulkEditQueue[nextIndex];
        const nextDoc = documents.find(d => d.id === nextDocId);
        if (nextDoc) {
          await handleViewDocument(nextDoc);
        }
      } else {
        // No more documents or not in bulk edit mode
        handleCloseDialog();
      }
    } catch (error) {
      console.error("Error saving changes:", error);
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  // Initialize Fabric canvas when document image is loaded
  useEffect(() => {
    if (!canvasRef.current || !documentImageUrl) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: "#f8f9fa",
      stopContextMenu: true,
      fireRightClick: true,
      fireMiddleClick: true,
    });

    // Load the document image
    FabricImage.fromURL(documentImageUrl).then((img) => {
      const scale = Math.min(
        canvas.width! / img.width!,
        canvas.height! / img.height!
      );
      
      img.scale(scale * 0.9);
      img.set({
        left: (canvas.width! - img.width! * img.scaleX!) / 2,
        top: (canvas.height! - img.height! * img.scaleY!) / 2,
        selectable: false,
        evented: false,
      });
      
      currentImageRef.current = img;
      canvas.add(img);
      canvas.sendObjectToBack(img);
      canvas.renderAll();
    });

    // Mouse wheel zoom
    canvas.on('mouse:wheel', (opt) => {
      let newZoom = canvas.getZoom();
      newZoom *= 0.999 ** opt.e.deltaY;
      if (newZoom > 30) newZoom = 30;
      if (newZoom < 0.3) newZoom = 0.3;
      
      const pointer = canvas.getPointer(opt.e);
      canvas.zoomToPoint(pointer, newZoom);
      setZoom(newZoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Panning variables
    let isPanningLocal = false;
    let lastX = 0;
    let lastY = 0;

    // Mouse down - handle selection drawing (two-click approach) and panning
    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent;
      const target = opt.target;
      
      const isInSelectionMode = selectionModeRef.current;
      
      // MIDDLE MOUSE BUTTON: Always enables panning (highest priority)
      if (evt.button === 1) {
        evt.preventDefault();
        isPanningLocal = true;
        lastX = evt.clientX;
        lastY = evt.clientY;
        canvas.selection = false;
        return;
      }
      
      // SELECTION MODE: Handle two-click region drawing
      if (isInSelectionMode && evt.button === 0) {
        const isInteractiveObject = target && target.type !== 'image';
        if (isInteractiveObject) return;
        
        const pointer = canvas.getPointer(opt.e);
        
        // First click - set start point
        if (!drawStartPointRef.current) {
          drawStartPointRef.current = { x: pointer.x, y: pointer.y };
          
          // Show a marker at start point
          const marker = new Circle({
            left: pointer.x,
            top: pointer.y,
            radius: 5,
            fill: '#3b82f6',
            stroke: '#ffffff',
            strokeWidth: 2,
            selectable: false,
            evented: false,
            originX: 'center',
            originY: 'center',
          });
          
          canvas.add(marker);
          startMarkerRef.current = marker;
          canvas.renderAll();
          toast.info('Click again to set the end point');
          evt.preventDefault();
          evt.stopPropagation();
          return;
        }
        
        // Second click - create rectangle
        const startPoint = drawStartPointRef.current;
        
        const left = Math.min(startPoint.x, pointer.x);
        const top = Math.min(startPoint.y, pointer.y);
        const width = Math.abs(pointer.x - startPoint.x);
        const height = Math.abs(pointer.y - startPoint.y);
        
        if (width < 10 || height < 10) {
          toast.error('Selection too small');
          if (startMarkerRef.current) {
            canvas.remove(startMarkerRef.current);
            startMarkerRef.current = null;
          }
          drawStartPointRef.current = null;
          return;
        }
        
        const rect = new FabricRect({
          left,
          top,
          width,
          height,
          fill: 'rgba(59, 130, 246, 0.2)',
          stroke: '#3b82f6',
          strokeWidth: 2,
          selectable: true,
          evented: true,
        });
        
        canvas.add(rect);
        selectionRectRef.current = rect;
        canvas.renderAll();
        
        // Clean up marker
        if (startMarkerRef.current) {
          canvas.remove(startMarkerRef.current);
          startMarkerRef.current = null;
        }
        
        // Exit selection mode
        setSelectionMode(false);
        selectionModeRef.current = false;
        drawStartPointRef.current = null;
        
        toast.success('Region selected! Click "Rescan Region" to extract data from this area.');
        
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }
      
      // PANNING: Only allow when NOT in selection mode
      if (!selectionModeRef.current && !target) {
        if (evt.button === 0 || evt.button === 1 || evt.button === 2) {
          isPanningLocal = true;
          lastX = evt.clientX;
          lastY = evt.clientY;
          canvas.selection = false;
        }
      }
    });

    // Mouse move - show preview rectangle and handle panning
    canvas.on('mouse:move', (opt) => {
      // SELECTION MODE: Show preview rectangle
      if (selectionModeRef.current && drawStartPointRef.current && !selectionRectRef.current) {
        const pointer = canvas.getPointer(opt.e);
        const startPoint = drawStartPointRef.current;
        
        // Remove old preview
        const objects = canvas.getObjects();
        const oldPreview = objects.find(obj => (obj as any).isPreview);
        if (oldPreview) {
          canvas.remove(oldPreview);
        }
        
        // Create preview rectangle
        const left = Math.min(startPoint.x, pointer.x);
        const top = Math.min(startPoint.y, pointer.y);
        const width = Math.abs(pointer.x - startPoint.x);
        const height = Math.abs(pointer.y - startPoint.y);
        
        const preview = new FabricRect({
          left,
          top,
          width,
          height,
          fill: 'rgba(59, 130, 246, 0.1)',
          stroke: '#3b82f6',
          strokeWidth: 1,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
        });
        
        (preview as any).isPreview = true;
        canvas.add(preview);
        canvas.renderAll();
        return;
      }
      
      // PANNING: Only when not in selection mode
      if (isPanningLocal && !selectionModeRef.current) {
        const evt = opt.e as MouseEvent;
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] += evt.clientX - lastX;
          vpt[5] += evt.clientY - lastY;
          canvas.requestRenderAll();
          lastX = evt.clientX;
          lastY = evt.clientY;
        }
      }
    });

    // Mouse up - clean up panning state
    canvas.on('mouse:up', () => {
      if (isPanningLocal) {
        isPanningLocal = false;
        canvas.selection = true;
      }
    });

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [documentImageUrl]);

  // Update selectionModeRef when selectionMode changes
  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  const handleStartSelection = () => {
    setSelectionMode(true);
    selectionModeRef.current = true;
    toast.info('Click on the document to mark the first corner of your selection');
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    selectionModeRef.current = false;
    drawStartPointRef.current = null;
    
    if (fabricCanvas) {
      if (startMarkerRef.current) {
        fabricCanvas.remove(startMarkerRef.current);
        startMarkerRef.current = null;
      }
      if (selectionRectRef.current) {
        fabricCanvas.remove(selectionRectRef.current);
        selectionRectRef.current = null;
      }
      // Remove preview rectangles
      const objects = fabricCanvas.getObjects();
      const previews = objects.filter(obj => (obj as any).isPreview);
      previews.forEach(preview => fabricCanvas.remove(preview));
      fabricCanvas.renderAll();
    }
    
    toast.info('Selection cancelled');
  };

  const handleBulkEdit = async () => {
    if (selectedDocuments.size === 0) return;
    
    // Set up the bulk edit queue
    const queue = Array.from(selectedDocuments);
    setBulkEditQueue(queue);
    setCurrentBulkEditIndex(0);
    
    // Open the first document
    const firstDoc = documents.find(d => d.id === queue[0]);
    if (firstDoc) {
      await handleViewDocument(firstDoc);
    }
  };

  const handleSkipToNext = async () => {
    if (bulkEditQueue.length === 0 || currentBulkEditIndex >= bulkEditQueue.length - 1) {
      handleCloseDialog();
      return;
    }

    const nextIndex = currentBulkEditIndex + 1;
    setCurrentBulkEditIndex(nextIndex);
    const nextDocId = bulkEditQueue[nextIndex];
    const nextDoc = documents.find(d => d.id === nextDocId);
    if (nextDoc) {
      await handleViewDocument(nextDoc);
    }
  };

  const handleRescanRegion = async () => {
    if (!fabricCanvas || !selectionRectRef.current || !viewingDocument || !documentImageUrl) {
      toast.error('Please select a region first');
      return;
    }

    setIsExtracting(true);
    try {
      const rect = selectionRectRef.current;
      const imageObj = currentImageRef.current;
      
      if (!imageObj) throw new Error('Image not found on canvas');
      
      // Get rect's position and dimensions
      const rectLeft = rect.left || 0;
      const rectTop = rect.top || 0;
      const rectWidth = rect.width! * (rect.scaleX || 1);
      const rectHeight = rect.height! * (rect.scaleY || 1);
      
      // Get image's position and scale in canvas
      const imgLeft = imageObj.left || 0;
      const imgTop = imageObj.top || 0;
      const imgScaleX = imageObj.scaleX || 1;
      const imgScaleY = imageObj.scaleY || 1;
      
      // Load fresh image from URL to avoid CORS issues
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = documentImageUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      
      const originalWidth = img.naturalWidth || img.width;
      const originalHeight = img.naturalHeight || img.height;
      const imgWidth = originalWidth * imgScaleX;
      const imgHeight = originalHeight * imgScaleY;
      
      // Convert rect coordinates from canvas space to original image space
      const relativeLeft = rectLeft - imgLeft;
      const relativeTop = rectTop - imgTop;
      
      // Scale to original image coordinates
      const cropX = (relativeLeft / imgWidth) * originalWidth;
      const cropY = (relativeTop / imgHeight) * originalHeight;
      const cropWidth = (rectWidth / imgWidth) * originalWidth;
      const cropHeight = (rectHeight / imgHeight) * originalHeight;
      
      console.log('Crop coordinates:', { cropX, cropY, cropWidth, cropHeight, originalWidth, originalHeight });
      
      // Create a canvas for cropping
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.max(1, Math.floor(cropWidth));
      cropCanvas.height = Math.max(1, Math.floor(cropHeight));
      const ctx = cropCanvas.getContext('2d');
      
      if (!ctx) throw new Error('Could not get canvas context');
      
      // Draw the cropped region from the fresh image
      ctx.drawImage(
        img,
        Math.max(0, cropX), Math.max(0, cropY), cropWidth, cropHeight,
        0, 0, cropWidth, cropHeight
      );
      
      // Convert to data URL first
      const croppedImageUrl = cropCanvas.toDataURL('image/png');
      
      // Then convert to blob
      const response = await fetch(croppedImageUrl);
      const croppedBlob = await response.blob();
      
      // Upload cropped image
      const fileName = `${siteId}/region-${Date.now()}.png`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('client-files')
        .upload(fileName, croppedBlob);
      
      if (uploadError) throw uploadError;
      
      // Get signed URL
      const { data: urlData } = await supabase.storage
        .from('client-files')
        .createSignedUrl(uploadData.path, 3600);
      
      if (!urlData?.signedUrl) throw new Error('Failed to get signed URL');
      
      // Call AI extraction on the cropped region
      const { data: extractionResult, error: extractionError } = await supabase.functions.invoke("extract-document-data", {
        body: {
          documentId: viewingDocument.id,
          fileUrl: urlData.signedUrl,
          documentType: viewingDocument.document_type
        }
      });
      
      if (extractionError) throw extractionError;
      
      // Update the edited data with new extraction
      if (extractionResult?.extractedData) {
        const newData = {
          period_start: extractionResult.extractedData.period_start,
          period_end: extractionResult.extractedData.period_end,
          total_amount: extractionResult.extractedData.total_amount,
          currency: extractionResult.extractedData.currency || 'ZAR',
          extracted_data: extractionResult.extractedData
        };
        setEditedData(newData);
        toast.success("Region re-extracted successfully");
      }
      
      // Clean up the uploaded cropped image
      await supabase.storage.from('client-files').remove([uploadData.path]);
      
    } catch (error) {
      console.error("Error rescanning region:", error);
      toast.error("Failed to rescan region");
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Document Repository
            </CardTitle>
            <CardDescription>
              Upload municipal accounts and tenant bills for AI-powered data extraction
            </CardDescription>
          </CardHeader>
        <CardContent className="space-y-4">
          {/* New Folder Dialog - Inline */}
          {isCreatingFolder && (
            <div className="flex items-center gap-2 p-3 border rounded-lg bg-primary/5">
              <Input
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                autoFocus
              />
              <Button onClick={() => handleCreateFolder()} size="sm">
                Create
              </Button>
              <Button
                onClick={() => {
                  setIsCreatingFolder(false);
                  setNewFolderName('');
                }}
                variant="ghost"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/30">
            <div className="space-y-2">
              <Label htmlFor="document-type">Document Type</Label>
              <Select value={documentType} onValueChange={setDocumentType} disabled={isUploading}>
                <SelectTrigger id="document-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="municipal_account">Municipal Account</SelectItem>
                  <SelectItem value="tenant_bill">Tenant Bill</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="file-upload">Select Files or Folder</Label>
              <div className="flex gap-2">
                <Input
                  ref={fileInputRef}
                  id="file-upload"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileSelect}
                  disabled={isUploading}
                  multiple
                  className="hidden"
                />
                <Input
                  ref={folderInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFolderSelect}
                  {...({ webkitdirectory: "", directory: "" } as any)}
                  multiple
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex-1"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Choose Files
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex-1"
                >
                  <Folder className="w-4 h-4 mr-2" />
                  Choose Folder
                </Button>
              </div>
              {selectedFiles.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {selectedFiles.length} file(s) selected
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>&nbsp;</Label>
              <Button
                onClick={isUploading ? handleCancelUpload : handleUpload}
                disabled={!isUploading && (selectedFiles.length === 0 || isConvertingPdf)}
                variant={isUploading ? "destructive" : "default"}
                className="w-full"
              >
                {isUploading ? (
                  <>
                    <XCircle className="w-4 h-4 mr-2" />
                    Cancel Upload ({uploadProgress.current}/{uploadProgress.total})
                  </>
                ) : isConvertingPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Converting PDF...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload & Extract
                  </>
                )}
              </Button>
            </div>
          </div>

          {selectedDocuments.size > 0 && (
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {selectedDocuments.size} document(s) selected
                </span>
                {isBulkExtracting && (
                  <span className="text-sm text-muted-foreground">
                    ({uploadProgress.current}/{uploadProgress.total} {uploadProgress.action})
                  </span>
                )}
              </div>
              <TooltipProvider>
                <div className="flex gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBulkRescan}
                        disabled={isBulkExtracting}
                      >
                        {isBulkExtracting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Rescan Selected</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBulkEdit}
                        disabled={isBulkExtracting}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Bulk Edit</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsMoveDialogOpen(true)}
                        disabled={isBulkExtracting}
                      >
                        <FolderOpen className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Move to Folder</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBulkDownload}
                        disabled={isBulkExtracting}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download Selected</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAutoAssignAll}
                        disabled={isAutoAssigning || selectedDocuments.size === 0}
                      >
                        {isAutoAssigning ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Link className="w-4 h-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Auto-assign Meters</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsTypeChangeDialogOpen(true)}
                        disabled={isBulkExtracting}
                      >
                        <FileType className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Change Document Type</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleBulkDelete}
                    disabled={isBulkExtracting}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Selected
                  </Button>
                </div>
              </TooltipProvider>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No documents uploaded yet</p>
              <p className="text-sm mt-1">Upload your first document to get started</p>
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead colSpan={10} className="h-auto py-3">
                      <div className="flex items-center justify-between">
                        {/* Folder Navigation */}
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCurrentFolderPath('')}
                            className="gap-2"
                          >
                            <Home className="w-4 h-4" />
                            Documents
                          </Button>
                          {currentFolderPath && (
                            <>
                              {currentFolderPath.split('/').map((folder, index, arr) => {
                                const path = arr.slice(0, index + 1).join('/');
                                return (
                                  <div key={path} className="flex items-center gap-2">
                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setCurrentFolderPath(path)}
                                    >
                                      {folder}
                                    </Button>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                        {/* New Folder Button */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsCreatingFolder(true)}
                          className="gap-2"
                        >
                          <FolderPlus className="w-4 h-4" />
                          New Folder
                        </Button>
                      </div>
                    </TableHead>
                  </TableRow>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedDocuments.size === documents.filter(d => d.folder_path === currentFolderPath).length && documents.filter(d => d.folder_path === currentFolderPath).length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <SortableHeader column="file_name">File Name</SortableHeader>
                    <SortableHeader column="shop_number">Shop Number</SortableHeader>
                    <SortableHeader column="document_type">Type</SortableHeader>
                    <SortableHeader column="upload_date">Upload Date</SortableHeader>
                    <SortableHeader column="extraction_status">Status</SortableHeader>
                    <TableHead>Extracted Period</TableHead>
                    <SortableHeader column="amount">Amount</SortableHeader>
                    <TableHead>
                      Assigned Meter ({documents.filter(d => !d.is_folder && d.meter_id).map(d => d.meter_id).filter((id, idx, arr) => arr.indexOf(id) === idx).length}/{siteMeters.length})
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Show folders first */}
                  {documents
                    .filter(d => d.is_folder && d.folder_path === (currentFolderPath || ''))
                    .sort((a, b) => {
                      // Try to parse folder names as dates
                      const parseDate = (name: string): Date | null => {
                        try {
                          // Try "Month YYYY" format (e.g., "March 2025")
                          const monthYear = name.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i);
                          if (monthYear) {
                            const [, month, year] = monthYear;
                            return new Date(`${month} 1, ${year}`);
                          }
                          
                          // Try "Month" only format (e.g., "May") - use current year
                          const monthOnly = name.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)$/i);
                          if (monthOnly) {
                            const currentYear = new Date().getFullYear();
                            return new Date(`${name} 1, ${currentYear}`);
                          }
                          
                          return null;
                        } catch {
                          return null;
                        }
                      };
                      
                      const dateA = parseDate(a.file_name);
                      const dateB = parseDate(b.file_name);
                      
                      // If both are dates, sort chronologically
                      if (dateA && dateB) {
                        return dateA.getTime() - dateB.getTime();
                      }
                      
                      // If only one is a date, put dates first
                      if (dateA && !dateB) return -1;
                      if (!dateA && dateB) return 1;
                      
                      // Otherwise, alphabetical
                      return a.file_name.localeCompare(b.file_name);
                    })
                    .map((folder) => (
                      <TableRow
                        key={folder.id}
                        className="cursor-pointer hover:bg-muted/50"
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedDocuments.has(folder.id)}
                            onCheckedChange={(checked) => handleSelectDocument(folder.id, checked as boolean)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell
                          className="font-medium"
                          onClick={() => navigateToFolder(currentFolderPath ? `${currentFolderPath}/${folder.file_name}` : folder.file_name)}
                        >
                          <div className="flex items-center gap-2">
                            <Folder className="w-4 h-4 text-primary" />
                            {folder.file_name}
                          </div>
                        </TableCell>
                        <TableCell colSpan={7}>
                          <span className="text-muted-foreground text-sm">Folder</span>
                        </TableCell>
                        <TableCell className="text-right pr-2">
                          <TooltipProvider>
                            <div className="flex justify-end gap-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const folderPath = currentFolderPath ? `${currentFolderPath}/${folder.file_name}` : folder.file_name;
                                      setCreatingSubfolderFor(folderPath);
                                      setNewFolderName('');
                                    }}
                                  >
                                    <FolderPlus className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Create subfolder</p>
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRenamingFolder(folder.id);
                                      setRenameFolderName(folder.file_name);
                                    }}
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Rename folder</p>
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteFolder(folder.id, currentFolderPath ? `${currentFolderPath}/${folder.file_name}` : folder.file_name);
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Delete folder</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    ))}
                  
                  {/* Show documents */}
                  {getSortedDocuments()
                    .map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedDocuments.has(doc.id)}
                          onCheckedChange={(checked) => handleSelectDocument(doc.id, checked as boolean)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{doc.file_name}</TableCell>
                      <TableCell>
                        {doc.document_extractions?.[0]?.extracted_data?.shop_number ? (
                          <span className="text-sm">{doc.document_extractions[0].extracted_data.shop_number}</span>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {doc.document_type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {format(new Date(doc.upload_date), "MMM dd, yyyy")}
                      </TableCell>
                      <TableCell>{getStatusBadge(doc.extraction_status)}</TableCell>
                      <TableCell>
                        {doc.document_extractions?.[0] ? (
                          <span className="text-sm">
                            {format(new Date(doc.document_extractions[0].period_start), "MMM dd")} -{" "}
                            {format(new Date(doc.document_extractions[0].period_end), "MMM dd, yyyy")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                       <TableCell>
                         {doc.document_extractions?.[0] ? (
                           <span className="font-medium">
                             {doc.document_extractions[0].currency} {doc.document_extractions[0].total_amount.toLocaleString()}
                           </span>
                         ) : (
                           <span className="text-muted-foreground">-</span>
                         )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={doc.meter_id || "unassign"}
                            onValueChange={(value) => handleAssignMeter(doc.id, value === "unassign" ? null : value)}
                          >
                            <SelectTrigger className="h-7 w-[140px] text-xs">
                              <SelectValue placeholder="Assign..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassign">Unassigned</SelectItem>
                              {siteMeters
                                .filter(meter => {
                                  // Allow the meter if it's currently assigned to this document
                                  if (meter.id === doc.meter_id) return true;
                                  
                                  // Filter out meters already assigned to other documents in the SAME folder
                                  const isAssignedInFolder = documents.some(
                                    d => d.id !== doc.id && 
                                    d.folder_path === doc.folder_path && 
                                    d.meter_id === meter.id
                                  );
                                  return !isAssignedInFolder;
                                })
                                .map((meter) => (
                                  <SelectItem key={meter.id} value={meter.id}>
                                    {meter.meter_number}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right pr-2">
                         <TooltipProvider>
                           <div className="flex justify-end gap-2">
                             {doc.document_extractions?.[0] && (
                               <Tooltip>
                                 <TooltipTrigger asChild>
                                 <Button
                                   variant="ghost"
                                   size="sm"
                                   onClick={() => handleViewDocument(doc)}
                                 >
                                   <Eye className="w-4 h-4" />
                                 </Button>
                               </TooltipTrigger>
                               <TooltipContent>
                                 <p>View data</p>
                               </TooltipContent>
                               </Tooltip>
                             )}
                             <Tooltip>
                               <TooltipTrigger asChild>
                                 <Button
                                   variant="ghost"
                                   size="sm"
                                   onClick={() => handleDownload(doc.file_path, doc.file_name)}
                                 >
                                   <Download className="w-4 h-4" />
                                 </Button>
                               </TooltipTrigger>
                               <TooltipContent>
                                 <p>Download document</p>
                               </TooltipContent>
                             </Tooltip>
                             <Tooltip>
                               <TooltipTrigger asChild>
                                 <Button
                                   variant="ghost"
                                   size="sm"
                                   onClick={() => handleDelete(doc.id, doc.file_path)}
                                 >
                                   <Trash2 className="w-4 h-4" />
                                 </Button>
                               </TooltipTrigger>
                               <TooltipContent>
                                 <p>Delete document</p>
                               </TooltipContent>
                             </Tooltip>
                           </div>
                         </TooltipProvider>
                       </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewingDocument} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-7xl h-[85vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Document Extraction</DialogTitle>
                <DialogDescription>
                  Review and edit the AI-extracted information
                </DialogDescription>
              </div>
              {bulkEditQueue.length > 0 && (
                <Badge variant="secondary" className="text-sm">
                  Document {currentBulkEditIndex + 1} of {bulkEditQueue.length}
                </Badge>
              )}
            </div>
          </DialogHeader>
          {viewingDocument && editedData && (
            <>
              <div className="grid grid-cols-2 gap-6 flex-1 overflow-hidden">
                {/* Left side - Document Image with Fabric.js Canvas */}
                <div className="border rounded-lg bg-muted/30 flex flex-col overflow-hidden">
                  {/* Top Controls */}
                  <div className="p-2 border-b bg-background/80 flex items-center justify-end gap-2 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const newZoom = Math.max(0.1, zoom - 0.1);
                          setZoom(newZoom);
                          if (fabricCanvas) {
                            fabricCanvas.setZoom(newZoom);
                            fabricCanvas.renderAll();
                          }
                        }}
                      >
                        <span className="text-lg">-</span>
                      </Button>
                      <div className="text-sm text-muted-foreground min-w-[60px] text-center">
                        {Math.round(zoom * 100)}%
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const newZoom = Math.min(3, zoom + 0.1);
                          setZoom(newZoom);
                          if (fabricCanvas) {
                            fabricCanvas.setZoom(newZoom);
                            fabricCanvas.renderAll();
                          }
                        }}
                      >
                        <span className="text-lg">+</span>
                      </Button>
                    </div>
                  </div>
                  
                  {/* Canvas */}
                  <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
                    {documentImageUrl ? (
                      <canvas ref={canvasRef} />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <p>Loading document...</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side - Editable Data */}
                <div className="overflow-y-auto space-y-4 pr-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Period Start</Label>
                    <DatePicker
                      date={editedData.period_start ? new Date(editedData.period_start) : undefined}
                      onDateChange={(date) => {
                        setEditedData({ ...editedData, period_start: date ? date.toISOString().split('T')[0] : null });
                      }}
                      placeholder="Pick a date"
                      disabled={!isEditing}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Period End</Label>
                    <DatePicker
                      date={editedData.period_end ? new Date(editedData.period_end) : undefined}
                      onDateChange={(date) => {
                        setEditedData({ ...editedData, period_end: date ? date.toISOString().split('T')[0] : null });
                      }}
                      placeholder="Pick a date"
                      disabled={!isEditing}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Input
                      disabled={!isEditing}
                      value={editedData.currency || ''}
                      onChange={(e) => setEditedData({ ...editedData, currency: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Total Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      disabled
                      className="bg-muted"
                      value={
                        editedData.extracted_data?.line_items && Array.isArray(editedData.extracted_data.line_items)
                          ? editedData.extracted_data.line_items.reduce((sum, item) => sum + (item.amount || 0), 0).toFixed(2)
                          : editedData.total_amount || ''
                      }
                    />
                  </div>
                </div>

                {editedData.extracted_data && (
                  <div className="space-y-4 p-4 border rounded-lg">
                    <Label className="text-base font-semibold">Additional Details</Label>
                    
                    {editedData.extracted_data.shop_number !== undefined && (
                      <div className="space-y-2">
                        <Label>Shop Number</Label>
                        <Input
                          disabled={!isEditing}
                          value={editedData.extracted_data.shop_number || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            extracted_data: { ...editedData.extracted_data, shop_number: e.target.value }
                          })}
                        />
                      </div>
                    )}

                    {editedData.extracted_data.tenant_name !== undefined && (
                      <div className="space-y-2">
                        <Label>Tenant Name</Label>
                        <Input
                          disabled={!isEditing}
                          value={editedData.extracted_data.tenant_name || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            extracted_data: { ...editedData.extracted_data, tenant_name: e.target.value }
                          })}
                        />
                      </div>
                    )}

                    {editedData.extracted_data.account_reference !== undefined && (
                      <div className="space-y-2">
                        <Label>Account Reference</Label>
                        <Input
                          disabled={!isEditing}
                          value={editedData.extracted_data.account_reference || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            extracted_data: { ...editedData.extracted_data, account_reference: e.target.value }
                          })}
                        />
                      </div>
                    )}

                    {/* Line Items Section */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Line Items</Label>
                        {isEditing && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditedData({
                                ...editedData,
                                extracted_data: {
                                  ...editedData.extracted_data,
                                  line_items: [
                                    ...(editedData.extracted_data?.line_items || []),
                                    {
                                      description: '',
                                      meter_number: '',
                                      previous_reading: 0,
                                      current_reading: 0,
                                      consumption: 0,
                                      rate: 0,
                                      amount: 0
                                    }
                                  ]
                                }
                              });
                            }}
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            Add Line Item
                          </Button>
                        )}
                      </div>
                      
                      {editedData.extracted_data?.line_items && Array.isArray(editedData.extracted_data.line_items) && editedData.extracted_data.line_items.length > 0 ? (
                        <>
                          <Accordion type="single" collapsible className="w-full">
                            {editedData.extracted_data.line_items.map((item: any, index: number) => (
                              <AccordionItem key={index} value={`item-${index}`}>
                                <AccordionTrigger className="hover:no-underline">
                                  <div className="flex items-center justify-between w-full pr-4">
                                    <span className="font-medium">{item.description || `Line Item ${index + 1}`}</span>
                                    <span className="text-sm text-muted-foreground">
                                      {editedData.currency} {(item.amount || 0).toFixed(2)}
                                    </span>
                                  </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                  <div className="space-y-3 pt-2">
                                    <div className="flex justify-end">
                                      {isEditing && (
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() => {
                                            setEditedData({
                                              ...editedData,
                                              extracted_data: {
                                                ...editedData.extracted_data,
                                                line_items: editedData.extracted_data.line_items.filter((_: any, i: number) => i !== index)
                                              }
                                            });
                                          }}
                                        >
                                          <Trash2 className="w-4 h-4 mr-1" />
                                          Delete
                                        </Button>
                                      )}
                                    </div>
                                    
                                    <div>
                                      <Label className="text-sm">Description</Label>
                                      <Input
                                        value={item.description || ''}
                                        onChange={(e) => {
                                          const newItems = [...editedData.extracted_data.line_items];
                                          newItems[index] = { ...newItems[index], description: e.target.value };
                                          setEditedData({
                                            ...editedData,
                                            extracted_data: { ...editedData.extracted_data, line_items: newItems }
                                          });
                                        }}
                                        disabled={!isEditing}
                                      />
                                    </div>
                                    
                                    <div>
                                      <Label className="text-sm">Meter Number</Label>
                                      <Input
                                        value={item.meter_number || ''}
                                        onChange={(e) => {
                                          const newItems = [...editedData.extracted_data.line_items];
                                          newItems[index] = { ...newItems[index], meter_number: e.target.value };
                                          setEditedData({
                                            ...editedData,
                                            extracted_data: { ...editedData.extracted_data, line_items: newItems }
                                          });
                                        }}
                                        disabled={!isEditing}
                                      />
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-3">
                                      <div>
                                        <Label className="text-sm">Previous Reading</Label>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={item.previous_reading || ''}
                                          onChange={(e) => {
                                            const value = parseFloat(e.target.value) || 0;
                                            const newItems = [...editedData.extracted_data.line_items];
                                            const current = newItems[index].current_reading || 0;
                                            const consumption = current - value;
                                            const rate = newItems[index].rate || 0;
                                            newItems[index] = { 
                                              ...newItems[index], 
                                              previous_reading: value,
                                              consumption: consumption,
                                              amount: consumption * rate
                                            };
                                            setEditedData({
                                              ...editedData,
                                              extracted_data: { ...editedData.extracted_data, line_items: newItems }
                                            });
                                          }}
                                          disabled={!isEditing}
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-sm">Current Reading</Label>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={item.current_reading || ''}
                                          onChange={(e) => {
                                            const value = parseFloat(e.target.value) || 0;
                                            const newItems = [...editedData.extracted_data.line_items];
                                            const previous = newItems[index].previous_reading || 0;
                                            const consumption = value - previous;
                                            const rate = newItems[index].rate || 0;
                                            newItems[index] = { 
                                              ...newItems[index], 
                                              current_reading: value,
                                              consumption: consumption,
                                              amount: consumption * rate
                                            };
                                            setEditedData({
                                              ...editedData,
                                              extracted_data: { ...editedData.extracted_data, line_items: newItems }
                                            });
                                          }}
                                          disabled={!isEditing}
                                        />
                                      </div>
                                    </div>
                                    
                                    <div className="grid grid-cols-3 gap-3">
                                      <div>
                                        <Label className="text-sm">Consumption</Label>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={(item.consumption || 0).toFixed(2)}
                                          disabled
                                          className="bg-muted"
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-sm">Rate</Label>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={item.rate || ''}
                                          onChange={(e) => {
                                            const value = parseFloat(e.target.value) || 0;
                                            const newItems = [...editedData.extracted_data.line_items];
                                            const consumption = newItems[index].consumption || 0;
                                            newItems[index] = { 
                                              ...newItems[index], 
                                              rate: value,
                                              amount: consumption * value
                                            };
                                            setEditedData({
                                              ...editedData,
                                              extracted_data: { ...editedData.extracted_data, line_items: newItems }
                                            });
                                          }}
                                          disabled={!isEditing}
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-sm">Amount</Label>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={(item.amount || 0).toFixed(2)}
                                          disabled
                                          className="bg-muted"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            ))}
                          </Accordion>
                          
                          {/* Consumption Summary */}
                          <div className="mt-4 grid grid-cols-2 gap-4">
                            {(() => {
                              // Sort line items by their order in the array to maintain document order
                              const sortedItems = [...editedData.extracted_data.line_items];
                              
                              // Identify generator items by keywords in description or meter designation
                              const isGeneratorItem = (item: any) => {
                                const desc = item.description?.toLowerCase() || '';
                                const meter = item.meter_number?.toLowerCase() || '';
                                return desc.includes('generator') || 
                                       desc.includes('standby') || 
                                       desc.includes('gen ') ||
                                       meter.includes('_t2') || // T2 meters are typically generator
                                       meter.includes('gen');
                              };
                              
                              const councilItems = sortedItems.filter((item: any) => !isGeneratorItem(item));
                              const generatorItems = sortedItems.filter((item: any) => isGeneratorItem(item));
                              
                              const councilKwh = councilItems.reduce((sum: number, item: any) => sum + (item.consumption || 0), 0);
                              const councilAmount = councilItems.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
                              const generatorKwh = generatorItems.reduce((sum: number, item: any) => sum + (item.consumption || 0), 0);
                              const generatorAmount = generatorItems.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
                              
                              return (
                                <>
                                  <div className="p-4 border rounded-lg bg-primary/5">
                                    <div className="text-sm font-medium text-muted-foreground mb-2">Council Supply</div>
                                    <div className="space-y-1">
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm">Consumption:</span>
                                        <span className="font-semibold">{councilKwh.toFixed(2)} kWh</span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm">Amount:</span>
                                        <span className="font-semibold">{editedData.currency} {councilAmount.toFixed(2)}</span>
                                      </div>
                                      <div className="text-xs text-muted-foreground mt-2">
                                        {councilItems.length} line item(s)
                                      </div>
                                    </div>
                                  </div>
                                  
                                  <div className="p-4 border rounded-lg bg-accent/5">
                                    <div className="text-sm font-medium text-muted-foreground mb-2">Generator/Standby Supply</div>
                                    <div className="space-y-1">
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm">Consumption:</span>
                                        <span className="font-semibold">{generatorKwh.toFixed(2)} kWh</span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm">Amount:</span>
                                        <span className="font-semibold">{editedData.currency} {generatorAmount.toFixed(2)}</span>
                                      </div>
                                      <div className="text-xs text-muted-foreground mt-2">
                                        {generatorItems.length} line item(s)
                                      </div>
                                    </div>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">No line items extracted</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
          )}
          
          {viewingDocument && editedData && (
            <div className="grid grid-cols-2 gap-6 pt-4 border-t flex-shrink-0">
              {/* Left side buttons - Selection controls */}
              <div className="flex items-center justify-center gap-2">
                {!selectionMode ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleStartSelection}
                  >
                    <Square className="w-4 h-4 mr-2" />
                    Select Region
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelSelection}
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Cancel Selection
                  </Button>
                )}
                {selectionRectRef.current && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleRescanRegion}
                    disabled={isExtracting}
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Rescanning...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Rescan Region
                      </>
                    )}
                  </Button>
                )}
              </div>
              
              {/* Right side buttons - Edit controls */}
              <div className="flex justify-end gap-2">
                {bulkEditQueue.length > 0 && (
                  <Button 
                    variant="outline" 
                    onClick={handleSkipToNext}
                    disabled={currentBulkEditIndex >= bulkEditQueue.length - 1 || isSaving}
                  >
                    Skip to Next
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  onClick={() => setIsEditing(!isEditing)}
                >
                  {isEditing ? 'Lock' : 'Edit'}
                </Button>
                <Button variant="outline" onClick={handleReset} disabled={!isEditing}>
                  Reset
                </Button>
                <Button onClick={handleSave} disabled={isSaving || !isEditing}>
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {bulkEditQueue.length > 0 && currentBulkEditIndex < bulkEditQueue.length - 1 ? 'Saving & Next...' : 'Saving...'}
                    </>
                  ) : (
                    <>
                      {bulkEditQueue.length > 0 && currentBulkEditIndex < bulkEditQueue.length - 1 ? 'Save & Next' : 'Save'}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Rename Folder Dialog */}
      <Dialog open={renamingFolder !== null} onOpenChange={(open) => !open && setRenamingFolder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>Enter a new name for the folder</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              value={renameFolderName}
              onChange={(e) => setRenameFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renamingFolder) {
                  const folder = documents.find(d => d.id === renamingFolder);
                  if (folder) {
                    // Construct full path: parent path + folder name
                    const oldFullPath = folder.folder_path ? `${folder.folder_path}/${folder.file_name}` : folder.file_name;
                    handleRenameFolder(renamingFolder, oldFullPath);
                  }
                }
              }}
              placeholder="New folder name"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamingFolder(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (renamingFolder) {
                  const folder = documents.find(d => d.id === renamingFolder);
                  if (folder) {
                    // Construct full path: parent path + folder name
                    const oldFullPath = folder.folder_path ? `${folder.folder_path}/${folder.file_name}` : folder.file_name;
                    handleRenameFolder(renamingFolder, oldFullPath);
                  }
                }
              }}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Subfolder Dialog */}
      <Dialog open={creatingSubfolderFor !== null} onOpenChange={(open) => !open && setCreatingSubfolderFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Subfolder</DialogTitle>
            <DialogDescription>
              Create a new folder inside {creatingSubfolderFor?.split('/').pop()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && creatingSubfolderFor) {
                  handleCreateFolder(creatingSubfolderFor);
                }
              }}
              placeholder="Folder name"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setCreatingSubfolderFor(null);
              setNewFolderName('');
            }}>
              Cancel
            </Button>
            <Button
              onClick={() => creatingSubfolderFor && handleCreateFolder(creatingSubfolderFor)}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Document Type Dialog */}
      <Dialog open={isTypeChangeDialogOpen} onOpenChange={setIsTypeChangeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Document Type</DialogTitle>
            <DialogDescription>
              Change the type for {Array.from(selectedDocuments).filter(id => {
                const doc = documents.find(d => d.id === id);
                return doc && !doc.is_folder;
              }).length} selected document(s)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-3">
              <Label>Select Document Type</Label>
              <RadioGroup value={selectedDocumentType} onValueChange={(value: any) => setSelectedDocumentType(value)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="municipal_account" id="municipal_account" />
                  <Label htmlFor="municipal_account" className="font-normal cursor-pointer">Municipal Account</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="tenant_bill" id="tenant_bill" />
                  <Label htmlFor="tenant_bill" className="font-normal cursor-pointer">Tenant Bill</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="other" id="other" />
                  <Label htmlFor="other" className="font-normal cursor-pointer">Other</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="report" id="report" />
                  <Label htmlFor="report" className="font-normal cursor-pointer">Report</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsTypeChangeDialogOpen(false)}
              disabled={isBulkExtracting}
            >
              Cancel
            </Button>
            <Button onClick={handleBulkTypeChange} disabled={isBulkExtracting}>
              {isBulkExtracting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                'Confirm'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Dialog */}
      <Dialog open={isMoveDialogOpen} onOpenChange={setIsMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Folder</DialogTitle>
            <DialogDescription>
              Select a destination folder for {selectedDocuments.size} document(s)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Destination Folder</Label>
              <Select value={moveDestinationFolder} onValueChange={setMoveDestinationFolder}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a folder..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Root (No folder)</SelectItem>
                  {getAvailableFolders()
                    .filter(f => f !== '__root__')
                    .map((folder) => (
                      <SelectItem key={folder} value={folder}>
                        {folder}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsMoveDialogOpen(false);
                setMoveDestinationFolder('');
              }}
              disabled={isMoving}
            >
              Cancel
            </Button>
            <Button onClick={handleMoveToFolder} disabled={isMoving}>
              {isMoving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Moving...
                </>
              ) : (
                'Move'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}