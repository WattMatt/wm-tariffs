import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileDown, Download, ChevronRight, Save, Loader2, Zap, Calculator, DollarSign, X, AlertTriangle, AlertCircle, ChevronDown, Upload, GitBranch, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import CorrectionsDialog from "./CorrectionsDialog";
import type { CorrectedReading } from "@/lib/dataValidation";

interface MeterData {
  id: string;
  meter_number: string;
  meter_name?: string;
  meter_type: string;
  location?: string;
  assignment?: string;
  totalKwh: number;
  totalKwhPositive?: number;
  totalKwhNegative?: number;
  readingsCount: number;
  columnTotals?: Record<string, number>;
  columnMaxValues?: Record<string, number>;
  hasData?: boolean;
  hasError?: boolean;
  errorMessage?: string;
  hierarchicalTotal?: number;
  
  // Direct values (from uploaded/parsed CSV)
  directTotalKwh?: number;
  directColumnTotals?: Record<string, number>;
  directColumnMaxValues?: Record<string, number>;
  directReadingsCount?: number;
  
  // Hierarchical values (from generated hierarchical CSV)
  hierarchicalTotalKwh?: number;
  hierarchicalColumnTotals?: Record<string, number>;
  hierarchicalColumnMaxValues?: Record<string, number>;
  
  // Revenue fields
  tariffName?: string;
  energyCost?: number;
  fixedCharges?: number;
  demandCharges?: number;
  totalCost?: number;
  avgCostPerKwh?: number;
  costCalculationError?: string;
  
  // Dual revenue (direct vs hierarchical)
  directRevenue?: {
    energyCost: number;
    fixedCharges: number;
    demandCharges: number;
    totalCost: number;
    avgCostPerKwh: number;
    tariffName: string;
    hasError: boolean;
    errorMessage?: string;
  };
  hierarchicalRevenue?: {
    energyCost: number;
    fixedCharges: number;
    demandCharges: number;
    totalCost: number;
    avgCostPerKwh: number;
    tariffName: string;
    hasError: boolean;
    errorMessage?: string;
  };
}

interface RevenueData {
  meterRevenues: Map<string, {
    energyCost: number;
    fixedCharges: number;
    demandCharges: number;
    totalCost: number;
    avgCostPerKwh: number;
    tariffName: string;
    hasError: boolean;
    errorMessage?: string;
  }>;
  gridSupplyCost: number;
  solarCost: number;
  tenantCost: number;
  totalRevenue: number;
  avgCostPerKwh: number;
}

interface ReconciliationResultsViewProps {
  bulkTotal: number;
  solarTotal: number;
  tenantTotal: number;
  totalSupply: number;
  recoveryRate: number;
  discrepancy: number;
  distributionTotal: number;
  meters: MeterData[];
  meterConnections?: Map<string, string[]>;
  meterIndentLevels?: Map<string, number>;
  meterParentInfo?: Map<string, string>;
  meterAssignments?: Map<string, string>;
  showDownloadButtons?: boolean;
  onDownloadMeter?: (meter: MeterData) => void;
  onDownloadMeterCsvFile?: (meterId: string, fileType: 'parsed' | 'generated') => void;
  meterCsvFiles?: Map<string, { parsed?: string; generated?: string }>;
  onDownloadAll?: () => void;
  onSave?: () => void;
  showSaveButton?: boolean;
  revenueData?: RevenueData | null;
  onReconcileEnergy?: () => void;
  onReconcileRevenue?: () => void;
  onGenerateHierarchy?: () => void;
  isGeneratingHierarchy?: boolean;
  hierarchyGenerated?: boolean;
  onCancelReconciliation?: () => void;
  isCancelling?: boolean;
  isLoadingEnergy?: boolean;
  isLoadingRevenue?: boolean;
  energyProgress?: { current: number; total: number };
  revenueProgress?: { current: number; total: number };
  isGeneratingCsvs?: boolean;
  csvGenerationProgress?: { current: number; total: number };
  hasPreviewData?: boolean;
  canReconcile?: boolean;
  isBulkMode?: boolean;
  bulkSelectedCount?: number;
  onBulkReconcile?: () => void;
  isBulkProcessing?: boolean;
  bulkProgress?: {
    currentDocument: string;
    current: number;
    total: number;
  };
  meterCorrections?: Map<string, CorrectedReading[]>;
  isSavedRun?: boolean;
}

