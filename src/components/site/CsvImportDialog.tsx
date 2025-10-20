import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";

interface CsvImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  meterId: string;
  onImportComplete: () => void;
}

interface CsvData {
  headers: string[];
  rows: any[][];
  preview: any[];
}

export default function CsvImportDialog({ isOpen, onClose, meterId, onImportComplete }: CsvImportDialogProps) {
  const [csvData, setCsvData] = useState<CsvData | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [timestampColumn, setTimestampColumn] = useState<string>("");
  const [valueColumn, setValueColumn] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [step, setStep] = useState<"upload" | "confirm">("upload");
  const [separator, setSeparator] = useState<string>("tab");
  const [columnSplits, setColumnSplits] = useState<Record<number, string>>({});
  const [splitColumnNames, setSplitColumnNames] = useState<Record<string, string>>({});
  const [replaceExisting, setReplaceExisting] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".csv")) {
      toast.error("Please select a CSV file");
      return;
    }

    setSelectedFile(file);
    parseCSV(file);
  };
  
  // Re-parse when separator changes
  const handleSeparatorChange = (newSeparator: string) => {
    setSeparator(newSeparator);
    if (selectedFile) {
      // Reset state and re-parse with new separator
      setCsvData(null);
      setTimestampColumn("");
      setValueColumn("");
      // Small delay to ensure state is updated
      setTimeout(() => parseCSV(selectedFile), 50);
    }
  };

  const parseCSV = (file: File) => {
    console.log('📄 Starting CSV parse for file:', file.name, 'Size:', file.size);
    console.log('🔧 Using separator:', separator);
    
    // For space separator, we need to pre-process the file
    if (separator === 'space') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        // Replace multiple spaces with single tab
        const normalized = text.split('\n').map(line => 
          line.trim().replace(/\s+/g, '\t')
        ).join('\n');
        
        // Parse with tab delimiter
        Papa.parse(normalized, {
          delimiter: "\t",
          skipEmptyLines: true,
          complete: processResults,
          error: handleError,
        });
      };
      reader.readAsText(file);
    } else {
      const delimiterMap: Record<string, string> = {
        tab: "\t",
        comma: ",",
        semicolon: ";"
      };
      
      Papa.parse(file, {
        delimiter: delimiterMap[separator],
        skipEmptyLines: true,
        complete: processResults,
        error: handleError,
      });
    }
  };
  
  const processResults = (results: any) => {
        const data = results.data as any[][];
        console.log('✅ CSV parsed. Total rows:', data.length);
        
        // Smart header detection: check if first data row looks like actual headers
        let headerRowIndex = 0;
        let dataStartIndex = 1;
        
        // Check first few rows to find the real headers
        for (let i = 0; i < Math.min(3, data.length); i++) {
          const currentRow = data[i];
          const nextRow = data[i + 1];
          
          if (currentRow && nextRow) {
            // If current row has text like "Time", "P1 (kWh)" and next row has timestamps/numbers
            const currentHasTimeHeader = currentRow.some((cell: any) => 
              typeof cell === 'string' && cell.toLowerCase().trim() === 'time'
            );
            const nextHasTimestamp = nextRow.some((cell: any) => 
              typeof cell === 'string' && /\d{4}-\d{2}-\d{2}/.test(cell)
            );
            
            if (currentHasTimeHeader && nextHasTimestamp) {
              headerRowIndex = i;
              dataStartIndex = i + 1;
              console.log('✨ Real headers found at row:', i);
              break;
            }
          }
        }

        const headers = data[headerRowIndex];
        console.log('📊 Headers:', headers);
        
        const dataRows = data.slice(dataStartIndex).filter(row => 
          row.some((cell: any) => cell !== null && cell !== '' && cell !== undefined)
        );
        console.log('📈 Data rows:', dataRows.length);
        
        const preview = dataRows.slice(0, 10);

        setCsvData({
          headers,
          rows: dataRows,
          preview,
        });
        
        // Auto-detect timestamp column
        const timeColumnIndex = headers.findIndex((h: string) => {
          if (!h) return false;
          const lower = h.toLowerCase().trim();
          return lower === 'time' || lower === 'timestamp' || lower === 'date';
        });
        
        if (timeColumnIndex >= 0) {
          console.log('⏰ Timestamp column:', headers[timeColumnIndex]);
          setTimestampColumn(headers[timeColumnIndex]);
        }

        // Auto-detect kWh column - look for P1 (kWh)
        const kwhColumnIndex = headers.findIndex((h: string) => {
          if (!h) return false;
          const lower = h.toLowerCase().trim();
          return lower.includes('kwh') || lower.includes('p1');
        });
        
        if (kwhColumnIndex >= 0) {
          console.log('⚡ Value column:', headers[kwhColumnIndex]);
          setValueColumn(headers[kwhColumnIndex]);
        }

        // Always show confirmation step
        setStep("confirm");
        if (timeColumnIndex >= 0 && kwhColumnIndex >= 0) {
          console.log('✅ All columns detected automatically');
          toast.success(`Parsed ${dataRows.length} rows with ${headers.length} columns. Review and confirm to import.`);
        } else {
          toast.warning("Please verify the detected columns before importing");
        }
  };
  
  const handleError = (error: any) => {
    console.error('❌ CSV parse error:', error);
    toast.error(`Failed to parse CSV: ${error.message}`);
  };

  const handleImport = async () => {
    if (!csvData || !timestampColumn || !valueColumn) {
      toast.error("Please select timestamp and value columns");
      return;
    }

    console.log('🚀 Starting import process...');
    console.log('📌 Selected columns:', { timestampColumn, valueColumn });
    console.log('🔄 Replace existing:', replaceExisting);
    
    setIsUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      console.log('👤 User ID:', user?.id);
      
      // If replace existing, delete all current readings for this meter
      if (replaceExisting) {
        console.log('🗑️ Deleting existing readings...');
        const { error: deleteError } = await supabase
          .from('meter_readings')
          .delete()
          .eq('meter_id', meterId);
        
        if (deleteError) {
          console.error('Delete error:', deleteError);
          throw new Error(`Failed to delete existing readings: ${deleteError.message}`);
        }
        console.log('✅ Existing readings deleted');
      }
      
      const timestampIndex = csvData.headers.indexOf(timestampColumn);
      const valueIndex = csvData.headers.indexOf(valueColumn);
      console.log('📍 Column indices - Timestamp:', timestampIndex, 'Value:', valueIndex);
      console.log('📦 All columns will be included');

      // Prepare batch insert data
      let validCount = 0;
      let invalidCount = 0;
      
      const readings = csvData.rows
        .map((row, rowIdx) => {
          const timestamp = row[timestampIndex];
          const value = parseFloat(row[valueIndex]);

          // Log first 5 rows for debugging
          if (rowIdx < 5) {
            console.log(`📝 Row ${rowIdx + 1}:`, {
              timestamp,
              rawValue: row[valueIndex],
              parsedValue: value,
              isValid: !!timestamp && !isNaN(value)
            });
          }

          // Validate data
          if (!timestamp || isNaN(value)) {
            invalidCount++;
            if (rowIdx < 5) console.warn(`⚠️ Row ${rowIdx + 1} invalid:`, { timestamp, value });
            return null;
          }

          validCount++;
          
          // Include ALL columns in metadata
          const mappedFields: Record<string, any> = {};
          
          csvData.headers.forEach((colName, colIdx) => {
            if (colName && colName.trim()) {
              mappedFields[colName] = row[colIdx];
            }
          });
          
          // Log all mapped fields for first row
          if (rowIdx === 0) {
            console.log('📋 All mapped fields in first row:', mappedFields);
          }

          return {
            meter_id: meterId,
            reading_timestamp: new Date(timestamp).toISOString(),
            kwh_value: value,
            uploaded_by: user?.id,
            metadata: {
              source_file: selectedFile?.name,
              imported_fields: mappedFields,
            },
          };
        })
        .filter(Boolean);
      
      console.log(`✅ Valid readings: ${validCount}, ❌ Invalid: ${invalidCount}`);

      if (readings.length === 0) {
        toast.error("No valid readings found in CSV");
        setIsUploading(false);
        return;
      }

      // Insert in batches of 1000
      const batchSize = 1000;
      let imported = 0;

      for (let i = 0; i < readings.length; i += batchSize) {
        const batch = readings.slice(i, i + batchSize);
        const { error } = await supabase.from("meter_readings").insert(batch);

        if (error) {
          throw error;
        }

        imported += batch.length;
        toast.info(`Imported ${imported} of ${readings.length} readings...`);
      }

      toast.success(`Successfully imported ${imported} readings`);
      onImportComplete();
      handleClose();
    } catch (error: any) {
      toast.error(`Import failed: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    setCsvData(null);
    setSelectedFile(null);
    setTimestampColumn("");
    setValueColumn("");
    setStep("upload");
    setSeparator("tab");
    setColumnSplits({});
    setSplitColumnNames({});
    setReplaceExisting(false);
    onClose();
  };

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

  const getColumnType = (columnName: string, sampleValues: any[]) => {
    const name = columnName.toLowerCase();
    
    // Time/Date columns
    if (name.includes('time') || name.includes('date')) {
      return { type: 'timestamp', color: 'bg-primary/10 text-primary', icon: '📅' };
    }
    
    // Active Power (kWh)
    if (name.includes('p1') && name.includes('kwh')) {
      return { type: 'active_power_p1', color: 'bg-green-500/10 text-green-700', icon: '⚡' };
    }
    if (name.includes('p2') && name.includes('kwh')) {
      return { type: 'active_power_p2', color: 'bg-green-600/10 text-green-800', icon: '⚡' };
    }
    if (name.includes('kwh')) {
      return { type: 'energy', color: 'bg-accent/10 text-accent', icon: '⚡' };
    }
    
    // Reactive Power (kvarh)
    if (name.includes('q1') && name.includes('kvar')) {
      return { type: 'reactive_q1', color: 'bg-blue-500/10 text-blue-700', icon: '🔵' };
    }
    if (name.includes('q2') && name.includes('kvar')) {
      return { type: 'reactive_q2', color: 'bg-blue-600/10 text-blue-800', icon: '🔵' };
    }
    if (name.includes('q3') && name.includes('kvar')) {
      return { type: 'reactive_q3', color: 'bg-blue-700/10 text-blue-900', icon: '🔵' };
    }
    if (name.includes('q4') && name.includes('kvar')) {
      return { type: 'reactive_q4', color: 'bg-blue-800/10 text-blue-950', icon: '🔵' };
    }
    if (name.includes('kvar')) {
      return { type: 'reactive', color: 'bg-warning/10 text-warning', icon: '🔵' };
    }
    
    // Apparent Power (kVA/kVAh)
    if (name.includes('kva')) {
      return { type: 'apparent', color: 'bg-purple-500/10 text-purple-700', icon: '⚙️' };
    }
    
    // Status
    if (name.includes('status')) {
      return { type: 'status', color: 'bg-orange-500/10 text-orange-700', icon: '📊' };
    }
    
    // Check if numeric
    const hasNumbers = sampleValues.some(v => !isNaN(parseFloat(v)));
    if (hasNumbers) {
      return { type: 'numeric', color: 'bg-secondary/10 text-secondary', icon: '🔢' };
    }
    
    return { type: 'text', color: 'bg-muted text-muted-foreground', icon: '📝' };
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Meter Readings from CSV</DialogTitle>
          <DialogDescription>
            Upload and map CSV columns to import meter reading data
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <div className="mb-4">
              <Label className="mb-2">Column Separator</Label>
              <Select value={separator} onValueChange={handleSeparatorChange}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[100] bg-popover">
                  <SelectItem value="tab">Tab</SelectItem>
                  <SelectItem value="comma">Comma (,)</SelectItem>
                  <SelectItem value="semicolon">Semicolon (;)</SelectItem>
                  <SelectItem value="space">Space</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-primary transition-colors">
              <Upload className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <input
                id="csv-upload"
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Label htmlFor="csv-upload" className="cursor-pointer">
                {selectedFile ? (
                  <div className="text-primary font-medium">
                    {selectedFile.name}
                    <p className="text-xs text-muted-foreground mt-1">
                      {(selectedFile.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                ) : (
                  <div>
                    <span className="text-primary font-medium">Click to upload</span> or drag and drop
                    <p className="text-xs mt-1 text-muted-foreground">CSV files only</p>
                  </div>
                )}
              </Label>
            </div>

            <Card className="border-border/50 bg-muted/20">
              <CardHeader>
                <CardTitle className="text-base">Expected CSV Format</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>• Headers in first or second row</p>
                <p>• Timestamp column (e.g., "Time", "Date", "Timestamp")</p>
                <p>• Energy value column (e.g., "kWh", "P1 (kWh)", "kVA")</p>
                <p>• Optional: Additional metadata columns</p>
              </CardContent>
            </Card>
          </div>
        )}

        {step === "confirm" && csvData && (
          <div className="space-y-6">
            <Card className="border-border/50 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-blue-600" />
                  Review Parsed Data
                </CardTitle>
                <CardDescription>
                  Separator: <span className="font-semibold">{separator === 'tab' ? 'Tab' : separator === 'comma' ? 'Comma' : separator === 'semicolon' ? 'Semicolon' : 'Space'}</span> • 
                  {csvData.rows.length} rows • {csvData.headers.length} columns detected
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border/50 bg-muted/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-accent" />
                  Data Preview
                </CardTitle>
                <CardDescription>
                  First 10 rows. You can split columns further if needed (e.g., split combined date/time).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {csvData.headers.map((header, idx) => {
                          const sampleValues = csvData.preview.map(row => row[idx]);
                          const { type, color } = getColumnType(header, sampleValues);
                          const splitType = columnSplits[idx];
                          
                          // Check how many columns this will create after split
                          if (splitType && splitType !== 'none') {
                            const firstRowSplit = applySplits(csvData.preview[0], idx);
                            return firstRowSplit.map((_, partIdx) => {
                              const columnKey = `${idx}-${partIdx}`;
                              const defaultName = partIdx === 0 ? 'Date' : 'Time';
                              const displayName = splitColumnNames[columnKey] || `${header} [${partIdx + 1}]`;
                              
                              return (
                                <TableHead key={columnKey} className="min-w-40">
                                  <div className="flex flex-col gap-2">
                                    <div className="flex flex-col gap-1">
                                      <Input
                                        value={displayName}
                                        onChange={(e) => setSplitColumnNames(prev => ({
                                          ...prev,
                                          [columnKey]: e.target.value
                                        }))}
                                        placeholder={defaultName}
                                        className="h-7 text-xs font-medium"
                                      />
                                      <Badge variant="outline" className={`text-[10px] ${color} w-fit`}>
                                        {type}
                                      </Badge>
                                    </div>
                                    {partIdx === 0 && (
                                      <Select 
                                        value={splitType} 
                                        onValueChange={(val) => setColumnSplits(prev => ({...prev, [idx]: val}))}
                                      >
                                        <SelectTrigger className="h-7 text-xs bg-background">
                                          <SelectValue placeholder="Split by..." />
                                        </SelectTrigger>
                                        <SelectContent className="z-[100] bg-popover">
                                          <SelectItem value="none">No split</SelectItem>
                                          <SelectItem value="tab">Split by Tab</SelectItem>
                                          <SelectItem value="comma">Split by Comma</SelectItem>
                                          <SelectItem value="semicolon">Split by Semicolon</SelectItem>
                                          <SelectItem value="space">Split by Space</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    )}
                                  </div>
                                </TableHead>
                              );
                            });
                          }
                          
                          return (
                            <TableHead key={idx} className="min-w-40">
                              <div className="flex flex-col gap-2">
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium">{header}</span>
                                  <Badge variant="outline" className={`text-[10px] ${color} w-fit`}>
                                    {type}
                                  </Badge>
                                </div>
                                <Select 
                                  value={columnSplits[idx] || 'none'} 
                                  onValueChange={(val) => setColumnSplits(prev => ({...prev, [idx]: val}))}
                                >
                                  <SelectTrigger className="h-7 text-xs bg-background">
                                    <SelectValue placeholder="Split by..." />
                                  </SelectTrigger>
                                  <SelectContent className="z-[100] bg-popover">
                                    <SelectItem value="none">No split</SelectItem>
                                    <SelectItem value="tab">Split by Tab</SelectItem>
                                    <SelectItem value="comma">Split by Comma</SelectItem>
                                    <SelectItem value="semicolon">Split by Semicolon</SelectItem>
                                    <SelectItem value="space">Split by Space</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvData.preview.map((row, rowIdx) => (
                        <TableRow key={rowIdx}>
                          {row.map((cell: any, cellIdx: number) => {
                            const splitParts = applySplits(row, cellIdx);
                            
                            // Render each split part as a separate cell
                            return splitParts.map((part, partIdx) => (
                              <TableCell key={`${cellIdx}-${partIdx}`} className="font-mono text-xs">
                                {part?.toString() || "—"}
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

            <div className="flex gap-3 pt-4 border-t">
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="checkbox"
                  id="replaceExisting"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="w-4 h-4"
                />
                <Label htmlFor="replaceExisting" className="text-sm cursor-pointer">
                  Replace all existing readings for this meter
                </Label>
              </div>
              <Button 
                variant="outline" 
                onClick={() => {
                  setStep("upload");
                  setCsvData(null);
                  setTimestampColumn("");
                  setValueColumn("");
                }}
              >
                Cancel / Change Separator
              </Button>
              <Button
                onClick={handleImport}
                disabled={!timestampColumn || !valueColumn || isUploading}
                className="bg-primary"
              >
                {isUploading ? "Importing..." : `✓ Confirm & Import ${csvData.rows.length} Readings`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
