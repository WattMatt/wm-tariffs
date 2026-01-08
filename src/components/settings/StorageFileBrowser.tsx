import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, 
  Trash2, 
  FolderOpen, 
  FileIcon, 
  ChevronLeft, 
  Database,
  RefreshCw,
  CheckSquare,
  Square
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface StorageFile {
  id: string | null;
  name: string;
  created_at: string | null;
  updated_at: string | null;
  metadata: {
    size?: number;
    mimetype?: string;
  } | null;
}

interface StorageFileBrowserProps {
  onCleanupComplete?: () => void;
}

export const StorageFileBrowser = ({ onCleanupComplete }: StorageFileBrowserProps) => {
  const { toast } = useToast();
  const [selectedBucket, setSelectedBucket] = useState<'client-files' | 'tariff-files'>('client-files');
  const [currentPath, setCurrentPath] = useState<string>("");
  const [items, setItems] = useState<StorageFile[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadContents(currentPath);
  }, [selectedBucket]);

  const loadContents = async (path: string) => {
    setIsLoading(true);
    setSelectedFiles(new Set());
    try {
      const { data, error } = await supabase.storage
        .from(selectedBucket)
        .list(path, {
          limit: 500,
          sortBy: { column: 'name', order: 'asc' }
        });

      if (error) throw error;

      const items = data || [];
      
      // Separate folders (id === null) from files
      const folderList = items
        .filter(item => item.id === null)
        .map(item => item.name);
      
      const fileList = items.filter(item => item.id !== null) as StorageFile[];

      setFolders(folderList);
      setFiles(fileList);
      setItems(items as StorageFile[]);
      setCurrentPath(path);
    } catch (error: any) {
      console.error("Error loading contents:", error);
      toast({
        title: "Error",
        description: "Failed to load storage contents",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBucketChange = (bucket: 'client-files' | 'tariff-files') => {
    setSelectedBucket(bucket);
    setCurrentPath("");
    loadContents("");
  };

  const handleFolderClick = (folderName: string) => {
    const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;
    loadContents(newPath);
  };

  const handleGoBack = () => {
    const pathParts = currentPath.split('/');
    pathParts.pop();
    const newPath = pathParts.join('/');
    loadContents(newPath);
  };

  const handleFileSelect = (fileName: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(fileName)) {
      newSelected.delete(fileName);
    } else {
      newSelected.add(fileName);
    }
    setSelectedFiles(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.name)));
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleDeleteSelected = async () => {
    if (selectedFiles.size === 0) {
      toast({
        title: "No files selected",
        description: "Please select files to delete",
        variant: "destructive",
      });
      return;
    }

    setIsDeleting(true);
    try {
      const filePaths = Array.from(selectedFiles).map(fileName => 
        currentPath ? `${currentPath}/${fileName}` : fileName
      );

      const { error } = await supabase.storage
        .from(selectedBucket)
        .remove(filePaths);

      if (error) throw error;

      toast({
        title: "Files Deleted",
        description: `Successfully deleted ${selectedFiles.size} file(s)`,
      });

      setSelectedFiles(new Set());
      loadContents(currentPath);
      onCleanupComplete?.();
    } catch (error: any) {
      console.error("Delete error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete files",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Label className="text-sm font-medium mb-2 block">Storage Bucket</Label>
          <Select value={selectedBucket} onValueChange={(value: 'client-files' | 'tariff-files') => handleBucketChange(value)}>
            <SelectTrigger className="w-full max-w-xs">
              <Database className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="client-files">client-files</SelectItem>
              <SelectItem value="tariff-files">tariff-files</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadContents(currentPath)}
          disabled={isLoading}
          className="mt-6"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Breadcrumb / Path navigation */}
      <div className="flex items-center gap-2 text-sm">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => loadContents("")}
          disabled={isLoading || !currentPath}
          className="h-8 px-2"
        >
          <Database className="w-4 h-4" />
        </Button>
        {currentPath && (
          <>
            <span className="text-muted-foreground">/</span>
            {currentPath.split('/').map((part, index, arr) => {
              const path = arr.slice(0, index + 1).join('/');
              return (
                <div key={path} className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => loadContents(path)}
                    disabled={isLoading}
                    className="h-8 px-2"
                  >
                    {part}
                  </Button>
                  {index < arr.length - 1 && <span className="text-muted-foreground">/</span>}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Back button */}
      {currentPath && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleGoBack}
          disabled={isLoading}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
      )}

      {/* File list */}
      <div className="border rounded-lg">
        {/* Header with select all */}
        {files.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              className="h-8 px-2"
            >
              {selectedFiles.size === files.length ? (
                <CheckSquare className="w-4 h-4 mr-2" />
              ) : (
                <Square className="w-4 h-4 mr-2" />
              )}
              {selectedFiles.size === files.length ? 'Deselect All' : 'Select All'}
            </Button>
            {selectedFiles.size > 0 && (
              <span className="text-sm text-muted-foreground">
                {selectedFiles.size} selected
              </span>
            )}
          </div>
        )}

        <ScrollArea className="h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : folders.length === 0 && files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <FolderOpen className="w-8 h-8 mb-2" />
              <p>This folder is empty</p>
            </div>
          ) : (
            <div className="divide-y">
              {/* Folders */}
              {folders.map((folderName) => (
                <div
                  key={folderName}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleFolderClick(folderName)}
                >
                  <FolderOpen className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <span className="flex-1 truncate font-medium">{folderName}</span>
                  <span className="text-sm text-muted-foreground">Folder</span>
                </div>
              ))}
              
              {/* Files */}
              {files.map((file) => (
                <div
                  key={file.name}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedFiles.has(file.name)}
                    onCheckedChange={() => handleFileSelect(file.name)}
                    className="flex-shrink-0"
                  />
                  <FileIcon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.metadata?.size)}
                      {file.created_at && ` • ${formatDistanceToNow(new Date(file.created_at), { addSuffix: true })}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Delete button */}
      <div className="flex justify-end">
        <Button
          variant="destructive"
          onClick={handleDeleteSelected}
          disabled={isDeleting || selectedFiles.size === 0}
        >
          {isDeleting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Deleting...
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Selected ({selectedFiles.size})
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
