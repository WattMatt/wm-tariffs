import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface UseReconciliationSettingsOptions {
  siteId: string;
  availableMeters: Array<{ id: string }>;
  previewDataRef: React.MutableRefObject<any>;
}

export function useReconciliationSettings({
  siteId,
  availableMeters,
  previewDataRef,
}: UseReconciliationSettingsOptions) {
  // Column settings
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [columnOperations, setColumnOperations] = useState<Map<string, string>>(new Map());
  const [columnFactors, setColumnFactors] = useState<Map<string, string>>(new Map());
  
  // Meter settings
  const [meterAssignments, setMeterAssignments] = useState<Map<string, string>>(new Map());
  const [selectedMetersForSummation, setSelectedMetersForSummation] = useState<Set<string>>(new Set());
  
  // UI state
  const [isColumnsOpen, setIsColumnsOpen] = useState(true);
  const [isMetersOpen, setIsMetersOpen] = useState(true);
  const [sortColumn, setSortColumn] = useState<'meter' | 'grid' | 'solar' | 'status' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // Auto-save state
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const hasInitializedRef = useRef(false);
  const hasMeterInitializedRef = useRef(false);
  const [hasMeterChangesUnsaved, setHasMeterChangesUnsaved] = useState(false);
  
  // Refs for stable access
  const selectedColumnsRef = useRef<Set<string>>(new Set());
  const columnFactorsRef = useRef<Map<string, string>>(new Map());
  const columnOperationsRef = useRef<Map<string, string>>(new Map());

  // Update refs when state changes
  useEffect(() => {
    selectedColumnsRef.current = selectedColumns;
  }, [selectedColumns]);
  
  useEffect(() => {
    columnFactorsRef.current = columnFactors;
  }, [columnFactors]);
  
  useEffect(() => {
    columnOperationsRef.current = columnOperations;
  }, [columnOperations]);

  // Load settings from database
  const loadReconciliationSettings = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('site_reconciliation_settings')
        .select('*')
        .eq('site_id', siteId)
        .single();

      if (data) {
        // Restore meter assignments
        const associations = new Map(Object.entries(data.meter_associations || {}));
        setMeterAssignments(associations);
        
        // Store saved meter order
        if (data.meter_order && data.meter_order.length > 0) {
          (window as any).__savedMeterOrder = data.meter_order;
        }
        
        // Restore meters for summation
        if (data.meters_for_summation && data.meters_for_summation.length > 0) {
          setSelectedMetersForSummation(new Set(data.meters_for_summation));
        }
        
        // Store column settings for restoration after preview loads
        if (data.selected_columns && data.selected_columns.length > 0) {
          (window as any).__savedColumnSettings = {
            selected_columns: data.selected_columns,
            column_operations: data.column_operations,
            column_factors: data.column_factors
          };
        }
      }
    } catch (error) {
      console.error('Error loading reconciliation settings:', error);
    }
  }, [siteId]);

  // Save all settings
  const saveReconciliationSettings = useCallback(async (showToast = true) => {
    try {
      const settingsData = {
        site_id: siteId,
        available_columns: previewDataRef.current?.availableColumns || [],
        meter_associations: Object.fromEntries(meterAssignments),
        selected_columns: Array.from(selectedColumnsRef.current),
        column_operations: Object.fromEntries(columnOperationsRef.current),
        column_factors: Object.fromEntries(columnFactorsRef.current),
        meter_order: availableMeters.map(m => m.id),
        meters_for_summation: Array.from(selectedMetersForSummation)
      };

      const { error } = await supabase
        .from('site_reconciliation_settings')
        .upsert(settingsData, { onConflict: 'site_id' });

      if (error) {
        console.error('Error saving reconciliation settings:', error);
      } else if (showToast) {
        toast.success("Settings saved");
      }
    } catch (error) {
      console.error('Error saving reconciliation settings:', error);
    }
  }, [siteId, meterAssignments, availableMeters, selectedMetersForSummation, previewDataRef]);

  // Auto-save column settings (debounced)
  const autoSaveColumnSettings = useCallback(() => {
    if (!previewDataRef.current) return;
    
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    setIsAutoSaving(true);
    autoSaveTimeoutRef.current = setTimeout(async () => {
      try {
        const settingsData = {
          site_id: siteId,
          available_columns: previewDataRef.current?.availableColumns || [],
          selected_columns: Array.from(selectedColumnsRef.current),
          column_operations: Object.fromEntries(columnOperationsRef.current),
          column_factors: Object.fromEntries(columnFactorsRef.current),
        };

        const { error } = await supabase
          .from('site_reconciliation_settings')
          .upsert(settingsData, { onConflict: 'site_id' });

        if (error) {
          console.error('Error auto-saving column settings:', error);
        }
      } catch (error) {
        console.error('Error auto-saving column settings:', error);
      }
      setIsAutoSaving(false);
    }, 500);
  }, [siteId, previewDataRef]);

  // Save meter settings manually
  const saveMeterSettings = useCallback(async (
    deriveConnectionsFromIndents: () => Array<{ parent_meter_id: string; child_meter_id: string }>
  ) => {
    try {
      const meterIds = availableMeters.map(m => m.id);
      const newConnections = deriveConnectionsFromIndents();
      
      // Delete existing connections
      if (meterIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('meter_connections')
          .delete()
          .or(`parent_meter_id.in.(${meterIds.join(',')}),child_meter_id.in.(${meterIds.join(',')})`);
        
        if (deleteError) throw deleteError;
      }
      
      // Insert new connections
      if (newConnections.length > 0) {
        const { error: insertError } = await supabase
          .from('meter_connections')
          .insert(newConnections);
        
        if (insertError) throw insertError;
      }
      
      // Save other settings
      const settingsData = {
        site_id: siteId,
        meter_associations: Object.fromEntries(meterAssignments),
        meter_order: availableMeters.map(m => m.id),
        meters_for_summation: Array.from(selectedMetersForSummation)
      };
      
      const { error: settingsError } = await supabase
        .from('site_reconciliation_settings')
        .upsert(settingsData, { onConflict: 'site_id' });
      
      if (settingsError) throw settingsError;
      
      setHasMeterChangesUnsaved(false);
      toast.success("Meter settings saved");
    } catch (error) {
      console.error('Error saving meter settings:', error);
      toast.error("Failed to save meter settings");
    }
  }, [siteId, availableMeters, meterAssignments, selectedMetersForSummation]);

  // Auto-save when column settings change
  useEffect(() => {
    if (!hasInitializedRef.current) {
      if (previewDataRef.current) {
        hasInitializedRef.current = true;
      }
      return;
    }
    autoSaveColumnSettings();
  }, [selectedColumns, columnOperations, columnFactors]);

  // Track meter changes
  useEffect(() => {
    if (!hasMeterInitializedRef.current) {
      if (availableMeters.length > 0) {
        hasMeterInitializedRef.current = true;
      }
      return;
    }
    setHasMeterChangesUnsaved(true);
  }, [meterAssignments, selectedMetersForSummation, availableMeters]);

  // Load settings on mount
  useEffect(() => {
    loadReconciliationSettings();
    
    return () => {
      delete (window as any).__savedColumnSettings;
      delete (window as any).__savedMeterOrder;
    };
  }, [siteId, loadReconciliationSettings]);

  // Subscribe to settings changes
  useEffect(() => {
    const settingsChannel = supabase
      .channel(`reconciliation-settings-${siteId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'site_reconciliation_settings',
          filter: `site_id=eq.${siteId}`
        },
        () => {
          loadReconciliationSettings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(settingsChannel);
    };
  }, [siteId, loadReconciliationSettings]);

  return {
    // Column settings
    selectedColumns,
    setSelectedColumns,
    columnOperations,
    setColumnOperations,
    columnFactors,
    setColumnFactors,
    selectedColumnsRef,
    columnFactorsRef,
    columnOperationsRef,
    
    // Meter settings
    meterAssignments,
    setMeterAssignments,
    selectedMetersForSummation,
    setSelectedMetersForSummation,
    
    // UI state
    isColumnsOpen,
    setIsColumnsOpen,
    isMetersOpen,
    setIsMetersOpen,
    sortColumn,
    setSortColumn,
    sortDirection,
    setSortDirection,
    
    // Auto-save state
    isAutoSaving,
    hasMeterChangesUnsaved,
    setHasMeterChangesUnsaved,
    
    // Actions
    loadReconciliationSettings,
    saveReconciliationSettings,
    autoSaveColumnSettings,
    saveMeterSettings,
  };
}
