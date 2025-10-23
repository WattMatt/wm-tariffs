import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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

interface TariffExtractionDialogProps {
  open: boolean;
  onClose: () => void;
  municipalityName: string;
  sheetData: any[][];
  sourceFile: File | null;
  onExtract: () => Promise<ExtractedTariffData>;
  onComplete: (data: ExtractedTariffData) => void;
}

export default function TariffExtractionDialog({
  open,
  onClose,
  municipalityName,
  sheetData,
  sourceFile,
  onExtract,
  onComplete
}: TariffExtractionDialogProps) {
  const [extractionStep, setExtractionStep] = useState<"extract" | "review" | "save" | "complete">("extract");
  const [extractedData, setExtractedData] = useState<ExtractedTariffData | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isExcelFile, setIsExcelFile] = useState(false);

  // Create object URL for the file
  useEffect(() => {
    if (sourceFile) {
      const url = URL.createObjectURL(sourceFile);
      setFileUrl(url);
      setIsExcelFile(sourceFile.name.toLowerCase().endsWith('.xlsx') || sourceFile.name.toLowerCase().endsWith('.xls'));
      
      return () => URL.revokeObjectURL(url);
    }
  }, [sourceFile]);

  // Start extraction when dialog opens
  useEffect(() => {
    if (open && !isExtracting && !extractedData) {
      handleExtract();
    }
  }, [open]);

  const handleExtract = async () => {
    setIsExtracting(true);
    setExtractionStep("extract");
    try {
      const data = await onExtract();
      setExtractedData(data);
      setExtractionStep("review");
    } catch (error: any) {
      console.error("Extraction failed:", error);
      setExtractionStep("extract");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleAccept = () => {
    if (extractedData) {
      onComplete(extractedData);
    }
  };

  const updateTariffStructure = (index: number, updates: any) => {
    if (!extractedData) return;
    
    const newData = { ...extractedData };
    newData.tariffStructures[index] = {
      ...newData.tariffStructures[index],
      ...updates
    };
    setExtractedData(newData);
  };

  const updateBlock = (tariffIndex: number, blockIndex: number, updates: any) => {
    if (!extractedData) return;
    
    const newData = { ...extractedData };
    newData.tariffStructures[tariffIndex].blocks[blockIndex] = {
      ...newData.tariffStructures[tariffIndex].blocks[blockIndex],
      ...updates
    };
    setExtractedData(newData);
  };

  const updateCharge = (tariffIndex: number, chargeIndex: number, updates: any) => {
    if (!extractedData) return;
    
    const newData = { ...extractedData };
    newData.tariffStructures[tariffIndex].charges[chargeIndex] = {
      ...newData.tariffStructures[tariffIndex].charges[chargeIndex],
      ...updates
    };
    setExtractedData(newData);
  };

  const updateTouPeriod = (tariffIndex: number, periodIndex: number, updates: any) => {
    if (!extractedData) return;
    
    const newData = { ...extractedData };
    if (newData.tariffStructures[tariffIndex].touPeriods) {
      newData.tariffStructures[tariffIndex].touPeriods![periodIndex] = {
        ...newData.tariffStructures[tariffIndex].touPeriods![periodIndex],
        ...updates
      };
    }
    setExtractedData(newData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] h-[90vh] p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>Extracting Tariff Data - {municipalityName}</DialogTitle>
          <DialogDescription>
            AI is analyzing the source data and extracting tariff structures.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col p-6 pt-4">
          <div className="flex-1 grid grid-cols-2 gap-4 overflow-hidden">
            {/* Left: Source Document Preview */}
            <Card className="overflow-hidden flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Source Document</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full">
                  {!isExcelFile && fileUrl ? (
                    <div className="p-4">
                      <Document
                        file={fileUrl}
                        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                        className="flex flex-col items-center gap-4"
                      >
                        {numPages && Array.from(new Array(numPages), (el, index) => (
                          <Page
                            key={`page_${index + 1}`}
                            pageNumber={index + 1}
                            width={500}
                            className="border border-border"
                          />
                        ))}
                      </Document>
                    </div>
                  ) : (
                    <div className="p-4">
                      <table className="w-full text-xs border-collapse">
                        <tbody>
                          {sheetData.slice(0, 100).map((row, rowIdx) => (
                            <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-muted/30' : ''}>
                              {row.map((cell, cellIdx) => (
                                <td 
                                  key={cellIdx} 
                                  className="border border-border px-2 py-1 text-left align-top"
                                  style={{
                                    fontWeight: rowIdx === 0 ? 600 : 400,
                                    fontSize: '0.75rem'
                                  }}
                                >
                                  {cell?.toString() || ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Right: Extracted Data */}
            <Card className="overflow-hidden flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Extracted Data</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                {extractionStep === "extract" && (
                  <div className="flex flex-col items-center justify-center h-full p-6">
                    <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                    <h3 className="font-semibold mb-2">Extracting Data with AI</h3>
                    <p className="text-sm text-muted-foreground text-center">
                      Analyzing tariff document and extracting structured data...
                    </p>
                  </div>
                )}

                {extractionStep === "review" && extractedData && (
                  <ScrollArea className="h-full px-6 pb-6">
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
                              value={extractedData.supplyAuthority.nersaIncreasePercentage || 0}
                              onChange={(e) => {
                                const newData = { ...extractedData };
                                newData.supplyAuthority.nersaIncreasePercentage = parseFloat(e.target.value) || 0;
                                setExtractedData(newData);
                              }}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Region</Label>
                            <Input
                              value={extractedData.supplyAuthority.region || ""}
                              onChange={(e) => {
                                const newData = { ...extractedData };
                                newData.supplyAuthority.region = e.target.value;
                                setExtractedData(newData);
                              }}
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Tariff Structures */}
                      {extractedData.tariffStructures.map((tariff, tariffIdx) => (
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

                      {extractedData.tariffStructures.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No tariff structures found
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 mt-4">
            {extractionStep === "review" && (
              <Button
                onClick={handleExtract}
                disabled={isExtracting}
                variant="outline"
                size="sm"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  "Extract"
                )}
              </Button>
            )}
            <div className="flex-1" />
            {extractionStep === "review" && (
              <Button
                onClick={handleAccept}
                disabled={!extractedData}
                size="sm"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Accept
              </Button>
            )}
            <Button
              onClick={onClose}
              variant="outline"
              size="sm"
            >
              <X className="w-4 h-4 mr-2" />
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
