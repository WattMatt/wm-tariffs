import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const CHARGE_TYPES = [
  { value: "basicCharge", label: "Basic Charge", unit: "R/month" },
  { value: "energyLowSeason", label: "Energy Charge - Low Season", unit: "c/kWh" },
  { value: "energyHighSeason", label: "Energy Charge - High Season", unit: "c/kWh" },
  { value: "demandLowSeason", label: "Demand Charge - Low Season", unit: "R/kVA" },
  { value: "demandHighSeason", label: "Demand Charge - High Season", unit: "R/kVA" },
];

const chartConfig = {
  value: { label: "Value", color: "hsl(220 14% 65%)" }, // Grey bar color from reference
};

export default function TariffPeriodComparisonDialog({
  open,
  onOpenChange,
  groupName,
  tariffStructures,
}: TariffPeriodComparisonDialogProps) {
  const [comparisonData, setComparisonData] = useState<ComparisonData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChargeType, setSelectedChargeType] = useState<string>("basicCharge");

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

  const selectedType = CHARGE_TYPES.find(t => t.value === selectedChargeType);
  const chartData = comparisonData.map(d => ({
    period: d.period,
    value: d[selectedChargeType as keyof ComparisonData] as number | undefined
  }));
  
  const hasData = chartData.some((d) => d.value !== undefined);
  const change = calculateChange(selectedChargeType as keyof ComparisonData);

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
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <DialogTitle>Tariff Period Comparison: {groupName}</DialogTitle>
              <DialogDescription>
                Comparing {tariffStructures.length} period{tariffStructures.length !== 1 ? "s" : ""}
              </DialogDescription>
            </div>
            <Select value={selectedChargeType} onValueChange={setSelectedChargeType}>
              <SelectTrigger className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHARGE_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center h-[400px] text-muted-foreground">
            Loading comparison data...
          </div>
        ) : (
          <div className="py-4">
            {hasData ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{selectedType?.label}</CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    {selectedType?.unit}
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
                  <ChartContainer config={chartConfig} className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="period"
                          tick={{ fontSize: 12 }}
                          className="text-muted-foreground"
                        />
                        <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
                        <ChartTooltip
                          content={<ChartTooltipContent />}
                          formatter={(value: number) => [
                            value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                            selectedType?.label
                          ]}
                        />
                        <Bar dataKey="value" fill={chartConfig.value.color} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="flex items-center justify-center h-[400px] text-muted-foreground">
                  No data available for {selectedType?.label}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
