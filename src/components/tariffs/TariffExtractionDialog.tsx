import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, X, ZoomIn, ZoomOut, Maximize2, Trash2, Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { pdfjs } from 'react-pdf';
import { toast } from "sonner";

// Set up PDF.js worker
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
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isExcelFile, setIsExcelFile] = useState(false);
  const [convertedPdfImage, setConvertedPdfImage] = useState<string | null>(null);
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);

  // Convert PDF to image for display
  const convertPdfToImage = async (pdfFile: File): Promise<string> => {
    setIsConvertingPdf(true);
    try {
      console.log('Converting PDF to image:', pdfFile.name);
      
      // Read the PDF file as array buffer
      const arrayBuffer = await pdfFile.arrayBuffer();
      
      // Load the PDF
      const loadingTask = pdfjs.getDocument(arrayBuffer);
      const pdf = await loadingTask.promise;
      
      console.log('PDF loaded, converting first page to image...');
      
      // Get the first page
      const page = await pdf.getPage(1);
      
      // Set scale for high quality
      const scale = 2.0;
      const viewport = page.getViewport({ scale });
      
      // Create canvas
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (!context) {
        throw new Error('Could not get canvas context');
      }
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      // Render PDF page to canvas
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        canvas: canvas
      };
      
      await page.render(renderContext).promise;
      
      console.log('PDF rendered to canvas, converting to data URL...');
      
      // Convert canvas to data URL
      return canvas.toDataURL('image/png', 1.0);
    } catch (error) {
      console.error('Error converting PDF to image:', error);
      toast.error('Failed to convert PDF to image');
      throw error;
    } finally {
      setIsConvertingPdf(false);
    }
  };

  // Create object URL for the file and convert PDF if needed
  useEffect(() => {
    if (sourceFile) {
      const isPdf = sourceFile.name.toLowerCase().endsWith('.pdf');
      const isExcel = sourceFile.name.toLowerCase().endsWith('.xlsx') || sourceFile.name.toLowerCase().endsWith('.xls');
      
      setIsExcelFile(isExcel);
      
      if (isPdf) {
        // Convert PDF to image
        convertPdfToImage(sourceFile).then(imageUrl => {
          setConvertedPdfImage(imageUrl);
        }).catch(error => {
          console.error('Failed to convert PDF:', error);
        });
      } else {
        const url = URL.createObjectURL(sourceFile);
        setFileUrl(url);
        return () => URL.revokeObjectURL(url);
      }
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

  const addBlock = (tariffIndex: number) => {
    if (!extractedData) return;
    
    const newData = { ...extractedData };
    const newBlock = {
      blockNumber: newData.tariffStructures[tariffIndex].blocks.length + 1,
      kwhFrom: 0,
      kwhTo: null,
      energyChargeCents: 0
    };
    newData.tariffStructures[tariffIndex].blocks.push(newBlock);
    setExtractedData(newData);
  };

  const deleteBlock = (tariffIndex: number, blockIndex: number) => {
    if (!extractedData) return;
    
    const newData = { ...extractedData };
    newData.tariffStructures[tariffIndex].blocks.splice(blockIndex, 1);
    setExtractedData(newData);
  };

  const addCharge = (tariffIndex: number) => {
    if (!extractedData) return;
    
    const newData = { ...extractedData };
    const newCharge = {
      chargeType: "Other",
      chargeAmount: 0,
      description: "",
      unit: "R"
    };
    newData.tariffStructures[tariffIndex].charges.push(newCharge);
    setExtractedData(newData);
  };

  const deleteCharge = (tariffIndex: number, chargeIndex: number) => {
    if (!extractedData) return;
    
    const newData = { ...extractedData };
    newData.tariffStructures[tariffIndex].charges.splice(chargeIndex, 1);
    setExtractedData(newData);
  };

  const addTouPeriod = (tariffIndex: number) => {
    if (!extractedData) return;
    
    const newData = { ...extractedData };
    const newPeriod = {
      periodType: "Peak",
      season: "Summer",
      dayType: "Weekday",
      startHour: 0,
      endHour: 24,
      energyChargeCents: 0
    };
    
    if (!newData.tariffStructures[tariffIndex].touPeriods) {
      newData.tariffStructures[tariffIndex].touPeriods = [];
    }
    newData.tariffStructures[tariffIndex].touPeriods!.push(newPeriod);
    setExtractedData(newData);
  };

  const deleteTouPeriod = (tariffIndex: number, periodIndex: number) => {
    if (!extractedData) return;
    
    const newData = { ...extractedData };
    if (newData.tariffStructures[tariffIndex].touPeriods) {
      newData.tariffStructures[tariffIndex].touPeriods.splice(periodIndex, 1);
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
                  {isConvertingPdf ? (
                    <div className="flex flex-col items-center justify-center h-full p-6">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                      <p className="text-sm text-muted-foreground">Converting PDF...</p>
                    </div>
                  ) : convertedPdfImage ? (
                    <div className="relative h-full">
                      <TransformWrapper
                        initialScale={1}
                        minScale={0.5}
                        maxScale={3}
                        centerOnInit={true}
                      >
                        {({ zoomIn, zoomOut, resetTransform }) => (
                          <>
                            <div className="absolute top-2 right-2 z-10 flex gap-2">
                              <Button size="icon" variant="secondary" onClick={() => zoomIn()}>
                                <ZoomIn className="w-4 h-4" />
                              </Button>
                              <Button size="icon" variant="secondary" onClick={() => zoomOut()}>
                                <ZoomOut className="w-4 h-4" />
                              </Button>
                              <Button size="icon" variant="secondary" onClick={() => resetTransform()}>
                                <Maximize2 className="w-4 h-4" />
                              </Button>
                            </div>
                            <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full">
                              <div className="p-4">
                                <img 
                                  src={convertedPdfImage} 
                                  alt="PDF Preview" 
                                  className="w-full border border-border rounded"
                                />
                              </div>
                            </TransformComponent>
                          </>
                        )}
                      </TransformWrapper>
                    </div>
                  ) : isExcelFile ? (
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
                  ) : (
                    <div className="flex items-center justify-center h-full p-6">
                      <p className="text-sm text-muted-foreground">No preview available</p>
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
                            <div>
                              <Label className="text-xs">Tariff Name</Label>
                              <Input
                                value={tariff.name}
                                onChange={(e) =>
                                  updateTariffStructure(tariffIdx, { name: e.target.value })
                                }
                                className="h-8 text-sm font-semibold mt-1"
                              />
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {/* Metadata Fields */}
                            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg">
                              <div>
                                <Label className="text-xs">Tariff Type</Label>
                                <Select
                                  value={tariff.tariffType}
                                  onValueChange={(value) =>
                                    updateTariffStructure(tariffIdx, { tariffType: value })
                                  }
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Domestic">Domestic</SelectItem>
                                    <SelectItem value="Commercial">Commercial</SelectItem>
                                    <SelectItem value="Industrial">Industrial</SelectItem>
                                    <SelectItem value="Agricultural">Agricultural</SelectItem>
                                    <SelectItem value="Other">Other</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label className="text-xs">Voltage Level</Label>
                                <Input
                                  value={tariff.voltageLevel || ""}
                                  onChange={(e) =>
                                    updateTariffStructure(tariffIdx, { voltageLevel: e.target.value })
                                  }
                                  placeholder="e.g., LV, MV, HV"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Transmission Zone</Label>
                                <Input
                                  value={tariff.transmissionZone || ""}
                                  onChange={(e) =>
                                    updateTariffStructure(tariffIdx, { transmissionZone: e.target.value })
                                  }
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Meter Configuration</Label>
                                <Input
                                  value={tariff.meterConfiguration || ""}
                                  onChange={(e) =>
                                    updateTariffStructure(tariffIdx, { meterConfiguration: e.target.value })
                                  }
                                  placeholder="e.g., Single, Three Phase"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Effective From</Label>
                                <Input
                                  type="date"
                                  value={tariff.effectiveFrom}
                                  onChange={(e) =>
                                    updateTariffStructure(tariffIdx, { effectiveFrom: e.target.value })
                                  }
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Effective To</Label>
                                <Input
                                  type="date"
                                  value={tariff.effectiveTo || ""}
                                  onChange={(e) =>
                                    updateTariffStructure(tariffIdx, { effectiveTo: e.target.value })
                                  }
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="col-span-2">
                                <Label className="text-xs">Description</Label>
                                <Textarea
                                  value={tariff.description || ""}
                                  onChange={(e) =>
                                    updateTariffStructure(tariffIdx, { description: e.target.value })
                                  }
                                  placeholder="Additional notes about this tariff"
                                  className="text-sm min-h-[60px]"
                                />
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`tou-${tariffIdx}`}
                                  checked={tariff.usesTou}
                                  onCheckedChange={(checked) =>
                                    updateTariffStructure(tariffIdx, { usesTou: checked === true })
                                  }
                                />
                                <Label htmlFor={`tou-${tariffIdx}`} className="text-xs">
                                  Uses Time of Use (TOU)
                                </Label>
                              </div>
                              {tariff.usesTou && (
                                <div>
                                  <Label className="text-xs">TOU Type</Label>
                                  <Input
                                    value={tariff.touType || ""}
                                    onChange={(e) =>
                                      updateTariffStructure(tariffIdx, { touType: e.target.value })
                                    }
                                    placeholder="e.g., Seasonal, Fixed"
                                    className="h-8 text-sm"
                                  />
                                </div>
                              )}
                            </div>

                            <Tabs defaultValue="blocks" className="w-full">
                              <TabsList className="grid w-full grid-cols-3">
                                <TabsTrigger value="blocks">Blocks</TabsTrigger>
                                <TabsTrigger value="charges">Charges</TabsTrigger>
                                <TabsTrigger value="tou">TOU</TabsTrigger>
                              </TabsList>

                              <TabsContent value="blocks" className="space-y-2 mt-4">
                                {tariff.blocks.map((block, blockIdx) => (
                                  <div key={blockIdx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
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
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => deleteBlock(tariffIdx, blockIdx)}
                                      className="h-8 w-8"
                                    >
                                      <Trash2 className="w-4 h-4 text-destructive" />
                                    </Button>
                                  </div>
                                ))}
                                {tariff.blocks.length === 0 && (
                                  <p className="text-xs text-muted-foreground text-center py-4">
                                    No blocks found
                                  </p>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addBlock(tariffIdx)}
                                  className="w-full"
                                >
                                  <Plus className="w-4 h-4 mr-2" />
                                  Add Block
                                </Button>
                              </TabsContent>

                              <TabsContent value="charges" className="space-y-2 mt-4">
                                {tariff.charges.map((charge, chargeIdx) => (
                                  <div key={chargeIdx} className="grid grid-cols-[2fr_1fr_auto] gap-2 items-end">
                                    <div>
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
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => deleteCharge(tariffIdx, chargeIdx)}
                                      className="h-8 w-8"
                                    >
                                      <Trash2 className="w-4 h-4 text-destructive" />
                                    </Button>
                                  </div>
                                ))}
                                {tariff.charges.length === 0 && (
                                  <p className="text-xs text-muted-foreground text-center py-4">
                                    No charges found
                                  </p>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addCharge(tariffIdx)}
                                  className="w-full"
                                >
                                  <Plus className="w-4 h-4 mr-2" />
                                  Add Charge
                                </Button>
                              </TabsContent>

                              <TabsContent value="tou" className="space-y-2 mt-4">
                                {tariff.touPeriods && tariff.touPeriods.length > 0 ? (
                                  tariff.touPeriods.map((period, periodIdx) => (
                                    <div key={periodIdx} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
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
                                        <Label className="text-xs">Start Hour</Label>
                                        <Input
                                          type="number"
                                          min="0"
                                          max="23"
                                          value={period.startHour}
                                          onChange={(e) =>
                                            updateTouPeriod(tariffIdx, periodIdx, {
                                              startHour: parseInt(e.target.value) || 0
                                            })
                                          }
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-xs">End Hour</Label>
                                        <Input
                                          type="number"
                                          min="0"
                                          max="24"
                                          value={period.endHour}
                                          onChange={(e) =>
                                            updateTouPeriod(tariffIdx, periodIdx, {
                                              endHour: parseInt(e.target.value) || 24
                                            })
                                          }
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => deleteTouPeriod(tariffIdx, periodIdx)}
                                        className="h-8 w-8"
                                      >
                                        <Trash2 className="w-4 h-4 text-destructive" />
                                      </Button>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-muted-foreground text-center py-4">
                                    No TOU periods found
                                  </p>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addTouPeriod(tariffIdx)}
                                  className="w-full"
                                >
                                  <Plus className="w-4 h-4 mr-2" />
                                  Add TOU Period
                                </Button>
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
