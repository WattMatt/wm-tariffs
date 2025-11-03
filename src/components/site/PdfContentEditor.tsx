import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronUp, ChevronDown, Scissors, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

export interface PdfSection {
  id: string;
  title: string;
  content: string;
  type: string;
  editable: boolean;
}

interface PdfContentEditorProps {
  sections: PdfSection[];
  onSave: (editedSections: PdfSection[]) => void;
  onCancel: () => void;
}

export default function PdfContentEditor({ sections: initialSections, onSave, onCancel }: PdfContentEditorProps) {
  const [sections, setSections] = useState<PdfSection[]>(initialSections);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleContentChange = (id: string, newContent: string) => {
    setSections(prev => prev.map(section => 
      section.id === id ? { ...section, content: newContent } : section
    ));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newSections = [...sections];
    [newSections[index - 1], newSections[index]] = [newSections[index], newSections[index - 1]];
    setSections(newSections);
    toast.success("Section moved up");
  };

  const handleMoveDown = (index: number) => {
    if (index === sections.length - 1) return;
    const newSections = [...sections];
    [newSections[index], newSections[index + 1]] = [newSections[index + 1], newSections[index]];
    setSections(newSections);
    toast.success("Section moved down");
  };

  const handleInsertPageBreak = (index: number) => {
    const newPageBreak: PdfSection = {
      id: `page-break-${Date.now()}`,
      title: "Page Break",
      content: "",
      type: "page-break",
      editable: false
    };
    const newSections = [...sections];
    newSections.splice(index + 1, 0, newPageBreak);
    setSections(newSections);
    toast.success("Page break inserted");
  };

  const handleRemoveSection = (id: string) => {
    setSections(prev => prev.filter(section => section.id !== id));
    toast.success("Section removed");
  };

  const handleSave = () => {
    onSave(sections);
    toast.success("Content saved");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Edit PDF Content</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Edit text, reorder sections, and add page breaks
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <FileText className="w-4 h-4 mr-2" />
            Save & Generate PDF
          </Button>
        </div>
      </div>

      <Separator />

      <ScrollArea className="h-[calc(100vh-300px)]">
        <div className="space-y-4 pr-4">
          {sections.map((section, index) => (
            <Card key={section.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{section.title}</CardTitle>
                      {section.type === "page-break" && (
                        <Badge variant="secondary">
                          <Scissors className="w-3 h-3 mr-1" />
                          Page Break
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      title="Move up"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === sections.length - 1}
                      title="Move down"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleInsertPageBreak(index)}
                      title="Insert page break after"
                    >
                      <Scissors className="w-4 h-4" />
                    </Button>
                    {section.type === "page-break" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveSection(section.id)}
                        title="Remove section"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              {section.type !== "page-break" && (
                <CardContent>
                  {section.editable ? (
                    <div className="space-y-2">
                      <Textarea
                        value={section.content}
                        onChange={(e) => handleContentChange(section.id, e.target.value)}
                        className="min-h-[200px] font-mono text-sm"
                        placeholder="Enter content..."
                      />
                      <p className="text-xs text-muted-foreground">
                        {section.content.length} characters
                      </p>
                    </div>
                  ) : (
                    <div className="bg-muted/50 p-4 rounded-md">
                      <p className="text-sm whitespace-pre-wrap">{section.content}</p>
                    </div>
                  )}
                </CardContent>
              )}

              {section.type === "page-break" && (
                <CardContent>
                  <div className="flex items-center justify-center py-6 border-2 border-dashed rounded-md">
                    <div className="text-center">
                      <Scissors className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        New page starts after this point
                      </p>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </ScrollArea>

      <div className="flex items-center justify-end gap-2 pt-4 border-t">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave}>
          <FileText className="w-4 h-4 mr-2" />
          Save & Generate PDF
        </Button>
      </div>
    </div>
  );
}
