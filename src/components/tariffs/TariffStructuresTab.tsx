import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Plus, FileText, Eye, Trash2, Pencil, Clock, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
  tariff_blocks: any[];
  tariff_charges: any[];
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
  const [sortConfig, setSortConfig] = useState<{
    column: string | null;
    direction: 'asc' | 'desc' | null;
  }>({ column: null, direction: null });
  const [selectedTariffForEdit, setSelectedTariffForEdit] = useState<{ id: string; name: string; mode: "view" | "edit" } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

  useEffect(() => {
    if (supplyAuthorityId) {
      fetchStructures();
    }
  }, [supplyAuthorityId]);

  const fetchStructures = async () => {
    const { data, error } = await supabase
      .from("tariff_structures")
      .select("*, supply_authorities(name), tariff_blocks(*), tariff_charges(*)")
      .eq("supply_authority_id", supplyAuthorityId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch tariff structures");
    } else {
      setStructures(data || []);
      setSelectedTariffs(new Set()); // Clear selection when refreshing
      setSortConfig({ column: null, direction: null }); // Reset sort when data refreshes
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

  const handleSort = (column: string) => {
    setSortConfig(current => {
      if (current.column === column) {
        // Cycle through: asc -> desc -> null (default)
        if (current.direction === 'asc') return { column, direction: 'desc' };
        if (current.direction === 'desc') return { column: null, direction: null };
      }
      return { column, direction: 'asc' };
    });
  };

  const getSortedStructures = () => {
    if (!sortConfig.column || !sortConfig.direction) {
      return structures; // Return default order
    }

    return [...structures].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortConfig.column) {
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'authority':
          aValue = (a.supply_authorities?.name || '').toLowerCase();
          bValue = (b.supply_authorities?.name || '').toLowerCase();
          break;
        case 'type':
          aValue = a.tariff_type.toLowerCase();
          bValue = b.tariff_type.toLowerCase();
          break;
        case 'tou':
          aValue = a.uses_tou ? (a.tou_type || '').toLowerCase() : '';
          bValue = b.uses_tou ? (b.tou_type || '').toLowerCase() : '';
          break;
        case 'effective_from':
          aValue = new Date(a.effective_from).getTime();
          bValue = new Date(b.effective_from).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const getGroupedStructures = () => {
    const sorted = getSortedStructures();
    const grouped = new Map<string, TariffStructure[]>();
    
    sorted.forEach(structure => {
      const existing = grouped.get(structure.name) || [];
      existing.push(structure);
      grouped.set(structure.name, existing);
    });
    
    return grouped;
  };

  const handleSelectGroup = (groupName: string, checked: boolean) => {
    const groupStructures = structures.filter(s => s.name === groupName);
    const newSelection = new Set(selectedTariffs);
    
    groupStructures.forEach(structure => {
      if (checked) {
        newSelection.add(structure.id);
      } else {
        newSelection.delete(structure.id);
      }
    });
    
    setSelectedTariffs(newSelection);
  };

  const isGroupSelected = (groupName: string) => {
    const groupStructures = structures.filter(s => s.name === groupName);
    return groupStructures.length > 0 && groupStructures.every(s => selectedTariffs.has(s.id));
  };

  const isGroupPartiallySelected = (groupName: string) => {
    const groupStructures = structures.filter(s => s.name === groupName);
    const selectedCount = groupStructures.filter(s => selectedTariffs.has(s.id)).length;
    return selectedCount > 0 && selectedCount < groupStructures.length;
  };

  const SortableHeader = ({ column, children }: { column: string; children: React.ReactNode }) => {
    const isActive = sortConfig.column === column;
    const direction = isActive ? sortConfig.direction : null;
    
    return (
      <TableHead 
        className="cursor-pointer select-none hover:bg-muted/50"
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center gap-2">
          {children}
          {direction === 'asc' && <ArrowUp className="w-4 h-4" />}
          {direction === 'desc' && <ArrowDown className="w-4 h-4" />}
          {!direction && <ArrowUpDown className="w-4 h-4 text-muted-foreground/50" />}
        </div>
      </TableHead>
    );
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
            Delete {selectedTariffs.size > 0 && `(${selectedTariffs.size})`}
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
          <Button
            variant="outline"
            className="gap-2"
            onClick={fetchStructures}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
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
              {getGroupedStructures().size} unique tariff{getGroupedStructures().size !== 1 ? "s" : ""} • {structures.length} total period{structures.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" value={expandedGroups} onValueChange={setExpandedGroups}>
              {Array.from(getGroupedStructures()).map(([groupName, groupStructures]) => {
                const firstStructure = groupStructures[0];
                const hasActiveStatus = groupStructures.some(s => s.active);
                const earliestDate = groupStructures.reduce((earliest, s) => 
                  new Date(s.effective_from) < new Date(earliest.effective_from) ? s : earliest
                ).effective_from;
                const latestStructure = groupStructures.reduce((latest, s) => 
                  new Date(s.effective_from) > new Date(latest.effective_from) ? s : latest
                );
                
                return (
                  <AccordionItem key={groupName} value={groupName} className="border-b border-border/50">
                    <AccordionTrigger className="hover:no-underline py-4">
                      <div className="flex items-center gap-4 w-full pr-4">
                        <Checkbox
                          checked={isGroupSelected(groupName)}
                          onCheckedChange={(checked) => handleSelectGroup(groupName, checked as boolean)}
                          onClick={(e) => e.stopPropagation()}
                          className={isGroupPartiallySelected(groupName) ? "data-[state=checked]:bg-primary/50" : ""}
                          aria-label={`Select all periods for ${groupName}`}
                        />
                        <div className="flex-1 text-left">
                          <div className="font-medium">{groupName}</div>
                          <div className="text-sm text-muted-foreground">
                            {firstStructure.supply_authorities?.name || "—"}
                          </div>
                        </div>
                        <Badge className="shrink-0 bg-muted text-muted-foreground">
                          {groupStructures.length} period{groupStructures.length !== 1 ? "s" : ""}
                        </Badge>
                        <Badge className={getTariffTypeBadge(firstStructure.tariff_type)}>
                          {firstStructure.tariff_type}
                        </Badge>
                        <div className="text-sm text-muted-foreground shrink-0">
                          {new Date(earliestDate).toLocaleDateString()} - {hasActiveStatus ? "Present" : new Date(latestStructure.effective_from).toLocaleDateString()}
                        </div>
                        {hasActiveStatus && (
                          <Badge className="bg-accent text-accent-foreground shrink-0">Active</Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="pl-10 pr-4 pb-4">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12"></TableHead>
                              <TableHead>Effective From</TableHead>
                              <TableHead>Effective To</TableHead>
                              <TableHead>Tariff Structure</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {groupStructures
                              .sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime())
                              .map((structure) => (
                              <TableRow key={structure.id}>
                                <TableCell>
                                  <Checkbox
                                    checked={selectedTariffs.has(structure.id)}
                                    onCheckedChange={(checked) => handleSelectTariff(structure.id, checked as boolean)}
                                    aria-label={`Select ${structure.name} from ${new Date(structure.effective_from).toLocaleDateString()}`}
                                  />
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {new Date(structure.effective_from).toLocaleDateString()}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {structure.active ? "Present" : "—"}
                                </TableCell>
                                <TableCell>
                                  {structure.uses_tou ? (
                                    <span className="text-sm font-medium">TOU</span>
                                  ) : structure.tariff_blocks && structure.tariff_blocks.length > 0 ? (
                                    <span className="text-sm font-medium">Block</span>
                                  ) : structure.tariff_charges && structure.tariff_charges.some((c: any) => c.charge_type.startsWith('energy_') || c.charge_type === 'seasonal_energy') ? (
                                    <span className="text-sm font-medium">Seasonal</span>
                                  ) : (
                                    <span className="text-sm text-muted-foreground">—</span>
                                  )}
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
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
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
