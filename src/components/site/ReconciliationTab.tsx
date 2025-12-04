import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Eye, Save, BarChart3, Activity, Calculator, Calendar as CalendarHistoryIcon, Loader2, RotateCcw, Eraser } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import SaveReconciliationDialog from "./SaveReconciliationDialog";
import ReconciliationResultsView from "./ReconciliationResultsView";
import ReconciliationHistoryTab from "./ReconciliationHistoryTab";
import ReconciliationCompareTab from "./ReconciliationCompareTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import {
  fetchDateRanges as fetchDateRangesFromDb,
  fetchBasicMeters as fetchBasicMetersFromDb,
  fetchDocumentDateRanges as fetchDocumentDateRangesFromDb,
  fetchHierarchicalDataFromReadings,
  fetchMeterCsvFilesInfo as fetchMeterCsvFilesInfoFromDb,
  checkHierarchicalCsvCoverage,
  getFullDateTime,
  getHierarchyDepth,
  deriveConnectionsFromIndents as deriveConnectionsFromIndentsUtil,
  isMeterVisible as isMeterVisibleUtil,
  applyColumnSettingsToHierarchicalData as applyColumnSettingsUtil,
  type MeterConnection,
  type HierarchicalCsvResult,
} from "@/lib/reconciliation";
import {
  useReconciliationState,
  useMeterHierarchy,
  useReconciliationSettings,
  useReconciliationExecution,
  useReconciliationRunner,
  useDownloadUtils,
} from "@/hooks/reconciliation";
import {
  DateRangeSelector,
  ColumnConfiguration,
  DocumentPeriodSelector,
  MeterHierarchyList,
} from "@/components/reconciliation";

interface ReconciliationTabProps {
  siteId: string;
  siteName: string;
}

