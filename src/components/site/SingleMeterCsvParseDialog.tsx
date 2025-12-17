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
  datetimeColumn: number | string | null;
  datetimeFormat: string | null;
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
    datetimeColumn: null,
    datetimeFormat: null,
    renamedHeaders: {},
    columnDataTypes: {}
  });
  const [columnSplits, setColumnSplits] = useState<Record<number, string>>({});
  const [splitColumnNames, setSplitColumnNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);

  // Helper function to apply column splits
  const applySplits = (row: any[], columnIndex: number): any[] => {
    const splitType = columnSplits[columnIndex];
    if (!splitType || splitType === 'none') return [row[columnIndex]];
    
    const cell = row[columnIndex]?.toString() || '';
    const delimiterMap: Record<string, string | RegExp> = {
      tab: '\t',
      comma: ',',
      semicolon: ';',
      space: /\s+/
    };
    
    const delimiter = delimiterMap[splitType];
    if (delimiter instanceof RegExp) {
      return cell.split(delimiter);
    }
    return cell.split(delimiter);
  };

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
        .from('client-files')
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

  // Derive datetimeColumn from columnDataTypes
  const getDerivedDatetimeColumn = () => {
    if (!columnMapping.columnDataTypes) return null;
    const datetimeEntry = Object.entries(columnMapping.columnDataTypes).find(([_, type]) => type === 'datetime');
    return datetimeEntry ? datetimeEntry[0] : null;
  };

  const handleParse = async () => {
    if (!selectedFile) {
      toast.error("No CSV file selected");
      return;
    }

    const derivedDatetimeColumn = getDerivedDatetimeColumn();
    if (!derivedDatetimeColumn) {
      toast.error("Please set a column's Data Type to 'DateTime' before parsing");
      return;
    }

    setIsParsing(true);
    try {
      // Build final column mapping with derived datetimeColumn
      const finalColumnMapping = {
        ...columnMapping,
        datetimeColumn: derivedDatetimeColumn
      };

      // Update the CSV file record with the configuration
      const { error: updateError } = await supabase
        .from('meter_csv_files')
        .update({
          separator,
          header_row_number: parseInt(headerRowNumber),
          column_mapping: finalColumnMapping as any,
          parse_status: 'pending'
        })
        .eq('id', selectedFile.id);

      if (updateError) throw updateError;

      // Trigger the parsing edge function
      const { data, error } = await supabase.functions.invoke('process-meter-csv', {
        body: { 
          csvFileId: selectedFile.id,
          meterId,
          separator: separator === "tab" ? "\t" : 
                     separator === "comma" ? "," : 
                     separator === "semicolon" ? ";" : 
                     separator === "space" ? " " : "\t",
          headerRowNumber: parseInt(headerRowNumber),
          columnMapping: finalColumnMapping
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

              {/* DateTime column is now selected via Column Interpretation section below */}

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
                      {/* Select All/Deselect All Header */}
                      <div className="p-3 border rounded-md bg-background/50">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={Object.values(visibleColumns).every(v => v !== false)}
                            onCheckedChange={(checked) => {
                              const newState: { [key: string]: boolean } = {};
                              previewData.headers.forEach((_, idx) => {
                                newState[idx.toString()] = checked === true;
                              });
                              setVisibleColumns(newState);
                            }}
                            className="shrink-0"
                          />
                          <Label className="text-sm font-semibold cursor-pointer" onClick={() => {
                            const allChecked = Object.values(visibleColumns).every(v => v !== false);
                            const newState: { [key: string]: boolean } = {};
                            previewData.headers.forEach((_, idx) => {
                              newState[idx.toString()] = !allChecked;
                            });
                            setVisibleColumns(newState);
                          }}>
                            Column Name
                          </Label>
                        </div>
                      </div>

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
                                  {currentDataType === 'datetime' && (
                                    <div>
                                      <Label className="text-xs mb-1">DateTime Format</Label>
                                      <Select 
                                        value={columnMapping.datetimeFormat ?? ""} 
                                        onValueChange={(v) => setColumnMapping(prev => ({ ...prev, datetimeFormat: v }))}
                                      >
                                        <SelectTrigger className="h-8 text-xs bg-background">
                                          <SelectValue placeholder="Auto-detect" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-background z-50">
                                          <SelectItem value="YYYY-MM-DD HH:mm:ss">YYYY-MM-DD HH:mm:ss</SelectItem>
                                          <SelectItem value="YYYY-MM-DD HH:mm">YYYY-MM-DD HH:mm</SelectItem>
                                          <SelectItem value="DD/MM/YYYY HH:mm:ss">DD/MM/YYYY HH:mm:ss</SelectItem>
                                          <SelectItem value="DD/MM/YYYY HH:mm">DD/MM/YYYY HH:mm</SelectItem>
                                          <SelectItem value="MM/DD/YYYY HH:mm:ss">MM/DD/YYYY HH:mm:ss</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  )}
                                  <div>
                                    <Label className="text-xs mb-1">Split Column By</Label>
                                    <Select 
                                      value={columnSplits[idx] || 'none'} 
                                      onValueChange={(val) => setColumnSplits(prev => ({...prev, [idx]: val}))}
                                    >
                                      <SelectTrigger className="h-8 text-xs bg-background">
                                        <SelectValue placeholder="No split" />
                                      </SelectTrigger>
                                      <SelectContent className="bg-background z-50">
                                        <SelectItem value="none">No split</SelectItem>
                                        <SelectItem value="tab">Split by Tab</SelectItem>
                                        <SelectItem value="comma">Split by Comma</SelectItem>
                                        <SelectItem value="semicolon">Split by Semicolon</SelectItem>
                                        <SelectItem value="space">Split by Space</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                {/* Split Part Names - shown when column is split */}
                                {columnSplits[idx] && columnSplits[idx] !== 'none' && previewData?.rows[0] && (
                                  <div className="mt-3 p-3 border rounded-md bg-accent/5">
                                    <Label className="text-xs mb-2 block text-muted-foreground">Split Part Names</Label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                      {applySplits(previewData.rows[0], idx).map((part, partIdx) => {
                                        const columnKey = `${idx}-${partIdx}`;
                                        return (
                                          <div key={columnKey}>
                                            <Input
                                              value={splitColumnNames[columnKey] || ''}
                                              onChange={(e) => setSplitColumnNames(prev => ({
                                                ...prev,
                                                [columnKey]: e.target.value
                                              }))}
                                              className="h-7 text-xs"
                                              placeholder={`Part ${partIdx + 1} (${part?.toString().substring(0, 10) || '...'})`}
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
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
                            {previewData.headers.flatMap((header, idx) => {
                              const splitType = columnSplits[idx];
                              if (splitType && splitType !== 'none' && previewData.rows[0]) {
                                const splitParts = applySplits(previewData.rows[0], idx);
                                return splitParts.map((_, partIdx) => {
                                  const columnKey = `${idx}-${partIdx}`;
                                  const splitName = splitColumnNames[columnKey] || `${getColumnName(idx)} [${partIdx + 1}]`;
                                  return (
                                    <TableHead key={columnKey} className="whitespace-nowrap">
                                      <div className="flex flex-col gap-1">
                                        <span>{splitName}</span>
                                        <Badge variant="outline" className="w-fit text-xs bg-accent/10">
                                          split
                                        </Badge>
                                      </div>
                                    </TableHead>
                                  );
                                });
                              }
                              return (
                                <TableHead key={idx} className="whitespace-nowrap">
                                  <div className="flex flex-col gap-1">
                                    <span>{getColumnName(idx)}</span>
                                    <Badge variant="outline" className="w-fit text-xs">
                                      {columnMapping.columnDataTypes?.[idx] || 'string'}
                                    </Badge>
                                  </div>
                                </TableHead>
                              );
                            })}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewData.rows.slice(0, 10).map((row, rowIdx) => (
                            <TableRow key={rowIdx}>
                              {row.flatMap((cell, cellIdx) => {
                                const splitParts = applySplits(row, cellIdx);
                                return splitParts.map((part, partIdx) => (
                                  <TableCell key={`${cellIdx}-${partIdx}`} className="font-mono text-xs whitespace-nowrap">
                                    {part?.toString() || '—'}
                                  </TableCell>
                                ));
                              })}
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
            disabled={!selectedFile || !previewData || isParsing || !getDerivedDatetimeColumn()}
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
