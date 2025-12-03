import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, ChevronLeft, Save, RotateCcw, ArrowRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface MeterWithData {
  id: string;
  meter_number: string;
  meter_type: string;
  hasData?: boolean;
}

interface MeterHierarchyListProps {
  availableMeters: MeterWithData[];
  meterIndentLevels: Map<string, number>;
  meterParentInfo: Map<string, string>;
  meterAssignments: Map<string, string>;
  selectedMetersForSummation: Set<string>;
  sortColumn: 'meter' | 'grid' | 'solar' | 'status' | null;
  sortDirection: 'asc' | 'desc';
  isOpen: boolean;
  hasMeterChangesUnsaved: boolean;
  draggedMeterId: string | null;
  dragOverMeterId: string | null;
  onOpenChange: (open: boolean) => void;
  onMeterIndentLevelsChange: (levels: Map<string, number>) => void;
  onMeterAssignmentsChange: (assignments: Map<string, string>) => void;
  onSelectedMetersChange: (selected: Set<string>) => void;
  onSortColumnChange: (column: 'meter' | 'grid' | 'solar' | 'status') => void;
  onSortDirectionChange: (direction: 'asc' | 'desc') => void;
  onSaveIndentLevels: (levels: Map<string, number>) => void;
  onSaveMeterSettings: () => void;
  onResetHierarchy: () => void;
  onMetersReorder: (meters: MeterWithData[]) => void;
  onDraggedMeterIdChange: (id: string | null) => void;
  onDragOverMeterIdChange: (id: string | null) => void;
}

