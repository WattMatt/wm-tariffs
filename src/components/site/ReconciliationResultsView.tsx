import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileDown, Download, ChevronRight, Save, Loader2, Zap, Calculator, DollarSign, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  // Revenue fields
  tariffName?: string;
  energyCost?: number;
  fixedCharges?: number;
  totalCost?: number;
  avgCostPerKwh?: number;
  costCalculationError?: string;
}

interface RevenueData {
  meterRevenues: Map<string, {
    energyCost: number;
    fixedCharges: number;
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
  onDownloadAll?: () => void;
  onSave?: () => void;
  showSaveButton?: boolean;
  revenueData?: RevenueData | null;
  onReconcileEnergy?: () => void;
  onReconcileRevenue?: () => void;
  onCancelReconciliation?: () => void;
  isLoadingEnergy?: boolean;
  isLoadingRevenue?: boolean;
  energyProgress?: { current: number; total: number };
  revenueProgress?: { current: number; total: number };
  hasPreviewData?: boolean;
  canReconcile?: boolean;
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
  onDownloadAll,
  onSave,
  showSaveButton = false,
  revenueData = null,
  onReconcileEnergy,
  onReconcileRevenue,
  onCancelReconciliation,
  isLoadingEnergy = false,
  isLoadingRevenue = false,
  energyProgress = { current: 0, total: 0 },
  revenueProgress = { current: 0, total: 0 },
  hasPreviewData = false,
  canReconcile = false,
}: ReconciliationResultsViewProps) {
  const [expandedMeters, setExpandedMeters] = useState<Set<string>>(new Set());

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
    // Find all parent IDs
    let parentIds: string[] = [];
    for (const [parentId, childIds] of meterConnections.entries()) {
      if (childIds.includes(meterId)) {
        parentIds.push(parentId);
      }
    }

    // If no parent, it's a top-level meter, always visible
    if (parentIds.length === 0) return true;

    // Check if all parents are expanded
    return parentIds.every((parentId) => expandedMeters.has(parentId));
  };

  const renderMeterRow = (meter: MeterData, isRevenueView: boolean = false) => {
    const childIds = meterConnections.get(meter.id) || [];
    let hierarchicalTotal = 0;
    
    if (childIds.length > 0) {
      const getLeafMeterSum = (meterId: string): number => {
        const children = meterConnections.get(meterId) || [];
        
        if (children.length === 0) {
          const meterData = meters.find((m: any) => m.id === meterId);
          const isSolar = meterAssignments.get(meterId) === "solar_energy";
          const value = meterData?.totalKwh || 0;
          return isSolar ? -value : value;
        }
        
        return children.reduce((sum, childId) => {
          return sum + getLeafMeterSum(childId);
        }, 0);
      };
      
      hierarchicalTotal = childIds.reduce((sum, childId) => {
        return sum + getLeafMeterSum(childId);
      }, 0);
    }
    
    const indentLevel = meterIndentLevels.get(meter.id) || 0;
    const marginLeft = indentLevel * 24;
    const parentInfo = meterParentInfo.get(meter.id);
    
    const hasChildren = childIds.length > 0;
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
            {meter.hasData !== false && !meter.hasError && (
              <>
                {isRevenueView ? (
                  // Revenue View - Show only costs
                  <div className="text-right">
                    {meterRevenue && !meterRevenue.hasError ? (
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
                ) : (
                  // Energy View - Show kWh
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      {childIds.length > 0 ? hierarchicalTotal.toFixed(2) : meter.totalKwh.toFixed(2)} kWh
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {childIds.length > 0 
                        ? `(sum of ${childIds.length} child meter${childIds.length > 1 ? 's' : ''})`
                        : `${meter.readingsCount} readings`
                      }
                    </div>
                    {childIds.length > 0 && meter.totalKwh > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Direct: {meter.totalKwh.toFixed(2)} kWh
                      </div>
                    )}
                  </div>
                )}
                {!isRevenueView && showDownloadButtons && onDownloadMeter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 h-8"
                    onClick={() => onDownloadMeter(meter)}
                  >
                    <FileDown className="w-3 h-3" />
                    CSV
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {isRevenueView && meterRevenue && !meterRevenue.hasError && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-border/50">
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
              <span className="text-muted-foreground">Avg Cost/kWh: </span>
              <span className="font-medium">R {meterRevenue.avgCostPerKwh.toFixed(4)}</span>
            </div>
          </div>
        )}
        
        {isRevenueView && meterRevenue?.hasError && (
          <div className="pt-2 border-t border-border/50">
            <div className="text-xs text-destructive">
              {meterRevenue.errorMessage}
            </div>
          </div>
        )}

        {!isRevenueView && (meter.columnTotals || meter.columnMaxValues) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-border/50">
            {meter.columnTotals && Object.entries(meter.columnTotals).map(([key, value]) => (
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
    );
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="energy" className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-auto p-1 gap-2 bg-transparent">
          <TabsTrigger 
            value="energy" 
            onClick={() => {
              if (!meters || meters.length === 0) {
                onReconcileEnergy?.();
              }
            }}
            disabled={!canReconcile || isLoadingEnergy || isLoadingRevenue}
            className="gap-2 h-12 bg-muted text-foreground hover:bg-muted/80 data-[state=active]:bg-muted/90 data-[state=active]:text-foreground data-[state=active]:shadow-md disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {isLoadingEnergy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Analyzing... {energyProgress.current}/{energyProgress.total}</span>
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
          {(isLoadingEnergy || isLoadingRevenue) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancelReconciliation}
              className="ml-2 text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          )}
          <TabsTrigger
            value="revenue" 
            onClick={() => {
              if (!revenueData) {
                onReconcileRevenue?.();
              }
            }}
            disabled={!canReconcile || isLoadingEnergy || isLoadingRevenue}
            className="gap-2 h-12 bg-muted text-foreground hover:bg-muted/80 data-[state=active]:bg-muted/90 data-[state=active]:text-foreground data-[state=active]:shadow-md disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {isLoadingRevenue ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Calculating... {revenueProgress.current}/{revenueProgress.total}</span>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
                <div className="text-xs text-muted-foreground mt-1">Distribution</div>
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
                  Unmetered Loss
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Discrepancy</div>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "text-2xl font-bold",
                    discrepancy > 0 ? "text-warning" : "text-accent"
                  )}
                >
                  {discrepancy.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {totalSupply > 0 
                    ? ((Math.abs(discrepancy) / totalSupply) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>
          </div>

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
                
                // Calculate total revenue lost (other type meters)
                const totalRevenueLost = meters
                  .filter(meter => {
                    return meter.meter_type === "other";
                  })
                  .reduce((sum, meter) => {
                    const meterRevenue = revenueData.meterRevenues.get(meter.id);
                    return sum + (meterRevenue?.totalCost || 0);
                  }, 0);
                
                return (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
                    <div className="text-xs text-muted-foreground mt-1">Distribution</div>
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
                      Total Revenue Lost
                    </CardTitle>
                    <div className="text-xs text-muted-foreground mt-1">Other Meters</div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-warning">
                      R {totalRevenueLost.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {totalSupplyCost > 0 
                        ? ((totalRevenueLost / totalSupplyCost) * 100).toFixed(2) 
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
    </div>
  );
}
