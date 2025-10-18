import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface TariffDetailsDialogProps {
  tariffId: string;
  tariffName: string;
  onClose: () => void;
}

interface TariffBlock {
  id: string;
  block_number: number;
  kwh_from: number;
  kwh_to: number | null;
  energy_charge_cents: number;
}

interface TariffCharge {
  id: string;
  charge_type: string;
  charge_amount: number;
  description: string;
  unit: string;
}

interface TouPeriod {
  id: string;
  period_type: string;
  season: string;
  day_type: string;
  start_hour: number;
  end_hour: number;
  energy_charge_cents: number;
}

export default function TariffDetailsDialog({ tariffId, tariffName, onClose }: TariffDetailsDialogProps) {
  const [blocks, setBlocks] = useState<TariffBlock[]>([]);
  const [charges, setCharges] = useState<TariffCharge[]>([]);
  const [touPeriods, setTouPeriods] = useState<TouPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchTariffDetails();
  }, [tariffId]);

  const fetchTariffDetails = async () => {
    setIsLoading(true);

    const [blocksResult, chargesResult, touResult] = await Promise.all([
      supabase
        .from("tariff_blocks")
        .select("*")
        .eq("tariff_structure_id", tariffId)
        .order("block_number", { ascending: true }),
      supabase
        .from("tariff_charges")
        .select("*")
        .eq("tariff_structure_id", tariffId),
      supabase
        .from("tariff_time_periods")
        .select("*")
        .eq("tariff_structure_id", tariffId)
        .order("season", { ascending: true })
        .order("period_type", { ascending: true }),
    ]);

    if (blocksResult.error) toast.error("Failed to fetch blocks");
    if (chargesResult.error) toast.error("Failed to fetch charges");
    if (touResult.error) toast.error("Failed to fetch TOU periods");

    setBlocks(blocksResult.data || []);
    setCharges(chargesResult.data || []);
    setTouPeriods(touResult.data || []);
    setIsLoading(false);
  };

  const formatCurrency = (cents: number) => {
    return `R${(cents / 100).toFixed(2)}`;
  };

  const formatCents = (cents: number) => {
    return `${cents.toFixed(2)}c`;
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tariffName}</DialogTitle>
          <DialogDescription>Complete tariff structure details</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="blocks" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="blocks">
                Blocks ({blocks.length})
              </TabsTrigger>
              <TabsTrigger value="charges">
                Charges ({charges.length})
              </TabsTrigger>
              <TabsTrigger value="tou">
                TOU Periods ({touPeriods.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="blocks" className="space-y-4">
              {blocks.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No tariff blocks configured
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Energy Blocks</CardTitle>
                    <CardDescription>Stepped tariff pricing by consumption</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-24">Block</TableHead>
                          <TableHead>kWh From</TableHead>
                          <TableHead>kWh To</TableHead>
                          <TableHead className="text-right">Rate (c/kWh)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {blocks.map((block) => (
                          <TableRow key={block.id}>
                            <TableCell>
                              <Badge variant="outline">Block {block.block_number}</Badge>
                            </TableCell>
                            <TableCell className="font-mono">{block.kwh_from}</TableCell>
                            <TableCell className="font-mono">
                              {block.kwh_to === null ? "Unlimited" : block.kwh_to}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatCents(block.energy_charge_cents)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="charges" className="space-y-4">
              {charges.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No additional charges configured
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Additional Charges</CardTitle>
                    <CardDescription>Fixed and demand-based charges</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Charge Type</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Unit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {charges.map((charge) => (
                          <TableRow key={charge.id}>
                            <TableCell>
                              <Badge variant="secondary" className="capitalize">
                                {charge.charge_type.replace(/_/g, " ")}
                              </Badge>
                            </TableCell>
                            <TableCell>{charge.description}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatCurrency(charge.charge_amount)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{charge.unit}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="tou" className="space-y-4">
              {touPeriods.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No Time-of-Use periods configured
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Time-of-Use Periods</CardTitle>
                    <CardDescription>Variable pricing by time and season</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Period</TableHead>
                          <TableHead>Season</TableHead>
                          <TableHead>Day Type</TableHead>
                          <TableHead>Hours</TableHead>
                          <TableHead className="text-right">Rate (c/kWh)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {touPeriods.map((period) => (
                          <TableRow key={period.id}>
                            <TableCell>
                              <Badge className="capitalize">{period.period_type}</Badge>
                            </TableCell>
                            <TableCell className="capitalize">{period.season}</TableCell>
                            <TableCell className="capitalize">{period.day_type}</TableCell>
                            <TableCell className="font-mono">
                              {String(period.start_hour).padStart(2, "0")}:00 - {String(period.end_hour).padStart(2, "0")}:00
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatCents(period.energy_charge_cents)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
