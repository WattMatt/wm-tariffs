import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CalendarIcon, Download, Eye, FileDown, ChevronRight, ChevronLeft, ArrowRight, Check, X, Save, BarChart3, Activity, Calculator, Calendar as CalendarHistoryIcon, Loader2, RotateCcw, Eraser } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Papa from "papaparse";
import SaveReconciliationDialog from "./SaveReconciliationDialog";
import ReconciliationResultsView from "./ReconciliationResultsView";
import ReconciliationHistoryTab from "./ReconciliationHistoryTab";
import ReconciliationCompareTab from "./ReconciliationCompareTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { calculateMeterCost, calculateMeterCostAcrossPeriods } from "@/lib/costCalculation";

interface ReconciliationTabProps {
  siteId: string;
  siteName: string;
}

export default function ReconciliationTab({ siteId, siteName }: ReconciliationTabProps) {
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [timeFrom, setTimeFrom] = useState<string>("00:00");
  const [timeTo, setTimeTo] = useState<string>("23:59");
  const [reconciliationData, setReconciliationData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [columnOperations, setColumnOperations] = useState<Map<string, string>>(new Map());
  const [columnFactors, setColumnFactors] = useState<Map<string, string>>(new Map());
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isDateFromOpen, setIsDateFromOpen] = useState(false);
  const [isDateToOpen, setIsDateToOpen] = useState(false);
  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [availableMeters, setAvailableMeters] = useState<Array<{
    id: string;
    meter_number: string;
    meter_type: string;
    hasData: boolean;
  }>>([]);
  const [meterDateRange, setMeterDateRange] = useState<{
    earliest: Date | null;
    latest: Date | null;
    readingsCount: number;
  }>({ earliest: null, latest: null, readingsCount: 0 });
  const [allMeterDateRanges, setAllMeterDateRanges] = useState<Map<string, {
    earliest: Date | null;
    latest: Date | null;
    readingsCount: number;
  }>>(new Map());
  const [totalDateRange, setTotalDateRange] = useState<{
    earliest: Date | null;
    latest: Date | null;
  }>({ earliest: null, latest: null });
  const [meterIndentLevels, setMeterIndentLevels] = useState<Map<string, number>>(new Map());
  const [meterParentInfo, setMeterParentInfo] = useState<Map<string, string>>(new Map()); // meter_id -> parent meter_number
  const [draggedMeterId, setDraggedMeterId] = useState<string | null>(null);
  const [dragOverMeterId, setDragOverMeterId] = useState<string | null>(null);
  const [selectedMetersForSummation, setSelectedMetersForSummation] = useState<Set<string>>(new Set());
  const [meterConnectionsMap, setMeterConnectionsMap] = useState<Map<string, string[]>>(new Map()); // parent_id -> child_ids
  // Removed reconciliationProgress - now using separate energyProgress and revenueProgress states
  const [meterAssignments, setMeterAssignments] = useState<Map<string, string>>(new Map()); // meter_id -> "grid_supply" | "solar_energy" | "none"
  const [expandedMeters, setExpandedMeters] = useState<Set<string>>(new Set()); // Set of meter IDs that are expanded
  const [userSetDates, setUserSetDates] = useState(false); // Track if user manually set dates
  const [failedMeters, setFailedMeters] = useState<Map<string, string>>(new Map()); // meter_id -> error message
  const [isColumnsOpen, setIsColumnsOpen] = useState(true); // Control collapse state of columns section
  const [isMetersOpen, setIsMetersOpen] = useState(true); // Control collapse state of meters section
  const [sortColumn, setSortColumn] = useState<'meter' | 'grid' | 'solar' | 'status' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [documentDateRanges, setDocumentDateRanges] = useState<Array<{
    id: string;
    document_type: string;
    file_name: string;
    period_start: string;
    period_end: string;
  }>>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [isLoadingDateRanges, setIsLoadingDateRanges] = useState(false);
  const [revenueReconciliationEnabled, setRevenueReconciliationEnabled] = useState(false);
  const [isCalculatingRevenue, setIsCalculatingRevenue] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    currentDocument: string;
    current: number;
    total: number;
  }>({ currentDocument: '', current: 0, total: 0 });
  const [energyProgress, setEnergyProgress] = useState({ current: 0, total: 0 });
  const [revenueProgress, setRevenueProgress] = useState({ current: 0, total: 0 });
  
  // Cancel reconciliation ref
  const cancelReconciliationRef = useRef(false);
  
  // Refs for stable access to latest values in callbacks
  const previewDataRef = useRef<any>(null);
  const selectedColumnsRef = useRef<Set<string>>(new Set());
  const columnFactorsRef = useRef<Map<string, string>>(new Map());
  const columnOperationsRef = useRef<Map<string, string>>(new Map());

  // Persistent reconciliation state key
  const reconciliationStateKey = `reconciliation_state_${siteId}`;
  
  // localStorage key for manual indent levels
  const indentLevelsStorageKey = `reconciliation-indent-levels-${siteId}`;
  
  // Save manual indent levels to localStorage
  const saveIndentLevelsToStorage = (levels: Map<string, number>) => {
    try {
      const levelsObj = Object.fromEntries(levels);
      localStorage.setItem(indentLevelsStorageKey, JSON.stringify(levelsObj));
    } catch (error) {
      console.error("Error saving indent levels to localStorage:", error);
    }
  };
  
  // Load manual indent levels from localStorage
  const loadIndentLevelsFromStorage = (): Map<string, number> => {
    try {
      const stored = localStorage.getItem(indentLevelsStorageKey);
      if (stored) {
        const levelsObj = JSON.parse(stored);
        return new Map(Object.entries(levelsObj).map(([k, v]) => [k, v as number]));
      }
    } catch (error) {
      console.error("Error loading indent levels from localStorage:", error);
    }
    return new Map();
  };
  
  // Clear manual indent levels from localStorage
  const clearIndentLevelsFromStorage = () => {
    try {
      localStorage.removeItem(indentLevelsStorageKey);
    } catch (error) {
      console.error("Error clearing indent levels from localStorage:", error);
    }
  };

  // Update refs when state changes
  useEffect(() => {
    previewDataRef.current = previewData;
  }, [previewData]);
  
  useEffect(() => {
    selectedColumnsRef.current = selectedColumns;
  }, [selectedColumns]);
  
  useEffect(() => {
    columnFactorsRef.current = columnFactors;
  }, [columnFactors]);
  
  useEffect(() => {
    columnOperationsRef.current = columnOperations;
  }, [columnOperations]);

  // Restore persistent state on mount
  useEffect(() => {
    const savedState = localStorage.getItem(reconciliationStateKey);
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        if (parsed.isLoading || parsed.isCalculatingRevenue) {
          setIsLoading(parsed.isLoading || false);
          setIsCalculatingRevenue(parsed.isCalculatingRevenue || false);
          setEnergyProgress(parsed.energyProgress || { current: 0, total: 0 });
          setRevenueProgress(parsed.revenueProgress || { current: 0, total: 0 });
          if (parsed.reconciliationData) {
            setReconciliationData(parsed.reconciliationData);
          }
          toast.info("Resuming reconciliation process...");
        }
      } catch (e) {
        console.error("Failed to restore reconciliation state:", e);
      }
    }
  }, [siteId, reconciliationStateKey]);
  
  // Save reconciliation state to localStorage whenever it changes
  useEffect(() => {
    if (isLoading || isCalculatingRevenue) {
      const stateToSave = {
        isLoading,
        isCalculatingRevenue,
        energyProgress,
        revenueProgress,
        reconciliationData,
        timestamp: Date.now()
      };
      localStorage.setItem(reconciliationStateKey, JSON.stringify(stateToSave));
    } else {
      // Clear state when reconciliation completes
      localStorage.removeItem(reconciliationStateKey);
    }
  }, [isLoading, isCalculatingRevenue, energyProgress, revenueProgress, reconciliationData, reconciliationStateKey]);

  // Save reconciliation settings
  const saveReconciliationSettings = async () => {
    try {
      const settingsData = {
        site_id: siteId,
        available_columns: previewData?.availableColumns || [],
        meter_associations: Object.fromEntries(meterAssignments),
        selected_columns: Array.from(selectedColumns),
        column_operations: Object.fromEntries(columnOperations),
        column_factors: Object.fromEntries(columnFactors),
        meter_order: availableMeters.map(m => m.id),
        meters_for_summation: Array.from(selectedMetersForSummation)
      };

      const { error } = await supabase
        .from('site_reconciliation_settings')
        .upsert(settingsData, { onConflict: 'site_id' });

      if (error) {
        console.error('Error saving reconciliation settings:', error);
      } else {
        toast.success("Settings saved for next time");
      }
    } catch (error) {
      console.error('Error saving reconciliation settings:', error);
    }
  };

  // Reset reconciliation settings
  const resetReconciliationSettings = async () => {
    try {
      const { error } = await supabase
        .from('site_reconciliation_settings')
        .delete()
        .eq('site_id', siteId);

      if (error) throw error;

      // Clear local state
      setSelectedColumns(new Set());
      setMeterAssignments(new Map());
      setColumnOperations(new Map());
      setColumnFactors(new Map());
      setSelectedMetersForSummation(new Set());

      toast.success("Reconciliation settings reset successfully");
    } catch (error) {
      console.error("Error resetting reconciliation settings:", error);
      toast.error("Failed to reset reconciliation settings");
    }
  };

  // Load saved reconciliation settings
  const loadReconciliationSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('site_reconciliation_settings')
        .select('*')
        .eq('site_id', siteId)
        .maybeSingle();

      if (error) {
        console.error('Error loading reconciliation settings:', error);
        return;
      }

      if (data) {
        // Restore meter assignments
        const associations = new Map(Object.entries(data.meter_associations || {}));
        setMeterAssignments(associations);
        
        // Store saved meter order for restoration after availableMeters is loaded
        if (data.meter_order && data.meter_order.length > 0) {
          (window as any).__savedMeterOrder = data.meter_order;
        }
        
        // Restore meters for summation
        if (data.meters_for_summation && data.meters_for_summation.length > 0) {
          setSelectedMetersForSummation(new Set(data.meters_for_summation));
        }
      }
    } catch (error) {
      console.error('Error loading reconciliation settings:', error);
    }
  };

  // Load settings on component mount
  useEffect(() => {
    loadReconciliationSettings();
  }, [siteId]);

  // Fetch document date ranges (Municipal and Tenant Bills)
  useEffect(() => {
    const fetchDocumentDateRanges = async () => {
      setIsLoadingDocuments(true);
      const { data, error } = await supabase
        .from('site_documents')
        .select(`
          id,
          document_type,
          file_name,
          document_extractions (
            period_start,
            period_end
          )
        `)
        .eq('site_id', siteId)
        .in('document_type', ['municipal_account', 'tenant_bill'])
        .not('document_extractions.period_start', 'is', null)
        .not('document_extractions.period_end', 'is', null);

      if (error) {
        console.error("Error fetching document date ranges:", error);
        setIsLoadingDocuments(false);
        return;
      }

      if (data) {
        const ranges = data
          .filter(doc => doc.document_extractions && doc.document_extractions.length > 0)
          .map(doc => ({
            id: doc.id,
            document_type: doc.document_type,
            file_name: doc.file_name,
            period_start: doc.document_extractions[0].period_start,
            period_end: doc.document_extractions[0].period_end,
          }))
          .sort((a, b) => {
            return new Date(b.period_start).getTime() - new Date(a.period_start).getTime();
          });

        setDocumentDateRanges(ranges);
      }
      setIsLoadingDocuments(false);
    };

    fetchDocumentDateRanges();
  }, [siteId]);

  // Fetch available meters with CSV data and build hierarchy
  useEffect(() => {
    const fetchAvailableMeters = async () => {
      try {
        setIsLoadingDateRanges(true);
        // Get all meters for this site
        const { data: meters, error: metersError } = await supabase
          .from("meters")
          .select("id, meter_number, meter_type, tariff_structure_id")
          .eq("site_id", siteId)
          .order("meter_number");

        if (metersError || !meters) {
          console.error("Error fetching meters:", metersError);
          return;
        }

        // Fetch meter connections - ONLY for meters in this site
        const { data: connections, error: connectionsError } = await supabase
          .from("meter_connections")
          .select(`
            parent_meter_id,
            child_meter_id,
            parent:meters!meter_connections_parent_meter_id_fkey(site_id),
            child:meters!meter_connections_child_meter_id_fkey(site_id)
          `);

        if (connectionsError) {
          console.error("Error fetching meter connections:", connectionsError);
        }

        // Filter to only connections where BOTH meters are in the current site
        const siteConnections = connections?.filter(conn => 
          conn.parent?.site_id === siteId && conn.child?.site_id === siteId
        ) || [];

        // Build parent-child map for hierarchy
        // DB structure: parent_meter_id is the parent (upstream), child_meter_id is the child (downstream)
        // For display: we want childrenMap where key = parent, value = children
        const childrenMap = new Map<string, string[]>();
        
        siteConnections.forEach(conn => {
          // conn.parent_meter_id is the parent (upstream)
          // conn.child_meter_id is the child (downstream)
          if (!childrenMap.has(conn.parent_meter_id)) {
            childrenMap.set(conn.parent_meter_id, []);
          }
          childrenMap.get(conn.parent_meter_id)!.push(conn.child_meter_id);
        });

        // Check which meters have actual readings data
        const metersWithData = await Promise.all(
          meters.map(async (meter) => {
            const { data: readings } = await supabase
              .from("meter_readings")
              .select("id")
              .eq("meter_id", meter.id)
              .limit(1);

            return {
              ...meter,
              hasData: readings && readings.length > 0,
            };
          })
        );

        // Build hierarchical meter list
        const meterMap = new Map(metersWithData.map(m => [m.id, m]));
        const processedMeters = new Set<string>();
        const hierarchicalMeters: typeof metersWithData = [];
        const indentLevels = new Map<string, number>();
        
        // Build parent info map: child meter_id -> parent meter_number
        // Also build connections map: parent_id -> child_ids for hierarchical calculations
        const meterParentMap = new Map<string, string>();
        const connectionsMap = new Map<string, string[]>();
        
        siteConnections.forEach(conn => {
          // conn.parent_meter_id is the parent (upstream)
          // conn.child_meter_id is the child (downstream)
          const parentMeter = metersWithData.find(m => m.id === conn.parent_meter_id);
          if (parentMeter) {
            meterParentMap.set(conn.child_meter_id, parentMeter.meter_number);
          }
          
          // Build connections map for calculations: parent -> children
          if (!connectionsMap.has(conn.parent_meter_id)) {
            connectionsMap.set(conn.parent_meter_id, []);
          }
          connectionsMap.get(conn.parent_meter_id)!.push(conn.child_meter_id);
        });
        
        setMeterConnectionsMap(connectionsMap);

        // Check if we have any connections in the database
        const hasConnections = siteConnections && siteConnections.length > 0;

        if (hasConnections) {
          // Recursive function to add meter and its children
          const addMeterWithChildren = (meterId: string, level: number) => {
            if (processedMeters.has(meterId)) return;
            
            const meter = meterMap.get(meterId);
            if (!meter) return;
            
            hierarchicalMeters.push(meter);
            indentLevels.set(meterId, level);
            processedMeters.add(meterId);
            
            // Add all children of this meter
            const children = childrenMap.get(meterId) || [];
            
            // Helper function to get meter type priority
            const getMeterTypePriority = (meterType: string): number => {
              switch (meterType) {
                case 'bulk_meter': return 0;
                case 'check_meter': return 1;
                case 'tenant_meter': return 2;
                case 'other': return 3;
                default: return 3;
              }
            };
            
            children.sort((a, b) => {
              const meterA = meterMap.get(a);
              const meterB = meterMap.get(b);
              
              // First sort by meter type priority
              const priorityA = getMeterTypePriority(meterA?.meter_type || '');
              const priorityB = getMeterTypePriority(meterB?.meter_type || '');
              
              if (priorityA !== priorityB) {
                return priorityA - priorityB;
              }
              
              // Then sort alphabetically by meter number
              return (meterA?.meter_number || '').localeCompare(meterB?.meter_number || '');
            });
            
            children.forEach(childId => {
              addMeterWithChildren(childId, level + 1);
            });
          };
          
          // Find all bulk meters (they have no parent in connections)
          const allChildIds = new Set<string>();
          childrenMap.forEach(children => {
            children.forEach(childId => allChildIds.add(childId));
          });
          
          const bulkMeters = metersWithData
            .filter(m => m.meter_type === 'bulk_meter' && !allChildIds.has(m.id))
            .sort((a, b) => a.meter_number.localeCompare(b.meter_number));
          
          // Start hierarchy with bulk meters at level 0
          bulkMeters.forEach(meter => {
            addMeterWithChildren(meter.id, 0);
          });
          
          // Process any check meters that aren't connected to bulk meters
          const checkMeters = metersWithData
            .filter(m => m.meter_type === 'check_meter' && !processedMeters.has(m.id) && !allChildIds.has(m.id))
            .sort((a, b) => a.meter_number.localeCompare(b.meter_number));
          
          checkMeters.forEach(meter => {
            addMeterWithChildren(meter.id, 0);
          });
          
          // Process any tenant meters that aren't connected
          const tenantMeters = metersWithData
            .filter(m => m.meter_type === 'tenant_meter' && !processedMeters.has(m.id) && !allChildIds.has(m.id))
            .sort((a, b) => a.meter_number.localeCompare(b.meter_number));
          
          tenantMeters.forEach(meter => {
            addMeterWithChildren(meter.id, 0);
          });
          
          // Process any remaining meters
          metersWithData
            .filter(m => !processedMeters.has(m.id))
            .sort((a, b) => a.meter_number.localeCompare(b.meter_number))
            .forEach(meter => {
              addMeterWithChildren(meter.id, 0);
            });
        } else {
          // Fallback: Use meter types to create visual hierarchy
          // Bulk (0) → Check (1) → Tenant (2) → Other (3)
          const getIndentByType = (meterType: string): number => {
            switch (meterType) {
              case 'bulk_meter': return 0;
              case 'check_meter': return 1;
              case 'tenant_meter': return 2;
              case 'other': return 3;
              default: return 3;
            }
          };

          // Sort meters by type hierarchy
          const sortedMeters = [...metersWithData].sort((a, b) => {
            const levelA = getIndentByType(a.meter_type);
            const levelB = getIndentByType(b.meter_type);
            if (levelA !== levelB) return levelA - levelB;
            return a.meter_number.localeCompare(b.meter_number);
          });

          sortedMeters.forEach(meter => {
            hierarchicalMeters.push(meter);
            indentLevels.set(meter.id, getIndentByType(meter.meter_type));
          });
        }

        // Check if we have saved meter order to restore
        const savedMeterOrder = (window as any).__savedMeterOrder;
        if (savedMeterOrder && savedMeterOrder.length > 0) {
          // Reorder hierarchicalMeters based on saved order
          const orderedMeters: typeof hierarchicalMeters = [];
          const metersById = new Map(hierarchicalMeters.map(m => [m.id, m]));
          
          // Add meters in saved order
          savedMeterOrder.forEach((meterId: string) => {
            const meter = metersById.get(meterId);
            if (meter) {
              orderedMeters.push(meter);
              metersById.delete(meterId);
            }
          });
          
          // Add any new meters that weren't in the saved order
          metersById.forEach(meter => orderedMeters.push(meter));
          
          setAvailableMeters(orderedMeters);
          delete (window as any).__savedMeterOrder;
        } else {
          setAvailableMeters(hierarchicalMeters);
        }
        
        // Merge database hierarchy with any saved manual indent overrides
        const savedIndentLevels = loadIndentLevelsFromStorage();
        const mergedIndentLevels = new Map(indentLevels);
        
        // Apply saved manual overrides (they take precedence)
        savedIndentLevels.forEach((level, meterId) => {
          if (mergedIndentLevels.has(meterId)) {
            mergedIndentLevels.set(meterId, level);
          }
        });
        
        setMeterIndentLevels(mergedIndentLevels);
        setMeterParentInfo(meterParentMap);

        // Fetch date ranges for all meters with data
        const dateRangesMap = new Map();
        await Promise.all(
          hierarchicalMeters
            .filter(m => m.hasData)
            .map(async (meter) => {
              const { data: earliestData } = await supabase
                .from("meter_readings")
                .select("reading_timestamp")
                .eq("meter_id", meter.id)
                .order("reading_timestamp", { ascending: true })
                .limit(1);

              const { data: latestData } = await supabase
                .from("meter_readings")
                .select("reading_timestamp")
                .eq("meter_id", meter.id)
                .order("reading_timestamp", { ascending: false })
                .limit(1);

              const { count } = await supabase
                .from("meter_readings")
                .select("*", { count: "exact", head: true })
                .eq("meter_id", meter.id);

              if (earliestData && earliestData.length > 0 && latestData && latestData.length > 0) {
                dateRangesMap.set(meter.id, {
                  earliest: new Date(earliestData[0].reading_timestamp),
                  latest: new Date(latestData[0].reading_timestamp),
                  readingsCount: count || 0
                });
              }
            })
        );
        
        setAllMeterDateRanges(dateRangesMap);

        // Calculate overall date range
        let overallEarliest: Date | null = null;
        let overallLatest: Date | null = null;
        
        dateRangesMap.forEach((range) => {
          if (range.earliest) {
            if (!overallEarliest || range.earliest < overallEarliest) {
              overallEarliest = range.earliest;
            }
          }
          if (range.latest) {
            if (!overallLatest || range.latest > overallLatest) {
              overallLatest = range.latest;
            }
          }
        });
        
        setTotalDateRange({ earliest: overallEarliest, latest: overallLatest });

        // Auto-select first meter with data, or bulk meter if available
        const bulkMeter = hierarchicalMeters.find(m => m.meter_type === "bulk_meter" && m.hasData);
        const firstMeterWithData = hierarchicalMeters.find(m => m.hasData);
        
        if (bulkMeter) {
          setSelectedMeterId(bulkMeter.id);
        } else if (firstMeterWithData) {
          setSelectedMeterId(firstMeterWithData.id);
        }
      } catch (error) {
        console.error("Error fetching available meters:", error);
      } finally {
        setIsLoadingDateRanges(false);
      }
    };

    fetchAvailableMeters();
  }, [siteId]);

  // Auto-expand all parent meters when reconciliation data loads
  useEffect(() => {
    if (reconciliationData) {
      const allParentIds = Array.from(meterConnectionsMap.keys());
      setExpandedMeters(new Set(allParentIds));
    }
  }, [reconciliationData, meterConnectionsMap]);

  // Fetch meter-specific date range when meter is selected
  useEffect(() => {
    if (!selectedMeterId) {
      setMeterDateRange({ earliest: null, latest: null, readingsCount: 0 });
      return;
    }

    const fetchMeterDateRange = async () => {
      try {
        // Get earliest timestamp
        const { data: earliestData, error: earliestError } = await supabase
          .from("meter_readings")
          .select("reading_timestamp")
          .eq("meter_id", selectedMeterId)
          .order("reading_timestamp", { ascending: true })
          .limit(1);

        // Get latest timestamp
        const { data: latestData, error: latestError } = await supabase
          .from("meter_readings")
          .select("reading_timestamp")
          .eq("meter_id", selectedMeterId)
          .order("reading_timestamp", { ascending: false })
          .limit(1);

        // Get total count
        const { count, error: countError } = await supabase
          .from("meter_readings")
          .select("*", { count: "exact", head: true })
          .eq("meter_id", selectedMeterId);

        if (earliestError || latestError || countError) {
          console.error("Error fetching meter date range:", earliestError || latestError || countError);
          return;
        }

        if (!earliestData || earliestData.length === 0 || !latestData || latestData.length === 0) {
          setMeterDateRange({ earliest: null, latest: null, readingsCount: 0 });
          return;
        }

        const earliest = new Date(earliestData[0].reading_timestamp);
        const latest = new Date(latestData[0].reading_timestamp);

        setMeterDateRange({
          earliest,
          latest,
          readingsCount: count || 0
        });

        // Only auto-set dates if user hasn't manually set them
        if (!userSetDates) {
          setDateFrom(earliest);
          setDateTo(latest);
          setTimeFrom(format(earliest, "HH:mm"));
          setTimeTo(format(latest, "HH:mm"));
        }
      } catch (error) {
        console.error("Error fetching meter date range:", error);
      }
    };

    fetchMeterDateRange();
  }, [selectedMeterId]);

  // Update date range when bulk documents are selected
  useEffect(() => {
    if (selectedDocumentIds.length === 0) {
      // When cleared, revert to overall date range if available
      if (totalDateRange.earliest && totalDateRange.latest && !userSetDates) {
        setDateFrom(totalDateRange.earliest);
        setDateTo(totalDateRange.latest);
        setTimeFrom(format(totalDateRange.earliest, "HH:mm"));
        setTimeTo(format(totalDateRange.latest, "HH:mm"));
      }
      return;
    }

    // Find the earliest period from selected documents
    const selectedDocs = documentDateRanges.filter(d => selectedDocumentIds.includes(d.id));
    if (selectedDocs.length === 0) return;

    const earliestDoc = selectedDocs.reduce((earliest, current) => {
      return new Date(current.period_start) < new Date(earliest.period_start) ? current : earliest;
    });

    // Update the date range to match the earliest period for preview
    const startDate = new Date(earliestDoc.period_start);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(earliestDoc.period_end);
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 0, 0);

    setDateFrom(startDate);
    setDateTo(endDate);
    setTimeFrom("00:00");
    setTimeTo("23:59");
    setUserSetDates(false); // Allow bulk selection to override dates
  }, [selectedDocumentIds, documentDateRanges, totalDateRange, userSetDates]);

  // Toggle expand/collapse for meters
  const toggleMeterExpanded = (meterId: string) => {
    const newExpanded = new Set(expandedMeters);
    if (newExpanded.has(meterId)) {
      newExpanded.delete(meterId);
    } else {
      newExpanded.add(meterId);
    }
    setExpandedMeters(newExpanded);
  };

  // Check if a meter is visible based on hierarchy
  const isMeterVisible = (meterId: string) => {
    // Find parent of this meter
    const parentId = Array.from(meterConnectionsMap.entries())
      .find(([_, children]) => children.includes(meterId))?.[0];
    
    // If no parent, always visible
    if (!parentId) return true;
    
    // If has parent, check if parent is expanded
    if (!expandedMeters.has(parentId)) return false;
    
    // Recursively check if all ancestors are visible
    return isMeterVisible(parentId);
  };

  const handleIndentMeter = (meterId: string) => {
    const newLevels = new Map(meterIndentLevels);
    
    // If this meter is part of a selection, indent all selected meters
    if (selectedMetersForSummation.has(meterId) && selectedMetersForSummation.size > 1) {
      selectedMetersForSummation.forEach(id => {
        const currentLevel = newLevels.get(id) || 0;
        const newLevel = Math.min(currentLevel + 1, 6); // Max 6 levels
        newLevels.set(id, newLevel);
      });
      toast.success(`Indented ${selectedMetersForSummation.size} meter(s)`);
    } else {
      // Otherwise just indent this meter
      const currentLevel = newLevels.get(meterId) || 0;
      const newLevel = Math.min(currentLevel + 1, 6); // Max 6 levels
      newLevels.set(meterId, newLevel);
    }
    
    setMeterIndentLevels(newLevels);
    saveIndentLevelsToStorage(newLevels); // Persist to localStorage
  };

  const handleOutdentMeter = (meterId: string) => {
    const newLevels = new Map(meterIndentLevels);
    
    // If this meter is part of a selection, outdent all selected meters
    if (selectedMetersForSummation.has(meterId) && selectedMetersForSummation.size > 1) {
      selectedMetersForSummation.forEach(id => {
        const currentLevel = newLevels.get(id) || 0;
        const newLevel = Math.max(currentLevel - 1, 0); // Min 0 levels
        newLevels.set(id, newLevel);
      });
      toast.success(`Outdented ${selectedMetersForSummation.size} meter(s)`);
    } else {
      // Otherwise just outdent this meter
      const currentLevel = newLevels.get(meterId) || 0;
      const newLevel = Math.max(currentLevel - 1, 0); // Min 0 levels
      newLevels.set(meterId, newLevel);
    }
    
    setMeterIndentLevels(newLevels);
    saveIndentLevelsToStorage(newLevels); // Persist to localStorage
  };
  
  // Reset meter hierarchy to database defaults
  const handleResetHierarchy = () => {
    clearIndentLevelsFromStorage();
    toast.success("Meter hierarchy reset. Refreshing...");
    // Trigger re-fetch by setting meters to empty which will cause useEffect to re-run
    setAvailableMeters([]);
  };

  const handleDragStart = (e: React.DragEvent, meterId: string) => {
    setDraggedMeterId(meterId);
    e.dataTransfer.effectAllowed = "move";
    
    // If dragging a selected meter, add visual feedback for multi-select
    if (selectedMetersForSummation.has(meterId) && selectedMetersForSummation.size > 1) {
      e.dataTransfer.setData("text/plain", `${selectedMetersForSummation.size} meters`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragEnter = (meterId: string) => {
    setDragOverMeterId(meterId);
  };

  const handleDragLeave = () => {
    setDragOverMeterId(null);
  };

  const handleDrop = (e: React.DragEvent, targetMeterId: string) => {
    e.preventDefault();
    
    if (!draggedMeterId || draggedMeterId === targetMeterId) {
      setDraggedMeterId(null);
      setDragOverMeterId(null);
      return;
    }

    const targetIndex = availableMeters.findIndex(m => m.id === targetMeterId);
    if (targetIndex === -1) {
      setDraggedMeterId(null);
      setDragOverMeterId(null);
      return;
    }

    // Check if we're dragging multiple selected meters
    const isDraggingMultiple = selectedMetersForSummation.has(draggedMeterId) && selectedMetersForSummation.size > 1;
    
    if (isDraggingMultiple) {
      // Move all selected meters together
      const selectedMeterIds = Array.from(selectedMetersForSummation);
      const nonSelectedMeters = availableMeters.filter(m => !selectedMetersForSummation.has(m.id));
      const selectedMeters = availableMeters.filter(m => selectedMetersForSummation.has(m.id));
      
      // Insert selected meters at target position
      const newMeters = [...nonSelectedMeters];
      const insertIndex = newMeters.findIndex(m => m.id === targetMeterId);
      
      if (insertIndex !== -1) {
        newMeters.splice(insertIndex, 0, ...selectedMeters);
      } else {
        // Target is one of the selected meters, insert before it
        const targetInSelected = selectedMeters.findIndex(m => m.id === targetMeterId);
        if (targetInSelected !== -1) {
          newMeters.push(...selectedMeters);
        }
      }
      
      setAvailableMeters(newMeters);
    } else {
      // Single meter drag
      const draggedIndex = availableMeters.findIndex(m => m.id === draggedMeterId);
      
      if (draggedIndex === -1) {
        setDraggedMeterId(null);
        setDragOverMeterId(null);
        return;
      }

      const newMeters = [...availableMeters];
      const [removed] = newMeters.splice(draggedIndex, 1);
      newMeters.splice(targetIndex, 0, removed);

      setAvailableMeters(newMeters);
    }
    
    setDraggedMeterId(null);
    setDragOverMeterId(null);
  };

  const handleDragEnd = () => {
    setDraggedMeterId(null);
    setDragOverMeterId(null);
  };

  // Helper to combine date and time and format as naive timestamp string
  const getFullDateTime = (date: Date, time: string): string => {
    const [hours, minutes] = time.split(':').map(Number);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hrs = String(hours).padStart(2, '0');
    const mins = String(minutes).padStart(2, '0');
    // Return formatted string without timezone: "YYYY-MM-DD HH:mm:ss"
    return `${year}-${month}-${day} ${hrs}:${mins}:00`;
  };

  const handlePreview = async () => {
    if (!dateFrom || !dateTo) {
      toast.error("Please select a date range");
      return;
    }

    if (!selectedMeterId) {
      toast.error("Please select a meter to preview");
      return;
    }

    setIsLoadingPreview(true);

    try {
      // First check if there's any data in the selected range
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      const { count, error: countError } = await supabase
        .from("meter_readings")
        .select("*", { count: "exact", head: true })
        .eq("meter_id", selectedMeterId)
        .gte("reading_timestamp", fullDateTimeFrom)
        .lte("reading_timestamp", fullDateTimeTo);

      if (countError) throw countError;

      if (count === 0) {
        toast.error(
          `No data found for the selected date range. This meter has data from ${
            meterDateRange.earliest ? format(meterDateRange.earliest, "MMM dd, yyyy") : "N/A"
          } to ${
            meterDateRange.latest ? format(meterDateRange.latest, "MMM dd, yyyy") : "N/A"
          }`
        );
        setIsLoadingPreview(false);
        return;
      }

      // Fetch the selected meter
      const { data: meterData, error: meterError } = await supabase
        .from("meters")
        .select("id, meter_number, meter_type")
        .eq("id", selectedMeterId)
        .single();

      if (meterError || !meterData) {
        toast.error("Failed to fetch selected meter");
        setIsLoadingPreview(false);
        return;
      }

      const selectedMeter = meterData;

      // Fetch column mapping from CSV file
      const { data: csvFile, error: csvError } = await supabase
        .from("meter_csv_files")
        .select("column_mapping")
        .eq("meter_id", selectedMeter.id)
        .not("column_mapping", "is", null)
        .order("parsed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (csvError) {
        console.error("Error fetching column mapping:", csvError);
      }

      const columnMapping = csvFile?.column_mapping as any;

      // Fetch ALL readings using pagination (Supabase has 1000-row server limit)
      let allReadings: any[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error: readingsError } = await supabase
          .from("meter_readings")
          .select("*")
          .eq("meter_id", selectedMeter.id)
          .gte("reading_timestamp", fullDateTimeFrom)
          .lte("reading_timestamp", fullDateTimeTo)
          .order("reading_timestamp", { ascending: true })
          .range(from, from + pageSize - 1);

        if (readingsError) {
          toast.error(`Failed to fetch readings: ${readingsError.message}`);
          setIsLoadingPreview(false);
          return;
        }

        if (pageData && pageData.length > 0) {
          allReadings = [...allReadings, ...pageData];
          from += pageSize;
          hasMore = pageData.length === pageSize; // Continue if we got a full page
        } else {
          hasMore = false;
        }
      }

      const readings = allReadings;

      if (!readings || readings.length === 0) {
        toast.error("No readings found in selected date range");
        setIsLoadingPreview(false);
        return;
      }

      // Debug: Log actual number of readings fetched
      console.log(`Preview: Fetched ${readings.length} readings for meter ${selectedMeter.meter_number}`);

      // Extract available columns from column_mapping configuration
      const availableColumns = new Set<string>();
      if (columnMapping && columnMapping.renamedHeaders) {
        // Use the renamed headers from the parsing configuration
        Object.values(columnMapping.renamedHeaders).forEach((headerName: any) => {
          if (headerName && typeof headerName === 'string') {
            availableColumns.add(headerName);
          }
        });
      } else if (readings.length > 0) {
        // Fallback: extract from first reading's metadata if no column mapping
        const metadata = readings[0].metadata as any;
        if (metadata && metadata.imported_fields) {
          Object.keys(metadata.imported_fields).forEach(key => {
            availableColumns.add(key);
          });
        }
      }

      // Debug logging
      console.log('Column Mapping:', columnMapping);
      console.log('Available Columns:', Array.from(availableColumns));
      console.log('Sample Reading Metadata:', readings[0]?.metadata);

      // Auto-select all columns initially
      setSelectedColumns(new Set(availableColumns));

      // Calculate totals and store raw values for operations
      const totalKwh = readings.reduce((sum, r) => sum + Number(r.kwh_value || 0), 0);
      const columnTotals: Record<string, number> = {};
      const columnValues: Record<string, number[]> = {};
      
      readings.forEach(reading => {
        const metadata = reading.metadata as any;
        const importedFields = metadata?.imported_fields || {};
        Object.entries(importedFields).forEach(([key, value]) => {
          const numValue = Number(value);
          if (!isNaN(numValue) && value !== null && value !== '') {
            // Store for sum operation
            columnTotals[key] = (columnTotals[key] || 0) + numValue;
            // Store raw values for other operations
            if (!columnValues[key]) {
              columnValues[key] = [];
            }
            columnValues[key].push(numValue);
          }
        });
      });

      setPreviewData({
        meterNumber: selectedMeter.meter_number,
        meterType: selectedMeter.meter_type,
        totalReadings: readings.length,
        firstReading: readings[0],
        lastReading: readings[readings.length - 1],
        sampleReadings: readings.slice(0, 5),
        availableColumns: Array.from(availableColumns),
        totalKwh,
        columnTotals,
        columnValues
      });

      // Restore saved settings if available
      try {
        const { data: savedSettings } = await supabase
          .from('site_reconciliation_settings')
          .select('*')
          .eq('site_id', siteId)
          .maybeSingle();

        if (savedSettings) {
          // Restore selected columns (only if they exist in current available columns)
          if (savedSettings.selected_columns && savedSettings.selected_columns.length > 0) {
            const validSelectedColumns = savedSettings.selected_columns.filter((col: string) => 
              availableColumns.has(col)
            );
            if (validSelectedColumns.length > 0) {
              setSelectedColumns(new Set(validSelectedColumns));
            }
          }

          // Restore column operations
          if (savedSettings.column_operations) {
            const operations = new Map(Object.entries(savedSettings.column_operations || {}));
            setColumnOperations(operations);
          }

          // Restore column factors
          if (savedSettings.column_factors) {
            const factors = new Map(Object.entries(savedSettings.column_factors || {}));
            setColumnFactors(factors);
          }

          toast.success("Restored previous settings");
        }
      } catch (error) {
        console.error("Error restoring settings:", error);
      }

      toast.success("Preview loaded successfully");
    } catch (error) {
      console.error("Preview error:", error);
      toast.error("Failed to load preview");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Helper function to process meters in batches
  const processMeterBatches = async (
    meters: any[], 
    batchSize: number,
    fullDateTimeFrom: string,
    fullDateTimeTo: string
  ) => {
    const results: any[] = [];
    const errors = new Map<string, string>();
    const retryingMeters = new Set<string>();
    
    for (let i = 0; i < meters.length; i += batchSize) {
      // Check if reconciliation was cancelled
      if (cancelReconciliationRef.current) {
        throw new Error('Reconciliation cancelled by user');
      }
      
      const batch = meters.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(meters.length / batchSize);
      
      const retryingList = Array.from(retryingMeters).join(', ');
      const statusMessage = retryingList 
        ? `Processing batch ${batchNumber} of ${totalBatches} (retrying: ${retryingList})`
        : `Processing batch ${batchNumber} of ${totalBatches}`;
      console.log(statusMessage);
      
      const batchResults = await Promise.all(
        batch.map(async (meter) => {
          const result = await processSingleMeter(meter, fullDateTimeFrom, fullDateTimeTo, errors, 0, retryingMeters);
          retryingMeters.delete(meter.meter_number);
          return result;
        })
      );
      
      results.push(...batchResults);
      
      // Update progress after each batch
      setEnergyProgress({
        current: Math.min(i + batchSize, meters.length),
        total: meters.length
      });
    }
    
    return { results, errors };
  };

  // Helper function to process a single meter with retry logic
  const processSingleMeter = async (
    meter: any,
    fullDateTimeFrom: string,
    fullDateTimeTo: string,
    errors: Map<string, string>,
    retryCount = 0,
    retryingMeters?: Set<string>
  ): Promise<any> => {
    // Check for cancellation at the start
    if (cancelReconciliationRef.current) {
      throw new Error('Reconciliation cancelled by user');
    }
    
    const maxRetries = 3;
    const clientTimeout = 10000; // 10 seconds client-side timeout
    
    try {
      // Fetch all readings using pagination to avoid 1000-row limit
      let allReadings: any[] = [];
      let start = 0;
      const pageSize = 1000;
      let hasMore = true;
      let fetchError: any = null;

      // Wrap entire pagination loop in client-side timeout
      const fetchAllPages = async () => {
        while (hasMore) {
          // Check for cancellation during pagination
          if (cancelReconciliationRef.current) {
            throw new Error('Reconciliation cancelled by user');
          }
          
          const { data: pageReadings, error: pageError } = await supabase
            .from("meter_readings")
            .select("kwh_value, reading_timestamp, metadata")
            .eq("meter_id", meter.id)
            .gte("reading_timestamp", fullDateTimeFrom)
            .lte("reading_timestamp", fullDateTimeTo)
            .order("reading_timestamp", { ascending: true })
            .range(start, start + pageSize - 1);

          if (pageError) {
            fetchError = pageError;
            break;
          }

          if (pageReadings && pageReadings.length > 0) {
            allReadings = allReadings.concat(pageReadings);
            start += pageSize;
            hasMore = pageReadings.length === pageSize;
            
            if (pageReadings.length === pageSize) {
              console.log(`Fetching page ${Math.floor(start / pageSize)} for meter ${meter.meter_number}...`);
            }
          } else {
            hasMore = false;
          }
        }
        return { allReadings, fetchError };
      };

      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Client timeout')), clientTimeout)
      );

      let result: { allReadings: any[], fetchError: any };
      try {
        result = await Promise.race([fetchAllPages(), timeoutPromise]) as { allReadings: any[], fetchError: any };
      } catch (timeoutError: any) {
        // Handle client timeout
        if (retryCount < maxRetries) {
          const delay = 2000 * Math.pow(2, retryCount);
          console.warn(`Client timeout for meter ${meter.meter_number}, retry ${retryCount + 1}/${maxRetries} in ${delay/1000}s...`);
          
          if (retryingMeters) {
            retryingMeters.add(meter.meter_number);
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return await processSingleMeter(meter, fullDateTimeFrom, fullDateTimeTo, errors, retryCount + 1, retryingMeters);
        } else {
          console.error(`All retries exhausted for ${meter.meter_number}:`, timeoutError);
          errors.set(meter.id, "Query timeout after multiple retries");
          return {
            ...meter,
            totalKwh: 0,
            totalKwhPositive: 0,
            totalKwhNegative: 0,
            columnTotals: {},
            columnMaxValues: {},
            readingsCount: 0,
            hasData: false,
            hasError: true,
            errorMessage: "Query timeout"
          };
        }
      }

      const readings = result.allReadings;
      const readingsError = result.fetchError;

      if (readingsError) {
        // Check if it's a database timeout error (code 57014)
        const isTimeout = readingsError.code === "57014";
        
        if (isTimeout && retryCount < maxRetries) {
          // Exponential backoff: 2s, 4s, 8s
          const delay = 2000 * Math.pow(2, retryCount);
          console.warn(`DB timeout for meter ${meter.meter_number}, retry ${retryCount + 1}/${maxRetries} in ${delay/1000}s...`);
          
          if (retryingMeters) {
            retryingMeters.add(meter.meter_number);
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return await processSingleMeter(meter, fullDateTimeFrom, fullDateTimeTo, errors, retryCount + 1, retryingMeters);
        }
        
        console.error(`Error fetching readings for meter ${meter.meter_number}:`, readingsError);
        errors.set(meter.id, readingsError.message || "Unknown error");
        return {
          ...meter,
          totalKwh: 0,
          totalKwhPositive: 0,
          totalKwhNegative: 0,
          columnTotals: {},
          columnMaxValues: {},
          readingsCount: 0,
          hasData: false,
          hasError: true,
          errorMessage: readingsError.message
        };
      }

      // Deduplicate by timestamp (take first occurrence of each unique timestamp)
      const uniqueReadings = readings ? 
        Array.from(
          new Map(
            readings.map(r => [r.reading_timestamp, r])
          ).values()
        ) : [];

      // Sum all interval readings (each represents consumption for that period)
      let totalKwh = 0;
      let totalKwhPositive = 0;
      let totalKwhNegative = 0;
      const columnTotals: Record<string, number> = {};
      const columnMaxValues: Record<string, number> = {};
      
      if (uniqueReadings.length > 0) {
        // Sum all interval consumption values
        totalKwh = uniqueReadings.reduce((sum, r) => sum + Number(r.kwh_value), 0);
        
        // Process all numeric columns from metadata
        const columnValues: Record<string, number[]> = {};
        uniqueReadings.forEach(reading => {
          const importedFields = (reading.metadata as any)?.imported_fields || {};
          Object.entries(importedFields).forEach(([key, value]) => {
            // Skip timestamp columns
            if (key.toLowerCase().includes('time') || key.toLowerCase().includes('date')) return;
            
            // Only process selected columns
            if (!selectedColumnsRef.current.has(key)) return;
            
            const numValue = Number(value);
            if (!isNaN(numValue) && value !== null && value !== '') {
              if (!columnValues[key]) {
                columnValues[key] = [];
              }
              columnValues[key].push(numValue);
            }
          });
        });
        
        // Apply operations and scaling to each column
        Object.entries(columnValues).forEach(([key, values]) => {
          const operation = columnOperationsRef.current.get(key) || 'sum';
          const factor = Number(columnFactorsRef.current.get(key) || 1);
          
          let result = 0;
          switch (operation) {
            case 'sum':
              result = values.reduce((sum, val) => sum + val, 0);
              break;
            case 'average':
              result = values.reduce((sum, val) => sum + val, 0) / values.length;
              break;
            case 'max':
              result = Math.max(...values);
              break;
            case 'min':
              result = Math.min(...values);
              break;
          }
          
          // Apply scaling factor
          result = result * factor;
          
          // For kVA columns, track as max values
          if (key.toLowerCase().includes('kva') || key.toLowerCase().includes('s (kva)')) {
            columnMaxValues[key] = result;
          } else {
            columnTotals[key] = result;
          }
        });
        
        // Calculate positive and negative totals from column totals (factors already applied)
        Object.values(columnTotals).forEach((colTotal) => {
          if (colTotal > 0) {
            totalKwhPositive += colTotal;
          } else if (colTotal < 0) {
            totalKwhNegative += colTotal; // Keep negative
          }
        });
        
        // Debug logging
        console.log(`Reconciliation: Meter ${meter.meter_number} (${meter.meter_type}):`, {
          originalReadings: readings?.length || 0,
          uniqueReadings: uniqueReadings.length,
          duplicatesRemoved: (readings?.length || 0) - uniqueReadings.length,
          totalKwh: totalKwh.toFixed(2),
          columnTotals,
          columnMaxValues,
          firstTimestamp: uniqueReadings[0].reading_timestamp,
          lastTimestamp: uniqueReadings[uniqueReadings.length - 1].reading_timestamp
        });
        
        // Alert if we hit the query limit
        if (readings && readings.length >= 100000) {
          console.warn(`WARNING: Meter ${meter.meter_number} may have more than 100k readings - increase limit!`);
        }
      } else {
        console.log(`Meter ${meter.meter_number}: No readings in date range`);
      }

      return {
        ...meter,
        totalKwh,
        totalKwhPositive,
        totalKwhNegative,
        columnTotals,
        columnMaxValues,
        readingsCount: uniqueReadings.length,
        hasData: uniqueReadings.length > 0,
        hasError: false
      };
    } catch (error: any) {
      console.error(`Unexpected error processing meter ${meter.meter_number}:`, error);
      errors.set(meter.id, error.message || "Unexpected error");
      return {
        ...meter,
        totalKwh: 0,
        totalKwhPositive: 0,
        totalKwhNegative: 0,
        columnTotals: {},
        columnMaxValues: {},
        readingsCount: 0,
        hasData: false,
        hasError: true,
        errorMessage: error.message
      };
    }
  };

  // Shared reconciliation calculation function used by both single and bulk reconciliation
  const performReconciliationCalculation = async (
    startDateTime: string,
    endDateTime: string,
    enableRevenue?: boolean
  ) => {
    // Fetch site details including supply authority
    const { data: siteData, error: siteError } = await supabase
      .from("sites")
      .select("id, name, supply_authority_id")
      .eq("id", siteId)
      .single();

    if (siteError || !siteData?.supply_authority_id) {
      throw new Error("Site supply authority not configured");
    }

    // Fetch all meters for the site with tariff assignments
    const { data: meters, error: metersError } = await supabase
      .from("meters")
      .select("id, meter_number, meter_type, tariff_structure_id, assigned_tariff_name, name, location")
      .eq("site_id", siteId);

    if (metersError) {
      console.error("Error fetching meters:", metersError);
      throw new Error("Failed to fetch meters");
    }

    if (!meters || meters.length === 0) {
      throw new Error("No meters found for this site");
    }

    // Process meters in batches of 2 to reduce database load and avoid timeouts
    const { results: meterData, errors } = await processMeterBatches(
      meters,
      2,
      startDateTime,
      endDateTime
    );

    // Ensure meterData is an array
    const safeMeters = Array.isArray(meterData) ? meterData : [];
    
    // Filter meters based on user assignments
    // Fallback: if no assignments exist, use meter types
    let gridSupplyMeters = safeMeters.filter((m) => meterAssignments.get(m.id) === "grid_supply");
    let solarEnergyMeters = safeMeters.filter((m) => meterAssignments.get(m.id) === "solar_energy");
    
    // If no manual assignments, fall back to meter types
    if (gridSupplyMeters.length === 0 && solarEnergyMeters.length === 0) {
      gridSupplyMeters = safeMeters.filter((m) => m.meter_type === "bulk_meter");
      solarEnergyMeters = [];
    }
    
    const checkMeters = safeMeters.filter((m) => m.meter_type === "check_meter");
    const tenantMeters = safeMeters.filter((m) => m.meter_type === "tenant_meter");
    
    const assignedMeterIds = new Set([
      ...(Array.isArray(gridSupplyMeters) ? gridSupplyMeters.map(m => m.id) : []),
      ...(Array.isArray(solarEnergyMeters) ? solarEnergyMeters.map(m => m.id) : []),
      ...(Array.isArray(tenantMeters) ? tenantMeters.map(m => m.id) : []),
      ...(Array.isArray(checkMeters) ? checkMeters.map(m => m.id) : [])
    ]);
    const unassignedMeters = Array.isArray(safeMeters) ? safeMeters.filter(m => !assignedMeterIds.has(m.id)) : [];

    // Grid Supply: use totalKwhPositive if columns selected, otherwise fall back to totalKwh
    const bulkTotal = gridSupplyMeters.reduce((sum, m) => {
      const meterValue = m.totalKwhPositive > 0 ? m.totalKwhPositive : Math.max(0, m.totalKwh);
      return sum + meterValue;
    }, 0);
    
    // Solar Energy: sum all solar meters (include ALL values for net) + sum of all grid negative values
    const solarMeterTotal = solarEnergyMeters.reduce((sum, m) => sum + m.totalKwh, 0);
    const gridNegative = gridSupplyMeters.reduce((sum, m) => sum + (m.totalKwhNegative || 0), 0);
    const otherTotal = solarMeterTotal + gridNegative;
    const tenantTotal = tenantMeters.reduce((sum, m) => sum + m.totalKwh, 0);
    
    // Total Supply: Grid Supply + only positive Solar contribution
    const totalSupply = bulkTotal + Math.max(0, otherTotal);
    const recoveryRate = totalSupply > 0 ? (tenantTotal / totalSupply) * 100 : 0;
    const discrepancy = totalSupply - tenantTotal;

    // Revenue Reconciliation (if enabled)
    let revenueData = null;
    if (enableRevenue) {
      const metersWithTariffs = meterData.filter(m => (m.tariff_structure_id || m.assigned_tariff_name) && m.totalKwhPositive > 0);
      setRevenueProgress({ current: 0, total: metersWithTariffs.length });
      
      const meterRevenues = new Map();
      let gridSupplyCost = 0;
      let solarCost = 0;
      let tenantCost = 0;
      let totalKwhWithTariffs = 0;
      let totalCostCalculated = 0;
      
      for (const meter of meterData) {
        if (meter.assigned_tariff_name && meter.totalKwhPositive > 0) {
          const costResult = await calculateMeterCostAcrossPeriods(
            meter.id,
            siteData.supply_authority_id,
            meter.assigned_tariff_name,
            new Date(startDateTime),
            new Date(endDateTime),
            meter.totalKwhPositive
          );
          
          meterRevenues.set(meter.id, costResult);
          setRevenueProgress({ 
            current: meterRevenues.size, 
            total: metersWithTariffs.length 
          });
          
          const assignment = meterAssignments.get(meter.id);
          if (assignment === "grid_supply") {
            gridSupplyCost += costResult.totalCost;
          } else if (assignment === "solar_energy") {
            solarCost += costResult.totalCost;
          } else if (meter.meter_type === "tenant_meter") {
            tenantCost += costResult.totalCost;
          }
          
          totalKwhWithTariffs += meter.totalKwh;
          totalCostCalculated += costResult.totalCost;
        } else if (meter.tariff_structure_id && meter.totalKwhPositive > 0) {
          const costResult = await calculateMeterCost(
            meter.id,
            meter.tariff_structure_id,
            new Date(startDateTime),
            new Date(endDateTime),
            meter.totalKwhPositive
          );
          
          meterRevenues.set(meter.id, costResult);
          setRevenueProgress({ 
            current: meterRevenues.size, 
            total: metersWithTariffs.length 
          });
          
          const assignment = meterAssignments.get(meter.id);
          if (assignment === "grid_supply") {
            gridSupplyCost += costResult.totalCost;
          } else if (assignment === "solar_energy") {
            solarCost += costResult.totalCost;
          } else if (meter.meter_type === "tenant_meter") {
            tenantCost += costResult.totalCost;
          }
          
          totalKwhWithTariffs += meter.totalKwh;
          totalCostCalculated += costResult.totalCost;
        }
      }
      
      const avgCostPerKwh = totalKwhWithTariffs > 0 ? totalCostCalculated / totalKwhWithTariffs : 0;
      const totalRevenue = gridSupplyCost + solarCost + tenantCost;
      
      revenueData = {
        meterRevenues,
        gridSupplyCost,
        solarCost,
        tenantCost,
        totalRevenue,
        avgCostPerKwh
      };
    }

    return {
      meterData: safeMeters,
      errors,
      reconciliationData: {
        bulkMeters: Array.isArray(gridSupplyMeters) ? gridSupplyMeters : [],
        checkMeters: Array.isArray(checkMeters) ? checkMeters : [],
        otherMeters: [
          ...(Array.isArray(solarEnergyMeters) ? solarEnergyMeters : []),
          ...(Array.isArray(unassignedMeters) ? unassignedMeters : [])
        ],
        tenantMeters: Array.isArray(tenantMeters) ? tenantMeters : [],
        councilBulk: Array.isArray(gridSupplyMeters) ? gridSupplyMeters : [],
        solarMeters: Array.isArray(solarEnergyMeters) ? solarEnergyMeters : [],
        distribution: Array.isArray(tenantMeters) ? tenantMeters : [],
        distributionMeters: Array.isArray(tenantMeters) ? tenantMeters : [],
        unassignedMeters: Array.isArray(unassignedMeters) ? unassignedMeters : [],
        bulkTotal,
        councilTotal: bulkTotal,
        otherTotal,
        solarTotal: otherTotal,
        tenantTotal,
        distributionTotal: tenantTotal,
        totalSupply,
        recoveryRate,
        discrepancy,
        revenueData,
      }
    };
  };

  const handleReconcile = useCallback(async (enableRevenue?: boolean) => {
    if (!dateFrom || !dateTo) {
      toast.error("Please select a date range");
      return;
    }

    if (!previewDataRef.current) {
      toast.error("Please preview data first");
      return;
    }

    if (selectedColumnsRef.current.size === 0) {
      toast.error("Please select at least one column to calculate");
      return;
    }

    setIsColumnsOpen(false);
    setIsMetersOpen(false);
    cancelReconciliationRef.current = false;
    
    setIsLoading(true);
    setEnergyProgress({ current: 0, total: 0 });
    setRevenueProgress({ current: 0, total: 0 });
    setFailedMeters(new Map());

    try {
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      const shouldCalculateRevenue = enableRevenue !== undefined ? enableRevenue : revenueReconciliationEnabled;
      
      if (shouldCalculateRevenue) {
        setIsCalculatingRevenue(true);
        toast.info("Calculating revenue for meters with tariffs...");
      }

      const { meterData, errors, reconciliationData } = await performReconciliationCalculation(
        fullDateTimeFrom,
        fullDateTimeTo,
        shouldCalculateRevenue
      );

      setFailedMeters(errors);
      
      if (shouldCalculateRevenue) {
        setIsCalculatingRevenue(false);
        toast.success("Revenue calculation complete");
      }

      await saveReconciliationSettings();
      setReconciliationData(reconciliationData);

      // Update availableMeters to reflect which meters have data
      setAvailableMeters(prevMeters => 
        prevMeters.map(meter => {
          const meterReadings = meterData.find(m => m.id === meter.id);
          return {
            ...meter,
            hasData: meterReadings ? meterReadings.readingsCount > 0 : false
          };
        })
      );

      if (errors.size > 0) {
        toast.warning(`Reconciliation complete with ${errors.size} meter failure${errors.size > 1 ? 's' : ''}`);
      } else {
        toast.success("Reconciliation complete");
      }
    } catch (error: any) {
      console.error("Reconciliation error:", error);
      
      if (error.message === 'Reconciliation cancelled by user') {
        toast.info("Reconciliation cancelled");
      } else {
        toast.error("Failed to complete reconciliation");
      }
    } finally {
      setIsLoading(false);
      setIsCalculatingRevenue(false);
      setIsCancelling(false);
      cancelReconciliationRef.current = false;
    }
  }, [dateFrom, dateTo, timeFrom, timeTo, revenueReconciliationEnabled]);

  const cancelReconciliation = () => {
    if (!isCancelling) {
      setIsCancelling(true);
      cancelReconciliationRef.current = true;
      console.log("Cancellation requested - forcing cleanup");
      
      // Force cleanup immediately
      setIsLoading(false);
      setIsCalculatingRevenue(false);
      setEnergyProgress({ current: 0, total: 0 });
      setRevenueProgress({ current: 0, total: 0 });
      
      toast.info("Reconciliation cancelled");
      
      // Clear persistent state
      localStorage.removeItem(reconciliationStateKey);
      
      // Reset cancel flag after a delay
      setTimeout(() => {
        setIsCancelling(false);
        cancelReconciliationRef.current = false;
      }, 1000);
    }
  };

  const saveReconciliation = async (runName: string, notes: string) => {
    if (!reconciliationData || !dateFrom || !dateTo) {
      toast.error("No reconciliation data to save");
      return;
    }
    
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      // 1. Insert reconciliation run with meter order
      const meterOrder = availableMeters.map(m => m.id);
      
      const { data: run, error: runError } = await supabase
        .from('reconciliation_runs')
        .insert({
          site_id: siteId,
          run_name: runName,
          date_from: getFullDateTime(dateFrom, timeFrom),
          date_to: getFullDateTime(dateTo, timeTo),
          bulk_total: reconciliationData.bulkTotal,
          solar_total: reconciliationData.solarTotal,
          tenant_total: reconciliationData.tenantTotal || 0,
          total_supply: reconciliationData.totalSupply,
          recovery_rate: reconciliationData.recoveryRate,
          discrepancy: reconciliationData.discrepancy,
          created_by: user?.id,
          notes: notes || null,
          revenue_enabled: reconciliationData.revenueData !== null,
          grid_supply_cost: reconciliationData.revenueData?.gridSupplyCost || 0,
          solar_cost: reconciliationData.revenueData?.solarCost || 0,
          tenant_cost: reconciliationData.revenueData?.tenantCost || 0,
          total_revenue: reconciliationData.revenueData?.totalRevenue || 0,
          avg_cost_per_kwh: reconciliationData.revenueData?.avgCostPerKwh || 0,
          meter_order: meterOrder
        })
        .select()
        .single();
      
      if (runError) throw runError;
      
      // 2. Prepare all meters in hierarchical order with their assignments
      // Create a map of meter data from reconciliationData organized by meter ID
      const meterDataMap = new Map<string, any>();
      
      [...(reconciliationData.bulkMeters || []).map((m: any) => ({ ...m, assignment: 'grid_supply' })),
       ...(reconciliationData.solarMeters || []).map((m: any) => ({ ...m, assignment: 'solar' })),
       ...(reconciliationData.tenantMeters || []).map((m: any) => ({ ...m, assignment: 'tenant' })),
       ...(reconciliationData.checkMeters || []).map((m: any) => ({ ...m, assignment: 'check' })),
       ...(reconciliationData.unassignedMeters || []).map((m: any) => ({ ...m, assignment: 'unassigned' }))
      ].forEach(m => meterDataMap.set(m.id, m));
      
      // Use availableMeters to maintain hierarchical order
      const allMeters = availableMeters
        .filter(m => meterDataMap.has(m.id))
        .map(m => meterDataMap.get(m.id));
      
      // 3. Calculate hierarchical totals for meters with children
      const meterMap = new Map(allMeters.map(m => [m.id, m]));
      const hierarchicalTotals = new Map<string, number>();
      
      // Helper function to calculate summation by only counting leaf meters
      const getLeafMeterSum = (meterId: string, visited = new Set<string>()): number => {
        if (visited.has(meterId)) return 0; // Prevent infinite loops
        visited.add(meterId);
        
        const children = meterConnectionsMap.get(meterId) || [];
        
        // If this meter has no children, it's a leaf - return its value
        if (children.length === 0) {
          const meterData = meterMap.get(meterId);
          if (!meterData) return 0;
          
          const isSolar = meterAssignments.get(meterId) === "solar_energy" || meterData.assignment === 'solar';
          const value = meterData.totalKwh || 0;
          // Solar meters subtract from the total instead of adding
          return isSolar ? -value : value;
        }
        
        // If this meter has children, recursively sum only its leaf descendants
        return children.reduce((sum, childId) => {
          return sum + getLeafMeterSum(childId, visited);
        }, 0);
      };
      
      // Calculate hierarchical total for each meter that has children
      allMeters.forEach(meter => {
        const childIds = meterConnectionsMap.get(meter.id) || [];
        if (childIds.length > 0) {
          const hierarchicalTotal = childIds.reduce((sum, childId) => {
            return sum + getLeafMeterSum(childId);
          }, 0);
          hierarchicalTotals.set(meter.id, hierarchicalTotal);
        }
      });
      
      // Calculate revenue for parent meters using hierarchical totals
      if (reconciliationData.revenueData) {
        const { data: siteData } = await supabase
          .from("sites")
          .select("supply_authority_id")
          .eq("id", siteId)
          .single();
        
        if (siteData?.supply_authority_id) {
          const meterRevenues = new Map(reconciliationData.revenueData.meterRevenues);
          
          // Process all parent meters in parallel
          const parentMeterPromises = allMeters
            .filter(meter => {
              const hierarchicalTotal = hierarchicalTotals.get(meter.id);
              const existingRevenue = meterRevenues.get(meter.id);
              // Include parent meters with hierarchical totals that either:
              // 1. Don't have revenue calculated yet, OR
              // 2. Have revenue but with 0 cost (because they used total_kwh instead of hierarchical_total)
              return hierarchicalTotal && hierarchicalTotal > 0 && 
                     (!existingRevenue || (existingRevenue as any).totalCost === 0);
            })
            .map(async (meter) => {
              const hierarchicalTotal = hierarchicalTotals.get(meter.id)!;
              
              try {
                if (meter.assigned_tariff_name) {
                  const costResult = await calculateMeterCostAcrossPeriods(
                    meter.id,
                    siteData.supply_authority_id,
                    meter.assigned_tariff_name,
                    new Date(getFullDateTime(dateFrom, timeFrom)),
                    new Date(getFullDateTime(dateTo, timeTo)),
                    hierarchicalTotal
                  );
                  return { meter, costResult };
                } else if (meter.tariff_structure_id) {
                  const costResult = await calculateMeterCost(
                    meter.id,
                    meter.tariff_structure_id,
                    new Date(getFullDateTime(dateFrom, timeFrom)),
                    new Date(getFullDateTime(dateTo, timeTo)),
                    hierarchicalTotal
                  );
                  return { meter, costResult };
                }
              } catch (error) {
                console.error(`Failed to calculate revenue for parent meter ${meter.meter_number}:`, error);
                return {
                  meter,
                  costResult: {
                    hasError: true,
                    errorMessage: error instanceof Error ? error.message : 'Cost calculation failed',
                    totalCost: 0,
                    energyCost: 0,
                    fixedCharges: 0,
                    demandCharges: 0,
                    avgCostPerKwh: 0,
                    tariffName: meter.assigned_tariff_name || null
                  }
                };
              }
              return null;
            });

          // Wait for all calculations to complete
          const results = await Promise.allSettled(parentMeterPromises);

          // Process results and update meterRevenues map
          results.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) {
              const { meter, costResult } = result.value;
              meterRevenues.set(meter.id, costResult);
              console.log(`Calculated revenue for parent meter ${meter.meter_number} using hierarchical total`);
            } else if (result.status === 'rejected') {
              console.error('Parent meter cost calculation failed:', result.reason);
            }
          });
          
          // Update reconciliation data with new revenue map
          reconciliationData.revenueData.meterRevenues = meterRevenues;
        }
      }
      
      // 4. Insert all meter results with hierarchical totals and revenue data
      const meterResults = allMeters.map((meter: any) => {
        const revenueInfo = reconciliationData.revenueData?.meterRevenues.get(meter.id);
        return {
          reconciliation_run_id: run.id,
          meter_id: meter.id,
          meter_number: meter.meter_number,
          meter_type: meter.meter_type,
          meter_name: meter.name || null,
          location: meter.location || null,
          assignment: meter.assignment,
          tariff_structure_id: meter.tariff_structure_id,
          total_kwh: meter.totalKwh || 0,
          total_kwh_positive: meter.totalKwhPositive || 0,
          total_kwh_negative: meter.totalKwhNegative || 0,
          hierarchical_total: hierarchicalTotals.get(meter.id) || 0,
          readings_count: meter.readingsCount || 0,
          column_totals: meter.columnTotals || null,
          column_max_values: meter.columnMaxValues || null,
          has_error: meter.hasError || false,
          error_message: meter.errorMessage || null,
          // Revenue fields
          tariff_name: revenueInfo?.tariffName || null,
          energy_cost: revenueInfo?.energyCost || 0,
          fixed_charges: revenueInfo?.fixedCharges || 0,
          demand_charges: revenueInfo?.demandCharges || 0,
          total_cost: revenueInfo?.totalCost || 0,
          avg_cost_per_kwh: revenueInfo?.avgCostPerKwh || 0,
          cost_calculation_error: revenueInfo?.hasError ? revenueInfo.errorMessage : null
        };
      });
      
      const { error: resultsError } = await supabase
        .from('reconciliation_meter_results')
        .insert(meterResults);
      
      if (resultsError) throw resultsError;
      
      // 5. Generate hierarchical CSV files for parent meters
      const parentMeters = allMeters.filter(meter => {
        const children = meterConnectionsMap.get(meter.id);
        return children && children.length > 0;
      });

      if (parentMeters.length > 0) {
        console.log(`Generating ${parentMeters.length} hierarchical CSV file(s)...`);
        toast.info(`Generating ${parentMeters.length} hierarchical profile(s)...`);

        // Helper to get all leaf child meter IDs
        const getLeafChildren = (meterId: string, visited = new Set<string>()): string[] => {
          if (visited.has(meterId)) return [];
          visited.add(meterId);
          
          const children = meterConnectionsMap.get(meterId) || [];
          if (children.length === 0) return [meterId];
          
          const leaves: string[] = [];
          for (const childId of children) {
            leaves.push(...getLeafChildren(childId, visited));
          }
          return leaves;
        };

        const csvGenerationPromises = parentMeters.map(async (parentMeter) => {
          try {
            const leafMeterIds = Array.from(
              new Set(
                (meterConnectionsMap.get(parentMeter.id) || [])
                  .flatMap(childId => getLeafChildren(childId))
              )
            );

            const { error: csvError } = await supabase.functions.invoke('generate-hierarchical-csv', {
              body: {
                parentMeterId: parentMeter.id,
                parentMeterNumber: parentMeter.meter_number,
                siteId,
                dateFrom: getFullDateTime(dateFrom, timeFrom),
                dateTo: getFullDateTime(dateTo, timeTo),
                leafMeterIds,
                selectedColumns: Array.from(selectedColumns),
                columnOperations: Object.fromEntries(columnOperations),
                columnFactors: Object.fromEntries(columnFactors),
                meterAssignments: Object.fromEntries(meterAssignments)
              }
            });

            if (csvError) {
              console.error(`Failed to generate CSV for ${parentMeter.meter_number}:`, csvError);
            } else {
              console.log(`✓ Generated hierarchical CSV for ${parentMeter.meter_number}`);
            }
          } catch (error) {
            console.error(`Error generating CSV for ${parentMeter.meter_number}:`, error);
          }
        });

        // Run all CSV generations in parallel
        await Promise.allSettled(csvGenerationPromises);
        console.log('Hierarchical CSV generation complete');
      }
      
      toast.success(`Reconciliation "${runName}" saved successfully`);
      return run.id;
    } catch (error) {
      console.error('Save reconciliation error:', error);
      toast.error('Failed to save reconciliation');
      throw error;
    }
  };

  const handleBulkReconcile = async () => {
    if (selectedDocumentIds.length === 0) {
      toast.error("Please select at least one period to reconcile");
      return;
    }

    setIsBulkProcessing(true);
    const totalDocs = selectedDocumentIds.length;

    try {
      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      // Process each document with its own specific date range
      for (let i = 0; i < selectedDocumentIds.length; i++) {
        const docId = selectedDocumentIds[i];
        try {
          const doc = documentDateRanges.find(d => d.id === docId);
          if (!doc) continue;

          // Update progress state
          setBulkProgress({
            currentDocument: doc.file_name,
            current: i + 1,
            total: totalDocs
          });

          // Use this document's specific date range
          const startDate = new Date(doc.period_start);
          startDate.setHours(0, 0, 0, 0);
          
          const endDate = new Date(doc.period_end);
          endDate.setDate(endDate.getDate() - 1);
          endDate.setHours(23, 59, 0, 0);

          // Run reconciliation using this document's specific date range
          await handleReconcileForPeriod(startDate, endDate, doc.file_name);
          successCount++;

        } catch (error) {
          console.error(`Error processing ${docId}:`, error);
          errorCount++;
          const doc = documentDateRanges.find(d => d.id === docId);
          errors.push(doc?.file_name || docId);
        }
      }

      if (successCount > 0) {
        toast.success(
          `Bulk reconciliation complete! ${successCount} reconciliation(s) saved${errorCount > 0 ? `, ${errorCount} failed` : ''}.`
        );
      }

      if (errors.length > 0) {
        toast.error(`Failed periods: ${errors.join(', ')}`);
      }

      setSelectedDocumentIds([]);
      setBulkProgress({ currentDocument: '', current: 0, total: 0 });
    } catch (error) {
      console.error("Bulk reconciliation error:", error);
      toast.error("Failed to complete bulk reconciliation");
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleReconcileForPeriod = async (startDate: Date, endDate: Date, fileName: string) => {
    if (!previewData) {
      throw new Error("Please preview data first");
    }

    if (selectedColumns.size === 0) {
      throw new Error("Please select at least one column to calculate");
    }

    const fullDateTimeFrom = getFullDateTime(startDate, "00:00");
    const fullDateTimeTo = getFullDateTime(endDate, "23:59");

    // Use the shared reconciliation calculation function with revenue enabled
    const { reconciliationData } = await performReconciliationCalculation(
      fullDateTimeFrom,
      fullDateTimeTo,
      true // Always enable revenue for bulk reconciliation
    );

    // Save using the SAME pattern as handleSaveReconciliation
    const runName = `${fileName} - ${format(startDate, "MMM yyyy")}`;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // 1. Insert reconciliation run with meter order
      const meterOrder = availableMeters.map(m => m.id);
      
      const { data: run, error: runError } = await supabase
        .from('reconciliation_runs')
        .insert({
          site_id: siteId,
          run_name: runName,
          date_from: fullDateTimeFrom,
          date_to: fullDateTimeTo,
          bulk_total: reconciliationData.bulkTotal,
          solar_total: reconciliationData.solarTotal,
          tenant_total: reconciliationData.tenantTotal || 0,
          total_supply: reconciliationData.totalSupply,
          recovery_rate: reconciliationData.recoveryRate,
          discrepancy: reconciliationData.discrepancy,
          created_by: user?.id,
          notes: null,
          revenue_enabled: reconciliationData.revenueData !== null,
          grid_supply_cost: reconciliationData.revenueData?.gridSupplyCost || 0,
          solar_cost: reconciliationData.revenueData?.solarCost || 0,
          tenant_cost: reconciliationData.revenueData?.tenantCost || 0,
          total_revenue: reconciliationData.revenueData?.totalRevenue || 0,
          avg_cost_per_kwh: reconciliationData.revenueData?.avgCostPerKwh || 0,
          meter_order: meterOrder
        })
        .select()
        .single();
      
      if (runError) throw runError;
      
      // 2. Prepare all meters with their assignments (same as saveReconciliation)
      const meterDataMap = new Map<string, any>();
      
      [...(reconciliationData.bulkMeters || []).map((m: any) => ({ ...m, assignment: 'grid_supply' })),
       ...(reconciliationData.solarMeters || []).map((m: any) => ({ ...m, assignment: 'solar' })),
       ...(reconciliationData.tenantMeters || []).map((m: any) => ({ ...m, assignment: 'tenant' })),
       ...(reconciliationData.checkMeters || []).map((m: any) => ({ ...m, assignment: 'check' })),
       ...(reconciliationData.unassignedMeters || []).map((m: any) => ({ ...m, assignment: 'unassigned' }))
      ].forEach(m => meterDataMap.set(m.id, m));
      
      // Use availableMeters to maintain hierarchical order
      const allMeters = availableMeters
        .filter(m => meterDataMap.has(m.id))
        .map(m => meterDataMap.get(m.id));
      
      // 3. Calculate hierarchical totals (same logic as saveReconciliation)
      const meterMap = new Map(allMeters.map(m => [m.id, m]));
      const hierarchicalTotals = new Map<string, number>();
      
      const getLeafMeterSum = (meterId: string, visited = new Set<string>()): number => {
        if (visited.has(meterId)) return 0;
        visited.add(meterId);
        
        const children = meterConnectionsMap.get(meterId) || [];
        
        if (children.length === 0) {
          const meterData = meterMap.get(meterId);
          if (!meterData) return 0;
          
          const isSolar = meterAssignments.get(meterId) === "solar_energy" || meterData.assignment === 'solar';
          const value = meterData.totalKwh || 0;
          return isSolar ? -value : value;
        }
        
        return children.reduce((sum, childId) => {
          return sum + getLeafMeterSum(childId, visited);
        }, 0);
      };
      
      allMeters.forEach(meter => {
        const childIds = meterConnectionsMap.get(meter.id) || [];
        if (childIds.length > 0) {
          const hierarchicalTotal = childIds.reduce((sum, childId) => {
            return sum + getLeafMeterSum(childId);
          }, 0);
          hierarchicalTotals.set(meter.id, hierarchicalTotal);
        }
      });
      
      // 4. Insert meter results (same as saveReconciliation)
      const meterResults = allMeters.map((meter: any) => {
        const revenueInfo = reconciliationData.revenueData?.meterRevenues.get(meter.id);
        return {
          reconciliation_run_id: run.id,
          meter_id: meter.id,
          meter_number: meter.meter_number,
          meter_type: meter.meter_type,
          meter_name: meter.name || null,
          location: meter.location || null,
          assignment: meter.assignment,
          tariff_structure_id: meter.tariff_structure_id,
          total_kwh: meter.totalKwh || 0,
          total_kwh_positive: meter.totalKwhPositive || 0,
          total_kwh_negative: meter.totalKwhNegative || 0,
          hierarchical_total: hierarchicalTotals.get(meter.id) || 0,
          readings_count: meter.readingsCount || 0,
          column_totals: meter.columnTotals || null,
          column_max_values: meter.columnMaxValues || null,
          has_error: meter.hasError || false,
          error_message: meter.errorMessage || null,
          tariff_name: revenueInfo?.tariffName || null,
          energy_cost: revenueInfo?.energyCost || 0,
          fixed_charges: revenueInfo?.fixedCharges || 0,
          demand_charges: revenueInfo?.demandCharges || 0,
          total_cost: revenueInfo?.totalCost || 0,
          avg_cost_per_kwh: revenueInfo?.avgCostPerKwh || 0,
          cost_calculation_error: revenueInfo?.hasError ? revenueInfo.errorMessage : null
        };
      });
      
      const { error: resultsError } = await supabase
        .from('reconciliation_meter_results')
        .insert(meterResults);
      
      if (resultsError) throw resultsError;
      
    } catch (error) {
      console.error('Save bulk reconciliation error:', error);
      throw error;
    }
  };

  const downloadMeterCSV = async (meter: any) => {
    try {
      if (!dateFrom || !dateTo) {
        toast.error("Date range not available");
        return;
      }

      toast.loading(`Fetching readings for ${meter.meter_number}...`);

      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // Fetch ALL readings for this meter using pagination
      let allReadings: any[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error } = await supabase
          .from("meter_readings")
          .select("reading_timestamp, kwh_value, kva_value, metadata")
          .eq("meter_id", meter.id)
          .gte("reading_timestamp", fullDateTimeFrom)
          .lte("reading_timestamp", fullDateTimeTo)
          .order("reading_timestamp", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) {
          toast.dismiss();
          toast.error(`Failed to fetch readings: ${error.message}`);
          return;
        }

        if (pageData && pageData.length > 0) {
          allReadings = [...allReadings, ...pageData];
          from += pageSize;
          hasMore = pageData.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      if (allReadings.length === 0) {
        toast.dismiss();
        toast.error("No readings found for this meter");
        return;
      }

      // Transform readings to CSV format
      const csvData = allReadings.map(reading => {
        const row: any = {
          timestamp: format(new Date(reading.reading_timestamp), "yyyy-MM-dd HH:mm:ss"),
          kwh: reading.kwh_value,
        };

        if (reading.kva_value) {
          row.kva = reading.kva_value;
        }

        // Add metadata fields if available
        if (reading.metadata && (reading.metadata as any).imported_fields) {
          const importedFields = (reading.metadata as any).imported_fields;
          Object.entries(importedFields).forEach(([key, value]) => {
            row[key] = value;
          });
        }

        return row;
      });

      // Generate CSV
      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${meter.meter_number}_${format(dateFrom, "yyyy-MM-dd")}_to_${format(dateTo, "yyyy-MM-dd")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.dismiss();
      toast.success(`Downloaded ${allReadings.length} readings for ${meter.meter_number}`);
    } catch (error) {
      console.error("CSV download error:", error);
      toast.dismiss();
      toast.error("Failed to download CSV");
    }
  };

  const downloadAllMetersCSV = async () => {
    if (!reconciliationData) return;

    const allMeters = [
      ...reconciliationData.bulkMeters,
      ...reconciliationData.checkMeters,
      ...reconciliationData.otherMeters,
      ...reconciliationData.tenantMeters,
    ];

    for (const meter of allMeters) {
      await downloadMeterCSV(meter);
      // Small delay between downloads to avoid overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  // Memoize the meters array to prevent infinite re-renders
  // Only recreate when reconciliationData or availableMeters actually change
  const memoizedMeters = useMemo(() => {
    if (!reconciliationData) return [];
    
    // Collect all processed meters
    const allMeters = [
      ...(reconciliationData.councilBulk || []),
      ...(reconciliationData.solarMeters || []),
      ...(reconciliationData.checkMeters || []),
      ...(reconciliationData.distribution || []),
      ...(reconciliationData.otherMeters || [])
    ];

    // Create a map for quick lookup
    const meterMap = new Map(allMeters.map(m => [m.id, {
      ...m,
      hasData: m.hasData !== undefined ? m.hasData : true,
      hasError: m.hasError || false,
      errorMessage: m.errorMessage || null
    }]));

    // Order meters according to availableMeters (which has the hierarchy)
    const orderedMeters = availableMeters
      .map(availMeter => {
        const meterData = meterMap.get(availMeter.id);
        if (!meterData) return undefined;
        
        // Add error info from failedMeters if it exists
        return {
          ...meterData,
          hasError: meterData.hasError || failedMeters.has(availMeter.id),
          errorMessage: meterData.errorMessage || failedMeters.get(availMeter.id) || null
        };
      })
      .filter(m => m !== undefined);

    return orderedMeters;
  }, [reconciliationData, availableMeters.length]);

  return (
    <Tabs defaultValue="analysis" className="space-y-6">
      <TabsList className="grid w-full grid-cols-3 lg:w-auto">
        <TabsTrigger value="analysis" className="gap-2">
          <BarChart3 className="w-4 h-4" />
          Analysis
        </TabsTrigger>
        <TabsTrigger value="history" className="gap-2">
          <CalendarHistoryIcon className="w-4 h-4" />
          History
        </TabsTrigger>
        <TabsTrigger value="compare" className="gap-2">
          <Activity className="w-4 h-4" />
          Compare
        </TabsTrigger>
      </TabsList>

      <TabsContent value="analysis">
        <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Energy Reconciliation</h2>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Analysis Parameters</CardTitle>
              <CardDescription>Select date range for reconciliation or use document periods</CardDescription>
            </div>
            {isLoadingDateRanges ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>Loading date ranges...</span>
              </div>
            ) : totalDateRange.earliest && totalDateRange.latest ? (
              <div className="text-right space-y-1">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">First Date & Time:</span> {format(totalDateRange.earliest, "MMM dd, yyyy HH:mm")}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Last Date & Time:</span> {format(totalDateRange.latest, "MMM dd, yyyy HH:mm")}
                </div>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Bulk Reconciliation - Select Multiple Periods (Municipal Bills Only)</Label>
            <div className="border rounded-md p-3 space-y-2 max-h-[300px] overflow-y-auto bg-background">
              {documentDateRanges && documentDateRanges.length > 0 ? (
                documentDateRanges
                  .filter(doc => doc.document_type === 'municipal_account')
                  .map((doc) => (
                    <div key={doc.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`bulk-${doc.id}`}
                        checked={selectedDocumentIds.includes(doc.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedDocumentIds([...selectedDocumentIds, doc.id]);
                          } else {
                            setSelectedDocumentIds(selectedDocumentIds.filter(id => id !== doc.id));
                          }
                        }}
                      />
                      <label htmlFor={`bulk-${doc.id}`} className="text-sm cursor-pointer flex-1">
                        {doc.file_name} ({format(new Date(doc.period_start), "MMM d, yyyy")} - {format(new Date(doc.period_end), "MMM d, yyyy")})
                      </label>
                    </div>
                  ))
              ) : (
                <p className="text-sm text-muted-foreground">No municipal bill periods available</p>
              )}
            </div>
            {selectedDocumentIds.length > 0 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-muted-foreground">
                  {selectedDocumentIds.length} period(s) selected
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedDocumentIds([])}
                  >
                    Clear Selection
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Document Period</Label>
            <Select
              disabled={isLoadingDateRanges || isLoadingDocuments || documentDateRanges.length === 0 || !totalDateRange.earliest || !totalDateRange.latest}
              onValueChange={(value) => {
                const selected = documentDateRanges.find(d => d.id === value);
                if (selected) {
                  const startDate = new Date(selected.period_start);
                  startDate.setHours(0, 0, 0, 0);
                  
                  const endDate = new Date(selected.period_end);
                  endDate.setDate(endDate.getDate() - 1);
                  endDate.setHours(23, 59, 0, 0);
                  
                  setDateFrom(startDate);
                  setDateTo(endDate);
                  setTimeFrom("00:00");
                  setTimeTo("23:59");
                  toast.success(`Date range set from ${format(startDate, "PP")} to ${format(endDate, "PP")}`);
                }
              }}
            >
              <SelectTrigger className="w-full" disabled={isLoadingDateRanges || isLoadingDocuments || documentDateRanges.length === 0 || !totalDateRange.earliest || !totalDateRange.latest}>
                <SelectValue placeholder={
                  isLoadingDateRanges
                    ? "Loading date ranges..."
                    : isLoadingDocuments 
                    ? "Loading document periods..." 
                    : documentDateRanges.length === 0 
                    ? "No document periods available" 
                    : "Select a document period..."
                } />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                {/* Group by document type */}
                {documentDateRanges.filter(d => d.document_type === 'municipal_account').length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Municipal Bills</div>
                    {documentDateRanges
                      .filter(d => d.document_type === 'municipal_account')
                      .map((doc) => (
                        <SelectItem key={doc.id} value={doc.id}>
                          {doc.file_name} ({format(new Date(doc.period_start), "PP")} - {format(new Date(doc.period_end), "PP")})
                        </SelectItem>
                      ))}
                  </>
                )}
                {documentDateRanges.filter(d => d.document_type === 'tenant_bill').length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">Tenant Bills</div>
                    {documentDateRanges
                      .filter(d => d.document_type === 'tenant_bill')
                      .map((doc) => (
                        <SelectItem key={doc.id} value={doc.id}>
                          {doc.file_name} ({format(new Date(doc.period_start), "PP")} - {format(new Date(doc.period_end), "PP")})
                        </SelectItem>
                      ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Date & Time</Label>
              <Popover open={isDateFromOpen} onOpenChange={setIsDateFromOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateFrom && "text-muted-foreground"
                    )}
                    disabled={isLoadingDateRanges || !totalDateRange.earliest || !totalDateRange.latest}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? `${format(dateFrom, "PP")} at ${timeFrom}` : "Pick date & time"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
                  <div>
                    <Calendar 
                      mode="single" 
                      selected={dateFrom} 
                      onSelect={(date) => {
                        setDateFrom(date);
                        setUserSetDates(true);
                      }}
                      className={cn("p-3 pointer-events-auto")}
                      disabled={false}
                      fromYear={2000}
                      toYear={2050}
                      captionLayout="dropdown-buttons"
                    />
                    <div className="px-3 pb-3">
                      <Input
                        type="time"
                        value={timeFrom}
                        onChange={(e) => {
                          setTimeFrom(e.target.value);
                          setUserSetDates(true);
                        }}
                        onBlur={() => {
                          // Close after user finishes editing and leaves the field
                          if (timeFrom && timeFrom.length === 5) {
                            setTimeout(() => setIsDateFromOpen(false), 100);
                          }
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>To Date & Time</Label>
              <Popover open={isDateToOpen} onOpenChange={setIsDateToOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateTo && "text-muted-foreground"
                    )}
                    disabled={isLoadingDateRanges || !totalDateRange.earliest || !totalDateRange.latest}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? `${format(dateTo, "PP")} at ${timeTo}` : "Pick date & time"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
                  <div>
                    <Calendar 
                      mode="single" 
                      selected={dateTo} 
                      onSelect={(date) => {
                        setDateTo(date);
                        setUserSetDates(true);
                      }}
                      className={cn("p-3 pointer-events-auto")}
                      disabled={false}
                      fromYear={2000}
                      toYear={2050}
                      captionLayout="dropdown-buttons"
                    />
                    <div className="px-3 pb-3">
                      <Input
                        type="time"
                        value={timeTo}
                        onChange={(e) => {
                          setTimeTo(e.target.value);
                          setUserSetDates(true);
                        }}
                        onBlur={() => {
                          // Close after user finishes editing and leaves the field
                          if (timeTo && timeTo.length === 5) {
                            setTimeout(() => setIsDateToOpen(false), 100);
                          }
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <Button onClick={handlePreview} disabled={isLoadingDateRanges || isLoadingPreview || !dateFrom || !dateTo || !selectedMeterId || !totalDateRange.earliest || !totalDateRange.latest} className="w-full">
            <Eye className="mr-2 h-4 w-4" />
            {isLoadingPreview ? "Loading Preview..." : "Preview Meter Data"}
          </Button>
        </CardContent>
      </Card>

      {previewData && (
        <Card className="border-border/50 bg-accent/5">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Meter Data Preview - {previewData.meterNumber} ({previewData.meterType?.replace(/_/g, " ")})</span>
              <Badge variant="outline">{previewData.totalReadings} readings</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Collapsible open={isColumnsOpen} onOpenChange={setIsColumnsOpen}>
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <CollapsibleTrigger className="flex items-center justify-between w-full mb-3 hover:underline">
                  <Label className="text-sm font-semibold cursor-pointer">Available Columns - Select to Include in Calculations</Label>
                  <ChevronRight className={cn("h-4 w-4 transition-transform", isColumnsOpen && "rotate-90")} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-12">
                        <Checkbox
                          id="select-all-columns"
                          checked={selectedColumns.size === previewData.availableColumns.length}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              const newSelected = new Set<string>(previewData.availableColumns as string[]);
                              setSelectedColumns(newSelected);
                              const newOps = new Map(columnOperations);
                              const newFactors = new Map(columnFactors);
                              previewData.availableColumns.forEach((col: string) => {
                                if (!newOps.has(col)) newOps.set(col, "sum");
                                if (!newFactors.has(col)) newFactors.set(col, "1");
                              });
                              setColumnOperations(newOps);
                              setColumnFactors(newFactors);
                            } else {
                              setSelectedColumns(new Set());
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead className="font-semibold">
                        <span 
                          className="cursor-pointer hover:underline"
                          onClick={() => {
                            const allSelected = selectedColumns.size === previewData.availableColumns.length;
                            if (!allSelected) {
                              const newSelected = new Set<string>(previewData.availableColumns as string[]);
                              setSelectedColumns(newSelected);
                              const newOps = new Map(columnOperations);
                              const newFactors = new Map(columnFactors);
                              previewData.availableColumns.forEach((col: string) => {
                                if (!newOps.has(col)) newOps.set(col, "sum");
                                if (!newFactors.has(col)) newFactors.set(col, "1");
                              });
                              setColumnOperations(newOps);
                              setColumnFactors(newFactors);
                            } else {
                              setSelectedColumns(new Set());
                            }
                          }}
                        >
                          Column Name
                        </span>
                      </TableHead>
                      <TableHead className="w-32 font-semibold">Operation</TableHead>
                      <TableHead className="w-24 font-semibold">Factor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.availableColumns.map((column: string) => (
                      <TableRow key={column} className="hover:bg-muted/30">
                        <TableCell className="py-2">
                          <Checkbox
                            id={`column-${column}`}
                            checked={selectedColumns.has(column)}
                            onCheckedChange={(checked) => {
                              const newSelected = new Set(selectedColumns);
                              if (checked) {
                                newSelected.add(column);
                                if (!columnOperations.has(column)) {
                                  const newOps = new Map(columnOperations);
                                  newOps.set(column, "sum");
                                  setColumnOperations(newOps);
                                }
                                if (!columnFactors.has(column)) {
                                  const newFactors = new Map(columnFactors);
                                  newFactors.set(column, "1");
                                  setColumnFactors(newFactors);
                                }
                              } else {
                                newSelected.delete(column);
                              }
                              setSelectedColumns(newSelected);
                            }}
                          />
                        </TableCell>
                        <TableCell className="py-2">
                          <Label
                            htmlFor={`column-${column}`}
                            className="text-sm cursor-pointer font-medium"
                          >
                            {column}
                          </Label>
                        </TableCell>
                        <TableCell className="py-2">
                          {selectedColumns.has(column) ? (
                            <Select
                              value={columnOperations.get(column) || "sum"}
                              onValueChange={(value) => {
                                const newOps = new Map(columnOperations);
                                newOps.set(column, value);
                                setColumnOperations(newOps);
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="sum">Sum</SelectItem>
                                <SelectItem value="min">Min</SelectItem>
                                <SelectItem value="max">Max</SelectItem>
                                <SelectItem value="average">Average</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2">
                          {selectedColumns.has(column) ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={columnFactors.get(column) || 1}
                              onChange={(e) => {
                                const newFactors = new Map(columnFactors);
                                newFactors.set(column, e.target.value || "1");
                                setColumnFactors(newFactors);
                              }}
                              className="h-8 text-xs"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            <Collapsible open={isMetersOpen} onOpenChange={setIsMetersOpen}>
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <CollapsibleTrigger className="flex items-center justify-between w-full mb-3 hover:underline">
                  <div className="flex flex-col items-start gap-1">
                    <Label className="text-sm font-semibold cursor-pointer">Meters Associated with This Site</Label>
                    <span className="text-xs text-muted-foreground font-normal">Select multiple meters and drag to reorder or use indent buttons</span>
                  </div>
                  <ChevronRight className={cn("h-4 w-4 transition-transform", isMetersOpen && "rotate-90")} />
                </CollapsibleTrigger>
                <CollapsibleContent>
              
              {/* Column Headers */}
              <div className="flex items-center gap-2 mb-2 pb-2 border-b">
                <div className="w-6 flex items-center justify-start">
                  <Checkbox
                    checked={availableMeters.length > 0 && selectedMetersForSummation.size === availableMeters.length}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedMetersForSummation(new Set(availableMeters.map(m => m.id)));
                      } else {
                        setSelectedMetersForSummation(new Set());
                      }
                    }}
                  />
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={selectedMetersForSummation.size === 0 || Array.from(selectedMetersForSummation).every(id => (meterIndentLevels.get(id) || 0) === 0)}
                      onClick={() => {
                        if (selectedMetersForSummation.size > 0) {
                          const newLevels = new Map(meterIndentLevels);
                          selectedMetersForSummation.forEach(meterId => {
                            const currentLevel = newLevels.get(meterId) || 0;
                            if (currentLevel > 0) {
                              newLevels.set(meterId, currentLevel - 1);
                            }
                          });
                          setMeterIndentLevels(newLevels);
                          saveIndentLevelsToStorage(newLevels);
                        }
                      }}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={selectedMetersForSummation.size === 0 || Array.from(selectedMetersForSummation).every(id => (meterIndentLevels.get(id) || 0) === 6)}
                      onClick={() => {
                        if (selectedMetersForSummation.size > 0) {
                          const newLevels = new Map(meterIndentLevels);
                          selectedMetersForSummation.forEach(meterId => {
                            const currentLevel = newLevels.get(meterId) || 0;
                            if (currentLevel < 6) {
                              newLevels.set(meterId, currentLevel + 1);
                            }
                          });
                          setMeterIndentLevels(newLevels);
                          saveIndentLevelsToStorage(newLevels);
                        }
                      }}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 ml-2"
                      onClick={handleResetHierarchy}
                      title="Reset hierarchy to database defaults"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                  </div>
                  <div className="flex-1 flex items-center justify-between p-3">
                    <button 
                      onClick={() => {
                        if (sortColumn === 'meter') {
                          setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                        } else {
                          setSortColumn('meter');
                          setSortDirection('asc');
                        }
                      }}
                      className="flex items-center gap-1 text-xs font-semibold hover:text-primary transition-colors"
                    >
                      Meter Number
                      <ChevronRight className={cn(
                        "h-3 w-3 transition-transform",
                        sortColumn === 'meter' && sortDirection === 'asc' && "-rotate-90",
                        sortColumn === 'meter' && sortDirection === 'desc' && "rotate-90"
                      )} />
                    </button>
                    <div className="flex items-center gap-6">
                      <button 
                        onClick={() => {
                          if (sortColumn === 'grid') {
                            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortColumn('grid');
                            setSortDirection('asc');
                          }
                        }}
                        className="w-24 flex items-center justify-center gap-1 text-xs font-semibold hover:text-primary transition-colors"
                      >
                        Grid Supply
                        <ChevronRight className={cn(
                          "h-3 w-3 transition-transform",
                          sortColumn === 'grid' && sortDirection === 'asc' && "-rotate-90",
                          sortColumn === 'grid' && sortDirection === 'desc' && "rotate-90"
                        )} />
                      </button>
                      <button 
                        onClick={() => {
                          if (sortColumn === 'solar') {
                            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortColumn('solar');
                            setSortDirection('asc');
                          }
                        }}
                        className="w-24 flex items-center justify-center gap-1 text-xs font-semibold hover:text-primary transition-colors"
                      >
                        Solar Supply
                        <ChevronRight className={cn(
                          "h-3 w-3 transition-transform",
                          sortColumn === 'solar' && sortDirection === 'asc' && "-rotate-90",
                          sortColumn === 'solar' && sortDirection === 'desc' && "rotate-90"
                        )} />
                      </button>
                      <button 
                        onClick={() => {
                          if (sortColumn === 'status') {
                            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortColumn('status');
                            setSortDirection('asc');
                          }
                        }}
                        className="w-24 flex items-center justify-center gap-1 text-xs font-semibold hover:text-primary transition-colors"
                      >
                        Data Status
                        <ChevronRight className={cn(
                          "h-3 w-3 transition-transform",
                          sortColumn === 'status' && sortDirection === 'asc' && "-rotate-90",
                          sortColumn === 'status' && sortDirection === 'desc' && "rotate-90"
                        )} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                {availableMeters.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic">No meters found for this site</div>
                ) : (
                  (() => {
                    let sortedMeters = [...availableMeters];
                    
                    if (sortColumn) {
                      sortedMeters.sort((a, b) => {
                        let compareValue = 0;
                        
                        switch (sortColumn) {
                          case 'meter':
                            compareValue = a.meter_number.localeCompare(b.meter_number);
                            break;
                          case 'grid':
                            const aGrid = a.meter_type === 'bulk' || a.meter_type === 'check';
                            const bGrid = b.meter_type === 'bulk' || b.meter_type === 'check';
                            compareValue = aGrid === bGrid ? 0 : aGrid ? -1 : 1;
                            break;
                          case 'solar':
                            const aSolar = a.meter_type === 'solar';
                            const bSolar = b.meter_type === 'solar';
                            compareValue = aSolar === bSolar ? 0 : aSolar ? -1 : 1;
                            break;
                          case 'status':
                            const aHasData = a.hasData ? 1 : 0;
                            const bHasData = b.hasData ? 1 : 0;
                            compareValue = aHasData - bHasData;
                            break;
                        }
                        
                        return sortDirection === 'asc' ? compareValue : -compareValue;
                      });
                    }
                    
                    return sortedMeters.map((meter) => {
                    const indentLevel = meterIndentLevels.get(meter.id) || 0;
                    const contentMarginLeft = indentLevel * 24; // 24px per indent level - only for content, not checkbox
                    const isDragging = draggedMeterId === meter.id;
                    const isDragOver = dragOverMeterId === meter.id;
                    const parentInfo = meterParentInfo.get(meter.id);
                    
                    return (
                      <div 
                        key={meter.id} 
                        className="flex items-center gap-2"
                      >
                        <div className="w-6 flex items-center justify-start">
                          <Checkbox
                            checked={selectedMetersForSummation.has(meter.id)}
                            onCheckedChange={(checked) => {
                              const newSelected = new Set(selectedMetersForSummation);
                              if (checked) {
                                newSelected.add(meter.id);
                              } else {
                                newSelected.delete(meter.id);
                              }
                              setSelectedMetersForSummation(newSelected);
                            }}
                          />
                        </div>
                        <div className="flex-1 flex items-center gap-2" style={{ marginLeft: `${contentMarginLeft}px` }}>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handleOutdentMeter(meter.id)}
                              disabled={indentLevel === 0}
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handleIndentMeter(meter.id)}
                              disabled={indentLevel >= 6}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                          <div 
                            className={cn(
                              "flex items-center justify-between flex-1 p-3 rounded-md border bg-card hover:bg-accent/5 transition-colors cursor-move relative",
                              isDragging && "opacity-50",
                              isDragOver && "border-primary border-2",
                              selectedMetersForSummation.has(meter.id) && "ring-2 ring-primary/20"
                            )}
                            draggable
                            onDragStart={(e) => handleDragStart(e, meter.id)}
                            onDragOver={handleDragOver}
                            onDragEnter={() => handleDragEnter(meter.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, meter.id)}
                            onDragEnd={handleDragEnd}
                          >
                            {selectedMetersForSummation.has(meter.id) && selectedMetersForSummation.size > 1 && draggedMeterId === meter.id && (
                              <div className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs rounded-full w-6 h-6 flex items-center justify-center font-semibold z-10">
                                {selectedMetersForSummation.size}
                              </div>
                            )}
                            <div className="flex items-center gap-2 flex-1">
                              {indentLevel > 0 && (
                                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span className="font-medium">{meter.meter_number}</span>
                              {parentInfo && (
                                <span className="text-xs text-muted-foreground">
                                  → {parentInfo}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-6">
                              <div className="w-24 flex justify-center">
                                <Checkbox
                                  id={`grid-${meter.id}`}
                                  checked={meterAssignments.get(meter.id) === "grid_supply"}
                                  disabled={meterAssignments.get(meter.id) === "solar_energy"}
                                  onCheckedChange={(checked) => {
                                    const newAssignments = new Map(meterAssignments);
                                    if (checked) {
                                      newAssignments.set(meter.id, "grid_supply");
                                    } else {
                                      newAssignments.delete(meter.id);
                                    }
                                    setMeterAssignments(newAssignments);
                                  }}
                                />
                              </div>
                              <div className="w-24 flex justify-center">
                                <Checkbox
                                  id={`solar-${meter.id}`}
                                  checked={meterAssignments.get(meter.id) === "solar_energy"}
                                  disabled={meterAssignments.get(meter.id) === "grid_supply"}
                                  onCheckedChange={(checked) => {
                                    const newAssignments = new Map(meterAssignments);
                                    if (checked) {
                                      newAssignments.set(meter.id, "solar_energy");
                                    } else {
                                      newAssignments.delete(meter.id);
                                    }
                                    setMeterAssignments(newAssignments);
                                  }}
                                />
                              </div>
                              <div className="w-24 flex justify-center">
                                {meter.hasData ? (
                                  <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                                    <Check className="h-3 w-3 text-primary-foreground" />
                                  </div>
                                ) : (
                                  <div className="h-4 w-4 rounded-full bg-black flex items-center justify-center">
                                    <X className="h-3 w-3 text-white" />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })})()
                )}
              </div>
              </CollapsibleContent>
            </div>
            </Collapsible>

            {/* Reconciliation Action Buttons - Removed, moved to tabs */}

            {/* Reset Settings Button - Only visible after reconciliation has been run */}
            {reconciliationData && (
              <div className="pt-4 border-t border-border/50 space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetReconciliationSettings}
                  className="w-full"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset Saved Settings
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (isLoading || isCalculatingRevenue) {
                      toast.error("Cannot clear results while reconciliation is in progress");
                      return;
                    }
                    setReconciliationData(null);
                    localStorage.removeItem(reconciliationStateKey);
                  }}
                  disabled={isLoading || isCalculatingRevenue}
                  className="w-full"
                >
                  <Eraser className="w-4 h-4 mr-2" />
                  Clear Results
                </Button>
                {reconciliationData.revenueData && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsSaveDialogOpen(true)}
                    disabled={isLoading || isCalculatingRevenue || selectedDocumentIds.length > 0}
                    className="w-full"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save Reconciliation
                  </Button>
                )}
              </div>
            )}

          </CardContent>
        </Card>
      )}

      {previewData !== null && selectedColumns.size === 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-warning">
              <Calculator className="h-5 w-5" />
              <p className="text-sm font-medium">
                Please select at least one column from "Available Columns" above to enable reconciliation calculations.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {previewData !== null && selectedColumns.size > 0 && (
        <ReconciliationResultsView
          bulkTotal={reconciliationData?.councilTotal || 0}
          solarTotal={reconciliationData?.solarTotal || 0}
          tenantTotal={reconciliationData?.tenantTotal || 0}
          totalSupply={reconciliationData?.totalSupply || 0}
          recoveryRate={reconciliationData?.recoveryRate || 0}
          discrepancy={reconciliationData?.discrepancy || 0}
          distributionTotal={reconciliationData?.distributionTotal || 0}
          meters={memoizedMeters}
          meterConnections={meterConnectionsMap}
          meterIndentLevels={meterIndentLevels}
          meterParentInfo={meterParentInfo}
          meterAssignments={meterAssignments}
          showDownloadButtons={reconciliationData !== null}
          onDownloadMeter={downloadMeterCSV}
          onDownloadAll={downloadAllMetersCSV}
          showSaveButton={true}
          onSave={() => setIsSaveDialogOpen(true)}
          revenueData={reconciliationData?.revenueData || null}
          onReconcileEnergy={() => handleReconcile(false)}
          onReconcileRevenue={() => handleReconcile(true)}
          onCancelReconciliation={cancelReconciliation}
          isCancelling={isCancelling}
          isLoadingEnergy={isLoading && !isCalculatingRevenue}
          isLoadingRevenue={isCalculatingRevenue}
          energyProgress={energyProgress}
          revenueProgress={revenueProgress}
          hasPreviewData={previewData !== null}
          canReconcile={selectedColumns.size > 0}
          isBulkMode={selectedDocumentIds.length > 0}
          bulkSelectedCount={selectedDocumentIds.length}
          onBulkReconcile={handleBulkReconcile}
          isBulkProcessing={isBulkProcessing}
          bulkProgress={bulkProgress}
        />
      )}

        <SaveReconciliationDialog
          open={isSaveDialogOpen}
          onOpenChange={setIsSaveDialogOpen}
          onSave={saveReconciliation}
          dateFrom={dateFrom}
          dateTo={dateTo}
          reconciliationData={reconciliationData}
        />
        </div>
      </TabsContent>

      <TabsContent value="history">
        <ReconciliationHistoryTab siteId={siteId} siteName={siteName} />
      </TabsContent>

      <TabsContent value="compare">
        <ReconciliationCompareTab siteId={siteId} />
      </TabsContent>
    </Tabs>
  );
}
