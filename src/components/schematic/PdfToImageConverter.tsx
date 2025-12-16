import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, FileImage } from "lucide-react";

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
      
      // Use shared PDF conversion utility
      const { convertPdfUrlToImage } = await import('@/lib/pdfConversion');
      const { dataUrl } = await convertPdfUrlToImage(pdfUrl, { scale: 2.0 });
      
      console.log('PDF converted to image successfully');
      
      toast.success('PDF converted to image successfully!');
      onImageGenerated(dataUrl);
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
