import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Activity, TrendingUp, TrendingDown, Zap, DollarSign, Gauge, AlertCircle, CheckCircle, Calendar, X } from "lucide-react";
import { format, subMonths } from "date-fns";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface SiteOverviewProps {
  siteId: string;
  siteName: string;
}

interface ReconciliationRun {
  id: string;
  run_name: string;
  date_from: string;
  date_to: string;
  total_supply: number;
  bulk_total: number;
  solar_total: number;
  tenant_total: number;
  recovery_rate: number;
  discrepancy: number;
  grid_supply_cost: number | null;
  solar_cost: number | null;
  tenant_cost: number | null;
  total_revenue: number | null;
  avg_cost_per_kwh: number | null;
  revenue_enabled: boolean | null;
  run_date: string;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--warning))', 'hsl(var(--muted))'];

export default function SiteOverview({ siteId, siteName }: SiteOverviewProps) {
  const [loading, setLoading] = useState(true);
  const [reconciliationRuns, setReconciliationRuns] = useState<ReconciliationRun[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("all-time");
  const [kpiData, setKpiData] = useState({
    totalConsumption: 0,
    avgMonthlyConsumption: 0,
    totalCost: 0,
    avgCostPerKwh: 0,
    recoveryRate: 0,
    activeMeters: 0,
    metersByType: [] as { name: string; value: number }[],
    consumptionTrend: [] as { month: string; consumption: number }[],
    costTrend: [] as { month: string; cost: number }[],
    recentReconciliation: null as ReconciliationRun | null,
  });

  // Fetch reconciliation runs for period selector
  useEffect(() => {
    const fetchReconciliationRuns = async () => {
      const { data } = await supabase
        .from("reconciliation_runs")
        .select("*")
        .eq("site_id", siteId)
        .order("date_from", { ascending: false });
      
      if (data) {
        setReconciliationRuns(data);
      }
    };
    
    fetchReconciliationRuns();
  }, [siteId]);

  useEffect(() => {
    if (selectedPeriod === "all-time") {
      fetchAllTimeKPIData();
    } else {
      fetchPeriodKPIData(selectedPeriod);
    }
  }, [siteId, selectedPeriod]);

  const fetchAllTimeKPIData = async () => {
    setLoading(true);

    try {
      // Fetch meters
      const { data: meters } = await supabase
        .from("meters")
        .select("id, meter_type, tariff_structure_id")
        .eq("site_id", siteId);

      const meterIds = meters?.map(m => m.id) || [];

      // Calculate meter distribution by type
      const metersByType = meters?.reduce((acc: any[], meter) => {
        const type = meter.meter_type || "other";
        const existing = acc.find(item => item.name === type);
        if (existing) {
          existing.value += 1;
        } else {
          acc.push({ name: type, value: 1 });
        }
        return acc;
      }, []) || [];

      // Fetch last 6 months of consumption data
      const sixMonthsAgo = subMonths(new Date(), 6);
      const { data: readings } = meterIds.length > 0
        ? await supabase
            .from("meter_readings")
            .select("reading_timestamp, metadata, meter_id")
            .in("meter_id", meterIds)
            .gte("reading_timestamp", sixMonthsAgo.toISOString())
            .order("reading_timestamp")
        : { data: [] };

      // Helper to extract kWh from metadata
      const extractKwh = (metadata: any): number => {
        const imported = metadata?.imported_fields || {};
        const kwhKeys = Object.keys(imported).filter(k => 
          k.toLowerCase().includes('kwh') || k.toLowerCase() === 'p1' || k.toLowerCase().includes('p1')
        );
        return kwhKeys.length > 0 ? Number(imported[kwhKeys[0]]) || 0 : 0;
      };

      // Calculate monthly consumption
      const monthlyConsumption: Record<string, number> = {};
      if (readings && readings.length > 0) {
        readings.forEach(reading => {
          const month = format(new Date(reading.reading_timestamp), "MMM yyyy");
          if (!monthlyConsumption[month]) {
            monthlyConsumption[month] = 0;
          }
          monthlyConsumption[month] += extractKwh(reading.metadata);
        });
      }

      const consumptionTrend = Object.entries(monthlyConsumption).map(([month, consumption]) => ({
        month,
        consumption: Number(consumption),
      }));

      // Fetch recent reconciliation
      const { data: recentRec } = await supabase
        .from("reconciliation_runs")
        .select("*")
        .eq("site_id", siteId)
        .order("run_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Calculate total consumption
      let totalConsumption = 0;
      if (readings && readings.length > 0) {
        readings.forEach(r => {
          totalConsumption += extractKwh(r.metadata);
        });
      }
      const avgMonthlyConsumption = consumptionTrend.length > 0 
        ? totalConsumption / consumptionTrend.length 
        : 0;

      // Calculate cost trend (placeholder - would need actual tariff calculation)
      const costTrend = consumptionTrend.map(item => ({
        month: item.month,
        cost: item.consumption * 1.5, // Placeholder rate
      }));

      const totalCost = costTrend.reduce((sum, item) => sum + item.cost, 0);
      const avgCostPerKwh = totalConsumption > 0 ? totalCost / totalConsumption : 0;

      setKpiData({
        totalConsumption: Math.round(totalConsumption),
        avgMonthlyConsumption: Math.round(avgMonthlyConsumption),
        totalCost: Math.round(totalCost),
        avgCostPerKwh: Number(avgCostPerKwh.toFixed(2)),
        recoveryRate: recentRec?.recovery_rate || 0,
        activeMeters: meters?.length || 0,
        metersByType,
        consumptionTrend,
        costTrend,
        recentReconciliation: recentRec,
      });
    } catch (error) {
      console.error("Error fetching KPI data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPeriodKPIData = async (runId: string) => {
    setLoading(true);

    try {
      // Fetch the selected reconciliation run
      const { data: run } = await supabase
        .from("reconciliation_runs")
        .select("*")
        .eq("id", runId)
        .single();

      if (!run) {
        setLoading(false);
        return;
      }

      // Fetch meters for this site
      const { data: meters } = await supabase
        .from("meters")
        .select("id, meter_type")
        .eq("site_id", siteId);

      // Calculate meter distribution by type
      const metersByType = meters?.reduce((acc: any[], meter) => {
        const type = meter.meter_type || "other";
        const existing = acc.find(item => item.name === type);
        if (existing) {
          existing.value += 1;
        } else {
          acc.push({ name: type, value: 1 });
        }
        return acc;
      }, []) || [];

      // Fetch meter results for this reconciliation run
      const { data: meterResults } = await supabase
        .from("reconciliation_meter_results")
        .select("*")
        .eq("reconciliation_run_id", runId);

      const activeMetersInRun = meterResults?.filter(m => !m.has_error).length || 0;

      // Calculate total cost from run data
      const totalCost = (run.grid_supply_cost || 0) + (run.solar_cost || 0);
      const avgCostPerKwh = run.total_supply > 0 ? totalCost / run.total_supply : 0;

      // Create consumption breakdown for chart (Grid vs Solar)
      const consumptionTrend = [
        { month: "Grid", consumption: run.bulk_total },
        { month: "Solar", consumption: run.solar_total },
        { month: "Tenant", consumption: run.tenant_total },
      ].filter(item => item.consumption > 0);

      // Create cost breakdown for chart
      const costTrend = [
        { month: "Grid Cost", cost: run.grid_supply_cost || 0 },
        { month: "Solar Cost", cost: run.solar_cost || 0 },
        { month: "Tenant Revenue", cost: run.tenant_cost || 0 },
      ].filter(item => item.cost > 0);

      setKpiData({
        totalConsumption: Math.round(run.total_supply),
        avgMonthlyConsumption: Math.round(run.total_supply), // Single period
        totalCost: Math.round(totalCost),
        avgCostPerKwh: Number(avgCostPerKwh.toFixed(2)),
        recoveryRate: run.recovery_rate,
        activeMeters: activeMetersInRun,
        metersByType,
        consumptionTrend,
        costTrend,
        recentReconciliation: run,
      });
    } catch (error) {
      console.error("Error fetching period KPI data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getSelectedRunLabel = () => {
    if (selectedPeriod === "all-time") return "All Time (Last 6 Months)";
    const run = reconciliationRuns.find(r => r.id === selectedPeriod);
    if (!run) return "Select Period";
    return `${format(new Date(run.date_from), "dd MMM")} - ${format(new Date(run.date_to), "dd MMM yyyy")}`;
  };

  const getTrendIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="w-4 h-4 text-success" />;
    if (value < 0) return <TrendingDown className="w-4 h-4 text-destructive" />;
    return null;
  };

  const isFilteredView = selectedPeriod !== "all-time";

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-muted-foreground" />
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-time">
                <span className="flex items-center gap-2">
                  All Time (Last 6 Months)
                </span>
              </SelectItem>
              {reconciliationRuns.map((run) => (
                <SelectItem key={run.id} value={run.id}>
                  <span className="flex items-center gap-2">
                    {format(new Date(run.date_from), "dd MMM")} - {format(new Date(run.date_to), "dd MMM yyyy")}
                    <Badge variant="outline" className="ml-2 text-xs">
                      {run.recovery_rate.toFixed(0)}%
                    </Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {isFilteredView && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedPeriod("all-time")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
        
        {isFilteredView && (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Viewing: {getSelectedRunLabel()}
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Loading overview...</p>
        </div>
      ) : (
        <>
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {isFilteredView ? "Total Supply" : "Total Consumption (6mo)"}
                </CardTitle>
                <Zap className="w-5 h-5 text-warning" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{kpiData.totalConsumption.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">kWh</p>
                {isFilteredView && kpiData.recentReconciliation && (
                  <div className="flex flex-col gap-1 mt-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Grid:</span>
                      <span>{kpiData.recentReconciliation.bulk_total.toLocaleString()} kWh</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Solar:</span>
                      <span>{kpiData.recentReconciliation.solar_total.toLocaleString()} kWh</span>
                    </div>
                  </div>
                )}
                {!isFilteredView && (
                  <div className="flex items-center gap-1 mt-2 text-sm">
                    <span className="text-muted-foreground">Avg/month:</span>
                    <span className="font-medium">{kpiData.avgMonthlyConsumption.toLocaleString()} kWh</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {isFilteredView ? "Period Cost" : "Total Cost (6mo)"}
                </CardTitle>
                <DollarSign className="w-5 h-5 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">R {kpiData.totalCost.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">ZAR</p>
                {isFilteredView && kpiData.recentReconciliation && (
                  <div className="flex flex-col gap-1 mt-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Grid Cost:</span>
                      <span>R {(kpiData.recentReconciliation.grid_supply_cost || 0).toLocaleString()}</span>
                    </div>
                    {kpiData.recentReconciliation.revenue_enabled && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Revenue:</span>
                        <span className="text-success">R {(kpiData.recentReconciliation.total_revenue || 0).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
                {!isFilteredView && (
                  <div className="flex items-center gap-1 mt-2 text-sm">
                    <span className="text-muted-foreground">Avg rate:</span>
                    <span className="font-medium">R {kpiData.avgCostPerKwh}/kWh</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Recovery Rate
                </CardTitle>
                <Activity className="w-5 h-5 text-accent" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {kpiData.recoveryRate > 0 ? `${kpiData.recoveryRate.toFixed(1)}%` : "N/A"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {kpiData.recentReconciliation 
                    ? isFilteredView 
                      ? `${format(new Date(kpiData.recentReconciliation.date_from), "dd MMM")} - ${format(new Date(kpiData.recentReconciliation.date_to), "dd MMM yyyy")}`
                      : `As of ${format(new Date(kpiData.recentReconciliation.run_date), "MMM dd, yyyy")}`
                    : "No reconciliation data"}
                </p>
                {kpiData.recoveryRate > 0 && (
                  <Badge variant={kpiData.recoveryRate >= 90 ? "default" : "destructive"} className="mt-2">
                    {kpiData.recoveryRate >= 90 ? <CheckCircle className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}
                    {kpiData.recoveryRate >= 90 ? "Good" : "Needs Attention"}
                  </Badge>
                )}
                {isFilteredView && kpiData.recentReconciliation && (
                  <div className="flex justify-between mt-2 text-sm">
                    <span className="text-muted-foreground">Discrepancy:</span>
                    <span className={Math.abs(kpiData.recentReconciliation.discrepancy) > 1000 ? 'text-destructive' : 'text-success'}>
                      {kpiData.recentReconciliation.discrepancy.toLocaleString()} kWh
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {isFilteredView ? "Meters in Run" : "Active Meters"}
                </CardTitle>
                <Gauge className="w-5 h-5 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{kpiData.activeMeters}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {isFilteredView ? "Meters with data" : "Installed devices"}
                </p>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {kpiData.metersByType.slice(0, 3).map((type, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {type.name}: {type.value}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Consumption Chart */}
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle>{isFilteredView ? "Supply Breakdown" : "Consumption Trend"}</CardTitle>
                <CardDescription>
                  {isFilteredView 
                    ? "Energy supply breakdown for selected period"
                    : "Monthly energy consumption over the last 6 months"
                  }
                </CardDescription>
              </CardHeader>
              <CardContent>
                {kpiData.consumptionTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    {isFilteredView ? (
                      <BarChart data={kpiData.consumptionTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis 
                          dataKey="month" 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                        />
                        <YAxis 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                          tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: "hsl(var(--background))", 
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px"
                          }}
                          formatter={(value: any) => [`${value.toLocaleString()} kWh`, "Supply"]}
                        />
                        <Bar 
                          dataKey="consumption" 
                          fill="hsl(var(--primary))"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    ) : (
                      <LineChart data={kpiData.consumptionTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis 
                          dataKey="month" 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                        />
                        <YAxis 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                          tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: "hsl(var(--background))", 
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px"
                          }}
                          formatter={(value: any) => [`${value.toLocaleString()} kWh`, "Consumption"]}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="consumption" 
                          stroke="hsl(var(--primary))" 
                          strokeWidth={2}
                          dot={{ fill: "hsl(var(--primary))" }}
                        />
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    No consumption data available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cost Chart */}
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle>{isFilteredView ? "Cost Breakdown" : "Cost Trend"}</CardTitle>
                <CardDescription>
                  {isFilteredView 
                    ? "Cost breakdown for selected period"
                    : "Monthly electricity costs over the last 6 months"
                  }
                </CardDescription>
              </CardHeader>
              <CardContent>
                {kpiData.costTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={kpiData.costTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="month" 
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                      />
                      <YAxis 
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickFormatter={(value) => `R${(value / 1000).toFixed(0)}k`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--background))", 
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px"
                        }}
                        formatter={(value: any) => [`R ${value.toLocaleString()}`, "Cost"]}
                      />
                      <Bar 
                        dataKey="cost" 
                        fill="hsl(var(--accent))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    No cost data available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Meter Distribution & Recent Reconciliation */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Meter Distribution */}
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle>Meter Distribution</CardTitle>
                <CardDescription>Breakdown of meters by type</CardDescription>
              </CardHeader>
              <CardContent>
                {kpiData.metersByType.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={kpiData.metersByType}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        outerRadius={100}
                        fill="hsl(var(--primary))"
                        dataKey="value"
                      >
                        {kpiData.metersByType.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--background))", 
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px"
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    No meter data available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Reconciliation Details */}
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle>{isFilteredView ? "Period Details" : "Recent Reconciliation"}</CardTitle>
                <CardDescription>
                  {isFilteredView ? "Selected reconciliation period summary" : "Latest reconciliation summary"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {kpiData.recentReconciliation ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b">
                      <span className="text-sm font-medium">Run Name</span>
                      <span className="text-sm text-muted-foreground">{kpiData.recentReconciliation.run_name}</span>
                    </div>
                    <div className="flex items-center justify-between pb-2 border-b">
                      <span className="text-sm font-medium">Date Range</span>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(kpiData.recentReconciliation.date_from), "MMM dd")} - {format(new Date(kpiData.recentReconciliation.date_to), "MMM dd, yyyy")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pb-2 border-b">
                      <span className="text-sm font-medium">Total Supply</span>
                      <span className="text-sm font-bold">{kpiData.recentReconciliation.total_supply.toLocaleString()} kWh</span>
                    </div>
                    <div className="flex items-center justify-between pb-2 border-b">
                      <span className="text-sm font-medium">Bulk Supply</span>
                      <span className="text-sm">{kpiData.recentReconciliation.bulk_total.toLocaleString()} kWh</span>
                    </div>
                    <div className="flex items-center justify-between pb-2 border-b">
                      <span className="text-sm font-medium">Tenant Recovery</span>
                      <span className="text-sm">{kpiData.recentReconciliation.tenant_total.toLocaleString()} kWh</span>
                    </div>
                    <div className="flex items-center justify-between pb-2 border-b">
                      <span className="text-sm font-medium">Discrepancy</span>
                      <span className={`text-sm font-medium ${Math.abs(kpiData.recentReconciliation.discrepancy) > 1000 ? 'text-destructive' : 'text-success'}`}>
                        {kpiData.recentReconciliation.discrepancy.toLocaleString()} kWh
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-sm font-medium">Recovery Rate</span>
                      <Badge variant={kpiData.recentReconciliation.recovery_rate >= 90 ? "default" : "destructive"}>
                        {kpiData.recentReconciliation.recovery_rate.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-[300px] text-center">
                    <AlertCircle className="w-12 h-12 text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">No reconciliation data available</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Run a reconciliation to see energy balance data
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
