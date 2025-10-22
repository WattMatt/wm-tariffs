import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, parseISO } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, TrendingUp } from "lucide-react";
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
  const [normalizedData, setNormalizedData] = useState<any[]>([]);
  const [selectedQuantities, setSelectedQuantities] = useState<Set<string>>(new Set());
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [yAxisMin, setYAxisMin] = useState<string>("");
  const [yAxisMax, setYAxisMax] = useState<string>("");
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchMeters();
  }, [siteId]);

  useEffect(() => {
    if (selectedMeterId && dateFrom && dateTo) {
      fetchLoadProfile();
    }
  }, [selectedMeterId, dateFrom, dateTo, timeFrom, timeTo]);

  // Helper to combine date and time as UTC (no timezone conversion)
  const getFullDateTime = (date: Date, time: string): Date => {
    const [hours, minutes] = time.split(':').map(Number);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    // Create UTC date directly to avoid timezone shifts
    return new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));
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
        
        // Auto-select first column if none selected
        if (selectedQuantities.size === 0 && columns.length > 0) {
          setSelectedQuantities(new Set([columns[0]]));
        }
        
        console.log("Load Profile - Raw data from database:", data);
        processLoadProfile(data);
      } else {
        toast.info("No readings found for selected period");
        setLoadProfileData([]);
        setNormalizedData([]);
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
    // Plot exact values from database including all metadata columns
    const chartData = readings.map((reading) => {
      const date = parseISO(reading.reading_timestamp);
      const timeLabel = format(date, "HH:mm");
      
      const dataPoint: any = {
        time: timeLabel,
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
    setLoadProfileData(chartData);

    // Calculate normalized data based on selected quantities
    if (chartData.length > 0 && selectedQuantities.size > 0) {
      const firstSelected = Array.from(selectedQuantities)[0];
      const maxValue = Math.max(...chartData.map((d) => d[firstSelected] || 0));
      const normalized = chartData.map((d) => ({
        time: d.time,
        timestamp: d.timestamp,
        normalized: maxValue > 0 ? ((d[firstSelected] || 0) / maxValue) : 0,
      }));
      setNormalizedData(normalized);
    }
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
                      <span>{format(dateFrom, "PPP")} at {timeFrom}</span>
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
                      <span>{format(dateTo, "PPP")} at {timeTo}</span>
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
              <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_1fr] gap-6 mb-4">
                <div className="space-y-3">
                  <Label>Quantities to Plot</Label>
                  <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto pr-2">
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
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="y-min">Y-Axis Min</Label>
                  <Input
                    id="y-min"
                    type="text"
                    placeholder="Auto"
                    value={yAxisMin}
                    onChange={(e) => setYAxisMin(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="y-max">Y-Axis Max</Label>
                  <Input
                    id="y-max"
                    type="text"
                    placeholder="Auto"
                    value={yAxisMax}
                    onChange={(e) => setYAxisMax(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-4">
                  Load Profile - {selectedMeter?.meter_number}
                </h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Click on legend items to toggle visibility
                  {dateFrom && dateTo && dateFrom.getTime() !== dateTo.getTime() && (
                    <> • {Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)) + 1} day(s) selected</>
                  )}
                </p>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={loadProfileData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="time"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }}
                      interval="preserveStartEnd"
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

              <div>
                <h3 className="text-lg font-semibold mb-4">
                  Normalized Daily Load Profile - {selectedMeter?.meter_number}
                </h3>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={normalizedData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="time"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }}
                      interval="preserveStartEnd"
                      label={{
                        value: "Time",
                        position: "insideBottom",
                        offset: -5,
                        style: { fill: "hsl(var(--foreground))" },
                      }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--foreground))" }}
                      domain={[0, 1.2]}
                      ticks={[0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2]}
                      label={{
                        value: "Normalized power factor (p.u.)",
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
                      formatter={(value: number) => [value.toFixed(3), "Normalized"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="normalized"
                      stroke="hsl(220, 90%, 56%)"
                      strokeWidth={3}
                      dot={false}
                      name="Normalized Load"
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-sm text-muted-foreground mt-4">
                  Normalized values represent the load as a fraction of the maximum load during
                  the selected period. Peak load = 1.0
                </p>
              </div>
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
