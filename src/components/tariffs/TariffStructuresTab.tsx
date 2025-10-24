import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { Plus, FileText, Clock, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import TouPeriodsDialog from "./TouPeriodsDialog";
import TariffDetailsDialog from "./TariffDetailsDialog";

interface TariffStructure {
  id: string;
  name: string;
  tariff_type: string;
  meter_configuration: string | null;
  effective_from: string;
  active: boolean;
  uses_tou: boolean;
  tou_type: string | null;
  supply_authorities: {
    name: string;
  } | null;
}

interface SupplyAuthority {
  id: string;
  name: string;
}

interface TariffStructuresTabProps {
  supplyAuthorityId: string;
  supplyAuthorityName: string;
}

interface TariffStructuresTabProps {
  supplyAuthorityId: string;
  supplyAuthorityName: string;
}

export default function TariffStructuresTab({ supplyAuthorityId, supplyAuthorityName }: TariffStructuresTabProps) {
  const [structures, setStructures] = useState<TariffStructure[]>([]);
  const [selectedTariffs, setSelectedTariffs] = useState<Set<string>>(new Set());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [usesTou, setUsesTou] = useState(false);
  const [selectedTariffForTou, setSelectedTariffForTou] = useState<string | null>(null);
  const [selectedTariffForDetails, setSelectedTariffForDetails] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (supplyAuthorityId) {
      fetchStructures();
    }
  }, [supplyAuthorityId]);

  const fetchStructures = async () => {
    const { data, error } = await supabase
      .from("tariff_structures")
      .select("*, supply_authorities(name)")
      .eq("supply_authority_id", supplyAuthorityId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch tariff structures");
    } else {
      setStructures(data || []);
      setSelectedTariffs(new Set()); // Clear selection when refreshing
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedTariffs(new Set(structures.map(s => s.id)));
    } else {
      setSelectedTariffs(new Set());
    }
  };

  const handleSelectTariff = (tariffId: string, checked: boolean) => {
    const newSelection = new Set(selectedTariffs);
    if (checked) {
      newSelection.add(tariffId);
    } else {
      newSelection.delete(tariffId);
    }
    setSelectedTariffs(newSelection);
  };

  const handleDeleteSelected = async () => {
    if (selectedTariffs.size === 0) return;

    setIsDeleting(true);
    
    try {
      // Delete associated data first (blocks, charges, periods)
      const tariffIds = Array.from(selectedTariffs);
      
      // Delete tariff blocks
      const { error: blocksError } = await supabase
        .from("tariff_blocks")
        .delete()
        .in("tariff_structure_id", tariffIds);
      
      if (blocksError) throw blocksError;
      
      // Delete tariff charges
      const { error: chargesError } = await supabase
        .from("tariff_charges")
        .delete()
        .in("tariff_structure_id", tariffIds);
      
      if (chargesError) throw chargesError;
      
      // Delete tariff time periods
      const { error: periodsError } = await supabase
        .from("tariff_time_periods")
        .delete()
        .in("tariff_structure_id", tariffIds);
      
      if (periodsError) throw periodsError;
      
      // Finally delete the tariff structures themselves
      const { error: structuresError } = await supabase
        .from("tariff_structures")
        .delete()
        .in("id", tariffIds);
      
      if (structuresError) throw structuresError;
      
      toast.success(`Deleted ${selectedTariffs.size} tariff${selectedTariffs.size > 1 ? 's' : ''}`);
      setSelectedTariffs(new Set());
      fetchStructures();
    } catch (error: any) {
      toast.error(`Failed to delete tariffs: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);

    const { error } = await supabase.from("tariff_structures").insert({
      supply_authority_id: supplyAuthorityId,
      name: formData.get("name") as string,
      tariff_type: formData.get("type") as string,
      meter_configuration: formData.get("meter_config") as string,
      description: formData.get("description") as string,
      effective_from: formData.get("effective_from") as string,
      uses_tou: usesTou,
      tou_type: usesTou ? (formData.get("tou_type") as string) : null,
      active: true,
    });

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Tariff structure created");
      setIsDialogOpen(false);
      setUsesTou(false);
      fetchStructures();
    }
  };

  const getTariffTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      domestic: "bg-primary/10 text-primary",
      commercial: "bg-accent/10 text-accent",
      industrial: "bg-warning/10 text-warning",
      agricultural: "bg-muted text-muted-foreground",
    };
    return colors[type] || colors.agricultural;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Tariff Structures</h2>
          <p className="text-muted-foreground">for {supplyAuthorityName}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            className="gap-2"
            onClick={handleDeleteSelected}
            disabled={selectedTariffs.size === 0 || isDeleting}
          >
            <Trash2 className="w-4 h-4" />
            Delete Selected {selectedTariffs.size > 0 && `(${selectedTariffs.size})`}
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Add Tariff
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Tariff Structure</DialogTitle>
              <DialogDescription>Create a new tariff configuration</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Tariff Name</Label>
                <Input id="name" name="name" required placeholder="Domestic Prepaid" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Tariff Type</Label>
                <Select name="type" required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="domestic">Domestic</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="agricultural">Agricultural</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="meter_config">Meter Configuration</Label>
                <Select name="meter_config">
                  <SelectTrigger>
                    <SelectValue placeholder="Select configuration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prepaid">Prepaid</SelectItem>
                    <SelectItem value="conventional">Conventional</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="effective_from">Effective From</Label>
                <Input id="effective_from" name="effective_from" type="date" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Additional details about this tariff..."
                  rows={3}
                />
              </div>

              <div className="flex items-center space-x-2 p-4 bg-muted/50 rounded-lg">
                <Switch
                  id="uses_tou"
                  checked={usesTou}
                  onCheckedChange={setUsesTou}
                />
                <div className="flex-1">
                  <Label htmlFor="uses_tou" className="cursor-pointer">
                    Time-of-Use (TOU) Tariff
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Enable for Eskom TOU structures (Nightsave, Megaflex, etc.)
                  </p>
                </div>
              </div>

              {usesTou && (
                <div className="space-y-2">
                  <Label htmlFor="tou_type">TOU Type</Label>
                  <Select name="tou_type" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select TOU type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nightsave">Nightsave (Urban Large/Small, Rural)</SelectItem>
                      <SelectItem value="megaflex">Megaflex/Miniflex/Homeflex</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Define time periods after creating the tariff
                  </p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creating..." : "Create Tariff"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {structures.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No tariff structures yet</h3>
            <p className="text-muted-foreground mb-4">
              Create tariff structures with pricing blocks
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Tariff
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>All Tariff Structures</CardTitle>
            <CardDescription>
              {structures.length} structure{structures.length !== 1 ? "s" : ""} configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedTariffs.size === structures.length && structures.length > 0}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all tariffs"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Authority</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>TOU</TableHead>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {structures.map((structure) => (
                  <TableRow key={structure.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedTariffs.has(structure.id)}
                        onCheckedChange={(checked) => handleSelectTariff(structure.id, checked as boolean)}
                        aria-label={`Select ${structure.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{structure.name}</TableCell>
                    <TableCell>{structure.supply_authorities?.name || "—"}</TableCell>
                    <TableCell>
                      <Badge className={getTariffTypeBadge(structure.tariff_type)}>
                        {structure.tariff_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {structure.uses_tou ? (
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4 text-primary" />
                          <span className="text-sm capitalize">{structure.tou_type}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(structure.effective_from).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {structure.active ? (
                        <Badge className="bg-accent text-accent-foreground">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setSelectedTariffForDetails({ id: structure.id, name: structure.name })}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>View Details</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        {structure.uses_tou && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedTariffForTou(structure.id)}
                          >
                            <Clock className="w-4 h-4 mr-2" />
                            TOU Periods
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

      {selectedTariffForTou && (
        <TouPeriodsDialog
          tariffId={selectedTariffForTou}
          onClose={() => setSelectedTariffForTou(null)}
        />
      )}

      {selectedTariffForDetails && (
        <TariffDetailsDialog
          tariffId={selectedTariffForDetails.id}
          tariffName={selectedTariffForDetails.name}
          onClose={() => setSelectedTariffForDetails(null)}
        />
      )}
    </div>
  );
}
