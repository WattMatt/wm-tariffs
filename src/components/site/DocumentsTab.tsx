import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Upload, Loader2, Download, Trash2, Eye } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pdfjs } from 'react-pdf';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);

  useEffect(() => {
    fetchDocuments();
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


  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
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

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }

    setIsUploading(true);
    try {
      const fileExt = selectedFile.name.split('.').pop()?.toLowerCase();
      const isPdf = fileExt === 'pdf';

      // Upload original file to storage
      const fileName = `${siteId}/${Date.now()}-${selectedFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("site-documents")
        .upload(fileName, selectedFile);

      if (uploadError) throw uploadError;

      let convertedImagePath: string | null = null;

      // If it's a PDF, convert to image and upload
      if (isPdf) {
        toast.info("Converting PDF to image for AI processing...");
        const imageBlob = await convertPdfToImage(selectedFile);
        const imagePath = `${siteId}/${Date.now()}-converted.png`;
        
        const { error: imageUploadError } = await supabase.storage
          .from("site-documents")
          .upload(imagePath, imageBlob);

        if (imageUploadError) {
          console.error("Error uploading converted image:", imageUploadError);
          toast.error("Failed to convert PDF for AI processing");
        } else {
          convertedImagePath = imagePath;
          toast.success("PDF converted to image successfully");
        }
      }

      // Create document record
      const { data: user } = await supabase.auth.getUser();
      const { data: document, error: docError } = await supabase
        .from("site_documents")
        .insert({
          site_id: siteId,
          file_name: selectedFile.name,
          file_path: uploadData.path,
          file_size: selectedFile.size,
          document_type: documentType as any,
          uploaded_by: user.user?.id || null,
          extraction_status: 'pending',
          converted_image_path: convertedImagePath,
        })
        .select()
        .single();

      if (docError) throw docError;

      toast.success("Document uploaded successfully");

      // Get signed URL for AI processing (use converted image if available)
      const pathToProcess = convertedImagePath || uploadData.path;
      const { data: urlData } = await supabase.storage
        .from("site-documents")
        .createSignedUrl(pathToProcess, 3600);

      if (urlData?.signedUrl) {
        // Trigger AI extraction
        toast.info("Starting AI extraction...");
        const { error: extractError } = await supabase.functions.invoke("extract-document-data", {
          body: {
            documentId: document.id,
            fileUrl: urlData.signedUrl,
            documentType: documentType
          }
        });

        if (extractError) {
          console.error("Extraction error:", extractError);
          toast.warning("Document uploaded but extraction failed");
        } else {
          toast.success("Data extracted successfully!");
        }
      }

      setSelectedFile(null);
      fetchDocuments();
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload document");
    } finally {
      setIsUploading(false);
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
                disabled={!selectedFile || isUploading || isConvertingPdf}
                className="w-full"
              >
                {isUploading || isConvertingPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isConvertingPdf ? 'Converting PDF...' : 'Uploading...'}
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
                        <TooltipProvider>
                          <div className="flex justify-end gap-2">
                            {doc.document_extractions?.[0] && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setViewingExtraction(doc.document_extractions[0])}
                                  >
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>View extracted data</p>
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
    </>
  );
}