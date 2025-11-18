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
import { FileCheck2, AlertCircle, CheckCircle2, DollarSign, Eye, FileText, ArrowUpDown, ArrowUp, ArrowDown, Eraser, Scale, Check, X, ChevronDown, Filter } from "lucide-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import TariffDetailsDialog from "@/components/tariffs/TariffDetailsDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { calculateMeterCost } from "@/lib/costCalculation";

interface TariffAssignmentTabProps {
  siteId: string;
  hideLocationInfo?: boolean;
  showDocumentCharts?: boolean;
  hideSeasonalAverages?: boolean;
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
  meterId?: string;
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

export default function TariffAssignmentTab({ 
  siteId, 
  hideLocationInfo = false, 
  showDocumentCharts = false,
  hideSeasonalAverages = false
}: TariffAssignmentTabProps) {
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
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [activeFilterFrom, setActiveFilterFrom] = useState<Date | undefined>(undefined);
  const [activeFilterTo, setActiveFilterTo] = useState<Date | undefined>(undefined);
  const [selectedMeterIds, setSelectedMeterIds] = useState<Set<string>>(new Set());

  // Apply date range filter
  const applyDateFilter = () => {
    setActiveFilterFrom(fromDate);
    setActiveFilterTo(toDate);
  };

  // Clear date range filter
  const clearDateFilter = () => {
    setFromDate(undefined);
    setToDate(undefined);
    setActiveFilterFrom(undefined);
    setActiveFilterTo(undefined);
  };

  // Filter and fill missing months in data
  const getFilteredAndFilledData = (shops: DocumentShopNumber[]) => {
    // If no filter is active, return original data
    if (!activeFilterFrom || !activeFilterTo) {
      return shops;
    }

    // Create array of all months in the range
    const start = new Date(activeFilterFrom.getFullYear(), activeFilterFrom.getMonth(), 1);
    const end = new Date(activeFilterTo.getFullYear(), activeFilterTo.getMonth(), 1);
    
    const allMonths: Array<{ month: Date; data: DocumentShopNumber | null }> = [];
    const current = new Date(start);
    
    while (current <= end) {
      const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
      const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0, 23, 59, 59);
      
      // Find matching document for this month
      const matchingDoc = shops.find(shop => {
        const periodStart = new Date(shop.periodStart);
        return periodStart >= monthStart && periodStart <= monthEnd;
      });
      
      allMonths.push({
        month: new Date(current),
        data: matchingDoc || null
      });
      
      current.setMonth(current.getMonth() + 1);
    }

    // Convert back to DocumentShopNumber format, filling nulls with placeholder data
    return allMonths.map(({ month, data }) => {
      if (data) return data;
      
      // Create placeholder with null amount for missing data
      return {
        shopNumber: '',
        totalAmount: null,
        periodStart: month.toISOString(),
        periodEnd: new Date(month.getFullYear(), month.getMonth() + 1, 0).toISOString(),
        lineItems: []
      } as DocumentShopNumber;
    });
  };

  // Helper function to calculate seasonal averages
  const calculateSeasonalAverages = (docs: DocumentShopNumber[]) => {
    // South African electricity seasons:
    // Winter/High Demand: June, July, August
    // Summer/Low Demand: September through May (all other months)
    const winterMonths = [6, 7, 8];
    const summerMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];
    
    const winterDocs = docs.filter(doc => {
      const month = new Date(doc.periodStart).getMonth() + 1;
      return winterMonths.includes(month);
    });
    
    const summerDocs = docs.filter(doc => {
      const month = new Date(doc.periodStart).getMonth() + 1;
      return summerMonths.includes(month);
    });
    
    const winterAvg = winterDocs.length > 0
      ? winterDocs.reduce((sum, doc) => sum + doc.totalAmount, 0) / winterDocs.length
      : null;
    
    const summerAvg = summerDocs.length > 0
      ? summerDocs.reduce((sum, doc) => sum + doc.totalAmount, 0) / summerDocs.length
      : null;
    
