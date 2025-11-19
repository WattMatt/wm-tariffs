import React, { useState, useEffect } from "react";
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
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculationProgress, setCalculationProgress] = useState({ current: 0, total: 0 });
  const [cancelCalculations, setCancelCalculations] = useState(false);
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
  const [viewingDocCalculations, setViewingDocCalculations] = useState<any[]>([]);
  const [chartDialogCalculations, setChartDialogCalculations] = useState<Record<string, any>>({});

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

  // Helper function to add seasonal averages with properly segmented lines
  const addSeasonalAverages = (docs: DocumentShopNumber[]) => {
    // Use calculated costs as primary data source, with document amounts as fallback
    const validDocs = docs.filter(doc => {
      const calculatedCost = calculatedCosts[doc.documentId];
      return calculatedCost !== undefined && calculatedCost !== null;
    });
    
    // Calculate seasonal averages
    let winterAvg: number | null = null;
    let summerAvg: number | null = null;
    
    if (validDocs.length > 0) {
      const avgData = calculateSeasonalAveragesFromCalculated(validDocs);
      winterAvg = avgData.winterAvg;
      summerAvg = avgData.summerAvg;
    } else if (docs.length > 0) {
      const avgData = calculateSeasonalAverages(docs);
      winterAvg = avgData.winterAvg;
      summerAvg = avgData.summerAvg;
    }
    
    // South African electricity seasons
    const winterMonths = [6, 7, 8];
    const summerMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];
    
    // Sort documents by date
    const sortedDocs = [...docs].sort((a, b) => 
      new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime()
    );
    
    // Track season segments to break lines across season changes
    let winterSegment = 0;
    let summerSegment = 0;
    let lastSeason: 'winter' | 'summer' | null = null;
    
    return sortedDocs.map((doc, index) => {
      const month = new Date(doc.periodStart).getMonth() + 1;
      const calculatedCost = calculatedCosts[doc.documentId];
      const isWinter = winterMonths.includes(month);
      const isSummer = summerMonths.includes(month);
      const currentSeason = isWinter ? 'winter' : isSummer ? 'summer' : null;
      
      // Increment segment counter when season changes
      if (lastSeason && currentSeason && lastSeason !== currentSeason) {
        if (currentSeason === 'winter') winterSegment++;
        if (currentSeason === 'summer') summerSegment++;
      }
      lastSeason = currentSeason;
      
      // Create base data point
      const dataPoint: any = {
        period: new Date(doc.periodStart).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }),
        amount: calculatedCost !== undefined ? calculatedCost : (doc.totalAmount || 0),
        documentAmount: doc.totalAmount || null,
        documentId: doc.documentId,
      };
      
      // Add segmented seasonal averages
      if (isWinter) {
        dataPoint[`winterAvg_${winterSegment}`] = winterAvg;
      }
      if (isSummer) {
        dataPoint[`summerAvg_${summerSegment}`] = summerAvg;
      }
      
      return dataPoint;
    });
  };
  
  // Calculate seasonal averages from calculated costs
  const calculateSeasonalAveragesFromCalculated = (docs: DocumentShopNumber[]) => {
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
      ? winterDocs.reduce((sum, doc) => sum + (calculatedCosts[doc.documentId] || 0), 0) / winterDocs.length
      : null;
    
    const summerAvg = summerDocs.length > 0
      ? summerDocs.reduce((sum, doc) => sum + (calculatedCosts[doc.documentId] || 0), 0) / summerDocs.length
      : null;
    
    return { winterAvg, summerAvg };
  };
  const [selectedChartMeter, setSelectedChartMeter] = useState<{ meter: Meter; docs: DocumentShopNumber[] } | null>(null);
  const [calculatedCosts, setCalculatedCosts] = useState<{ [docId: string]: number }>({});
  const [isCalculatingCosts, setIsCalculatingCosts] = useState(false);
  
  // Rate comparison state
  const [rateComparisonMeter, setRateComparisonMeter] = useState<Meter | null>(null);
  const [rateComparisonData, setRateComparisonData] = useState<{
    overallStatus: 'match' | 'partial' | 'mismatch' | 'unknown';
    documentComparisons: Array<{
      calculation: {
        id: string;
        document_id: string;
        total_cost: number;
        energy_cost: number;
        fixed_charges: number;
        total_kwh: number;
        avg_cost_per_kwh: number | null;
        document_billed_amount: number | null;
        variance_amount: number | null;
        variance_percentage: number | null;
        calculation_error: string | null;
        tariff_name: string | null;
        period_start: string;
        period_end: string;
      };
      document: DocumentShopNumber;
      hasError: boolean;
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

  // Load calculated costs when documents are available
  useEffect(() => {
    if (documentShopNumbers.length > 0 && meters.length > 0) {
      calculateAllCosts();
    }
  }, [documentShopNumbers.length, meters.length]);

  // Load calculated costs from database
  const calculateAllCosts = async () => {
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
    const docsToProcess = documentShopNumbers.filter(doc => doc.meterId);
    const total = docsToProcess.length;
    
    setCalculationProgress({ current: 0, total });
    setIsCalculating(true);
    setCancelCalculations(false);

    for (let i = 0; i < docsToProcess.length; i++) {
      // Check if user cancelled
      if (cancelCalculations) {
        console.log("Calculations cancelled by user");
        break;
      }

      const doc = docsToProcess[i];
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
        
        // Update progress
        setCalculationProgress({ current: i + 1, total });
      } catch (error) {
        console.error(`Failed to calculate cost for document ${doc.documentId}:`, error);
      }
    }

    // Store all calculations in the database (upsert to handle updates)
    if (calculations.length > 0 && !cancelCalculations) {
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
    
    setIsCalculating(false);
    setCalculationProgress({ current: 0, total: 0 });
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
          
          // Determine identifier with fallbacks for different meter types
          let identifier = extractedData.shop_number;
          if (!identifier) {
            // For council/bulk meters without shop numbers
            identifier = extractedData.account_reference || 
                         extractedData.tenant_name || 
                         "Council Invoice";
          }

          shopNumbers.push({
            documentId: doc.id,
            fileName: doc.file_name,
            shopNumber: identifier,
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

  // Helper function to categorize line items by charge type
  const categorizeLineItems = (lineItems: any[]) => {
    const categories = {
      energy: [] as any[],
      basic: [] as any[],
      generator: [] as any[],
      other: [] as any[]
    };
    
    lineItems?.forEach(item => {
      const desc = item.description?.toLowerCase() || '';
      
      if ((desc.includes('kwh') || desc.includes('energy') || desc.includes('conv') || desc.includes('consumption')) && 
          !desc.includes('generator') && !desc.includes('basic')) {
        categories.energy.push(item);
      } else if (desc.includes('basic') || desc.includes('fixed') || desc.includes('admin')) {
        categories.basic.push(item);
      } else if (desc.includes('generator') || desc.includes('gen')) {
        categories.generator.push(item);
      } else {
        categories.other.push(item);
      }
    });
    
    return categories;
  };

  // Helper function to extract charge type data
  interface ChargeTypeRow {
    name: string;
    doc: { consumption: string; rate: string; cost: string };
    calc: { consumption: string; rate: string; cost: string };
    variance: { consumption: { value: string; color: string }; rate: { value: string; color: string }; cost: { value: string; color: string } };
  }

  const extractChargeTypeData = (
    doc: any,
    calc: any,
    categories: ReturnType<typeof categorizeLineItems>,
    currency: string
  ): ChargeTypeRow[] => {
    const rows: ChargeTypeRow[] = [];
    
    // Calculate variance with color coding
    const calcVariance = (docVal: number | null, calcVal: number | null, unit: string = '') => {
      if (docVal === null || calcVal === null) {
        return { value: '—', color: '' };
      }
      const variance = calcVal - docVal;
      const prefix = variance >= 0 ? '+' : '';
      const color = variance > 0 ? 'text-destructive' : variance < 0 ? 'text-green-600' : '';
      return { 
        value: `${prefix}${variance.toFixed(2)}${unit}`, 
        color 
      };
    };
    
    // Energy Charge
    if (categories.energy.length > 0 || calc.energy_cost > 0) {
      const energyItems = categories.energy;
      const docConsumption = energyItems.reduce((sum, item) => sum + (item.consumption || 0), 0);
      const docRate = energyItems.length > 0 && energyItems[0].rate 
        ? energyItems[0].rate 
        : docConsumption > 0 ? energyItems.reduce((sum, item) => sum + (item.amount || 0), 0) / docConsumption : null;
      const docCost = energyItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      
      const calcConsumption = calc.total_kwh || 0;
      const calcRate = calcConsumption > 0 ? calc.energy_cost / calcConsumption : null;
      const calcCost = calc.energy_cost || 0;
      
      rows.push({
        name: 'Energy Charge',
        doc: {
          consumption: docConsumption > 0 ? `${docConsumption.toFixed(2)} kWh` : '—',
          rate: docRate !== null ? `${currency} ${docRate.toFixed(4)}/kWh` : '—',
          cost: docCost > 0 ? `${currency} ${docCost.toFixed(2)}` : '—'
        },
        calc: {
          consumption: calcConsumption > 0 ? `${calcConsumption.toFixed(2)} kWh` : '—',
          rate: calcRate !== null ? `${currency} ${calcRate.toFixed(4)}/kWh` : '—',
          cost: calcCost > 0 ? `${currency} ${calcCost.toFixed(2)}` : '—'
        },
        variance: {
          consumption: calcVariance(docConsumption > 0 ? docConsumption : null, calcConsumption > 0 ? calcConsumption : null, ' kWh'),
          rate: calcVariance(docRate, calcRate, `/kWh`),
          cost: calcVariance(docCost > 0 ? docCost : null, calcCost > 0 ? calcCost : null)
        }
      });
    }
    
    // Basic/Fixed Charge
    if (categories.basic.length > 0 || calc.fixed_charges > 0) {
      const basicItems = categories.basic;
      const docCost = basicItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      const calcCost = calc.fixed_charges || 0;
      
      rows.push({
        name: 'Basic Charge',
        doc: {
          consumption: '—',
          rate: '—',
          cost: docCost > 0 ? `${currency} ${docCost.toFixed(2)}` : '—'
        },
        calc: {
          consumption: '—',
          rate: '—',
          cost: calcCost > 0 ? `${currency} ${calcCost.toFixed(2)}` : '—'
        },
        variance: {
          consumption: { value: '—', color: '' },
          rate: { value: '—', color: '' },
          cost: calcVariance(docCost > 0 ? docCost : null, calcCost > 0 ? calcCost : null)
        }
      });
    }
    
    // Generator Charge (document only typically)
    if (categories.generator.length > 0) {
      const genItems = categories.generator;
      const docConsumption = genItems.reduce((sum, item) => sum + (item.consumption || 0), 0);
      const docRate = genItems.length > 0 && genItems[0].rate ? genItems[0].rate : null;
      const docCost = genItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      
      rows.push({
        name: 'Generator Charge',
        doc: {
          consumption: docConsumption > 0 ? `${docConsumption.toFixed(2)} kWh` : '—',
          rate: docRate !== null ? `${currency} ${docRate.toFixed(4)}/kWh` : '—',
          cost: docCost > 0 ? `${currency} ${docCost.toFixed(2)}` : '—'
        },
        calc: {
          consumption: '—',
          rate: '—',
          cost: '—'
        },
        variance: {
          consumption: { value: '—', color: '' },
          rate: { value: '—', color: '' },
          cost: calcVariance(docCost > 0 ? docCost : null, null)
        }
      });
    }
    
    // Other charges
    if (categories.other.length > 0) {
      const otherItems = categories.other;
      const docCost = otherItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      
      if (docCost > 0) {
        rows.push({
          name: 'Other Charges',
          doc: {
            consumption: '—',
            rate: '—',
            cost: `${currency} ${docCost.toFixed(2)}`
          },
          calc: {
            consumption: '—',
            rate: '—',
            cost: '—'
          },
          variance: {
            consumption: { value: '—', color: '' },
            rate: { value: '—', color: '' },
            cost: calcVariance(docCost, null)
          }
        });
      }
    }
    
    return rows;
  };

  // Helper function to calculate overall status based on stored calculations
  const calculateOverallStatus = (
    comparisons: Array<{ calculation: any; document: any; hasError: boolean }>
  ): 'match' | 'partial' | 'mismatch' | 'unknown' => {
    if (comparisons.length === 0) return 'unknown';
    
    let matchCount = 0;
    let partialCount = 0;
    let mismatchCount = 0;
    let unknownCount = 0;
    
    comparisons.forEach(comp => {
      if (comp.hasError || !comp.calculation.variance_percentage) {
        unknownCount++;
      } else {
        const variancePercent = Math.abs(comp.calculation.variance_percentage);
        if (variancePercent <= 5) {
          matchCount++;
        } else if (variancePercent <= 10) {
          partialCount++;
        } else {
          mismatchCount++;
        }
      }
    });
    
    // Worst status wins
    if (mismatchCount > 0) return 'mismatch';
    if (partialCount > 0) return 'partial';
    if (unknownCount > 0) return 'unknown';
    return 'match';
  };

  // Handle viewing rate comparison - Fetch from stored calculations
  const handleViewRateComparison = async (meter: Meter) => {
    const assignedTariffId = selectedTariffs[meter.id] || meter.tariff_structure_id;
    
    if (!assignedTariffId) {
      toast.error("Please assign a tariff to this meter first");
      return;
    }
    
    // Fetch stored calculations from document_tariff_calculations table
    const { data: storedCalculations, error } = await supabase
      .from("document_tariff_calculations")
      .select(`
        id,
        document_id,
        meter_id,
        tariff_structure_id,
        period_start,
        period_end,
        total_cost,
        energy_cost,
        fixed_charges,
        total_kwh,
        avg_cost_per_kwh,
        document_billed_amount,
        variance_amount,
        variance_percentage,
        calculation_error,
        tariff_name
      `)
      .eq("meter_id", meter.id)
      .eq("tariff_structure_id", assignedTariffId)
      .order("period_start", { ascending: false });
    
    if (error) {
      console.error("Error fetching stored calculations:", error);
      toast.error("Failed to fetch stored calculations");
      return;
    }
    
    if (!storedCalculations || storedCalculations.length === 0) {
      toast.error("No calculated costs found. Please save tariff assignments first to calculate costs.");
      return;
    }
    
    // Match calculations with document data
    const documentComparisons = storedCalculations
      .map(calc => {
        // Find matching document from documentShopNumbers
        const matchingDoc = documentShopNumbers.find(doc => doc.documentId === calc.document_id);
        
        if (!matchingDoc) return null;
        
        return {
          calculation: calc,
          document: matchingDoc,
          hasError: !!calc.calculation_error
        };
      })
      .filter((comp): comp is NonNullable<typeof comp> => comp !== null);
    
    if (documentComparisons.length === 0) {
      toast.error("No matching documents found for stored calculations");
      return;
    }
    
    // Calculate overall status based on variance
    const overallStatus = calculateOverallStatus(documentComparisons);
    
    setRateComparisonData({
      overallStatus,
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
      
      setIsSaving(false);
      fetchMeters();
      
      // Calculate and store costs in the background (non-blocking)
      calculateAndStoreCosts().then(() => {
        if (!cancelCalculations) {
          toast.success("Tariff cost calculations completed");
        } else {
          toast.info("Calculations cancelled");
        }
      }).catch((error) => {
        console.error("Error calculating costs:", error);
        toast.error("Failed to calculate costs for some documents");
      });
    } catch (error) {
      console.error("Error saving tariff assignments:", error);
      toast.error("Failed to save tariff assignments");
      setIsSaving(false);
    }
  };

  const handleCancelCalculations = () => {
    setCancelCalculations(true);
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
                      let chartData = addSeasonalAverages(filteredShops);
                      
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
                                  label: "Calculated Cost",
                                  color: "hsl(var(--primary))",
                                },
                                documentAmount: {
                                  label: "Document Billed",
                                  color: "hsl(var(--muted-foreground))",
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
                                   {!hideSeasonalAverages && (() => {
                                    // Extract all unique seasonal segment keys from the data
                                    const segmentKeys = new Set<string>();
                                    chartData.forEach((point: any) => {
                                      Object.keys(point).forEach(key => {
                                        if (key.startsWith('winterAvg_') || key.startsWith('summerAvg_')) {
                                          segmentKeys.add(key);
                                        }
                                      });
                                    });
                                    
                                    // Render a Line for each segment
                                    return Array.from(segmentKeys).map(key => {
                                      const isWinter = key.startsWith('winterAvg_');
                                      const color = isWinter ? "hsl(200 100% 40%)" : "hsl(25 100% 50%)";
                                      
                                      return (
                                        <Line
                                          key={key}
                                          type="monotone"
                                          dataKey={key}
                                          stroke={color}
                                          strokeWidth={3}
                                          dot={{ r: 4, fill: color }}
                                          connectNulls={false}
                                        />
                                      );
                                    });
                                  })()}
                                  <Bar 
                                    dataKey="amount" 
                                    fill="hsl(var(--muted-foreground))"
                                    radius={[4, 4, 0, 0]}
                                    name="Calculated Cost"
                                    opacity={0.5}
                                  />
                                  {hideSeasonalAverages && (
                                    <Bar 
                                      dataKey="documentAmount" 
                                      fill="hsl(var(--primary))"
                                      radius={[4, 4, 0, 0]}
                                      name="Document Billed"
                                    />
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
                    <Button 
                      onClick={isCalculating ? handleCancelCalculations : handleSaveAssignments} 
                      disabled={isSaving || isCalculating}
                      variant={isCalculating ? "destructive" : "default"}
                    >
                      {isCalculating ? (
                        <>
                          <X className="w-4 h-4 mr-2" />
                          Calculating {calculationProgress.current}/{calculationProgress.total} (Click to Cancel)
                        </>
                      ) : isSaving ? (
                        <>
                          <FileCheck2 className="w-4 h-4 mr-2" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <FileCheck2 className="w-4 h-4 mr-2" />
                          Save Assignments
                        </>
                      )}
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

                {/* Cost Comparison - One section per document */}
                <div className="space-y-3">
                  <h4 className="font-semibold">Cost Comparison by Document</h4>
                
                {rateComparisonData.documentComparisons.map((comparison, idx) => {
                  const isExpanded = expandedDocuments.has(idx);
                  const calc = comparison.calculation;
                  const doc = comparison.document;
                  
                  // Calculate variance badge
                  const getVarianceBadge = () => {
                    if (calc.calculation_error) {
                      return { variant: 'destructive' as const, label: 'ERROR', className: '' };
                    }
                    if (!calc.variance_percentage) {
                      return { variant: 'outline' as const, label: 'NO DATA', className: '' };
                    }
                    const variancePercent = Math.abs(calc.variance_percentage);
                    if (variancePercent <= 5) {
                      return { variant: 'default' as const, label: `${variancePercent.toFixed(1)}%`, className: 'bg-green-500 hover:bg-green-600' };
                    } else if (variancePercent <= 10) {
                      return { variant: 'secondary' as const, label: `${variancePercent.toFixed(1)}%`, className: 'bg-amber-500 hover:bg-amber-600' };
                    } else {
                      return { variant: 'destructive' as const, label: `${variancePercent.toFixed(1)}%`, className: '' };
                    }
                  };
                  
                  const badge = getVarianceBadge();
                  
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
                            <span className="font-medium">{doc.shopNumber}</span>
                            <span className="text-sm text-muted-foreground">
                              ({new Date(calc.period_start).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })} - {new Date(calc.period_end).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })})
                            </span>
                          </div>
                          <Badge 
                            variant={badge.variant}
                            className={badge.className}
                          >
                            {badge.label}
                          </Badge>
                        </div>
                      </CollapsibleTrigger>

                      <CollapsibleContent className="px-4 pb-4 space-y-4">
                        {/* Error Display */}
                        {calc.calculation_error && (
                          <div className="p-3 bg-destructive/10 border border-destructive rounded-md">
                            <p className="text-sm font-medium text-destructive">Calculation Error:</p>
                            <p className="text-sm text-destructive/80 mt-1">{calc.calculation_error}</p>
                          </div>
                        )}
                        
                        {/* Summary Cards */}
                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-3 border rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">Document Amount</p>
                            <p className="text-lg font-semibold">
                              {calc.document_billed_amount ? `R ${calc.document_billed_amount.toFixed(2)}` : 'N/A'}
                            </p>
                          </div>
                          <div className="p-3 border rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">Calculated Cost</p>
                            <p className="text-lg font-semibold">R {calc.total_cost.toFixed(2)}</p>
                          </div>
                          <div className="p-3 border rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">Variance</p>
                            <p className={cn(
                              "text-lg font-semibold",
                              calc.variance_amount && calc.variance_amount > 0 ? "text-red-600" : 
                              calc.variance_amount && calc.variance_amount < 0 ? "text-green-600" : ""
                            )}>
                              {calc.variance_amount ? `R ${calc.variance_amount.toFixed(2)}` : 'N/A'}
                            </p>
                          </div>
                        </div>
                        
                        {/* Detailed Breakdown Table with Comparison */}
                        <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Document</TableHead>
                          <TableHead className="text-right">Calculated</TableHead>
                          <TableHead className="text-right">Variance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium">Energy Cost</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {(() => {
                              // Filter line items for council/bulk meters to only include electricity charges
                              const filteredItems = rateComparisonMeter?.meter_type === 'council_meter' || 
                                                   rateComparisonMeter?.meter_type === 'bulk_meter'
                                ? doc.lineItems?.filter(item => 
                                    item.description?.toLowerCase().includes('electricity')
                                  )
                                : doc.lineItems;
                              
                              return filteredItems?.reduce((sum, item) => 
                                sum + (item.description?.toLowerCase().includes('energy') || 
                                       item.description?.toLowerCase().includes('kwh') ? item.amount : 0), 0
                              ).toFixed(2) || '—';
                            })()}
                          </TableCell>
                          <TableCell className="text-right">R {calc.energy_cost.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            {(() => {
                              const filteredItems = rateComparisonMeter?.meter_type === 'council_meter' || 
                                                   rateComparisonMeter?.meter_type === 'bulk_meter'
                                ? doc.lineItems?.filter(item => 
                                    item.description?.toLowerCase().includes('electricity')
                                  )
                                : doc.lineItems;
                              
                              const docEnergyCost = filteredItems?.reduce((sum, item) => 
                                sum + (item.description?.toLowerCase().includes('energy') || 
                                       item.description?.toLowerCase().includes('kwh') ? item.amount : 0), 0
                              );
                              
                              return docEnergyCost 
                                ? `R ${(calc.energy_cost - docEnergyCost).toFixed(2)}`
                                : '—';
                            })()}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Fixed Charges</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {(() => {
                              const filteredItems = rateComparisonMeter?.meter_type === 'council_meter' || 
                                                   rateComparisonMeter?.meter_type === 'bulk_meter'
                                ? doc.lineItems?.filter(item => 
                                    item.description?.toLowerCase().includes('electricity')
                                  )
                                : doc.lineItems;
                              
                              return filteredItems?.reduce((sum, item) => 
                                sum + (!item.description?.toLowerCase().includes('energy') && 
                                       !item.description?.toLowerCase().includes('kwh') &&
                                       !item.description?.toLowerCase().includes('total') ? item.amount : 0), 0
                              ).toFixed(2) || '—';
                            })()}
                          </TableCell>
                          <TableCell className="text-right">R {calc.fixed_charges.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            {(() => {
                              const filteredItems = rateComparisonMeter?.meter_type === 'council_meter' || 
                                                   rateComparisonMeter?.meter_type === 'bulk_meter'
                                ? doc.lineItems?.filter(item => 
                                    item.description?.toLowerCase().includes('electricity')
                                  )
                                : doc.lineItems;
                              
                              const docFixedCharges = filteredItems?.reduce((sum, item) => 
                                sum + (!item.description?.toLowerCase().includes('energy') && 
                                       !item.description?.toLowerCase().includes('kwh') &&
                                       !item.description?.toLowerCase().includes('total') ? item.amount : 0), 0
                              );
                              
                              return docFixedCharges 
                                ? `R ${(calc.fixed_charges - docFixedCharges).toFixed(2)}`
                                : '—';
                            })()}
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-t-2">
                          <TableCell className="font-semibold">Total Cost</TableCell>
                          <TableCell className="text-right font-semibold">
                            R {calc.document_billed_amount?.toFixed(2) || doc.totalAmount?.toFixed(2) || '—'}
                          </TableCell>
                          <TableCell className="text-right font-semibold">R {calc.total_cost.toFixed(2)}</TableCell>
                          <TableCell className={cn(
                            "text-right font-semibold",
                            calc.variance_amount && calc.variance_amount > 0 ? "text-red-600" : 
                            calc.variance_amount && calc.variance_amount < 0 ? "text-green-600" : ""
                          )}>
                            {calc.variance_amount ? `R ${calc.variance_amount.toFixed(2)}` : '—'}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium text-muted-foreground">Total kWh</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {doc.lineItems?.reduce((sum, item) => 
                              sum + (item.consumption || 0), 0
                            ).toFixed(2) || '—'} kWh
                          </TableCell>
                          <TableCell className="text-right" colSpan={2}>{calc.total_kwh.toFixed(2)} kWh</TableCell>
                        </TableRow>
                        {calc.avg_cost_per_kwh && (
                          <TableRow>
                            <TableCell className="font-medium text-muted-foreground">Avg Cost per kWh</TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {doc.totalAmount && doc.lineItems?.reduce((sum, item) => sum + (item.consumption || 0), 0)
                                ? `R ${(doc.totalAmount / doc.lineItems.reduce((sum, item) => sum + (item.consumption || 0), 0)).toFixed(4)}`
                                : '—'
                              }
                            </TableCell>
                            <TableCell className="text-right" colSpan={2}>R {calc.avg_cost_per_kwh.toFixed(4)}</TableCell>
                          </TableRow>
                        )}
                        {calc.tariff_name && (
                          <TableRow>
                            <TableCell className="font-medium text-muted-foreground">Tariff Used</TableCell>
                            <TableCell className="text-right text-muted-foreground" colSpan={3}>{calc.tariff_name}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                        </Table>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>

              {/* Help Text */}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Cost comparisons are based on pre-calculated values stored in the database.
                  Variance indicates the difference between the calculated cost and the document billed amount.
                  Green (&le;5%), Amber (5-10%), Red (&gt;10%) indicate the level of variance.
                </AlertDescription>
              </Alert>
            </div>
          )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Chart Detail Dialog for Analysis Tab */}
      <Dialog open={!!selectedChartMeter} onOpenChange={() => {
        setSelectedChartMeter(null);
        setChartDialogCalculations({});
      }}>
        <DialogContent className="max-w-6xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Meter Analysis: {selectedChartMeter?.meter.meter_number}</DialogTitle>
            <DialogDescription>
              Billing cost trend and associated documents
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[70vh] pr-4">
            {selectedChartMeter && (() => {
              const chartData = addSeasonalAverages(selectedChartMeter.docs);
              
              const currencies = new Set(selectedChartMeter.docs.map(d => d.currency));
              const hasMixedCurrencies = currencies.size > 1;
              
              // Fetch calculations when dialog opens
              if (Object.keys(chartDialogCalculations).length === 0) {
                const docIds = selectedChartMeter.docs.map(d => d.documentId);
                supabase
                  .from("document_tariff_calculations")
                  .select(`
                    *,
                    tariff_structures!inner(name)
                  `)
                  .in("document_id", docIds)
                  .then(({ data, error }) => {
                    if (!error && data) {
                      const calcsByDoc: Record<string, any> = {};
                      data.forEach(calc => {
                        calcsByDoc[calc.document_id] = calc;
                      });
                      setChartDialogCalculations(calcsByDoc);
                    }
                  });
              }
              
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
                            label: "Calculated Cost",
                            color: "hsl(var(--primary))",
                          },
                          documentAmount: {
                            label: "Document Billed",
                            color: "hsl(var(--muted-foreground))",
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
                            {!hideSeasonalAverages && (() => {
                              // Extract all unique seasonal segment keys from the data
                              const segmentKeys = new Set<string>();
                              chartData.forEach((point: any) => {
                                Object.keys(point).forEach(key => {
                                  if (key.startsWith('winterAvg_') || key.startsWith('summerAvg_')) {
                                    segmentKeys.add(key);
                                  }
                                });
                              });
                              
                              // Render a Line for each segment
                              return Array.from(segmentKeys).map(key => {
                                const isWinter = key.startsWith('winterAvg_');
                                const color = isWinter ? "hsl(200 100% 40%)" : "hsl(25 100% 50%)";
                                
                                return (
                                  <Line
                                    key={key}
                                    type="monotone"
                                    dataKey={key}
                                    stroke={color}
                                    strokeWidth={4}
                                    dot={{ r: 5, fill: color }}
                                    connectNulls={false}
                                  />
                                );
                              });
                            })()}
                            <Bar 
                              dataKey="amount" 
                              fill="hsl(var(--muted-foreground))"
                              radius={[4, 4, 0, 0]}
                              name="Calculated Cost"
                              opacity={0.5}
                            />
                            {hideSeasonalAverages && (
                              <Bar 
                                dataKey="documentAmount" 
                                fill="hsl(var(--primary))"
                                radius={[4, 4, 0, 0]}
                                name="Document Billed"
                              />
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
                            {/* Tariff Comparison */}
                            {chartDialogCalculations[doc.documentId] && (() => {
                              const calc = chartDialogCalculations[doc.documentId];
                              const categories = categorizeLineItems(doc.lineItems || []);
                              const chargeRows = extractChargeTypeData(doc, calc, categories, doc.currency);
                              
                              return (
                                <div className="space-y-2 mt-4 pt-4 border-t">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-muted-foreground">Rate Comparison: Document vs Tariff</span>
                                    <Badge variant={Math.abs(calc.variance_percentage || 0) > 10 ? "destructive" : "secondary"} className="text-xs">
                                      {calc.variance_percentage !== null 
                                        ? `${calc.variance_percentage >= 0 ? '+' : ''}${calc.variance_percentage.toFixed(1)}%`
                                        : 'N/A'}
                                    </Badge>
                                  </div>
                                  <div className="border rounded-lg overflow-hidden">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead className="text-xs">Charge Type</TableHead>
                                          <TableHead className="text-xs">Quantity</TableHead>
                                          <TableHead className="text-xs text-right">Document</TableHead>
                                          <TableHead className="text-xs text-right">Calculated</TableHead>
                                          <TableHead className="text-xs text-right">Variance</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {chargeRows.map((row, rowIdx) => (
                                          <React.Fragment key={rowIdx}>
                                            {/* Consumption Row */}
                                            <TableRow>
                                              <TableCell rowSpan={3} className="text-xs font-semibold border-r">
                                                {row.name}
                                              </TableCell>
                                              <TableCell className="text-xs text-muted-foreground">Consumption</TableCell>
                                              <TableCell className="text-xs text-right">{row.doc.consumption}</TableCell>
                                              <TableCell className="text-xs text-right">{row.calc.consumption}</TableCell>
                                              <TableCell className={cn("text-xs text-right", row.variance.consumption.color)}>
                                                {row.variance.consumption.value}
                                              </TableCell>
                                            </TableRow>
                                            {/* Rate Row */}
                                            <TableRow>
                                              <TableCell className="text-xs text-muted-foreground">Rate</TableCell>
                                              <TableCell className="text-xs text-right">{row.doc.rate}</TableCell>
                                              <TableCell className="text-xs text-right">{row.calc.rate}</TableCell>
                                              <TableCell className={cn("text-xs text-right", row.variance.rate.color)}>
                                                {row.variance.rate.value}
                                              </TableCell>
                                            </TableRow>
                                            {/* Cost Row */}
                                            <TableRow className="border-b-2">
                                              <TableCell className="text-xs text-muted-foreground">Cost</TableCell>
                                              <TableCell className="text-xs text-right font-medium">{row.doc.cost}</TableCell>
                                              <TableCell className="text-xs text-right font-medium">{row.calc.cost}</TableCell>
                                              <TableCell className={cn("text-xs text-right font-medium", row.variance.cost.color)}>
                                                {row.variance.cost.value}
                                              </TableCell>
                                            </TableRow>
                                          </React.Fragment>
                                        ))}
                                        {/* Summary Row */}
                                        <TableRow className="bg-muted/50 font-semibold">
                                          <TableCell colSpan={2} className="text-xs">TOTAL</TableCell>
                                          <TableCell className="text-xs text-right">
                                            {doc.currency} {(calc.document_billed_amount?.toFixed(2) || doc.totalAmount.toFixed(2))}
                                          </TableCell>
                                          <TableCell className="text-xs text-right">
                                            {doc.currency} {calc.total_cost.toFixed(2)}
                                          </TableCell>
                                          <TableCell className={cn(
                                            "text-xs text-right font-medium",
                                            calc.variance_amount && Math.abs(calc.variance_amount) > 0 
                                              ? calc.variance_amount > 0 ? "text-destructive" : "text-green-600"
                                              : ""
                                          )}>
                                            {calc.variance_amount !== null 
                                              ? `${calc.variance_amount >= 0 ? '+' : ''}${doc.currency} ${calc.variance_amount.toFixed(2)}`
                                              : '—'}
                                          </TableCell>
                                        </TableRow>
                                      </TableBody>
                                    </Table>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    Tariff: {calc.tariff_structures?.name || calc.tariff_name || 'N/A'}
                                  </div>
                                </div>
                              );
                            })()}
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
                        {(() => {
                          // Extract all unique seasonal segment keys from the data
                          const segmentKeys = new Set<string>();
                          chartData.forEach((point: any) => {
                            Object.keys(point).forEach(key => {
                              if (key.startsWith('winterAvg_') || key.startsWith('summerAvg_')) {
                                segmentKeys.add(key);
                              }
                            });
                          });
                          
                          // Render a Line for each segment
                          return Array.from(segmentKeys).map(key => {
                            const isWinter = key.startsWith('winterAvg_');
                            const color = isWinter ? "hsl(200 100% 40%)" : "hsl(25 100% 50%)";
                            
                            return (
                              <Line
                                key={key}
                                type="monotone"
                                dataKey={key}
                                stroke={color}
                                strokeWidth={3.5}
                                dot={{ r: 4, fill: color }}
                                connectNulls={false}
                              />
                            );
                          });
                        })()}
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
                              {(() => {
                                // Filter line items for council/bulk meters to only show electricity charges
                                const displayItems = viewingAllDocs?.meter.meter_type === 'council_meter' || 
                                                    viewingAllDocs?.meter.meter_type === 'bulk_meter'
                                  ? doc.lineItems.filter(item => 
                                      item.description?.toLowerCase().includes('electricity')
                                    )
                                  : doc.lineItems;
                                
                                return displayItems.map((item, itemIdx) => (
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
                                ));
                              })()}
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
      <Dialog open={!!viewingShopDoc} onOpenChange={() => {
        setViewingShopDoc(null);
        setViewingDocCalculations([]);
      }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Document Details</DialogTitle>
            <DialogDescription>
              Extracted information from uploaded document
            </DialogDescription>
          </DialogHeader>
          
          {viewingShopDoc && (
            <div className="space-y-4">
              {/* Fetch calculations on dialog open */}
              {(() => {
                // Fetch calculations when dialog opens
                if (viewingDocCalculations.length === 0 && viewingShopDoc.meterId) {
                  supabase
                    .from("document_tariff_calculations")
                    .select(`
                      *,
                      tariff_structures!inner(name)
                    `)
                    .eq("document_id", viewingShopDoc.documentId)
                    .then(({ data, error }) => {
                      if (!error && data) {
                        setViewingDocCalculations(data);
                      }
                    });
                }
                return null;
              })()}
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

                {/* Tariff Comparison Section */}
                {viewingDocCalculations.length > 0 && (
                  <div className="space-y-3 border-t pt-4">
                    <Label className="text-base font-semibold">Rate Comparison: Document vs Assigned Tariff</Label>
                    <div className="space-y-4">
                      {viewingDocCalculations.map((calc, idx) => (
                        <div key={idx} className="border rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{calc.tariff_structures?.name || 'Tariff Calculation'}</span>
                            <Badge variant={Math.abs(calc.variance_percentage || 0) > 10 ? "destructive" : "secondary"}>
                              {calc.variance_percentage !== null 
                                ? `${calc.variance_percentage >= 0 ? '+' : ''}${calc.variance_percentage.toFixed(1)}%`
                                : 'N/A'}
                            </Badge>
                          </div>
                          
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Metric</TableHead>
                                <TableHead className="text-right">Document</TableHead>
                                <TableHead className="text-right">Calculated</TableHead>
                                <TableHead className="text-right">Variance</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <TableRow>
                                <TableCell className="font-medium">Total kWh</TableCell>
                                <TableCell className="text-right">
                                  {viewingShopDoc.lineItems?.find(item => 
                                    item.consumption && item.description?.toLowerCase().includes('kwh')
                                  )?.consumption?.toFixed(2) || '—'}
                                </TableCell>
                                <TableCell className="text-right">{calc.total_kwh.toFixed(2)}</TableCell>
                                <TableCell className="text-right">—</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell className="font-medium">Energy Cost</TableCell>
                                <TableCell className="text-right">
                                  {viewingShopDoc.currency} {(viewingShopDoc.lineItems?.find(item => 
                                    item.description?.toLowerCase().includes('energy') || 
                                    item.description?.toLowerCase().includes('kwh ch')
                                  )?.amount || 0).toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {viewingShopDoc.currency} {calc.energy_cost.toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {(() => {
                                    const docEnergy = viewingShopDoc.lineItems?.find(item => 
                                      item.description?.toLowerCase().includes('energy') || 
                                      item.description?.toLowerCase().includes('kwh ch')
                                    )?.amount || 0;
                                    const variance = calc.energy_cost - docEnergy;
                                    return variance !== 0 ? `${variance >= 0 ? '+' : ''}${variance.toFixed(2)}` : '—';
                                  })()}
                                </TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell className="font-medium">Fixed Charges</TableCell>
                                <TableCell className="text-right">
                                  {viewingShopDoc.currency} {(viewingShopDoc.lineItems?.find(item => 
                                    item.description?.toLowerCase().includes('basic') || 
                                    item.description?.toLowerCase().includes('fixed')
                                  )?.amount || 0).toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {viewingShopDoc.currency} {calc.fixed_charges.toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {(() => {
                                    const docFixed = viewingShopDoc.lineItems?.find(item => 
                                      item.description?.toLowerCase().includes('basic') || 
                                      item.description?.toLowerCase().includes('fixed')
                                    )?.amount || 0;
                                    const variance = calc.fixed_charges - docFixed;
                                    return variance !== 0 ? `${variance >= 0 ? '+' : ''}${variance.toFixed(2)}` : '—';
                                  })()}
                                </TableCell>
                              </TableRow>
                              <TableRow className="font-semibold bg-muted/50">
                                <TableCell>Total Cost</TableCell>
                                <TableCell className="text-right">
                                  {viewingShopDoc.currency} {calc.document_billed_amount?.toFixed(2) || viewingShopDoc.totalAmount.toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {viewingShopDoc.currency} {calc.total_cost.toFixed(2)}
                                </TableCell>
                                <TableCell className={cn(
                                  "text-right font-medium",
                                  calc.variance_amount && Math.abs(calc.variance_amount) > 0 
                                    ? calc.variance_amount > 0 ? "text-destructive" : "text-green-600"
                                    : ""
                                )}>
                                  {calc.variance_amount !== null 
                                    ? `${calc.variance_amount >= 0 ? '+' : ''}${calc.variance_amount.toFixed(2)}`
                                    : '—'}
                                </TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell className="font-medium">Avg Cost per kWh</TableCell>
                                <TableCell className="text-right">
                                  {(() => {
                                    const consumption = viewingShopDoc.lineItems?.find(item => 
                                      item.consumption && item.description?.toLowerCase().includes('kwh')
                                    )?.consumption;
                                    const avgRate = consumption && consumption > 0
                                      ? (calc.document_billed_amount || viewingShopDoc.totalAmount) / consumption
                                      : null;
                                    return avgRate ? `${viewingShopDoc.currency} ${avgRate.toFixed(4)}` : '—';
                                  })()}
                                </TableCell>
                                <TableCell className="text-right">
                                  {viewingShopDoc.currency} {calc.avg_cost_per_kwh?.toFixed(4) || '—'}
                                </TableCell>
                                <TableCell className="text-right">—</TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Line Items Section */}
                {viewingShopDoc.lineItems && viewingShopDoc.lineItems.length > 0 && (
                  <div className="space-y-3 border-t pt-4">
                    <Label className="text-sm font-medium">Document Line Items</Label>
                    <Accordion type="single" collapsible className="w-full">
                      {(() => {
                        // Find the meter for this document and filter line items for council/bulk meters
                        const docMeter = viewingShopDoc.meterId 
                          ? meters.find(m => m.id === viewingShopDoc.meterId)
                          : null;
                        
                        const displayItems = docMeter?.meter_type === 'council_meter' || 
                                            docMeter?.meter_type === 'bulk_meter'
                          ? viewingShopDoc.lineItems.filter(item => 
                              item.description?.toLowerCase().includes('electricity')
                            )
                          : viewingShopDoc.lineItems;
                        
                        return displayItems.map((item, index) => (
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
                        ));
                      })()}
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
