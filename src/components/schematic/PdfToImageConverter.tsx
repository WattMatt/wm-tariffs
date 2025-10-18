import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, FileImage } from "lucide-react";
import { Document, Page, pdfjs } from 'react-pdf';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfToImageConverterProps {
  pdfUrl: string;
  onImageGenerated: (imageDataUrl: string) => void;
}

export const PdfToImageConverter = ({ pdfUrl, onImageGenerated }: PdfToImageConverterProps) => {
  const [isConverting, setIsConverting] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  const convertPdfToImage = async () => {
    setIsConverting(true);
    try {
      console.log('Loading PDF:', pdfUrl);
      
      // Load the PDF
      const loadingTask = pdfjs.getDocument(pdfUrl);
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
      
      console.log('PDF rendered to canvas, converting to image...');
      
      // Convert canvas to data URL
      const imageDataUrl = canvas.toDataURL('image/png', 1.0);
      
      toast.success('PDF converted to image successfully!');
      onImageGenerated(imageDataUrl);
      setShowDialog(false);
    } catch (error) {
      console.error('Error converting PDF to image:', error);
      toast.error('Failed to convert PDF to image');
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setShowDialog(true)}
        variant="outline"
        className="gap-2"
      >
        <FileImage className="h-4 w-4" />
        Convert PDF to Image First
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert PDF to Image</DialogTitle>
            <DialogDescription>
              AI vision models need image formats. Click below to convert your PDF schematic to a high-quality image for meter extraction.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              This will convert the first page of your PDF to a PNG image at high resolution, which can then be processed by the AI.
            </div>

            <Button
              onClick={convertPdfToImage}
              disabled={isConverting}
              className="w-full gap-2"
            >
              {isConverting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Converting PDF...
                </>
              ) : (
                <>
                  <FileImage className="h-4 w-4" />
                  Convert to Image
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
