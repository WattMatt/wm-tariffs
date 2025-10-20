import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Play, Download, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface SavedCsvManagerProps {
  siteId: string;
  onDataChange?: () => void;
}

interface SavedFile {
  name: string;
  path: string;
  meterId: string;
  meterNumber?: string;
  size?: number;
  createdAt?: string;
  parseStatus?: "idle" | "parsing" | "success" | "error";
  parseResult?: any;
}

export default function SavedCsvManager({ siteId, onDataChange }: SavedCsvManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<SavedFile[]>([]);
  const [meters, setMeters] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [separator, setSeparator] = useState<string>("tab");
  const [dateFormat, setDateFormat] = useState<string>("auto");

  useEffect(() => {
    if (isOpen) {
      loadFiles();
      loadMeters();
    }
  }, [isOpen]);

  const loadMeters = async () => {
    const { data } = await supabase
      .from("meters")
      .select("id, meter_number")
      .eq("site_id", siteId);
    
    if (data) setMeters(data);
  };

  const loadFiles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from('meter-csvs')
        .list(siteId, {
          limit: 1000,
          sortBy: { column: 'created_at', order: 'desc' }
        });

      if (error) throw error;

      const filesList: SavedFile[] = [];
      
      // Get files from each meter folder
      if (data) {
        for (const folder of data) {
          if (folder.id) {
            const { data: meterFiles } = await supabase.storage
              .from('meter-csvs')
              .list(`${siteId}/${folder.name}`, {
                limit: 1000,
                sortBy: { column: 'created_at', order: 'desc' }
              });

            if (meterFiles) {
              const meter = meters.find(m => m.id === folder.name);
              meterFiles.forEach(file => {
                if (file.name.endsWith('.csv')) {
                  filesList.push({
                    name: file.name,
                    path: `${siteId}/${folder.name}/${file.name}`,
                    meterId: folder.name,
                    meterNumber: meter?.meter_number,
                    size: file.metadata?.size,
                    createdAt: file.created_at,
                    parseStatus: "idle"
                  });
                }
              });
            }
          }
        }
      }

      setFiles(filesList);
    } catch (err: any) {
      toast.error("Failed to load files: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleParse = async (file: SavedFile) => {
    setFiles(prev => prev.map(f => 
      f.path === file.path ? { ...f, parseStatus: "parsing" } : f
    ));

    try {
      const { data, error } = await supabase.functions.invoke('process-meter-csv', {
        body: {
          meterId: file.meterId,
          filePath: file.path,
          separator: separator === "tab" ? "\t" : 
                    separator === "comma" ? "," : 
                    separator === "semicolon" ? ";" : 
                    separator === "space" ? " " : "\t",
          dateFormat: dateFormat
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      setFiles(prev => prev.map(f => 
        f.path === file.path 
          ? { ...f, parseStatus: "success", parseResult: data } 
          : f
      ));

      toast.success(
        `${file.meterNumber}: ${data.readingsInserted} readings imported` +
        (data.duplicatesSkipped > 0 ? `, ${data.duplicatesSkipped} skipped` : "") +
        (data.parseErrors > 0 ? `, ${data.parseErrors} errors` : "")
      );

      onDataChange?.();
    } catch (err: any) {
      setFiles(prev => prev.map(f => 
        f.path === file.path ? { ...f, parseStatus: "error" } : f
      ));
      toast.error(`Parse failed: ${err.message}`);
    }
  };

  const handleDelete = async (file: SavedFile) => {
    try {
      const { error } = await supabase.storage
        .from('meter-csvs')
        .remove([file.path]);

      if (error) throw error;

      setFiles(prev => prev.filter(f => f.path !== file.path));
      toast.success("File deleted");
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  const handleDownload = async (file: SavedFile) => {
    try {
      const { data, error } = await supabase.storage
        .from('meter-csvs')
        .download(file.path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error("Download failed: " + err.message);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <FileText className="w-4 h-4" />
          CSV Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Saved CSV Files</DialogTitle>
          <DialogDescription>
            Parse uploaded CSV files into meter readings
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b">
            <div>
              <Label>Column Separator</Label>
              <Select value={separator} onValueChange={setSeparator}>
                <SelectTrigger className="bg-background mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tab">Tab</SelectItem>
                  <SelectItem value="comma">Comma (,)</SelectItem>
                  <SelectItem value="semicolon">Semicolon (;)</SelectItem>
                  <SelectItem value="space">Space</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date Format</Label>
              <Select value={dateFormat} onValueChange={setDateFormat}>
                <SelectTrigger className="bg-background mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading files...</div>
          ) : files.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No CSV files found. Use Bulk Upload to save files first.
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((file, index) => (
                <Card key={index} className="border-border/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {file.meterNumber} • {file.size ? `${(file.size / 1024).toFixed(1)} KB` : 'Unknown size'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {file.parseStatus === "idle" && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handleParse(file)}
                            className="gap-1"
                          >
                            <Play className="w-3 h-3" />
                            Parse
                          </Button>
                        )}
                        
                        {file.parseStatus === "parsing" && (
                          <span className="text-sm text-blue-600">Parsing...</span>
                        )}
                        
                        {file.parseStatus === "success" && (
                          <span className="text-sm text-green-600">
                            ✓ {file.parseResult?.readingsInserted || 0} imported
                          </span>
                        )}
                        
                        {file.parseStatus === "error" && (
                          <span className="text-sm text-destructive">✗ Failed</span>
                        )}

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDownload(file)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(file)}
                          disabled={file.parseStatus === "parsing"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
