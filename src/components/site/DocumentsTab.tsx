import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Upload, Loader2, Download, Trash2, Eye, Network } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface DocumentsTabProps {
  siteId: string;
}

interface SiteDocument {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  document_type: string;
  upload_date: string;
  extraction_status: string;
  document_extractions: Array<{
    period_start: string;
    period_end: string;
    total_amount: number;
    currency: string;
    extracted_data: any;
  }>;
}

export default function DocumentsTab({ siteId }: DocumentsTabProps) {
  const [documents, setDocuments] = useState<SiteDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<string>("municipal_account");
  const [viewingExtraction, setViewingExtraction] = useState<any>(null);
  const [schematicPreviewUrl, setSchematicPreviewUrl] = useState<string | null>(null);
  const [isLoadingSchematic, setIsLoadingSchematic] = useState(false);

  useEffect(() => {
    fetchDocuments();
    fetchSchematicPreview();
  }, [siteId]);

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
          )
        `)
        .eq("site_id", siteId)
        .order("upload_date", { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error("Error fetching documents:", error);
      toast.error("Failed to load documents");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSchematicPreview = async () => {
    setIsLoadingSchematic(true);
    try {
      const { data: schematic, error } = await supabase
        .from("schematics")
        .select("file_path, converted_image_path")
        .eq("site_id", siteId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (schematic) {
        // Prefer converted image for PDFs, otherwise use original
        const imagePath = schematic.converted_image_path || schematic.file_path;
        
        const { data: urlData } = await supabase.storage
          .from("schematics")
          .createSignedUrl(imagePath, 3600);

        if (urlData?.signedUrl) {
          setSchematicPreviewUrl(urlData.signedUrl);
        }
      }
    } catch (error) {
      console.error("Error fetching schematic preview:", error);
      // Fail silently - schematic preview is optional
    } finally {
      setIsLoadingSchematic(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const convertPdfToImage = async (pdfFile: File): Promise<Blob> => {
    const pdfjsLib = await import('pdfjs-dist');
    
    // Use local worker from node_modules
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
    
    // Load PDF
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    // Get first page
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for quality
    
    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get canvas context');
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    }).promise;
    
    // Convert canvas to blob
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert canvas to blob'));
      }, 'image/png');
    });
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }

    setIsUploading(true);
    try {
      const timestamp = Date.now();
      const isPdf = selectedFile.name.toLowerCase().endsWith('.pdf');
      
      // Upload original file to storage
      const fileName = `${siteId}/${timestamp}-${selectedFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("site-documents")
        .upload(fileName, selectedFile);

      if (uploadError) throw uploadError;

      let imagePath = uploadData.path;
      
      // If PDF, convert to image and upload
      if (isPdf) {
        toast.info("Converting PDF to image...");
        try {
          const imageBlob = await convertPdfToImage(selectedFile);
          const imageName = `${siteId}/${timestamp}-${selectedFile.name.replace('.pdf', '.png')}`;
          
          const { data: imageUploadData, error: imageUploadError } = await supabase.storage
            .from("site-documents")
            .upload(imageName, imageBlob);

          if (imageUploadError) {
            console.error("Image upload error:", imageUploadError);
            toast.warning("PDF uploaded but image conversion failed");
          } else {
            imagePath = imageUploadData.path;
            toast.success("PDF converted to image successfully");
          }
        } catch (conversionError) {
          console.error("PDF conversion error:", conversionError);
          toast.warning("PDF uploaded but conversion failed - extraction may not work");
        }
      }

      // Create document record with both paths
      const { data: user } = await supabase.auth.getUser();
      const { error: docError } = await supabase
        .from("site_documents")
        .insert({
          site_id: siteId,
          file_name: selectedFile.name,
          file_path: uploadData.path,
          converted_image_path: isPdf ? imagePath : null,
          file_size: selectedFile.size,
          document_type: documentType as any,
          uploaded_by: user.user?.id || null,
          extraction_status: 'pending'
        });

      if (docError) throw docError;

      toast.success("Document uploaded successfully");
      setSelectedFile(null);
      fetchDocuments();
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload document");
    } finally {
      setIsUploading(false);
    }
  };

  const handleExtract = async () => {
    const pendingDocs = documents.filter(doc => doc.extraction_status === 'pending');
    
    if (pendingDocs.length === 0) {
      toast.info("No pending documents to extract");
      return;
    }

    setIsLoading(true);
    let successCount = 0;
    let failCount = 0;

    try {
      toast.info(`Starting extraction for ${pendingDocs.length} document(s)...`);

      for (const doc of pendingDocs) {
        try {
          // Use converted image path if available, otherwise use original file path
          const filePathToUse = (doc as any).converted_image_path || doc.file_path;
          
          // Get signed URL for AI processing
          const { data: urlData } = await supabase.storage
            .from("site-documents")
            .createSignedUrl(filePathToUse, 3600);

          if (urlData?.signedUrl) {
            const { error: extractError } = await supabase.functions.invoke("extract-document-data", {
              body: {
                documentId: doc.id,
                fileUrl: urlData.signedUrl,
                documentType: doc.document_type
              }
            });

            if (extractError) {
              console.error(`Extraction error for ${doc.file_name}:`, extractError);
              failCount++;
            } else {
              successCount++;
            }
          }
        } catch (error) {
          console.error(`Error processing ${doc.file_name}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully extracted ${successCount} document(s)`);
      }
      if (failCount > 0) {
        toast.error(`Failed to extract ${failCount} document(s)`);
      }

      fetchDocuments();
    } catch (error) {
      console.error("Extraction error:", error);
      toast.error("Failed to extract documents");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (filePath: string, fileName: string) => {
    try {
      const { data } = await supabase.storage
        .from("site-documents")
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
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      await supabase.storage.from("site-documents").remove([filePath]);
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/30">
            <div className="space-y-2">
              <Label htmlFor="document-type">Document Type</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
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
              <Label htmlFor="file-upload">Select File</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileSelect}
                disabled={isUploading}
              />
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading}
                className="w-full"
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

          <div className="flex justify-end">
            <Button
              onClick={handleExtract}
              disabled={isLoading || documents.filter(doc => doc.extraction_status === 'pending').length === 0}
              variant="secondary"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Extract Pending ({documents.filter(doc => doc.extraction_status === 'pending').length})
                </>
              )}
            </Button>
          </div>

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
                  <TableRow>
                    <TableHead>File Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Upload Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Extracted Period</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">{doc.file_name}</TableCell>
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
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {doc.document_extractions?.[0] && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setViewingExtraction(doc.document_extractions[0])}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownload(doc.file_path, doc.file_name)}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(doc.id, doc.file_path)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="w-5 h-5" />
            Site Schematic Preview
          </CardTitle>
          <CardDescription>
            Fixed reference view of the electrical distribution
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingSchematic ? (
            <div className="flex justify-center items-center h-64 bg-muted/30 rounded-lg">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : schematicPreviewUrl ? (
            <div className="relative bg-muted/30 rounded-lg overflow-hidden border">
              <img 
                src={schematicPreviewUrl} 
                alt="Site schematic preview"
                className="w-full h-auto object-contain"
                style={{ maxHeight: "600px" }}
              />
              <div className="absolute bottom-2 right-2">
                <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
                  Reference Only
                </Badge>
              </div>
            </div>
          ) : (
            <div className="flex flex-col justify-center items-center h-64 bg-muted/30 rounded-lg text-muted-foreground">
              <Network className="w-12 h-12 mb-4 opacity-50" />
              <p>No schematic available</p>
              <p className="text-sm mt-1">Upload a schematic in the Schematics tab</p>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      <Dialog open={!!viewingExtraction} onOpenChange={() => setViewingExtraction(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Extracted Data</DialogTitle>
            <DialogDescription>
              AI-extracted information from the document
            </DialogDescription>
          </DialogHeader>
          {viewingExtraction && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Period Start</Label>
                  <p className="font-medium">
                    {format(new Date(viewingExtraction.period_start), "MMM dd, yyyy")}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Period End</Label>
                  <p className="font-medium">
                    {format(new Date(viewingExtraction.period_end), "MMM dd, yyyy")}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Total Amount</Label>
                  <p className="font-medium text-lg">
                    {viewingExtraction.currency} {viewingExtraction.total_amount.toLocaleString()}
                  </p>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Additional Extracted Data</Label>
                <pre className="mt-2 p-4 bg-muted rounded-lg text-sm overflow-x-auto">
                  {JSON.stringify(viewingExtraction.extracted_data, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}