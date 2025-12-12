import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  fetchDateRanges as fetchDateRangesFromDb,
  fetchBasicMeters as fetchBasicMetersFromDb,
  fetchDocumentDateRanges as fetchDocumentDateRangesFromDb,
  fetchSchematicConnections as fetchSchematicConnectionsFromDb,
  fetchMeterCsvFilesInfo as fetchMeterCsvFilesInfoFromDb,
  deriveConnectionsFromIndents as deriveConnectionsFromIndentsUtil,
  isMeterVisible as isMeterVisibleUtil,
  type MeterConnection,
} from '@/lib/reconciliation';

export interface MeterWithData {
  id: string;
  meter_number: string;
  meter_type: string;
  hasData?: boolean;
  tariff_structure_id?: string | null;
}

export interface DateRange {
  earliest: Date | null;
  latest: Date | null;
  readingsCount?: number;
}

export interface DocumentDateRange {
  id: string;
  document_type: string;
  file_name: string;
  period_start: string;
  period_end: string;
}

export interface UseMeterHierarchyOptions {
  siteId: string;
}

export function useMeterHierarchy({ siteId }: UseMeterHierarchyOptions) {
  // Meter list state
  const [availableMeters, setAvailableMeters] = useState<MeterWithData[]>([]);
  const [isLoadingMeters, setIsLoadingMeters] = useState(false);
  const [metersFullyLoaded, setMetersFullyLoaded] = useState(false);
  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);
  
  // Hierarchy state
  const [meterIndentLevels, setMeterIndentLevels] = useState<Map<string, number>>(new Map());
  const [meterParentInfo, setMeterParentInfo] = useState<Map<string, string>>(new Map());
  const [meterConnectionsMap, setMeterConnectionsMap] = useState<Map<string, string[]>>(new Map());
  const [expandedMeters, setExpandedMeters] = useState<Set<string>>(new Set());
  
  // Drag & drop state
  const [draggedMeterId, setDraggedMeterId] = useState<string | null>(null);
  const [dragOverMeterId, setDragOverMeterId] = useState<string | null>(null);
  
  // Date ranges
  const [totalDateRange, setTotalDateRange] = useState<{ earliest: Date | null; latest: Date | null }>({ earliest: null, latest: null });
  const [allMeterDateRanges, setAllMeterDateRanges] = useState<Map<string, DateRange>>(new Map());
  const [meterDateRange, setMeterDateRange] = useState<DateRange>({ earliest: null, latest: null, readingsCount: 0 });
  const [isLoadingDateRanges, setIsLoadingDateRanges] = useState(false);
  
  // Document date ranges
  const [documentDateRanges, setDocumentDateRanges] = useState<DocumentDateRange[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  
  // CSV files info
  const [meterCsvFilesInfo, setMeterCsvFilesInfo] = useState<Map<string, { parsed?: string; generated?: string }>>(new Map());
  
  // Local storage keys
  const indentLevelsStorageKey = `reconciliation-indent-levels-${siteId}`;

  // Load/save indent levels from localStorage
  const loadIndentLevelsFromStorage = useCallback((): Map<string, number> => {
    try {
      const stored = localStorage.getItem(indentLevelsStorageKey);
      if (stored) {
        const levelsObj = JSON.parse(stored);
        return new Map(Object.entries(levelsObj).map(([k, v]) => [k, v as number]));
      }
    } catch (error) {
      console.error("Error loading indent levels:", error);
    }
    return new Map();
  }, [indentLevelsStorageKey]);

  const saveIndentLevelsToStorage = useCallback((levels: Map<string, number>) => {
    try {
      const levelsObj = Object.fromEntries(levels);
      localStorage.setItem(indentLevelsStorageKey, JSON.stringify(levelsObj));
    } catch (error) {
      console.error("Error saving indent levels:", error);
    }
  }, [indentLevelsStorageKey]);

  const clearIndentLevelsFromStorage = useCallback(() => {
    try {
      localStorage.removeItem(indentLevelsStorageKey);
    } catch (error) {
      console.error("Error clearing indent levels:", error);
    }
  }, [indentLevelsStorageKey]);

  // Fetch basic meters with data availability - respects saved hierarchy
  const fetchBasicMeters = useCallback(async () => {
    try {
      setIsLoadingMeters(true);
      
      const { data: meters, error } = await supabase
        .from("meters")
        .select("id, meter_number, meter_type, tariff_structure_id")
        .eq("site_id", siteId)
        .order("meter_number");
      
      if (error || !meters) {
        console.error("Error fetching meters:", error);
        return;
      }
      
      // Check data availability for each meter (parallel queries)
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
      
      // ========== ALWAYS build hierarchy from schematic_lines (authoritative source) ==========
      // This ensures hierarchy is always correct, matching what Reset does
      console.log('Building hierarchy from schematic_lines (authoritative source)');
      
      // Fetch parent-child relationships - schematic_lines is authoritative source (per memory)
      const schematicConnections = await fetchSchematicConnectionsFromDb(siteId);
      let siteConnections = schematicConnections.map(conn => ({
        parent_meter_id: conn.parent_meter_id,
        child_meter_id: conn.child_meter_id,
      }));
      
      // Fall back to meter_connections table if schematic has no connections
      if (siteConnections.length === 0) {
        const { data: connections } = await supabase
          .from("meter_connections")
          .select(`
            parent_meter_id,
            child_meter_id,
            parent:meters!meter_connections_parent_meter_id_fkey(site_id),
            child:meters!meter_connections_child_meter_id_fkey(site_id)
          `);
        
        siteConnections = (connections?.filter(conn => 
          conn.parent?.site_id === siteId && conn.child?.site_id === siteId
        ) || []).map(conn => ({
          parent_meter_id: conn.parent_meter_id,
          child_meter_id: conn.child_meter_id,
        }));
      }
      
      // Build parent info map and connections map
      const parentInfoMap = new Map<string, string>();
      const connectionsMap = new Map<string, string[]>();
      
      siteConnections.forEach(conn => {
        const parentMeter = metersWithData.find(m => m.id === conn.parent_meter_id);
        if (parentMeter) {
          parentInfoMap.set(conn.child_meter_id, parentMeter.meter_number);
        }
        
        if (!connectionsMap.has(conn.parent_meter_id)) {
          connectionsMap.set(conn.parent_meter_id, []);
        }
        connectionsMap.get(conn.parent_meter_id)!.push(conn.child_meter_id);
      });
      
      setMeterParentInfo(parentInfoMap);
      setMeterConnectionsMap(connectionsMap);
      
      // Build indent levels from connections
      const indentLevels = new Map<string, number>();
      const calculateIndentLevel = (meterId: string, visited = new Set<string>()): number => {
        if (visited.has(meterId)) return 0;
        visited.add(meterId);
        
        // Find if this meter is a child of another
        for (const [parentId, children] of connectionsMap.entries()) {
          if (children.includes(meterId)) {
            return 1 + calculateIndentLevel(parentId, visited);
          }
        }
        return 0;
      };
      
      metersWithData.forEach(meter => {
        indentLevels.set(meter.id, calculateIndentLevel(meter.id));
      });
      
      setAvailableMeters(metersWithData);
      setMeterIndentLevels(indentLevels);
      
      // Auto-select first bulk meter
      const bulkMeter = metersWithData.find(m => m.meter_type === "bulk_meter");
      if (bulkMeter) {
        setSelectedMeterId(bulkMeter.id);
      } else if (metersWithData.length > 0) {
        setSelectedMeterId(metersWithData[0].id);
      }
      
      // Auto-expand all parent meters
      setExpandedMeters(new Set(connectionsMap.keys()));
    } catch (error) {
      console.error("Error fetching basic meters:", error);
    } finally {
      setIsLoadingMeters(false);
    }
  }, [siteId]);

  // Fetch date ranges
  const fetchDateRanges = useCallback(async () => {
    try {
      setIsLoadingDateRanges(true);
      const range = await fetchDateRangesFromDb(siteId);
      setTotalDateRange(range);
    } catch (error) {
      console.error("Error fetching date ranges:", error);
    } finally {
      setIsLoadingDateRanges(false);
    }
  }, [siteId]);

  // Fetch document date ranges
  const fetchDocumentDateRanges = useCallback(async () => {
    setIsLoadingDocuments(true);
    const ranges = await fetchDocumentDateRangesFromDb(siteId);
    setDocumentDateRanges(ranges);
    setIsLoadingDocuments(false);
  }, [siteId]);

  // Fetch schematic connections
  const fetchSchematicConnections = useCallback(async () => {
    return fetchSchematicConnectionsFromDb(siteId);
  }, [siteId]);

  // Fetch CSV files info
  const fetchMeterCsvFilesInfo = useCallback(async (meterIds: string[]) => {
    const result = await fetchMeterCsvFilesInfoFromDb(meterIds);
    setMeterCsvFilesInfo(result);
  }, []);

  // Toggle meter expansion
  const toggleMeterExpanded = useCallback((meterId: string) => {
    setExpandedMeters(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(meterId)) {
        newExpanded.delete(meterId);
      } else {
        newExpanded.add(meterId);
      }
      return newExpanded;
    });
  }, []);

  // Check meter visibility
  const isMeterVisible = useCallback((meterId: string) => {
    return isMeterVisibleUtil(meterId, meterConnectionsMap, expandedMeters);
  }, [meterConnectionsMap, expandedMeters]);

  // Derive connections from indent levels
  const deriveConnectionsFromIndents = useCallback(() => {
    return deriveConnectionsFromIndentsUtil(availableMeters, meterIndentLevels);
  }, [availableMeters, meterIndentLevels]);

  // Handle indent/outdent
  const handleIndentMeter = useCallback((meterId: string, selectedMetersForSummation: Set<string>) => {
    const newLevels = new Map(meterIndentLevels);
    
    if (selectedMetersForSummation.has(meterId) && selectedMetersForSummation.size > 1) {
      selectedMetersForSummation.forEach(id => {
        const currentLevel = newLevels.get(id) || 0;
        newLevels.set(id, Math.min(currentLevel + 1, 6));
      });
      toast.success(`Indented ${selectedMetersForSummation.size} meter(s)`);
    } else {
      const currentLevel = newLevels.get(meterId) || 0;
      newLevels.set(meterId, Math.min(currentLevel + 1, 6));
    }
    
    setMeterIndentLevels(newLevels);
    saveIndentLevelsToStorage(newLevels);
  }, [meterIndentLevels, saveIndentLevelsToStorage]);

  const handleOutdentMeter = useCallback((meterId: string, selectedMetersForSummation: Set<string>) => {
    const newLevels = new Map(meterIndentLevels);
    
    if (selectedMetersForSummation.has(meterId) && selectedMetersForSummation.size > 1) {
      selectedMetersForSummation.forEach(id => {
        const currentLevel = newLevels.get(id) || 0;
        newLevels.set(id, Math.max(currentLevel - 1, 0));
      });
      toast.success(`Outdented ${selectedMetersForSummation.size} meter(s)`);
    } else {
      const currentLevel = newLevels.get(meterId) || 0;
      newLevels.set(meterId, Math.max(currentLevel - 1, 0));
    }
    
    setMeterIndentLevels(newLevels);
    saveIndentLevelsToStorage(newLevels);
  }, [meterIndentLevels, saveIndentLevelsToStorage]);

  // Load full meter hierarchy with connections and data availability - respects saved hierarchy
  const loadFullMeterHierarchy = useCallback(async () => {
    try {
      // Fetch all meters with tariff structure
      const { data: meters, error: metersError } = await supabase
        .from("meters")
        .select("id, meter_number, meter_type, tariff_structure_id")
        .eq("site_id", siteId)
        .order("meter_number");

      if (metersError || !meters) {
        console.error("Error fetching meters:", metersError);
        return;
      }

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

      // ========== PRIORITY: Check for saved hierarchy settings first ==========
      const { data: savedSettings } = await supabase
        .from('site_reconciliation_settings')
        .select('meter_order, meter_associations')
        .eq('site_id', siteId)
        .maybeSingle();
      
      // If saved meter_order exists, use it as the source of truth
      if (savedSettings?.meter_order && savedSettings.meter_order.length > 0) {
        console.log('loadFullMeterHierarchy: Using saved meter order from site_reconciliation_settings');
        
        // Order meters according to saved order
        const orderedMeters: typeof metersWithData = [];
        const metersById = new Map(metersWithData.map(m => [m.id, m]));
        
        savedSettings.meter_order.forEach((meterId: string) => {
          const meter = metersById.get(meterId);
          if (meter) {
            orderedMeters.push(meter);
            metersById.delete(meterId);
          }
        });
        
        // Add any new meters not in saved order
        metersById.forEach(meter => orderedMeters.push(meter));
        
        setAvailableMeters(orderedMeters);
        
        // Use saved indent levels from localStorage (these are the user's configuration)
        const savedIndentLevels = loadIndentLevelsFromStorage();
        if (savedIndentLevels.size > 0) {
          setMeterIndentLevels(savedIndentLevels);
          
          // Derive connections from saved indent levels
          const derivedConnections = deriveConnectionsFromIndentsUtil(orderedMeters, savedIndentLevels);
          const connectionsMap = new Map<string, string[]>();
          const parentInfoMap = new Map<string, string>();
          
          derivedConnections.forEach(conn => {
            if (!connectionsMap.has(conn.parent_meter_id)) {
              connectionsMap.set(conn.parent_meter_id, []);
            }
            connectionsMap.get(conn.parent_meter_id)!.push(conn.child_meter_id);
            
            const parentMeter = orderedMeters.find(m => m.id === conn.parent_meter_id);
            if (parentMeter) {
              parentInfoMap.set(conn.child_meter_id, parentMeter.meter_number);
            }
          });
          
          setMeterConnectionsMap(connectionsMap);
          setMeterParentInfo(parentInfoMap);
          setExpandedMeters(new Set(connectionsMap.keys()));
        }
        
        // Update selected meter if current selection doesn't have data
        const currentMeter = orderedMeters.find(m => m.id === selectedMeterId);
        if (!currentMeter?.hasData) {
          const bulkMeter = orderedMeters.find(m => m.meter_type === "bulk_meter" && m.hasData);
          const firstMeterWithData = orderedMeters.find(m => m.hasData);
          if (bulkMeter) {
            setSelectedMeterId(bulkMeter.id);
          } else if (firstMeterWithData) {
            setSelectedMeterId(firstMeterWithData.id);
          }
        }

        // Fetch date ranges for all meters with data
        const dateRangesMap = new Map();
        await Promise.all(
          orderedMeters
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
        setMetersFullyLoaded(true);
        return;
      }

      // ========== No saved settings: Build hierarchy from meter_connections/schematic ==========
      console.log('loadFullMeterHierarchy: No saved meter order, building from connections');

      // Fetch meter connections from meter_connections table
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
      let siteConnections = connections?.filter(conn => 
        conn.parent?.site_id === siteId && conn.child?.site_id === siteId
      ) || [];
      
      // If no connections in meter_connections table, fall back to schematic_lines
      if (siteConnections.length === 0) {
        console.log('No meter_connections found, falling back to schematic_lines');
        const schematicConnections = await fetchSchematicConnections();
        siteConnections = schematicConnections.map(conn => ({
          parent_meter_id: conn.parent_meter_id,
          child_meter_id: conn.child_meter_id,
          parent: { site_id: siteId },
          child: { site_id: siteId }
        }));
        console.log(`Using ${siteConnections.length} connections from schematic_lines`);
      }

      // Build parent-child map for hierarchy
      const childrenMap = new Map<string, string[]>();
      siteConnections.forEach(conn => {
        if (!childrenMap.has(conn.parent_meter_id)) {
          childrenMap.set(conn.parent_meter_id, []);
        }
        childrenMap.get(conn.parent_meter_id)!.push(conn.child_meter_id);
      });

      // Build hierarchical meter list
      const meterMap = new Map(metersWithData.map(m => [m.id, m]));
      const processedMeters = new Set<string>();
      const hierarchicalMeters: typeof metersWithData = [];
      const indentLevels = new Map<string, number>();
      
      // Build parent info map and connections map
      const meterParentMap = new Map<string, string>();
      const connectionsMap = new Map<string, string[]>();
      
      siteConnections.forEach(conn => {
        const parentMeter = metersWithData.find(m => m.id === conn.parent_meter_id);
        if (parentMeter) {
          meterParentMap.set(conn.child_meter_id, parentMeter.meter_number);
        }
        
        if (!connectionsMap.has(conn.parent_meter_id)) {
          connectionsMap.set(conn.parent_meter_id, []);
        }
        connectionsMap.get(conn.parent_meter_id)!.push(conn.child_meter_id);
      });
      
      setMeterConnectionsMap(connectionsMap);

      const hasConnections = siteConnections && siteConnections.length > 0;

      if (hasConnections) {
        const addMeterWithChildren = (meterId: string, level: number) => {
          if (processedMeters.has(meterId)) return;
          
          const meter = meterMap.get(meterId);
          if (!meter) return;
          
          hierarchicalMeters.push(meter);
          indentLevels.set(meterId, level);
          processedMeters.add(meterId);
          
          const children = childrenMap.get(meterId) || [];
          
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
            const priorityA = getMeterTypePriority(meterA?.meter_type || '');
            const priorityB = getMeterTypePriority(meterB?.meter_type || '');
            if (priorityA !== priorityB) return priorityA - priorityB;
            return (meterA?.meter_number || '').localeCompare(meterB?.meter_number || '');
          });
          
          children.forEach(childId => {
            addMeterWithChildren(childId, level + 1);
          });
        };
        
        const allChildIds = new Set<string>();
        childrenMap.forEach(children => {
          children.forEach(childId => allChildIds.add(childId));
        });
        
        const councilMeters = metersWithData
          .filter(m => m.meter_type === 'council_meter' && !allChildIds.has(m.id))
          .sort((a, b) => a.meter_number.localeCompare(b.meter_number));
        
        const bulkMeters = metersWithData
          .filter(m => m.meter_type === 'bulk_meter' && !allChildIds.has(m.id))
          .sort((a, b) => a.meter_number.localeCompare(b.meter_number));
        
        councilMeters.forEach(meter => addMeterWithChildren(meter.id, 0));
        bulkMeters.forEach(meter => addMeterWithChildren(meter.id, 0));
        
        const checkMeters = metersWithData
          .filter(m => m.meter_type === 'check_meter' && !processedMeters.has(m.id) && !allChildIds.has(m.id))
          .sort((a, b) => a.meter_number.localeCompare(b.meter_number));
        checkMeters.forEach(meter => addMeterWithChildren(meter.id, 0));
        
        const tenantMeters = metersWithData
          .filter(m => m.meter_type === 'tenant_meter' && !processedMeters.has(m.id) && !allChildIds.has(m.id))
          .sort((a, b) => a.meter_number.localeCompare(b.meter_number));
        tenantMeters.forEach(meter => addMeterWithChildren(meter.id, 0));
        
        metersWithData
          .filter(m => !processedMeters.has(m.id))
          .sort((a, b) => a.meter_number.localeCompare(b.meter_number))
          .forEach(meter => addMeterWithChildren(meter.id, 0));
      } else {
        const getIndentByType = (meterType: string): number => {
          switch (meterType) {
            case 'council_meter': return 0;
            case 'bulk_meter': return 0;
            case 'check_meter': return 1;
            case 'tenant_meter': return 2;
            case 'other': return 3;
            default: return 3;
          }
        };

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
      
      // Update selected meter if current selection doesn't have data
      const currentMeter = hierarchicalMeters.find(m => m.id === selectedMeterId);
      if (!currentMeter?.hasData) {
        const bulkMeter = hierarchicalMeters.find(m => m.meter_type === "bulk_meter" && m.hasData);
        const firstMeterWithData = hierarchicalMeters.find(m => m.hasData);
        if (bulkMeter) {
          setSelectedMeterId(bulkMeter.id);
        } else if (firstMeterWithData) {
          setSelectedMeterId(firstMeterWithData.id);
        }
      }

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
      setMetersFullyLoaded(true);
    } catch (error) {
      console.error("Error loading full meter hierarchy:", error);
      throw error;
    }
  }, [siteId, selectedMeterId, fetchSchematicConnections, loadIndentLevelsFromStorage]);

  // Load on mount
  useEffect(() => {
    fetchDateRanges();
    fetchBasicMeters();
    fetchDocumentDateRanges();
  }, [siteId]);

  // Fetch CSV info when meters change
  useEffect(() => {
    if (availableMeters.length > 0) {
      const meterIds = availableMeters.map(m => m.id);
      fetchMeterCsvFilesInfo(meterIds);
    }
  }, [availableMeters, fetchMeterCsvFilesInfo]);

  // Auto-expand all parent meters when connections change
  const expandAllParents = useCallback(() => {
    const allParentIds = Array.from(meterConnectionsMap.keys());
    setExpandedMeters(new Set(allParentIds));
  }, [meterConnectionsMap]);

  return {
    // Meters
    availableMeters,
    setAvailableMeters,
    isLoadingMeters,
    metersFullyLoaded,
    setMetersFullyLoaded,
    selectedMeterId,
    setSelectedMeterId,
    
    // Hierarchy
    meterIndentLevels,
    setMeterIndentLevels,
    meterParentInfo,
    setMeterParentInfo,
    meterConnectionsMap,
    setMeterConnectionsMap,
    expandedMeters,
    setExpandedMeters,
    
    // Drag & drop
    draggedMeterId,
    setDraggedMeterId,
    dragOverMeterId,
    setDragOverMeterId,
    
    // Date ranges
    totalDateRange,
    setTotalDateRange,
    allMeterDateRanges,
    setAllMeterDateRanges,
    meterDateRange,
    setMeterDateRange,
    isLoadingDateRanges,
    
    // Document ranges
    documentDateRanges,
    setDocumentDateRanges,
    isLoadingDocuments,
    
    // CSV info
    meterCsvFilesInfo,
    setMeterCsvFilesInfo,
    
    // Actions
    fetchBasicMeters,
    fetchDateRanges,
    fetchDocumentDateRanges,
    fetchSchematicConnections,
    fetchMeterCsvFilesInfo,
    toggleMeterExpanded,
    isMeterVisible,
    deriveConnectionsFromIndents,
    handleIndentMeter,
    handleOutdentMeter,
    loadIndentLevelsFromStorage,
    saveIndentLevelsToStorage,
    clearIndentLevelsFromStorage,
    expandAllParents,
    loadFullMeterHierarchy,
  };
}
