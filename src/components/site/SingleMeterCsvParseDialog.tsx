import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Settings2, Play, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SingleMeterCsvParseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  meterId: string;
  meterNumber: string;
  onParseComplete?: () => void;
}

interface ColumnMapping {
  dateColumn: number | string;
  timeColumn: number | string;
  valueColumn: number | string;
  kvaColumn: number | string;
  dateFormat: string;
  timeFormat: string;
  dateTimeFormat?: string;
  renamedHeaders?: Record<string, string>;
  columnDataTypes?: Record<string, 'datetime' | 'float' | 'int' | 'string' | 'boolean'>;
}

interface CsvFile {
  id: string;
  file_name: string;
  file_path: string;
  separator: string;
  header_row_number: number;
  column_mapping: any;
  parse_status: string;
}

export default function SingleMeterCsvParseDialog({
  isOpen,
  onClose,
  meterId,
  meterNumber,
  onParseComplete,
}: SingleMeterCsvParseDialogProps) {
  const [csvFiles, setCsvFiles] = useState<CsvFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<CsvFile | null>(null);
  const [separator, setSeparator] = useState<string>("tab");
  const [headerRowNumber, setHeaderRowNumber] = useState<string>("1");
  const [previewData, setPreviewData] = useState<{ rows: string[][], headers: string[] } | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({});
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    dateColumn: "0",
    timeColumn: "1",
    valueColumn: "2",
    kvaColumn: "-1",
    dateFormat: "auto",
    timeFormat: "auto",
    dateTimeFormat: "YYYY-MM-DD HH:mm:ss",
    renamedHeaders: {},
    columnDataTypes: {}
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);

  useEffect(() => {
    if (isOpen && meterId) {
      loadCsvFiles();
    }
  }, [isOpen, meterId]);

  const loadCsvFiles = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('meter_csv_files')
        .select('*')
        .eq('meter_id', meterId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setCsvFiles(data || []);
      if (data && data.length > 0) {
        setSelectedFile(data[0] as any);
        if (data[0].separator) setSeparator(data[0].separator);
        if (data[0].header_row_number) setHeaderRowNumber(data[0].header_row_number.toString());
        if (data[0].column_mapping) setColumnMapping(data[0].column_mapping as any);
      }
    } catch (err: any) {
      console.error("Failed to load CSV files:", err);
      toast.error("Failed to load CSV files");
    } finally {
      setIsLoading(false);
    }
  };

  const loadPreview = async () => {
    if (!selectedFile) return;

    setIsLoading(true);
    try {
      // Download CSV file from storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('meter-csvs')
        .download(selectedFile.file_path);

      if (downloadError) throw downloadError;

      const text = await fileData.text();
      const lines = text.split('\n').filter(l => l.trim()).slice(0, 20);

      const separatorChar = separator === "tab" ? "\t" : 
                           separator === "comma" ? "," : 
                           separator === "semicolon" ? ";" : 
                           separator === "space" ? " " : "\t";

      const rows = lines.map(line => {
        if (separatorChar === " ") {
          return line.split(/\s+/);
        }
        return line.split(separatorChar);
      });

      const headerIdx = parseInt(headerRowNumber) - 1;
      const headers = rows[headerIdx] || [];
      const dataRows = rows.slice(headerIdx + 1);

      // Initialize visible columns
      const initialVisibility: Record<string, boolean> = {};
      headers.forEach((_, idx) => {
        initialVisibility[idx.toString()] = true;
      });
      setVisibleColumns(initialVisibility);

      setPreviewData({ headers, rows: dataRows });
      toast.success("Preview loaded");
    } catch (err: any) {
      console.error("Failed to load preview:", err);
      toast.error("Failed to load preview: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleParse = async () => {
    if (!selectedFile) {
      toast.error("No CSV file selected");
      return;
    }

    setIsParsing(true);
    try {
      // Update the CSV file record with the configuration
      const { error: updateError } = await supabase
        .from('meter_csv_files')
        .update({
          separator,
          header_row_number: parseInt(headerRowNumber),
          column_mapping: columnMapping as any,
          parse_status: 'pending'
        })
        .eq('id', selectedFile.id);

      if (updateError) throw updateError;

      // Trigger the parsing edge function
      const { data, error } = await supabase.functions.invoke('process-meter-csv', {
        body: { 
          csvFileId: selectedFile.id,
          meterId,
          separator,
          headerRowNumber: parseInt(headerRowNumber),
          columnMapping
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Parsing failed');

      toast.success(
        `Successfully parsed ${data.readingsInserted?.toLocaleString() || 0} readings` +
        (data.duplicatesSkipped ? `, ${data.duplicatesSkipped} duplicates skipped` : ''),
        { duration: 5000 }
      );

      onParseComplete?.();
      onClose();
    } catch (err: any) {
      console.error("Failed to parse CSV:", err);
      toast.error("Failed to parse CSV: " + err.message);
    } finally {
      setIsParsing(false);
    }
  };

  const getColumnName = (idx: number) => {
    return columnMapping.renamedHeaders?.[idx] || previewData?.headers[idx] || `Column ${idx + 1}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Parse CSV Data - {meterNumber}</DialogTitle>
          <DialogDescription>
            Configure how the CSV data should be parsed and imported
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="parse" className="flex-1 overflow-hidden flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2 shrink-0">
            <TabsTrigger value="parse">Parsing Configuration</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="parse" className="flex-1 overflow-auto mt-0 data-[state=active]:flex data-[state=active]:flex-col">
            <div className="space-y-4 p-4">
              {/* File Selection Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">File Selection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>CSV File</Label>
                    <Select
                      value={selectedFile?.id || ""}
                      onValueChange={(value) => {
                        const file = csvFiles.find(f => f.id === value);
                        if (file) {
                          setSelectedFile(file);
                          if (file.separator) setSeparator(file.separator);
                          if (file.header_row_number) setHeaderRowNumber(file.header_row_number.toString());
                          if (file.column_mapping) setColumnMapping(file.column_mapping as any);
                        }
                      }}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select a CSV file" />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        {csvFiles.map((file) => (
                          <SelectItem key={file.id} value={file.id}>
                            <div className="flex items-center gap-2">
                              <span>{file.file_name}</span>
                              <Badge variant={
                                file.parse_status === 'success' ? 'default' :
                                file.parse_status === 'error' ? 'destructive' :
                                'secondary'
                              }>
                                {file.parse_status}
                              </Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={loadPreview} disabled={!selectedFile || isLoading} className="w-full gap-2">
                    <Eye className="w-4 h-4" />
                    {isLoading ? "Loading..." : "Load Preview"}
                  </Button>
                </CardContent>
              </Card>

              {/* File Interpretation Section */}
              <Card className="bg-muted/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Settings2 className="w-4 h-4" />
                    File Interpretation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border rounded-md bg-muted/20">
                    <div className="space-y-2">
                      <Label>Column Separator</Label>
                      <Select value={separator} onValueChange={setSeparator}>
                        <SelectTrigger className="bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background z-50">
                          <SelectItem value="tab">Tab</SelectItem>
                          <SelectItem value="comma">Comma (,)</SelectItem>
                          <SelectItem value="semicolon">Semicolon (;)</SelectItem>
                          <SelectItem value="space">Space</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Header Row Number</Label>
                      <Input
                        type="number"
                        min="1"
                        value={headerRowNumber}
                        onChange={(e) => setHeaderRowNumber(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Column Interpretation Section */}
              {previewData && (
                <Card className="bg-muted/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Settings2 className="w-4 h-4" />
                      Column Interpretation
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 border rounded-md bg-muted/20 space-y-4">
                      {/* Individual Column Cards */}
                      {previewData.headers.map((header, idx) => {
                        const displayName = columnMapping.renamedHeaders?.[idx] || header || `Column ${idx + 1}`;
                        const columnId = idx.toString();
                        const currentDataType = columnMapping.columnDataTypes?.[columnId] || 'string';
                        
                        return (
                          <div key={idx} className="p-3 border rounded-md bg-background">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={visibleColumns[columnId] !== false}
                                onCheckedChange={(checked) => {
                                  setVisibleColumns(prev => ({
                                    ...prev,
                                    [columnId]: checked === true
                                  }));
                                }}
                                className="shrink-0 mt-6"
                              />
                              <div className="flex-1">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <div>
                                    <Label className="text-xs mb-1">Column Name</Label>
                                    <Input
                                      value={displayName}
                                      onChange={(e) => {
                                        setColumnMapping(prev => ({
                                          ...prev,
                                          renamedHeaders: {
                                            ...prev.renamedHeaders,
                                            [idx]: e.target.value
                                          }
                                        }));
                                      }}
                                      className="h-8 text-xs"
                                      placeholder="Column name"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs mb-1">Data Type</Label>
                                    <Select
                                      value={currentDataType}
                                      onValueChange={(type: 'datetime' | 'string' | 'int' | 'float' | 'boolean') => {
                                        setColumnMapping(prev => ({
                                          ...prev,
                                          columnDataTypes: {
                                            ...prev.columnDataTypes,
                                            [columnId]: type
                                          }
                                        }));
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-xs bg-background">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-background z-50">
                                        <SelectItem value="datetime">DateTime</SelectItem>
                                        <SelectItem value="string">String</SelectItem>
                                        <SelectItem value="int">Integer</SelectItem>
                                        <SelectItem value="float">Float</SelectItem>
                                        <SelectItem value="boolean">Boolean</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div>
                                    <Label className="text-xs mb-1">Split Column By</Label>
                                    <Select value="none" disabled>
                                      <SelectTrigger className="h-8 text-xs bg-background">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-background z-50">
                                        <SelectItem value="none">No Split</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* Special Column Assignments */}
                      <div className="pt-4 mt-4 border-t">
                        <Label className="text-sm font-semibold mb-3 block">Special Column Assignments</Label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-xs">Date Column</Label>
                            <Select
                              value={columnMapping.dateColumn.toString()}
                              onValueChange={(value) => setColumnMapping(prev => ({ ...prev, dateColumn: value }))}
                            >
                              <SelectTrigger className="h-8 text-xs bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-background z-50">
                                {previewData.headers.map((header, idx) => (
                                  <SelectItem key={idx} value={idx.toString()}>
                                    {getColumnName(idx)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs">Time Column</Label>
                            <Select
                              value={columnMapping.timeColumn.toString()}
                              onValueChange={(value) => setColumnMapping(prev => ({ ...prev, timeColumn: value }))}
                            >
                              <SelectTrigger className="h-8 text-xs bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-background z-50">
                                <SelectItem value="-1">None (combined with date)</SelectItem>
                                {previewData.headers.map((header, idx) => (
                                  <SelectItem key={idx} value={idx.toString()}>
                                    {getColumnName(idx)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs">kWh Value Column</Label>
                            <Select
                              value={columnMapping.valueColumn.toString()}
                              onValueChange={(value) => setColumnMapping(prev => ({ ...prev, valueColumn: value }))}
                            >
                              <SelectTrigger className="h-8 text-xs bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-background z-50">
                                {previewData.headers.map((header, idx) => (
                                  <SelectItem key={idx} value={idx.toString()}>
                                    {getColumnName(idx)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs">kVA Value Column (Optional)</Label>
                            <Select
                              value={columnMapping.kvaColumn.toString()}
                              onValueChange={(value) => setColumnMapping(prev => ({ ...prev, kvaColumn: value }))}
                            >
                              <SelectTrigger className="h-8 text-xs bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-background z-50">
                                <SelectItem value="-1">None</SelectItem>
                                {previewData.headers.map((header, idx) => (
                                  <SelectItem key={idx} value={idx.toString()}>
                                    {getColumnName(idx)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
              </Card>
            )}
            </div>
          </TabsContent>

          <TabsContent value="preview" className="flex-1 overflow-auto mt-0 data-[state=active]:flex data-[state=active]:flex-col">
            <div className="space-y-4 p-4">
              {!previewData ? (
                <div className="text-center py-8 text-muted-foreground">
                  Load a preview first to see the data
                </div>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Data Preview (First 20 rows)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {previewData.headers.map((header, idx) => (
                              <TableHead key={idx} className="whitespace-nowrap">
                                <div className="flex flex-col gap-1">
                                  <span>{getColumnName(idx)}</span>
                                  <Badge variant="outline" className="w-fit text-xs">
                                    {columnMapping.columnDataTypes?.[idx] || 'string'}
                                  </Badge>
                                </div>
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewData.rows.slice(0, 10).map((row, rowIdx) => (
                            <TableRow key={rowIdx}>
                              {row.map((cell, cellIdx) => (
                                <TableCell key={cellIdx} className="font-mono text-xs whitespace-nowrap">
                                  {cell}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
                )}
              </div>
            </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleParse}
            disabled={!selectedFile || !previewData || isParsing}
            className="gap-2"
          >
            <Play className="w-4 h-4" />
            {isParsing ? "Parsing..." : "Parse & Import"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
