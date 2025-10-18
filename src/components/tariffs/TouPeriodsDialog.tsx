import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";

interface TouPeriodsDialogProps {
  tariffId: string;
  onClose: () => void;
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

export default function TouPeriodsDialog({ tariffId, onClose }: TouPeriodsDialogProps) {
  const [periods, setPeriods] = useState<TouPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    fetchPeriods();
  }, [tariffId]);

  const fetchPeriods = async () => {
    const { data, error } = await supabase
      .from("tariff_time_periods")
      .select("*")
      .eq("tariff_structure_id", tariffId)
      .order("season")
      .order("day_type")
      .order("start_hour");

    if (error) {
      toast.error("Failed to fetch TOU periods");
    } else {
      setPeriods(data || []);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);

    const { error } = await supabase.from("tariff_time_periods").insert({
      tariff_structure_id: tariffId,
      period_type: formData.get("period_type") as string,
      season: formData.get("season") as string,
      day_type: formData.get("day_type") as string,
      start_hour: parseInt(formData.get("start_hour") as string),
      end_hour: parseInt(formData.get("end_hour") as string),
      energy_charge_cents: parseFloat(formData.get("energy_charge_cents") as string),
    });

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("TOU period added");
      setIsAdding(false);
      fetchPeriods();
      (e.target as HTMLFormElement).reset();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("tariff_time_periods")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete period");
    } else {
      toast.success("Period deleted");
      fetchPeriods();
    }
  };

  const getPeriodTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      peak: "bg-destructive/10 text-destructive",
      standard: "bg-warning/10 text-warning",
      off_peak: "bg-accent/10 text-accent",
    };
    return colors[type] || "";
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Time-of-Use Periods</DialogTitle>
          <DialogDescription>
            Configure peak, standard, and off-peak periods for this tariff
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isAdding ? (
            <Button onClick={() => setIsAdding(true)} className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add TOU Period
            </Button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="period_type">Period Type</Label>
                  <Select name="period_type" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="peak">Peak</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="off_peak">Off-Peak</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="season">Season</Label>
                  <Select name="season" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select season" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_year">All Year</SelectItem>
                      <SelectItem value="high_demand">High-Demand (June-Aug)</SelectItem>
                      <SelectItem value="low_demand">Low-Demand (Sep-May)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="day_type">Day Type</Label>
                  <Select name="day_type" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select day type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_days">All Days</SelectItem>
                      <SelectItem value="weekday">Weekdays</SelectItem>
                      <SelectItem value="saturday">Saturday</SelectItem>
                      <SelectItem value="sunday">Sunday</SelectItem>
                      <SelectItem value="weekend">Weekend</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="energy_charge_cents">Energy Charge (cents/kWh)</Label>
                  <Input
                    id="energy_charge_cents"
                    name="energy_charge_cents"
                    type="number"
                    step="0.01"
                    required
                    placeholder="150.50"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="start_hour">Start Hour (0-23)</Label>
                  <Input
                    id="start_hour"
                    name="start_hour"
                    type="number"
                    min="0"
                    max="23"
                    required
                    placeholder="7"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end_hour">End Hour (0-23)</Label>
                  <Input
                    id="end_hour"
                    name="end_hour"
                    type="number"
                    min="0"
                    max="23"
                    required
                    placeholder="10"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? "Adding..." : "Add Period"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setIsAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {periods.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No TOU periods configured yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Season</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Rate (c/kWh)</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => (
                  <TableRow key={period.id}>
                    <TableCell>
                      <Badge className={getPeriodTypeBadge(period.period_type)}>
                        {period.period_type.replace("_", "-")}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">
                      {period.season.replace("_", " ")}
                    </TableCell>
                    <TableCell className="capitalize">
                      {period.day_type.replace("_", " ")}
                    </TableCell>
                    <TableCell>
                      {String(period.start_hour).padStart(2, "0")}:00 -{" "}
                      {String(period.end_hour).padStart(2, "0")}:00
                    </TableCell>
                    <TableCell>{period.energy_charge_cents}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(period.id)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
