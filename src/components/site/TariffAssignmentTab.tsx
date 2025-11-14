import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileCheck2, AlertCircle, CheckCircle2, DollarSign, Eye, FileText, ArrowUpDown, ArrowUp, ArrowDown, Eraser, Scale, Check, X, ChevronDown } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import TariffDetailsDialog from "@/components/tariffs/TariffDetailsDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface TariffAssignmentTabProps {
  siteId: string;
}

interface Site {
  id: string;
  name: string;
  supply_authority_id: string | null;
  supply_authorities: {
    id: string;
    name: string;
    region: string;
  } | null;
}

interface TariffStructure {
  id: string;
  name: string;
  tariff_type: string;
  voltage_level: string | null;
  effective_from: string;
  effective_to: string | null;
  description: string | null;
  uses_tou: boolean;
  supply_authority_id: string;
}

interface Meter {
  id: string;
  meter_number: string;
  name: string;
  tariff: string | null;
  tariff_structure_id: string | null;
  meter_type: string;
  mccb_size: number | null;
  rating: string | null;
}

interface DocumentShopNumber {
  documentId: string;
  fileName: string;
  shopNumber: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  currency: string;
  tenantName?: string;
  accountReference?: string;
  lineItems?: Array<{
    description: string;
    meter_number?: string;
    previous_reading?: number;
    current_reading?: number;
    consumption?: number;
    rate?: number;
    amount: number;
  }>;
}

