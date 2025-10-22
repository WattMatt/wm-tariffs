import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Brush } from "recharts";
import { format, parseISO } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, TrendingUp, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface LoadProfilesTabProps {
  siteId: string;
}

interface Meter {
  id: string;
  meter_number: string;
  name: string;
}

interface ReadingData {
  reading_timestamp: string;
  kva_value: number | null;
  kwh_value: number | null;
}

export default function LoadProfilesTab({ siteId }: LoadProfilesTabProps) {
  const [meters, setMeters] = useState<Meter[]>([]);
  const [selectedMeterId, setSelectedMeterId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [timeFrom, setTimeFrom] = useState<string>("00:00");
  const [timeTo, setTimeTo] = useState<string>("23:59");
  const [loadProfileData, setLoadProfileData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedQuantities, setSelectedQuantities] = useState<Set<string>>(new Set());
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [yAxisMin, setYAxisMin] = useState<string>("");
  const [yAxisMax, setYAxisMax] = useState<string>("");
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());
  const [useBrush, setUseBrush] = useState<boolean>(false);
  const [brushStartIndex, setBrushStartIndex] = useState<number>(0);
  const [brushEndIndex, setBrushEndIndex] = useState<number>(0);
  const [manipulationOperation, setManipulationOperation] = useState<string>("sum");
  const [manipulationPeriod, setManipulationPeriod] = useState<number>(1);
  const [manipulatedData, setManipulatedData] = useState<any[]>([]);
  const [isManipulationApplied, setIsManipulationApplied] = useState(false);
  const [showGraph, setShowGraph] = useState(false);

  useEffect(() => {
    fetchMeters();
  }, [siteId]);

  useEffect(() => {
    if (selectedMeterId && dateFrom && dateTo) {
      fetchLoadProfile();
    }
  }, [selectedMeterId, dateFrom, dateTo, timeFrom, timeTo]);

  // Helper to combine date and time (no timezone conversion - treat as naive timestamp)
  const getFullDateTime = (date: Date, time: string): Date => {
    const [hours, minutes] = time.split(':').map(Number);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    // Create date as naive timestamp
    return new Date(year, month, day, hours, minutes, 0, 0);
  };

  const fetchMeters = async () => {
    const { data, error } = await supabase
      .from("meters")
      .select("id, meter_number, name")
      .eq("site_id", siteId)
      .order("meter_number");

    if (error) {
      toast.error("Failed to load meters");
      return;
    }

    setMeters(data || []);
    if (data && data.length > 0) {
      setSelectedMeterId(data[0].id);
    }
  };

  const fetchLoadProfile = async () => {
    if (!selectedMeterId || !dateFrom || !dateTo) return;

    setIsLoading(true);
    try {
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);
      
      // Fetch column mapping to get available columns
      const { data: csvFile, error: csvError } = await supabase
        .from("meter_csv_files")
        .select("column_mapping")
        .eq("meter_id", selectedMeterId)
        .not("column_mapping", "is", null)
        .order("parsed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (csvError) {
        console.error("Error fetching column mapping:", csvError);
      }
      
      const { data, error } = await supabase
        .from("meter_readings")
        .select("reading_timestamp, metadata")
        .eq("meter_id", selectedMeterId)
        .gte("reading_timestamp", fullDateTimeFrom.toISOString())
        .lte("reading_timestamp", fullDateTimeTo.toISOString())
        .order("reading_timestamp");

      if (error) throw error;

      if (data && data.length > 0) {
        // Extract available columns from CSV mapping or first reading
        const columnsSet = new Set<string>();
        
        // Extract columns from metadata only
        const columnMapping = csvFile?.column_mapping as any;
        if (columnMapping && columnMapping.renamedHeaders) {
          Object.values(columnMapping.renamedHeaders).forEach((headerName: any) => {
            if (headerName && typeof headerName === 'string' && 
                !headerName.toLowerCase().includes('time') && 
                !headerName.toLowerCase().includes('date')) {
              columnsSet.add(headerName);
            }
          });
        } else if (data[0]?.metadata) {
          // Fallback: extract from first reading's metadata
          const metadata = data[0].metadata as any;
          if (metadata?.imported_fields) {
            Object.keys(metadata.imported_fields).forEach(key => {
              if (!key.toLowerCase().includes('time') && !key.toLowerCase().includes('date')) {
                columnsSet.add(key);
              }
            });
          }
        }
        
        const columns = Array.from(columnsSet);
        setAvailableColumns(columns);
        
        // Don't auto-select any quantities - let user choose
        
        console.log("Load Profile - Raw data from database:", data);
        processLoadProfile(data);
      } else {
        toast.info("No readings found for selected period");
        setLoadProfileData([]);
        setAvailableColumns([]);
      }
    } catch (error) {
      console.error("Error fetching load profile:", error);
      toast.error("Failed to load profile data");
    } finally {
      setIsLoading(false);
    }
  };

  const processLoadProfile = (readings: any[]) => {
    // Deduplicate readings by timestamp, keeping most recent import
    const readingsByTime = new Map<string, any>();
    
    readings.forEach((reading) => {
      const timestamp = reading.reading_timestamp;
      const existingReading = readingsByTime.get(timestamp);
      
      // Keep the reading with the most recent imported_at timestamp
      if (!existingReading) {
        readingsByTime.set(timestamp, reading);
      } else {
        const existingImportedAt = existingReading.metadata?.imported_at || '';
        const currentImportedAt = reading.metadata?.imported_at || '';
        
        if (currentImportedAt > existingImportedAt) {
          readingsByTime.set(timestamp, reading);
        }
      }
    });
    
    // Convert back to array and sort by timestamp
    const uniqueReadings = Array.from(readingsByTime.values()).sort(
      (a, b) => new Date(a.reading_timestamp).getTime() - new Date(b.reading_timestamp).getTime()
    );
    
    // Plot exact values from database including all metadata columns
    const chartData = uniqueReadings.map((reading) => {
      const dataPoint: any = {
        timestamp: reading.reading_timestamp,
      };
      
      // Add all columns from metadata
      const metadata = reading.metadata as any;
      if (metadata?.imported_fields) {
        Object.entries(metadata.imported_fields).forEach(([key, value]) => {
          if (!key.toLowerCase().includes('time') && !key.toLowerCase().includes('date')) {
            dataPoint[key] = Number(value) || 0;
          }
        });
      }
      
      return dataPoint;
    });

    console.log("Load Profile - Chart data to display:", chartData);
    console.log("Deduplication: Original readings:", readings.length, "Unique readings:", uniqueReadings.length);
    setLoadProfileData(chartData);
    // Always enable brush with full data range
    setUseBrush(true);
    setBrushStartIndex(0);
    setBrushEndIndex(Math.max(0, chartData.length - 1));
  };

  const handleQuantityToggle = (quantity: string, checked: boolean) => {
    setSelectedQuantities(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(quantity);
      } else {
        newSet.delete(quantity);
      }
      return newSet;
    });
  };

  const handleLegendClick = (dataKey: string) => {
    setHiddenLines(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dataKey)) {
        newSet.delete(dataKey);
      } else {
        newSet.add(dataKey);
      }
      return newSet;
    });
  };

  const getYAxisDomain = (): [number | "auto", number | "auto"] => {
    const min = yAxisMin && !isNaN(parseFloat(yAxisMin)) ? parseFloat(yAxisMin) : "auto";
    const max = yAxisMax && !isNaN(parseFloat(yAxisMax)) ? parseFloat(yAxisMax) : "auto";
    return [min, max];
  };

  const handleResetView = () => {
    const currentData = isManipulationApplied ? manipulatedData : loadProfileData;
    setUseBrush(true);
    setBrushStartIndex(0);
    setBrushEndIndex(Math.max(0, currentData.length - 1));
    setYAxisMin("");
    setYAxisMax("");
  };

  const handleSetDayRange = (days: number) => {
    const currentData = isManipulationApplied ? manipulatedData : loadProfileData;
    if (currentData.length === 0) return;
    
    const msPerDay = 24 * 60 * 60 * 1000;
    const targetMs = days * msPerDay;
    
    // Calculate viewport window (N days from the start)
    const firstTimestamp = new Date(currentData[0].timestamp).getTime();
    const viewportEndMs = firstTimestamp + targetMs;
    
    // Find the end index for the initial viewport
    let viewportEndIndex = currentData.length - 1;
    for (let i = 0; i < currentData.length; i++) {
      const pointMs = new Date(currentData[i].timestamp).getTime();
      if (pointMs >= viewportEndMs) {
        viewportEndIndex = i;
        break;
      }
    }
    
    // Set initial viewport, but brush extends across full dataset to allow panning anywhere
    setBrushStartIndex(0);
    setBrushEndIndex(viewportEndIndex);
    setUseBrush(true);
  };

  const handleDownloadData = () => {
    const currentData = isManipulationApplied ? manipulatedData : loadProfileData;
    if (currentData.length === 0) {
      toast.error("No data to download");
      return;
    }

    // Format timestamp without timezone for export
    const cleanedData = currentData.map(row => {
      const { timestamp, ...measurements } = row;
      
      // Format timestamp as YYYY-MM-DD HH:mm:ss
      const formattedTimestamp = timestamp 
        ? timestamp.split('+')[0].split('T').join(' ').substring(0, 19)
        : '';
      
      return {
        timestamp: formattedTimestamp,
        ...measurements
      };
    });

    // Convert data to CSV
    const headers = Object.keys(cleanedData[0]).join(",");
    const rows = cleanedData.map(row => 
      Object.values(row).map(val => 
        typeof val === 'string' && val.includes(',') ? `"${val}"` : val
      ).join(",")
    ).join("\n");
    
    const csv = `${headers}\n${rows}`;
    
    // Create blob and download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const selectedMeter = meters.find(m => m.id === selectedMeterId);
    const dateRange = dateFrom && dateTo 
      ? `${format(dateFrom, 'yyyy-MM-dd')}_to_${format(dateTo, 'yyyy-MM-dd')}`
      : 'data';
    a.download = `load_profile_${selectedMeter?.meter_number || 'meter'}_${dateRange}.csv`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    toast.success("Data downloaded successfully");
  };

  const handleApplyManipulation = () => {
    if (loadProfileData.length === 0) {
      toast.error("No load profile data to manipulate");
      return;
    }

    try {
      // Calculate period duration in milliseconds
      const periodDurationMs = manipulationPeriod * 24 * 60 * 60 * 1000;

      // Group data points by their position within the period
      const groups = new Map<string, any[]>();

      // Find the earliest timestamp to use as reference
      const timestamps = loadProfileData.map(d => new Date(d.timestamp).getTime());
      const earliestTime = Math.min(...timestamps);

      loadProfileData.forEach((dataPoint) => {
        const dataTime = new Date(dataPoint.timestamp).getTime();
        
        // Calculate position within the repeating period pattern
        const timeSincePeriodStart = (dataTime - earliestTime) % periodDurationMs;
        
        // Create a time key for grouping (relative time within the period)
        const relativeDate = new Date(earliestTime + timeSincePeriodStart);
        const day = String(relativeDate.getDate()).padStart(2, '0');
        const month = String(relativeDate.getMonth() + 1).padStart(2, '0');
        const hours = String(relativeDate.getHours()).padStart(2, '0');
        const minutes = String(relativeDate.getMinutes()).padStart(2, '0');
        const timeKey = `${month}-${day} ${hours}:${minutes}`;
        
        if (!groups.has(timeKey)) {
          groups.set(timeKey, []);
        }
        groups.get(timeKey)!.push(dataPoint);
      });

      // Apply the selected operation to each group
      const manipulated: any[] = [];
      
      groups.forEach((dataPoints, timeKey) => {
        const result: any = { timestamp: timeKey };

        // Process each selected quantity
        selectedQuantities.forEach((quantity) => {
          const values = dataPoints
            .map(dp => dp[quantity])
            .filter(v => v !== undefined && v !== null && !isNaN(v));

          if (values.length === 0) {
            result[quantity] = 0;
            return;
          }

          let calculatedValue = 0;
          
          switch (manipulationOperation) {
            case "sum":
              calculatedValue = values.reduce((sum, val) => sum + val, 0);
              break;
            case "min":
              calculatedValue = Math.min(...values);
              break;
            case "max":
              calculatedValue = Math.max(...values);
              break;
            case "avg":
              calculatedValue = values.reduce((sum, val) => sum + val, 0) / values.length;
              break;
            case "cnt":
              calculatedValue = values.length;
              break;
          }

          result[quantity] = calculatedValue;
        });

        manipulated.push(result);
      });

      // Sort by time key chronologically
      manipulated.sort((a, b) => {
        return a.timestamp.localeCompare(b.timestamp);
      });

      setManipulatedData(manipulated);
      setIsManipulationApplied(true);
      // Always enable brush with full range
      setUseBrush(true);
      setBrushStartIndex(0);
      setBrushEndIndex(Math.max(0, manipulated.length - 1));
      
      const periodLabel = manipulationPeriod === 1 ? 'daily' : manipulationPeriod === 7 ? 'weekly' : 'monthly';
      toast.success(`Applied ${manipulationOperation} operation over ${periodLabel} period`);
    } catch (error) {
      console.error("Manipulation error:", error);
      toast.error("Failed to apply manipulation");
    }
  };

  const handleResetManipulation = () => {
    setManipulatedData([]);
    setIsManipulationApplied(false);
    // Always enable brush with full range
    setUseBrush(true);
    setBrushStartIndex(0);
    setBrushEndIndex(Math.max(0, loadProfileData.length - 1));
    toast.info("Reset to original load profile");
  };

  const selectedMeter = meters.find((m) => m.id === selectedMeterId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Load Profiles
          </CardTitle>
          <CardDescription>
            Analyze meter load patterns using kVA data over selected time periods with precise date and time selection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="meter-select">Select Meter</Label>
              <Select value={selectedMeterId} onValueChange={setSelectedMeterId}>
                <SelectTrigger id="meter-select">
                  <SelectValue placeholder="Choose a meter" />
                </SelectTrigger>
                <SelectContent>
                  {meters.map((meter) => (
                    <SelectItem key={meter.id} value={meter.id}>
                      {meter.meter_number} - {meter.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date & Time From</Label>
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
                    {dateFrom ? (
                      <span>{format(dateFrom, "MMM d, yyyy")} at {timeFrom}</span>
                    ) : (
                      <span>Pick start date & time</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <div className="pointer-events-auto">
                    <Calendar
                      mode="single"
                      selected={dateFrom}
                      onSelect={setDateFrom}
                      initialFocus
                      className="p-3"
                    />
                    <div className="border-t px-3 py-3">
                      <Input
                        id="time-from"
                        type="time"
                        value={timeFrom}
                        onChange={(e) => setTimeFrom(e.target.value)}
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Date & Time To</Label>
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
                    {dateTo ? (
                      <span>{format(dateTo, "MMM d, yyyy")} at {timeTo}</span>
                    ) : (
                      <span>Pick end date & time</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <div className="pointer-events-auto">
                    <Calendar
                      mode="single"
                      selected={dateTo}
                      onSelect={setDateTo}
                      initialFocus
                      className="p-3"
                    />
                    <div className="border-t px-3 py-3">
                      <Input
                        id="time-to"
                        type="time"
                        value={timeTo}
                        onChange={(e) => setTimeTo(e.target.value)}
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading load profile data...</div>
            </div>
          )}

          {!isLoading && loadProfileData.length > 0 && (
            <div className="space-y-6">
              <div className="grid grid-cols-[200px_180px_1fr] gap-4 mb-4 items-start">
                {/* Quantities to Plot */}
                <div className="space-y-3">
                  <Label className="font-semibold">Quantities to Plot</Label>
                  <div className="flex flex-col gap-3 h-[280px] overflow-y-auto pr-2 border rounded-md p-3 bg-muted/20">
                    {availableColumns.map((column) => (
                      <div key={column} className="flex items-center space-x-2">
                        <Checkbox
                          id={`show-${column}`}
                          checked={selectedQuantities.has(column)}
                          onCheckedChange={(checked) => handleQuantityToggle(column, checked === true)}
                        />
                        <label
                          htmlFor={`show-${column}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {column}
                        </label>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="default"
                    onClick={() => {
                      if (selectedQuantities.size === 0) {
                        toast.error("Please select at least one quantity to plot");
                        return;
                      }
                      setShowGraph(true);
                    }}
                    className="w-full mt-3"
                  >
                    Graph
                  </Button>
                </div>
                
                {/* Y-Axis and X-Axis Controls - Stacked Vertically */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="y-min" className="font-semibold">Y-Axis Min</Label>
                    <Input
                      id="y-min"
                      type="text"
                      placeholder="Auto"
                      value={yAxisMin}
                      onChange={(e) => setYAxisMin(e.target.value)}
                      className="h-10"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="y-max" className="font-semibold">Y-Axis Max</Label>
                    <Input
                      id="y-max"
                      type="text"
                      placeholder="Auto"
                      value={yAxisMax}
                      onChange={(e) => setYAxisMax(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="font-semibold">X-Axis Range (Days)</Label>
                    <div className="flex flex-wrap gap-2">
                      {[1, 7, 14, 21, 28, 30, 31].map((days) => (
                        <Button
                          key={days}
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetDayRange(days)}
                        >
                          {days}d
                        </Button>
                      ))}
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    onClick={handleResetView}
                    className="w-full"
                  >
                    Reset View
                  </Button>
                </div>

                {/* Data Manipulation */}
                <div className="space-y-3 border-l pl-4">
                  <Label className="font-semibold">Data Manipulation</Label>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="manipulation-op" className="text-sm">Operation</Label>
                      <Select value={manipulationOperation} onValueChange={setManipulationOperation}>
                        <SelectTrigger id="manipulation-op" className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sum">Sum</SelectItem>
                          <SelectItem value="min">Min</SelectItem>
                          <SelectItem value="max">Max</SelectItem>
                          <SelectItem value="avg">Avg</SelectItem>
                          <SelectItem value="cnt">Cnt</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="manipulation-period" className="text-sm">Period</Label>
                      <Select value={String(manipulationPeriod)} onValueChange={(val) => setManipulationPeriod(Number(val))}>
                        <SelectTrigger id="manipulation-period" className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Daily (1 day)</SelectItem>
                          <SelectItem value="7">Weekly (7 days)</SelectItem>
                          <SelectItem value="30">Monthly (30 days)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button 
                      onClick={handleApplyManipulation}
                      size="sm"
                      className="w-full"
                    >
                      Apply Manipulation
                    </Button>
                    
                    {isManipulationApplied && (
                      <Button 
                        onClick={handleResetManipulation}
                        size="sm"
                        variant="outline"
                        className="w-full"
                      >
                        Reset to Original
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {showGraph && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold">
                        Load Profile - {selectedMeter?.meter_number}
                        {isManipulationApplied && (
                          <span className="ml-2 text-sm font-normal text-primary">
                            ({manipulationOperation} - {manipulationPeriod === 1 ? 'daily' : manipulationPeriod === 7 ? 'weekly' : 'monthly'})
                          </span>
                        )}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Click on legend items to toggle visibility
                        {dateFrom && dateTo && dateFrom.getTime() !== dateTo.getTime() && (
                          <> • {Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)) + 1} day(s) selected</>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (loadProfileData.length === 0) {
                            toast.error("No data to download");
                            return;
                          }

                          const cleanedData = loadProfileData.map(row => {
                            const { timestamp, ...measurements } = row;
                            const formattedTimestamp = timestamp 
                              ? timestamp.split('+')[0].split('T').join(' ').substring(0, 19)
                              : '';
                            return {
                              timestamp: formattedTimestamp,
                              ...measurements
                            };
                          });

                          const headers = Object.keys(cleanedData[0]).join(",");
                          const rows = cleanedData.map(row => 
                            Object.values(row).map(val => 
                              typeof val === 'string' && val.includes(',') ? `"${val}"` : val
                            ).join(",")
                          ).join("\n");
                          
                          const csv = `${headers}\n${rows}`;
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          
                          const selectedMeter = meters.find(m => m.id === selectedMeterId);
                          const dateRange = dateFrom && dateTo 
                            ? `${format(dateFrom, 'yyyy-MM-dd')}_to_${format(dateTo, 'yyyy-MM-dd')}`
                            : 'data';
                          a.download = `load_profile_original_${selectedMeter?.meter_number || 'meter'}_${dateRange}.csv`;
                          
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          window.URL.revokeObjectURL(url);
                          
                          toast.success("Original data downloaded");
                        }}
                        className="flex items-center gap-2"
                      >
                        <Download className="h-4 w-4" />
                        Original Data
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (manipulatedData.length === 0) {
                            toast.error("No manipulated data to download. Apply a manipulation first.");
                            return;
                          }

                          const cleanedData = manipulatedData.map(row => {
                            const { timestamp, ...measurements } = row;
                            return {
                              timestamp,
                              ...measurements
                            };
                          });

                          const headers = Object.keys(cleanedData[0]).join(",");
                          const rows = cleanedData.map(row => 
                            Object.values(row).map(val => 
                              typeof val === 'string' && val.includes(',') ? `"${val}"` : val
                            ).join(",")
                          ).join("\n");
                          
                          const csv = `${headers}\n${rows}`;
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          
                          const selectedMeter = meters.find(m => m.id === selectedMeterId);
                          const dateRange = dateFrom && dateTo 
                            ? `${format(dateFrom, 'yyyy-MM-dd')}_to_${format(dateTo, 'yyyy-MM-dd')}`
                            : 'data';
                          const periodLabel = manipulationPeriod === 1 ? 'daily' : manipulationPeriod === 7 ? 'weekly' : 'monthly';
                          a.download = `load_profile_${manipulationOperation}_${periodLabel}_${selectedMeter?.meter_number || 'meter'}_${dateRange}.csv`;
                          
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          window.URL.revokeObjectURL(url);
                          
                          toast.success("Manipulated data downloaded");
                        }}
                        className="flex items-center gap-2"
                        disabled={!isManipulationApplied}
                      >
                        <Download className="h-4 w-4" />
                        Manipulated Data
                      </Button>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={isManipulationApplied ? manipulatedData : loadProfileData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="timestamp"
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }}
                        interval="preserveStartEnd"
                        tickFormatter={(value) => {
                          if (!value) return '';
                          const date = new Date(value);
                          const month = String(date.getMonth() + 1).padStart(2, '0');
                          const day = String(date.getDate()).padStart(2, '0');
                          const hours = String(date.getHours()).padStart(2, '0');
                          const minutes = String(date.getMinutes()).padStart(2, '0');
                          return `${month}-${day} ${hours}:${minutes}`;
                        }}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fill: "hsl(var(--foreground))" }}
                        domain={getYAxisDomain()}
                        label={{
                          value: "Value",
                          angle: -90,
                          position: "insideLeft",
                          style: { fill: "hsl(var(--foreground))" },
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "6px",
                        }}
                      />
                      <Legend 
                        onClick={(e: any) => e.dataKey && handleLegendClick(String(e.dataKey))}
                        wrapperStyle={{ cursor: "pointer" }}
                      />
                      {useBrush && (
                        <Brush
                          dataKey="timestamp"
                          height={30}
                          stroke="hsl(var(--primary))"
                          fill="hsl(var(--muted))"
                          startIndex={brushStartIndex}
                          endIndex={brushEndIndex}
                          onChange={(e: any) => {
                            setBrushStartIndex(e.startIndex);
                            setBrushEndIndex(e.endIndex);
                          }}
                          alwaysShowText={false}
                          data={isManipulationApplied ? manipulatedData : loadProfileData}
                          tickFormatter={(value) => {
                            if (!value) return '';
                            const date = new Date(value);
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const day = String(date.getDate()).padStart(2, '0');
                            return `${month}-${day}`;
                          }}
                        />
                      )}
                      {Array.from(selectedQuantities).map((quantity, index) => {
                        const colors = [
                          "#3b82f6", // blue
                          "#10b981", // green
                          "#f59e0b", // orange
                          "#8b5cf6", // purple
                          "#ef4444", // red
                          "#06b6d4", // cyan
                          "#84cc16", // lime
                        ];
                         return (
                          <Line
                            key={quantity}
                            type="linear"
                            dataKey={quantity}
                            stroke={colors[index % colors.length]}
                            strokeWidth={3}
                            dot={false}
                            name={quantity}
                            hide={hiddenLines.has(quantity)}
                            connectNulls={true}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

            </div>
          )}

          {!isLoading && loadProfileData.length === 0 && dateFrom && dateTo && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <div className="text-center">
                <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No readings available for the selected meter and period</p>
                <p className="text-sm">Try selecting a different date or date range</p>
              </div>
            </div>
          )}

          {(!dateFrom || !dateTo) && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <div className="text-center">
                <CalendarIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Select a meter and date range to view load profiles</p>
                <p className="text-sm mt-1">Choose dates and times to analyze load patterns</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
