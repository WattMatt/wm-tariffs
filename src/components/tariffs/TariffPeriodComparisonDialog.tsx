import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface TariffStructure {
  id: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
}

interface TariffCharge {
  id: string;
  tariff_structure_id: string;
  charge_type: string;
  charge_amount: number;
  unit: string;
  description: string | null;
}

interface ComparisonData {
  period: string;
  basicCharge?: number;
  energyLowSeason?: number;
  energyHighSeason?: number;
  demandLowSeason?: number;
  demandHighSeason?: number;
}

interface TariffPeriodComparisonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  tariffStructures: TariffStructure[];
}

const chartConfig = {
  basicCharge: { label: "Basic Charge", color: "hsl(var(--chart-1))" },
  energyLowSeason: { label: "Energy (Low Season)", color: "hsl(var(--chart-2))" },
  energyHighSeason: { label: "Energy (High Season)", color: "hsl(var(--chart-3))" },
  demandLowSeason: { label: "Demand (Low Season)", color: "hsl(var(--chart-4))" },
  demandHighSeason: { label: "Demand (High Season)", color: "hsl(var(--chart-5))" },
};

export default function TariffPeriodComparisonDialog({
  open,
  onOpenChange,
  groupName,
  tariffStructures,
}: TariffPeriodComparisonDialogProps) {
  const [comparisonData, setComparisonData] = useState<ComparisonData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && tariffStructures.length > 0) {
      fetchChargesData();
    }
  }, [open, tariffStructures]);

  const fetchChargesData = async () => {
    setLoading(true);
    const structureIds = tariffStructures.map((s) => s.id);

    const { data: charges } = await supabase
      .from("tariff_charges")
      .select("*")
      .in("tariff_structure_id", structureIds);

    if (charges) {
      const processed = processComparisonData(charges);
      setComparisonData(processed);
    }
    setLoading(false);
  };

  const processComparisonData = (charges: TariffCharge[]): ComparisonData[] => {
    const sorted = [...tariffStructures].sort(
      (a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime()
    );

    return sorted.map((structure) => {
      const periodLabel = `${format(new Date(structure.effective_from), "MMM yyyy")} - ${
        structure.effective_to ? format(new Date(structure.effective_to), "MMM yyyy") : "Present"
      }`;

      const structureCharges = charges.filter((c) => c.tariff_structure_id === structure.id);

      return {
        period: periodLabel,
        basicCharge: structureCharges.find((c) => c.charge_type === "basic_charge")?.charge_amount,
        energyLowSeason: structureCharges.find((c) => c.charge_type === "energy_low_season")?.charge_amount,
        energyHighSeason: structureCharges.find((c) => c.charge_type === "energy_high_season")?.charge_amount,
        demandLowSeason: structureCharges.find((c) => c.charge_type === "demand_low_season")?.charge_amount,
        demandHighSeason: structureCharges.find((c) => c.charge_type === "demand_high_season")?.charge_amount,
      };
    });
  };

  const calculateChange = (dataKey: keyof ComparisonData) => {
    if (comparisonData.length < 2) return null;
    const firstValue = comparisonData[0][dataKey] as number | undefined;
    const lastValue = comparisonData[comparisonData.length - 1][dataKey] as number | undefined;

    if (!firstValue || !lastValue) return null;

    const percentChange = ((lastValue - firstValue) / firstValue) * 100;
    return { percentChange, isIncrease: percentChange > 0, isZero: percentChange === 0 };
  };

  const renderChart = (
    title: string,
    dataKey: keyof ComparisonData,
    unit: string,
    color: string
  ) => {
    const hasData = comparisonData.some((d) => d[dataKey] !== undefined);
    const change = calculateChange(dataKey);

    if (!hasData) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{unit}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center h-[250px] text-muted-foreground">
            No data available for this charge type
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="flex items-center gap-2">
            {unit}
            {change && !change.isZero && (
              <span className="flex items-center gap-1 text-sm font-medium">
                {change.isIncrease ? (
                  <TrendingUp className="h-4 w-4 text-destructive" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-green-600" />
                )}
                <span className={change.isIncrease ? "text-destructive" : "text-green-600"}>
                  {change.isIncrease ? "+" : ""}
                  {change.percentChange.toFixed(1)}%
                </span>
              </span>
            )}
            {change?.isZero && (
              <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                <Minus className="h-4 w-4" />
                No change
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                />
                <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
                <ChartTooltip
                  content={<ChartTooltipContent />}
                  formatter={(value: number) => [value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), title]}
                />
                <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    );
  };

  if (tariffStructures.length < 2) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Tariff Period Comparison</DialogTitle>
            <DialogDescription>Need at least 2 periods to compare</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tariff Period Comparison: {groupName}</DialogTitle>
          <DialogDescription>
            Comparing {tariffStructures.length} period{tariffStructures.length !== 1 ? "s" : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center h-[400px] text-muted-foreground">
            Loading comparison data...
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {renderChart("Basic Charge", "basicCharge", "R/month", chartConfig.basicCharge.color)}
            {renderChart("Energy Charge - Low Season", "energyLowSeason", "c/kWh", chartConfig.energyLowSeason.color)}
            {renderChart("Energy Charge - High Season", "energyHighSeason", "c/kWh", chartConfig.energyHighSeason.color)}
            {renderChart("Demand Charge - Low Season", "demandLowSeason", "R/kVA", chartConfig.demandLowSeason.color)}
            {renderChart("Demand Charge - High Season", "demandHighSeason", "R/kVA", chartConfig.demandHighSeason.color)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
