import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CalendarIcon, Download, Eye, FileDown } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Papa from "papaparse";

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
  const [columnOperations, setColumnOperations] = useState<Map<string, string>>(new Map());
  const [columnFactors, setColumnFactors] = useState<Map<string, string>>(new Map());
  const [recalculatedTotal, setRecalculatedTotal] = useState<number | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const handleRecalculateTotals = () => {
    if (!previewData || selectedColumns.size === 0) {
      toast.error("Please select columns to calculate");
      return;
    }

    setIsRecalculating(true);

    try {
      let newTotal = 0;
      
      Array.from(selectedColumns).forEach((column) => {
        const operation = columnOperations.get(column) || "sum";
        const factorStr = columnFactors.get(column) || "1";
        let factor = 1;
        
        try {
          factor = Function('"use strict"; return (' + factorStr + ')')();
          if (isNaN(factor) || !isFinite(factor)) {
            factor = 1;
          }
        } catch (e) {
          console.warn(`Invalid factor for ${column}: ${factorStr}, using 1`);
          factor = 1;
        }
        
        // Only sum columns with "sum" operation
        if (operation === "sum") {
          const total = Number(previewData.columnTotals[column] || 0);
          const adjustedTotal = total * factor;
          newTotal += adjustedTotal;
        }
      });

      setRecalculatedTotal(newTotal);
      toast.success("Total consumption recalculated");
    } catch (error) {
      console.error("Recalculation error:", error);
      toast.error("Failed to recalculate totals");
    } finally {
      setIsRecalculating(false);
    }
  };

  // Helper to combine date and time as UTC (no timezone conversion)
  const getFullDateTime = (date: Date, time: string): Date => {
    const [hours, minutes] = time.split(':').map(Number);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    // Create UTC date directly to avoid timezone shifts
    return new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));
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

      // Fetch column mapping from CSV file
      const { data: csvFile, error: csvError } = await supabase
        .from("meter_csv_files")
        .select("column_mapping")
        .eq("meter_id", bulkMeter.id)
        .not("column_mapping", "is", null)
        .order("parsed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (csvError) {
        console.error("Error fetching column mapping:", csvError);
      }

      const columnMapping = csvFile?.column_mapping as any;

      // Combine date and time for precise filtering
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // Fetch ALL readings using pagination (Supabase has 1000-row server limit)
      let allReadings: any[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error: readingsError } = await supabase
          .from("meter_readings")
          .select("*")
          .eq("meter_id", bulkMeter.id)
          .gte("reading_timestamp", fullDateTimeFrom.toISOString())
          .lte("reading_timestamp", fullDateTimeTo.toISOString())
          .order("reading_timestamp", { ascending: true })
          .range(from, from + pageSize - 1);

        if (readingsError) {
          toast.error(`Failed to fetch readings: ${readingsError.message}`);
          setIsLoadingPreview(false);
          return;
        }

        if (pageData && pageData.length > 0) {
          allReadings = [...allReadings, ...pageData];
          from += pageSize;
          hasMore = pageData.length === pageSize; // Continue if we got a full page
        } else {
          hasMore = false;
        }
      }

      const readings = allReadings;

      if (!readings || readings.length === 0) {
        toast.error("No readings found in selected date range");
        setIsLoadingPreview(false);
        return;
      }

      // Debug: Log actual number of readings fetched
      console.log(`Preview: Fetched ${readings.length} readings for bulk meter ${bulkMeter.meter_number}`);

      // Extract available columns from column_mapping configuration
      const availableColumns = new Set<string>();
      if (columnMapping && columnMapping.renamedHeaders) {
        // Use the renamed headers from the parsing configuration
        Object.values(columnMapping.renamedHeaders).forEach((headerName: any) => {
          if (headerName && typeof headerName === 'string') {
            availableColumns.add(headerName);
          }
        });
      } else if (readings.length > 0) {
        // Fallback: extract from first reading's metadata if no column mapping
        const metadata = readings[0].metadata as any;
        if (metadata && metadata.imported_fields) {
          Object.keys(metadata.imported_fields).forEach(key => {
            availableColumns.add(key);
          });
        }
      }

      // Debug logging
      console.log('Column Mapping:', columnMapping);
      console.log('Available Columns:', Array.from(availableColumns));
      console.log('Sample Reading Metadata:', readings[0]?.metadata);

      // Auto-select all columns initially
      setSelectedColumns(new Set(availableColumns));

      // Calculate totals and store raw values for operations
      const totalKwh = readings.reduce((sum, r) => sum + Number(r.kwh_value || 0), 0);
      const columnTotals: Record<string, number> = {};
      const columnValues: Record<string, number[]> = {};
      
      readings.forEach(reading => {
        const metadata = reading.metadata as any;
        const importedFields = metadata?.imported_fields || {};
        Object.entries(importedFields).forEach(([key, value]) => {
          const numValue = Number(value);
          if (!isNaN(numValue) && value !== null && value !== '') {
            // Store for sum operation
            columnTotals[key] = (columnTotals[key] || 0) + numValue;
            // Store raw values for other operations
            if (!columnValues[key]) {
              columnValues[key] = [];
            }
            columnValues[key].push(numValue);
          }
        });
      });

      setPreviewData({
        meterNumber: bulkMeter.meter_number,
        totalReadings: readings.length,
        firstReading: readings[0],
        lastReading: readings[readings.length - 1],
        sampleReadings: readings.slice(0, 5),
        availableColumns: Array.from(availableColumns),
        totalKwh,
        columnTotals,
        columnValues
      });

      toast.success("Preview loaded successfully");
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
          // Get ALL readings using pagination (Supabase has 1000-row server limit)
          let allReadings: any[] = [];
          let from = 0;
          const pageSize = 1000;
          let hasMore = true;

          while (hasMore) {
            const { data: pageData, error: readingsError } = await supabase
              .from("meter_readings")
              .select("kwh_value, reading_timestamp, metadata")
              .eq("meter_id", meter.id)
              .gte("reading_timestamp", fullDateTimeFrom.toISOString())
              .lte("reading_timestamp", fullDateTimeTo.toISOString())
              .order("reading_timestamp", { ascending: true })
              .range(from, from + pageSize - 1);

            if (readingsError) {
              console.error(`Error fetching readings for meter ${meter.meter_number}:`, readingsError);
              break;
            }

            if (pageData && pageData.length > 0) {
              allReadings = [...allReadings, ...pageData];
              from += pageSize;
              hasMore = pageData.length === pageSize;
            } else {
              hasMore = false;
            }
          }

          const readings = allReadings;

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
            console.log(`Reconciliation: Meter ${meter.meter_number} (${meter.meter_type}):`, {
              originalReadings: readings?.length || 0,
              uniqueReadings: uniqueReadings.length,
              duplicatesRemoved: (readings?.length || 0) - uniqueReadings.length,
              totalKwh: totalKwh.toFixed(2),
              columnTotals,
              columnMaxValues,
              firstTimestamp: uniqueReadings[0].reading_timestamp,
              lastTimestamp: uniqueReadings[uniqueReadings.length - 1].reading_timestamp
            });
            
            // Alert if we hit the query limit
            if (readings && readings.length >= 100000) {
              console.warn(`WARNING: Meter ${meter.meter_number} may have more than 100k readings - increase limit!`);
            }
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

  const downloadMeterCSV = async (meter: any) => {
    try {
      if (!dateFrom || !dateTo) {
        toast.error("Date range not available");
        return;
      }

      toast.loading(`Fetching readings for ${meter.meter_number}...`);

      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // Fetch ALL readings for this meter using pagination
      let allReadings: any[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error } = await supabase
          .from("meter_readings")
          .select("reading_timestamp, kwh_value, kva_value, metadata")
          .eq("meter_id", meter.id)
          .gte("reading_timestamp", fullDateTimeFrom.toISOString())
          .lte("reading_timestamp", fullDateTimeTo.toISOString())
          .order("reading_timestamp", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) {
          toast.dismiss();
          toast.error(`Failed to fetch readings: ${error.message}`);
          return;
        }

        if (pageData && pageData.length > 0) {
          allReadings = [...allReadings, ...pageData];
          from += pageSize;
          hasMore = pageData.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      if (allReadings.length === 0) {
        toast.dismiss();
        toast.error("No readings found for this meter");
        return;
      }

      // Transform readings to CSV format
      const csvData = allReadings.map(reading => {
        const row: any = {
          timestamp: format(new Date(reading.reading_timestamp), "yyyy-MM-dd HH:mm:ss"),
          kwh: reading.kwh_value,
        };

        if (reading.kva_value) {
          row.kva = reading.kva_value;
        }

        // Add metadata fields if available
        if (reading.metadata && (reading.metadata as any).imported_fields) {
          const importedFields = (reading.metadata as any).imported_fields;
          Object.entries(importedFields).forEach(([key, value]) => {
            row[key] = value;
          });
        }

        return row;
      });

      // Generate CSV
      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${meter.meter_number}_${format(dateFrom, "yyyy-MM-dd")}_to_${format(dateTo, "yyyy-MM-dd")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.dismiss();
      toast.success(`Downloaded ${allReadings.length} readings for ${meter.meter_number}`);
    } catch (error) {
      console.error("CSV download error:", error);
      toast.dismiss();
      toast.error("Failed to download CSV");
    }
  };

  const downloadAllMetersCSV = async () => {
    if (!reconciliationData) return;

    const allMeters = [
      ...reconciliationData.councilBulk,
      ...reconciliationData.checkMeters,
      ...reconciliationData.solarMeters,
      ...reconciliationData.distribution,
    ];

    for (const meter of allMeters) {
      await downloadMeterCSV(meter);
      // Small delay between downloads to avoid overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 500));
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
                  <div>
                    <Calendar 
                      mode="single" 
                      selected={dateFrom} 
                      onSelect={setDateFrom}
                      className={cn("p-3 pointer-events-auto")}
                      disabled={false}
                      fromYear={2000}
                      toYear={2050}
                      captionLayout="dropdown-buttons"
                    />
                    <div className="px-3 pb-3">
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
                  <div>
                    <Calendar 
                      mode="single" 
                      selected={dateTo} 
                      onSelect={setDateTo}
                      className={cn("p-3 pointer-events-auto")}
                      disabled={false}
                      fromYear={2000}
                      toYear={2050}
                      captionLayout="dropdown-buttons"
                    />
                    <div className="px-3 pb-3">
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
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="p-3 rounded-lg bg-muted/50 space-y-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">From Date & Time</div>
                      <div className="text-sm font-mono">
                        {dateFrom ? format(dateFrom, "yyyy-MM-dd") : '-'} {timeFrom}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">First Actual Reading Found</div>
                      <div className="text-sm font-mono">
                        {previewData.firstReading.reading_timestamp.split('T')[0]} {previewData.firstReading.reading_timestamp.split('T')[1]?.substring(0, 8) || '00:00:00'}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="p-3 rounded-lg bg-muted/50 space-y-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">To Date & Time</div>
                      <div className="text-sm font-mono">
                        {dateTo ? format(dateTo, "yyyy-MM-dd") : '-'} {timeTo}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Last Actual Reading Found</div>
                      <div className="text-sm font-mono">
                        {previewData.lastReading.reading_timestamp.split('T')[0]} {previewData.lastReading.reading_timestamp.split('T')[1]?.substring(0, 8) || '00:00:00'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Available Columns - Select to Include in Calculations</Label>
              <div className="space-y-1">
                {previewData.availableColumns.map((column: string) => (
                  <div key={column} className="flex items-center gap-2 p-2 rounded border hover:bg-muted/50">
                    <Checkbox
                      id={`column-${column}`}
                      checked={selectedColumns.has(column)}
                      onCheckedChange={(checked) => {
                        const newSelected = new Set(selectedColumns);
                        if (checked) {
                          newSelected.add(column);
                          if (!columnOperations.has(column)) {
                            const newOps = new Map(columnOperations);
                            newOps.set(column, "sum");
                            setColumnOperations(newOps);
                          }
                          if (!columnFactors.has(column)) {
                            const newFactors = new Map(columnFactors);
                            newFactors.set(column, "1");
                            setColumnFactors(newFactors);
                          }
                        } else {
                          newSelected.delete(column);
                        }
                        setSelectedColumns(newSelected);
                      }}
                    />
                    <Label
                      htmlFor={`column-${column}`}
                      className="text-xs cursor-pointer flex-1"
                    >
                      {column}
                    </Label>
                    {selectedColumns.has(column) && (
                      <>
                        <Select
                          value={columnOperations.get(column) || "sum"}
                          onValueChange={(value) => {
                            const newOps = new Map(columnOperations);
                            newOps.set(column, value);
                            setColumnOperations(newOps);
                          }}
                        >
                          <SelectTrigger className="w-24 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sum">Sum</SelectItem>
                            <SelectItem value="max">Max</SelectItem>
                            <SelectItem value="min">Min</SelectItem>
                            <SelectItem value="count">Count</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          type="text"
                          placeholder="Factor"
                          value={columnFactors.get(column) || 1}
                          onChange={(e) => {
                            const newFactors = new Map(columnFactors);
                            newFactors.set(column, e.target.value || "1");
                            setColumnFactors(newFactors);
                          }}
                          className="w-20 h-7 text-xs"
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="text-xs text-muted-foreground">
                  {selectedColumns.size} of {previewData.availableColumns.length} columns selected
                </div>
                <Button 
                  onClick={handleRecalculateTotals} 
                  disabled={isRecalculating || selectedColumns.size === 0}
                  variant="outline"
                  size="sm"
                >
                  {isRecalculating ? "Calculating..." : "Recalculate Total"}
                </Button>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
              <Label className="text-sm font-semibold mb-3 block">Total Consumption in Selected Period</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    {recalculatedTotal !== null ? "Recalculated Total" : "Total kWh"}
                  </div>
                  <div className="text-2xl font-bold">
                    {recalculatedTotal !== null ? recalculatedTotal.toFixed(2) : previewData.totalKwh.toFixed(2)}
                  </div>
                </div>
                {Array.from(selectedColumns).map((column) => {
                  const operation = columnOperations.get(column) || "sum";
                  const factorStr = columnFactors.get(column) || "1";
                  let factor = 1;
                  
                  try {
                    factor = Function('"use strict"; return (' + factorStr + ')')();
                    if (isNaN(factor) || !isFinite(factor)) {
                      factor = 1;
                    }
                  } catch (e) {
                    factor = 1;
                  }
                  
                  // Calculate the correct total based on operation
                  let total = 0;
                  const values = previewData.columnValues?.[column] || [];
                  
                  if (operation === "sum") {
                    total = previewData.columnTotals[column] || 0;
                  } else if (operation === "max") {
                    total = values.length > 0 ? Math.max(...values) : 0;
                  } else if (operation === "min") {
                    total = values.length > 0 ? Math.min(...values) : 0;
                  } else if (operation === "count") {
                    total = values.length;
                  }
                  
                  const adjustedTotal = total * factor;
                  
                  return (
                    <div key={column} className="space-y-1">
                      <div className="text-xs text-muted-foreground">
                        {column} {factorStr !== "1" && `(×${factorStr})`}
                      </div>
                      <div className="text-lg font-semibold">{adjustedTotal.toFixed(2)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold">Sample Data (First 5 Readings)</Label>
              <div className="border rounded-lg overflow-auto max-h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
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
                          {Array.from(selectedColumns).map(col => {
                            let value = '-';
                            
                            // Map special columns to their dedicated fields
                            if (col === 'Time') {
                              // Time is stored in reading_timestamp
                              value = reading.reading_timestamp?.split('T')[0] + ' ' + 
                                      (reading.reading_timestamp?.split('T')[1]?.substring(0, 8) || '00:00:00');
                            } else if (col === 'P1 (kWh)') {
                              // P1 (kWh) is the kwh_value column
                              value = reading.kwh_value?.toString() || '-';
                            } else if (col === 'Q1 (kvarh)') {
                              // Q1 (kvarh) is the kva_value column (kvaColumn: "2" maps to Q1)
                              value = reading.kva_value?.toString() || '-';
                            } else {
                              // All other columns come from imported_fields
                              value = importedFields[col]?.toString() || '-';
                            }
                            
                            return (
                              <TableCell key={col} className="font-mono text-xs">
                                {value}
                              </TableCell>
                            );
                          })}
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
              <Button variant="outline" className="gap-2" onClick={downloadAllMetersCSV}>
                <Download className="w-4 h-4" />
                Download All Meters
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
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{meter.totalKwh.toFixed(2)} kWh</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => downloadMeterCSV(meter)}
                                  className="h-7 w-7 p-0"
                                  title={`Download ${meter.readingsCount} readings`}
                                >
                                  <FileDown className="h-4 w-4" />
                                </Button>
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
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-green-700">{meter.totalKwh.toFixed(2)} kWh</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => downloadMeterCSV(meter)}
                                  className="h-7 w-7 p-0"
                                  title={`Download ${meter.readingsCount} readings`}
                                >
                                  <FileDown className="h-4 w-4" />
                                </Button>
                              </div>
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
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-blue-700">{meter.totalKwh.toFixed(2)} kWh</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => downloadMeterCSV(meter)}
                                  className="h-7 w-7 p-0"
                                  title={`Download ${meter.readingsCount} readings`}
                                >
                                  <FileDown className="h-4 w-4" />
                                </Button>
                              </div>
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
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{meter.totalKwh.toFixed(2)} kWh</span>
                                  <span className="text-xs text-muted-foreground bg-background px-2 py-1 rounded border border-border">
                                    {percentage.toFixed(1)}%
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => downloadMeterCSV(meter)}
                                    className="h-7 w-7 p-0"
                                    title={`Download ${meter.readingsCount} readings`}
                                  >
                                    <FileDown className="h-4 w-4" />
                                  </Button>
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
    </div>
  );
}
