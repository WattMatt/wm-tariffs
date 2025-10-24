import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, GripVertical } from "lucide-react";

interface EnergyBlock {
  blockNumber: number;
  kwhFrom: number;
  kwhTo: number | null;
  energyChargeCents: number;
}

interface SeasonalCharge {
  season: string;
  rate: number;
  unit: string;
}

interface TouSeason {
  season: string;
  peak: number;
  standard: number;
  offPeak: number;
}

interface BasicCharge {
  amount: number;
  unit: string;
}

interface DemandCharge {
  season: string;
  rate: number;
  unit: string;
}

interface TariffData {
  tariffName: string;
  tariffType: string;
  meterConfiguration: string;
  description: string;
  effectiveFrom: string;
  blocks: EnergyBlock[];
  seasonalEnergy: SeasonalCharge[];
  touSeasons: TouSeason[];
  basicCharge?: BasicCharge;
  demandCharges: DemandCharge[];
}

interface TariffStructureFormProps {
  onSubmit: (data: TariffData) => void;
  isLoading: boolean;
  initialData?: TariffData;
  readOnly?: boolean;
}

export default function TariffStructureForm({ onSubmit, isLoading, initialData, readOnly = false }: TariffStructureFormProps) {
  const [tariffData, setTariffData] = useState<TariffData>(initialData || {
    tariffName: "",
    tariffType: "domestic",
    meterConfiguration: "prepaid",
    description: "",
    effectiveFrom: new Date().toISOString().split('T')[0],
    blocks: [],
    seasonalEnergy: [],
    touSeasons: [],
    basicCharge: undefined,
    demandCharges: []
  });

  const [visibleSections, setVisibleSections] = useState({
    blocks: initialData?.blocks && initialData.blocks.length > 0,
    seasonalEnergy: initialData?.seasonalEnergy && initialData.seasonalEnergy.length > 0,
    touEnergy: initialData?.touSeasons && initialData.touSeasons.length > 0,
    basicCharge: !!initialData?.basicCharge,
    demandCharges: initialData?.demandCharges && initialData.demandCharges.length > 0
  });

  // Update tariffData and visibleSections when initialData changes
  useEffect(() => {
    if (initialData) {
      setTariffData(initialData);
      // In read-only mode, show all sections that have data
      // In edit mode, only show sections that were previously visible
      const hasBlocks = initialData.blocks && initialData.blocks.length > 0;
      const hasSeasonalEnergy = initialData.seasonalEnergy && initialData.seasonalEnergy.length > 0;
      const hasTouSeasons = initialData.touSeasons && initialData.touSeasons.length > 0;
      const hasBasicCharge = !!initialData.basicCharge;
      const hasDemandCharges = initialData.demandCharges && initialData.demandCharges.length > 0;
      
      setVisibleSections({
        blocks: hasBlocks,
        seasonalEnergy: hasSeasonalEnergy,
        touEnergy: hasTouSeasons,
        basicCharge: hasBasicCharge,
        demandCharges: hasDemandCharges
      });
    }
  }, [initialData, readOnly]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(tariffData);
  };

  const addBlock = () => {
    setTariffData({
      ...tariffData,
      blocks: [
        ...tariffData.blocks,
        {
          blockNumber: tariffData.blocks.length + 1,
          kwhFrom: tariffData.blocks.length > 0 ? (tariffData.blocks[tariffData.blocks.length - 1].kwhTo || 0) : 0,
          kwhTo: null,
          energyChargeCents: 0
        }
      ]
    });
  };

  const removeBlock = (index: number) => {
    const updated = [...tariffData.blocks];
    updated.splice(index, 1);
    setTariffData({ ...tariffData, blocks: updated });
  };

  const updateBlock = (index: number, field: keyof EnergyBlock, value: any) => {
    const updated = [...tariffData.blocks];
    updated[index] = { ...updated[index], [field]: value };
    setTariffData({ ...tariffData, blocks: updated });
  };

  const addSeasonalCharge = () => {
    setTariffData({
      ...tariffData,
      seasonalEnergy: [
        ...tariffData.seasonalEnergy,
        { season: "Low Season", rate: 0, unit: "c/kWh" }
      ]
    });
  };

  const removeSeasonalCharge = (index: number) => {
    const updated = [...tariffData.seasonalEnergy];
    updated.splice(index, 1);
    setTariffData({ ...tariffData, seasonalEnergy: updated });
  };

  const updateSeasonalCharge = (index: number, field: keyof SeasonalCharge, value: any) => {
    const updated = [...tariffData.seasonalEnergy];
    updated[index] = { ...updated[index], [field]: value };
    setTariffData({ ...tariffData, seasonalEnergy: updated });
  };

  const addTouSeason = () => {
    setTariffData({
      ...tariffData,
      touSeasons: [
        ...tariffData.touSeasons,
        { season: "Low Season", peak: 0, standard: 0, offPeak: 0 }
      ]
    });
  };

  const removeTouSeason = (index: number) => {
    const updated = [...tariffData.touSeasons];
    updated.splice(index, 1);
    setTariffData({ ...tariffData, touSeasons: updated });
  };

  const updateTouSeason = (index: number, field: keyof TouSeason, value: any) => {
    const updated = [...tariffData.touSeasons];
    updated[index] = { ...updated[index], [field]: value };
    setTariffData({ ...tariffData, touSeasons: updated });
  };

  const addBasicCharge = () => {
    setTariffData({
      ...tariffData,
      basicCharge: { amount: 0, unit: "R/month" }
    });
  };

  const removeBasicCharge = () => {
    setTariffData({
      ...tariffData,
      basicCharge: undefined
    });
  };

  const updateBasicCharge = (field: keyof BasicCharge, value: any) => {
    setTariffData({
      ...tariffData,
      basicCharge: { ...tariffData.basicCharge!, [field]: value }
    });
  };

  const addDemandCharge = () => {
    setTariffData({
      ...tariffData,
      demandCharges: [
        ...tariffData.demandCharges,
        { season: "Low Season", rate: 0, unit: "R/kVA" }
      ]
    });
  };

  const removeDemandCharge = (index: number) => {
    const updated = [...tariffData.demandCharges];
    updated.splice(index, 1);
    setTariffData({ ...tariffData, demandCharges: updated });
  };

  const updateDemandCharge = (index: number, field: keyof DemandCharge, value: any) => {
    const updated = [...tariffData.demandCharges];
    updated[index] = { ...updated[index], [field]: value };
    setTariffData({ ...tariffData, demandCharges: updated });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto pr-2">
      {/* Header Section */}
      <div className="space-y-3 sticky top-0 bg-background z-10 pb-3 border-b">
        <div className="flex items-start gap-2">
          {!readOnly && <GripVertical className="h-5 w-5 text-muted-foreground mt-6" />}
          <div className="flex-1 space-y-3">
            <div>
              <Label className="text-xs">Tariff Name</Label>
              <Input
                value={tariffData.tariffName}
                onChange={(e) => setTariffData({ ...tariffData, tariffName: e.target.value })}
                required
                disabled={readOnly}
                placeholder="e.g., Domestic Prepaid"
                className="h-9 mt-1"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tariff Type</Label>
                <Select 
                  value={tariffData.tariffType} 
                  onValueChange={(value) => setTariffData({ ...tariffData, tariffType: value })}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="domestic">Domestic</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="agricultural">Agricultural</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label className="text-xs">Meter Config</Label>
                <Select 
                  value={tariffData.meterConfiguration} 
                  onValueChange={(value) => setTariffData({ ...tariffData, meterConfiguration: value })}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prepaid">Prepaid</SelectItem>
                    <SelectItem value="conventional">Conventional</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Effective From</Label>
              <Input
                type="date"
                value={tariffData.effectiveFrom}
                onChange={(e) => setTariffData({ ...tariffData, effectiveFrom: e.target.value })}
                required
                disabled={readOnly}
                className="h-9 mt-1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Section Visibility Checkboxes */}
      {!readOnly && (
        <div className="space-y-2 p-3 border rounded-lg bg-muted/10">
          <Label className="text-xs font-medium">Select Charge Types to Include</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-blocks"
                checked={visibleSections.blocks}
                onCheckedChange={(checked) => 
                  setVisibleSections({ ...visibleSections, blocks: checked === true })
                }
              />
              <Label htmlFor="show-blocks" className="text-xs font-normal cursor-pointer">
                Energy Blocks
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-seasonal"
                checked={visibleSections.seasonalEnergy}
                onCheckedChange={(checked) => 
                  setVisibleSections({ ...visibleSections, seasonalEnergy: checked === true })
                }
              />
              <Label htmlFor="show-seasonal" className="text-xs font-normal cursor-pointer">
                Seasonal Energy
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-tou"
                checked={visibleSections.touEnergy}
                onCheckedChange={(checked) => 
                  setVisibleSections({ ...visibleSections, touEnergy: checked === true })
                }
              />
              <Label htmlFor="show-tou" className="text-xs font-normal cursor-pointer">
                Time-of-Use Energy
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-basic"
                checked={visibleSections.basicCharge}
                onCheckedChange={(checked) => 
                  setVisibleSections({ ...visibleSections, basicCharge: checked === true })
                }
              />
              <Label htmlFor="show-basic" className="text-xs font-normal cursor-pointer">
                Basic Charge (Fixed Monthly)
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-demand"
                checked={visibleSections.demandCharges}
                onCheckedChange={(checked) => 
                  setVisibleSections({ ...visibleSections, demandCharges: checked === true })
                }
              />
              <Label htmlFor="show-demand" className="text-xs font-normal cursor-pointer">
                Demand Charges (Seasonal)
              </Label>
            </div>
          </div>
        </div>
      )}

      {/* Energy Blocks Section */}
      {visibleSections.blocks && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Energy Blocks</Label>
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addBlock}
              className="h-7 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Block
            </Button>
          )}
        </div>
        {tariffData.blocks.length > 0 ? (
          <div className="space-y-2">
            {tariffData.blocks.map((block, index) => (
              <div key={index} className="p-2 bg-muted/20 rounded border space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">From (kWh)</Label>
                    <Input
                      type="number"
                      value={block.kwhFrom}
                      onChange={(e) => updateBlock(index, 'kwhFrom', parseInt(e.target.value) || 0)}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">To (kWh)</Label>
                    <Input
                      type="number"
                      value={block.kwhTo || ''}
                      onChange={(e) => updateBlock(index, 'kwhTo', e.target.value ? parseInt(e.target.value) : null)}
                      placeholder="Unlimited"
                      disabled={readOnly}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">c/kWh</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={block.energyChargeCents}
                      onChange={(e) => updateBlock(index, 'energyChargeCents', parseFloat(e.target.value) || 0)}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </div>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeBlock(index)}
                    className="h-6 text-xs text-destructive hover:text-destructive w-full"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remove Block
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
            No energy blocks. Click "Add Block" to create one.
          </p>
        )}
      </div>
      )}

      {/* Seasonal Energy Charges Section */}
      {visibleSections.seasonalEnergy && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Seasonal Energy</Label>
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addSeasonalCharge}
              className="h-7 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Seasonal Charge
            </Button>
          )}
        </div>
        {tariffData.seasonalEnergy.length > 0 ? (
          <div className="space-y-2">
            {tariffData.seasonalEnergy.map((charge, index) => (
              <div key={index} className="p-2 bg-muted/20 rounded border space-y-2">
                <div>
                  <Label className="text-xs">Season</Label>
                  <Select
                    value={charge.season}
                    onValueChange={(value) => updateSeasonalCharge(index, 'season', value)}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-8 mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low Season">Low Season</SelectItem>
                      <SelectItem value="High Season">High Season</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Rate</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={charge.rate}
                      onChange={(e) => updateSeasonalCharge(index, 'rate', parseFloat(e.target.value) || 0)}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Unit</Label>
                    <Input
                      value={charge.unit}
                      onChange={(e) => updateSeasonalCharge(index, 'unit', e.target.value)}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </div>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeSeasonalCharge(index)}
                    className="h-6 text-xs text-destructive hover:text-destructive w-full"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remove Charge
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
            No seasonal energy charges.
          </p>
        )}
      </div>
      )}

      {/* Time-of-Use Energy Section */}
      {visibleSections.touEnergy && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Time-of-Use Energy</Label>
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addTouSeason}
              className="h-7 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add TOU Season
            </Button>
          )}
        </div>
        {tariffData.touSeasons.length > 0 ? (
          <div className="space-y-2">
            {tariffData.touSeasons.map((season, index) => (
              <div key={index} className="p-2 bg-muted/20 rounded border space-y-2">
                <div>
                  <Label className="text-xs">Season</Label>
                  <Select
                    value={season.season}
                    onValueChange={(value) => updateTouSeason(index, 'season', value)}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-8 mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low Season">Low Season</SelectItem>
                      <SelectItem value="High Season">High Season</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Peak (c/kWh)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={season.peak}
                      onChange={(e) => updateTouSeason(index, 'peak', parseFloat(e.target.value) || 0)}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Standard (c/kWh)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={season.standard}
                      onChange={(e) => updateTouSeason(index, 'standard', parseFloat(e.target.value) || 0)}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Off-Peak (c/kWh)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={season.offPeak}
                      onChange={(e) => updateTouSeason(index, 'offPeak', parseFloat(e.target.value) || 0)}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </div>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeTouSeason(index)}
                    className="h-6 text-xs text-destructive hover:text-destructive w-full"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remove TOU Season
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
            No time-of-use periods.
          </p>
        )}
      </div>
      )}

      {/* Basic Charge Section */}
      {visibleSections.basicCharge && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Basic Charge (Fixed Monthly)</Label>
          {!readOnly && !tariffData.basicCharge && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addBasicCharge}
              className="h-7 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Basic Charge
            </Button>
          )}
        </div>
        {tariffData.basicCharge ? (
          <div className="p-2 bg-muted/20 rounded border space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={tariffData.basicCharge.amount}
                  onChange={(e) => updateBasicCharge('amount', parseFloat(e.target.value) || 0)}
                  disabled={readOnly}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Input
                  value={tariffData.basicCharge.unit}
                  onChange={(e) => updateBasicCharge('unit', e.target.value)}
                  disabled={readOnly}
                  className="h-8"
                />
              </div>
            </div>
            {!readOnly && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={removeBasicCharge}
                className="h-6 text-xs text-destructive hover:text-destructive w-full"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Remove Basic Charge
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
            No basic charge.
          </p>
        )}
      </div>
      )}

      {/* Demand Charges Section */}
      {visibleSections.demandCharges && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Demand Charges (Seasonal)</Label>
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addDemandCharge}
              className="h-7 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Demand Charge
            </Button>
          )}
        </div>
        {tariffData.demandCharges.length > 0 ? (
          <div className="space-y-2">
            {tariffData.demandCharges.map((charge, index) => (
              <div key={index} className="p-2 bg-muted/20 rounded border space-y-2">
                <div>
                  <Label className="text-xs">Season</Label>
                  <Select
                    value={charge.season}
                    onValueChange={(value) => updateDemandCharge(index, 'season', value)}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-8 mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low Season">Low Season</SelectItem>
                      <SelectItem value="High Season">High Season</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Rate</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={charge.rate}
                      onChange={(e) => updateDemandCharge(index, 'rate', parseFloat(e.target.value) || 0)}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Unit</Label>
                    <Input
                      value={charge.unit}
                      onChange={(e) => updateDemandCharge(index, 'unit', e.target.value)}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </div>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeDemandCharge(index)}
                    className="h-6 text-xs text-destructive hover:text-destructive w-full"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remove Demand Charge
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground p-2 bg-muted/20 rounded">
            No demand charges.
          </p>
        )}
      </div>
      )}

      {/* Submit Button */}
      {!readOnly && (
        <div className="sticky bottom-0 bg-background pt-3 border-t">
          <Button type="submit" className="w-full" disabled={isLoading || !tariffData.tariffName}>
            {isLoading ? "Creating Tariff..." : "Create Tariff"}
          </Button>
        </div>
      )}
    </form>
  );
}
