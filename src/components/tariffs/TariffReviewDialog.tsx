import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { RefreshCw, RotateCcw, X, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ExtractedTariffData {
  supplyAuthority: {
    name: string;
    region?: string;
    nersaIncreasePercentage?: number;
  };
  tariffStructures: Array<{
    name: string;
    tariffType: string;
    voltageLevel?: string;
    transmissionZone?: string;
    meterConfiguration?: string;
    effectiveFrom: string;
    effectiveTo?: string;
    description?: string;
    usesTou: boolean;
    touType?: string;
    blocks: Array<{
      blockNumber: number;
      kwhFrom: number;
      kwhTo: number | null;
      energyChargeCents: number;
    }>;
    charges: Array<{
      chargeType: string;
      chargeAmount: number;
      description: string;
      unit: string;
    }>;
    touPeriods?: Array<{
      periodType: string;
      season: string;
      dayType: string;
      startHour: number;
      endHour: number;
      energyChargeCents: number;
    }>;
  }>;
}

interface TariffReviewDialogProps {
  open: boolean;
  onClose: () => void;
  municipalityName: string;
  extractedData: ExtractedTariffData | null;
  sourceImageUrl?: string;
  onRescan: () => Promise<void>;
  onReset: () => void;
  onSave: (data: ExtractedTariffData) => Promise<void>;
}

export default function TariffReviewDialog({
  open,
  onClose,
  municipalityName,
  extractedData: initialData,
  sourceImageUrl,
  onRescan,
  onReset,
  onSave
}: TariffReviewDialogProps) {
  const [data, setData] = useState<ExtractedTariffData | null>(initialData);
  const [isRescanning, setIsRescanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  const handleRescan = async () => {
    setIsRescanning(true);
    try {
      await onRescan();
      toast.success("Data rescanned successfully");
    } catch (error: any) {
      toast.error(`Rescan failed: ${error.message}`);
    } finally {
      setIsRescanning(false);
    }
  };

  const handleSave = async () => {
    if (!data) return;
    
    setIsSaving(true);
    try {
      await onSave(data);
      toast.success("Data saved successfully");
      onClose();
    } catch (error: any) {
      toast.error(`Save failed: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const updateTariffStructure = (index: number, updates: any) => {
    if (!data) return;
    
    const newData = { ...data };
    newData.tariffStructures[index] = {
      ...newData.tariffStructures[index],
      ...updates
    };
    setData(newData);
  };

  const updateBlock = (tariffIndex: number, blockIndex: number, updates: any) => {
    if (!data) return;
    
    const newData = { ...data };
    newData.tariffStructures[tariffIndex].blocks[blockIndex] = {
      ...newData.tariffStructures[tariffIndex].blocks[blockIndex],
      ...updates
    };
    setData(newData);
  };

  const updateCharge = (tariffIndex: number, chargeIndex: number, updates: any) => {
    if (!data) return;
    
    const newData = { ...data };
    newData.tariffStructures[tariffIndex].charges[chargeIndex] = {
      ...newData.tariffStructures[tariffIndex].charges[chargeIndex],
      ...updates
    };
    setData(newData);
  };

  const updateTouPeriod = (tariffIndex: number, periodIndex: number, updates: any) => {
    if (!data) return;
    
    const newData = { ...data };
    if (newData.tariffStructures[tariffIndex].touPeriods) {
      newData.tariffStructures[tariffIndex].touPeriods![periodIndex] = {
        ...newData.tariffStructures[tariffIndex].touPeriods![periodIndex],
        ...updates
      };
    }
    setData(newData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] h-[90vh] p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>Review Extracted Data - {municipalityName}</DialogTitle>
          <DialogDescription>
            Review and edit the extracted tariff data. The source document is shown on the left.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col p-6 pt-4">
          <div className="flex gap-2 mb-4">
            <Button
              onClick={handleRescan}
              disabled={isRescanning || isSaving}
              variant="outline"
              size="sm"
            >
              {isRescanning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Rescanning...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  AI Rescan
                </>
              )}
            </Button>
            <Button
              onClick={onReset}
              disabled={isRescanning || isSaving}
              variant="outline"
              size="sm"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <div className="flex-1" />
            <Button
              onClick={handleSave}
              disabled={isRescanning || isSaving || !data}
              size="sm"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
            <Button
              onClick={onClose}
              disabled={isRescanning || isSaving}
              variant="outline"
              size="sm"
            >
              <X className="w-4 h-4 mr-2" />
              Close
            </Button>
          </div>

          <div className="flex-1 grid grid-cols-2 gap-4 overflow-hidden">
            {/* Left: Source Image */}
            <Card className="overflow-hidden flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Source Document</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                {sourceImageUrl ? (
                  <TransformWrapper
                    initialScale={1}
                    minScale={0.5}
                    maxScale={3}
                  >
                    <TransformComponent
                      wrapperClass="w-full h-full"
                      contentClass="w-full h-full flex items-center justify-center"
                    >
                      <img
                        src={sourceImageUrl}
                        alt="Source document"
                        className="max-w-full max-h-full object-contain"
                      />
                    </TransformComponent>
                  </TransformWrapper>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No source image available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Right: Extracted Data */}
            <Card className="overflow-hidden flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Extracted Data</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full px-6 pb-6">
                  {data ? (
                    <div className="space-y-6">
                      {/* Supply Authority Info */}
                      <div className="space-y-3">
                        <h3 className="font-semibold text-sm">Supply Authority</h3>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">NERSA Increase (%)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={data.supplyAuthority.nersaIncreasePercentage || 0}
                              onChange={(e) => {
                                const newData = { ...data };
                                newData.supplyAuthority.nersaIncreasePercentage = parseFloat(e.target.value) || 0;
                                setData(newData);
                              }}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Region</Label>
                            <Input
                              value={data.supplyAuthority.region || ""}
                              onChange={(e) => {
                                const newData = { ...data };
                                newData.supplyAuthority.region = e.target.value;
                                setData(newData);
                              }}
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Tariff Structures */}
                      {data.tariffStructures.map((tariff, tariffIdx) => (
                        <Card key={tariffIdx} className="border-2">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm">{tariff.name}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <Tabs defaultValue="blocks" className="w-full">
                              <TabsList className="grid w-full grid-cols-3">
                                <TabsTrigger value="blocks">Blocks</TabsTrigger>
                                <TabsTrigger value="charges">Charges</TabsTrigger>
                                <TabsTrigger value="tou">TOU</TabsTrigger>
                              </TabsList>

                              <TabsContent value="blocks" className="space-y-2 mt-4">
                                {tariff.blocks.map((block, blockIdx) => (
                                  <div key={blockIdx} className="grid grid-cols-3 gap-2">
                                    <div>
                                      <Label className="text-xs">From (kWh)</Label>
                                      <Input
                                        type="number"
                                        value={block.kwhFrom}
                                        onChange={(e) =>
                                          updateBlock(tariffIdx, blockIdx, {
                                            kwhFrom: parseFloat(e.target.value) || 0
                                          })
                                        }
                                        className="h-8 text-sm"
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-xs">To (kWh)</Label>
                                      <Input
                                        type="number"
                                        value={block.kwhTo || ""}
                                        onChange={(e) =>
                                          updateBlock(tariffIdx, blockIdx, {
                                            kwhTo: e.target.value ? parseFloat(e.target.value) : null
                                          })
                                        }
                                        placeholder="∞"
                                        className="h-8 text-sm"
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-xs">Cents/kWh</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={block.energyChargeCents}
                                        onChange={(e) =>
                                          updateBlock(tariffIdx, blockIdx, {
                                            energyChargeCents: parseFloat(e.target.value) || 0
                                          })
                                        }
                                        className="h-8 text-sm"
                                      />
                                    </div>
                                  </div>
                                ))}
                                {tariff.blocks.length === 0 && (
                                  <p className="text-xs text-muted-foreground text-center py-4">
                                    No blocks found
                                  </p>
                                )}
                              </TabsContent>

                              <TabsContent value="charges" className="space-y-2 mt-4">
                                {tariff.charges.map((charge, chargeIdx) => (
                                  <div key={chargeIdx} className="grid grid-cols-3 gap-2">
                                    <div className="col-span-2">
                                      <Label className="text-xs">Description</Label>
                                      <Input
                                        value={charge.description}
                                        onChange={(e) =>
                                          updateCharge(tariffIdx, chargeIdx, {
                                            description: e.target.value
                                          })
                                        }
                                        className="h-8 text-sm"
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-xs">Amount</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={charge.chargeAmount}
                                        onChange={(e) =>
                                          updateCharge(tariffIdx, chargeIdx, {
                                            chargeAmount: parseFloat(e.target.value) || 0
                                          })
                                        }
                                        className="h-8 text-sm"
                                      />
                                    </div>
                                  </div>
                                ))}
                                {tariff.charges.length === 0 && (
                                  <p className="text-xs text-muted-foreground text-center py-4">
                                    No charges found
                                  </p>
                                )}
                              </TabsContent>

                              <TabsContent value="tou" className="space-y-2 mt-4">
                                {tariff.touPeriods && tariff.touPeriods.length > 0 ? (
                                  tariff.touPeriods.map((period, periodIdx) => (
                                    <div key={periodIdx} className="grid grid-cols-4 gap-2">
                                      <div>
                                        <Label className="text-xs">Type</Label>
                                        <Input
                                          value={period.periodType}
                                          onChange={(e) =>
                                            updateTouPeriod(tariffIdx, periodIdx, {
                                              periodType: e.target.value
                                            })
                                          }
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-xs">Season</Label>
                                        <Input
                                          value={period.season}
                                          onChange={(e) =>
                                            updateTouPeriod(tariffIdx, periodIdx, {
                                              season: e.target.value
                                            })
                                          }
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-xs">Hours</Label>
                                        <Input
                                          value={`${period.startHour}-${period.endHour}`}
                                          disabled
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-xs">Cents/kWh</Label>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={period.energyChargeCents}
                                          onChange={(e) =>
                                            updateTouPeriod(tariffIdx, periodIdx, {
                                              energyChargeCents: parseFloat(e.target.value) || 0
                                            })
                                          }
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-muted-foreground text-center py-4">
                                    No TOU periods found
                                  </p>
                                )}
                              </TabsContent>
                            </Tabs>
                          </CardContent>
                        </Card>
                      ))}

                      {data.tariffStructures.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No tariff structures found
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      No data available
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
