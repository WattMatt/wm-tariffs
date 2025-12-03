import { useState, useRef, useEffect } from 'react';
import type { CorrectedReading } from '@/lib/dataValidation';

export interface ReconciliationProgress {
  current: number;
  total: number;
}

export interface BulkProgress {
  currentDocument: string;
  current: number;
  total: number;
}

export interface HierarchyCsvData {
  totalKwh: number;
  columnTotals: Record<string, number>;
  columnMaxValues: Record<string, number>;
  rowCount: number;
}

export interface UseReconciliationStateOptions {
  siteId: string;
}

export function useReconciliationState({ siteId }: UseReconciliationStateOptions) {
  // Date range state
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [timeFrom, setTimeFrom] = useState<string>("00:00");
  const [timeTo, setTimeTo] = useState<string>("23:59");
  const [userSetDates, setUserSetDates] = useState(false);
  
  // Calendar popover state
  const [isDateFromOpen, setIsDateFromOpen] = useState(false);
  const [isDateToOpen, setIsDateToOpen] = useState(false);
  
  // Core reconciliation data
  const [reconciliationData, setReconciliationData] = useState<any>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  
  // Loading states
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isCalculatingRevenue, setIsCalculatingRevenue] = useState(false);
  const [isGeneratingCsvs, setIsGeneratingCsvs] = useState(false);
  const [isGeneratingHierarchy, setIsGeneratingHierarchy] = useState(false);
  
  // Progress tracking
  const [energyProgress, setEnergyProgress] = useState<ReconciliationProgress>({ current: 0, total: 0 });
  const [revenueProgress, setRevenueProgress] = useState<ReconciliationProgress>({ current: 0, total: 0 });
  const [csvGenerationProgress, setCsvGenerationProgress] = useState<ReconciliationProgress>({ current: 0, total: 0 });
  
  // Error tracking
  const [failedMeters, setFailedMeters] = useState<Map<string, string>>(new Map());
  
  // Cancellation
  const [isCancelling, setIsCancelling] = useState(false);
  const cancelReconciliationRef = useRef(false);
  
  // Dialog state
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  
  // Feature flags
  const [revenueReconciliationEnabled, setRevenueReconciliationEnabled] = useState(false);
  const [hierarchyGenerated, setHierarchyGenerated] = useState(false);
  
  // Hierarchy CSV data
  const [hierarchyCsvData, setHierarchyCsvData] = useState<Map<string, HierarchyCsvData>>(new Map());
  const [hierarchicalCsvResults, setHierarchicalCsvResults] = useState<Map<string, {
    totalKwh: number;
    columnTotals: Record<string, number>;
  }>>(new Map());
  
  // Corrections tracking
  const [meterCorrections, setMeterCorrections] = useState<Map<string, CorrectedReading[]>>(new Map());
  
  // Bulk processing
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress>({ currentDocument: '', current: 0, total: 0 });
  
  // Refs for stable access
  const previewDataRef = useRef<any>(null);
  
  // Persistent state key
  const reconciliationStateKey = `reconciliation_state_${siteId}`;
  
  // Update refs when state changes
  useEffect(() => {
    previewDataRef.current = previewData;
  }, [previewData]);

  // Restore persistent state on mount
  useEffect(() => {
    const savedState = localStorage.getItem(reconciliationStateKey);
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        const stateAge = Date.now() - (parsed.timestamp || 0);
        const MAX_STATE_AGE = 5 * 60 * 1000; // 5 minutes
        
        if (parsed.isLoading || parsed.isCalculatingRevenue) {
          localStorage.removeItem(reconciliationStateKey);
          
          if (parsed.reconciliationData) {
            setReconciliationData(parsed.reconciliationData);
          }
        } else if (parsed.reconciliationData) {
          setReconciliationData(parsed.reconciliationData);
        }
      } catch (e) {
        console.error("Failed to restore reconciliation state:", e);
        localStorage.removeItem(reconciliationStateKey);
      }
    }
  }, [siteId, reconciliationStateKey]);
  
  // Save state during loading
  useEffect(() => {
    if (isLoading || isCalculatingRevenue) {
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
      localStorage.removeItem(reconciliationStateKey);
    }
  }, [isLoading, isCalculatingRevenue, energyProgress, revenueProgress, reconciliationData, reconciliationStateKey]);

  // Reset function
  const resetReconciliationState = () => {
    setReconciliationData(null);
    setPreviewData(null);
    setFailedMeters(new Map());
    setEnergyProgress({ current: 0, total: 0 });
    setRevenueProgress({ current: 0, total: 0 });
    setHierarchyGenerated(false);
    setHierarchyCsvData(new Map());
    setMeterCorrections(new Map());
  };

  return {
    // Date state
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    timeFrom,
    setTimeFrom,
    timeTo,
    setTimeTo,
    userSetDates,
    setUserSetDates,
    isDateFromOpen,
    setIsDateFromOpen,
    isDateToOpen,
    setIsDateToOpen,
    
    // Core data
    reconciliationData,
    setReconciliationData,
    previewData,
    setPreviewData,
    previewDataRef,
    
    // Loading states
    isLoading,
    setIsLoading,
    isLoadingPreview,
    setIsLoadingPreview,
    isCalculatingRevenue,
    setIsCalculatingRevenue,
    isGeneratingCsvs,
    setIsGeneratingCsvs,
    isGeneratingHierarchy,
    setIsGeneratingHierarchy,
    
    // Progress
    energyProgress,
    setEnergyProgress,
    revenueProgress,
    setRevenueProgress,
    csvGenerationProgress,
    setCsvGenerationProgress,
    
    // Errors
    failedMeters,
    setFailedMeters,
    
    // Cancellation
    isCancelling,
    setIsCancelling,
    cancelReconciliationRef,
    
    // Dialog
    isSaveDialogOpen,
    setIsSaveDialogOpen,
    
    // Features
    revenueReconciliationEnabled,
    setRevenueReconciliationEnabled,
    hierarchyGenerated,
    setHierarchyGenerated,
    
    // Hierarchy data
    hierarchyCsvData,
    setHierarchyCsvData,
    hierarchicalCsvResults,
    setHierarchicalCsvResults,
    
    // Corrections
    meterCorrections,
    setMeterCorrections,
    
    // Bulk processing
    selectedDocumentIds,
    setSelectedDocumentIds,
    isBulkProcessing,
    setIsBulkProcessing,
    bulkProgress,
    setBulkProgress,
    
    // Actions
    resetReconciliationState,
  };
}
