import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Save, X, RefreshCw, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  const debounceTimer = useRef<NodeJS.Timeout>();
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
  }, []);

  // Generate initial PDF preview
  useEffect(() => {
    if (markdown) {
      generatePreview();
    }
  }, []);

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
    <div className="fixed inset-0 z-50 bg-background">
      {/* Header */}
      <div className="h-14 border-b flex items-center justify-between px-4">
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
      <div className="h-[calc(100vh-3.5rem)]">
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
                  className="min-h-full w-full border-0 rounded-none font-mono text-sm resize-none focus-visible:ring-0"
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
              <div className="flex-1 bg-muted/20 overflow-auto">
                {pdfUrl ? (
                  <div className="p-4">
                    <div 
                      style={{ 
                        transform: `scale(${zoom / 100})`,
                        transformOrigin: 'top center',
                        transition: 'transform 0.2s ease'
                      }}
                    >
                      <iframe
                        ref={iframeRef}
                        src={pdfUrl}
                        className="w-full border shadow-lg"
                        style={{ 
                          height: 'calc(100vh - 8rem)',
                          minHeight: '800px'
                        }}
                        title="PDF Preview"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center space-y-2">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Loading PDF preview...</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
