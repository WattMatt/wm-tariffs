import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { CalendarIcon, Download, Eye } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ReconciliationTabProps {
  siteId: string;
}

export default function ReconciliationTab({ siteId }: ReconciliationTabProps) {
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [timeFrom, setTimeFrom] = useState<string>("00:00");
  const [timeTo, setTimeTo] = useState<string>("23:59");
  const [reconciliationData, setReconciliationData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Helper to combine date and time
  const getFullDateTime = (date: Date, time: string): Date => {
    const [hours, minutes] = time.split(':').map(Number);
    const combined = new Date(date);
    combined.setHours(hours, minutes, 0, 0);
    return combined;
  };

  const handlePreview = async () => {
    if (!dateFrom || !dateTo) {
      toast.error("Please select a date range");
      return;
    }

    setIsLoadingPreview(true);

    try {
      // Fetch bulk check meter
      const { data: bulkMeters, error: metersError } = await supabase
        .from("meters")
        .select("id, meter_number, meter_type")
        .eq("site_id", siteId)
        .eq("meter_type", "council_bulk");

      if (metersError || !bulkMeters || bulkMeters.length === 0) {
        toast.error("No bulk check meter found for this site");
        setIsLoadingPreview(false);
        return;
      }

      const bulkMeter = bulkMeters[0];

      // Fetch parsed CSV file for this meter
      const { data: csvFiles, error: csvError } = await supabase
        .from("meter_csv_files")
        .select("parsed_file_path, file_name")
        .eq("meter_id", bulkMeter.id)
        .not("parsed_file_path", "is", null)
        .order("parsed_at", { ascending: false })
        .limit(1);

      if (csvError || !csvFiles || csvFiles.length === 0) {
        toast.error("No parsed CSV file found for bulk check meter. Please parse the data first.");
        setIsLoadingPreview(false);
        return;
      }

      // Download parsed CSV file
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("meter-csvs")
        .download(csvFiles[0].parsed_file_path);

      if (downloadError || !fileData) {
        toast.error("Failed to download parsed CSV file");
        setIsLoadingPreview(false);
        return;
      }

      // Parse CSV content
      const text = await fileData.text();
      const lines = text.split('\n').filter(line => line.trim());
      if (lines.length === 0) {
        toast.error("Parsed CSV file is empty");
        setIsLoadingPreview(false);
        return;
      }

      // Parse CSV headers
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      
      // Parse CSV rows
      const readings: any[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        
        // Handle CSV escaping
        for (let j = 0; j < line.length; j++) {
          const char = line[j];
          if (char === '"') {
            if (inQuotes && line[j + 1] === '"') {
              current += '"';
              j++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());
        
        // Create reading object
        const reading: any = {};
        headers.forEach((header, idx) => {
          let value = values[idx] || '';
          if (header === 'metadata' && value && value !== '{}') {
            try {
              reading[header] = JSON.parse(value);
            } catch {
              reading[header] = {};
            }
          } else {
            reading[header] = value;
          }
        });
        
        readings.push(reading);
      }

      // Combine date and time for precise filtering
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // Filter readings by date range
      const filteredReadings = readings.filter(reading => {
        const timestamp = new Date(reading.reading_timestamp);
        return timestamp >= fullDateTimeFrom && timestamp <= fullDateTimeTo;
      });

      if (filteredReadings.length === 0) {
        toast.error("No readings found in selected date range");
        setIsLoadingPreview(false);
        return;
      }

      // Extract available columns from metadata
      const availableColumns = new Set<string>();
      filteredReadings.forEach(reading => {
        const metadata = reading.metadata || {};
        Object.keys(metadata).forEach(key => {
          if (!key.toLowerCase().includes('time') && !key.toLowerCase().includes('date')) {
            availableColumns.add(key);
          }
        });
      });

      // Auto-select all columns initially
      setSelectedColumns(new Set(availableColumns));

      // Calculate totals
      const totalKwh = filteredReadings.reduce((sum, r) => sum + Number(r.kwh_value || 0), 0);
      const columnTotals: Record<string, number> = {};
      
      filteredReadings.forEach(reading => {
        const metadata = reading.metadata || {};
        Object.entries(metadata).forEach(([key, value]) => {
          if (!key.toLowerCase().includes('time') && !key.toLowerCase().includes('date')) {
            const numValue = Number(value);
            if (!isNaN(numValue) && value !== null && value !== '') {
              columnTotals[key] = (columnTotals[key] || 0) + numValue;
            }
          }
        });
      });

      setPreviewData({
        meterNumber: bulkMeter.meter_number,
        totalReadings: filteredReadings.length,
        firstReading: filteredReadings[0],
        lastReading: filteredReadings[filteredReadings.length - 1],
        sampleReadings: filteredReadings.slice(0, 5),
        availableColumns: Array.from(availableColumns),
        totalKwh,
        columnTotals
      });

      toast.success("Preview loaded successfully from parsed CSV");
    } catch (error) {
      console.error("Preview error:", error);
      toast.error("Failed to load preview");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleReconcile = async () => {
    if (!dateFrom || !dateTo) {
      toast.error("Please select a date range");
      return;
    }

    if (!previewData) {
      toast.error("Please preview data first");
      return;
    }

    if (selectedColumns.size === 0) {
      toast.error("Please select at least one column to calculate");
      return;
    }

    setIsLoading(true);

    try {
      // Fetch all meters for the site
      const { data: meters, error: metersError } = await supabase
        .from("meters")
        .select("id, meter_number, meter_type")
        .eq("site_id", siteId);

      if (metersError) {
        console.error("Error fetching meters:", metersError);
        throw new Error("Failed to fetch meters");
      }

      if (!meters || meters.length === 0) {
        toast.error("No meters found for this site");
        setIsLoading(false);
        return;
      }

      // Combine date and time for precise filtering
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // Fetch readings for each meter within date range (deduplicated by timestamp)
      const meterData = await Promise.all(
        meters.map(async (meter) => {
          // Get all readings with metadata
          const { data: readings, error: readingsError } = await supabase
            .from("meter_readings")
            .select("kwh_value, reading_timestamp, metadata")
            .eq("meter_id", meter.id)
            .gte("reading_timestamp", fullDateTimeFrom.toISOString())
            .lte("reading_timestamp", fullDateTimeTo.toISOString())
            .order("reading_timestamp", { ascending: true });

          if (readingsError) {
            console.error(`Error fetching readings for meter ${meter.meter_number}:`, readingsError);
          }

          // Deduplicate by timestamp (take first occurrence of each unique timestamp)
          const uniqueReadings = readings ? 
            Array.from(
              new Map(
                readings.map(r => [r.reading_timestamp, r])
              ).values()
            ) : [];

          // Sum all interval readings (each represents consumption for that period)
          let totalKwh = 0;
          const columnTotals: Record<string, number> = {};
          const columnMaxValues: Record<string, number> = {};
          
          if (uniqueReadings.length > 0) {
            // Sum all interval consumption values
            totalKwh = uniqueReadings.reduce((sum, r) => sum + Number(r.kwh_value), 0);
            
            // Sum all numeric columns from metadata, track max for kVA
            uniqueReadings.forEach(reading => {
              const importedFields = (reading.metadata as any)?.imported_fields || {};
              Object.entries(importedFields).forEach(([key, value]) => {
                // Skip timestamp columns
                if (key.toLowerCase().includes('time') || key.toLowerCase().includes('date')) return;
                
                // Only process selected columns for council_bulk meters
                if (meter.meter_type === 'council_bulk' && !selectedColumns.has(key)) return;
                
                const numValue = Number(value);
                if (!isNaN(numValue) && value !== null && value !== '') {
                  // For kVA columns, track maximum value
                  if (key.toLowerCase().includes('kva') || key.toLowerCase().includes('s (kva)')) {
                    columnMaxValues[key] = Math.max(columnMaxValues[key] || 0, numValue);
                  } else {
                    // Sum all other columns (interval consumption)
                    columnTotals[key] = (columnTotals[key] || 0) + numValue;
                  }
                }
              });
            });
            
            // Debug logging
            console.log(`Meter ${meter.meter_number} (${meter.meter_type}):`, {
              originalReadings: readings?.length || 0,
              uniqueReadings: uniqueReadings.length,
              duplicatesRemoved: (readings?.length || 0) - uniqueReadings.length,
              totalKwh: totalKwh.toFixed(2),
              columnTotals,
              columnMaxValues,
              firstTimestamp: uniqueReadings[0].reading_timestamp,
              lastTimestamp: uniqueReadings[uniqueReadings.length - 1].reading_timestamp
            });
          } else {
            console.log(`Meter ${meter.meter_number}: No readings in date range`);
          }

          return {
            ...meter,
            totalKwh,
            columnTotals,
            columnMaxValues,
            readingsCount: uniqueReadings.length,
          };
        })
      );

      const councilBulk = meterData.filter((m) => m.meter_type === "council_bulk");
      const checkMeters = meterData.filter((m) => m.meter_type === "check_meter");
      const solarMeters = meterData.filter((m) => m.meter_type === "solar");
      const distribution = meterData.filter((m) => m.meter_type === "distribution");

      const councilTotal = councilBulk.reduce((sum, m) => sum + m.totalKwh, 0);
      const solarTotal = solarMeters.reduce((sum, m) => sum + m.totalKwh, 0);
      const distributionTotal = distribution.reduce((sum, m) => sum + m.totalKwh, 0);
      
      // Total supply = Council (from grid) + Solar (on-site generation)
      const totalSupply = councilTotal + solarTotal;
      const recoveryRate = totalSupply > 0 ? (distributionTotal / totalSupply) * 100 : 0;
      const discrepancy = totalSupply - distributionTotal;

      setReconciliationData({
        councilBulk,
        checkMeters,
        solarMeters,
        distribution,
        councilTotal,
        solarTotal,
        totalSupply,
        distributionTotal,
        recoveryRate,
        discrepancy,
      });

      toast.success("Reconciliation complete");
    } catch (error) {
      console.error("Reconciliation error:", error);
      toast.error("Failed to complete reconciliation. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Energy Reconciliation</h2>
        <p className="text-muted-foreground">
          Balance total supply (grid + solar) against downstream distribution
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Bulk Check Meter + Solar Generation = Total Supply ≈ Sum of all Distribution Meters
        </p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>Analysis Parameters</CardTitle>
          <CardDescription>Select date range for reconciliation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Date & Time</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateFrom && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? `${format(dateFrom, "PP")} at ${timeFrom}` : "Pick date & time"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
                  <div className="space-y-3">
                    <Calendar 
                      mode="single" 
                      selected={dateFrom} 
                      onSelect={setDateFrom}
                      className={cn("p-3 pointer-events-auto")}
                    />
                    <div className="px-3 pb-3 border-t pt-3">
                      <Label className="text-xs mb-2 block">Time</Label>
                      <Input
                        type="time"
                        value={timeFrom}
                        onChange={(e) => setTimeFrom(e.target.value)}
                        className="w-full"
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>To Date & Time</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateTo && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? `${format(dateTo, "PP")} at ${timeTo}` : "Pick date & time"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
                  <div className="space-y-3">
                    <Calendar 
                      mode="single" 
                      selected={dateTo} 
                      onSelect={setDateTo}
                      className={cn("p-3 pointer-events-auto")}
                    />
                    <div className="px-3 pb-3 border-t pt-3">
                      <Label className="text-xs mb-2 block">Time</Label>
                      <Input
                        type="time"
                        value={timeTo}
                        onChange={(e) => setTimeTo(e.target.value)}
                        className="w-full"
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <Button onClick={handlePreview} disabled={isLoadingPreview || !dateFrom || !dateTo} className="w-full">
            <Eye className="mr-2 h-4 w-4" />
            {isLoadingPreview ? "Loading Preview..." : "Preview Bulk Meter Data"}
          </Button>
        </CardContent>
      </Card>

      {previewData && (
        <Card className="border-border/50 bg-accent/5">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Bulk Check Meter Preview - {previewData.meterNumber}</span>
              <Badge variant="outline">{previewData.totalReadings} readings</Badge>
            </CardTitle>
            <CardDescription>
              Select columns to include in reconciliation calculations. Range: {dateFrom && format(getFullDateTime(dateFrom, timeFrom), "PPpp")} to {dateTo && format(getFullDateTime(dateTo, timeTo), "PPpp")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
              <Label className="text-sm font-semibold mb-3 block">Total Consumption in Selected Period</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Total kWh</div>
                  <div className="text-2xl font-bold">{previewData.totalKwh.toFixed(2)}</div>
                </div>
                {Object.entries(previewData.columnTotals).map(([column, total]: [string, any]) => (
                  <div key={column} className="space-y-1">
                    <div className="text-xs text-muted-foreground">{column}</div>
                    <div className="text-lg font-semibold">{Number(total).toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">First Actual Reading Found</Label>
                  <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                    <div className="text-sm font-mono">
                      {format(new Date(previewData.firstReading.reading_timestamp), "PPpp")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      kWh: {previewData.firstReading.kwh_value}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Last Actual Reading Found</Label>
                  <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                    <div className="text-sm font-mono">
                      {format(new Date(previewData.lastReading.reading_timestamp), "PPpp")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      kWh: {previewData.lastReading.kwh_value}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground italic">
                    Note: This shows the last data point found in your database within the selected range. If it doesn't match your end date, there's no data beyond this point.
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold">Available Columns - Select to Include in Calculations</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {previewData.availableColumns.map((column: string) => (
                  <div key={column} className="flex items-center space-x-2 p-2 rounded-lg hover:bg-muted/50">
                    <Checkbox
                      id={`column-${column}`}
                      checked={selectedColumns.has(column)}
                      onCheckedChange={(checked) => {
                        const newSelected = new Set(selectedColumns);
                        if (checked) {
                          newSelected.add(column);
                        } else {
                          newSelected.delete(column);
                        }
                        setSelectedColumns(newSelected);
                      }}
                    />
                    <Label
                      htmlFor={`column-${column}`}
                      className="text-sm cursor-pointer flex-1"
                    >
                      {column}
                    </Label>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedColumns.size} of {previewData.availableColumns.length} columns selected
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold">Sample Data (First 5 Readings)</Label>
              <div className="border rounded-lg overflow-auto max-h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky top-0 bg-background">Timestamp</TableHead>
                      <TableHead className="sticky top-0 bg-background">kWh</TableHead>
                      {Array.from(selectedColumns).map(col => (
                        <TableHead key={col} className="sticky top-0 bg-background">{col}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.sampleReadings.map((reading: any, idx: number) => {
                      const importedFields = reading.metadata?.imported_fields || {};
                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs">
                            {format(new Date(reading.reading_timestamp), "MMM dd, HH:mm")}
                          </TableCell>
                          <TableCell className="font-mono">{reading.kwh_value}</TableCell>
                          {Array.from(selectedColumns).map(col => (
                            <TableCell key={col} className="font-mono text-xs">
                              {importedFields[col] || '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="text-xs text-muted-foreground italic">
                Verify these values match your CSV file before proceeding with reconciliation
              </div>
            </div>

            <Button onClick={handleReconcile} disabled={isLoading || selectedColumns.size === 0} className="w-full">
              {isLoading ? "Analyzing..." : "Run Reconciliation with Selected Columns"}
            </Button>
          </CardContent>
        </Card>
      )}

      {reconciliationData && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Council (Grid)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {reconciliationData.councilTotal.toFixed(2)} kWh
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Solar (Generated)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {reconciliationData.solarTotal.toFixed(2)} kWh
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Supply
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {reconciliationData.totalSupply.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Grid + Solar
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {reconciliationData.distributionTotal.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Recovery: {reconciliationData.recoveryRate.toFixed(1)}%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Discrepancy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "text-2xl font-bold",
                    reconciliationData.discrepancy > 0 ? "text-warning" : "text-accent"
                  )}
                >
                  {reconciliationData.discrepancy.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {reconciliationData.discrepancy > 0 ? "Unaccounted" : "Over-recovered"}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Detailed Breakdown</CardTitle>
                <CardDescription>Meter-by-meter consumption analysis</CardDescription>
              </div>
              <Button variant="outline" className="gap-2">
                <Download className="w-4 h-4" />
                Export Report
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Supply Sources */}
                <div className="space-y-6">
                  <h3 className="font-semibold text-lg border-b pb-2">Supply Sources</h3>
                  
                  {reconciliationData.councilBulk.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">Council Bulk (Grid)</h4>
                      <div className="space-y-2">
                        {reconciliationData.councilBulk.map((meter: any) => (
                          <div
                            key={meter.id}
                            className="space-y-2 p-3 rounded-lg bg-muted/50"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-sm font-semibold">{meter.meter_number}</span>
                              <span className="font-semibold">{meter.totalKwh.toFixed(2)} kWh</span>
                            </div>
                            {((meter.columnTotals && Object.keys(meter.columnTotals).length > 0) || 
                              (meter.columnMaxValues && Object.keys(meter.columnMaxValues).length > 0)) && (
                              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                                {Object.entries(meter.columnTotals || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">{col}:</span>
                                    <span className="font-mono">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                                {Object.entries(meter.columnMaxValues || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">{col} (Max):</span>
                                    <span className="font-mono font-semibold">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reconciliationData.solarMeters?.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">Solar Generation</h4>
                      <div className="space-y-2">
                        {reconciliationData.solarMeters.map((meter: any) => (
                          <div
                            key={meter.id}
                            className="space-y-2 p-3 rounded-lg bg-green-50 border border-green-200"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-sm font-semibold">{meter.meter_number}</span>
                              <span className="font-semibold text-green-700">{meter.totalKwh.toFixed(2)} kWh</span>
                            </div>
                            {((meter.columnTotals && Object.keys(meter.columnTotals).length > 0) || 
                              (meter.columnMaxValues && Object.keys(meter.columnMaxValues).length > 0)) && (
                              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-green-300">
                                {Object.entries(meter.columnTotals || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-green-600">{col}:</span>
                                    <span className="font-mono text-green-700">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                                {Object.entries(meter.columnMaxValues || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-green-600">{col} (Max):</span>
                                    <span className="font-mono font-semibold text-green-700">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reconciliationData.checkMeters?.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">Check Meters</h4>
                      <div className="space-y-2">
                        {reconciliationData.checkMeters.map((meter: any) => (
                          <div
                            key={meter.id}
                            className="space-y-2 p-3 rounded-lg bg-blue-50 border border-blue-200"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-sm font-semibold">{meter.meter_number}</span>
                              <span className="font-semibold text-blue-700">{meter.totalKwh.toFixed(2)} kWh</span>
                            </div>
                            {((meter.columnTotals && Object.keys(meter.columnTotals).length > 0) || 
                              (meter.columnMaxValues && Object.keys(meter.columnMaxValues).length > 0)) && (
                              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-blue-300">
                                {Object.entries(meter.columnTotals || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-blue-600">{col}:</span>
                                    <span className="font-mono text-blue-700">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                                {Object.entries(meter.columnMaxValues || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-blue-600">{col} (Max):</span>
                                    <span className="font-mono font-semibold text-blue-700">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Distribution / Consumption */}
                <div className="space-y-6">
                  <h3 className="font-semibold text-lg border-b pb-2">Distribution / Consumption</h3>
                  
              {reconciliationData.distribution.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">
                        Downstream Meters
                        <span className="ml-2 text-xs font-normal">
                          (Total: {reconciliationData.distributionTotal.toFixed(2)} kWh)
                        </span>
                      </h4>
                      <div className="space-y-2">
                        {reconciliationData.distribution.map((meter: any) => {
                          const percentage = reconciliationData.distributionTotal > 0 
                            ? (meter.totalKwh / reconciliationData.distributionTotal) * 100 
                            : 0;
                          
                          return (
                            <div
                              key={meter.id}
                              className="space-y-2 p-3 rounded-lg bg-muted/50"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-sm font-semibold">{meter.meter_number}</span>
                                <div className="flex items-center gap-3">
                                  <span className="font-semibold">{meter.totalKwh.toFixed(2)} kWh</span>
                                  <span className="text-xs text-muted-foreground bg-background px-2 py-1 rounded border border-border">
                                    {percentage.toFixed(1)}%
                                  </span>
                                </div>
                              </div>
                              {((meter.columnTotals && Object.keys(meter.columnTotals).length > 0) || 
                                (meter.columnMaxValues && Object.keys(meter.columnMaxValues).length > 0)) && (
                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                                  {Object.entries(meter.columnTotals || {}).map(([col, val]: [string, any]) => (
                                    <div key={col} className="flex justify-between text-xs">
                                      <span className="text-muted-foreground">{col}:</span>
                                      <span className="font-mono">{Number(val).toFixed(2)}</span>
                                    </div>
                                  ))}
                                  {Object.entries(meter.columnMaxValues || {}).map(([col, val]: [string, any]) => (
                                    <div key={col} className="flex justify-between text-xs">
                                      <span className="text-muted-foreground">{col} (Max):</span>
                                      <span className="font-mono font-semibold">{Number(val).toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
              )}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!reconciliationData && (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <p className="text-muted-foreground">
              Select date range and run reconciliation to see results
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
