import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CalendarIcon, Download, Eye, FileDown, ChevronRight, ChevronLeft, ArrowRight, Check, X, Save, BarChart3, Activity, Calendar as CalendarHistoryIcon } from "lucide-react";
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
  const [reconciliationProgress, setReconciliationProgress] = useState<{current: number, total: number}>({current: 0, total: 0});
  const [meterAssignments, setMeterAssignments] = useState<Map<string, string>>(new Map()); // meter_id -> "grid_supply" | "solar_energy" | "none"
  const [expandedMeters, setExpandedMeters] = useState<Set<string>>(new Set()); // Set of meter IDs that are expanded
  const [userSetDates, setUserSetDates] = useState(false); // Track if user manually set dates
  const [failedMeters, setFailedMeters] = useState<Map<string, string>>(new Map()); // meter_id -> error message
  const [isColumnsOpen, setIsColumnsOpen] = useState(true); // Control collapse state of columns section
  const [isMetersOpen, setIsMetersOpen] = useState(true); // Control collapse state of meters section
  const [documentDateRanges, setDocumentDateRanges] = useState<Array<{
    id: string;
    document_type: string;
    file_name: string;
    period_start: string;
    period_end: string;
  }>>([]);

  // Fetch document date ranges
  useEffect(() => {
    const fetchDocumentDateRanges = async () => {
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
        .not('document_extractions.period_start', 'is', null)
        .not('document_extractions.period_end', 'is', null);

      if (error) {
        console.error("Error fetching document date ranges:", error);
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
            // Sort by document type first, then by period_start descending
            if (a.document_type !== b.document_type) {
              return a.document_type.localeCompare(b.document_type);
            }
            return new Date(b.period_start).getTime() - new Date(a.period_start).getTime();
          });

        setDocumentDateRanges(ranges);
      }
    };

    fetchDocumentDateRanges();
  }, [siteId]);

  // Fetch available meters with CSV data and build hierarchy
  useEffect(() => {
    const fetchAvailableMeters = async () => {
      try {
        // Get all meters for this site
        const { data: meters, error: metersError } = await supabase
          .from("meters")
          .select("id, meter_number, meter_type")
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
        // DB structure: parent_meter_id is downstream (child), child_meter_id is upstream (parent)
        // For display: we want childrenMap where key = parent, value = children
        const childrenMap = new Map<string, string[]>();
        
        siteConnections.forEach(conn => {
          // conn.child_meter_id is the parent (upstream)
          // conn.parent_meter_id is the child (downstream)
          if (!childrenMap.has(conn.child_meter_id)) {
            childrenMap.set(conn.child_meter_id, []);
          }
          childrenMap.get(conn.child_meter_id)!.push(conn.parent_meter_id);
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
          // conn.parent_meter_id is the child (downstream)
          // conn.child_meter_id is the parent (upstream)
          const parentMeter = metersWithData.find(m => m.id === conn.child_meter_id);
          if (parentMeter) {
            meterParentMap.set(conn.parent_meter_id, parentMeter.meter_number);
          }
          
          // Build connections map for calculations: parent -> children
          if (!connectionsMap.has(conn.child_meter_id)) {
            connectionsMap.set(conn.child_meter_id, []);
          }
          connectionsMap.get(conn.child_meter_id)!.push(conn.parent_meter_id);
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
            children.sort((a, b) => {
              const meterA = meterMap.get(a);
              const meterB = meterMap.get(b);
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

        setAvailableMeters(hierarchicalMeters);
        setMeterIndentLevels(indentLevels);
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
    const currentLevel = meterIndentLevels.get(meterId) || 0;
    const newLevel = Math.min(currentLevel + 1, 3); // Max 3 levels
    const newLevels = new Map(meterIndentLevels);
    newLevels.set(meterId, newLevel);
    setMeterIndentLevels(newLevels);
  };

  const handleOutdentMeter = (meterId: string) => {
    const currentLevel = meterIndentLevels.get(meterId) || 0;
    const newLevel = Math.max(currentLevel - 1, 0); // Min 0 levels
    const newLevels = new Map(meterIndentLevels);
    newLevels.set(meterId, newLevel);
    setMeterIndentLevels(newLevels);
  };

  const handleDragStart = (e: React.DragEvent, meterId: string) => {
    setDraggedMeterId(meterId);
    e.dataTransfer.effectAllowed = "move";
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

    const draggedIndex = availableMeters.findIndex(m => m.id === draggedMeterId);
    const targetIndex = availableMeters.findIndex(m => m.id === targetMeterId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedMeterId(null);
      setDragOverMeterId(null);
      return;
    }

    const newMeters = [...availableMeters];
    const [removed] = newMeters.splice(draggedIndex, 1);
    newMeters.splice(targetIndex, 0, removed);

    setAvailableMeters(newMeters);
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
      setReconciliationProgress({
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
            if (!selectedColumns.has(key)) return;
            
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
          const operation = columnOperations.get(key) || 'sum';
          const factor = Number(columnFactors.get(key) || 1);
          
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

  const handleReconcile = async () => {
    if (!dateFrom || !dateTo) {
      toast.error("Please select a date range");
      return;
    }

    if (!previewData) {
      toast.error("Please preview data first");
      return;
    }

    if (selectedColumns.size === 0) {
      toast.error("Please select at least one column to calculate");
      return;
    }

    // Collapse the sections when reconciliation starts
    setIsColumnsOpen(false);
    setIsMetersOpen(false);

    setIsLoading(true);
    setReconciliationProgress({current: 0, total: 0});
    setFailedMeters(new Map());

    try {
      // Fetch all meters for the site
      const { data: meters, error: metersError } = await supabase
        .from("meters")
        .select("id, meter_number, meter_type")
        .eq("site_id", siteId);

      if (metersError) {
        console.error("Error fetching meters:", metersError);
        throw new Error("Failed to fetch meters");
      }

      if (!meters || meters.length === 0) {
        toast.error("No meters found for this site");
        setIsLoading(false);
        return;
      }

      // Combine date and time for precise filtering
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // Process meters in batches of 2 to reduce database load and avoid timeouts
      const { results: meterData, errors } = await processMeterBatches(
        meters,
        2,
        fullDateTimeFrom,
        fullDateTimeTo
      );

      // Store failed meters
      setFailedMeters(errors);

      // Filter meters based on user assignments
      // Fallback: if no assignments exist, use meter types
      let gridSupplyMeters = meterData.filter((m) => meterAssignments.get(m.id) === "grid_supply");
      let solarEnergyMeters = meterData.filter((m) => meterAssignments.get(m.id) === "solar_energy");
      
      // If no manual assignments, fall back to meter types
      if (gridSupplyMeters.length === 0 && solarEnergyMeters.length === 0) {
        // Grid Supply: bulk meters (MB-*)
        gridSupplyMeters = meterData.filter((m) => m.meter_type === "bulk_meter");
        // Solar: no automatic assignment - user must manually assign
        solarEnergyMeters = [];
        
        console.log("No meter assignments found. Using automatic categorization:");
        console.log(`  Grid Supply: ${gridSupplyMeters.length} bulk meters`);
        console.log(`  Solar: 0 (requires manual assignment)`);
      }
      
      // Keep existing meter type filters
      const checkMeters = meterData.filter((m) => m.meter_type === "check_meter");
      const tenantMeters = meterData.filter((m) => m.meter_type === "tenant_meter");
      
      // Collect all meters that should be displayed but aren't in the above categories
      const assignedMeterIds = new Set([
        ...gridSupplyMeters.map(m => m.id),
        ...solarEnergyMeters.map(m => m.id),
        ...tenantMeters.map(m => m.id),
        ...checkMeters.map(m => m.id)
      ]);
      const unassignedMeters = meterData.filter(m => !assignedMeterIds.has(m.id));
      
      console.log("Reconciliation meter breakdown:");
      console.log(`  Grid Supply: ${gridSupplyMeters.map(m => m.meter_number).join(', ')}`);
      console.log(`  Solar Energy: ${solarEnergyMeters.map(m => m.meter_number).join(', ') || 'none'}`);
      console.log(`  Distribution: ${tenantMeters.map(m => m.meter_number).join(', ')}`);
      console.log(`  Unassigned: ${unassignedMeters.map(m => m.meter_number).join(', ') || 'none'}`);

      // Grid Supply: sum all positive values from all grid supply meters (consumption FROM grid)
      const bulkTotal = gridSupplyMeters.reduce((sum, m) => sum + (m.totalKwhPositive || 0), 0);
      
      // Solar Energy: sum all solar meters + sum of all grid negative values (export)
      const solarMeterTotal = solarEnergyMeters.reduce((sum, m) => sum + Math.max(0, m.totalKwh), 0);
      const gridNegative = gridSupplyMeters.reduce((sum, m) => sum + (m.totalKwhNegative || 0), 0);
      const otherTotal = solarMeterTotal + gridNegative; // Adding negative value
      const tenantTotal = tenantMeters.reduce((sum, m) => sum + m.totalKwh, 0);
      
      // Total supply = Grid Supply + Solar Energy
      const totalSupply = bulkTotal + otherTotal;
      const recoveryRate = totalSupply > 0 ? (tenantTotal / totalSupply) * 100 : 0;
      const discrepancy = totalSupply - tenantTotal;

      setReconciliationData({
        // Meter arrays
        bulkMeters: gridSupplyMeters,
        checkMeters,
        otherMeters: [...solarEnergyMeters, ...unassignedMeters],  // Include unassigned meters here
        tenantMeters,
        councilBulk: gridSupplyMeters,  // UI expects this name
        solarMeters: solarEnergyMeters,  // UI expects this name  
        distribution: tenantMeters,  // UI expects this name
        distributionMeters: tenantMeters,  // Alternative name
        unassignedMeters,  // New: for displaying meters that aren't categorized
        
        // Totals
        bulkTotal,
        councilTotal: bulkTotal,  // Grid supply
        otherTotal,
        solarTotal: otherTotal,  // UI expects this name
        tenantTotal,
        distributionTotal: tenantTotal,  // UI expects this name
        totalSupply,
        recoveryRate,
        discrepancy,
      });

      // Update availableMeters to reflect which meters have data in this date range
      setAvailableMeters(prevMeters => 
        prevMeters.map(meter => {
          const meterReadings = meterData.find(m => m.id === meter.id);
          return {
            ...meter,
            hasData: meterReadings ? meterReadings.readingsCount > 0 : false
          };
        })
      );

      // Show completion message with failure count if applicable
      if (errors.size > 0) {
        toast.warning(`Reconciliation complete with ${errors.size} meter failure${errors.size > 1 ? 's' : ''}. Check console for details.`);
        console.warn("Failed meters:", Array.from(errors.entries()).map(([id, msg]) => {
          const meter = meters.find(m => m.id === id);
          return { meter_number: meter?.meter_number, error: msg };
        }));
      } else {
        toast.success("Reconciliation complete");
      }
    } catch (error) {
      console.error("Reconciliation error:", error);
      toast.error("Failed to complete reconciliation. Please try again.");
    } finally {
      setIsLoading(false);
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
      
      // 1. Insert reconciliation run
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
          notes: notes || null
        })
        .select()
        .single();
      
      if (runError) throw runError;
      
      // 2. Prepare all meters with their assignments
      const allMeters = [
        ...(reconciliationData.bulkMeters || []).map((m: any) => ({ ...m, assignment: 'grid_supply' })),
        ...(reconciliationData.solarMeters || []).map((m: any) => ({ ...m, assignment: 'solar' })),
        ...(reconciliationData.tenantMeters || []).map((m: any) => ({ ...m, assignment: 'tenant' })),
        ...(reconciliationData.checkMeters || []).map((m: any) => ({ ...m, assignment: 'check' })),
        ...(reconciliationData.unassignedMeters || []).map((m: any) => ({ ...m, assignment: 'unassigned' }))
      ];
      
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
      
      // 4. Insert all meter results with hierarchical totals
      const meterResults = allMeters.map((meter: any) => ({
        reconciliation_run_id: run.id,
        meter_id: meter.id,
        meter_number: meter.meter_number,
        meter_type: meter.meter_type,
        meter_name: meter.name || null,
        location: meter.location || null,
        assignment: meter.assignment,
        total_kwh: meter.totalKwh || 0,
        total_kwh_positive: meter.totalKwhPositive || 0,
        total_kwh_negative: meter.totalKwhNegative || 0,
        hierarchical_total: hierarchicalTotals.get(meter.id) || 0,
        readings_count: meter.readingsCount || 0,
        column_totals: meter.columnTotals || null,
        column_max_values: meter.columnMaxValues || null,
        has_error: meter.hasError || false,
        error_message: meter.errorMessage || null
      }));
      
      const { error: resultsError } = await supabase
        .from('reconciliation_meter_results')
        .insert(meterResults);
      
      if (resultsError) throw resultsError;
      
      toast.success(`Reconciliation "${runName}" saved successfully`);
      return run.id;
    } catch (error) {
      console.error('Save reconciliation error:', error);
      toast.error('Failed to save reconciliation');
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
            {totalDateRange.earliest && totalDateRange.latest && (
              <div className="text-right space-y-1">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">First Date & Time:</span> {format(totalDateRange.earliest, "MMM dd, yyyy HH:mm")}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Last Date & Time:</span> {format(totalDateRange.latest, "MMM dd, yyyy HH:mm")}
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {documentDateRanges.length > 0 && (
            <div className="space-y-2">
              <Label>Document Period</Label>
              <Select
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
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a document period..." />
                </SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  {Object.entries(
                    documentDateRanges.reduce((acc, doc) => {
                      const typeLabel = doc.document_type === 'municipal_account' 
                        ? 'Municipal Accounts' 
                        : doc.document_type === 'tenant_bill'
                        ? 'Tenant Bills'
                        : doc.document_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                      
                      if (!acc[typeLabel]) {
                        acc[typeLabel] = [];
                      }
                      acc[typeLabel].push(doc);
                      return acc;
                    }, {} as Record<string, typeof documentDateRanges>)
                  ).map(([type, docs]) => (
                    <SelectGroup key={type}>
                      <SelectLabel>{type}</SelectLabel>
                      {docs.map((doc) => (
                        <SelectItem key={doc.id} value={doc.id}>
                          {doc.file_name} ({format(new Date(doc.period_start), "PP")} - {format(new Date(doc.period_end), "PP")})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
                    disabled={!totalDateRange.earliest || !totalDateRange.latest}
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
                    disabled={!totalDateRange.earliest || !totalDateRange.latest}
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

          <Button onClick={handlePreview} disabled={isLoadingPreview || !dateFrom || !dateTo || !selectedMeterId || !totalDateRange.earliest || !totalDateRange.latest} className="w-full">
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
                      <TableHead className="font-semibold">Column Name</TableHead>
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
                  <Label className="text-sm font-semibold cursor-pointer">Meters Associated with This Site</Label>
                  <ChevronRight className={cn("h-4 w-4 transition-transform", isMetersOpen && "rotate-90")} />
                </CollapsibleTrigger>
                <CollapsibleContent>
              
              {/* Column Headers */}
              <div className="flex items-center gap-2 mb-2 pb-2 border-b">
                <div className="w-6 text-xs font-semibold text-left">Summate</div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="w-[72px]"></div> {/* Space for indent buttons */}
                  <div className="flex-1 flex items-center justify-between p-3">
                    <div className="text-xs font-semibold">Meter Number</div>
                    <div className="flex items-center gap-6">
                      <div className="w-24 text-xs font-semibold text-center">Grid Supply</div>
                      <div className="w-24 text-xs font-semibold text-center">Solar Supply</div>
                      <div className="w-24 text-xs font-semibold text-center">Data Status</div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                {availableMeters.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic">No meters found for this site</div>
                ) : (
                  availableMeters.map((meter) => {
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
                              disabled={indentLevel >= 3}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                          <div 
                            className={cn(
                              "flex items-center justify-between flex-1 p-3 rounded-md border bg-card hover:bg-accent/5 transition-colors cursor-move",
                              isDragging && "opacity-50",
                              isDragOver && "border-primary border-2"
                            )}
                            draggable
                            onDragStart={(e) => handleDragStart(e, meter.id)}
                            onDragOver={handleDragOver}
                            onDragEnter={() => handleDragEnter(meter.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, meter.id)}
                            onDragEnd={handleDragEnd}
                          >
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
                  })
                )}
              </div>
              </CollapsibleContent>
            </div>
            </Collapsible>


            <Button onClick={handleReconcile} disabled={isLoading || selectedColumns.size === 0} className="w-full">
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <span>Analyzing... {reconciliationProgress.current}/{reconciliationProgress.total} meters</span>
                </div>
              ) : (
                "Run Reconciliation with Selected Columns"
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {reconciliationData && (
        <ReconciliationResultsView
          bulkTotal={reconciliationData.councilTotal}
          solarTotal={reconciliationData.solarTotal}
          tenantTotal={reconciliationData.tenantTotal}
          totalSupply={reconciliationData.totalSupply}
          recoveryRate={reconciliationData.recoveryRate}
          discrepancy={reconciliationData.discrepancy}
          distributionTotal={reconciliationData.distributionTotal}
          meters={(() => {
            // Collect all processed meters
            const allMeters = [
              ...(reconciliationData.councilBulk || []),
              ...(reconciliationData.solarMeters || []),
              ...(reconciliationData.checkMeters || []),
              ...(reconciliationData.distribution || []),
              ...(reconciliationData.otherMeters || [])
            ].map(m => ({
              ...m,
              hasData: m.hasData !== undefined ? m.hasData : true,
              hasError: m.hasError || failedMeters.has(m.id),
              errorMessage: m.errorMessage || failedMeters.get(m.id)
            }));

            // Create a map for quick lookup
            const meterMap = new Map(allMeters.map(m => [m.id, m]));

            // Order meters according to availableMeters (which has the hierarchy)
            const orderedMeters = availableMeters
              .map(availMeter => meterMap.get(availMeter.id))
              .filter(m => m !== undefined);

            return orderedMeters;
          })()}
          meterConnections={meterConnectionsMap}
          meterIndentLevels={meterIndentLevels}
          meterParentInfo={meterParentInfo}
          meterAssignments={meterAssignments}
          showDownloadButtons={true}
          onDownloadMeter={downloadMeterCSV}
          onDownloadAll={downloadAllMetersCSV}
          showSaveButton={true}
          onSave={() => setIsSaveDialogOpen(true)}
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
