import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Plus, FileText, Upload, Eye, Network, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import MeterConnectionsDialog from "@/components/schematic/MeterConnectionsDialog";

interface Schematic {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  file_type: string;
  page_number: number;
  total_pages: number;
  created_at: string;
  converted_image_path: string | null;
}

interface SchematicsTabProps {
  siteId: string;
}

export default function SchematicsTab({ siteId }: SchematicsTabProps) {
  const navigate = useNavigate();
  const [schematics, setSchematics] = useState<Schematic[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showConnectionsDialog, setShowConnectionsDialog] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [schematicToDelete, setSchematicToDelete] = useState<Schematic | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedSchematicIds, setSelectedSchematicIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [schematicName, setSchematicName] = useState("");
  const [isNameManuallyEdited, setIsNameManuallyEdited] = useState(false);

  useEffect(() => {
    fetchSchematics();
    
    // Set up realtime subscription for schematics changes
    const channel = supabase
      .channel('schematics-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'schematics',
          filter: `site_id=eq.${siteId}`
        },
        () => {
          fetchSchematics();
        }
      )
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [siteId]);

  const fetchSchematics = async () => {
    setIsFetching(true);
    const { data, error } = await supabase
      .from("schematics")
      .select("*")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching schematics:", error);
      toast.error("Failed to fetch schematics");
      setSchematics([]);
    } else {
      setSchematics(data || []);
    }
    setIsFetching(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validTypes = ["application/pdf", "image/png", "image/jpeg", "image/svg+xml"];
      if (!validTypes.includes(file.type)) {
        toast.error("Invalid file type. Please upload PDF, PNG, JPG, or SVG");
        return;
      }
      if (file.size > 52428800) {
        toast.error("File size must be less than 50MB");
        return;
      }
      setSelectedFile(file);
      
      // Auto-populate name field if empty and not manually edited
      if (!isNameManuallyEdited && !schematicName.trim()) {
        const nameWithoutExtension = file.name.replace(/\.(pdf|png|jpg|jpeg|svg)$/i, '');
        setSchematicName(nameWithoutExtension);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const validTypes = ["application/pdf", "image/png", "image/jpeg", "image/svg+xml"];
      
      if (!validTypes.includes(file.type)) {
        toast.error("Invalid file type. Please upload PDF, PNG, JPG, or SVG");
        return;
      }
      
      if (file.size > 52428800) {
        toast.error("File size must be less than 50MB");
        return;
      }
      
      setSelectedFile(file);
      
      // Auto-populate name field if empty and not manually edited
      if (!isNameManuallyEdited && !schematicName.trim()) {
        const nameWithoutExtension = file.name.replace(/\.(pdf|png|jpg|jpeg|svg)$/i, '');
        setSchematicName(nameWithoutExtension);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }

    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const totalPages = parseInt(formData.get("total_pages") as string) || 1;

    try {
      const timestamp = Date.now();
      const fileName = `${timestamp}-${selectedFile.name}`;
      
      // Generate hierarchical storage path
      const { generateStoragePath } = await import("@/lib/storagePaths");
      const { bucket, path: filePath } = await generateStoragePath(siteId, 'Metering', 'Schematics', fileName);
      
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, selectedFile);

      if (uploadError) throw uploadError;

      const { data: { user } } = await supabase.auth.getUser();

      const { data: schematicData, error: dbError } = await supabase
        .from("schematics")
        .insert({
          name,
          description: description || null,
          file_path: filePath,
          file_type: selectedFile.type,
          total_pages: totalPages,
          uploaded_by: user?.id,
          site_id: siteId,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      toast.success("Schematic uploaded successfully");
      
      // Auto-convert PDF to image using client-side conversion
      if (selectedFile.type === "application/pdf" && schematicData) {
        toast.info("Converting PDF to image for faster viewing...");
        
        try {
          // Import PDF.js - use dynamic import for worker
          const pdfjsLib = await import('pdfjs-dist');
          
          // Set worker to use the npm package worker (works with Vite)
          const pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
          pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker.default;
          
          // Load PDF from the uploaded file
          const arrayBuffer = await selectedFile.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          
          // Get first page
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for better quality
          
          // Create canvas
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          
          // Render PDF page to canvas
          await page.render({
            canvasContext: context!,
            viewport: viewport,
          } as any).promise;
          
          // Convert canvas to blob
          const blob = await new Promise<Blob>((resolve) => {
            canvas.toBlob((blob) => resolve(blob!), 'image/png');
          });
          
          // Generate path for converted image
          const convertedImageName = `${timestamp}-${selectedFile.name.replace('.pdf', '')}_converted.png`;
          const { path: convertedImagePath } = await generateStoragePath(siteId, 'Metering', 'Schematics', convertedImageName);
          
          // Upload converted image
          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(convertedImagePath, blob, {
              contentType: 'image/png',
            });
          
          if (uploadError) throw uploadError;
          
          // Update schematic record with converted image path
          const { error: updateError } = await supabase
            .from('schematics')
            .update({ converted_image_path: convertedImagePath })
            .eq('id', schematicData.id);
          
          if (updateError) throw updateError;
          
          toast.success('PDF converted to image successfully');
          fetchSchematics(); // Refresh to show converted status
        } catch (conversionError: any) {
          console.error('PDF conversion failed:', conversionError);
          toast.error('PDF conversion failed, but file is uploaded');
        }
      }

      setIsDialogOpen(false);
      setSelectedFile(null);
      setSchematicName("");
      setIsNameManuallyEdited(false);
      fetchSchematics();
    } catch (error: any) {
      toast.error(error.message || "Failed to upload schematic");
    } finally {
      setIsLoading(false);
    }
  };

  const getFileTypeIcon = (type: string) => {
    if (type === "application/pdf") return "📄";
    if (type.startsWith("image/")) return "🖼️";
    return "📋";
  };

  const handleDeleteClick = (schematic: Schematic) => {
    setSchematicToDelete(schematic);
    setDeleteDialogOpen(true);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedSchematicIds(new Set(schematics.map(s => s.id)));
    } else {
      setSelectedSchematicIds(new Set());
    }
  };

  const handleSelectSchematic = (schematicId: string, checked: boolean) => {
    const newSelection = new Set(selectedSchematicIds);
    if (checked) {
      newSelection.add(schematicId);
    } else {
      newSelection.delete(schematicId);
    }
    setSelectedSchematicIds(newSelection);
  };

  const handleBulkDelete = async () => {
    if (selectedSchematicIds.size === 0) return;
    
    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedSchematicIds.size} schematic${selectedSchematicIds.size !== 1 ? 's' : ''}? This action cannot be undone and will also delete all associated meter positions and connections.`
    );
    
    if (!confirmed) return;
    
    setIsBulkDeleting(true);
    try {
      let successCount = 0;
      let errorCount = 0;

      for (const schematicId of Array.from(selectedSchematicIds)) {
        const schematic = schematics.find(s => s.id === schematicId);
        if (!schematic) continue;

        try {
          // Delete associated meter positions
          await supabase
            .from("meter_positions")
            .delete()
            .eq("schematic_id", schematicId);

          // Delete files from storage
          const filesToDelete = [schematic.file_path];
          if (schematic.converted_image_path) {
            filesToDelete.push(schematic.converted_image_path);
          }

          await supabase.storage
            .from("client-files")
            .remove(filesToDelete);

          // Delete the schematic record
          const { error: dbError } = await supabase
            .from("schematics")
            .delete()
            .eq("id", schematicId);

          if (dbError) throw dbError;
          successCount++;
        } catch (error) {
          console.error(`Error deleting schematic ${schematicId}:`, error);
          errorCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully deleted ${successCount} schematic${successCount !== 1 ? 's' : ''}`);
        setSelectedSchematicIds(new Set());
        fetchSchematics();
      }
      
      if (errorCount > 0) {
        toast.error(`Failed to delete ${errorCount} schematic${errorCount !== 1 ? 's' : ''}`);
      }
    } catch (error: any) {
      toast.error("An error occurred while deleting schematics");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!schematicToDelete) return;

    setIsDeleting(true);
    try {
      // First, delete associated meter positions
      const { error: positionsError } = await supabase
        .from("meter_positions")
        .delete()
        .eq("schematic_id", schematicToDelete.id);

      if (positionsError) {
        console.error("Error deleting meter positions:", positionsError);
        // Continue anyway, non-critical
      }

      // Delete the files from storage (using client-files bucket)
      const filesToDelete = [schematicToDelete.file_path];
      if (schematicToDelete.converted_image_path) {
        filesToDelete.push(schematicToDelete.converted_image_path);
      }

      const { error: storageError } = await supabase.storage
        .from("client-files")
        .remove(filesToDelete);

      if (storageError) {
        console.error("Error deleting files from storage:", storageError);
        // Continue anyway to delete the database record
      }

      // Delete the schematic record
      const { error: dbError } = await supabase
        .from("schematics")
        .delete()
        .eq("id", schematicToDelete.id);

      if (dbError) throw dbError;

      toast.success("Schematic deleted successfully");
      fetchSchematics();
    } catch (error: any) {
      console.error("Error deleting schematic:", error);
      toast.error(error.message || "Failed to delete schematic");
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setSchematicToDelete(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Schematics</h2>
          <p className="text-muted-foreground">Electrical distribution diagrams for this site</p>
        </div>
        <div className="flex gap-2">
          {selectedSchematicIds.size > 0 && (
            <Button
              variant="outline"
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {isBulkDeleting ? "Deleting..." : `Delete ${selectedSchematicIds.size} Selected`}
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowConnectionsDialog(true)} className="gap-2">
            <Network className="w-4 h-4" />
            Meter Connections
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) {
              // Reset form when dialog closes
              setSelectedFile(null);
              setSchematicName("");
              setIsNameManuallyEdited(false);
            }
          }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Upload Schematic
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Upload Schematic Diagram</DialogTitle>
              <DialogDescription>Upload electrical distribution diagrams (PDF, PNG, JPG, SVG)</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Schematic Name</Label>
                <Input 
                  id="name" 
                  name="name" 
                  required 
                  placeholder="Main Distribution Board - Level 1"
                  value={schematicName}
                  onChange={(e) => {
                    setSchematicName(e.target.value);
                    setIsNameManuallyEdited(true);
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Detailed description of the schematic..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="total_pages">Total Pages</Label>
                <Input
                  id="total_pages"
                  name="total_pages"
                  type="number"
                  min="1"
                  defaultValue="1"
                  placeholder="1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="file">File Upload</Label>
                <Label 
                  htmlFor="file"
                  className={`block border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                    isDragging 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:border-primary'
                  }`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <Input
                    id="file"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.svg"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div className="text-sm text-muted-foreground">
                    {selectedFile ? (
                      <div className="text-primary font-medium">
                        {selectedFile.name}
                        <p className="text-xs text-muted-foreground mt-1">
                          {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    ) : (
                      <div>
                        <span className="text-primary font-medium">Click to upload</span> or drag and drop
                        <p className="text-xs mt-1">PDF, PNG, JPG, SVG (max 50MB)</p>
                      </div>
                    )}
                  </div>
                </Label>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading || !selectedFile}>
                {isLoading ? "Uploading..." : "Upload Schematic"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {showConnectionsDialog && (
        <MeterConnectionsDialog
          siteId={siteId}
          onClose={() => setShowConnectionsDialog(false)}
        />
      )}

      {isFetching ? (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
            <p className="text-muted-foreground">Loading schematics...</p>
          </CardContent>
        </Card>
      ) : schematics.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No schematics yet</h3>
            <p className="text-muted-foreground mb-4">Upload your first electrical distribution diagram</p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Upload Schematic
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Site Schematics</CardTitle>
            <CardDescription>
              {schematics.length} schematic{schematics.length !== 1 ? "s" : ""} uploaded
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedSchematicIds.size === schematics.length && schematics.length > 0}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all schematics"
                    />
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Pages</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schematics.map((schematic) => (
                  <TableRow key={schematic.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedSchematicIds.has(schematic.id)}
                        onCheckedChange={(checked) => handleSelectSchematic(schematic.id, checked as boolean)}
                        aria-label={`Select ${schematic.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="text-2xl">{getFileTypeIcon(schematic.file_type)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{schematic.name}</span>
                        {schematic.description && (
                          <span className="text-xs text-muted-foreground">{schematic.description}</span>
                        )}
                        {schematic.file_type === "application/pdf" && (
                          <Badge 
                            variant={schematic.converted_image_path ? "default" : "secondary"}
                            className="w-fit text-xs"
                          >
                            {schematic.converted_image_path ? "✓ Converted" : "⏳ Converting..."}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {schematic.total_pages > 1 ? (
                        <Badge variant="outline">
                          {schematic.page_number} of {schematic.total_pages}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Single</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(schematic.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => navigate(`/schematics/${schematic.id}`)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteClick(schematic)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
          </Card>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Schematic?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete "{schematicToDelete?.name}" and all associated data including:
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>The schematic file and converted image</li>
                  <li>All meter positions on this schematic</li>
                </ul>
                <p className="mt-2 font-semibold">This action cannot be undone.</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="bg-destructive hover:bg-destructive/90"
              >
                {isDeleting ? "Deleting..." : "Delete Schematic"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }
