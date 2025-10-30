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

        <Tabs defaultValue="config" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="config">Configuration</TabsTrigger>
            <TabsTrigger value="columns">Column Mapping</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1">
            <TabsContent value="config" className="space-y-4 p-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">File Selection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>CSV File</Label>
                    <Select
                      value={selectedFile?.id}
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
                      <SelectTrigger>
                        <SelectValue placeholder="Select a CSV file" />
                      </SelectTrigger>
                      <SelectContent>
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

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Separator</Label>
                      <Select value={separator} onValueChange={setSeparator}>
                        <SelectTrigger>
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

                    <div className="space-y-2">
                      <Label>Header Row Number</Label>
                      <Input
                        type="number"
                        min="1"
                        value={headerRowNumber}
                        onChange={(e) => setHeaderRowNumber(e.target.value)}
                      />
                    </div>
                  </div>

                  <Button onClick={loadPreview} disabled={!selectedFile || isLoading} className="w-full gap-2">
                    <Eye className="w-4 h-4" />
                    Load Preview
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="columns" className="space-y-4 p-4">
              {!previewData ? (
                <div className="text-center py-8 text-muted-foreground">
                  Load a preview first to configure column mapping
                </div>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Column Configuration</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Date Column</Label>
                        <Select
                          value={columnMapping.dateColumn.toString()}
                          onValueChange={(value) => setColumnMapping(prev => ({ ...prev, dateColumn: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {previewData.headers.map((header, idx) => (
                              <SelectItem key={idx} value={idx.toString()}>
                                {getColumnName(idx)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Time Column</Label>
                        <Select
                          value={columnMapping.timeColumn.toString()}
                          onValueChange={(value) => setColumnMapping(prev => ({ ...prev, timeColumn: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
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
                        <Label>kWh Value Column</Label>
                        <Select
                          value={columnMapping.valueColumn.toString()}
                          onValueChange={(value) => setColumnMapping(prev => ({ ...prev, valueColumn: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {previewData.headers.map((header, idx) => (
                              <SelectItem key={idx} value={idx.toString()}>
                                {getColumnName(idx)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>kVA Value Column (Optional)</Label>
                        <Select
                          value={columnMapping.kvaColumn.toString()}
                          onValueChange={(value) => setColumnMapping(prev => ({ ...prev, kvaColumn: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
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

                    <div className="space-y-4 pt-4 border-t">
                      <Label>Column Data Types</Label>
                      <div className="grid gap-2">
                        {previewData.headers.map((header, idx) => (
                          <div key={idx} className="flex items-center gap-4">
                            <div className="flex-1">
                              <Input
                                value={columnMapping.renamedHeaders?.[idx] || header}
                                onChange={(e) => setColumnMapping(prev => ({
                                  ...prev,
                                  renamedHeaders: { ...prev.renamedHeaders, [idx]: e.target.value }
                                }))}
                                placeholder={`Column ${idx + 1} name`}
                              />
                            </div>
                            <div className="w-32">
                              <Select
                                value={columnMapping.columnDataTypes?.[idx] || 'string'}
                                onValueChange={(value: any) => setColumnMapping(prev => ({
                                  ...prev,
                                  columnDataTypes: { ...prev.columnDataTypes, [idx]: value }
                                }))}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="datetime">DateTime</SelectItem>
                                  <SelectItem value="float">Float</SelectItem>
                                  <SelectItem value="int">Integer</SelectItem>
                                  <SelectItem value="string">String</SelectItem>
                                  <SelectItem value="boolean">Boolean</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="preview" className="space-y-4 p-4">
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
            </TabsContent>
          </ScrollArea>
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
