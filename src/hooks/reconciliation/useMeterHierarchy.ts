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

  // Fetch basic meters
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
      
      // Check for saved meter order
      const savedMeterOrder = (window as any).__savedMeterOrder;
      let finalMeters = meters;
      
      if (savedMeterOrder && savedMeterOrder.length > 0) {
        const orderedMeters: typeof meters = [];
        const metersById = new Map(meters.map(m => [m.id, m]));
        
        savedMeterOrder.forEach((meterId: string) => {
          const meter = metersById.get(meterId);
          if (meter) {
            orderedMeters.push(meter);
            metersById.delete(meterId);
          }
        });
        
        metersById.forEach(meter => orderedMeters.push(meter));
        finalMeters = orderedMeters;
        delete (window as any).__savedMeterOrder;
      }
      
      setAvailableMeters(finalMeters);
      
      // Auto-select first bulk meter
      const bulkMeter = finalMeters.find(m => m.meter_type === "bulk_meter");
      if (bulkMeter) {
        setSelectedMeterId(bulkMeter.id);
      } else if (finalMeters.length > 0) {
        setSelectedMeterId(finalMeters[0].id);
      }
      
      // Load saved indent levels
      const savedIndentLevels = loadIndentLevelsFromStorage();
      if (savedIndentLevels.size > 0) {
        setMeterIndentLevels(savedIndentLevels);
      }
    } catch (error) {
      console.error("Error fetching basic meters:", error);
    } finally {
      setIsLoadingMeters(false);
    }
  }, [siteId, loadIndentLevelsFromStorage]);

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
  };
}
