import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
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
  const [manipulationOperation, setManipulationOperation] = useState<string>("sum");
  const [manipulationPeriod, setManipulationPeriod] = useState<number>(1);
  const [manipulatedData, setManipulatedData] = useState<any[]>([]);
  const [isManipulationApplied, setIsManipulationApplied] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    fetchMeters();
  }, [siteId]);

  // Helper to combine date and time and format as naive timestamp string
  const getFullDateTime = (date: Date, time: string): string => {
    const [hours, minutes] = time.split(':').map(Number);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hrs = String(hours).padStart(2, '0');
    const mins = String(minutes).padStart(2, '0');
    // Return formatted string without timezone: "YYYY-MM-DD HH:mm:ss"
    return `${year}-${month}-${day} ${hrs}:${mins}:00`;
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
      
      // Fetch all data using pagination
      let allData: any[] = [];
      let start = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("meter_readings")
          .select("reading_timestamp, metadata")
          .eq("meter_id", selectedMeterId)
          .gte("reading_timestamp", fullDateTimeFrom)
          .lte("reading_timestamp", fullDateTimeTo)
          .order("reading_timestamp")
          .range(start, start + batchSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allData = [...allData, ...data];
          start += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      const data = allData;

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
        timestamp: new Date(reading.reading_timestamp).getTime(), // Convert to numeric timestamp
        timestampStr: reading.reading_timestamp, // Keep string for reference
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
    setYAxisMin("");
    setYAxisMax("");
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
      const timestamps = loadProfileData.map(d => new Date(d.timestampStr || d.timestamp).getTime());
      const earliestTime = Math.min(...timestamps);

      loadProfileData.forEach((dataPoint) => {
        const dataTime = new Date(dataPoint.timestampStr || dataPoint.timestamp).getTime();
        
        // Calculate position within the repeating period pattern
        const timeSincePeriodStart = (dataTime - earliestTime) % periodDurationMs;
        
        // Create a time key for grouping (relative time within the period)
        const relativeDate = new Date(earliestTime + timeSincePeriodStart);
        
        // Format as ISO string for proper display
        const timeKey = relativeDate.toISOString();
        
        if (!groups.has(timeKey)) {
          groups.set(timeKey, []);
        }
        groups.get(timeKey)!.push(dataPoint);
      });

      // Apply the selected operation to each group
      const manipulated: any[] = [];
      
      groups.forEach((dataPoints, timeKey) => {
        const result: any = { 
          timestamp: timeKey,
          timestampStr: timeKey  // Add timestampStr for graph display
        };

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

          <div className="flex gap-3 justify-end">
            <Button
              variant="default"
              onClick={() => {
                if (!selectedMeterId || !dateFrom || !dateTo) {
                  toast.error("Please select meter and date range");
                  return;
                }
                setDataLoaded(true);
                fetchLoadProfile();
              }}
              disabled={!selectedMeterId || !dateFrom || !dateTo || isLoading}
            >
              Load Data
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (loadProfileData.length === 0) {
                  toast.error("No data to download. Please load data first.");
                  return;
                }

                const cleanedData = loadProfileData.map(row => {
                  const { timestamp, timestampStr, ...measurements } = row;
                  const formattedTimestamp = timestampStr 
                    ? timestampStr.split('+')[0].split('T').join(' ').substring(0, 19)
                    : new Date(timestamp).toISOString().split('+')[0].split('T').join(' ').substring(0, 19);
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
                a.download = `meter_data_${selectedMeter?.meter_number || 'meter'}_${dateRange}.csv`;
                
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                
                toast.success("CSV data downloaded");
              }}
              disabled={!dataLoaded || loadProfileData.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Download CSV
            </Button>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading load profile data...</div>
            </div>
          )}

          {!isLoading && dataLoaded && loadProfileData.length > 0 && (
            <div className="space-y-6">
              <div className="grid grid-cols-[200px_180px_1fr] gap-2 mb-4 items-start max-w-full">
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
                  
                  {showGraph && selectedQuantities.size > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        const data = isManipulationApplied ? manipulatedData : loadProfileData;
                        
                        const cleanedData = data.map((point) => {
                          const measurements: Record<string, any> = {};
                          
                          Object.entries(point).forEach(([key, value]) => {
                            if (key !== 'timestampStr' && key !== 'timestamp') {
                              measurements[key] = value;
                            }
                          });
                          
                          const formattedTimestamp = point.timestampStr 
                            ? format(new Date(point.timestampStr), 'yyyy-MM-dd HH:mm:ss')
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
                        const dataType = isManipulationApplied ? 'manipulated' : 'load_profile';
                        a.download = `${dataType}_${selectedMeter?.meter_number || 'meter'}_${dateRange}.csv`;
                        
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(url);
                        
                        toast.success("Data downloaded successfully");
                      }}
                      className="w-full mt-2"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download Graph Data
                    </Button>
                  )}
                </div>
                
                {/* Y-Axis and X-Axis Controls - Stacked Vertically */}
                <div className="space-y-2">
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


                  <Button
                    variant="secondary"
                    onClick={handleResetView}
                    className="w-full"
                  >
                    Reset View
                  </Button>
                </div>

                {/* Data Manipulation */}
                <div className="space-y-2 border-l pl-4">
                  <Label className="font-semibold">Data Manipulation</Label>
                  <div className="space-y-2">
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

              {showGraph && selectedQuantities.size > 0 && (
                <div className="mt-6 space-y-4">
                  <ResponsiveContainer width="100%" height={500}>
                    <LineChart
                      data={isManipulationApplied ? manipulatedData : loadProfileData}
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      {/* Vertical lines at day boundaries */}
                      {(() => {
                        const data = isManipulationApplied ? manipulatedData : loadProfileData;
                        const dayBoundaries: string[] = [];
                        let lastDay: number | null = null;
                        
                        data.forEach((point) => {
                          if (point.timestampStr) {
                            const date = new Date(point.timestampStr);
                            const currentDay = date.getDate();
                            
                            if (lastDay === null || currentDay !== lastDay) {
                              dayBoundaries.push(point.timestampStr);
                            }
                            lastDay = currentDay;
                          }
                        });
                        
                        return dayBoundaries.map((timestamp, idx) => (
                          <ReferenceLine 
                            key={`day-${idx}`}
                            x={timestamp}
                            stroke="#9ca3af"
                            strokeWidth={1}
                            strokeOpacity={0.5}
                          />
                        ));
                      })()}
                       <XAxis 
                        dataKey="timestampStr"
                        height={100}
                        tickLine={false}
                        interval={0}
                        tick={(props: any) => {
                          const { x, y, payload } = props;
                          if (!payload?.value) return null;
                          
                          try {
                            const currentDate = new Date(payload.value);
                            const data = isManipulationApplied ? manipulatedData : loadProfileData;
                            
                            // Find all day boundaries
                            const dayBoundaries: { timestamp: string, day: number, month: number, year: number }[] = [];
                            let lastDay: number | null = null;
                            
                            data.forEach((point) => {
                              if (point.timestampStr) {
                                const date = new Date(point.timestampStr);
                                const currentDay = date.getDate();
                                
                                if (lastDay === null || currentDay !== lastDay) {
                                  dayBoundaries.push({
                                    timestamp: point.timestampStr,
                                    day: currentDay,
                                    month: date.getMonth(),
                                    year: date.getFullYear()
                                  });
                                }
                                lastDay = currentDay;
                              }
                            });
                            
                            // Find which day segment this timestamp belongs to
                            let dayIndex = -1;
                            for (let i = 0; i < dayBoundaries.length; i++) {
                              const startTime = new Date(dayBoundaries[i].timestamp).getTime();
                              const endTime = i < dayBoundaries.length - 1
                                ? new Date(dayBoundaries[i + 1].timestamp).getTime()
                                : new Date(data[data.length - 1].timestampStr).getTime();
                              const centerTime = (startTime + endTime) / 2;
                              
                              // If this timestamp is close to the center of this day segment
                              if (Math.abs(currentDate.getTime() - centerTime) < 15 * 60 * 1000) { // within 15 minutes
                                dayIndex = i;
                                break;
                              }
                            }
                            
                            // Only show label if this is a center point
                            if (dayIndex === -1) return null;
                            
                            const dayInfo = dayBoundaries[dayIndex];
                            
                            // Determine if we should show month/year
                            const monthDays = dayBoundaries.filter(d => 
                              d.month === dayInfo.month && d.year === dayInfo.year
                            );
                            const yearDays = dayBoundaries.filter(d => 
                              d.year === dayInfo.year
                            );
                            
                            const monthCenterIdx = Math.floor(monthDays.length / 2);
                            const yearCenterIdx = Math.floor(yearDays.length / 2);
                            
                            const showMonth = monthDays[monthCenterIdx]?.day === dayInfo.day;
                            const showYear = yearDays[yearCenterIdx]?.day === dayInfo.day;
                            
                            return (
                              <g transform={`translate(${x},${y})`}>
                                {/* Day number */}
                                <text 
                                  x={0} 
                                  y={0} 
                                  dy={16} 
                                  textAnchor="middle" 
                                  fill="currentColor"
                                  fontSize={12}
                                >
                                  {dayInfo.day}
                                </text>
                                
                                {/* Month name */}
                                {showMonth && (
                                  <text 
                                    x={0} 
                                    y={0} 
                                     dy={38} 
                                     textAnchor="middle" 
                                     fill="currentColor"
                                     fontSize={13}
                                     fontWeight="500"
                                   >
                                     {format(new Date(dayInfo.timestamp), 'MMM')}
                                   </text>
                                 )}
                                 
                                 {/* Year */}
                                 {showYear && (
                                   <text 
                                     x={0} 
                                     y={0} 
                                     dy={60} 
                                     textAnchor="middle" 
                                     fill="currentColor"
                                     fontSize={12}
                                   >
                                     {dayInfo.year}
                                   </text>
                                 )}
                               </g>
                             );
                            } catch (error) {
                              console.error('Error rendering X-axis tick:', error);
                              return null;
                            }
                          }}
                        />
                       <YAxis domain={getYAxisDomain()} />
                      <Tooltip 
                        labelFormatter={(label) => {
                          if (!label) return '';
                          try {
                            const date = new Date(label);
                            return format(date, 'PPpp');
                          } catch {
                            return label;
                          }
                        }}
                      />
                      <Legend 
                        onClick={(e) => handleLegendClick(e.dataKey as string)}
                        wrapperStyle={{ cursor: 'pointer' }}
                      />
                      {Array.from(selectedQuantities).map((quantity, index) => {
                        const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1', '#d084d0', '#a4de6c'];
                        return (
                          <Line
                            key={quantity}
                            type="monotone"
                            dataKey={quantity}
                            stroke={colors[index % colors.length]}
                            strokeWidth={2}
                            dot={false}
                            hide={hiddenLines.has(quantity)}
                            connectNulls
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
