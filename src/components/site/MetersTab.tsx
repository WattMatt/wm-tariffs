import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Gauge } from "lucide-react";
import { toast } from "sonner";

interface Meter {
  id: string;
  meter_number: string;
  meter_type: string;
  location: string | null;
  tariff: string | null;
  is_revenue_critical: boolean;
  created_at: string;
}

interface MetersTabProps {
  siteId: string;
}

export default function MetersTab({ siteId }: MetersTabProps) {
  const [meters, setMeters] = useState<Meter[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevenueCritical, setIsRevenueCritical] = useState(false);

  useEffect(() => {
    fetchMeters();
  }, [siteId]);

  const fetchMeters = async () => {
    const { data, error } = await supabase
      .from("meters")
      .select("*")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch meters");
    } else {
      setMeters(data || []);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);

    const { error } = await supabase.from("meters").insert({
      site_id: siteId,
      meter_number: formData.get("meter_number") as string,
      meter_type: formData.get("meter_type") as string,
      location: formData.get("location") as string,
      tariff: formData.get("tariff") as string,
      is_revenue_critical: isRevenueCritical,
    });

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Meter created successfully");
      setIsDialogOpen(false);
      setIsRevenueCritical(false);
      fetchMeters();
    }
  };

  const getMeterTypeColor = (type: string) => {
    switch (type) {
      case "council_bulk":
        return "bg-primary text-primary-foreground";
      case "check_meter":
        return "bg-warning text-warning-foreground";
      case "distribution":
        return "bg-accent text-accent-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getMeterTypeLabel = (type: string) => {
    switch (type) {
      case "council_bulk":
        return "Council Bulk";
      case "check_meter":
        return "Check Meter";
      case "distribution":
        return "Distribution";
      default:
        return type;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Meters</h2>
          <p className="text-muted-foreground">Manage meters for this site</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Add Meter
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Meter</DialogTitle>
              <DialogDescription>Register a new electrical meter</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="meter_number">Meter Number</Label>
                <Input id="meter_number" name="meter_number" required placeholder="MTR-12345" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meter_type">Meter Type</Label>
                <Select name="meter_type" required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="council_bulk">Council Bulk Supply</SelectItem>
                    <SelectItem value="check_meter">Check Meter</SelectItem>
                    <SelectItem value="distribution">Distribution Meter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input id="location" name="location" placeholder="Building A, Floor 2" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tariff">Tariff</Label>
                <Input id="tariff" name="tariff" placeholder="Business Standard" />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="revenue_critical"
                  checked={isRevenueCritical}
                  onCheckedChange={(checked) => setIsRevenueCritical(checked as boolean)}
                />
                <Label htmlFor="revenue_critical" className="cursor-pointer">
                  Mark as revenue critical
                </Label>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creating..." : "Create Meter"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {meters.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Gauge className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No meters yet</h3>
            <p className="text-muted-foreground mb-4">Register your first meter for this site</p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Meter
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Site Meters</CardTitle>
            <CardDescription>
              {meters.length} meter{meters.length !== 1 ? "s" : ""} registered
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Meter Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Tariff</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meters.map((meter) => (
                  <TableRow key={meter.id}>
                    <TableCell className="font-mono font-medium">{meter.meter_number}</TableCell>
                    <TableCell>
                      <Badge className={getMeterTypeColor(meter.meter_type)}>
                        {getMeterTypeLabel(meter.meter_type)}
                      </Badge>
                    </TableCell>
                    <TableCell>{meter.location || "—"}</TableCell>
                    <TableCell>{meter.tariff || "—"}</TableCell>
                    <TableCell>
                      {meter.is_revenue_critical && (
                        <Badge variant="outline" className="text-destructive border-destructive">
                          Critical
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
