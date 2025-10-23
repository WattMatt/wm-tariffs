import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Upload, Loader2, Download, Trash2, Eye, ZoomIn, ZoomOut, Maximize2, GripVertical, Plus, X, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

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
  converted_image_path?: string | null;
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
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
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
    if (selectedFiles.length === 0) {
      toast.error("Please select at least one file");
      return;
    }

    setIsUploading(true);
    setUploadProgress({ current: 0, total: selectedFiles.length, action: 'Uploading' });
    
    try {
      const { data: user } = await supabase.auth.getUser();
      let successCount = 0;
      let failCount = 0;

      // Process files sequentially to show progress
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setUploadProgress({ current: i + 1, total: selectedFiles.length, action: 'Uploading' });
        
        try {
          const fileExt = file.name.split('.').pop()?.toLowerCase();
          const isPdf = fileExt === 'pdf';

          // Upload original file to storage
          const fileName = `${siteId}/${Date.now()}-${file.name}`;
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from("site-documents")
            .upload(fileName, file);

          if (uploadError) throw uploadError;

          let convertedImagePath: string | null = null;

          // If it's a PDF, convert to image and upload
          if (isPdf) {
            const imageBlob = await convertPdfToImage(file);
            const imagePath = `${siteId}/${Date.now()}-converted.png`;
            
            const { error: imageUploadError } = await supabase.storage
              .from("site-documents")
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
              file_name: file.name,
              file_path: uploadData.path,
              file_size: file.size,
              document_type: documentType as any,
              uploaded_by: user.user?.id || null,
              extraction_status: 'pending',
              converted_image_path: convertedImagePath,
            })
            .select()
            .single();

          if (docError) throw docError;

          // Get signed URL for AI processing (use converted image if available)
          setUploadProgress({ current: i + 1, total: selectedFiles.length, action: 'Extracting' });
          
          const pathToProcess = convertedImagePath || uploadData.path;
          const { data: urlData } = await supabase.storage
            .from("site-documents")
            .createSignedUrl(pathToProcess, 3600);

          if (urlData?.signedUrl) {
            // Trigger AI extraction
            await supabase.functions.invoke("extract-document-data", {
              body: {
                documentId: document.id,
                fileUrl: urlData.signedUrl,
                documentType: documentType
              }
            });
          }

          successCount++;
        } catch (error) {
          console.error(`Error uploading ${file.name}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} document(s) uploaded successfully`);
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
      setUploadProgress({ current: 0, total: 0, action: '' });
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

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedDocuments(new Set(documents.map(doc => doc.id)));
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
    
    if (!confirm(`Are you sure you want to delete ${selectedDocuments.size} document(s)?`)) return;

    try {
      const docsToDelete = documents.filter(doc => selectedDocuments.has(doc.id));
      
      await Promise.all(
        docsToDelete.map(async (doc) => {
          await supabase.storage.from("site-documents").remove([doc.file_path]);
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
        .from("site-documents")
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
  };

  const handleReset = () => {
    if (viewingExtraction) {
      setEditedData({ ...viewingExtraction });
      toast.info("Changes reset");
    }
  };

  const handleExtract = async () => {
    if (!viewingDocument) return;

    setIsExtracting(true);
    try {
      // Get signed URL for the document
      const pathToProcess = viewingDocument.converted_image_path || viewingDocument.file_path;
      const { data: urlData } = await supabase.storage
        .from("site-documents")
        .createSignedUrl(pathToProcess, 3600);

      if (!urlData?.signedUrl) {
        throw new Error("Failed to get document URL");
      }

      // Call AI extraction
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
        toast.success("Document re-extracted successfully");
      }
    } catch (error) {
      console.error("Error extracting document:", error);
      toast.error("Failed to extract document");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!editedData || !viewingDocument) return;

    setIsSaving(true);
    try {
      const extraction = viewingDocument.document_extractions?.[0];
      if (!extraction) {
        toast.error("No extraction found");
        return;
      }

      // Update the extraction in the database
      const { error } = await supabase
        .from("document_extractions")
        .update({
          period_start: editedData.period_start,
          period_end: editedData.period_end,
          total_amount: editedData.total_amount,
          currency: editedData.currency,
          extracted_data: editedData.extracted_data,
        })
        .eq("document_id", viewingDocument.id);

      if (error) throw error;

      toast.success("Changes saved successfully");
      fetchDocuments();
      handleCloseDialog();
    } catch (error) {
      console.error("Error saving changes:", error);
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
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
              <Label htmlFor="file-upload">Select Files</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileSelect}
                disabled={isUploading}
                multiple
              />
              {selectedFiles.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {selectedFiles.length} file(s) selected
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>&nbsp;</Label>
              <Button
                onClick={handleUpload}
                disabled={selectedFiles.length === 0 || isUploading || isConvertingPdf}
                className="w-full"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {uploadProgress.action} ({uploadProgress.current}/{uploadProgress.total})
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
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkDownload}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Selected
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDelete}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Selected
                </Button>
              </div>
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
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedDocuments.size === documents.length && documents.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
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
                      <TableCell>
                        <Checkbox
                          checked={selectedDocuments.has(doc.id)}
                          onCheckedChange={(checked) => handleSelectDocument(doc.id, checked as boolean)}
                        />
                      </TableCell>
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
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Document Extraction</DialogTitle>
            <DialogDescription>
              Review and edit the AI-extracted information
            </DialogDescription>
          </DialogHeader>
          {viewingDocument && editedData && (
            <div className="grid grid-cols-2 gap-6 h-[70vh]">
              {/* Left side - Document Image */}
              <div className="border rounded-lg overflow-hidden bg-muted/30 relative">
                <div className="h-full flex items-center justify-center">
                  {documentImageUrl ? (
                    <TransformWrapper
                      initialScale={1}
                      minScale={0.5}
                      maxScale={4}
                      centerOnInit
                    >
                      {({ zoomIn, zoomOut, resetTransform }) => (
                        <>
                          <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => zoomIn()}
                              className="shadow-lg"
                            >
                              <ZoomIn className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => zoomOut()}
                              className="shadow-lg"
                            >
                              <ZoomOut className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => resetTransform()}
                              className="shadow-lg"
                            >
                              <Maximize2 className="w-4 h-4" />
                            </Button>
                          </div>
                          <TransformComponent
                            wrapperClass="!w-full !h-full"
                            contentClass="!w-full !h-full flex items-center justify-center"
                          >
                            <img 
                              src={documentImageUrl} 
                              alt={viewingDocument.file_name}
                              className="max-w-full max-h-full object-contain"
                              draggable={false}
                            />
                          </TransformComponent>
                        </>
                      )}
                    </TransformWrapper>
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
                    <Input
                      type="text"
                      value={editedData.period_start ? format(new Date(editedData.period_start), 'dd MMM yyyy') : ''}
                      onChange={(e) => {
                        const date = new Date(e.target.value);
                        if (!isNaN(date.getTime())) {
                          setEditedData({ ...editedData, period_start: date.toISOString().split('T')[0] });
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Period End</Label>
                    <Input
                      type="text"
                      value={editedData.period_end ? format(new Date(editedData.period_end), 'dd MMM yyyy') : ''}
                      onChange={(e) => {
                        const date = new Date(e.target.value);
                        if (!isNaN(date.getTime())) {
                          setEditedData({ ...editedData, period_end: date.toISOString().split('T')[0] });
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Input
                      value={editedData.currency || ''}
                      onChange={(e) => setEditedData({ ...editedData, currency: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Total Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editedData.total_amount || ''}
                      onChange={(e) => setEditedData({ ...editedData, total_amount: parseFloat(e.target.value) })}
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
                          value={editedData.extracted_data.account_reference || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            extracted_data: { ...editedData.extracted_data, account_reference: e.target.value }
                          })}
                        />
                      </div>
                    )}

                    {editedData.extracted_data.meter_readings && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">Meter Readings</Label>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const readings = Array.isArray(editedData.extracted_data.meter_readings)
                                ? editedData.extracted_data.meter_readings
                                : [
                                    { name: 'Previous', value: editedData.extracted_data.meter_readings.previous || 0 },
                                    { name: 'Current', value: editedData.extracted_data.meter_readings.current || 0 },
                                    { name: 'Consumption (kWh)', value: editedData.extracted_data.meter_readings.consumption_kwh || 0 }
                                  ];
                              
                              setEditedData({
                                ...editedData,
                                extracted_data: {
                                  ...editedData.extracted_data,
                                  meter_readings: [...readings, { name: '', value: 0 }]
                                }
                              });
                            }}
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            Add Row
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {(() => {
                            // Convert to name-value array if it's an object
                            const readings = Array.isArray(editedData.extracted_data.meter_readings)
                              ? editedData.extracted_data.meter_readings
                              : [
                                  { name: 'Previous', value: editedData.extracted_data.meter_readings.previous || 0 },
                                  { name: 'Current', value: editedData.extracted_data.meter_readings.current || 0 },
                                  { name: 'Consumption (kWh)', value: editedData.extracted_data.meter_readings.consumption_kwh || 0 }
                                ];

                            return readings.map((reading: any, index: number) => (
                              <div
                                key={index}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', index.toString());
                                }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = 'move';
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                                  const toIndex = index;
                                  
                                  if (fromIndex !== toIndex) {
                                    const newReadings = [...readings];
                                    const [movedItem] = newReadings.splice(fromIndex, 1);
                                    newReadings.splice(toIndex, 0, movedItem);
                                    
                                    setEditedData({
                                      ...editedData,
                                      extracted_data: {
                                        ...editedData.extracted_data,
                                        meter_readings: newReadings
                                      }
                                    });
                                  }
                                }}
                                className="flex gap-3 items-center p-3 border rounded-lg bg-muted/30 hover:bg-muted/50 cursor-move transition-colors"
                              >
                                <GripVertical className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                                <div className="flex-1 grid grid-cols-2 gap-3">
                                  <Input
                                    placeholder="Name"
                                    value={reading.name || ''}
                                    onChange={(e) => {
                                      const newReadings = [...readings];
                                      newReadings[index] = { ...reading, name: e.target.value };
                                      setEditedData({
                                        ...editedData,
                                        extracted_data: {
                                          ...editedData.extracted_data,
                                          meter_readings: newReadings
                                        }
                                      });
                                    }}
                                  />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="Value"
                                    value={reading.value || ''}
                                    onChange={(e) => {
                                      const newReadings = [...readings];
                                      newReadings[index] = { ...reading, value: parseFloat(e.target.value) || 0 };
                                      setEditedData({
                                        ...editedData,
                                        extracted_data: {
                                          ...editedData.extracted_data,
                                          meter_readings: newReadings
                                        }
                                      });
                                    }}
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="flex-shrink-0"
                                  onClick={() => {
                                    const newReadings = readings.filter((_: any, i: number) => i !== index);
                                    setEditedData({
                                      ...editedData,
                                      extracted_data: {
                                        ...editedData.extracted_data,
                                        meter_readings: newReadings.length > 0 ? newReadings : [{ name: '', value: 0 }]
                                      }
                                    });
                                  }}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          
          <div className="flex justify-between pt-4 border-t">
            <Button 
              variant="outline" 
              onClick={handleExtract}
              disabled={isExtracting}
            >
              {isExtracting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Extract
                </>
              )}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleReset}>
                Reset
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}