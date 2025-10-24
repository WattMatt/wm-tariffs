import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Plus, FileText, Eye, Trash2, Pencil, Clock } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import TariffEditDialog from "./TariffEditDialog";
import TariffStructureForm from "./TariffStructureForm";

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
  const [selectedTariffForEdit, setSelectedTariffForEdit] = useState<{ id: string; name: string; mode: "view" | "edit" } | null>(null);

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

  const handleSubmit = async (tariffData: any) => {
    setIsLoading(true);

    try {
      // Insert the tariff structure
      const { data: tariffStructure, error: tariffError } = await supabase
        .from("tariff_structures")
        .insert({
          supply_authority_id: supplyAuthorityId,
          name: tariffData.tariffName,
          tariff_type: tariffData.tariffType,
          meter_configuration: tariffData.meterConfiguration,
          description: tariffData.description,
          effective_from: tariffData.effectiveFrom,
          uses_tou: tariffData.touSeasons.length > 0,
          tou_type: tariffData.touSeasons.length > 0 ? "custom" : null,
          active: true,
        })
        .select()
        .single();

      if (tariffError) throw tariffError;

      const tariffId = tariffStructure.id;

      // Insert energy blocks
      if (tariffData.blocks.length > 0) {
        const blocksToInsert = tariffData.blocks.map((block: any) => ({
          tariff_structure_id: tariffId,
          block_number: block.blockNumber,
          kwh_from: block.kwhFrom,
          kwh_to: block.kwhTo,
          energy_charge_cents: block.energyChargeCents,
        }));

        const { error: blocksError } = await supabase
          .from("tariff_blocks")
          .insert(blocksToInsert);

        if (blocksError) throw blocksError;
      }

      // Insert seasonal energy charges
      if (tariffData.seasonalEnergy.length > 0) {
        const chargesToInsert = tariffData.seasonalEnergy.map((charge: any) => ({
          tariff_structure_id: tariffId,
          charge_type: "seasonal_energy",
          description: charge.season,
          charge_amount: charge.rate,
          unit: charge.unit,
        }));

        const { error: chargesError } = await supabase
          .from("tariff_charges")
          .insert(chargesToInsert);

        if (chargesError) throw chargesError;
      }

      // Insert TOU periods
      if (tariffData.touSeasons.length > 0) {
        const touToInsert = tariffData.touSeasons.flatMap((season: any) => [
          {
            tariff_structure_id: tariffId,
            season: season.season,
            day_type: "weekday",
            period_type: "peak",
            start_hour: 7,
            end_hour: 10,
            energy_charge_cents: season.peak,
          },
          {
            tariff_structure_id: tariffId,
            season: season.season,
            day_type: "weekday",
            period_type: "standard",
            start_hour: 10,
            end_hour: 18,
            energy_charge_cents: season.standard,
          },
          {
            tariff_structure_id: tariffId,
            season: season.season,
            day_type: "weekday",
            period_type: "off_peak",
            start_hour: 18,
            end_hour: 7,
            energy_charge_cents: season.offPeak,
          },
        ]);

        const { error: touError } = await supabase
          .from("tariff_time_periods")
          .insert(touToInsert);

        if (touError) throw touError;
      }

      // Insert basic charge
      if (tariffData.basicCharge) {
        const { error: basicChargeError } = await supabase
          .from("tariff_charges")
          .insert({
            tariff_structure_id: tariffId,
            charge_type: "basic_charge",
            description: "Monthly Basic Charge",
            charge_amount: tariffData.basicCharge.amount,
            unit: tariffData.basicCharge.unit,
          });

        if (basicChargeError) throw basicChargeError;
      }

      // Insert demand charges
      if (tariffData.demandCharges.length > 0) {
        const demandChargesToInsert = tariffData.demandCharges.map((charge: any) => ({
          tariff_structure_id: tariffId,
          charge_type: "demand_charge",
          description: charge.season,
          charge_amount: charge.rate,
          unit: charge.unit,
        }));

        const { error: demandError } = await supabase
          .from("tariff_charges")
          .insert(demandChargesToInsert);

        if (demandError) throw demandError;
      }

      toast.success("Tariff structure created successfully");
      setIsDialogOpen(false);
      fetchStructures();
    } catch (error: any) {
      toast.error(`Failed to create tariff: ${error.message}`);
    } finally {
      setIsLoading(false);
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
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add Tariff Structure</DialogTitle>
              <DialogDescription>Create a new tariff with blocks, charges, and TOU periods</DialogDescription>
            </DialogHeader>
            <TariffStructureForm onSubmit={handleSubmit} isLoading={isLoading} />
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
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setSelectedTariffForEdit({ id: structure.id, name: structure.name, mode: "view" })}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setSelectedTariffForEdit({ id: structure.id, name: structure.name, mode: "edit" })}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selectedTariffForEdit && (
        <TariffEditDialog
          tariffId={selectedTariffForEdit.id}
          tariffName={selectedTariffForEdit.name}
          mode={selectedTariffForEdit.mode}
          supplyAuthorityId={supplyAuthorityId}
          onClose={() => setSelectedTariffForEdit(null)}
          onSave={fetchStructures}
        />
      )}
    </div>
  );
}