    return { winterAvg, summerAvg };
  };

  // Helper function to add seasonal averages to chart data
  const addSeasonalAverages = (docs: DocumentShopNumber[]) => {
    // Filter out null data for average calculations
    const validDocs = docs.filter(doc => doc.totalAmount !== null);
    const { winterAvg, summerAvg } = calculateSeasonalAverages(validDocs);
    
    // South African electricity seasons:
    // Winter/High Demand: June, July, August
    // Summer/Low Demand: September through May (all other months)
    const winterMonths = [6, 7, 8];
    const summerMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];
    
    return [...docs]
      .sort((a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime())
      .map(doc => {
        const month = new Date(doc.periodStart).getMonth() + 1;
        return {
          period: new Date(doc.periodStart).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }),
          amount: doc.totalAmount || null, // Keep null for missing data
          winterAvg: winterMonths.includes(month) ? winterAvg : null,
          summerAvg: summerMonths.includes(month) ? summerAvg : null,
          documentId: doc.documentId, // Preserve document ID for lookups
        };
      });
  };
  const [selectedChartMeter, setSelectedChartMeter] = useState<{ meter: Meter; docs: DocumentShopNumber[] } | null>(null);
  const [calculatedCosts, setCalculatedCosts] = useState<{ [docId: string]: number }>({});
  const [isCalculatingCosts, setIsCalculatingCosts] = useState(false);
  
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

  // Calculate costs for comparison mode - only when first entering comparison mode
  useEffect(() => {
    if (hideSeasonalAverages && documentShopNumbers.length > 0 && meters.length > 0 && Object.keys(calculatedCosts).length === 0) {
      calculateAllCosts();
    }
  }, [hideSeasonalAverages]);

  // Load calculated costs from database
  const calculateAllCosts = async () => {
    if (!hideSeasonalAverages) return;

    setIsCalculatingCosts(true);
    
    try {
      // Fetch all stored calculations for documents at this site
      const { data: calculations, error } = await supabase
        .from("document_tariff_calculations")
        .select("document_id, total_cost")
        .in("document_id", documentShopNumbers.map(d => d.documentId));

      if (error) {
        console.error("Error loading calculated costs:", error);
        setIsCalculatingCosts(false);
        return;
      }

      // Build costs lookup
      const costs: { [docId: string]: number } = {};
      calculations?.forEach(calc => {
        costs[calc.document_id] = calc.total_cost;
      });

      setCalculatedCosts(costs);
    } catch (error) {
      console.error("Failed to load calculated costs:", error);
    } finally {
      setIsCalculatingCosts(false);
    }
  };

  // Calculate and store costs for all meters with documents
  const calculateAndStoreCosts = async () => {
    const calculations = [];

    for (const doc of documentShopNumbers) {
      if (!doc.meterId) continue;

      const meter = meters.find(m => m.id === doc.meterId);
      if (!meter) continue;

      const tariffId = selectedTariffs[meter.id] || meter.tariff_structure_id;
      if (!tariffId) continue;

      try {
        // Fetch total kWh for the period
        const { data: readingsData } = await supabase
          .from("meter_readings")
          .select("kwh_value")
          .eq("meter_id", meter.id)
          .gte("reading_timestamp", doc.periodStart)
          .lte("reading_timestamp", doc.periodEnd);

        const totalKwh = readingsData?.reduce((sum, r) => sum + Number(r.kwh_value), 0) || 0;

        const result = await calculateMeterCost(
          meter.id,
          tariffId,
          new Date(doc.periodStart),
          new Date(doc.periodEnd),
          totalKwh
        );

        const tariff = tariffStructures.find(t => t.id === tariffId);
        const variance = doc.totalAmount ? result.totalCost - doc.totalAmount : null;
        const variancePercentage = doc.totalAmount ? (variance! / doc.totalAmount) * 100 : null;

        calculations.push({
          document_id: doc.documentId,
          meter_id: meter.id,
          tariff_structure_id: tariffId,
          period_start: doc.periodStart,
          period_end: doc.periodEnd,
          total_cost: result.totalCost,
          energy_cost: result.energyCost,
          fixed_charges: result.fixedCharges,
          total_kwh: totalKwh,
          avg_cost_per_kwh: totalKwh ? result.totalCost / totalKwh : 0,
          document_billed_amount: doc.totalAmount,
          variance_amount: variance,
          variance_percentage: variancePercentage,
          tariff_name: tariff?.name || result.tariffName,
          calculation_error: result.hasError ? result.errorMessage : null,
        });
      } catch (error) {
        console.error(`Failed to calculate cost for document ${doc.documentId}:`, error);
      }
    }

    // Store all calculations in the database (upsert to handle updates)
    if (calculations.length > 0) {
      const { error } = await supabase
        .from("document_tariff_calculations")
        .upsert(calculations, { 
          onConflict: 'document_id,meter_id,tariff_structure_id',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error("Error storing calculated costs:", error);
      }
    }
  };

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
          meter_id,
          document_extractions (
            extracted_data
          )
        `)
        .eq("site_id", siteId)
        .in("extraction_status", ["completed", "completed_with_warning"]);

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
              meterId: (doc as any).meter_id,
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
    // Only return documents explicitly assigned to this meter via meter_id
    const matches = documentShopNumbers.filter(doc => doc.meterId === meter.id);
    
    // Sort by period start date (most recent first)
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
      
      // Calculate and store costs in the background (non-blocking)
      calculateAndStoreCosts().then(() => {
        toast.success("Tariff cost calculations completed");
      }).catch((error) => {
        console.error("Error calculating costs:", error);
        toast.error("Failed to calculate costs for some documents");
      });
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
            {showDocumentCharts ? 'Tariff Analysis' : 'Tariff Assignment'}
          </CardTitle>
          <CardDescription>
            {showDocumentCharts 
              ? 'Analyze billing costs and tariff performance for your meters'
              : `Assign tariff structures from ${site.supply_authorities?.name} to your meters`
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!hideLocationInfo && (
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
          )}

          {!isLoading && tariffStructures.length > 0 && !showDocumentCharts && (
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

          {showDocumentCharts && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {documentShopNumbers.length > 0 && (
                    <>Earliest: {new Date(Math.min(...documentShopNumbers.map(d => new Date(d.periodStart).getTime()))).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} at 00:30</>
                  )}
                </span>
                <span>
                  {documentShopNumbers.length > 0 && (
                    <>Latest: {new Date(Math.max(...documentShopNumbers.map(d => new Date(d.periodEnd).getTime()))).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} at 23:30</>
                  )}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1 space-y-2">
                  <Label>Month From</Label>
                  <DatePicker
                    date={fromDate}
                    onDateChange={setFromDate}
                    placeholder="Pick start month"
                    monthOnly={true}
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <Label>Month To</Label>
                  <DatePicker
                    date={toDate}
                    onDateChange={setToDate}
                    placeholder="Pick end month"
                    monthOnly={true}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={applyDateFilter}
                    disabled={!fromDate || !toDate}
                    className="whitespace-nowrap"
                  >
                    <Filter className="h-4 w-4 mr-2" />
                    Apply Filter
                  </Button>
                  {(activeFilterFrom || activeFilterTo) && (
                    <Button
                      onClick={clearDateFilter}
                      variant="outline"
                      className="whitespace-nowrap"
                    >
                      <X className="h-4 w-4 mr-2" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              {(activeFilterFrom && activeFilterTo) && (
                <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
                  Showing data from <span className="font-medium">{format(activeFilterFrom, 'MMM yyyy')}</span> to <span className="font-medium">{format(activeFilterTo, 'MMM yyyy')}</span>
                </div>
              )}
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
            <>
              {showDocumentCharts ? (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Meter Analysis</h3>
                  
                  {/* Grid of charts - 3 per row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {meters.map((meter) => {
                      const matchingShops = getMatchingShopNumbers(meter);
                      
                      if (matchingShops.length === 0) return null;
                      
                      // Apply date filter and fill missing months
                      const filteredShops = getFilteredAndFilledData(matchingShops);
                      
                      if (filteredShops.length === 0) return null;
                      
                      // Transform and sort data for chart
                      let chartData = addSeasonalAverages(filteredShops).map(item => ({
                        ...item,
                        calculatedAmount: hideSeasonalAverages && item.documentId 
                          ? calculatedCosts[item.documentId] || null
                          : null,
                      }));
                      
                      return (
                        <Card 
                          key={meter.id} 
                          className="cursor-pointer hover:shadow-lg transition-shadow overflow-hidden"
                          onClick={() => setSelectedChartMeter({ meter, docs: matchingShops })}
                        >
                          <CardHeader className="pb-2 px-4 pt-4">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-lg">
                                {meter.meter_number}
                              </CardTitle>
                              <Badge variant="secondary" className="text-xs">
                                {matchingShops.length} doc{matchingShops.length > 1 ? 's' : ''}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="pt-0 pb-4 px-2">
                            <ChartContainer
                              config={{
                                amount: {
                                  label: hideSeasonalAverages ? "Document Amount" : "Amount",
                                  color: "hsl(var(--primary))",
                                },
                                calculatedAmount: {
                                  label: "Calculated from Tariff",
                                  color: "hsl(142 76% 36%)",
                                },
                                winterAvg: {
                                  label: "Winter Average",
                                  color: "hsl(200 100% 40%)",
                                },
                                summerAvg: {
                                  label: "Summer Average",
                                  color: "hsl(25 100% 50%)",
                                },
                              }}
                              className="h-[250px] w-full"
                            >
                              <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 20 }}>
                                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                  <XAxis 
                                    dataKey="period" 
                                    tick={{ fontSize: 10 }}
                                    angle={-45}
                                    textAnchor="end"
                                    height={60}
                                  />
                                  <YAxis 
                                    tick={{ fontSize: 10 }}
                                    tickFormatter={(value) => `R${(value / 1000).toFixed(0)}k`}
                                  />
                                  <ChartTooltip 
                                    content={<ChartTooltipContent />}
                                  />
                                  <Bar 
                                    dataKey="amount" 
                                    fill="hsl(var(--primary))"
                                    radius={[4, 4, 0, 0]}
                                    name={hideSeasonalAverages ? "Document Amount" : "Amount"}
                                  />
                                  {hideSeasonalAverages && (
                                    <Bar 
                                      dataKey="calculatedAmount" 
                                      fill="hsl(142 76% 36%)"
                                      radius={[4, 4, 0, 0]}
                                      name="Calculated from Tariff"
                                    />
                                  )}
                                  {!hideSeasonalAverages && (
                                    <>
                                      <Line
                                        type="monotone"
                                        dataKey="winterAvg"
                                        stroke="hsl(200 100% 40%)"
                                        strokeWidth={3}
                                        dot={{ r: 4, fill: "hsl(200 100% 40%)" }}
                                        connectNulls={false}
                                      />
                                      <Line
                                        type="monotone"
                                        dataKey="summerAvg"
                                        stroke="hsl(25 100% 50%)"
                                        strokeWidth={3}
                                        dot={{ r: 4, fill: "hsl(25 100% 50%)" }}
                                        connectNulls={false}
                                      />
                                    </>
                                  )}
                                </ComposedChart>
                              </ResponsiveContainer>
                            </ChartContainer>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ) : (
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
                          const currentTariffId = selectedTariffs[meter.id] || meter.tariff_structure_id || "";
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
            </>
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

      {/* Chart Detail Dialog for Analysis Tab */}
      <Dialog open={!!selectedChartMeter} onOpenChange={() => setSelectedChartMeter(null)}>
        <DialogContent className="max-w-6xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Meter Analysis: {selectedChartMeter?.meter.meter_number}</DialogTitle>
            <DialogDescription>
              Billing cost trend and associated documents
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[70vh] pr-4">
            {selectedChartMeter && (() => {
              const chartData = addSeasonalAverages(selectedChartMeter.docs).map(item => ({
                ...item,
                calculatedAmount: hideSeasonalAverages && item.documentId
                  ? calculatedCosts[item.documentId] || null
                  : null,
              }));
              
              const currencies = new Set(selectedChartMeter.docs.map(d => d.currency));
              const hasMixedCurrencies = currencies.size > 1;
              
              return (
                <div className="space-y-6">
                  {/* Enlarged Chart */}
                  <Card>
                    <CardHeader className="pb-4">
                      <CardTitle>Billing Cost Over Time</CardTitle>
                      {hasMixedCurrencies && (
                        <Alert variant="destructive" className="mt-2">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            Warning: Documents have mixed currencies ({Array.from(currencies).join(', ')})
                          </AlertDescription>
                        </Alert>
                      )}
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          amount: {
                            label: hideSeasonalAverages ? "Document Amount" : "Amount",
                            color: "hsl(var(--primary))",
                          },
                          calculatedAmount: {
                            label: "Calculated from Tariff",
                            color: "hsl(142 76% 36%)",
                          },
                          winterAvg: {
                            label: "Winter Average",
                            color: "hsl(200 100% 40%)",
                          },
                          summerAvg: {
                            label: "Summer Average",
                            color: "hsl(25 100% 50%)",
                          },
                        }}
                        className="h-[400px]"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 60 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis 
                              dataKey="period" 
                              tick={{ fontSize: 12 }}
                              angle={-45}
                              textAnchor="end"
                              height={80}
                            />
                            <YAxis 
                              tick={{ fontSize: 12 }}
                              tickFormatter={(value) => `R${(value / 1000).toFixed(0)}k`}
                            />
                            <ChartTooltip 
                              content={<ChartTooltipContent />}
                            />
                            <Bar 
                              dataKey="amount" 
                              fill="hsl(var(--primary))"
                              radius={[4, 4, 0, 0]}
                              name={hideSeasonalAverages ? "Document Amount" : "Amount"}
                            />
                            {hideSeasonalAverages && (
                              <Bar 
                                dataKey="calculatedAmount" 
                                fill="hsl(142 76% 36%)"
                                radius={[4, 4, 0, 0]}
                                name="Calculated from Tariff"
                              />
                            )}
                            {!hideSeasonalAverages && (
                              <>
                                <Line
                                  type="monotone"
                                  dataKey="winterAvg"
                                  stroke="hsl(200 100% 40%)"
                                  strokeWidth={4}
                                  dot={{ r: 5, fill: "hsl(200 100% 40%)" }}
                                  connectNulls={false}
                                />
                                <Line
                                  type="monotone"
                                  dataKey="summerAvg"
                                  stroke="hsl(25 100% 50%)"
                                  strokeWidth={4}
                                  dot={{ r: 5, fill: "hsl(25 100% 50%)" }}
                                  connectNulls={false}
                                />
                              </>
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  {/* Associated Documents */}
                  <div className="space-y-3">
                    <h4 className="font-semibold">Associated Documents ({selectedChartMeter.docs.length})</h4>
                    {selectedChartMeter.docs.map((doc, idx) => (
                      <Collapsible
                        key={idx}
                        open={expandedShopDocs.has(idx)}
                        onOpenChange={(open) => {
                          const newExpanded = new Set(expandedShopDocs);
                          if (open) {
                            newExpanded.add(idx);
                          } else {
                            newExpanded.delete(idx);
                          }
                          setExpandedShopDocs(newExpanded);
                        }}
                        className="border rounded-lg"
                      >
                        <CollapsibleTrigger className="w-full p-4 hover:bg-muted/50 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <ChevronDown 
                                className={cn(
                                  "w-4 h-4 text-muted-foreground transition-transform",
                                  expandedShopDocs.has(idx) && "rotate-180"
                                )} 
                              />
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium">{doc.shopNumber}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-sm text-muted-foreground">
                                {new Date(doc.periodStart).toLocaleDateString()} - {new Date(doc.periodEnd).toLocaleDateString()}
                              </span>
                              <Badge variant="outline" className="font-mono">
                                {doc.currency} {doc.totalAmount.toFixed(2)}
                              </Badge>
                            </div>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="px-4 pb-4">
                          <div className="space-y-3 pt-2">
                            {doc.tenantName && (
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-muted-foreground">Tenant:</span>
                                <span className="text-sm">{doc.tenantName}</span>
                              </div>
                            )}
                            {doc.accountReference && (
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-muted-foreground">Account:</span>
                                <span className="text-sm font-mono">{doc.accountReference}</span>
                              </div>
                            )}
                            {doc.lineItems && doc.lineItems.length > 0 && (
                              <div className="space-y-2">
                                <span className="text-sm font-medium text-muted-foreground">Line Items:</span>
                                <div className="border rounded-lg overflow-hidden">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-xs">Description</TableHead>
                                        <TableHead className="text-xs">Consumption</TableHead>
                                        <TableHead className="text-xs">Rate</TableHead>
                                        <TableHead className="text-xs text-right">Amount</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {doc.lineItems.map((item, itemIdx) => (
                                        <TableRow key={itemIdx}>
                                          <TableCell className="text-xs">{item.description}</TableCell>
                                          <TableCell className="text-xs">
                                            {item.consumption ? `${item.consumption.toFixed(2)} kWh` : '—'}
                                          </TableCell>
                                          <TableCell className="text-xs">
                                            {item.rate ? `${doc.currency} ${item.rate.toFixed(4)}` : '—'}
                                          </TableCell>
                                          <TableCell className="text-xs text-right font-medium">
                                            {doc.currency} {item.amount.toFixed(2)}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                </div>
              );
            })()}
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
          
          {/* Chart Section */}
          {!showDocumentCharts && viewingAllDocs && viewingAllDocs.docs.length > 1 && (() => {
            // Transform and sort data for chart with seasonal averages
            const chartData = addSeasonalAverages(viewingAllDocs.docs);
            
            // Check for mixed currencies
            const currencies = new Set(viewingAllDocs.docs.map(d => d.currency));
            const hasMixedCurrencies = currencies.size > 1;
            
            return (
              <Card className="mb-4">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Billing Cost Over Time</CardTitle>
                  {hasMixedCurrencies && (
                    <Alert variant="destructive" className="mt-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Warning: Documents have mixed currencies ({Array.from(currencies).join(', ')})
                      </AlertDescription>
                    </Alert>
                  )}
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      amount: {
                        label: "Amount",
                        color: "hsl(var(--primary))",
                      },
                      winterAvg: {
                        label: "Winter Average",
                        color: "hsl(200 100% 40%)",
                      },
                      summerAvg: {
                        label: "Summer Average",
                        color: "hsl(25 100% 50%)",
                      },
                    }}
                    className="h-[300px]"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis 
                          dataKey="period" 
                          angle={-45}
                          textAnchor="end"
                          height={80}
                          className="text-xs"
                        />
                        <YAxis 
                          tickFormatter={(value) => `R ${value.toLocaleString()}`}
                          className="text-xs"
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => value}
                              formatter={(value: number) => [
                                `R ${value.toFixed(2)}`,
                                "Amount"
                              ]}
                            />
                          }
                        />
                        <Bar 
                          dataKey="amount" 
                          fill="hsl(var(--primary))"
                          radius={[4, 4, 0, 0]}
                        />
                        <Line
                          type="monotone"
                          dataKey="winterAvg"
                          stroke="hsl(200 100% 40%)"
                          strokeWidth={3.5}
                          dot={{ r: 4, fill: "hsl(200 100% 40%)" }}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="summerAvg"
                          stroke="hsl(25 100% 50%)"
                          strokeWidth={3.5}
                          dot={{ r: 4, fill: "hsl(25 100% 50%)" }}
                          connectNulls={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </CardContent>
              </Card>
            );
          })()}
          
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