export default function ReconciliationTab({ siteId, siteName }: ReconciliationTabProps) {
  // ==================== HOOKS ====================
  // Core reconciliation state (dates, loading, progress, data)
  const reconciliationState = useReconciliationState({ siteId });
  
  // Meter hierarchy state (meters, connections, date ranges)
  const meterHierarchy = useMeterHierarchy({ siteId });
  
  // Settings state (columns, assignments, auto-save)
  const settings = useReconciliationSettings({
    siteId,
    availableMeters: meterHierarchy.availableMeters,
    previewDataRef: reconciliationState.previewDataRef,
  });
  
  // Execution helpers (consolidated save/calculation functions)
  const execution = useReconciliationExecution({
    siteId,
    selectedColumnsRef: settings.selectedColumnsRef,
    columnOperationsRef: settings.columnOperationsRef,
    columnFactorsRef: settings.columnFactorsRef,
    meterAssignments: settings.meterAssignments,
    meterConnectionsMap: meterHierarchy.meterConnectionsMap,
    cancelRef: reconciliationState.cancelReconciliationRef,
    onEnergyProgress: reconciliationState.setEnergyProgress,
    onRevenueProgress: reconciliationState.setRevenueProgress,
  });

  // Runner hook (consolidated workflow functions)
  const runner = useReconciliationRunner({
    siteId,
    selectedColumnsRef: settings.selectedColumnsRef,
    columnOperationsRef: settings.columnOperationsRef,
    columnFactorsRef: settings.columnFactorsRef,
    meterAssignments: settings.meterAssignments,
    cancelRef: reconciliationState.cancelReconciliationRef,
    previewDataRef: reconciliationState.previewDataRef,
    onEnergyProgress: reconciliationState.setEnergyProgress,
    onRevenueProgress: reconciliationState.setRevenueProgress,
    setIsCalculatingRevenue: reconciliationState.setIsCalculatingRevenue,
    // Hierarchy generation callbacks
    onCsvGenerationProgress: reconciliationState.setCsvGenerationProgress,
    onMeterCorrections: reconciliationState.setMeterCorrections,
    onMeterConnectionsMapUpdate: meterHierarchy.setMeterConnectionsMap,
    onHierarchyCsvData: reconciliationState.setHierarchyCsvData,
    onHierarchyGenerated: reconciliationState.setHierarchyGenerated,
    // Preview callbacks
    onPreviewData: reconciliationState.setPreviewData,
    onSelectedColumns: settings.setSelectedColumns,
    onColumnOperations: settings.setColumnOperations,
    onColumnFactors: settings.setColumnFactors,
  });

  // Download utilities hook
  const downloadUtils = useDownloadUtils({
    dateFrom: reconciliationState.dateFrom,
    dateTo: reconciliationState.dateTo,
    timeFrom: reconciliationState.timeFrom,
    timeTo: reconciliationState.timeTo,
  });

  // ==================== DESTRUCTURE HOOK VALUES ====================
  // Reconciliation state
  const {
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    timeFrom, setTimeFrom,
    timeTo, setTimeTo,
    userSetDates, setUserSetDates,
    isDateFromOpen, setIsDateFromOpen,
    isDateToOpen, setIsDateToOpen,
    reconciliationData, setReconciliationData,
    previewData, setPreviewData,
    previewDataRef,
    isLoading, setIsLoading,
    isLoadingPreview, setIsLoadingPreview,
    isCalculatingRevenue, setIsCalculatingRevenue,
    isGeneratingCsvs, setIsGeneratingCsvs,
    isGeneratingHierarchy, setIsGeneratingHierarchy,
    energyProgress, setEnergyProgress,
    revenueProgress, setRevenueProgress,
    csvGenerationProgress, setCsvGenerationProgress,
    failedMeters, setFailedMeters,
    isCancelling, setIsCancelling,
    cancelReconciliationRef,
    isSaveDialogOpen, setIsSaveDialogOpen,
    revenueReconciliationEnabled, setRevenueReconciliationEnabled,
    hierarchyGenerated, setHierarchyGenerated,
    hierarchyCsvData, setHierarchyCsvData,
    hierarchicalCsvResults, setHierarchicalCsvResults,
    meterCorrections, setMeterCorrections,
    selectedDocumentIds, setSelectedDocumentIds,
    isBulkProcessing, setIsBulkProcessing,
    bulkProgress, setBulkProgress,
  } = reconciliationState;

  // Meter hierarchy
  const {
    availableMeters, setAvailableMeters,
    isLoadingMeters,
    metersFullyLoaded, setMetersFullyLoaded,
    selectedMeterId, setSelectedMeterId,
    meterIndentLevels, setMeterIndentLevels,
    meterParentInfo, setMeterParentInfo,
    meterConnectionsMap, setMeterConnectionsMap,
    expandedMeters, setExpandedMeters,
    draggedMeterId, setDraggedMeterId,
    dragOverMeterId, setDragOverMeterId,
    totalDateRange, setTotalDateRange,
    allMeterDateRanges, setAllMeterDateRanges,
    meterDateRange, setMeterDateRange,
    isLoadingDateRanges,
    documentDateRanges, setDocumentDateRanges,
    isLoadingDocuments,
    meterCsvFilesInfo, setMeterCsvFilesInfo,
    fetchBasicMeters,
    fetchDateRanges,
    fetchDocumentDateRanges,
    fetchSchematicConnections,
    fetchMeterCsvFilesInfo,
    toggleMeterExpanded,
    isMeterVisible,
    loadIndentLevelsFromStorage,
    saveIndentLevelsToStorage,
    clearIndentLevelsFromStorage,
    expandAllParents,
    loadFullMeterHierarchy,
  } = meterHierarchy;

  // Settings
  const {
    selectedColumns, setSelectedColumns,
    columnOperations, setColumnOperations,
    columnFactors, setColumnFactors,
    selectedColumnsRef,
    columnFactorsRef,
    columnOperationsRef,
    meterAssignments, setMeterAssignments,
    selectedMetersForSummation, setSelectedMetersForSummation,
    isColumnsOpen, setIsColumnsOpen,
    isMetersOpen, setIsMetersOpen,
    sortColumn, setSortColumn,
    sortDirection, setSortDirection,
    isAutoSaving,
    hasMeterChangesUnsaved, setHasMeterChangesUnsaved,
    loadReconciliationSettings,
    saveReconciliationSettings,
    saveMeterSettings,
  } = settings;

  // ==================== LOCAL STATE (component-specific) ====================
  // Refs that need to stay local
  const hasInitializedRef = useRef(false);
  const hasMeterInitializedRef = useRef(false);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Persistent reconciliation state key
  const reconciliationStateKey = `reconciliation_state_${siteId}`;
  
  // localStorage key for manual indent levels
  const indentLevelsStorageKey = `reconciliation-indent-levels-${siteId}`;

  // Restore persistent state on mount - but don't restore stale loading states
  useEffect(() => {
    const savedState = localStorage.getItem(reconciliationStateKey);
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        const stateAge = Date.now() - (parsed.timestamp || 0);
        const MAX_STATE_AGE = 5 * 60 * 1000; // 5 minutes
        
        // If state indicates loading, we can't actually resume mid-calculation
        if (parsed.isLoading || parsed.isCalculatingRevenue) {
          // Clear the stale loading state
          localStorage.removeItem(reconciliationStateKey);
          
          if (parsed.reconciliationData) {
            // Only restore completed reconciliation data if available
            setReconciliationData(parsed.reconciliationData);
            toast.info("Restored previous reconciliation results");
          } else if (stateAge < MAX_STATE_AGE) {
            toast.warning("Previous reconciliation was interrupted. Please restart.");
          }
        } else if (parsed.reconciliationData) {
          // Not in loading state but has data - safe to restore
          setReconciliationData(parsed.reconciliationData);
        }
      } catch (e) {
        console.error("Failed to restore reconciliation state:", e);
        localStorage.removeItem(reconciliationStateKey);
      }
    }
  }, [siteId, reconciliationStateKey]);
  
  // Save reconciliation state to localStorage whenever it changes
  useEffect(() => {
    if (isLoading || isCalculatingRevenue) {
      // Only save state if there's actual progress (not 0/0 starting state)
      if (energyProgress.total > 0 || revenueProgress.total > 0) {
        const stateToSave = {
          isLoading,
          isCalculatingRevenue,
          energyProgress,
          revenueProgress,
          reconciliationData,
          timestamp: Date.now()
        };
        localStorage.setItem(reconciliationStateKey, JSON.stringify(stateToSave));
      }
    } else {
      // Clear state when reconciliation completes
      localStorage.removeItem(reconciliationStateKey);
    }
  }, [isLoading, isCalculatingRevenue, energyProgress, revenueProgress, reconciliationData, reconciliationStateKey]);

  // Derive parent-child connections from indent levels and meter order (wrapper using hook util)
  const deriveConnectionsFromIndents = () => {
    return deriveConnectionsFromIndentsUtil(availableMeters, meterIndentLevels);
  };

  // Wrapper for saveMeterSettings that passes deriveConnectionsFromIndents
  const handleSaveMeterSettings = async () => {
    await saveMeterSettings(deriveConnectionsFromIndents);
  };

  // Cleanup auto-save timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

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
  // Note: checkHierarchicalCsvCoverage and fetchHierarchicalDataFromReadings 
  // are imported from @/lib/reconciliation
  // Note: loadFullMeterHierarchy is provided by useMeterHierarchy hook

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
      // Don't auto-populate dates - user must manually select
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
  
  // Reset meter hierarchy to database defaults (restore from schematic connections)
  const handleResetHierarchy = async () => {
    clearIndentLevelsFromStorage();
    setMetersFullyLoaded(false);
    
    try {
      // Fetch connections from schematic_lines
      const schematicConnections = await fetchSchematicConnections();
      
      if (schematicConnections.length === 0) {
        // No schematic connections, just clear everything
        setMeterConnectionsMap(new Map());
        setMeterIndentLevels(new Map());
        setMeterParentInfo(new Map());
        toast.info("No schematic connections found. Hierarchy cleared.");
        await fetchBasicMeters();
        return;
      }
      
      // Fetch meters directly from database to get meter_number for parent info
      const { data: metersData } = await supabase
        .from('meters')
        .select('id, meter_number')
        .eq('site_id', siteId);
      
      const metersMap = new Map(metersData?.map(m => [m.id, m.meter_number]) || []);
      
      // Build meterConnectionsMap (parent -> [children])
      const connectionsMap = new Map<string, string[]>();
      schematicConnections.forEach(conn => {
        if (!connectionsMap.has(conn.parent_meter_id)) {
          connectionsMap.set(conn.parent_meter_id, []);
        }
        connectionsMap.get(conn.parent_meter_id)!.push(conn.child_meter_id);
      });
      setMeterConnectionsMap(connectionsMap);
      
      // Build meterParentInfo (child -> parent meter_number) using fresh DB data
      const parentInfo = new Map<string, string>();
      schematicConnections.forEach(conn => {
        const parentMeterNumber = metersMap.get(conn.parent_meter_id);
        if (parentMeterNumber) {
          parentInfo.set(conn.child_meter_id, parentMeterNumber);
        }
      });
      setMeterParentInfo(parentInfo);
      
      // Calculate indent levels based on hierarchy
      const childIds = new Set<string>();
      schematicConnections.forEach(conn => childIds.add(conn.child_meter_id));
      
      const calculateIndentLevel = (meterId: string, visited: Set<string> = new Set()): number => {
        if (visited.has(meterId)) return 0; // Prevent cycles
        visited.add(meterId);
        
        // Find parent of this meter
        const parentConnection = schematicConnections.find(c => c.child_meter_id === meterId);
        if (!parentConnection) return 0; // Root level
        
        return 1 + calculateIndentLevel(parentConnection.parent_meter_id, visited);
      };
      
      // Calculate indent levels for all meters from DB
      const indentLevels = new Map<string, number>();
      metersData?.forEach(meter => {
        indentLevels.set(meter.id, calculateIndentLevel(meter.id));
      });
      setMeterIndentLevels(indentLevels);
      
      toast.success("Meter hierarchy restored from schematic");
      await fetchBasicMeters();
    } catch (error) {
      console.error('Error resetting hierarchy:', error);
      toast.error("Failed to reset hierarchy");
    }
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

  // Note: getFullDateTime is imported from @/lib/reconciliation

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
      await runner.runPreview(
        dateFrom,
        dateTo,
        timeFrom,
        timeTo,
        selectedMeterId,
        meterDateRange,
        loadFullMeterHierarchy,
        metersFullyLoaded
      );
    } finally {
      setIsLoadingPreview(false);
    }
  };


  // Note: processMeterBatches, processSingleMeter, performReconciliationCalculation, 
  // and generateHierarchicalCsvForMeter moved to useReconciliationRunner hook

  // Note: getMetersWithUploadedCsvs moved to useReconciliationExecution hook

  // Note: applyColumnSettingsToHierarchicalData moved to useReconciliationExecution hook

  // Handler for "Generate Hierarchy" button - STEP 1 only
  const handleGenerateHierarchy = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      toast.error("Please select a date range");
      return;
    }

    setIsGeneratingHierarchy(true);
    cancelReconciliationRef.current = false;

    try {
      await runner.runHierarchyGeneration(
        dateFrom,
        dateTo,
        timeFrom,
        timeTo,
        availableMeters
      );
    } finally {
      setIsGeneratingHierarchy(false);
    }
  }, [dateFrom, dateTo, timeFrom, timeTo, availableMeters, runner]);

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

    const result = await runner.runReconciliation({
      dateFrom,
      dateTo,
      timeFrom,
      timeTo,
      enableRevenue: enableRevenue !== undefined ? enableRevenue : revenueReconciliationEnabled,
      availableMeters,
      meterConnectionsMap,
      hierarchyGenerated,
      meterCorrections,
      getMetersWithUploadedCsvs: execution.getMetersWithUploadedCsvs,
      updateMeterCategoryWithHierarchy: execution.updateMeterCategoryWithHierarchy,
      saveReconciliationSettings,
      setIsLoading,
      setFailedMeters,
      setHierarchicalCsvResults,
      setReconciliationData,
      setAvailableMeters,
      setIsColumnsOpen,
      setIsMetersOpen,
      setIsCancelling,
      setIsGeneratingCsvs,
    });

    return result;
  }, [dateFrom, dateTo, timeFrom, timeTo, revenueReconciliationEnabled, availableMeters, meterConnectionsMap, hierarchyGenerated, meterCorrections, runner, execution, saveReconciliationSettings]);

  const cancelReconciliation = () => {
    if (!isCancelling) {
      setIsCancelling(true);
      cancelReconciliationRef.current = true;
      console.log("Cancellation requested - forcing cleanup");
      
      // Force cleanup immediately
      setIsLoading(false);
      setIsCalculatingRevenue(false);
      setIsGeneratingCsvs(false);
      setEnergyProgress({ current: 0, total: 0 });
      setRevenueProgress({ current: 0, total: 0 });
      setCsvGenerationProgress({ current: 0, total: 0 });
      
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
      const runId = await execution.saveReconciliationRun(
        runName,
        notes || null,
        getFullDateTime(dateFrom, timeFrom),
        getFullDateTime(dateTo, timeTo),
        reconciliationData,
        availableMeters,
        hierarchicalCsvResults
      );
      
      toast.success(`Reconciliation "${runName}" saved successfully`);
      return runId;
    } catch (error) {
      console.error('Save reconciliation error:', error);
      toast.error('Failed to save reconciliation');
      throw error;
    }
  };

  const handleBulkReconcile = async () => {
    await runner.runBulkReconcile({
      selectedDocumentIds,
      documentDateRanges,
      meterConnectionsMap,
      availableMeters,
      enableRevenue: revenueReconciliationEnabled,
      meterCorrections,
      getMetersWithUploadedCsvs: execution.getMetersWithUploadedCsvs,
      updateMeterCategoryWithHierarchy: execution.updateMeterCategoryWithHierarchy,
      saveReconciliationSettings: settings.saveReconciliationSettings,
      saveReconciliationRun: execution.saveReconciliationRun,
      setIsBulkProcessing,
      setBulkProgress,
      setSelectedDocumentIds,
      setIsLoading,
      setFailedMeters,
      setHierarchicalCsvResults,
      setReconciliationData,
      setAvailableMeters,
      setIsColumnsOpen,
      setIsMetersOpen,
      setIsCancelling,
      setIsGeneratingCsvs,
    });
  };

  // Note: downloadMeterCSV, downloadMeterCsvFile, downloadAllMetersCSV moved to useDownloadUtils hook

  // Helper wrapper for downloadAllMetersCSV to gather all meters
  const handleDownloadAllMetersCSV = async () => {
    if (!reconciliationData) return;

    const allMeters = [
      ...reconciliationData.bulkMeters,
      ...reconciliationData.checkMeters,
      ...reconciliationData.otherMeters,
      ...reconciliationData.tenantMeters,
    ];

    await downloadUtils.downloadAllMetersCSV(allMeters);
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
    
    // Helper to aggregate columnTotals from leaf meters for display (fallback if not from CSV)
    const getLeafColumnTotalsForDisplay = (meterId: string, visited = new Set<string>()): Record<string, number> => {
      if (visited.has(meterId)) return {};
      visited.add(meterId);
      
      const children = meterConnectionsMap.get(meterId) || [];
      
      if (children.length === 0) {
        const meterData = meterMap.get(meterId);
        return meterData?.columnTotals || {};
      }
      
      // For parent meters, sum children's raw values (operations/factors applied at display time)
      const aggregated: Record<string, number> = {};
      children.forEach(childId => {
        const childTotals = getLeafColumnTotalsForDisplay(childId, new Set(visited));
        Object.entries(childTotals).forEach(([key, value]) => {
          aggregated[key] = (aggregated[key] || 0) + value;
        });
      });
      return aggregated;
    };
    
    // Helper to get max of columnMaxValues from leaf meters for display
    const getLeafColumnMaxValuesForDisplay = (meterId: string, visited = new Set<string>()): Record<string, number> => {
      if (visited.has(meterId)) return {};
      visited.add(meterId);
      
      const children = meterConnectionsMap.get(meterId) || [];
      
      if (children.length === 0) {
        const meterData = meterMap.get(meterId);
        return meterData?.columnMaxValues || {};
      }
      
      const aggregated: Record<string, number> = {};
      children.forEach(childId => {
        const childMaxValues = getLeafColumnMaxValuesForDisplay(childId, new Set(visited));
        Object.entries(childMaxValues).forEach(([key, value]) => {
          aggregated[key] = Math.max(aggregated[key] || 0, value);
        });
      });
      return aggregated;
    };

    // Order meters according to availableMeters (which has the hierarchy)
    const orderedMeters = availableMeters
      .map(availMeter => {
        const meterData = meterMap.get(availMeter.id);
        if (!meterData) return undefined;
        
        // Check if this is a parent meter (has children)
        const children = meterConnectionsMap.get(availMeter.id) || [];
        const isParentMeter = children.length > 0;
        
        // For parent meters, use columnTotals from the data (which contains raw sums from CSV)
        // The display component will apply operations/factors as needed
        let columnTotals = meterData.columnTotals;
        let columnMaxValues = meterData.columnMaxValues;
        
        // Fallback: if parent meter doesn't have columnTotals, aggregate from children
        if (isParentMeter && (!columnTotals || Object.keys(columnTotals).length === 0)) {
          columnTotals = getLeafColumnTotalsForDisplay(availMeter.id);
        }
        if (isParentMeter && (!columnMaxValues || Object.keys(columnMaxValues).length === 0)) {
          columnMaxValues = getLeafColumnMaxValuesForDisplay(availMeter.id);
        }
        
        // Add error info from failedMeters if it exists
        return {
          ...meterData,
          columnTotals,
          columnMaxValues,
          hasError: meterData.hasError || failedMeters.has(availMeter.id),
          errorMessage: meterData.errorMessage || failedMeters.get(availMeter.id) || null
        };
      })
      .filter(m => m !== undefined);

    return orderedMeters;
  }, [reconciliationData, availableMeters.length, meterConnectionsMap, failedMeters]);

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
          <DocumentPeriodSelector
            documentDateRanges={documentDateRanges}
            selectedDocumentIds={selectedDocumentIds}
            isLoadingDocuments={isLoadingDocuments}
            onSelectedDocumentIdsChange={setSelectedDocumentIds}
            onDocumentPeriodSelect={(doc) => {
              const startDate = new Date(doc.period_start);
              startDate.setHours(0, 0, 0, 0);
              const endDate = new Date(doc.period_end);
              endDate.setDate(endDate.getDate() - 1);
              endDate.setHours(23, 59, 0, 0);
              setDateFrom(startDate);
              setDateTo(endDate);
              setTimeFrom("00:00");
              setTimeTo("23:59");
              setUserSetDates(true);
              toast.success(`Date range set from ${format(startDate, "PP")} to ${format(endDate, "PP")}`);
            }}
            onRefreshDocuments={fetchDocumentDateRanges}
          />
          <DateRangeSelector
            dateFrom={dateFrom}
            dateTo={dateTo}
            timeFrom={timeFrom}
            timeTo={timeTo}
            isDateFromOpen={isDateFromOpen}
            isDateToOpen={isDateToOpen}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onTimeFromChange={setTimeFrom}
            onTimeToChange={setTimeTo}
            onDateFromOpenChange={setIsDateFromOpen}
            onDateToOpenChange={setIsDateToOpen}
            onUserSetDates={() => setUserSetDates(true)}
          />

          <Button onClick={handlePreview} disabled={isLoadingPreview || !dateFrom || !dateTo || !selectedMeterId} className="w-full">
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
            <ColumnConfiguration
              availableColumns={previewData.availableColumns || []}
              selectedColumns={selectedColumns}
              columnOperations={columnOperations}
              columnFactors={columnFactors}
              isOpen={isColumnsOpen}
              onOpenChange={setIsColumnsOpen}
              onSelectedColumnsChange={setSelectedColumns}
              onColumnOperationsChange={setColumnOperations}
              onColumnFactorsChange={setColumnFactors}
            />

            <MeterHierarchyList
              availableMeters={availableMeters}
              meterIndentLevels={meterIndentLevels}
              meterParentInfo={meterParentInfo}
              meterAssignments={meterAssignments}
              selectedMetersForSummation={selectedMetersForSummation}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              isOpen={isMetersOpen}
              hasMeterChangesUnsaved={hasMeterChangesUnsaved}
              draggedMeterId={draggedMeterId}
              dragOverMeterId={dragOverMeterId}
              onOpenChange={setIsMetersOpen}
              onMeterIndentLevelsChange={setMeterIndentLevels}
              onMeterAssignmentsChange={setMeterAssignments}
              onSelectedMetersChange={setSelectedMetersForSummation}
              onSortColumnChange={setSortColumn}
              onSortDirectionChange={setSortDirection}
              onSaveIndentLevels={saveIndentLevelsToStorage}
              onSaveMeterSettings={handleSaveMeterSettings}
              onResetHierarchy={handleResetHierarchy}
              onMetersReorder={setAvailableMeters}
              onDraggedMeterIdChange={setDraggedMeterId}
              onDragOverMeterIdChange={setDragOverMeterId}
            />

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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSaveDialogOpen(true)}
                  disabled={isLoading || isCalculatingRevenue}
                  className="w-full"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Reconciliation
                </Button>
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
          onDownloadMeter={downloadUtils.downloadMeterCSV}
          onDownloadMeterCsvFile={downloadUtils.downloadMeterCsvFile}
          meterCsvFiles={meterCsvFilesInfo}
          onDownloadAll={handleDownloadAllMetersCSV}
          showSaveButton={true}
          onSave={() => setIsSaveDialogOpen(true)}
          revenueData={reconciliationData?.revenueData || null}
          onReconcileEnergy={() => handleReconcile(false)}
          onReconcileRevenue={() => handleReconcile(true)}
          onGenerateHierarchy={handleGenerateHierarchy}
          isGeneratingHierarchy={isGeneratingHierarchy}
          hierarchyGenerated={hierarchyGenerated}
          onCancelReconciliation={cancelReconciliation}
          isCancelling={isCancelling}
          isLoadingEnergy={isLoading && !isCalculatingRevenue}
          isLoadingRevenue={isCalculatingRevenue}
          energyProgress={energyProgress}
          revenueProgress={revenueProgress}
          isGeneratingCsvs={isGeneratingCsvs}
          csvGenerationProgress={csvGenerationProgress}
          hasPreviewData={previewData !== null}
          canReconcile={selectedColumns.size > 0}
          isBulkMode={selectedDocumentIds.length > 0}
          bulkSelectedCount={selectedDocumentIds.length}
          onBulkReconcile={handleBulkReconcile}
          isBulkProcessing={isBulkProcessing}
          bulkProgress={bulkProgress}
          meterCorrections={meterCorrections}
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
