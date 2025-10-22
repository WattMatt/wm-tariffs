import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";

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
}

export default function LoadProfilesTab({ siteId }: LoadProfilesTabProps) {
  const [meters, setMeters] = useState<Meter[]>([]);
  const [selectedMeterId, setSelectedMeterId] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [loadProfileData, setLoadProfileData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [normalizedData, setNormalizedData] = useState<any[]>([]);

  useEffect(() => {
    fetchMeters();
  }, [siteId]);

  useEffect(() => {
    if (selectedMeterId && dateRange?.from) {
      fetchLoadProfile();
    }
  }, [selectedMeterId, dateRange]);

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
    if (!selectedMeterId || !dateRange?.from) return;

    setIsLoading(true);
    try {
      // Use same day for both start and end if only one date selected
      const endDate = dateRange.to || dateRange.from;
      
      const { data, error } = await supabase
        .from("meter_readings")
        .select("reading_timestamp, kva_value")
        .eq("meter_id", selectedMeterId)
        .gte("reading_timestamp", startOfDay(dateRange.from).toISOString())
        .lte("reading_timestamp", endOfDay(endDate).toISOString())
        .order("reading_timestamp");

      if (error) throw error;

      if (data && data.length > 0) {
        const endDate = dateRange.to || dateRange.from;
        processLoadProfile(data, endDate);
      } else {
        toast.info("No readings found for selected period");
        setLoadProfileData([]);
        setNormalizedData([]);
      }
    } catch (error) {
      console.error("Error fetching load profile:", error);
      toast.error("Failed to load profile data");
    } finally {
      setIsLoading(false);
    }
  };

  const processLoadProfile = (readings: ReadingData[], endDate: Date) => {
    // Group by hour and calculate average kVA
    const hourlyData: { [key: string]: { total: number; count: number } } = {};

    readings.forEach((reading) => {
      const date = parseISO(reading.reading_timestamp);
      const hour = format(date, "HH:00");

      // Use the kva_value column directly
      const kva = reading.kva_value || 0;

      if (!hourlyData[hour]) {
        hourlyData[hour] = { total: 0, count: 0 };
      }

      hourlyData[hour].total += kva;
      hourlyData[hour].count += 1;
    });

    // Calculate averages and create chart data
    const chartData = Object.keys(hourlyData)
      .sort()
      .map((hour) => ({
        hour,
        kva: Number((hourlyData[hour].total / hourlyData[hour].count).toFixed(2)),
      }));

    setLoadProfileData(chartData);

    // Calculate normalized data
    if (chartData.length > 0) {
      const maxKva = Math.max(...chartData.map((d) => d.kva));
      const normalized = chartData.map((d) => ({
        hour: d.hour,
        normalized: maxKva > 0 ? Number((d.kva / maxKva).toFixed(3)) : 0,
        kva: d.kva,
      }));
      setNormalizedData(normalized);
    }
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
            Analyze meter load patterns using kVA data over selected time periods
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <Label>Date Range (or Single Date)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateRange && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "LLL dd, y")} -{" "}
                          {format(dateRange.to, "LLL dd, y")}
                        </>
                      ) : (
                        format(dateRange.from, "LLL dd, y")
                      )
                    ) : (
                      <span>Pick a date or date range</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Select a single date for that day's hourly profile, or a range to average across multiple days
              </p>
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading load profile data...</div>
            </div>
          )}

          {!isLoading && loadProfileData.length > 0 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  {dateRange?.to && dateRange.from.getTime() !== dateRange.to.getTime() 
                    ? "Average Hourly Load (kVA)" 
                    : "Hourly Load Profile (kVA)"} - {selectedMeter?.meter_number}
                </h3>
                {dateRange?.to && dateRange.from.getTime() !== dateRange.to.getTime() && (
                  <p className="text-sm text-muted-foreground mb-2">
                    Averaged across {Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24))} day(s)
                  </p>
                )}
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={loadProfileData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="hour"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--foreground))" }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--foreground))" }}
                      label={{
                        value: "kVA",
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
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="kva"
                      stroke="hsl(var(--primary))"
                      strokeWidth={3}
                      dot={false}
                      name="Average kVA"
                    />
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
                      dataKey="hour"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--foreground))" }}
                      label={{
                        value: "Hour",
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

          {!isLoading && loadProfileData.length === 0 && dateRange?.from && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <div className="text-center">
                <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No readings available for the selected meter and period</p>
                <p className="text-sm">Try selecting a different date or date range</p>
              </div>
            </div>
          )}

          {!dateRange?.from && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <div className="text-center">
                <CalendarIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Select a meter and date (or date range) to view load profiles</p>
                <p className="text-sm mt-1">Choose a single date for that day's profile, or a range to average</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
