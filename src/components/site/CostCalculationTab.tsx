import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { CalendarIcon, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface CostCalculationTabProps {
  siteId: string;
}

interface TariffStructure {
  id: string;
  name: string;
  tariff_type: string;
  supply_authorities: { name: string } | null;
}

export default function CostCalculationTab({ siteId }: CostCalculationTabProps) {
  const [tariffStructures, setTariffStructures] = useState<TariffStructure[]>([]);
  const [selectedTariff, setSelectedTariff] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [costData, setCostData] = useState<any>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  useEffect(() => {
    fetchTariffStructures();
  }, []);

  const fetchTariffStructures = async () => {
    const { data } = await supabase
      .from("tariff_structures")
      .select("id, name, tariff_type, supply_authorities(name)")
      .eq("active", true)
      .order("name");

    setTariffStructures(data || []);
  };

  const handleCalculate = async () => {
    if (!selectedTariff || !dateFrom || !dateTo) {
      toast.error("Please select tariff and date range");
      return;
    }

    setIsCalculating(true);

    try {
      // Fetch meter readings for the site
      const { data: meters } = await supabase
        .from("meters")
        .select("id, meter_number")
        .eq("site_id", siteId);

      if (!meters || meters.length === 0) {
        toast.error("No meters found for this site");
        setIsCalculating(false);
        return;
      }

      // Fetch readings for date range
      const readingsPromises = meters.map((meter) =>
        supabase
          .from("meter_readings")
          .select("kwh_value")
          .eq("meter_id", meter.id)
          .gte("reading_timestamp", dateFrom.toISOString())
          .lte("reading_timestamp", dateTo.toISOString())
      );

      const readingsResults = await Promise.all(readingsPromises);
      const totalKwh = readingsResults.reduce((sum, result) => {
        const meterTotal = result.data?.reduce((s, r) => s + Number(r.kwh_value), 0) || 0;
        return sum + meterTotal;
      }, 0);

      // Fetch tariff structure details
      const { data: tariff } = await supabase
        .from("tariff_structures")
        .select("*, tariff_blocks(*), tariff_charges(*)")
        .eq("id", selectedTariff)
        .single();

      // Calculate costs based on blocks
      let energyCost = 0;
      let remainingKwh = totalKwh;

      if (tariff?.tariff_blocks && tariff.tariff_blocks.length > 0) {
        const sortedBlocks = tariff.tariff_blocks.sort((a: any, b: any) => a.block_number - b.block_number);
        
        for (const block of sortedBlocks) {
          const blockSize = block.kwh_to ? block.kwh_to - block.kwh_from : Infinity;
          const kwhInBlock = Math.min(remainingKwh, blockSize);
          
          if (kwhInBlock > 0) {
            energyCost += (kwhInBlock * block.energy_charge_cents) / 100;
            remainingKwh -= kwhInBlock;
          }
          
          if (remainingKwh <= 0) break;
        }
      }

      // Add fixed charges
      let fixedCharges = 0;
      if (tariff?.tariff_charges) {
        fixedCharges = tariff.tariff_charges.reduce((sum: number, charge: any) => {
          if (charge.charge_type === "basic_monthly") {
            return sum + Number(charge.charge_amount);
          }
          return sum;
        }, 0);
      }

      const totalCost = energyCost + fixedCharges;
      const avgCostPerKwh = totalKwh > 0 ? totalCost / totalKwh : 0;

      setCostData({
        totalKwh,
        energyCost,
        fixedCharges,
        totalCost,
        avgCostPerKwh,
        tariffName: tariff?.name,
      });

      toast.success("Cost calculation complete");
    } catch (error: any) {
      toast.error(`Calculation failed: ${error.message}`);
    } finally {
      setIsCalculating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Cost Calculation</h2>
        <p className="text-muted-foreground">
          Calculate costs based on NERSA tariff structures
        </p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>Calculation Parameters</CardTitle>
          <CardDescription>Select tariff structure and date range</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Tariff Structure</Label>
              <Select value={selectedTariff} onValueChange={setSelectedTariff}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tariff" />
                </SelectTrigger>
                <SelectContent>
                  {tariffStructures.map((tariff) => (
                    <SelectItem key={tariff.id} value={tariff.id}>
                      {tariff.name} ({tariff.supply_authorities?.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>From Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>To Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal", !dateTo && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? format(dateTo, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={dateTo} onSelect={setDateTo} />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <Button onClick={handleCalculate} disabled={isCalculating} className="w-full">
            {isCalculating ? "Calculating..." : "Calculate Costs"}
          </Button>
        </CardContent>
      </Card>

      {costData && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Consumption
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{costData.totalKwh.toFixed(2)} kWh</div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Energy Cost
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">
                  R {costData.energyCost.toFixed(2)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Fixed Charges
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-accent">
                  R {costData.fixedCharges.toFixed(2)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Cost
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  R {costData.totalCost.toFixed(2)}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Cost Breakdown</CardTitle>
              <CardDescription>Applied tariff: {costData.tariffName}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Average Cost per kWh</p>
                  <p className="text-lg font-semibold">R {costData.avgCostPerKwh.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Calculation Period</p>
                  <p className="text-lg font-semibold">
                    {dateFrom && dateTo
                      ? `${format(dateFrom, "dd MMM")} - ${format(dateTo, "dd MMM yyyy")}`
                      : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!costData && (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <DollarSign className="w-16 h-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Select parameters and calculate costs to see results
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
