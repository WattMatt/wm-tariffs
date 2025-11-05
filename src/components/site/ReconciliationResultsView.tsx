import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileDown, Download, ChevronRight, Save } from "lucide-react";
import { cn } from "@/lib/utils";

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

  return (
    <div className="space-y-6">
      {/* Energy Reconciliation Title */}
      <div>
        <h3 className="text-xl font-semibold">Energy Reconciliation Results</h3>
        <p className="text-sm text-muted-foreground">Energy consumption analysis</p>
      </div>

      {/* Energy Summary Cards */}
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

      {/* Revenue Reconciliation Results */}
      {revenueData && (
        <>
          <div className="mt-8">
            <h3 className="text-xl font-semibold">Revenue Reconciliation Results</h3>
            <p className="text-sm text-muted-foreground">Cost analysis based on assigned tariffs</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Grid Supply Cost
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Grid</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">
                  R {revenueData.gridSupplyCost.toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {revenueData.totalRevenue > 0 
                    ? ((revenueData.gridSupplyCost / revenueData.totalRevenue) * 100).toFixed(2) 
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
                  {revenueData.totalRevenue > 0 
                    ? ((revenueData.solarCost / revenueData.totalRevenue) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-warning/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Supply Cost
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Grid + Solar</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">
                  R {(revenueData.gridSupplyCost + revenueData.solarCost).toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Supply Cost
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
                  {revenueData.totalRevenue > 0 
                    ? ((revenueData.tenantCost / revenueData.totalRevenue) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-primary/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg Cost/kWh
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Weighted Average</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  R {revenueData.avgCostPerKwh.toFixed(4)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  per kWh
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Detailed Breakdown */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Detailed Breakdown</CardTitle>
            <CardDescription>Meter-by-meter consumption analysis</CardDescription>
          </div>
          {(showSaveButton || showDownloadButtons) && (
            <div className="flex gap-2">
              {showSaveButton && onSave && (
                <Button variant="outline" className="gap-2" onClick={onSave}>
                  <Save className="w-4 h-4" />
                  Save Results
                </Button>
              )}
              {showDownloadButtons && onDownloadAll && (
                <Button variant="outline" className="gap-2" onClick={onDownloadAll}>
                  <Download className="w-4 h-4" />
                  Download All Meters
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            {meters.filter(m => isMeterVisible(m.id)).map(meter => {
              // Calculate hierarchical total if this meter has children
              const childIds = meterConnections.get(meter.id) || [];
              let hierarchicalTotal = 0;
              
              // Calculate summation by only counting leaf meters (no double-counting parents)
              if (childIds.length > 0) {
                const getLeafMeterSum = (meterId: string): number => {
                  const children = meterConnections.get(meterId) || [];
                  
                  // If this meter has no children, it's a leaf - return its value
                  if (children.length === 0) {
                    const meterData = meters.find((m: any) => m.id === meterId);
                    const isSolar = meterAssignments.get(meterId) === "solar_energy";
                    const value = meterData?.totalKwh || 0;
                    // Solar meters subtract from the total instead of adding
                    return isSolar ? -value : value;
                  }
                  
                  // If this meter has children, recursively sum only its leaf descendants
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
              
              // Determine meter type for color coding
              const meterAssignment = meterAssignments.get(meter.id) || meter.assignment;
              let bgColor = "bg-muted/50"; // Default for distribution meters
              let borderColor = "border-border/50";
              
              if (meterAssignment === "grid_supply") {
                bgColor = "bg-primary/10";
                borderColor = "border-primary/30";
              } else if (meterAssignment === "solar_energy") {
                bgColor = "bg-yellow-500/10";
                borderColor = "border-yellow-500/30";
              }
              
              // If meter has no data, use muted styling
              // If meter has error, use destructive styling
              if (meter.hasError) {
                bgColor = "bg-destructive/10";
                borderColor = "border-destructive/30";
              } else if (meter.hasData === false) {
                bgColor = "bg-muted/20";
                borderColor = "border-muted/30";
              }
              
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
                        {meter.hasData === false && !meter.hasError && (
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
                    </div>
                    <div className="flex items-center gap-4">
                      {childIds.length > 0 && (
                        <div className="flex flex-col items-end">
                          <span className="font-semibold text-primary">{hierarchicalTotal.toFixed(2)} kWh</span>
                          <span className="text-xs text-muted-foreground">Summation</span>
                        </div>
                      )}
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-2">
                          <span className={cn("font-semibold", meter.hasData === false && "text-muted-foreground")}>
                            {meter.totalKwh.toFixed(2)} kWh
                          </span>
                          {childIds.length > 0 && hierarchicalTotal > 0 && meter.hasData !== false && (
                            <Badge variant={Math.abs((meter.totalKwh / hierarchicalTotal) * 100 - 100) > 10 ? "destructive" : "secondary"} className="text-xs">
                              {((meter.totalKwh / hierarchicalTotal) * 100).toFixed(1)}%
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">Actual</span>
                      </div>
                      {showDownloadButtons && meter.hasData !== false && onDownloadMeter && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDownloadMeter(meter)}
                          className="h-7 w-7 p-0"
                          title={`Download ${meter.readingsCount} readings`}
                        >
                          <FileDown className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {meter.hasData !== false && ((meter.columnTotals && Object.keys(meter.columnTotals).length > 0) || 
                    (meter.columnMaxValues && Object.keys(meter.columnMaxValues).length > 0)) && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                      {Object.entries(meter.columnTotals || {}).map(([col, val]: [string, any]) => (
                        <div key={col} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{col}:</span>
                          <span className="font-mono">{Number(val).toFixed(2)}</span>
                        </div>
                      ))}
                      {Object.entries(meter.columnMaxValues || {}).map(([col, val]: [string, any]) => (
                        <div key={col} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{col} (Max):</span>
                          <span className="font-mono font-semibold">{Number(val).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Revenue Data */}
                  {revenueData && revenueData.meterRevenues.has(meter.id) && (
                    <div className="pt-2 border-t border-primary/20 bg-primary/5 -m-3 mt-2 p-3 rounded-b-lg">
                      {(() => {
                        const costInfo = revenueData.meterRevenues.get(meter.id);
                        if (!costInfo) return null;
                        
                        if (costInfo.hasError) {
                          return (
                            <div className="flex items-center gap-2 text-xs text-destructive">
                              <Badge variant="destructive" className="text-xs">Cost Calculation Error</Badge>
                              <span>{costInfo.errorMessage || 'Failed to calculate'}</span>
                            </div>
                          );
                        }
                        
                        return (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-primary">Revenue Breakdown</span>
                              <Badge variant="outline" className="text-xs">{costInfo.tariffName}</Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Energy Cost:</span>
                                <span className="font-mono font-semibold text-warning">R {costInfo.energyCost.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Fixed Charges:</span>
                                <span className="font-mono">R {costInfo.fixedCharges.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Total Cost:</span>
                                <span className="font-mono font-semibold text-primary">R {costInfo.totalCost.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Avg/kWh:</span>
                                <span className="font-mono">R {costInfo.avgCostPerKwh.toFixed(4)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
