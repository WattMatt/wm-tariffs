import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Save, X, RefreshCw, Loader2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Document, Page, pdfjs } from 'react-pdf';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface PdfSection {
  id: string;
  title: string;
  content: string;
  type: 'text' | 'page-break';
  editable: boolean;
}

interface SplitViewReportEditorProps {
  sections: PdfSection[];
  onSave: (sections: PdfSection[]) => void;
  onCancel: () => void;
  generatePdfPreview: (sections: PdfSection[]) => Promise<string>;
}

export function SplitViewReportEditor({ 
  sections, 
  onSave, 
  onCancel,
  generatePdfPreview 
}: SplitViewReportEditorProps) {
  const [markdown, setMarkdown] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const debounceTimer = useRef<NodeJS.Timeout>();

  // Convert sections to unified markdown on mount
  useEffect(() => {
    const markdownText = sections
      .map(section => {
        if (section.type === 'page-break') {
          return '<!-- PAGE_BREAK -->\n';
        }
        return `<!-- SECTION: ${section.title} -->\n${section.content}\n`;
      })
      .join('\n');
    setMarkdown(markdownText);
    setInitialLoadDone(true);
  }, []);

  // Generate initial PDF preview after markdown is set
  useEffect(() => {
    if (markdown && initialLoadDone && !pdfUrl) {
      generatePreview();
    }
  }, [markdown, initialLoadDone]);

  const parseMarkdownToSections = (md: string): PdfSection[] => {
    const lines = md.split('\n');
    const parsedSections: PdfSection[] = [];
    let currentSection: PdfSection | null = null;
    let contentBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('<!-- PAGE_BREAK -->')) {
        // Save current section before page break
        if (currentSection) {
          currentSection.content = contentBuffer.join('\n').trim();
          parsedSections.push(currentSection);
          currentSection = null;
          contentBuffer = [];
        }
        // Add page break section
        parsedSections.push({
          id: `page-break-${Date.now()}-${i}`,
          title: 'Page Break',
          content: '',
          type: 'page-break',
          editable: false
        });
      } else if (line.startsWith('<!-- SECTION:')) {
        // Save previous section
        if (currentSection) {
          currentSection.content = contentBuffer.join('\n').trim();
          parsedSections.push(currentSection);
          contentBuffer = [];
        }
        // Start new section
        const title = line.replace('<!-- SECTION:', '').replace('-->', '').trim();
        currentSection = {
          id: title.toLowerCase().replace(/\s+/g, '-'),
          title,
          content: '',
          type: 'text',
          editable: true
        };
      } else if (currentSection && !line.startsWith('<!--')) {
        contentBuffer.push(line);
      }
    }

    // Save last section
    if (currentSection) {
      currentSection.content = contentBuffer.join('\n').trim();
      parsedSections.push(currentSection);
    }

    return parsedSections;
  };

  const generatePreview = async () => {
    setIsGenerating(true);
    try {
      const parsedSections = parseMarkdownToSections(markdown);
      const url = await generatePdfPreview(parsedSections);
      
      // Revoke old URL to free memory
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      
      setPdfUrl(url);
    } catch (error) {
      console.error("Error generating PDF preview:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleMarkdownChange = (value: string) => {
    setMarkdown(value);
    
    // Debounce PDF regeneration
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    
    debounceTimer.current = setTimeout(() => {
      generatePreview();
    }, 1000); // 1 second debounce
  };

  const handleSave = () => {
    const parsedSections = parseMarkdownToSections(markdown);
    onSave(parsedSections);
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 10, 200));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 10, 50));
  };

  const handleRefresh = () => {
    generatePreview();
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const goToPrevPage = () => {
    setPageNumber((prev) => Math.max(prev - 1, 1));
  };

  const goToNextPage = () => {
    setPageNumber((prev) => Math.min(prev + 1, numPages));
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [pdfUrl]);

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {/* Header */}
      <div className="h-14 border-b flex items-center justify-between px-4 bg-muted/10">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Edit Report Content</h2>
          {isGenerating && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generating preview...</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Preview
          </Button>
          <Button onClick={handleSave} size="sm">
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
          <Button onClick={onCancel} variant="outline" size="sm">
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        </div>
      </div>

      {/* Split View */}
      <div className="h-[800px]">
        <ResizablePanelGroup direction="horizontal">
          {/* Left Panel - Markdown Editor */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col">
              <div className="h-10 border-b flex items-center px-4 bg-muted/30">
                <span className="text-sm font-medium">Markdown Editor</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {markdown.length} characters
                </span>
              </div>
              <ScrollArea className="flex-1">
                <Textarea
                  value={markdown}
                  onChange={(e) => handleMarkdownChange(e.target.value)}
                  className="min-h-[750px] w-full border-0 rounded-none font-mono text-sm resize-none focus-visible:ring-0"
                  placeholder="Edit your report content in markdown format..."
                />
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Panel - PDF Preview */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col">
              <div className="h-10 border-b flex items-center justify-between px-4 bg-muted/30">
                <span className="text-sm font-medium">PDF Preview</span>
                <div className="flex items-center gap-2">
                  {numPages > 0 && (
                    <>
                      <Button 
                        onClick={goToPrevPage} 
                        variant="ghost" 
                        size="icon"
                        className="h-7 w-7"
                        disabled={pageNumber <= 1}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-xs font-medium min-w-[4rem] text-center">
                        {pageNumber} / {numPages}
                      </span>
                      <Button 
                        onClick={goToNextPage} 
                        variant="ghost" 
                        size="icon"
                        className="h-7 w-7"
                        disabled={pageNumber >= numPages}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      <div className="w-px h-5 bg-border mx-1" />
                    </>
                  )}
                  <Button 
                    onClick={handleZoomOut} 
                    variant="ghost" 
                    size="icon"
                    className="h-7 w-7"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="text-xs font-medium min-w-[3rem] text-center">
                    {zoom}%
                  </span>
                  <Button 
                    onClick={handleZoomIn} 
                    variant="ghost" 
                    size="icon"
                    className="h-7 w-7"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 bg-muted/20">
                {pdfUrl ? (
                  <div className="p-4 flex justify-center">
                    <Document
                      file={pdfUrl}
                      onLoadSuccess={onDocumentLoadSuccess}
                      loading={
                        <div className="flex items-center justify-center py-20">
                          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                      }
                      error={
                        <div className="flex items-center justify-center py-20">
                          <div className="text-center space-y-4">
                            <p className="text-sm text-destructive">Failed to load PDF</p>
                            <Button onClick={handleRefresh} variant="outline" size="sm">
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Try Again
                            </Button>
                          </div>
                        </div>
                      }
                    >
                      <Page
                        pageNumber={pageNumber}
                        scale={zoom / 100}
                        renderTextLayer={true}
                        renderAnnotationLayer={true}
                        loading={
                          <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          </div>
                        }
                      />
                    </Document>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center space-y-2">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Loading PDF preview...</p>
                    </div>
                  </div>
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
