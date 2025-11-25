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
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import TariffDetailsDialog from "@/components/tariffs/TariffDetailsDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { format } from "date-fns";
import { cn, formatDateString, formatDateStringToLong, formatDateStringToMonthYear, getMonthFromDateString, daysBetweenDateStrings, extractDateFromTimestamp } from "@/lib/utils";
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
  assigned_tariff_name: string | null;
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
  totalAmountExcludingEmergency?: number;
  currency: string;
  tenantName?: string;
  accountReference?: string;
  meterId?: string;
  reconciliationDateFrom?: string; // Reconciliation run start date (for display)
  reconciliationDateTo?: string; // Reconciliation run end date (for display)
  lineItems?: Array<{
    description: string;
    meter_number?: string;
    unit?: 'kWh' | 'kVA' | 'Monthly';
    supply?: 'Normal' | 'Emergency';
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
  const [enrichedDocuments, setEnrichedDocuments] = useState<DocumentShopNumber[]>([]);
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
  const [viewingAllDocsCalculations, setViewingAllDocsCalculations] = useState<Record<string, any>>({});
  const [selectedChartMetric, setSelectedChartMetric] = useState<string>('total');
  const [meterDiscontinuities, setMeterDiscontinuities] = useState<any[]>([]);
  const [hiddenDataKeys, setHiddenDataKeys] = useState<Set<string>>(new Set());

  // Handle legend click to toggle data series
  const handleLegendClick = (dataKey: string) => {
    setHiddenDataKeys(prev => {
      const newSet = new Set(prev);
      // Handle grouped seasonal averages
      if (dataKey === 'winterAvg' || dataKey === 'summerAvg') {
        const isHidden = Array.from(newSet).some(key => key.startsWith(dataKey));
        if (isHidden) {
          // Show all segments of this type
          Array.from(newSet).forEach(key => {
            if (key.startsWith(dataKey)) newSet.delete(key);
          });
        } else {
          // Hide all segments of this type
          chartData.forEach((point: any) => {
            Object.keys(point).forEach(key => {
              if (key.startsWith(dataKey)) newSet.add(key);
            });
          });
        }
      } else {
        // Toggle single data key
        if (newSet.has(dataKey)) {
          newSet.delete(dataKey);
        } else {
          newSet.add(dataKey);
        }
      }
      return newSet;
    });
  };

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

  // Helper to get metric label for display
  const getMetricLabel = (metric: string): string => {
    switch(metric) {
      case 'total': return 'Total Amount';
      case 'basic': return 'Basic Charge';
      case 'kva-charge': return 'kVA Charge';
      case 'kwh-charge': return 'kWh Charge';
      case 'kva-consumption': return 'kVA Consumption';
      case 'kwh-consumption': return 'kWh Consumption';
      default: return 'Total Amount';
    }
  };

  // Helper to extract metric value from document
  const extractMetricValue = (doc: DocumentShopNumber | undefined, metric: string): number | null => {
    if (!doc) return null;
    if (metric === 'total') return doc.totalAmount;
    
    const lineItems = doc.lineItems || [];
    
    switch(metric) {
      case 'basic':
        // Basic charge: unit is 'Monthly'
        const basicItem = lineItems.find(item => item.unit === 'Monthly');
        return basicItem?.amount || null;
      
      case 'kva-charge':
        // Demand charge: unit is 'kVA'
        const kvaItem = lineItems.find(item => item.unit === 'kVA');
        return kvaItem?.amount || null;
      
      case 'kwh-charge':
        // Energy charge: unit is 'kWh' AND supply is 'Normal' (exclude emergency/generator)
        const kwhItem = lineItems.find(item => 
          item.unit === 'kWh' && 
          item.supply === 'Normal'
        );
        return kwhItem?.amount || null;
      
      case 'kva-consumption':
        // Demand consumption: unit is 'kVA'
        const kvaConsumption = lineItems.find(item => item.unit === 'kVA');
        return kvaConsumption?.consumption || null;
      
      case 'kwh-consumption':
        // Energy consumption: unit is 'kWh' AND supply is 'Normal' (exclude emergency/generator)
        const kwhConsumption = lineItems.find(item => 
          item.unit === 'kWh' && 
          item.supply === 'Normal'
        );
        return kwhConsumption?.consumption || null;
      
      default:
        return doc.totalAmount;
    }
  };

  // Helper to extract meter readings from document based on metric
  const extractMeterReadings = (doc: DocumentShopNumber | undefined, metric: string): { previous: number | null, current: number | null } => {
    if (!doc) return { previous: null, current: null };
    
    const lineItems = doc.lineItems || [];
    let item = null;
    
    switch(metric) {
      case 'basic':
        item = lineItems.find(i => i.unit === 'Monthly');
        break;
      case 'kva-charge':
      case 'kva-consumption':
        item = lineItems.find(i => i.unit === 'kVA');
        break;
      case 'kwh-charge':
      case 'kwh-consumption':
        item = lineItems.find(i => i.unit === 'kWh' && i.supply === 'Normal');
        break;
      case 'total':
        // For total, try to find the main kWh charge
        item = lineItems.find(i => i.unit === 'kWh' && i.supply === 'Normal');
        break;
    }
    
    return {
      previous: item?.previous_reading || null,
      current: item?.current_reading || null
    };
  };

  // Helper function to calculate seasonal averages
  const calculateSeasonalAverages = (docs: DocumentShopNumber[], metric: string = 'total') => {
    // South African electricity seasons:
    // Winter/High Demand: June, July, August
    // Summer/Low Demand: September through May (all other months)
    const winterMonths = [6, 7, 8];
    const summerMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];
    
    const winterDocs = docs.filter(doc => {
      const month = getMonthFromDateString(doc.periodStart);
      return winterMonths.includes(month);
    });
    
    const summerDocs = docs.filter(doc => {
      const month = getMonthFromDateString(doc.periodStart);
      return summerMonths.includes(month);
    });
    
    const winterValues = winterDocs
      .map(doc => extractMetricValue(doc, metric))
      .filter(val => val !== null) as number[];
    
    const summerValues = summerDocs
      .map(doc => extractMetricValue(doc, metric))
      .filter(val => val !== null) as number[];
    
    const winterAvg = winterValues.length > 0
      ? winterValues.reduce((sum, val) => sum + val, 0) / winterValues.length
      : null;
    
    const summerAvg = summerValues.length > 0
      ? summerValues.reduce((sum, val) => sum + val, 0) / summerValues.length
      : null;
    
    return { winterAvg, summerAvg };
  };

  // Helper to detect meter reading discontinuities
  const detectDiscontinuities = (docs: DocumentShopNumber[], metric: string) => {
    const issues = [];
    for (let i = 0; i < docs.length - 1; i++) {
      const currentReadings = extractMeterReadings(docs[i], metric);
      const nextReadings = extractMeterReadings(docs[i + 1], metric);
      
      if (currentReadings.current !== null && nextReadings.previous !== null && 
          currentReadings.current !== nextReadings.previous) {
        issues.push({
          period: format(new Date(docs[i].periodEnd), 'MMM yyyy'),
          currentReading: currentReadings.current,
          nextPreviousReading: nextReadings.previous,
          difference: nextReadings.previous - currentReadings.current
        });
      }
    }
    return issues;
  };

  // Helper function for Analysis tab: uses selected metric
  const prepareAnalysisData = (docs: DocumentShopNumber[], metric: string = 'total') => {
    const winterMonths = [6, 7, 8];
    const summerMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];
    const sortedDocs = [...docs].sort((a, b) => 
      a.periodEnd.localeCompare(b.periodEnd)
    );
    
    interface Segment {
      season: 'winter' | 'summer';
      segmentIndex: number;
      docs: DocumentShopNumber[];
      average: number;
    }
    
    const segments: Segment[] = [];
    let winterSegment = -1;
    let summerSegment = -1;
    let lastSeason: 'winter' | 'summer' | null = null;
    let currentSegmentDocs: DocumentShopNumber[] = [];
    
    sortedDocs.forEach((doc, index) => {
      const month = getMonthFromDateString(doc.periodEnd);
      const isWinter = winterMonths.includes(month);
      const isSummer = summerMonths.includes(month);
      const currentSeason = isWinter ? 'winter' : isSummer ? 'summer' : null;
      
      if (!currentSeason) return;
      
      if (lastSeason !== currentSeason) {
        if (lastSeason && currentSegmentDocs.length > 0) {
          const segmentIndex = lastSeason === 'winter' ? winterSegment : summerSegment;
          const values = currentSegmentDocs
            .map(d => extractMetricValue(d, metric))
            .filter(v => v !== null && v > 0) as number[];
          
          if (values.length > 0) {
            const average = values.reduce((sum, val) => sum + val, 0) / values.length;
            segments.push({ season: lastSeason, segmentIndex, docs: [...currentSegmentDocs], average });
          }
        }
        
        currentSegmentDocs = [];
        if (currentSeason === 'winter') winterSegment++;
        if (currentSeason === 'summer') summerSegment++;
      }
      
      currentSegmentDocs.push(doc);
      lastSeason = currentSeason;
      
      if (index === sortedDocs.length - 1 && currentSegmentDocs.length > 0) {
        const segmentIndex = currentSeason === 'winter' ? winterSegment : summerSegment;
        const values = currentSegmentDocs
          .map(d => extractMetricValue(d, metric))
          .filter(v => v !== null && v > 0) as number[];
        
        if (values.length > 0) {
          const average = values.reduce((sum, val) => sum + val, 0) / values.length;
          segments.push({ season: currentSeason, segmentIndex, docs: [...currentSegmentDocs], average });
        }
      }
    });
    
    const chartData = sortedDocs.map((doc, index) => {
      const metricValue = extractMetricValue(doc, metric);
      const readings = extractMeterReadings(doc, metric);
      
      // Check if current reading matches next period's previous reading
      const nextReadings = index < sortedDocs.length - 1 ? extractMeterReadings(sortedDocs[index + 1], metric) : null;
      const isDiscontinuous = nextReadings && readings.current !== null && nextReadings.previous !== null && 
                              readings.current !== nextReadings.previous;
      
      const dataPoint: any = {
        period: formatDateStringToMonthYear(doc.periodEnd),
        amount: metricValue !== null ? metricValue : (doc.totalAmountExcludingEmergency ?? doc.totalAmount),
        documentAmount: (doc.totalAmountExcludingEmergency ?? doc.totalAmount) || null,
        documentId: doc.documentId,
        meterReading: readings.current,
        consumption: readings.current !== null && readings.previous !== null ? 
                    readings.current - readings.previous : null,
        isDiscontinuous
      };
      
      const matchingSegment = segments.find(seg => 
        seg.docs.some(d => d.documentId === doc.documentId)
      );
      
      if (matchingSegment) {
        if (matchingSegment.season === 'winter') {
          dataPoint[`winterAvg_${matchingSegment.segmentIndex}`] = matchingSegment.average;
        } else {
          dataPoint[`summerAvg_${matchingSegment.segmentIndex}`] = matchingSegment.average;
        }
      }
      
      return dataPoint;
    });

    const discontinuities = detectDiscontinuities(sortedDocs, metric);
    
    return { chartData, discontinuities };
  };

  // Helper function for Comparison tab: shows reconciliation costs only when available
  const prepareComparisonData = (docs: DocumentShopNumber[], reconciliationCostsMap: { [docId: string]: number }) => {
    const winterMonths = [6, 7, 8];
    const summerMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];
    
    // Sort by reconciliation date if available, otherwise document date
    const sortedDocs = [...docs].sort((a, b) => {
      const dateA = a.reconciliationDateTo || a.periodEnd;
      const dateB = b.reconciliationDateTo || b.periodEnd;
      return dateA.localeCompare(dateB); // Ascending order
    });
    
    interface Segment {
      season: 'winter' | 'summer';
      segmentIndex: number;
      docs: DocumentShopNumber[];
      average: number;
    }
    
    const segments: Segment[] = [];
    let winterSegment = -1;
    let summerSegment = -1;
    let lastSeason: 'winter' | 'summer' | null = null;
    let currentSegmentDocs: DocumentShopNumber[] = [];
    
    sortedDocs.forEach((doc, index) => {
      // Use reconciliation dates if available for accurate month detection
      const displayDateEnd = doc.reconciliationDateTo || doc.periodEnd;
      const month = getMonthFromDateString(displayDateEnd);
      const isWinter = winterMonths.includes(month);
      const isSummer = summerMonths.includes(month);
      const currentSeason = isWinter ? 'winter' : isSummer ? 'summer' : null;
      
      if (!currentSeason) return;
      
      if (lastSeason !== currentSeason) {
        if (lastSeason && currentSegmentDocs.length > 0) {
          const segmentIndex = lastSeason === 'winter' ? winterSegment : summerSegment;
          const values = currentSegmentDocs
            .map(d => reconciliationCostsMap[d.documentId])
            .filter(v => v !== undefined && v > 0);
          
          if (values.length > 0) {
            const average = values.reduce((sum, val) => sum + val, 0) / values.length;
            segments.push({ season: lastSeason, segmentIndex, docs: [...currentSegmentDocs], average });
          }
        }
        
        currentSegmentDocs = [];
        if (currentSeason === 'winter') winterSegment++;
        if (currentSeason === 'summer') summerSegment++;
      }
      
      currentSegmentDocs.push(doc);
      lastSeason = currentSeason;
      
      if (index === sortedDocs.length - 1 && currentSegmentDocs.length > 0) {
        const segmentIndex = currentSeason === 'winter' ? winterSegment : summerSegment;
        const values = currentSegmentDocs
          .map(d => reconciliationCostsMap[d.documentId])
          .filter(v => v !== undefined && v > 0);
        
        if (values.length > 0) {
          const average = values.reduce((sum, val) => sum + val, 0) / values.length;
          segments.push({ season: currentSeason, segmentIndex, docs: [...currentSegmentDocs], average });
        }
      }
    });
    
    return sortedDocs.map((doc) => {
      // Use reconciliation dates if available, otherwise fall back to document dates
      const displayDateEnd = doc.reconciliationDateTo || doc.periodEnd;
      
      const dataPoint: any = {
        period: formatDateStringToMonthYear(displayDateEnd),
        amount: reconciliationCostsMap[doc.documentId] !== undefined ? reconciliationCostsMap[doc.documentId] : null,
        documentAmount: doc.totalAmountExcludingEmergency ?? doc.totalAmount,
        documentId: doc.documentId,
      };

      console.log(`📈 Comparison data point for ${dataPoint.period}:`, {
        documentId: doc.documentId,
        hasReconciliation: reconciliationCostsMap[doc.documentId] !== undefined,
        reconciliationAmount: reconciliationCostsMap[doc.documentId],
        documentAmount: doc.totalAmountExcludingEmergency ?? doc.totalAmount,
        finalAmount: dataPoint.amount,
        usingReconDate: !!doc.reconciliationDateTo
      });
      
      const matchingSegment = segments.find(seg => 
        seg.docs.some(d => d.documentId === doc.documentId)
      );
      
      if (matchingSegment) {
        if (matchingSegment.season === 'winter') {
          dataPoint[`winterAvg_${matchingSegment.segmentIndex}`] = matchingSegment.average;
        } else {
          dataPoint[`summerAvg_${matchingSegment.segmentIndex}`] = matchingSegment.average;
        }
      }
      
      return dataPoint;
    });
  };

  // Helper function for Assignments tab: uses calculated tariff costs
  const prepareAssignmentsData = (docs: DocumentShopNumber[], calculatedCostsMap: { [docId: string]: number }) => {
    const winterMonths = [6, 7, 8];
    const summerMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];
    const sortedDocs = [...docs].sort((a, b) => 
      new Date(a.periodEnd).getTime() - new Date(b.periodEnd).getTime()
    );
    
    interface Segment {
      season: 'winter' | 'summer';
      segmentIndex: number;
      docs: DocumentShopNumber[];
      average: number;
    }
    
    const segments: Segment[] = [];
    let winterSegment = -1;
    let summerSegment = -1;
    let lastSeason: 'winter' | 'summer' | null = null;
    let currentSegmentDocs: DocumentShopNumber[] = [];
    
    sortedDocs.forEach((doc, index) => {
      const month = new Date(doc.periodEnd).getMonth() + 1;
      const isWinter = winterMonths.includes(month);
      const isSummer = summerMonths.includes(month);
      const currentSeason = isWinter ? 'winter' : isSummer ? 'summer' : null;
      
      if (!currentSeason) return;
      
      if (lastSeason !== currentSeason) {
        if (lastSeason && currentSegmentDocs.length > 0) {
          const segmentIndex = lastSeason === 'winter' ? winterSegment : summerSegment;
          const values = currentSegmentDocs
            .map(d => calculatedCostsMap[d.documentId])
            .filter(v => v !== undefined && v > 0);
          
          if (values.length > 0) {
            const average = values.reduce((sum, val) => sum + val, 0) / values.length;
            segments.push({ season: lastSeason, segmentIndex, docs: [...currentSegmentDocs], average });
          }
        }
        
        currentSegmentDocs = [];
        if (currentSeason === 'winter') winterSegment++;
        if (currentSeason === 'summer') summerSegment++;
      }
      
      currentSegmentDocs.push(doc);
      lastSeason = currentSeason;
      
      if (index === sortedDocs.length - 1 && currentSegmentDocs.length > 0) {
        const segmentIndex = currentSeason === 'winter' ? winterSegment : summerSegment;
        const values = currentSegmentDocs
          .map(d => calculatedCostsMap[d.documentId])
          .filter(v => v !== undefined && v > 0);
        
        if (values.length > 0) {
          const average = values.reduce((sum, val) => sum + val, 0) / values.length;
          segments.push({ season: currentSeason, segmentIndex, docs: [...currentSegmentDocs], average });
        }
      }
    });
    
    return sortedDocs.map((doc) => {
      const dataPoint: any = {
        period: formatDateStringToMonthYear(doc.periodEnd),
        amount: calculatedCostsMap[doc.documentId] || null,
        documentAmount: (doc.totalAmountExcludingEmergency ?? doc.totalAmount) || null,
        documentId: doc.documentId,
      };
      
      const matchingSegment = segments.find(seg => 
        seg.docs.some(d => d.documentId === doc.documentId)
      );
      
      if (matchingSegment) {
        if (matchingSegment.season === 'winter') {
          dataPoint[`winterAvg_${matchingSegment.segmentIndex}`] = matchingSegment.average;
        } else {
          dataPoint[`summerAvg_${matchingSegment.segmentIndex}`] = matchingSegment.average;
        }
      }
      
      return dataPoint;
    });
  };
  
  // Calculate seasonal averages from calculated costs
  const calculateSeasonalAveragesFromCalculated = (docs: DocumentShopNumber[]) => {
    const winterMonths = [6, 7, 8];
    const summerMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];
    
    const winterDocs = docs.filter(doc => {
      const month = getMonthFromDateString(doc.periodEnd);
      return winterMonths.includes(month);
    });
    
    const summerDocs = docs.filter(doc => {
      const month = getMonthFromDateString(doc.periodEnd);
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
  const [chartData, setChartData] = useState<any[]>([]);
  
  // Reconciliation costs state (for comparison tab)
  const [reconciliationCosts, setReconciliationCosts] = useState<{ 
    [meterId: string]: { 
      [dateRangeKey: string]: {
        total_cost: number;
        run_name: string;
        date_from: string;
        date_to: string;
      }
    } 
  }>({});
  const [isLoadingReconciliationCosts, setIsLoadingReconciliationCosts] = useState(false);
  
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
      tariffDetails: {
        blocks: Array<{
          block_number: number;
          kwh_from: number;
          kwh_to: number | null;
          energy_charge_cents: number;
        }>;
        periods: Array<{
          season: string;
          day_type: string;
          period_type: string;
          start_hour: number;
          end_hour: number;
          energy_charge_cents: number;
        }>;
        charges: Array<{
          charge_type: string;
          description: string | null;
          charge_amount: number;
          unit: string;
        }>;
      };
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

  // Enrich documents when in comparison mode
  useEffect(() => {
    if (hideSeasonalAverages && documentShopNumbers.length > 0 && meters.length > 0) {
      enrichDocumentsWithReconciliationDates();
    } else {
      setEnrichedDocuments(documentShopNumbers);
    }
  }, [hideSeasonalAverages, documentShopNumbers.length, meters.length, siteId]);

  // Fetch reconciliation costs when in comparison mode
  useEffect(() => {
    if (hideSeasonalAverages) {
      console.log('🔄 COMPARISON TAB ACTIVATED - Fetching reconciliation costs');
      console.log(`   Site ID: ${siteId}`);
      fetchReconciliationCosts();
    } else {
      console.log('📋 Analysis/Assignments tab active - no reconciliation fetch');
    }
  }, [hideSeasonalAverages, siteId]);

  // State inspection for reconciliation costs
  useEffect(() => {
    console.log('🔍 Reconciliation costs state updated:', {
      meterCount: Object.keys(reconciliationCosts).length,
      meterIds: Object.keys(reconciliationCosts),
      sampleData: Object.keys(reconciliationCosts).length > 0 
        ? reconciliationCosts[Object.keys(reconciliationCosts)[0]] 
        : 'no data'
    });
  }, [reconciliationCosts]);

  // Fetch chart data when dialog opens or metric changes
  useEffect(() => {
    if (!selectedChartMeter) {
      setChartData([]);
      setMeterDiscontinuities([]);
      return;
    }

    // Calculate chart data based on the mode
    if (hideSeasonalAverages) {
      const costsMap = getReconciliationCostsMap(selectedChartMeter.meter.id, selectedChartMeter.docs);
      const data = prepareComparisonData(selectedChartMeter.docs, costsMap);
      setChartData(data);
    } else if (showDocumentCharts) {
      const result = prepareAnalysisData(selectedChartMeter.docs, selectedChartMetric);
      setChartData(result.chartData);
      setMeterDiscontinuities(result.discontinuities);
    } else {
      const data = prepareAssignmentsData(selectedChartMeter.docs, chartDialogCalculations);
      setChartData(data);
    }

    // Fetch calculations when dialog opens
    if (Object.keys(chartDialogCalculations).length === 0) {
      const docIds = selectedChartMeter.docs.map(d => d.documentId);
      
      if (hideSeasonalAverages) {
        // Fetch reconciliation data for comparison mode
        supabase
          .from("reconciliation_meter_results")
          .select(`
            *,
            reconciliation_runs!inner(date_from, date_to)
          `)
          .eq("meter_id", selectedChartMeter.meter.id)
          .then(({ data, error }) => {
            if (!error && data) {
              const calcsByDoc: Record<string, any> = {};
              
              // Map reconciliation data to documents by matching periods
              selectedChartMeter.docs.forEach(doc => {
                // Find matching reconciliation period (2-day tolerance on end date)
                const matchingResult = data.find(result => {
                  const docDateTo = doc.reconciliationDateTo || doc.periodEnd;
                  const daysDiff = daysBetweenDateStrings(docDateTo, extractDateFromTimestamp(result.reconciliation_runs.date_to));
                  return daysDiff < 2;
                });
                
                if (matchingResult) {
                  // Calculate variance
                  const docAmount = (doc.totalAmountExcludingEmergency ?? doc.totalAmount) || 0;
                  const reconAmount = matchingResult.total_cost || 0;
                  const variance = reconAmount - docAmount;
                  const variancePercentage = docAmount > 0 
                    ? (variance / docAmount) * 100 
                    : 0;
                  
                  calcsByDoc[doc.documentId] = {
                    document_id: doc.documentId,
                    total_kwh: matchingResult.total_kwh,
                    energy_cost: matchingResult.energy_cost,
                    fixed_charges: matchingResult.fixed_charges,
                    total_cost: matchingResult.total_cost,
                    avg_cost_per_kwh: matchingResult.avg_cost_per_kwh,
                    variance_amount: variance,
                    variance_percentage: variancePercentage,
                    tariff_structures: {
                      name: matchingResult.tariff_name || 'Reconciliation'
                    }
                  };
                }
              });
              
              setChartDialogCalculations(calcsByDoc);
            }
          });
      } else {
        // Fetch tariff calculations for assignments/analysis tab
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
    }
  }, [selectedChartMeter, selectedChartMetric, hideSeasonalAverages, showDocumentCharts, chartDialogCalculations]);

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

  // Fetch reconciliation costs for comparison tab
  const fetchReconciliationCosts = async () => {
    setIsLoadingReconciliationCosts(true);
    
    try {
      // Step 1: Fetch all reconciliation runs for the site
      const { data: runs, error: runsError } = await supabase
        .from('reconciliation_runs')
        .select('id, run_name, date_from, date_to')
        .eq('site_id', siteId)
        .order('date_from', { ascending: false });

      if (runsError) {
        console.error("Error fetching reconciliation runs:", runsError);
        return;
      }

      if (!runs || runs.length === 0) {
        console.log("No reconciliation runs found for site");
        setReconciliationCosts({});
        return;
      }

      console.log(`Fetched ${runs.length} reconciliation runs`);

      // Step 2: Fetch all meter results for these runs
      const runIds = runs.map(r => r.id);
      const { data: meterResults, error: resultsError } = await supabase
        .from('reconciliation_meter_results')
        .select('reconciliation_run_id, meter_id, total_cost, energy_cost, fixed_charges')
        .in('reconciliation_run_id', runIds);

      if (resultsError) {
        console.error("Error fetching meter results:", resultsError);
        return;
      }

      console.log(`Fetched ${meterResults?.length || 0} meter results`);

      // Step 3: Build mapping structure
      const costsMap: typeof reconciliationCosts = {};
      
      runs.forEach(run => {
        const runResults = meterResults?.filter(mr => mr.reconciliation_run_id === run.id) || [];
        
        runResults.forEach(result => {
          if (!costsMap[result.meter_id]) {
            costsMap[result.meter_id] = {};
          }
          const periodKey = `${run.date_from}_${run.date_to}`;
          costsMap[result.meter_id][periodKey] = {
            total_cost: result.total_cost || 0,
            run_name: run.run_name,
            date_from: run.date_from,
            date_to: run.date_to
          };
          console.log(`Meter ${result.meter_id}: R${result.total_cost} for ${run.date_from} to ${run.date_to}`);
        });
      });

      console.log(`✅ Built reconciliation costs map with ${Object.keys(costsMap).length} meters`);
      console.log('Meter IDs in map:', Object.keys(costsMap));
      if (Object.keys(costsMap).length > 0) {
        const firstMeterId = Object.keys(costsMap)[0];
        console.log(`Sample data for meter ${firstMeterId}:`, costsMap[firstMeterId]);
      }
      setReconciliationCosts(costsMap);
    } catch (error) {
      console.error("Error fetching reconciliation costs:", error);
    } finally {
      setIsLoadingReconciliationCosts(false);
    }
  };

  // Helper to get reconciliation cost for a document
  const getReconciliationCostForDocument = (meterId: string, periodStart: string, periodEnd: string): number | null => {
    const meterCosts = reconciliationCosts[meterId];
    console.log(`💰 Looking for cost: meter ${meterId}, period ${periodStart} to ${periodEnd}`);
    if (!meterCosts) {
      console.log(`   ❌ Meter ${meterId} not in reconciliation state!`);
      console.log(`   Available meters:`, Object.keys(reconciliationCosts));
      return null;
    }
    console.log(`   ✅ Meter found with ${Object.keys(meterCosts).length} periods`);

    console.log(`Looking for reconciliation cost for meter ${meterId}, document period: ${periodStart} to ${periodEnd}`);

    // Find matching reconciliation run by date overlap
    for (const [periodKey, costData] of Object.entries(meterCosts)) {
      console.log(`  Checking reconciliation period: ${costData.date_from} to ${costData.date_to}, cost: ${costData.total_cost}`);

      // Only check end dates (allowing for 5-day variance)
      const daysDiff = daysBetweenDateStrings(periodEnd, extractDateFromTimestamp(costData.date_to));
      
      const endMatches = daysDiff < 5; // Within 5 days
      
      if (endMatches) {
        console.log(`  ✓ Match found! Using cost: ${costData.total_cost}`);
        return costData.total_cost;
      }
    }

    console.log(`  ✗ No matching reconciliation period found`);
    return null;
  };

  // Build reconciliation costs map for a specific meter's documents
  const getReconciliationCostsMap = (meterId: string, docs: DocumentShopNumber[]): { [docId: string]: number } => {
    const costsMap: { [docId: string]: number } = {};
    
    console.log(`🔍 Building costs map for meter ${meterId}`);
    console.log(`   Documents to process: ${docs.length}`);
    console.log(`   Meter in reconciliation state: ${!!reconciliationCosts[meterId]}`);
    if (reconciliationCosts[meterId]) {
      console.log(`   Available periods:`, Object.keys(reconciliationCosts[meterId]));
    }
    
    docs.forEach(doc => {
      const cost = getReconciliationCostForDocument(meterId, doc.periodStart, doc.periodEnd);
      if (cost !== null) {
        costsMap[doc.documentId] = cost;
        console.log(`  Mapped doc ${doc.documentId} (${doc.periodStart} to ${doc.periodEnd}) -> cost: ${cost}`);
      } else {
        console.log(`  No cost found for doc ${doc.documentId} (${doc.periodStart} to ${doc.periodEnd})`);
      }
    });

    console.log(`Final reconciliation costs map for meter ${meterId}:`, costsMap);
    return costsMap;
  };

  // Calculate and store costs for all meters with documents
  const calculateAndStoreCosts = async () => {
    const calculations = [];
    const docsToProcess = documentShopNumbers.filter(doc => doc.meterId);
    const total = docsToProcess.length;
    
    // Count unique meters for better progress messaging
    const uniqueMeters = new Set(docsToProcess.map(doc => doc.meterId)).size;
    
    console.log(`📊 Starting cost calculations:`);
    console.log(`   ${total} documents across ${uniqueMeters} meters`);
    console.log(`   Average: ${(total / uniqueMeters).toFixed(1)} documents per meter`);
    
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
        const documentAmount = doc.totalAmountExcludingEmergency ?? doc.totalAmount;
        const variance = documentAmount ? result.totalCost - documentAmount : null;
        const variancePercentage = documentAmount ? (variance! / documentAmount) * 100 : null;

        calculations.push({
          document_id: doc.documentId,
          meter_id: meter.id,
          tariff_structure_id: tariffId,
          period_start: doc.periodStart,
          period_end: doc.periodEnd,
          total_cost: result.totalCost,
          energy_cost: result.energyCost,
          fixed_charges: result.fixedCharges,
          demand_charges: result.demandCharges || 0,
          total_kwh: totalKwh,
          avg_cost_per_kwh: totalKwh ? result.totalCost / totalKwh : 0,
          document_billed_amount: doc.totalAmountExcludingEmergency ?? doc.totalAmount,
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

    // Group tariffs by name and select the most recent period for each name
    const tariffMap = new Map<string, TariffStructure>();
    (data || []).forEach((tariff) => {
      const existing = tariffMap.get(tariff.name);
      if (!existing || new Date(tariff.effective_from) > new Date(existing.effective_from)) {
        tariffMap.set(tariff.name, tariff);
      }
    });

    setTariffStructures(Array.from(tariffMap.values()));
    setIsLoading(false);
  };

  const fetchMeters = async () => {
    const { data, error } = await supabase
      .from("meters")
      .select("id, meter_number, name, tariff, tariff_structure_id, assigned_tariff_name, meter_type, mccb_size, rating")
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

          // Calculate total excluding emergency/generator charges
          const lineItems = extractedData.line_items || [];
          const normalSupplyTotal = lineItems
            .filter((item: any) => item.supply === "Normal")
            .reduce((sum: number, item: any) => sum + (item.amount || 0), 0);

          shopNumbers.push({
            documentId: doc.id,
            fileName: doc.file_name,
            shopNumber: identifier,
            periodStart: extractedData.period_start || '',
            periodEnd: extractedData.period_end || '',
            totalAmount: extractedData.total_amount || 0,
            totalAmountExcludingEmergency: normalSupplyTotal,
            currency: extractedData.currency || 'R',
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
  
  // Enrich documents with reconciliation dates and create virtual documents for missing periods
  const enrichDocumentsWithReconciliationDates = async () => {
    if (!hideSeasonalAverages || documentShopNumbers.length === 0) {
      setEnrichedDocuments(documentShopNumbers);
      return;
    }

    try {
      // Fetch reconciliation runs
      const { data: runs, error } = await supabase
        .from('reconciliation_runs')
        .select('id, run_name, date_from, date_to')
        .eq('site_id', siteId)
        .order('date_from', { ascending: false });

      if (error || !runs || runs.length === 0) {
        setEnrichedDocuments(documentShopNumbers);
        return;
      }

      // Fetch meter results for these runs
      const { data: meterResults } = await supabase
        .from('reconciliation_meter_results')
        .select('reconciliation_run_id, meter_id, total_cost')
        .in('reconciliation_run_id', runs.map(r => r.id));

      // Group documents by meter
      const docsByMeter = new Map<string, DocumentShopNumber[]>();
      documentShopNumbers.forEach(doc => {
        if (!doc.meterId) return;
        if (!docsByMeter.has(doc.meterId)) {
          docsByMeter.set(doc.meterId, []);
        }
        docsByMeter.get(doc.meterId)!.push(doc);
      });

      const enriched: DocumentShopNumber[] = [];

      // Process each meter
      meters.forEach(meter => {
        const meterDocs = docsByMeter.get(meter.id) || [];
        const meterReconRuns = runs.filter(run => 
          meterResults?.some(mr => mr.meter_id === meter.id && mr.reconciliation_run_id === run.id)
        );

        // For each reconciliation run, find or create matching document
        meterReconRuns.forEach(run => {
          const reconDateFrom = extractDateFromTimestamp(run.date_from);
          const reconDateTo = extractDateFromTimestamp(run.date_to);

          // Try to find matching extracted document (within 5 days)
          let matchingDoc = meterDocs.find(doc => {
            const daysDiff = daysBetweenDateStrings(doc.periodEnd, reconDateTo);
            return daysDiff < 5;
          });

          if (matchingDoc) {
            // Enrich existing document with reconciliation dates
            enriched.push({
              ...matchingDoc,
              reconciliationDateFrom: reconDateFrom,
              reconciliationDateTo: reconDateTo
            });
            // Remove from meterDocs so we don't process it again
            const index = meterDocs.indexOf(matchingDoc);
            if (index > -1) meterDocs.splice(index, 1);
          } else {
            // Create virtual document for reconciliation period without extracted document
            const result = meterResults?.find(mr => 
              mr.meter_id === meter.id && mr.reconciliation_run_id === run.id
            );
            
            enriched.push({
              documentId: `virtual-${run.id}-${meter.id}`,
              fileName: run.run_name,
              shopNumber: meter.meter_number,
              periodStart: reconDateFrom,
              periodEnd: reconDateTo,
              reconciliationDateFrom: reconDateFrom,
              reconciliationDateTo: reconDateTo,
              totalAmount: result?.total_cost || 0,
              totalAmountExcludingEmergency: result?.total_cost || 0,
              currency: 'R',
              meterId: meter.id,
              lineItems: []
            });
          }
        });

        // Add any remaining docs that didn't match reconciliation runs
        meterDocs.forEach(doc => {
          enriched.push(doc);
        });
      });

      // Sort by period end date (descending)
      enriched.sort((a, b) => {
        const dateA = a.reconciliationDateTo || a.periodEnd;
        const dateB = b.reconciliationDateTo || b.periodEnd;
        return dateB.localeCompare(dateA);
      });

      setEnrichedDocuments(enriched);
    } catch (error) {
      console.error("Error enriching documents:", error);
      setEnrichedDocuments(documentShopNumbers);
    }
  };

  const getMatchingShopNumbers = (meter: Meter): DocumentShopNumber[] => {
    // Use enriched documents in comparison mode, regular documents otherwise
    const docs = hideSeasonalAverages ? enrichedDocuments : documentShopNumbers;
    
    // Only return documents explicitly assigned to this meter via meter_id
    const matches = docs.filter(doc => doc.meterId === meter.id);
    
    // Sort by period date (most recent first)
    return matches.sort((a, b) => {
      const dateA = a.reconciliationDateTo || a.periodEnd;
      const dateB = b.reconciliationDateTo || b.periodEnd;
      return dateB.localeCompare(dateA); // Descending order (newest first)
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
      demand: [] as any[],
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
      } else if (item.unit === 'kVA' || desc.includes('demand') || desc.includes('kva')) {
        categories.demand.push(item);
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
      const calcRate = calc.total_kwh > 0 ? calc.energy_cost / calc.total_kwh : null;
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
    
    // Demand Charge (kVA-based)
    if (categories.demand.length > 0 || calc.demand_charges > 0) {
      const demandItems = categories.demand;
      const docConsumption = demandItems.reduce((sum, item) => sum + (item.consumption || 0), 0);
      const docRate = demandItems.length > 0 && demandItems[0].rate ? demandItems[0].rate : null;
      const docCost = demandItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      const calcCost = calc.demand_charges || 0;
      
      rows.push({
        name: 'Demand Charge',
        doc: {
          consumption: docConsumption > 0 ? `${docConsumption.toFixed(2)} kVA` : '—',
          rate: docRate !== null ? `${currency} ${docRate.toFixed(2)}/kVA` : '—',
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
    
    // Generator Charge (emergency supply) - excluded from reconciliation
    
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

  // Helper to get charge type label from unit
  const getChargeTypeLabel = (unit?: string): string => {
    switch (unit) {
      case 'kWh':
        return 'Seasonal Charge';
      case 'kVA':
        return 'Demand Charge';
      case 'Monthly':
        return 'Basic Charge';
      default:
        return 'Charge';
    }
  };

  // Handle viewing rate comparison - Fetch from stored calculations
  const handleViewRateComparison = async (meter: Meter) => {
    const assignedTariffId = selectedTariffs[meter.id] || meter.tariff_structure_id;
    
    if (!assignedTariffId) {
      toast.error("Please assign a tariff to this meter first");
      return;
    }
    
    // Fetch site data to get supply_authority_id (needed for RPC call)
    if (!site?.supply_authority_id) {
      toast.error("Site must have a supply authority assigned");
      return;
    }

    // Get the assigned tariff name for multi-period support
    const assignedTariff = tariffStructures.find(t => t.id === assignedTariffId);
    if (!assignedTariff) {
      toast.error("Could not find assigned tariff structure");
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
    
    // For each document, fetch period-specific tariff details
    const documentComparisons = await Promise.all(
      storedCalculations.map(async (calc) => {
        // Find matching document from documentShopNumbers
        const matchingDoc = documentShopNumbers.find(doc => doc.documentId === calc.document_id);
        
        if (!matchingDoc) return null;
        
        // Use RPC to find the applicable tariff structure for this document's billing period
        const { data: applicableTariffs } = await supabase.rpc('get_applicable_tariff_periods', {
          p_supply_authority_id: site.supply_authority_id,
          p_tariff_name: assignedTariff.name,
          p_date_from: calc.period_start,
          p_date_to: calc.period_end
        });
        
        // Get the tariff structure ID for this specific period (fallback to assigned if not found)
        const periodTariffId = applicableTariffs?.[0]?.tariff_id || assignedTariffId;
        
        // Fetch period-specific tariff details
        const [
          { data: tariffBlocks },
          { data: tariffPeriods },
          { data: tariffCharges }
        ] = await Promise.all([
          supabase.from("tariff_blocks").select("*").eq("tariff_structure_id", periodTariffId).order("block_number"),
          supabase.from("tariff_time_periods").select("*").eq("tariff_structure_id", periodTariffId),
          supabase.from("tariff_charges").select("*").eq("tariff_structure_id", periodTariffId)
        ]);
        
        return {
          calculation: calc,
          document: matchingDoc,
          hasError: !!calc.calculation_error,
          tariffDetails: {
            blocks: tariffBlocks || [],
            periods: tariffPeriods || [],
            charges: tariffCharges || []
          }
        };
      })
    );
    
    const validComparisons = documentComparisons.filter((comp): comp is NonNullable<typeof comp> => comp !== null);
    
    if (validComparisons.length === 0) {
      toast.error("No matching documents found for stored calculations");
      return;
    }
    
    // Calculate overall status based on variance
    const overallStatus = calculateOverallStatus(validComparisons);
    
    setRateComparisonData({
      overallStatus,
      documentComparisons: validComparisons
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
        // Get the tariff name for multi-period support
        const tariffName = tariffId 
          ? tariffStructures.find(t => t.id === tariffId)?.name || null
          : null;
        
        return supabase
          .from("meters")
          .update({ 
            tariff_structure_id: tariffId,
            assigned_tariff_name: tariffName,
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
      const docsWithMeters = documentShopNumbers.filter(doc => doc.meterId);
      const uniqueMeterCount = new Set(docsWithMeters.map(d => d.meterId)).size;
      toast.info(`Calculating costs for ${docsWithMeters.length} bills across ${uniqueMeterCount} meters...`);
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
                    <>Earliest: {formatDateStringToLong([...documentShopNumbers].sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0].periodStart)} at 00:30</>
                  )}
                </span>
                <span>
                  {documentShopNumbers.length > 0 && (
                    <>Latest: {formatDateStringToLong([...documentShopNumbers].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0].periodEnd)} at 23:30</>
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
                      
                      // Transform and sort data for chart using appropriate function for each tab
                      let chartData: any[] = [];
                      if (hideSeasonalAverages) {
                        // Comparison tab: use reconciliation costs (only show blue bars when data exists)
                        console.log(`📊 Rendering chart for meter ${meter.id} in comparison mode`);
                        console.log(`   Reconciliation state populated:`, Object.keys(reconciliationCosts).length > 0);
                        const costsMap = getReconciliationCostsMap(meter.id, filteredShops);
                        console.log(`   Costs map result:`, costsMap);
                        console.log(`   Mapped ${Object.keys(costsMap).length} documents to costs`);
                        chartData = prepareComparisonData(filteredShops, costsMap);
                      } else if (showDocumentCharts) {
                        // Analysis tab: always use document amounts (returns object with chartData property)
                        const analysisResult = prepareAnalysisData(filteredShops);
                        chartData = Array.isArray(analysisResult) ? analysisResult : (analysisResult?.chartData || []);
                      } else {
                        // Assignments tab: use calculated tariff costs
                        chartData = prepareAssignmentsData(filteredShops, calculatedCosts);
                      }
                      
                      // Ensure chartData is always an array
                      if (!Array.isArray(chartData)) {
                        console.warn('chartData is not an array, defaulting to empty array');
                        chartData = [];
                      }
                      
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
                                  label: hideSeasonalAverages ? "Reconciliation Cost" : (showDocumentCharts ? "Document Amount" : "Calculated Cost"),
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
                                   {!hideSeasonalAverages && Array.isArray(chartData) && chartData.length > 0 && (() => {
                                    // Extract all unique seasonal segment keys from the data
                                    const segmentKeys = new Set<string>();
                                    chartData.forEach((point: any) => {
                                      if (point && typeof point === 'object') {
                                        Object.keys(point).forEach(key => {
                                          if (key.startsWith('winterAvg_') || key.startsWith('summerAvg_')) {
                                            segmentKeys.add(key);
                                          }
                                        });
                                      }
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
                                    name={hideSeasonalAverages ? "Reconciliation Cost" : (showDocumentCharts ? "Document Amount" : "Calculated Cost")}
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
                          Calculating Bill Costs: {calculationProgress.current}/{calculationProgress.total} (Click to Cancel)
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

                  <div className="border rounded-lg">
                    <div className="overflow-x-auto">
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
                  
                  // Calculate document-level variance from line item rate variances
                  const calculateDocumentVariance = () => {
                    if (calc.calculation_error) {
                      return null;
                    }
                    
                    if (!doc.lineItems || doc.lineItems.length === 0) {
                      return null;
                    }
                    
                    const lineItemVariances: number[] = [];
                    
                    doc.lineItems.forEach((item) => {
                      // Try to find matching tariff rate for this line item
                      let tariffRate: string | null = null;
                      const description = item.description.toLowerCase();
                      const tariffDetails = comparison.tariffDetails;
                      
                      // Determine season based on billing period
                      const periodMonth = new Date(calc.period_start).getMonth() + 1;
                      const isHighSeason = periodMonth >= 6 && periodMonth <= 8;
                      const touSeason = isHighSeason ? 'winter' : 'summer';
                      const chargeSeason = isHighSeason ? 'high' : 'low';
                      
                      // Use item.unit field to determine charge type
                      const itemUnit = item.unit || 'kWh';
                      const unitLower = itemUnit.toLowerCase();
                      const isDemandCharge = unitLower === 'kva';
                      const isEnergyCharge = unitLower === 'kwh';
                      const isBasicCharge = itemUnit === 'Monthly' || description.includes('basic');
                      
                      // Skip Emergency supply - no standard tariff rate applies
                      if (item.supply !== 'Emergency') {
                        // Determine charge type and find matching rate
                        if (isBasicCharge || (item.amount && !item.rate)) {
                          const matchingCharge = tariffDetails.charges.find(charge => {
                            const chargeDesc = (charge.description || charge.charge_type).toLowerCase();
                            return description.includes('basic') && chargeDesc.includes('basic');
                          });
                          
                          if (matchingCharge) {
                            tariffRate = `R ${matchingCharge.charge_amount.toFixed(2)}`;
                          }
                        } else if (isDemandCharge && item.rate && item.rate > 0) {
                          const demandCharge = tariffDetails.charges.find(charge => 
                            charge.charge_type === `demand_${chargeSeason}_season` ||
                            (charge.charge_type.toLowerCase().includes('demand') && 
                             charge.charge_type.toLowerCase().includes(chargeSeason))
                          );
                          
                          if (demandCharge && (demandCharge.unit === 'R/kVA' || demandCharge.unit === 'c/kVA')) {
                            const rateValue = demandCharge.unit === 'c/kVA' 
                              ? demandCharge.charge_amount / 100 
                              : demandCharge.charge_amount;
                            tariffRate = `R ${rateValue.toFixed(4)}/kVA`;
                          }
                        } else if (!isDemandCharge && item.rate && item.rate > 0) {
                          // Try TOU periods
                          if (tariffDetails.periods.length > 0) {
                            const seasonalPeriods = tariffDetails.periods.filter(p => 
                              p.season.toLowerCase().includes(touSeason)
                            );
                            
                            if (seasonalPeriods.length > 0) {
                              const standardPeriod = seasonalPeriods.find(p => 
                                p.period_type.toLowerCase().includes('standard') || 
                                p.period_type.toLowerCase().includes('off')
                              );
                              
                              if (standardPeriod) {
                                tariffRate = `R ${(standardPeriod.energy_charge_cents / 100).toFixed(4)}/kWh`;
                              } else {
                                const avgRate = seasonalPeriods.reduce((sum, p) => sum + p.energy_charge_cents, 0) / seasonalPeriods.length;
                                tariffRate = `R ${(avgRate / 100).toFixed(4)}/kWh`;
                              }
                            }
                          }
                          
                          // Try block-based tariffs
                          if (!tariffRate && tariffDetails.blocks.length > 0 && item.consumption) {
                            const matchingBlock = tariffDetails.blocks.find(block => {
                              if (block.kwh_to === null) {
                                return item.consumption! >= block.kwh_from;
                              }
                              return item.consumption! >= block.kwh_from && item.consumption! <= block.kwh_to;
                            });
                            if (matchingBlock) {
                              tariffRate = `R ${(matchingBlock.energy_charge_cents / 100).toFixed(4)}/kWh`;
                            }
                          }
                          
                          // Try seasonal charges
                          if (!tariffRate && tariffDetails.charges.length > 0) {
                            const seasonalCharge = tariffDetails.charges.find(charge => {
                              const chargeTypeLower = charge.charge_type.toLowerCase();
                              return chargeTypeLower === `energy_${chargeSeason}_season` ||
                                     (chargeTypeLower.includes('energy') && chargeTypeLower.includes(chargeSeason)) ||
                                     (chargeTypeLower.includes('energy') && 
                                      (chargeTypeLower.includes('both') || chargeTypeLower.includes('all')));
                            });
                            
                            if (seasonalCharge && seasonalCharge.unit === 'c/kWh') {
                              tariffRate = `R ${(seasonalCharge.charge_amount / 100).toFixed(4)}/kWh`;
                            }
                          }
                        }
                      }
                      
                      // Calculate variance for this line item
                      let variancePercent: number | null = null;
                      if (item.rate && tariffRate) {
                        if (itemUnit === 'kWh' && tariffRate.includes('/kWh')) {
                          const tariffRateValue = parseFloat(tariffRate.replace('R ', '').replace('/kWh', ''));
                          variancePercent = ((tariffRateValue - item.rate) / item.rate) * 100;
                        } else if (itemUnit === 'kVA' && tariffRate.includes('/kVA')) {
                          const tariffRateValue = parseFloat(tariffRate.replace('R ', '').replace('/kVA', ''));
                          variancePercent = ((tariffRateValue - item.rate) / item.rate) * 100;
                        }
                      } else if (itemUnit === 'Monthly' && item.amount && tariffRate) {
                        const tariffAmount = parseFloat(tariffRate.replace('R ', ''));
                        variancePercent = ((tariffAmount - item.amount) / item.amount) * 100;
                      }
                      
                      // Add to array if we have a valid variance
                      if (variancePercent !== null) {
                        lineItemVariances.push(Math.abs(variancePercent));
                      }
                    });
                    
                    // Return average of absolute variances
                    if (lineItemVariances.length === 0) {
                      return null;
                    }
                    
                    return lineItemVariances.reduce((sum, v) => sum + v, 0) / lineItemVariances.length;
                  };
                  
                  const documentVariance = calculateDocumentVariance();
                  
                  // Calculate variance badge using rate-based variance
                  const getVarianceBadge = () => {
                    if (calc.calculation_error) {
                      return { variant: 'destructive' as const, label: 'ERROR', className: '' };
                    }
                    if (documentVariance === null) {
                      return { variant: 'outline' as const, label: 'NO DATA', className: '' };
                    }
                    const variancePercent = documentVariance;
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
                              ({formatDateStringToLong(calc.period_start)} - {formatDateStringToLong(calc.period_end)})
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
                        
                        {/* Rates Comparison Table */}
                        <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Document</TableHead>
                          <TableHead className="text-right">Assigned</TableHead>
                          <TableHead className="text-right">Variance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {doc.lineItems && doc.lineItems.length > 0 ? (
                          <>
                            {[...doc.lineItems]
                              .sort((a, b) => {
                                // Define sort order: Seasonal (1), Basic (2), Emergency Seasonal (3), Demand (4)
                                const getOrder = (item: any) => {
                                  const unit = item.unit || 'kWh';
                                  const isEmergency = item.supply === 'Emergency';
                                  
                                  if (unit === 'kWh' && !isEmergency) return 1; // Seasonal Charge
                                  if (unit === 'Monthly') return 2; // Basic Charge
                                  if (unit === 'kWh' && isEmergency) return 3; // Emergency Seasonal
                                  if (unit === 'kVA') return 4; // Demand Charge
                                  return 5; // Other
                                };
                                
                                return getOrder(a) - getOrder(b);
                              })
                              .map((item, itemIdx) => {
                              // Try to find matching tariff rate for this line item
                              let tariffRate: string | null = null;
                              const description = item.description.toLowerCase();
                              const tariffDetails = comparison.tariffDetails;
                              
                              // Determine season based on billing period
                              const periodMonth = new Date(calc.period_start).getMonth() + 1; // 1-12
                              // In SA electricity tariffs: High season (winter) = Jun-Aug (6-8), Low season (summer) = Sep-May (9-12, 1-5)
                              const isHighSeason = periodMonth >= 6 && periodMonth <= 8;
                              const touSeason = isHighSeason ? 'winter' : 'summer'; // For TOU periods
                              const chargeSeason = isHighSeason ? 'high' : 'low'; // For tariff_charges
                              
                              // Use item.unit field to determine charge type (more reliable than description)
                              const itemUnit = item.unit || 'kWh'; // Default to kWh if no unit specified
                              const unitLower = itemUnit.toLowerCase();
                              const isDemandCharge = unitLower === 'kva';
                              const isEnergyCharge = unitLower === 'kwh';
                              const isBasicCharge = itemUnit === 'Monthly' || description.includes('basic');
                              
                              // Skip tariff matching for Emergency supply - no standard tariff rate applies
                              if (item.supply === 'Emergency') {
                                // Leave tariffRate as null - will display as "—"
                              } else {
                                // Determine charge type and find matching rate (only ONE rate per item)
                                if (isBasicCharge || (item.amount && !item.rate)) {
                                  // This is a basic/fixed charge - find matching tariff charge
                                  const matchingCharge = tariffDetails.charges.find(charge => {
                                    const chargeDesc = (charge.description || charge.charge_type).toLowerCase();
                                    return description.includes('basic') && chargeDesc.includes('basic');
                                  });
                                  
                                  if (matchingCharge) {
                                    tariffRate = `${matchingCharge.charge_amount.toFixed(2)}`;
                                  }
                                } else if (isDemandCharge && item.rate && item.rate > 0) {
                                  // Pure demand charge
                                  const demandCharge = tariffDetails.charges.find(charge => 
                                    charge.charge_type === `demand_${chargeSeason}_season` ||
                                    (charge.charge_type.toLowerCase().includes('demand') && 
                                     charge.charge_type.toLowerCase().includes(chargeSeason))
                                  );
                                  
                                  if (demandCharge && (demandCharge.unit === 'R/kVA' || demandCharge.unit === 'c/kVA')) {
                                    const rateValue = demandCharge.unit === 'c/kVA' 
                                      ? demandCharge.charge_amount / 100 
                                      : demandCharge.charge_amount;
                                    tariffRate = `${rateValue.toFixed(4)}`;
                                  }
                                } else if (!isDemandCharge && item.rate && item.rate > 0) {
                                  // This is an energy charge - find matching tariff rate
                                  
                                  // First, try to find seasonal rate from TOU periods
                                  if (tariffDetails.periods.length > 0) {
                                    // Filter by season
                                    const seasonalPeriods = tariffDetails.periods.filter(p => 
                                      p.season.toLowerCase().includes(touSeason)
                                    );
                                    
                                    if (seasonalPeriods.length > 0) {
                                      // For conventional tariffs, use standard/off-peak rate or average
                                      const standardPeriod = seasonalPeriods.find(p => 
                                        p.period_type.toLowerCase().includes('standard') || 
                                        p.period_type.toLowerCase().includes('off')
                                      );
                                      
                                      if (standardPeriod) {
                                        tariffRate = `${(standardPeriod.energy_charge_cents / 100).toFixed(4)}`;
                                      } else {
                                        // Use average of seasonal periods
                                        const avgRate = seasonalPeriods.reduce((sum, p) => sum + p.energy_charge_cents, 0) / seasonalPeriods.length;
                                        tariffRate = `${(avgRate / 100).toFixed(4)}`;
                                      }
                                    }
                                  }
                                  
                                  // If no seasonal rate found, try block-based tariffs
                                  if (!tariffRate && tariffDetails.blocks.length > 0 && item.consumption) {
                                    const matchingBlock = tariffDetails.blocks.find(block => {
                                      if (block.kwh_to === null) {
                                        return item.consumption! >= block.kwh_from;
                                      }
                                      return item.consumption! >= block.kwh_from && item.consumption! <= block.kwh_to;
                                    });
                                    if (matchingBlock) {
                                      tariffRate = `${(matchingBlock.energy_charge_cents / 100).toFixed(4)}`;
                                    }
                                  }
                                  
                                  // If still no rate found, check tariff_charges for seasonal energy rates
                                  if (!tariffRate && tariffDetails.charges.length > 0) {
                                    const seasonalCharge = tariffDetails.charges.find(charge => {
                                      const chargeTypeLower = charge.charge_type.toLowerCase();
                                      
                                      // Match exact season pattern
                                      if (chargeTypeLower === `energy_${chargeSeason}_season`) {
                                        return true;
                                      }
                                      
                                      // Match charges that contain both "energy" and the season name
                                      if (chargeTypeLower.includes('energy') && chargeTypeLower.includes(chargeSeason)) {
                                        return true;
                                      }
                                      
                                      // Match "both_seasons" or "all" energy charges (apply to any season)
                                      if (chargeTypeLower.includes('energy') && 
                                          (chargeTypeLower.includes('both') || chargeTypeLower.includes('all'))) {
                                        return true;
                                      }
                                      
                                      return false;
                                    });
                                    
                                    if (seasonalCharge && seasonalCharge.unit === 'c/kWh') {
                                      tariffRate = `${(seasonalCharge.charge_amount / 100).toFixed(4)}`;
                                    }
                                  }
                                }
                              }
                              
                              // Calculate variance as percentage using the item's actual unit
                              let variancePercent: number | null = null;
                              if (item.rate && item.rate > 0 && tariffRate) {
                                // Extract rate value (now tariffRate is just the number as string)
                                const tariffRateValue = parseFloat(tariffRate);
                                if (!isNaN(tariffRateValue)) {
                                  variancePercent = ((tariffRateValue - item.rate) / item.rate) * 100;
                                }
                              } else if (itemUnit === 'Monthly' && item.amount && item.amount > 0 && tariffRate) {
                                // For fixed monthly charges - compare amounts
                                const tariffAmount = parseFloat(tariffRate);
                                if (!isNaN(tariffAmount)) {
                                  variancePercent = ((tariffAmount - item.amount) / item.amount) * 100;
                                }
                              }

                              return (
                                <TableRow key={itemIdx}>
                                  <TableCell className="font-medium">
                                    {item.supply || 'Normal'} (R/{itemUnit}) - {getChargeTypeLabel(item.unit)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {item.rate && item.rate > 0 
                                      ? item.rate.toFixed(4)
                                      : item.amount 
                                        ? item.amount.toFixed(2)
                                        : '—'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-primary">
                                    {tariffRate || '—'}
                                  </TableCell>
                                  <TableCell className={cn(
                                    "text-right font-mono",
                                    variancePercent !== null
                                      ? variancePercent > 0 
                                        ? "text-red-600" 
                                        : "text-green-600"
                                      : "text-muted-foreground"
                                  )}>
                                    {variancePercent !== null ? `${variancePercent > 0 ? '+' : ''}${variancePercent.toFixed(1)}%` : '—'}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </>
                        ) : (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground italic py-8">
                              No line item details available
                            </TableCell>
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
        setSelectedChartMetric('total');
        setMeterDiscontinuities([]);
      }}>
        <DialogContent className="max-w-7xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Meter Analysis: {selectedChartMeter?.meter.meter_number}</DialogTitle>
            <DialogDescription>
              Billing cost trend and associated documents
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[75vh] pr-4">
            {selectedChartMeter && (() => {
              const currencies = new Set(selectedChartMeter.docs.map(d => d.currency));
              const hasMixedCurrencies = currencies.size > 1;
              
              const getMetricLabel = (metric: string): string => {
                switch(metric) {
                  case 'total': return 'Total Amount';
                  case 'basic': return 'Basic Charge';
                  case 'kva-charge': return 'kVA Charge';
                  case 'kwh-charge': return 'kWh Charge';
                  case 'kva-consumption': return 'kVA Consumption';
                  case 'kwh-consumption': return 'kWh Consumption';
                  default: return 'Amount';
                }
              };
              
              return (
                <div key={`${selectedChartMeter.meter.id}-${selectedChartMetric}`} className="space-y-6">
                  {/* Enlarged Chart */}
                  <Card>
                    <CardHeader className="pb-4">
                      <div className="flex justify-between items-start gap-4">
                        <CardTitle>
                          {showDocumentCharts ? `${getMetricLabel(selectedChartMetric)} Over Time` : 'Billing Cost Over Time'}
                        </CardTitle>
                        
                        {/* Metric Selection Dropdown - Inside Card */}
                        {showDocumentCharts && (
                          <div className="flex items-center gap-2">
                            <Label htmlFor="metric-select" className="text-sm font-medium whitespace-nowrap">
                              Metric:
                            </Label>
                            <Select value={selectedChartMetric} onValueChange={setSelectedChartMetric}>
                              <SelectTrigger id="metric-select" className="w-[240px]">
                                <SelectValue placeholder="Select metric" />
                              </SelectTrigger>
                              <SelectContent className="bg-background z-50">
                                <SelectItem value="total">Total Amount</SelectItem>
                                <SelectItem value="basic">Basic Charge</SelectItem>
                                <SelectItem value="kva-charge">kVA Charge</SelectItem>
                                <SelectItem value="kwh-charge">kWh Charge</SelectItem>
                                <SelectItem value="kva-consumption">kVA Consumption</SelectItem>
                                <SelectItem value="kwh-consumption">kWh Consumption</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                      
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
                            label: hideSeasonalAverages ? "Reconciliation Cost" : (showDocumentCharts ? getMetricLabel(selectedChartMetric) : "Calculated Cost"),
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
                        className="h-[650px]"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart 
                            key={`chart-${selectedChartMetric}`}
                            data={chartData}
                            margin={{ top: 10, right: 100, left: 60, bottom: 80 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis 
                              dataKey="period" 
                              tick={{ fontSize: 12 }}
                              angle={-45}
                              textAnchor="end"
                              height={80}
                              label={{ value: 'Period', position: 'insideBottom', offset: -5, style: { fontSize: 12 } }}
                            />
                            <YAxis 
                              yAxisId="left"
                              tick={{ fontSize: 12 }}
                              label={{ 
                                value: showDocumentCharts && selectedChartMetric.includes('consumption') 
                                  ? 'kWh Consumption' 
                                  : 'Amount (R)', 
                                angle: -90, 
                                position: 'insideLeft',
                                style: { 
                                  fontSize: 14, 
                                  fontWeight: 600,
                                  fill: 'hsl(var(--foreground))',
                                  textAnchor: 'middle' 
                                }
                              }}
                              tickFormatter={(value) => {
                                if (showDocumentCharts && selectedChartMetric.includes('consumption')) {
                                  return value.toLocaleString();
                                }
                                return `R${(value / 1000).toFixed(0)}k`;
                              }}
                            />
                            <YAxis 
                              yAxisId="right"
                              orientation="right"
                              tick={{ fontSize: 12 }}
                              label={{ 
                                value: 'Meter Reading (kWh)', 
                                angle: 90, 
                                position: 'insideRight',
                                offset: -20,
                                style: { 
                                  fontSize: 14, 
                                  fontWeight: 600,
                                  fill: 'hsl(var(--foreground))',
                                  textAnchor: 'middle' 
                                } 
                              }}
                              tickFormatter={(value) => value.toLocaleString()}
                            />
                            <ChartTooltip 
                              content={<ChartTooltipContent />}
                            />
                            <Legend 
                              onClick={(e) => handleLegendClick(String(e.dataKey))}
                              wrapperStyle={{
                                paddingTop: '20px',
                                cursor: 'pointer'
                              }}
                              formatter={(value, entry: any) => {
                                const dataKey = entry.dataKey;
                                const isHidden = hiddenDataKeys.has(dataKey) || 
                                  (dataKey.startsWith('winterAvg_') && Array.from(hiddenDataKeys).some(k => k.startsWith('winterAvg'))) ||
                                  (dataKey.startsWith('summerAvg_') && Array.from(hiddenDataKeys).some(k => k.startsWith('summerAvg')));
                                
                                // Group seasonal segments
                                if (dataKey.startsWith('winterAvg_')) {
                                  return <span style={{ opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>Winter Average</span>;
                                }
                                if (dataKey.startsWith('summerAvg_')) {
                                  return <span style={{ opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>Summer Average</span>;
                                }
                                
                                return <span style={{ opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>{value}</span>;
                              }}
                              iconType="line"
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
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey={key}
                                    stroke={color}
                                    strokeWidth={4}
                                    dot={{ r: 5, fill: color }}
                                    connectNulls={false}
                                    hide={hiddenDataKeys.has(key)}
                                  />
                                );
                              });
                            })()}
                            <Bar 
                              yAxisId="left"
                              dataKey="amount" 
                              fill="hsl(var(--muted-foreground))"
                              radius={[4, 4, 0, 0]}
                              name={hideSeasonalAverages ? "Reconciliation Cost" : (showDocumentCharts ? getMetricLabel(selectedChartMetric) : "Calculated Cost")}
                              opacity={0.5}
                              hide={hiddenDataKeys.has('amount')}
                            />
                            {hideSeasonalAverages && (
                              <Bar 
                                yAxisId="left"
                                dataKey="documentAmount" 
                                fill="hsl(var(--primary))"
                                radius={[4, 4, 0, 0]}
                                name="Document Billed"
                                hide={hiddenDataKeys.has('documentAmount')}
                              />
                            )}
                            <Line
                              yAxisId="right"
                              type="monotone"
                              dataKey="meterReading"
                              stroke="hsl(var(--chart-3))"
                              strokeWidth={3}
                              name="Meter Reading"
                              connectNulls={false}
                              hide={hiddenDataKeys.has('meterReading')}
                              dot={(props: any) => {
                                const { payload, cx, cy } = props;
                                if (payload.isDiscontinuous) {
                                  return (
                                    <circle
                                      cx={cx}
                                      cy={cy}
                                      r={6}
                                      fill="hsl(var(--destructive))"
                                      stroke="white"
                                      strokeWidth={2}
                                    />
                                  );
                                }
                                return <circle cx={cx} cy={cy} r={4} fill="hsl(var(--chart-3))" />;
                              }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </ChartContainer>

                      {/* Meter Reading Discontinuities Alert */}
                      {showDocumentCharts && meterDiscontinuities && meterDiscontinuities.length > 0 && (
                        <Alert variant="destructive" className="mt-4">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Meter Reading Discontinuities Detected</AlertTitle>
                          <AlertDescription>
                            <div className="space-y-1 mt-2">
                              {meterDiscontinuities.map((issue: any, idx: number) => (
                                <div key={idx} className="text-sm">
                                  <strong>{issue.period}:</strong> Current reading {issue.currentReading.toLocaleString()} 
                                  → Next period starts at {issue.nextPreviousReading.toLocaleString()} 
                                  (Gap: {issue.difference > 0 ? '+' : ''}{issue.difference.toLocaleString()})
                                </div>
                              ))}
                            </div>
                          </AlertDescription>
                        </Alert>
                      )}
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
                              <div className="flex items-center gap-3">
                                <span className="font-medium">{doc.shopNumber}</span>
                                <span className="text-sm text-muted-foreground">
                                  {doc.reconciliationDateFrom && doc.reconciliationDateTo ? (
                                    <>{formatDateString(doc.reconciliationDateFrom)} - {formatDateString(doc.reconciliationDateTo)}</>
                                  ) : (
                                    <>{formatDateString(doc.periodStart)} - {formatDateString(doc.periodEnd)}</>
                                  )}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {(() => {
                                const calc = chartDialogCalculations[doc.documentId];
                                if (calc && calc.variance_percentage !== null) {
                                  return (
                                    <Badge variant={Math.abs(calc.variance_percentage) > 10 ? "destructive" : "secondary"} className="text-xs">
                                      {calc.variance_percentage >= 0 ? '+' : ''}{calc.variance_percentage.toFixed(1)}%
                                    </Badge>
                                  );
                                }
                                return null;
                              })()}
                              <Badge variant="outline" className="font-mono">
                                R {doc.totalAmount.toFixed(2)}
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
                                    <span className="text-sm font-medium text-muted-foreground">
                                      Rate Comparison: Document vs {hideSeasonalAverages ? 'Reconciliation' : 'Tariff'}
                                    </span>
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
                                            {doc.currency} {(calc.document_billed_amount?.toFixed(2) || (doc.totalAmountExcludingEmergency ?? doc.totalAmount).toFixed(2))}
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
        setViewingAllDocsCalculations({});
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Associated Documents</DialogTitle>
            <DialogDescription>
              All documents assigned to meter {viewingAllDocs?.meter.meter_number}
            </DialogDescription>
          </DialogHeader>
          
          {/* Chart Section */}
          {!showDocumentCharts && viewingAllDocs && viewingAllDocs.docs.length > 1 && (() => {
            // Transform and sort data for chart with seasonal averages
            // Comparison tab: use reconciliation costs
            // Analysis tab: use document extracted values
            let chartData;
            if (hideSeasonalAverages) {
              const costsMap = getReconciliationCostsMap(viewingAllDocs.meter.id, viewingAllDocs.docs);
              chartData = prepareComparisonData(viewingAllDocs.docs, costsMap);
            } else {
              // Both Analysis and Assignments tabs use document amounts for "View All Documents"
              chartData = prepareAnalysisData(viewingAllDocs.docs);
            }
            
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
                <CardContent className="pb-2">
                  <ChartContainer
                    config={{
                      amount: {
                        label: "Amount",
                        color: "hsl(220 13% 69%)",
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
                    className="h-[280px] w-full"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 70 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis 
                          dataKey="period" 
                          angle={-45}
                          textAnchor="end"
                          height={70}
                          className="text-xs"
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis 
                          tickFormatter={(value) => `R ${value.toLocaleString()}`}
                          className="text-xs"
                          tick={{ fontSize: 11 }}
                          width={80}
                        />
                        <ChartTooltip
                          content={<ChartTooltipContent />}
                        />
                        <Bar 
                          dataKey="amount" 
                          fill="hsl(220 13% 69%)"
                          radius={[4, 4, 0, 0]}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </CardContent>
              </Card>
            );
          })()}
          
          <ScrollArea className="flex-1 pr-4 overflow-y-auto">
            {viewingAllDocs && (() => {
              // Fetch calculations when dialog opens
              if (Object.keys(viewingAllDocsCalculations).length === 0) {
                const docIds = viewingAllDocs.docs.map(d => d.documentId);
                supabase
                  .from("document_tariff_calculations")
                  .select(`
                    *,
                    tariff_structures!inner(name)
                  `)
                  .in("document_id", docIds)
                  .eq("meter_id", viewingAllDocs.meter.id)
                  .then(({ data, error }) => {
                    if (!error && data) {
                      const calcsByDoc: Record<string, any> = {};
                      data.forEach(calc => {
                        calcsByDoc[calc.document_id] = calc;
                      });
                      setViewingAllDocsCalculations(calcsByDoc);
                    }
                  });
              }
              
              return null;
            })()}
            
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
                        <div className="flex items-center gap-3">
                          <div className="font-medium">{doc.shopNumber}</div>
                          <div className="text-sm text-muted-foreground">
                            {new Date(doc.periodStart).toLocaleDateString()} - {new Date(doc.periodEnd).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{doc.currency} {(doc.totalAmountExcludingEmergency ?? doc.totalAmount).toFixed(2)}</Badge>
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
