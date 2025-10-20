import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  const [additionalColumns, setAdditionalColumns] = useState<string[]>([]);
  const [skipRows, setSkipRows] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);
  const [step, setStep] = useState<"upload" | "map" | "confirm">("upload");

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

  const parseCSV = (file: File) => {
    console.log('📄 Starting CSV parse for file:', file.name, 'Size:', file.size);
    
    Papa.parse(file, {
      complete: (results) => {
        const data = results.data as any[][];
        console.log('✅ CSV parsed. Total rows:', data.length);
        
        // Auto-detect header row by finding first row with text
        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(5, data.length); i++) {
          const row = data[i];
          if (row.some((cell: any) => typeof cell === 'string' && cell.trim().length > 0)) {
            headerRowIndex = i;
            break;
          }
        }
        console.log('📋 Header row detected at index:', headerRowIndex);

        const headers = data[headerRowIndex];
        console.log('📊 Headers found:', headers);
        console.log('📊 Number of columns:', headers.length);
        
        const dataRows = data.slice(headerRowIndex + 1).filter(row => row.some((cell: any) => cell !== null && cell !== ''));
        console.log('📈 Data rows after filtering:', dataRows.length);
        
        // Create preview (first 10 rows)
        const preview = dataRows.slice(0, 10);
        console.log('👁️ Preview rows created:', preview.length);

        // Log each column with sample data
        headers.forEach((header: string, idx: number) => {
          const sampleValues = preview.map(row => row[idx]).filter(v => v != null);
          console.log(`🔍 Column ${idx}: "${header}"`, {
            samples: sampleValues.slice(0, 3),
            totalNonNull: sampleValues.length,
            hasNumeric: sampleValues.some(v => !isNaN(parseFloat(v)))
          });
        });

        setCsvData({
          headers,
          rows: dataRows,
          preview,
        });

        setSkipRows(headerRowIndex);
        
        // Auto-detect timestamp column - prioritize exact matches first
        const timeColumnIndex = headers.findIndex((h: string) => {
          const lower = h.toLowerCase().trim();
          return lower === 'time' || 
                 lower === 'timestamp' || 
                 lower === 'date' ||
                 lower.includes('time') || 
                 lower.includes('date');
        });
        if (timeColumnIndex >= 0) {
          console.log('⏰ Auto-detected timestamp column:', headers[timeColumnIndex], 'at index', timeColumnIndex);
          setTimestampColumn(headers[timeColumnIndex]);
        } else {
          console.warn('⚠️ No timestamp column auto-detected');
        }

        // Auto-detect primary kWh column - look for P1 (kWh) first, then other kWh patterns
        const kwhColumnIndex = headers.findIndex((h: string) => {
          const lower = h.toLowerCase().trim();
          return lower.includes('p1') && lower.includes('kwh') ||
                 lower.includes('kwh') ||
                 lower.includes('p1');
        });
        if (kwhColumnIndex >= 0) {
          console.log('⚡ Auto-detected kWh column:', headers[kwhColumnIndex], 'at index', kwhColumnIndex);
          setValueColumn(headers[kwhColumnIndex]);
        } else {
          console.warn('⚠️ No kWh column auto-detected');
        }

        // Auto-select ALL columns for complete data capture
        const allAvailableColumns = headers.filter((h: string) => h && h.trim());
        console.log('📦 All available columns:', allAvailableColumns);
        setAdditionalColumns(allAvailableColumns);

        setStep("map");
        toast.success("CSV parsed successfully");
      },
      error: (error) => {
        console.error('❌ CSV parse error:', error);
        toast.error(`Failed to parse CSV: ${error.message}`);
      },
    });
  };

  const handleImport = async () => {
    if (!csvData || !timestampColumn || !valueColumn) {
      toast.error("Please select timestamp and value columns");
      return;
    }

    console.log('🚀 Starting import process...');
    console.log('📌 Selected columns:', { timestampColumn, valueColumn });
    
    setIsUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      console.log('👤 User ID:', user?.id);
      
      const timestampIndex = csvData.headers.indexOf(timestampColumn);
      const valueIndex = csvData.headers.indexOf(valueColumn);
      console.log('📍 Column indices - Timestamp:', timestampIndex, 'Value:', valueIndex);
      console.log('📦 Additional columns to include:', additionalColumns);

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
          
          // Include all mapped columns in metadata
          const mappedFields: Record<string, any> = {
            [timestampColumn]: timestamp,
            [valueColumn]: value,
          };
          
          // Add all additional columns
          additionalColumns.forEach(colName => {
            const colIdx = csvData.headers.indexOf(colName);
            if (colIdx >= 0) {
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
    setAdditionalColumns([]);
    setSkipRows(0);
    setStep("upload");
    onClose();
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

        {step === "map" && csvData && (
          <div className="space-y-6">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Column Mapping</CardTitle>
                <CardDescription>Select which columns to import from your CSV</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Timestamp Column *</Label>
                    <Select value={timestampColumn} onValueChange={setTimestampColumn}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select timestamp column" />
                      </SelectTrigger>
                      <SelectContent>
                        {csvData.headers.map((header, idx) => (
                          <SelectItem key={idx} value={header}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Energy Value Column (kWh/kVA) *</Label>
                    <Select value={valueColumn} onValueChange={setValueColumn}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select value column" />
                      </SelectTrigger>
                      <SelectContent>
                        {csvData.headers.map((header, idx) => (
                          <SelectItem key={idx} value={header}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>All Columns Being Imported</Label>
                    <Badge variant="secondary">{additionalColumns.length} columns</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    All columns from your CSV will be stored. Click any column to exclude it from import.
                  </p>
                  <div className="flex flex-wrap gap-2 p-4 bg-muted/30 rounded-lg max-h-32 overflow-y-auto">
                    {csvData.headers
                      .filter(h => h && h.trim())
                      .map((header, idx) => {
                        const isTimestamp = header === timestampColumn;
                        const isValue = header === valueColumn;
                        const isSelected = additionalColumns.includes(header);
                        const columnType = getColumnType(header, csvData.preview.map(row => row[idx]));
                        
                        return (
                          <Badge
                            key={idx}
                            variant={isTimestamp || isValue ? "default" : (isSelected ? "secondary" : "outline")}
                            className={`cursor-pointer transition-all ${
                              isTimestamp || isValue 
                                ? "bg-primary" 
                                : isSelected 
                                  ? "hover:bg-secondary/80" 
                                  : "hover:bg-muted opacity-50"
                            }`}
                            onClick={() => {
                              if (isTimestamp || isValue) return; // Can't deselect required columns
                              if (isSelected) {
                                setAdditionalColumns(prev => prev.filter(col => col !== header));
                              } else {
                                setAdditionalColumns(prev => [...prev, header]);
                              }
                            }}
                          >
                            {isTimestamp && "📅 "}
                            {isValue && "⚡ "}
                            {!isTimestamp && !isValue && columnType.icon && `${columnType.icon} `}
                            {header}
                            {(isTimestamp || isValue) && " (required)"}
                          </Badge>
                        );
                      })}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertCircle className="w-4 h-4" />
                  <span>Found {csvData.rows.length} data rows</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-green-500/5 border-green-500/20">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Data Preview - All Columns Will Be Imported
                </CardTitle>
                <CardDescription>
                  First 10 rows showing all columns including: Time, P1 (kWh), Q1-Q4 (kvarh), S (kVA/kVAh), Status
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
                          return (
                            <TableHead key={idx} className="min-w-32">
                              <div className="flex flex-col gap-1">
                                <span className="font-medium">{header}</span>
                                <Badge variant="outline" className={`text-[10px] ${color} w-fit`}>
                                  {type}
                                </Badge>
                              </div>
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvData.preview.map((row, rowIdx) => (
                        <TableRow key={rowIdx}>
                          {row.map((cell: any, cellIdx: number) => (
                            <TableCell key={cellIdx} className="font-mono text-xs">
                              {cell?.toString() || "—"}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button
                onClick={() => setStep("confirm")}
                disabled={!timestampColumn || !valueColumn}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === "confirm" && csvData && (
          <div className="space-y-6">
            <Card className="border-border/50 bg-accent/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-accent" />
                  <CardTitle className="text-base">Import Summary</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Source File</p>
                    <p className="font-medium">{selectedFile?.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Total Rows</p>
                    <p className="font-medium">{csvData.rows.length.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Timestamp Column</p>
                    <p className="font-medium font-mono text-sm">{timestampColumn}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Value Column</p>
                    <p className="font-medium font-mono text-sm">{valueColumn}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Additional Columns</p>
                    <p className="font-medium text-sm">{additionalColumns.length} columns</p>
                  </div>
                </div>

                {additionalColumns.length > 0 && (
                  <div className="border-t pt-4">
                    <p className="text-sm text-muted-foreground mb-2">Additional Fields:</p>
                    <div className="flex flex-wrap gap-1">
                      {additionalColumns.map((col, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {col}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t pt-4">
                  <p className="text-sm text-muted-foreground mb-2">Sample Data Preview:</p>
                  <div className="space-y-2">
                    {csvData.preview.slice(0, 3).map((row, idx) => {
                      const timestampIdx = csvData.headers.indexOf(timestampColumn);
                      const valueIdx = csvData.headers.indexOf(valueColumn);
                      return (
                        <div key={idx} className="flex items-center gap-4 p-2 rounded bg-muted/50 text-sm">
                          <span className="text-muted-foreground">Row {idx + 1}:</span>
                          <span className="font-mono">{row[timestampIdx]}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-bold">{row[valueIdx]} kWh</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("map")}>
                Back
              </Button>
              <Button onClick={handleImport} disabled={isUploading}>
                {isUploading ? "Importing..." : `Import ${csvData.rows.length} Readings`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