// Smart CSV download button that shows dropdown when both parsed and generated CSVs exist
function CsvDownloadButton({ 
  meter, 
  csvFiles, 
  onDownloadOnTheFly, 
  onDownloadFromStorage 
}: { 
  meter: MeterData;
  csvFiles?: { parsed?: string; generated?: string };
  onDownloadOnTheFly: () => void;
  onDownloadFromStorage?: (meterId: string, fileType: 'parsed' | 'generated') => void;
}) {
  const hasParsed = !!csvFiles?.parsed;
  const hasGenerated = !!csvFiles?.generated;
  const hasBoth = hasParsed && hasGenerated;
  const hasAny = hasParsed || hasGenerated;

  // If no stored files, fall back to on-the-fly download
  if (!hasAny || !onDownloadFromStorage) {
    return (
      <Button variant="ghost" size="sm" className="gap-2 h-8" onClick={onDownloadOnTheFly}>
        <FileDown className="w-3 h-3" />
        CSV
      </Button>
    );
  }

  // If only one type, download directly (prioritize parsed)
  if (!hasBoth) {
    return (
      <Button 
        variant="ghost" 
        size="sm" 
        className="gap-2 h-8"
        onClick={() => onDownloadFromStorage(meter.id, hasParsed ? 'parsed' : 'generated')}
      >
        <FileDown className="w-3 h-3" />
        CSV
      </Button>
    );
  }

  // If both exist, show dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 h-8">
          <FileDown className="w-3 h-3" />
          CSV
          <ChevronDown className="w-3 h-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => onDownloadFromStorage(meter.id, 'parsed')}>
          <Upload className="w-4 h-4 mr-2" />
          Uploaded CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDownloadFromStorage(meter.id, 'generated')}>
          <GitBranch className="w-4 h-4 mr-2" />
          Generated Hierarchical
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function ReconciliationResultsView({
  bulkTotal,
  solarTotal,
  tenantTotal,
  totalSupply,
  recoveryRate,
  discrepancy,
  distributionTotal,
  meters,
  meterConnections = new Map(),
  meterIndentLevels = new Map(),
  meterParentInfo = new Map(),
  meterAssignments = new Map(),
  showDownloadButtons = true,
  onDownloadMeter,
  onDownloadMeterCsvFile,
  meterCsvFiles = new Map(),
  onDownloadAll,
  onSave,
  showSaveButton = false,
  revenueData = null,
  onReconcileEnergy,
  onReconcileRevenue,
  onGenerateHierarchy,
  isGeneratingHierarchy = false,
  hierarchyGenerated = false,
  onCancelReconciliation,
  isCancelling = false,
  isLoadingEnergy = false,
  isLoadingRevenue = false,
  energyProgress = { current: 0, total: 0 },
  revenueProgress = { current: 0, total: 0 },
  isGeneratingCsvs = false,
  csvGenerationProgress = { current: 0, total: 0 },
  hasPreviewData = false,
  canReconcile = false,
  isBulkMode = false,
  bulkSelectedCount = 0,
  onBulkReconcile,
  isBulkProcessing = false,
  bulkProgress = { currentDocument: '', current: 0, total: 0 },
  meterCorrections = new Map(),
  isSavedRun = false,
}: ReconciliationResultsViewProps) {
  const [expandedMeters, setExpandedMeters] = useState<Set<string>>(new Set());
  const [correctionsDialogOpen, setCorrectionsDialogOpen] = useState(false);
  const [selectedMeterForCorrections, setSelectedMeterForCorrections] = useState<{
    meterId: string;
    meterNumber: string;
    corrections: CorrectedReading[];
  } | null>(null);

  // Corrections are now properly propagated from children to parents in ReconciliationTab
  // meterCorrections.get(meterId) returns the corrections relevant to that meter:
  // - For leaf meters: their own detected corruptions
  // - For parent meters: corrections propagated from their descendants

  const handleShowCorrections = (meterId: string, meterNumber: string, corrections: CorrectedReading[]) => {
    setSelectedMeterForCorrections({ meterId, meterNumber, corrections });
    setCorrectionsDialogOpen(true);
  };

  const handleEnergyTabClick = () => {
    if (isLoadingEnergy) {
      onCancelReconciliation?.();
    } else if (!meters || meters.length === 0) {
      onReconcileEnergy?.();
    }
  };

  const handleRevenueTabClick = () => {
    if (isLoadingRevenue) {
      onCancelReconciliation?.();
    } else if (!revenueData) {
      onReconcileRevenue?.();
    }
  };

  const handleHierarchyTabClick = () => {
    if (isGeneratingHierarchy) {
      onCancelReconciliation?.();
    } else if (!hierarchyGenerated) {
      onGenerateHierarchy?.();
    }
  };

  const toggleMeterExpanded = (meterId: string) => {
    setExpandedMeters((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(meterId)) {
        newSet.delete(meterId);
      } else {
        newSet.add(meterId);
      }
      return newSet;
    });
  };

  const isMeterVisible = (meterId: string): boolean => {
    // If no meterConnections, all meters are visible
    if (!meterConnections) return true;
    
    // Find all parent IDs
    let parentIds: string[] = [];
    for (const [parentId, childIds] of meterConnections.entries()) {
      if (Array.isArray(childIds) && childIds.includes(meterId)) {
        parentIds.push(parentId);
      }
    }

    // If no parent, it's a top-level meter, always visible
    if (parentIds.length === 0) return true;

    // Check if all parents are expanded
    return parentIds.every((parentId) => expandedMeters.has(parentId));
  };

  const renderMeterRow = (meter: MeterData, isRevenueView: boolean = false) => {
    const childIds = meterConnections?.get(meter.id) || [];
    // Get corrections for this meter directly from meterCorrections
    // For leaf meters: their own corruptions; For parents: propagated from children
    const corrections = meterCorrections.get(meter.id) || [];
    const hasChildren = childIds.length > 0;
    
    // CRITICAL: Use ONLY database hierarchical value - no client-side fallback
    // This ensures we display correctly aggregated P1, P2, S values from hierarchical_meter_readings
    const hierarchicalTotal = meter.hierarchicalTotalKwh ?? meter.hierarchicalTotal ?? 0;
    
    const indentLevel = meterIndentLevels.get(meter.id) || 0;
    const marginLeft = indentLevel * 24;
    const parentInfo = meterParentInfo.get(meter.id);
    
    const isExpanded = expandedMeters.has(meter.id);
    
    const meterAssignment = meterAssignments.get(meter.id) || meter.assignment;
    let bgColor = "bg-muted/50";
    let borderColor = "border-border/50";
    
    if (meterAssignment === "grid_supply") {
      bgColor = "bg-primary/10";
      borderColor = "border-primary/30";
    } else if (meterAssignment === "solar_energy") {
      bgColor = "bg-yellow-500/10";
      borderColor = "border-yellow-500/30";
    }
    
    if (meter.hasError) {
      bgColor = "bg-destructive/10";
      borderColor = "border-destructive/30";
    } else if (meter.hasData === false) {
      bgColor = "bg-muted/20";
      borderColor = "border-muted/30";
    }

    const meterRevenue = revenueData?.meterRevenues.get(meter.id);
    
    return (
      <div
        key={meter.id}
        className={cn("space-y-2 p-3 rounded-lg border", bgColor, borderColor)}
        style={{ marginLeft: `${marginLeft}px` }}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1 flex-1">
            <div className="flex items-center gap-2">
              {hasChildren && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={() => toggleMeterExpanded(meter.id)}
                >
                  {isExpanded ? (
                    <ChevronRight className="h-4 w-4 rotate-90" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              )}
              <span className="font-mono text-sm font-semibold">{meter.meter_number}</span>
              {meter.hasData === false && !meter.hasError && childIds.length === 0 && (
                <Badge variant="outline" className="text-xs">No data in range</Badge>
              )}
              {meter.hasError && (
                <Badge variant="destructive" className="text-xs">Error: {meter.errorMessage || 'Failed to load'}</Badge>
              )}
              {/* Leaf meters show BOTH corrupt (red) AND corrected (amber) badges */}
              {corrections.length > 0 && !hasChildren && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 h-5 px-2 bg-destructive/20 border-destructive/50 text-destructive hover:bg-destructive/30"
                    onClick={() => handleShowCorrections(meter.id, meter.meter_number, corrections)}
                  >
                    <AlertCircle className="h-3 w-3" />
                    <span className="text-xs">{corrections.length} corrupt</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 h-5 px-2 bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/30"
                    onClick={() => handleShowCorrections(meter.id, meter.meter_number, corrections)}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    <span className="text-xs">{corrections.length} corrected</span>
                  </Button>
                </>
              )}
              {/* Parent meters show ONLY corrected (amber) badge */}
              {corrections.length > 0 && hasChildren && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-5 px-2 bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/30"
                  onClick={() => handleShowCorrections(meter.id, meter.meter_number, corrections)}
                >
                  <AlertTriangle className="h-3 w-3" />
                  <span className="text-xs">{corrections.length} corrected</span>
                </Button>
              )}
              {parentInfo && (
                <span className="text-xs text-muted-foreground">
                  → {parentInfo}
                </span>
              )}
            </div>
            {childIds.length > 0 && (
              <span className="text-xs text-muted-foreground">
                (sum of {childIds.length} child meter{childIds.length > 1 ? 's' : ''})
              </span>
            )}
            {meter.meter_name && (
              <span className="text-xs text-muted-foreground">{meter.meter_name}</span>
            )}
            {meter.location && (
              <span className="text-xs text-muted-foreground">{meter.location}</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {((meter.hasData !== false || childIds.length > 0) && !meter.hasError) && (
              <>
                {isRevenueView ? (
                  // Revenue View - Show costs with Hierarchical vs Direct comparison
                  <div className="flex items-center gap-4">
                    {/* Hierarchical Revenue (primary) */}
                    <div className="text-right">
                      {meter.hierarchicalRevenue && !meter.hierarchicalRevenue.hasError ? (
                        <>
                          <div className="text-sm font-medium text-primary">
                            R {meter.hierarchicalRevenue.totalCost.toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Hierarchical
                          </div>
                        </>
                      ) : meterRevenue && !meterRevenue.hasError ? (
                        <>
                          <div className="text-sm font-medium text-primary">
                            R {meterRevenue.totalCost.toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Total Cost
                          </div>
                        </>
                      ) : meterRevenue?.hasError ? (
                        <>
                          <div className="text-sm font-medium text-destructive">
                            Calculation Error
                          </div>
                          <div className="text-xs text-destructive">
                            {meterRevenue.errorMessage}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-sm font-medium text-muted-foreground">
                            No tariff assigned
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Cannot calculate cost
                          </div>
                        </>
                      )}
                    </div>
                    
                    {/* Direct Revenue (comparison) - only show if different */}
                    {meter.directRevenue && !meter.directRevenue.hasError &&
                     meter.directRevenue.totalCost !== meter.hierarchicalRevenue?.totalCost && (
                      <div className="text-right border-l border-border/50 pl-4">
                        <div className="text-sm font-medium text-muted-foreground">
                          R {meter.directRevenue.totalCost.toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Direct
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  // Energy View - Show kWh with Hierarchical vs Direct comparison
                  <div className="flex items-center gap-4">
                    {/* Hierarchical values (prioritized) */}
                    <div className="text-right">
                      <div className="text-sm font-medium text-primary">
                        {(meter.hierarchicalTotalKwh !== undefined 
                          ? meter.hierarchicalTotalKwh 
                          : childIds.length > 0 
                            ? hierarchicalTotal 
                            : meter.totalKwh
                        ).toFixed(2)} kWh
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {meter.hierarchicalTotalKwh !== undefined || childIds.length > 0
                          ? 'Hierarchical'
                          : `${meter.readingsCount} readings`
                        }
                      </div>
                    </div>
                    
                    {/* Direct values (from uploaded/parsed CSV) - only show if different */}
                    {(meter.directTotalKwh !== undefined && 
                      meter.directTotalKwh !== meter.hierarchicalTotalKwh) && (
                      <div className="text-right border-l border-border/50 pl-4">
                        <div className="text-sm font-medium text-muted-foreground">
                          {meter.directTotalKwh.toFixed(2)} kWh
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Direct ({meter.directReadingsCount || meter.readingsCount} readings)
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {!isRevenueView && showDownloadButtons && onDownloadMeter && (
                  <CsvDownloadButton
                    meter={meter}
                    csvFiles={meterCsvFiles.get(meter.id)}
                    onDownloadOnTheFly={() => onDownloadMeter(meter)}
                    onDownloadFromStorage={onDownloadMeterCsvFile}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {isRevenueView && (meter.hierarchicalRevenue || meter.directRevenue || meterRevenue) && (
          <div className="pt-2 border-t border-border/50 space-y-2">
            {/* Hierarchical Revenue Details */}
            {meter.hierarchicalRevenue && !meter.hierarchicalRevenue.hasError && (
              <div>
                <div className="text-xs font-medium text-primary mb-1">Hierarchical:</div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div className="text-xs">
                    <span className="text-muted-foreground">Tariff: </span>
                    <span className="font-medium text-primary">{meter.hierarchicalRevenue.tariffName}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Energy Cost: </span>
                    <span className="font-medium text-primary">R {meter.hierarchicalRevenue.energyCost.toFixed(2)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Fixed Charges: </span>
                    <span className="font-medium text-primary">R {meter.hierarchicalRevenue.fixedCharges.toFixed(2)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Demand Charges: </span>
                    <span className="font-medium text-primary">R {meter.hierarchicalRevenue.demandCharges.toFixed(2)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Avg Cost/kWh: </span>
                    <span className="font-medium text-primary">R {meter.hierarchicalRevenue.avgCostPerKwh.toFixed(4)}</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Direct Revenue Details */}
            {meter.directRevenue && !meter.directRevenue.hasError && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Direct:</div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div className="text-xs">
                    <span className="text-muted-foreground">Tariff: </span>
                    <span className="font-medium">{meter.directRevenue.tariffName}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Energy Cost: </span>
                    <span className="font-medium">R {meter.directRevenue.energyCost.toFixed(2)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Fixed Charges: </span>
                    <span className="font-medium">R {meter.directRevenue.fixedCharges.toFixed(2)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Demand Charges: </span>
                    <span className="font-medium">R {meter.directRevenue.demandCharges.toFixed(2)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Avg Cost/kWh: </span>
                    <span className="font-medium">R {meter.directRevenue.avgCostPerKwh.toFixed(4)}</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Fallback to meterRevenue if no direct/hierarchical */}
            {!meter.hierarchicalRevenue && !meter.directRevenue && meterRevenue && !meterRevenue.hasError && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="text-xs">
                  <span className="text-muted-foreground">Tariff: </span>
                  <span className="font-medium">{meterRevenue.tariffName}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Energy Cost: </span>
                  <span className="font-medium">R {meterRevenue.energyCost.toFixed(2)}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Fixed Charges: </span>
                  <span className="font-medium">R {meterRevenue.fixedCharges.toFixed(2)}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Demand Charges: </span>
                  <span className="font-medium">R {meterRevenue.demandCharges.toFixed(2)}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Avg Cost/kWh: </span>
                  <span className="font-medium">R {meterRevenue.avgCostPerKwh.toFixed(4)}</span>
                </div>
              </div>
            )}
            
            {/* Error display */}
            {(meter.hierarchicalRevenue?.hasError || meter.directRevenue?.hasError || meterRevenue?.hasError) && (
              <div className="text-xs text-destructive">
                {meter.hierarchicalRevenue?.errorMessage || meter.directRevenue?.errorMessage || meterRevenue?.errorMessage}
              </div>
            )}
          </div>
        )}

        {/* Column values display - Energy View */}
        {!isRevenueView && (meter.columnTotals || meter.columnMaxValues || meter.hierarchicalColumnTotals || meter.directColumnTotals) && (
          <div className="pt-2 border-t border-border/50 space-y-2">
            {/* Hierarchical values (primary) */}
            {(meter.hierarchicalColumnTotals || meter.hierarchicalColumnMaxValues) && (
              <div>
                <div className="text-xs font-medium text-primary mb-1">Hierarchical:</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {meter.hierarchicalColumnTotals && Object.entries(meter.hierarchicalColumnTotals).map(([key, value]) => (
                    <div key={`hier-tot-${key}`} className="text-xs">
                      <span className="text-muted-foreground">{key}: </span>
                      <span className="font-medium text-primary">{value.toFixed(2)}</span>
                    </div>
                  ))}
                  {meter.hierarchicalColumnMaxValues && Object.entries(meter.hierarchicalColumnMaxValues).map(([key, value]) => (
                    <div key={`hier-max-${key}`} className="text-xs">
                      <span className="text-muted-foreground">{key} (max): </span>
                      <span className="font-medium text-primary">{value.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Direct values (comparison) */}
            {(meter.directColumnTotals || meter.directColumnMaxValues) && 
             (meter.hierarchicalColumnTotals || meter.hierarchicalColumnMaxValues) && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Direct:</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {meter.directColumnTotals && Object.entries(meter.directColumnTotals).map(([key, value]) => (
                    <div key={`dir-tot-${key}`} className="text-xs">
                      <span className="text-muted-foreground">{key}: </span>
                      <span className="font-medium">{value.toFixed(2)}</span>
                    </div>
                  ))}
                  {meter.directColumnMaxValues && Object.entries(meter.directColumnMaxValues).map(([key, value]) => (
                    <div key={`dir-max-${key}`} className="text-xs">
                      <span className="text-muted-foreground">{key}: </span>
                      <span className="font-medium">{value.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Single set of values (leaf meters or meters without hierarchical data) */}
            {!(meter.hierarchicalColumnTotals || meter.hierarchicalColumnMaxValues) && (meter.columnTotals || meter.columnMaxValues) && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {meter.columnTotals && Object.entries(meter.columnTotals)
                  .filter(([key]) => !meter.columnMaxValues?.[key])
                  .map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <span className="text-muted-foreground">{key}: </span>
                    <span className="font-medium">{value.toFixed(2)}</span>
                  </div>
                ))}
                {meter.columnMaxValues && Object.entries(meter.columnMaxValues).map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <span className="text-muted-foreground">{key}: </span>
                    <span className="font-medium">{value.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {showSaveButton && isBulkMode && bulkSelectedCount > 0 && (
        <Button
          onClick={onBulkReconcile}
          disabled={isBulkProcessing || bulkSelectedCount === 0}
          variant="outline"
          className="w-full h-12 gap-2 bg-muted text-foreground hover:bg-muted/80 font-semibold"
        >
          {isBulkProcessing ? (
            <div className="flex flex-col items-center gap-1 w-full">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processing {bulkProgress.current}/{bulkProgress.total}</span>
              </div>
              <span className="text-xs text-muted-foreground truncate max-w-full">
                {bulkProgress.currentDocument}
              </span>
            </div>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Run & Save {bulkSelectedCount} Reconciliation{bulkSelectedCount > 1 ? 's' : ''}
            </>
          )}
        </Button>
      )}
      
      <Tabs defaultValue="energy" className="w-full">
        <TabsList className={cn(
          "grid w-full h-auto p-1 gap-2 bg-transparent",
          isSavedRun ? "grid-cols-2" : "grid-cols-3"
        )}>
          {!isSavedRun && (
            <TabsTrigger 
              value="hierarchy" 
              onClick={handleHierarchyTabClick}
              disabled={!canReconcile || isLoadingEnergy || isLoadingRevenue}
              className="gap-2 h-12 bg-muted text-foreground hover:bg-muted/80 data-[state=active]:bg-muted/90 data-[state=active]:text-foreground data-[state=active]:shadow-md disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
            >
              {isGeneratingHierarchy ? (
                <>
                  {isCancelling ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  <span>
                    {isCancelling 
                      ? 'Cancelling...' 
                      : `Generating... ${csvGenerationProgress.current}/${csvGenerationProgress.total}`
                    }
                  </span>
                </>
              ) : hierarchyGenerated ? (
                <>
                  <GitBranch className="h-4 w-4" />
                  <span>Hierarchy</span>
                </>
              ) : (
                <>
                  <GitBranch className="h-4 w-4" />
                  <span>Generate Hierarchy</span>
                </>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger 
            value="energy" 
            onClick={handleEnergyTabClick}
            disabled={!canReconcile || isLoadingRevenue || isGeneratingHierarchy}
            className="gap-2 h-12 bg-muted text-foreground hover:bg-muted/80 data-[state=active]:bg-muted/90 data-[state=active]:text-foreground data-[state=active]:shadow-md disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {isLoadingEnergy ? (
              <>
                {isGeneratingCsvs ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                <span>
                  {isCancelling 
                    ? 'Cancelling...' 
                    : isGeneratingCsvs 
                      ? `Generating profiles... ${csvGenerationProgress.current}/${csvGenerationProgress.total}`
                      : `Cancel Analyzing... ${energyProgress.current}/${energyProgress.total}`
                  }
                </span>
              </>
            ) : meters && meters.length > 0 ? (
              <>
                <Zap className="h-4 w-4" />
                <span>Energy</span>
              </>
            ) : (
              <>
                <Calculator className="h-4 w-4" />
                <span>Calculate Energy</span>
              </>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="revenue" 
            onClick={handleRevenueTabClick}
            disabled={!canReconcile || isLoadingEnergy || isGeneratingHierarchy}
            className="gap-2 h-12 bg-muted text-foreground hover:bg-muted/80 data-[state=active]:bg-muted/90 data-[state=active]:text-foreground data-[state=active]:shadow-md disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {isLoadingRevenue ? (
              <>
                <X className="h-4 w-4" />
                <span>{isCancelling ? 'Cancelling...' : `Cancel Calculating... ${revenueProgress.current}/${revenueProgress.total}`}</span>
              </>
            ) : revenueData ? (
              <>
                <DollarSign className="h-4 w-4" />
                <span>Revenue</span>
              </>
            ) : (
              <>
                <Calculator className="h-4 w-4" />
                <span>Calculate Revenue</span>
              </>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Energy Reconciliation Tab */}
        <TabsContent value="energy" className="space-y-6">
          {meters && meters.length > 0 && (
          <>
          {(() => {
            // Calculate common area kWh (other type meters)
            const commonAreaKwh = meters
              .filter(meter => meter.meter_type === "other")
              .reduce((sum, meter) => sum + (meter.totalKwh || 0), 0);
            
            // Calculate unaccounted loss (Total Supply - Metered Consumption - Common Area)
            const unaccountedLoss = totalSupply - distributionTotal - commonAreaKwh;
            
            return (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Grid Supply
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Grid</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {bulkTotal.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {totalSupply > 0 
                    ? ((bulkTotal / totalSupply) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Solar Energy
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Solar</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {solarTotal.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {totalSupply > 0 
                    ? ((solarTotal / totalSupply) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Supply
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Grid + Solar</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {totalSupply.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  100.00%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Metered Consumption
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Tenants</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {distributionTotal.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {totalSupply > 0 
                    ? ((distributionTotal / totalSupply) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Common Area
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Other Meters</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  {commonAreaKwh.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {totalSupply > 0 
                    ? ((commonAreaKwh / totalSupply) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Unaccounted Loss
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Unexplained</div>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "text-2xl font-bold",
                    unaccountedLoss > 0 ? "text-destructive" : "text-accent"
                  )}
                >
                  {unaccountedLoss.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {totalSupply > 0 
                    ? ((Math.abs(unaccountedLoss) / totalSupply) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>
          </div>
            );
          })()}

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Detailed Breakdown - Energy</CardTitle>
              <CardDescription>Meter-by-meter consumption analysis</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                {meters.filter(m => isMeterVisible(m.id)).map(meter => renderMeterRow(meter, false))}
              </div>
            </CardContent>
          </Card>
          </>
          )}
        </TabsContent>

        {/* Revenue Reconciliation Tab */}
        <TabsContent value="revenue" className="space-y-6">
          {revenueData && (
            <>
              {(() => {
                const totalSupplyCost = revenueData.gridSupplyCost + revenueData.solarCost;
                
                // Calculate common area cost (other type meters)
                const commonAreaCost = meters
                  .filter(meter => meter.meter_type === "other")
                  .reduce((sum, meter) => {
                    const meterRevenue = revenueData.meterRevenues.get(meter.id);
                    return sum + (meterRevenue?.totalCost || 0);
                  }, 0);
                
                // Calculate unaccounted revenue (Total Supply Cost - Metered Revenue - Common Area Cost)
                const unaccountedRevenue = totalSupplyCost - revenueData.tenantCost - commonAreaCost;
                
                return (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Grid Supply Cost
                    </CardTitle>
                    <div className="text-xs text-muted-foreground mt-1">Grid</div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      R {revenueData.gridSupplyCost.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {totalSupplyCost > 0 
                        ? ((revenueData.gridSupplyCost / totalSupplyCost) * 100).toFixed(2) 
                        : '0.00'}%
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Solar Cost
                    </CardTitle>
                    <div className="text-xs text-muted-foreground mt-1">Solar</div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      R {revenueData.solarCost.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {totalSupplyCost > 0 
                        ? ((revenueData.solarCost / totalSupplyCost) * 100).toFixed(2) 
                        : '0.00'}%
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50 bg-primary/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total Supply Cost
                    </CardTitle>
                    <div className="text-xs text-muted-foreground mt-1">Grid + Solar</div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-primary">
                      R {totalSupplyCost.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      100.00%
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Metered Revenue
                    </CardTitle>
                    <div className="text-xs text-muted-foreground mt-1">Tenants</div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      R {revenueData.tenantCost.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {totalSupplyCost > 0 
                        ? ((revenueData.tenantCost / totalSupplyCost) * 100).toFixed(2) 
                        : '0.00'}%
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Common Area Cost
                    </CardTitle>
                    <div className="text-xs text-muted-foreground mt-1">Other Meters</div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      R {commonAreaCost.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {totalSupplyCost > 0 
                        ? ((commonAreaCost / totalSupplyCost) * 100).toFixed(2) 
                        : '0.00'}%
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Unaccounted Revenue
                    </CardTitle>
                    <div className="text-xs text-muted-foreground mt-1">Unexplained</div>
                  </CardHeader>
                  <CardContent>
                    <div className={cn(
                      "text-2xl font-bold",
                      unaccountedRevenue > 0 ? "text-destructive" : "text-accent"
                    )}>
                      R {unaccountedRevenue.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {totalSupplyCost > 0 
                        ? ((Math.abs(unaccountedRevenue) / totalSupplyCost) * 100).toFixed(2) 
                        : '0.00'}%
                    </div>
                  </CardContent>
                </Card>
              </div>
                );
              })()}

              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle>Detailed Breakdown - Revenue</CardTitle>
                  <CardDescription>Meter-by-meter cost analysis</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    {meters.filter(m => isMeterVisible(m.id)).map(meter => renderMeterRow(meter, true))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
      
      {/* Corrections Dialog */}
      {selectedMeterForCorrections && (
        <CorrectionsDialog
          isOpen={correctionsDialogOpen}
          onClose={() => {
            setCorrectionsDialogOpen(false);
            setSelectedMeterForCorrections(null);
          }}
          meterNumber={selectedMeterForCorrections.meterNumber}
          corrections={selectedMeterForCorrections.corrections}
        />
      )}
    </div>
  );
}