export function MeterHierarchyList({
  availableMeters,
  meterIndentLevels,
  meterParentInfo,
  meterAssignments,
  selectedMetersForSummation,
  sortColumn,
  sortDirection,
  isOpen,
  hasMeterChangesUnsaved,
  draggedMeterId,
  dragOverMeterId,
  onOpenChange,
  onMeterIndentLevelsChange,
  onMeterAssignmentsChange,
  onSelectedMetersChange,
  onSortColumnChange,
  onSortDirectionChange,
  onSaveIndentLevels,
  onSaveMeterSettings,
  onResetHierarchy,
  onMetersReorder,
  onDraggedMeterIdChange,
  onDragOverMeterIdChange,
}: MeterHierarchyListProps) {
  
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onSelectedMetersChange(new Set(availableMeters.map(m => m.id)));
    } else {
      onSelectedMetersChange(new Set());
    }
  };

  const handleBatchOutdent = () => {
    if (selectedMetersForSummation.size > 0) {
      const newLevels = new Map(meterIndentLevels);
      selectedMetersForSummation.forEach(meterId => {
        const currentLevel = newLevels.get(meterId) || 0;
        if (currentLevel > 0) {
          newLevels.set(meterId, currentLevel - 1);
        }
      });
      onMeterIndentLevelsChange(newLevels);
      onSaveIndentLevels(newLevels);
    }
  };

  const handleBatchIndent = () => {
    if (selectedMetersForSummation.size > 0) {
      const newLevels = new Map(meterIndentLevels);
      selectedMetersForSummation.forEach(meterId => {
        const currentLevel = newLevels.get(meterId) || 0;
        if (currentLevel < 6) {
          newLevels.set(meterId, currentLevel + 1);
        }
      });
      onMeterIndentLevelsChange(newLevels);
      onSaveIndentLevels(newLevels);
    }
  };

  const handleIndentMeter = (meterId: string) => {
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
    onMeterIndentLevelsChange(newLevels);
    onSaveIndentLevels(newLevels);
  };

  const handleOutdentMeter = (meterId: string) => {
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
    onMeterIndentLevelsChange(newLevels);
    onSaveIndentLevels(newLevels);
  };

  const handleSortClick = (column: 'meter' | 'grid' | 'solar' | 'status') => {
    if (sortColumn === column) {
      onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      onSortColumnChange(column);
      onSortDirectionChange('asc');
    }
  };

  const handleDragStart = (e: React.DragEvent, meterId: string) => {
    onDraggedMeterIdChange(meterId);
    e.dataTransfer.effectAllowed = "move";
    if (selectedMetersForSummation.has(meterId) && selectedMetersForSummation.size > 1) {
      e.dataTransfer.setData("text/plain", `${selectedMetersForSummation.size} meters`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragEnter = (meterId: string) => {
    onDragOverMeterIdChange(meterId);
  };

  const handleDragLeave = () => {
    onDragOverMeterIdChange(null);
  };

  const handleDrop = (e: React.DragEvent, targetMeterId: string) => {
    e.preventDefault();
    
    if (!draggedMeterId || draggedMeterId === targetMeterId) {
      onDraggedMeterIdChange(null);
      onDragOverMeterIdChange(null);
      return;
    }

    const targetIndex = availableMeters.findIndex(m => m.id === targetMeterId);
    if (targetIndex === -1) {
      onDraggedMeterIdChange(null);
      onDragOverMeterIdChange(null);
      return;
    }

    const isDraggingMultiple = selectedMetersForSummation.has(draggedMeterId) && selectedMetersForSummation.size > 1;
    
    if (isDraggingMultiple) {
      const nonSelectedMeters = availableMeters.filter(m => !selectedMetersForSummation.has(m.id));
      const selectedMeters = availableMeters.filter(m => selectedMetersForSummation.has(m.id));
      const newMeters = [...nonSelectedMeters];
      const insertIndex = newMeters.findIndex(m => m.id === targetMeterId);
      
      if (insertIndex !== -1) {
        newMeters.splice(insertIndex, 0, ...selectedMeters);
      } else {
        newMeters.push(...selectedMeters);
      }
      onMetersReorder(newMeters);
    } else {
      const draggedIndex = availableMeters.findIndex(m => m.id === draggedMeterId);
      if (draggedIndex === -1) {
        onDraggedMeterIdChange(null);
        onDragOverMeterIdChange(null);
        return;
      }

      const newMeters = [...availableMeters];
      const [removed] = newMeters.splice(draggedIndex, 1);
      newMeters.splice(targetIndex, 0, removed);
      onMetersReorder(newMeters);
    }
    
    onDraggedMeterIdChange(null);
    onDragOverMeterIdChange(null);
  };

  const handleDragEnd = () => {
    onDraggedMeterIdChange(null);
    onDragOverMeterIdChange(null);
  };

  // Sort meters
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

  const canBatchOutdent = selectedMetersForSummation.size > 0 && 
    !Array.from(selectedMetersForSummation).every(id => (meterIndentLevels.get(id) || 0) === 0);
  const canBatchIndent = selectedMetersForSummation.size > 0 && 
    !Array.from(selectedMetersForSummation).every(id => (meterIndentLevels.get(id) || 0) === 6);

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
        <div className="flex items-center justify-between w-full mb-3">
          <CollapsibleTrigger className="flex items-center gap-2 flex-1 hover:underline cursor-pointer">
            <div className="flex flex-col items-start gap-1">
              <Label className="text-sm font-semibold cursor-pointer">Meters Associated with This Site</Label>
              <span className="text-xs text-muted-foreground font-normal">Select multiple meters and drag to reorder or use indent buttons</span>
            </div>
          </CollapsibleTrigger>
          <div className="flex items-center gap-2">
            <Button
              variant={hasMeterChangesUnsaved ? "default" : "outline"}
              size="sm"
              className="h-7"
              disabled={!hasMeterChangesUnsaved}
              onClick={onSaveMeterSettings}
            >
              <Save className="h-3 w-3 mr-1" />
              Save
            </Button>
            <CollapsibleTrigger className="p-1 hover:bg-accent rounded">
              <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
            </CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent>
          {/* Column Headers */}
          <div className="flex items-center gap-2 mb-2 pb-2 border-b">
            <div className="w-6 flex items-center justify-start">
              <Checkbox
                checked={availableMeters.length > 0 && selectedMetersForSummation.size === availableMeters.length}
                onCheckedChange={handleSelectAll}
              />
            </div>
            <div className="flex-1 flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={!canBatchOutdent}
                  onClick={handleBatchOutdent}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={!canBatchIndent}
                  onClick={handleBatchIndent}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 ml-2"
                  onClick={onResetHierarchy}
                  title="Reset hierarchy to database defaults"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              </div>
              <div className="flex-1 flex items-center justify-between p-3">
                <button 
                  onClick={() => handleSortClick('meter')}
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
                    onClick={() => handleSortClick('grid')}
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
                    onClick={() => handleSortClick('solar')}
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
                    onClick={() => handleSortClick('status')}
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
          
          {/* Meter List */}
          <div className="space-y-2">
            {availableMeters.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">No meters found for this site</div>
            ) : (
              sortedMeters.map((meter) => {
                const indentLevel = meterIndentLevels.get(meter.id) || 0;
                const contentMarginLeft = indentLevel * 24;
                const isDragging = draggedMeterId === meter.id;
                const isDragOver = dragOverMeterId === meter.id;
                const parentInfo = meterParentInfo.get(meter.id);
                
                return (
                  <div key={meter.id} className="flex items-center gap-2">
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
                          onSelectedMetersChange(newSelected);
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
                                onMeterAssignmentsChange(newAssignments);
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
                                onMeterAssignmentsChange(newAssignments);
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
  );
}
