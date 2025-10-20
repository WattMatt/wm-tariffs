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
import { Plus, Gauge, Upload, Pencil, Trash2, Database, Eye } from "lucide-react";
import { toast } from "sonner";
import CsvImportDialog from "./CsvImportDialog";
import MeterReadingsView from "./MeterReadingsView";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Meter {
  id: string;
  meter_number: string;
  meter_type: string;
  name: string | null;
  location: string | null;
  area: number | null;
  rating: string | null;
  cable_specification: string | null;
  serial_number: string | null;
  ct_type: string | null;
  tariff: string | null;
  is_revenue_critical: boolean;
  created_at: string;
  has_readings?: boolean;
}

interface MetersTabProps {
  siteId: string;
}

export default function MetersTab({ siteId }: MetersTabProps) {
  const [meters, setMeters] = useState<Meter[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevenueCritical, setIsRevenueCritical] = useState(false);
  const [csvImportMeterId, setCsvImportMeterId] = useState<string | null>(null);
  const [isCsvDialogOpen, setIsCsvDialogOpen] = useState(false);
  const [viewReadingsMeterId, setViewReadingsMeterId] = useState<string | null>(null);
  const [viewReadingsMeterNumber, setViewReadingsMeterNumber] = useState<string>("");
  const [isReadingsViewOpen, setIsReadingsViewOpen] = useState(false);
  const [editingMeter, setEditingMeter] = useState<Meter | null>(null);
  const [deletingMeterId, setDeletingMeterId] = useState<string | null>(null);

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
      // Check which meters have readings
      const metersWithReadingStatus = await Promise.all(
        (data || []).map(async (meter) => {
          const { count } = await supabase
            .from("meter_readings")
            .select("*", { count: "exact", head: true })
            .eq("meter_id", meter.id);
          
          return {
            ...meter,
            has_readings: (count ?? 0) > 0
          };
        })
      );
      
      setMeters(metersWithReadingStatus);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const meterData = {
      meter_number: formData.get("meter_number") as string,
      meter_type: formData.get("meter_type") as string,
      name: formData.get("name") as string,
      location: formData.get("location") as string,
      area: formData.get("area") ? parseFloat(formData.get("area") as string) : null,
      rating: formData.get("rating") as string,
      cable_specification: formData.get("cable_specification") as string,
      serial_number: formData.get("serial_number") as string,
      ct_type: formData.get("ct_type") as string,
      tariff: formData.get("tariff") as string,
      is_revenue_critical: isRevenueCritical,
    };

    let error;
    if (editingMeter) {
      const { error: updateError } = await supabase
        .from("meters")
        .update(meterData)
        .eq("id", editingMeter.id);
      error = updateError;
    } else {
      const { error: insertError } = await supabase
        .from("meters")
        .insert({ ...meterData, site_id: siteId });
      error = insertError;
    }

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(editingMeter ? "Meter updated successfully" : "Meter created successfully");
      setIsDialogOpen(false);
      setEditingMeter(null);
      setIsRevenueCritical(false);
      fetchMeters();
    }
  };

  const handleEdit = (meter: Meter) => {
    setEditingMeter(meter);
    setIsRevenueCritical(meter.is_revenue_critical);
    setIsDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingMeterId) return;

    const { error } = await supabase
      .from("meters")
      .delete()
      .eq("id", deletingMeterId);

    if (error) {
      toast.error("Failed to delete meter");
    } else {
      toast.success("Meter deleted successfully");
      fetchMeters();
    }
    setDeletingMeterId(null);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingMeter(null);
    setIsRevenueCritical(false);
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
        <Dialog open={isDialogOpen} onOpenChange={handleCloseDialog}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Add Meter
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingMeter ? "Edit Meter" : "Add New Meter"}</DialogTitle>
              <DialogDescription>
                {editingMeter ? "Update meter details" : "Register a new electrical meter with all required details"}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="meter_number">NO (Meter Number) *</Label>
                  <Input 
                    id="meter_number" 
                    name="meter_number" 
                    required 
                    placeholder="DB-03"
                    defaultValue={editingMeter?.meter_number}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">NAME *</Label>
                  <Input 
                    id="name" 
                    name="name" 
                    required 
                    placeholder="ACKERMANS"
                    defaultValue={editingMeter?.name || ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="area">AREA (m²) *</Label>
                  <Input 
                    id="area" 
                    name="area" 
                    type="number" 
                    step="0.01" 
                    required 
                    placeholder="406"
                    defaultValue={editingMeter?.area || ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rating">RATING *</Label>
                  <Input 
                    id="rating" 
                    name="rating" 
                    required 
                    placeholder="100A TP"
                    defaultValue={editingMeter?.rating || ""}
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label htmlFor="cable_specification">CABLE *</Label>
                  <Input 
                    id="cable_specification" 
                    name="cable_specification" 
                    required 
                    placeholder="4C x 50mm² ALU ECC CABLE"
                    defaultValue={editingMeter?.cable_specification || ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="serial_number">SERIAL *</Label>
                  <Input 
                    id="serial_number" 
                    name="serial_number" 
                    required 
                    placeholder="35777285"
                    defaultValue={editingMeter?.serial_number || ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ct_type">CT *</Label>
                  <Input 
                    id="ct_type" 
                    name="ct_type" 
                    required 
                    placeholder="DOL"
                    defaultValue={editingMeter?.ct_type || ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="meter_type">Meter Type *</Label>
                  <Select name="meter_type" required defaultValue={editingMeter?.meter_type}>
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
                  <Input 
                    id="location" 
                    name="location" 
                    placeholder="Building A, Floor 2"
                    defaultValue={editingMeter?.location || ""}
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label htmlFor="tariff">Tariff</Label>
                  <Input 
                    id="tariff" 
                    name="tariff" 
                    placeholder="Business Standard"
                    defaultValue={editingMeter?.tariff || ""}
                  />
                </div>
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
                {isLoading ? (editingMeter ? "Updating..." : "Creating...") : (editingMeter ? "Update Meter" : "Create Meter")}
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
                  <TableHead>NO</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Serial</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meters.map((meter) => (
                  <TableRow key={meter.id}>
                    <TableCell className="font-mono font-medium">{meter.meter_number}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{meter.name || "—"}</p>
                        {meter.location && (
                          <p className="text-xs text-muted-foreground">{meter.location}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getMeterTypeColor(meter.meter_type)}>
                        {getMeterTypeLabel(meter.meter_type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {meter.area ? `${meter.area}m²` : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {meter.rating || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {meter.serial_number || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {meter.is_revenue_critical && (
                          <Badge variant="outline" className="text-destructive border-destructive">
                            Critical
                          </Badge>
                        )}
                        {meter.has_readings && (
                          <Badge variant="outline" className="gap-1">
                            <Database className="w-3 h-3" />
                            Data
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(meter)}
                          title="Edit meter"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingMeterId(meter.id)}
                          title="Delete meter"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setCsvImportMeterId(meter.id);
                            setIsCsvDialogOpen(true);
                          }}
                          title="Upload CSV data"
                        >
                          <Upload className="w-4 h-4" />
                        </Button>
                        {meter.has_readings && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setViewReadingsMeterId(meter.id);
                              setViewReadingsMeterNumber(meter.meter_number);
                              setIsReadingsViewOpen(true);
                            }}
                            title="View uploaded data"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CsvImportDialog
        isOpen={isCsvDialogOpen}
        onClose={() => {
          setIsCsvDialogOpen(false);
          setCsvImportMeterId(null);
        }}
        meterId={csvImportMeterId || ""}
        onImportComplete={() => {
          fetchMeters();
        }}
      />

      <MeterReadingsView
        isOpen={isReadingsViewOpen}
        onClose={() => {
          setIsReadingsViewOpen(false);
          setViewReadingsMeterId(null);
          setViewReadingsMeterNumber("");
        }}
        meterId={viewReadingsMeterId || ""}
        meterNumber={viewReadingsMeterNumber}
      />

      <AlertDialog open={!!deletingMeterId} onOpenChange={() => setDeletingMeterId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Meter</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this meter? This action cannot be undone and will also delete all associated readings and connections.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