export default function TariffAssignmentTab({ siteId }: TariffAssignmentTabProps) {
  const [site, setSite] = useState<Site | null>(null);
  const [tariffStructures, setTariffStructures] = useState<TariffStructure[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [selectedTariffs, setSelectedTariffs] = useState<{ [meterId: string]: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [viewingTariffId, setViewingTariffId] = useState<string | null>(null);
  const [viewingTariffName, setViewingTariffName] = useState<string>("");
  const [documentShopNumbers, setDocumentShopNumbers] = useState<DocumentShopNumber[]>([]);
  const [viewingShopDoc, setViewingShopDoc] = useState<DocumentShopNumber | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(null);
  const [selectedPreviewTariffId, setSelectedPreviewTariffId] = useState<string>("");
  const [selectedMeterIds, setSelectedMeterIds] = useState<Set<string>>(new Set());
  
  // Rate comparison state
  const [rateComparisonMeter, setRateComparisonMeter] = useState<Meter | null>(null);
  const [rateComparisonData, setRateComparisonData] = useState<{
    overallStatus: 'match' | 'partial' | 'mismatch' | 'unknown';
    tariffRates: { basicCharge?: number; energyCharge?: number };
    documentComparisons: Array<{
      shop: DocumentShopNumber;
      docRates: { basicCharge?: number; energyCharge?: number };
      status: 'match' | 'partial' | 'mismatch' | 'unknown';
    }>;
  } | null>(null);
  const [expandedDocuments, setExpandedDocuments] = useState<Set<number>>(new Set());
  const [viewingAllDocs, setViewingAllDocs] = useState<{ meter: Meter; docs: DocumentShopNumber[] } | null>(null);
  const [expandedShopDocs, setExpandedShopDocs] = useState<Set<number>>(new Set());
  const [tariffRates, setTariffRates] = useState<{
    [tariffId: string]: { 
      basicCharge?: number; 
      energyCharge?: number; 
    } 
  }>({});

  useEffect(() => {
    fetchSiteData();
    fetchMeters();
    fetchDocumentShopNumbers();
  }, [siteId]);

  useEffect(() => {
    if (site?.supply_authority_id) {
      fetchTariffStructures();
    }
  }, [site?.supply_authority_id]);

  const fetchSiteData = async () => {
    const { data, error } = await supabase
      .from("sites")
      .select("*, supply_authorities(id, name, region)")
      .eq("id", siteId)
      .single();

    if (error) {
      toast.error("Failed to load site data");
      return;
    }

    setSite(data);
  };

  const fetchTariffStructures = async () => {
    if (!site?.supply_authority_id) return;

    setIsLoading(true);
    const { data, error } = await supabase
      .from("tariff_structures")
      .select("*")
      .eq("supply_authority_id", site.supply_authority_id)
      .eq("active", true)
      .order("effective_from", { ascending: false });

    if (error) {
      toast.error("Failed to load tariff structures");
      setIsLoading(false);
      return;
    }

    setTariffStructures(data || []);
    setIsLoading(false);
  };

  const fetchMeters = async () => {
    const { data, error } = await supabase
      .from("meters")
      .select("id, meter_number, name, tariff, tariff_structure_id, meter_type, mccb_size, rating")
      .eq("site_id", siteId)
      .order("meter_number");

    if (error) {
      toast.error("Failed to load meters");
      return;
    }

    setMeters(data || []);
    
    // Initialize selected tariffs from existing data
    const tariffMap: { [meterId: string]: string } = {};
    data?.forEach((meter) => {
      if (meter.tariff_structure_id) {
        tariffMap[meter.id] = meter.tariff_structure_id;
      }
    });
    setSelectedTariffs(tariffMap);
  };

  const fetchDocumentShopNumbers = async () => {
    try {
      const { data, error } = await supabase
        .from("site_documents")
        .select(`
          id,
          file_name,
          document_extractions (
            extracted_data
          )
        `)
        .eq("site_id", siteId)
        .eq("extraction_status", "completed");

      if (error) throw error;

      const shopNumbers: DocumentShopNumber[] = [];
      data?.forEach((doc) => {
        const extraction = doc.document_extractions?.[0];
        if (extraction?.extracted_data) {
          const extractedData = extraction.extracted_data as any;
          if (extractedData?.shop_number) {
            shopNumbers.push({
              documentId: doc.id,
              fileName: doc.file_name,
              shopNumber: extractedData.shop_number,
              periodStart: extractedData.period_start || '',
              periodEnd: extractedData.period_end || '',
              totalAmount: extractedData.total_amount || 0,
              currency: extractedData.currency || 'ZAR',
              tenantName: extractedData.tenant_name,
              accountReference: extractedData.account_reference,
              lineItems: extractedData.line_items
            });
          }
        }
      });

      setDocumentShopNumbers(shopNumbers);
    } catch (error) {
      console.error("Error fetching document shop numbers:", error);
    }
  };

  const getMatchingShopNumbers = (meter: Meter): DocumentShopNumber[] => {
    // Extract just the number part from meter_number (e.g., "DB-11" → "11")
    const meterNumberParts = meter.meter_number.match(/\d+[A-Z]?$/i);
    const cleanMeterNumber = meterNumberParts ? meterNumberParts[0] : meter.meter_number;
    
    const matches = documentShopNumbers.filter(doc => {
      const shopNum = doc.shopNumber.toLowerCase();
      const meterNum = cleanMeterNumber.toLowerCase();
      const fullMeterNum = meter.meter_number.toLowerCase();
      const meterName = (meter.name || '').toLowerCase();
      
      // Exact match is preferred
      if (shopNum === meterNum || shopNum === fullMeterNum) {
        return true;
      }
      
      // Match if shop number is found in meter name
      if (meterName && shopNum === meterName) {
        return true;
      }
      
      return false;
    });
    
    // Sort by period start date (most recent first) and return all matches
    return matches.sort((a, b) => {
      const dateA = new Date(a.periodStart).getTime();
      const dateB = new Date(b.periodStart).getTime();
      return dateB - dateA; // Descending order (newest first)
    });
  };

  const handleTariffChange = (meterId: string, tariffId: string) => {
    setSelectedTariffs((prev) => ({
      ...prev,
      [meterId]: tariffId,
    }));
  };

  const handleClearTariff = async (meterId: string) => {
    try {
      const { error } = await supabase
        .from("meters")
        .update({ 
          tariff_structure_id: null,
          tariff: null
        })
        .eq("id", meterId);

      if (error) throw error;

      // Update local state
      setSelectedTariffs((prev) => {
        const updated = { ...prev };
        delete updated[meterId];
        return updated;
      });

      // Refresh meters to get updated data
      await fetchMeters();

      toast.success("Tariff assignment cleared");
    } catch (error) {
      console.error("Error clearing tariff:", error);
      toast.error("Failed to clear tariff assignment");
    }
  };

  const handleBulkClearTariffs = async () => {
    if (selectedMeterIds.size === 0) return;

    try {
      const meterIdsArray = Array.from(selectedMeterIds);
      const { error } = await supabase
        .from("meters")
        .update({ 
          tariff_structure_id: null,
          tariff: null
        })
        .in("id", meterIdsArray);

      if (error) throw error;

      // Update local state
      setSelectedTariffs((prev) => {
        const updated = { ...prev };
        meterIdsArray.forEach(id => delete updated[id]);
        return updated;
      });

      // Clear selection
      setSelectedMeterIds(new Set());

      // Refresh meters to get updated data
      await fetchMeters();

      toast.success(`Cleared tariff assignments for ${meterIdsArray.length} meter${meterIdsArray.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error("Error clearing tariffs:", error);
      toast.error("Failed to clear tariff assignments");
    }
  };

  const toggleMeterSelection = (meterId: string) => {
    setSelectedMeterIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(meterId)) {
        newSet.delete(meterId);
      } else {
        newSet.add(meterId);
      }
      return newSet;
    });
  };

  const toggleAllMeters = () => {
    if (selectedMeterIds.size === meters.length) {
      setSelectedMeterIds(new Set());
    } else {
      setSelectedMeterIds(new Set(meters.map(m => m.id)));
    }
  };

  // Helper function to extract rates from document
  const extractRatesFromDocument = (shop: DocumentShopNumber): { 
    basicCharge?: number; 
    energyCharge?: number 
  } => {
    if (!shop.lineItems) return {};
    
    const rates: { basicCharge?: number; energyCharge?: number } = {};
    
    shop.lineItems.forEach(item => {
      const desc = item.description?.toLowerCase() || '';
      
      // Basic charge (in R/month)
      if (desc.includes('basic') && !desc.includes('kwh') && !desc.includes('kva')) {
        rates.basicCharge = item.rate || item.amount;
      }
      
      // Energy charge (in R/kWh, convert to c/kWh)
      // Exclude generator charges and only include actual electricity/conv charges
      if ((desc.includes('kwh') || desc.includes('kva')) && 
          !desc.includes('basic') && 
          !desc.includes('generator') &&
          (desc.includes('conv') || desc.includes('electrical') || desc.includes('electricity'))) {
        rates.energyCharge = item.rate ? item.rate * 100 : undefined;
      }
    });
    
    return rates;
  };

  // Helper function to fetch tariff rates
  const fetchTariffRates = async (tariffId: string) => {
    if (tariffRates[tariffId]) {
      return tariffRates[tariffId];
    }
    
    const rates: { basicCharge?: number; energyCharge?: number } = {};
    
    // Fetch tariff charges
    const { data: charges } = await supabase
      .from('tariff_charges')
      .select('charge_type, charge_amount')
      .eq('tariff_structure_id', tariffId);
    
    if (charges) {
      const basicCharge = charges.find(c => c.charge_type === 'basic_monthly');
      if (basicCharge) {
        rates.basicCharge = basicCharge.charge_amount;
      }
      
      const energyCharge = charges.find(c => c.charge_type === 'energy_both_seasons');
      if (energyCharge) {
        rates.energyCharge = energyCharge.charge_amount;
      }
    }
    
    // If no flat energy charge, check blocks
    if (!rates.energyCharge) {
      const { data: blocks } = await supabase
        .from('tariff_blocks')
        .select('energy_charge_cents')
        .eq('tariff_structure_id', tariffId)
        .order('block_number')
        .limit(1);
      
      if (blocks && blocks.length > 0) {
        rates.energyCharge = blocks[0].energy_charge_cents;
      }
    }
    
    setTariffRates(prev => ({ ...prev, [tariffId]: rates }));
    return rates;
  };

  // Helper function to compare rates
  const compareRates = (
    docRates: { basicCharge?: number; energyCharge?: number },
    tariffRates: { basicCharge?: number; energyCharge?: number }
  ): 'match' | 'partial' | 'mismatch' | 'unknown' => {
    if (!docRates.basicCharge && !docRates.energyCharge) return 'unknown';
    if (!tariffRates.basicCharge && !tariffRates.energyCharge) return 'unknown';
    
    let matchCount = 0;
    let mismatchCount = 0;
    let comparisonCount = 0;
    
    // Compare basic charge (both in R/month)
    if (docRates.basicCharge && tariffRates.basicCharge) {
      comparisonCount++;
      const diff = Math.abs(docRates.basicCharge - tariffRates.basicCharge);
      const tolerance = tariffRates.basicCharge * 0.01; // 1% tolerance
      if (diff <= tolerance) {
        matchCount++;
      } else {
        mismatchCount++;
      }
    }
    
    // Compare energy charge (both in c/kWh)
    if (docRates.energyCharge && tariffRates.energyCharge) {
      comparisonCount++;
      const diff = Math.abs(docRates.energyCharge - tariffRates.energyCharge);
      const tolerance = tariffRates.energyCharge * 0.01; // 1% tolerance
      if (diff <= tolerance) {
        matchCount++;
      } else {
        mismatchCount++;
      }
    }
    
    if (comparisonCount === 0) return 'unknown';
    if (mismatchCount > 0) return 'mismatch';
    if (matchCount < comparisonCount) return 'partial';
    return 'match';
  };

  // Handle viewing rate comparison
  const handleViewRateComparison = async (meter: Meter) => {
    const assignedTariffId = selectedTariffs[meter.id] || meter.tariff_structure_id;
    
    if (!assignedTariffId) {
      toast.error("Please assign a tariff to this meter first");
      return;
    }
    
    const matchingShops = getMatchingShopNumbers(meter);
    
    if (matchingShops.length === 0) {
      toast.error("No extracted document data found for this meter");
      return;
    }
    
    // Fetch tariff rates once
    const tariffRatesData = await fetchTariffRates(assignedTariffId);
    
    // Create a comparison for each document
    const documentComparisons = matchingShops.map(shop => {
      const docRates = extractRatesFromDocument(shop);
      const status = compareRates(docRates, tariffRatesData);
      return {
        shop,
        docRates,
        status
      };
    });
    
    // Calculate overall status (worst status wins)
    const statusPriority = { 'mismatch': 3, 'partial': 2, 'unknown': 1, 'match': 0 };
    const overallStatus = documentComparisons.reduce((worst, current) => {
      return statusPriority[current.status] > statusPriority[worst] ? current.status : worst;
    }, 'match' as 'match' | 'partial' | 'mismatch' | 'unknown');
    
    setRateComparisonData({
      overallStatus,
      tariffRates: tariffRatesData,
      documentComparisons
    });
    setRateComparisonMeter(meter);
    setExpandedDocuments(new Set()); // Start with all documents collapsed
  };

  const handleSaveAssignments = async () => {
    setIsSaving(true);

    try {
      // Update all meters - both with assignments and without
      const updates = meters.map((meter) => {
        const tariffId = selectedTariffs[meter.id] || null;
        return supabase
          .from("meters")
          .update({ 
            tariff_structure_id: tariffId,
            tariff: tariffId // Keep tariff column in sync for backward compatibility
          })
          .eq("id", meter.id);
      });

      const results = await Promise.allSettled(updates);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed > 0) {
        toast.error(`Saved ${successful} assignments, ${failed} failed`);
      } else {
        toast.success(`Successfully saved ${successful} tariff assignments`);
      }
      
      fetchMeters();
    } catch (error) {
      console.error("Error saving tariff assignments:", error);
      toast.error("Failed to save tariff assignments");
    } finally {
      setIsSaving(false);
    }
  };

  const getAssignmentStats = () => {
    const assigned = meters.filter((m) => selectedTariffs[m.id]).length;
    const total = meters.length;
    return { assigned, total, unassigned: total - assigned };
  };

  const hasUnsavedChanges = (meterId: string) => {
    const meter = meters.find(m => m.id === meterId);
    if (!meter) return false;
    
    const currentSelection = selectedTariffs[meterId];
    const savedTariff = meter.tariff_structure_id;
    
    // If both are empty/null, no changes
    if (!currentSelection && !savedTariff) return false;
    
    // If one is set and the other isn't, or if they're different
    return currentSelection !== savedTariff;
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const getSortedMeters = () => {
    if (!sortColumn || !sortDirection) return meters;

    return [...meters].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortColumn) {
        case "meter_number":
          aValue = a.meter_number;
          bValue = b.meter_number;
          break;
        case "name":
          aValue = a.name || "";
          bValue = b.name || "";
          break;
        case "meter_type":
          aValue = a.meter_type;
          bValue = b.meter_type;
          break;
        case "mccb_size":
          // Sort by mccb_size if available, otherwise use rating
          aValue = a.mccb_size || (a.rating ? parseFloat(a.rating) || 0 : 0);
          bValue = b.mccb_size || (b.rating ? parseFloat(b.rating) || 0 : 0);
          break;
        default:
          return 0;
      }

      if (sortDirection === "asc") {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    });
  };

  const SortableHeader = ({ column, children }: { column: string; children: React.ReactNode }) => {
    const isActive = sortColumn === column;
    const Icon = isActive
      ? sortDirection === "asc"
        ? ArrowUp
        : ArrowDown
      : ArrowUpDown;

    return (
      <TableHead>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 data-[state=open]:bg-accent"
          onClick={() => handleSort(column)}
        >
          {children}
          <Icon className={`ml-2 h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
        </Button>
      </TableHead>
    );
  };

  const stats = getAssignmentStats();

  if (!site?.supply_authority_id) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Tariff Assignment
          </CardTitle>
          <CardDescription>Assign tariff structures to meters</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This site does not have a supply authority configured. Please edit the site details
              and select a province and municipality to access tariff structures.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Tariff Assignment
          </CardTitle>
          <CardDescription>
            Assign tariff structures from {site.supply_authorities?.name} to your meters
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Province</Label>
              <div className="p-3 border rounded-md bg-muted/50">
                <p className="font-medium">{site.supply_authorities?.region}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Municipality / Supply Authority</Label>
              <div className="p-3 border rounded-md bg-muted/50">
                <p className="font-medium">{site.supply_authorities?.name}</p>
              </div>
            </div>
          </div>

          {!isLoading && tariffStructures.length > 0 && (
            <div className="border rounded-lg p-4 space-y-3 bg-card">
              <div className="space-y-2">
                <Label>Available Tariff Structures</Label>
                <div className="flex gap-2">
                  <Select
                    value={selectedPreviewTariffId}
                    onValueChange={(value) => setSelectedPreviewTariffId(value)}
                  >
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue placeholder={`Select from ${tariffStructures.length} available tariff structure(s)`} />
                    </SelectTrigger>
                    <SelectContent className="bg-background z-50">
                      {tariffStructures.map((tariff) => (
                        <SelectItem key={tariff.id} value={tariff.id}>
                          <div className="flex flex-col">
                            <span className="font-medium">{tariff.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {tariff.tariff_type}
                              {tariff.voltage_level && ` • ${tariff.voltage_level}`}
                              {tariff.uses_tou && " • TOU"}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedPreviewTariffId && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              const tariff = tariffStructures.find(t => t.id === selectedPreviewTariffId);
                              if (tariff) {
                                setViewingTariffId(selectedPreviewTariffId);
                                setViewingTariffName(tariff.name);
                              }
                            }}
                            className="shrink-0"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>View Full Details</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 p-4 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold text-primary">{stats.assigned}</p>
              <p className="text-sm text-muted-foreground">Assigned</p>
            </div>
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold text-muted-foreground">{stats.unassigned}</p>
              <p className="text-sm text-muted-foreground">Unassigned</p>
            </div>
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total Meters</p>
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <p className="text-muted-foreground">Loading tariff structures...</p>
            </div>
          )}

          {!isLoading && tariffStructures.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No active tariff structures found for {site.supply_authorities?.name}.
                Please add tariff structures in the Tariffs section.
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && tariffStructures.length > 0 && meters.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No meters found for this site. Please add meters first.
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && tariffStructures.length > 0 && meters.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Meter Tariff Assignments</h3>
                <Button onClick={handleSaveAssignments} disabled={isSaving}>
                  <FileCheck2 className="w-4 h-4 mr-2" />
                  {isSaving ? "Saving..." : "Save Assignments"}
                </Button>
              </div>

              {selectedMeterIds.size > 0 && (
                <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                  <div>
                    <span className="text-sm font-medium">
                      {selectedMeterIds.size} meter{selectedMeterIds.size > 1 ? 's' : ''} selected
                    </span>
                  </div>
                  <div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBulkClearTariffs}
                    >
                      <Eraser className="w-4 h-4 mr-2" />
                      Clear Tariffs
                    </Button>
                  </div>
                </div>
              )}

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={selectedMeterIds.size === meters.length && meters.length > 0}
                          onCheckedChange={toggleAllMeters}
                        />
                      </TableHead>
                      <SortableHeader column="meter_number">Meter Number</SortableHeader>
                      <SortableHeader column="name">Name</SortableHeader>
                      <SortableHeader column="meter_type">Type</SortableHeader>
                      <SortableHeader column="mccb_size">Breaker Size (A)</SortableHeader>
                      <TableHead>Shop Numbers</TableHead>
                      <TableHead>Assigned Tariff Structure</TableHead>
                      <TableHead className="w-[120px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {getSortedMeters().map((meter) => {
                      const currentTariffId = selectedTariffs[meter.id];
                      const currentTariff = tariffStructures.find((t) => t.id === currentTariffId);
                      const hasAssignment = !!currentTariffId;
                      const matchingShops = getMatchingShopNumbers(meter);

                      return (
                        <TableRow key={meter.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedMeterIds.has(meter.id)}
                              onCheckedChange={() => toggleMeterSelection(meter.id)}
                            />
                          </TableCell>
                          <TableCell className="font-mono font-medium">
                            {meter.meter_number}
                          </TableCell>
                          <TableCell>{meter.name || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{meter.meter_type}</Badge>
                          </TableCell>
                          <TableCell>
                            {meter.mccb_size ? (
                              <span className="font-medium">{meter.mccb_size}A</span>
                            ) : meter.rating ? (
                              <span className="font-medium">{meter.rating}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {matchingShops.length > 0 ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-6 text-xs"
                                      onClick={() => setViewingAllDocs({ meter, docs: matchingShops })}
                                    >
                                      <FileText className="w-3 h-3 mr-1" />
                                      {matchingShops[0].shopNumber}
                                      {matchingShops.length > 1 && (
                                        <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                                          {matchingShops.length}
                                        </Badge>
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>View {matchingShops.length} document{matchingShops.length > 1 ? 's' : ''}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={currentTariffId || ""}
                              onValueChange={(value) => handleTariffChange(meter.id, value)}
                            >
                              <SelectTrigger className={cn(
                                "w-full",
                                hasUnsavedChanges(meter.id) && "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                              )}>
                                <SelectValue placeholder="Select tariff structure" />
                              </SelectTrigger>
                              <SelectContent>
                                {tariffStructures.map((tariff) => (
                                  <SelectItem key={tariff.id} value={tariff.id}>
                                    <div className="flex flex-col">
                                      <span className="font-medium">{tariff.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {tariff.tariff_type}
                                        {tariff.voltage_level && ` • ${tariff.voltage_level}`}
                                        {tariff.uses_tou && " • TOU"}
                                      </span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleViewRateComparison(meter)}
                                      disabled={!currentTariffId || matchingShops.length === 0}
                                      className={cn(
                                        !currentTariffId || matchingShops.length === 0 ? "opacity-50 cursor-not-allowed" : ""
                                      )}
                                    >
                                      <Scale className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Compare rates with documents</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        const tariffStructure = tariffStructures.find(t => t.id === currentTariffId);
                                        if (tariffStructure) {
                                          setViewingTariffId(currentTariffId);
                                          setViewingTariffName(tariffStructure.name);
                                        }
                                      }}
                                      disabled={!currentTariffId}
                                      className={cn(
                                        !currentTariffId ? "opacity-50 cursor-not-allowed" : ""
                                      )}
                                    >
                                      <Eye className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>View tariff details</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleClearTariff(meter.id)}
                                      disabled={!currentTariffId}
                                      className={cn(
                                        !currentTariffId ? "opacity-50 cursor-not-allowed" : ""
                                      )}
                                    >
                                      <Eraser className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Clear tariff assignment</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {viewingTariffId && (
        <TariffDetailsDialog
          tariffId={viewingTariffId}
          tariffName={viewingTariffName}
          onClose={() => {
            setViewingTariffId(null);
            setViewingTariffName("");
          }}
        />
      )}

      {/* Rate Comparison Dialog */}
      <Dialog 
        open={!!rateComparisonMeter} 
        onOpenChange={() => {
          setRateComparisonMeter(null);
          setRateComparisonData(null);
          setExpandedDocuments(new Set());
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Rate Comparison Analysis</DialogTitle>
            <DialogDescription>
              Comparing document rates with assigned tariff for {rateComparisonMeter?.meter_number}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh] pr-4">
            {rateComparisonData && (
              <div className="space-y-6">
                {/* Status Badge */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <span className="font-medium">Overall Status:</span>
                  <Badge 
                    variant={
                      rateComparisonData.overallStatus === 'match' ? 'default' : 
                      rateComparisonData.overallStatus === 'partial' ? 'secondary' :
                      rateComparisonData.overallStatus === 'mismatch' ? 'destructive' : 
                      'outline'
                    }
                    className={
                      rateComparisonData.overallStatus === 'match' ? "bg-green-500 hover:bg-green-600" :
                      rateComparisonData.overallStatus === 'partial' ? "bg-amber-500 hover:bg-amber-600" : ""
                    }
                  >
                    {rateComparisonData.overallStatus.toUpperCase()}
                  </Badge>
                </div>

                {/* Rate Comparison - One section per document */}
                <div className="space-y-3">
                  <h4 className="font-semibold">Rate Comparison by Document</h4>
                
                {rateComparisonData.documentComparisons.map((comparison, idx) => {
                  const isExpanded = expandedDocuments.has(idx);
                  
                  return (
                    <Collapsible
                      key={idx}
                      open={isExpanded}
                      onOpenChange={(open) => {
                        const newExpanded = new Set(expandedDocuments);
                        if (open) {
                          newExpanded.add(idx);
                        } else {
                          newExpanded.delete(idx);
                        }
                        setExpandedDocuments(newExpanded);
                      }}
                      className="border rounded-lg"
                    >
                      {/* Document Header - Clickable to expand/collapse */}
                      <CollapsibleTrigger className="w-full p-4 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ChevronDown 
                              className={cn(
                                "w-4 h-4 text-muted-foreground transition-transform",
                                isExpanded && "rotate-180"
                              )} 
                            />
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">{comparison.shop.shopNumber}</span>
                            {comparison.shop.periodStart && (
                              <span className="text-sm text-muted-foreground">
                                ({new Date(comparison.shop.periodStart).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })})
                              </span>
                            )}
                          </div>
                          <Badge 
                            variant={
                              comparison.status === 'match' ? 'default' : 
                              comparison.status === 'partial' ? 'secondary' :
                              comparison.status === 'mismatch' ? 'destructive' : 
                              'outline'
                            }
                            className={
                              comparison.status === 'match' ? "bg-green-500 hover:bg-green-600" :
                              comparison.status === 'partial' ? "bg-amber-500 hover:bg-amber-600" : ""
                            }
                          >
                            {comparison.status.toUpperCase()}
                          </Badge>
                        </div>
                      </CollapsibleTrigger>

                      <CollapsibleContent className="px-4 pb-4 space-y-4">
                        {/* Comparison Table for this document */}
                        <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Charge Type</TableHead>
                          <TableHead>Document Rate</TableHead>
                          <TableHead>Tariff Rate</TableHead>
                          <TableHead>Match</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {/* Basic Charge Row */}
                        {(comparison.docRates.basicCharge || rateComparisonData.tariffRates.basicCharge) && (
                          <TableRow>
                            <TableCell className="font-medium">Basic Charge</TableCell>
                            <TableCell>
                              {comparison.docRates.basicCharge ? (
                                `R ${comparison.docRates.basicCharge.toFixed(2)}/month`
                              ) : (
                                <span className="text-muted-foreground">Not extracted</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {rateComparisonData.tariffRates.basicCharge ? (
                                `R ${rateComparisonData.tariffRates.basicCharge.toFixed(2)}/month`
                              ) : (
                                <span className="text-muted-foreground">Not configured</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {comparison.docRates.basicCharge && 
                               rateComparisonData.tariffRates.basicCharge ? (
                                Math.abs(comparison.docRates.basicCharge - rateComparisonData.tariffRates.basicCharge) 
                                  <= rateComparisonData.tariffRates.basicCharge * 0.01 ? (
                                  <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                                    <Check className="w-3 h-3 mr-1" /> Match
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive">
                                    <X className="w-3 h-3 mr-1" /> Mismatch
                                  </Badge>
                                )
                              ) : (
                                <Badge variant="outline">N/A</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                        
                        {/* Energy Charge Row */}
                        {(comparison.docRates.energyCharge || rateComparisonData.tariffRates.energyCharge) && (
                          <TableRow>
                            <TableCell className="font-medium">Energy Charge</TableCell>
                            <TableCell>
                              {comparison.docRates.energyCharge ? (
                                `${comparison.docRates.energyCharge.toFixed(2)} c/kWh`
                              ) : (
                                <span className="text-muted-foreground">Not extracted</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {rateComparisonData.tariffRates.energyCharge ? (
                                `${rateComparisonData.tariffRates.energyCharge.toFixed(2)} c/kWh`
                              ) : (
                                <span className="text-muted-foreground">Not configured</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {comparison.docRates.energyCharge && 
                               rateComparisonData.tariffRates.energyCharge ? (
                                Math.abs(comparison.docRates.energyCharge - rateComparisonData.tariffRates.energyCharge) 
                                  <= rateComparisonData.tariffRates.energyCharge * 0.01 ? (
                                  <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                                    <Check className="w-3 h-3 mr-1" /> Match
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive">
                                    <X className="w-3 h-3 mr-1" /> Mismatch
                                  </Badge>
                                )
                              ) : (
                                <Badge variant="outline">N/A</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>

                        {/* View Document Button */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setViewingShopDoc(comparison.shop)}
                          className="w-full"
                        >
                          <FileText className="w-3 h-3 mr-2" />
                          View Document Details
                        </Button>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>

              {/* Help Text */}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Rates are compared with a 1% tolerance to account for rounding. 
                  Energy rates from documents are converted from R/kWh to c/kWh for comparison.
                  Each source document is compared separately to the assigned tariff.
                </AlertDescription>
              </Alert>
            </div>
          )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* All Documents Dialog */}
      <Dialog open={!!viewingAllDocs} onOpenChange={() => {
        setViewingAllDocs(null);
        setExpandedShopDocs(new Set());
      }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Associated Documents</DialogTitle>
            <DialogDescription>
              All documents assigned to meter {viewingAllDocs?.meter.meter_number}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-3">
              {viewingAllDocs?.docs.map((doc, idx) => (
                <Collapsible
                  key={idx}
                  open={expandedShopDocs.has(idx)}
                  onOpenChange={(open) => {
                    const newSet = new Set(expandedShopDocs);
                    if (open) {
                      newSet.add(idx);
                    } else {
                      newSet.delete(idx);
                    }
                    setExpandedShopDocs(newSet);
                  }}
                  className="border rounded-lg"
                >
                  <CollapsibleTrigger className="w-full p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                        <div className="text-left">
                          <div className="font-medium">{doc.shopNumber}</div>
                          <div className="text-sm text-muted-foreground">
                            {new Date(doc.periodStart).toLocaleDateString()} - {new Date(doc.periodEnd).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{doc.currency} {doc.totalAmount.toFixed(2)}</Badge>
                        <ChevronDown className={cn(
                          "h-4 w-4 transition-transform",
                          expandedShopDocs.has(idx) && "rotate-180"
                        )} />
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="p-4 pt-0 space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">File:</span>
                        <div className="font-medium">{doc.fileName}</div>
                      </div>
                      {doc.tenantName && (
                        <div>
                          <span className="text-muted-foreground">Tenant:</span>
                          <div className="font-medium">{doc.tenantName}</div>
                        </div>
                      )}
                      {doc.accountReference && (
                        <div>
                          <span className="text-muted-foreground">Account Ref:</span>
                          <div className="font-medium">{doc.accountReference}</div>
                        </div>
                      )}
                    </div>
                    
                    {doc.lineItems && doc.lineItems.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Line Items</h4>
                        <div className="border rounded-lg overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Description</TableHead>
                                <TableHead>Consumption</TableHead>
                                <TableHead>Rate</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {doc.lineItems.map((item, itemIdx) => (
                                <TableRow key={itemIdx}>
                                  <TableCell>{item.description}</TableCell>
                                  <TableCell>
                                    {item.consumption ? `${item.consumption} kWh` : '—'}
                                  </TableCell>
                                  <TableCell>
                                    {item.rate ? `${item.rate.toFixed(2)}` : '—'}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {doc.currency} {item.amount.toFixed(2)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setViewingShopDoc(doc)}
                      className="w-full"
                    >
                      <FileText className="w-3 h-3 mr-2" />
                      View Full Document Details
                    </Button>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Shop Document Details Dialog */}
      <Dialog open={!!viewingShopDoc} onOpenChange={() => setViewingShopDoc(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Document Details</DialogTitle>
            <DialogDescription>
              Extracted information from uploaded document
            </DialogDescription>
          </DialogHeader>
          
          {viewingShopDoc && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Period Start</Label>
                  <p className="text-sm">
                    {viewingShopDoc.periodStart ? new Date(viewingShopDoc.periodStart).toLocaleDateString() : '—'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Period End</Label>
                  <p className="text-sm">
                    {viewingShopDoc.periodEnd ? new Date(viewingShopDoc.periodEnd).toLocaleDateString() : '—'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Currency</Label>
                  <p className="text-sm">{viewingShopDoc.currency}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Total Amount</Label>
                  <p className="text-sm font-medium">
                    {viewingShopDoc.totalAmount.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="space-y-4 p-4 border rounded-lg">
                <Label className="text-base font-semibold">Additional Details</Label>
                
                <div className="space-y-2">
                  <Label>Shop Number</Label>
                  <p className="text-sm">{viewingShopDoc.shopNumber}</p>
                </div>

                {viewingShopDoc.tenantName && (
                  <div className="space-y-2">
                    <Label>Tenant Name</Label>
                    <p className="text-sm">{viewingShopDoc.tenantName}</p>
                  </div>
                )}

                {viewingShopDoc.accountReference && (
                  <div className="space-y-2">
                    <Label>Account Reference</Label>
                    <p className="text-sm">{viewingShopDoc.accountReference}</p>
                  </div>
                )}

                {/* Line Items Section */}
                {viewingShopDoc.lineItems && viewingShopDoc.lineItems.length > 0 && (
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Line Items</Label>
                    <Accordion type="single" collapsible className="w-full">
                      {viewingShopDoc.lineItems.map((item, index) => (
                        <AccordionItem key={index} value={`item-${index}`}>
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex items-center justify-between w-full pr-4">
                              <span className="font-medium">{item.description || `Line Item ${index + 1}`}</span>
                              <span className="text-sm text-muted-foreground">
                                {viewingShopDoc.currency} {(item.amount || 0).toFixed(2)}
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-3 pt-2 text-sm">
                              {item.meter_number && (
                                <div>
                                  <Label className="text-xs text-muted-foreground">Meter Number</Label>
                                  <p>{item.meter_number}</p>
                                </div>
                              )}
                              
                              <div className="grid grid-cols-2 gap-3">
                                {item.previous_reading !== undefined && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Previous Reading</Label>
                                    <p>{item.previous_reading}</p>
                                  </div>
                                )}
                                {item.current_reading !== undefined && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Current Reading</Label>
                                    <p>{item.current_reading}</p>
                                  </div>
                                )}
                              </div>
                              
                              <div className="grid grid-cols-2 gap-3">
                                {item.consumption !== undefined && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Consumption</Label>
                                    <p>{item.consumption} kWh</p>
                                  </div>
                                )}
                                {item.rate !== undefined && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Rate</Label>
                                    <p>{item.rate.toFixed(4)} per kWh</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs text-muted-foreground">Document File</Label>
                <p className="text-sm">{viewingShopDoc.fileName}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
