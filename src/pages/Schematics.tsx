import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Plus, FileText, Upload, Eye, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

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
  sites: { name: string; clients: { name: string } | null } | null;
}

interface Site {
  id: string;
  name: string;
  clients: { name: string } | null;
}

export default function Schematics() {
  const navigate = useNavigate();
  const [schematics, setSchematics] = useState<Schematic[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [schematicToDelete, setSchematicToDelete] = useState<Schematic | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [convertingIds, setConvertingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchSchematics();
    fetchSites();
  }, []);

  const fetchSchematics = async () => {
    const { data, error } = await supabase
      .from("schematics")
      .select("*, sites(name, clients(name))")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch schematics");
    } else {
      setSchematics(data || []);
    }
  };

  const fetchSites = async () => {
    const { data } = await supabase
      .from("sites")
      .select("id, name, clients(name)")
      .order("name");
    setSites(data || []);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/svg+xml'];
      if (!validTypes.includes(file.type)) {
        toast.error("Invalid file type. Please upload PDF, PNG, JPG, or SVG");
        return;
      }
      // Validate file size (50MB)
      if (file.size > 52428800) {
        toast.error("File size must be less than 50MB");
        return;
      }
      setSelectedFile(file);
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
    const siteId = formData.get("site") as string;
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const totalPages = parseInt(formData.get("total_pages") as string) || 1;

    try {
      // Upload file to storage
      const fileName = `${Date.now()}-${selectedFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("schematics")
        .upload(fileName, selectedFile);

      if (uploadError) throw uploadError;

      // Get user
      const { data: { user } } = await supabase.auth.getUser();

      // Create schematic record
      const { error: dbError } = await supabase.from("schematics").insert({
        site_id: siteId,
        name,
        description: description || null,
        file_path: fileName,
        file_type: selectedFile.type,
        total_pages: totalPages,
        uploaded_by: user?.id,
      });

      if (dbError) throw dbError;

      toast.success("Schematic uploaded successfully");
      setIsDialogOpen(false);
      setSelectedFile(null);
      fetchSchematics();
    } catch (error: any) {
      toast.error(error.message || "Failed to upload schematic");
    } finally {
      setIsLoading(false);
    }
  };

  const getFileTypeIcon = (type: string) => {
    if (type === 'application/pdf') return '📄';
    if (type.startsWith('image/')) return '🖼️';
    return '📋';
  };

  const handleDeleteClick = (schematic: Schematic) => {
    setSchematicToDelete(schematic);
    setDeleteDialogOpen(true);
  };

  const handleConvertPdf = async (schematic: Schematic) => {
    setConvertingIds(prev => new Set(prev).add(schematic.id));
    
    try {
      toast.info("Converting PDF to image in browser...");
      
      // Download the PDF from storage
      const { data: pdfBlob, error: downloadError } = await supabase
        .storage
        .from('schematics')
        .download(schematic.file_path);
      
      if (downloadError || !pdfBlob) {
        throw new Error('Failed to download PDF');
      }

      // Convert blob to array buffer
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Load PDF with PDF.js (using the worker already configured in dependencies)
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
      
      // Use unpkg CDN for worker (more reliable)
      GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      
      const loadingTask = getDocument({ data: uint8Array });
      const pdf = await loadingTask.promise;
      
      // Get first page
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2.0 });
      
      // Create canvas
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: false });
      
      if (!context) throw new Error('Could not get canvas context');
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      // Render PDF page to canvas
      await page.render({
        canvasContext: context,
        viewport: viewport,
      } as any).promise;
      
      // Convert canvas to blob
      const imageBlob = await new Promise<Blob>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Blob conversion timeout')), 10000);
        canvas.toBlob(
          (blob) => {
            clearTimeout(timeout);
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
          },
          'image/png',
          0.95
        );
      });
      
      // Generate unique filename for converted image
      const imagePath = `${schematic.file_path.replace('.pdf', '')}_converted.png`;
      
      // Upload converted image to storage
      const { error: uploadError } = await supabase
        .storage
        .from('schematics')
        .upload(imagePath, imageBlob, {
          contentType: 'image/png',
          upsert: true,
        });
      
      if (uploadError) throw uploadError;
      
      // Update schematic record with converted image path
      const { error: updateError } = await supabase
        .from('schematics')
        .update({ converted_image_path: imagePath })
        .eq('id', schematic.id);
      
      if (updateError) throw updateError;

      toast.success("PDF converted successfully!");
      fetchSchematics();
    } catch (error: any) {
      console.error("Conversion error:", error);
      toast.error(error.message || "Failed to convert PDF");
    } finally {
      setConvertingIds(prev => {
        const next = new Set(prev);
        next.delete(schematic.id);
        return next;
      });
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

      // Delete the files from storage
      const filesToDelete = [schematicToDelete.file_path];
      if (schematicToDelete.converted_image_path) {
        filesToDelete.push(schematicToDelete.converted_image_path);
      }

      const { error: storageError } = await supabase.storage
        .from("schematics")
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
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">Schematics</h1>
            <p className="text-muted-foreground">
              Upload and manage electrical distribution diagrams
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Upload Schematic
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Upload Schematic Diagram</DialogTitle>
                <DialogDescription>
                  Upload electrical distribution diagrams (PDF, PNG, JPG, SVG)
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="site">Site</Label>
                  <Select name="site" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select site" />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={site.id}>
                          {site.name} {site.clients && `(${site.clients.name})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="name">Schematic Name</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    placeholder="Main Distribution Board - Level 1"
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
                  <p className="text-xs text-muted-foreground">
                    If uploading a multi-page schematic set
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="file">File Upload</Label>
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary transition-colors">
                    <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <Input
                      id="file"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.svg"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <Label
                      htmlFor="file"
                      className="cursor-pointer text-sm text-muted-foreground"
                    >
                      {selectedFile ? (
                        <div className="text-primary font-medium">
                          {selectedFile.name}
                          <p className="text-xs text-muted-foreground mt-1">
                            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      ) : (
                        <div>
                          <span className="text-primary font-medium">Click to upload</span> or
                          drag and drop
                          <p className="text-xs mt-1">PDF, PNG, JPG, SVG (max 50MB)</p>
                        </div>
                      )}
                    </Label>
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading || !selectedFile}>
                  {isLoading ? "Uploading..." : "Upload Schematic"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {schematics.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <FileText className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No schematics yet</h3>
              <p className="text-muted-foreground mb-4">
                Upload your first electrical distribution diagram
              </p>
              <Button onClick={() => setIsDialogOpen(true)} disabled={sites.length === 0}>
                <Plus className="w-4 h-4 mr-2" />
                Upload Schematic
              </Button>
              {sites.length === 0 && (
                <p className="text-sm text-warning mt-2">Please create a site first</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>All Schematics</CardTitle>
              <CardDescription>
                {schematics.length} schematic{schematics.length !== 1 ? "s" : ""} uploaded
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Pages</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schematics.map((schematic) => (
                    <TableRow key={schematic.id}>
                      <TableCell>
                        <span className="text-2xl">{getFileTypeIcon(schematic.file_type)}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{schematic.name}</span>
                          {schematic.description && (
                            <span className="text-xs text-muted-foreground">
                              {schematic.description}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{schematic.sites?.name || "—"}</span>
                          {schematic.sites?.clients && (
                            <span className="text-xs text-muted-foreground">
                              {schematic.sites.clients.name}
                            </span>
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
                            size="sm"
                            onClick={() => navigate(`/schematics/${schematic.id}`)}
                          >
                            <Eye className="w-4 h-4 mr-2" />
                            View
                          </Button>
                          {schematic.file_type === 'application/pdf' && !schematic.converted_image_path && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleConvertPdf(schematic)}
                              disabled={convertingIds.has(schematic.id)}
                            >
                              <RefreshCw className={`w-4 h-4 mr-2 ${convertingIds.has(schematic.id) ? 'animate-spin' : ''}`} />
                              Convert
                            </Button>
                          )}
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
    </DashboardLayout>
  );
}
