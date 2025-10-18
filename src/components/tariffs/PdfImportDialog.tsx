import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { FileUp, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
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

export default function PdfImportDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedTariffData | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile);
      setExtractedData(null);
    } else {
      toast.error("Please select a PDF file");
    }
  };

  const extractTextFromPdf = async (pdfFile: File): Promise<string> => {
    const pdfjsLib = await import("pdfjs-dist");
    
    // Set worker source
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = "";
    
    // Extract text from all pages
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      fullText += pageText + "\n\n";
    }
    
    return fullText;
  };

  const handleProcess = async () => {
    if (!file) {
      toast.error("Please select a PDF file");
      return;
    }

    setIsProcessing(true);

    try {
      // Extract text from PDF
      const documentContent = await extractTextFromPdf(file);

      // Call edge function to extract structured data
      const { data, error } = await supabase.functions.invoke("extract-tariff-data", {
        body: { documentContent }
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || "Failed to extract data");
      }

      setExtractedData(data.data);
      toast.success("Tariff data extracted successfully");
    } catch (error: any) {
      console.error("Error processing PDF:", error);
      toast.error(error.message || "Failed to process PDF");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!extractedData) return;

    setIsSaving(true);

    try {
      // 1. Insert supply authority
      const { data: authority, error: authorityError } = await supabase
        .from("supply_authorities")
        .insert({
          name: extractedData.supplyAuthority.name,
          region: extractedData.supplyAuthority.region,
          nersa_increase_percentage: extractedData.supplyAuthority.nersaIncreasePercentage,
          active: true
        })
        .select()
        .single();

      if (authorityError) throw authorityError;

      // 2. Insert tariff structures
      for (const structure of extractedData.tariffStructures) {
        const { data: tariff, error: tariffError } = await supabase
          .from("tariff_structures")
          .insert({
            supply_authority_id: authority.id,
            name: structure.name,
            tariff_type: structure.tariffType,
            meter_configuration: structure.meterConfiguration,
            description: structure.description,
            effective_from: structure.effectiveFrom,
            effective_to: structure.effectiveTo,
            uses_tou: structure.usesTou,
            tou_type: structure.touType,
            active: true
          })
          .select()
          .single();

        if (tariffError) throw tariffError;

        // 3. Insert blocks
        if (structure.blocks && structure.blocks.length > 0) {
          const blockInserts = structure.blocks.map(block => ({
            tariff_structure_id: tariff.id,
            block_number: block.blockNumber,
            kwh_from: block.kwhFrom,
            kwh_to: block.kwhTo,
            energy_charge_cents: block.energyChargeCents
          }));

          const { error: blocksError } = await supabase
            .from("tariff_blocks")
            .insert(blockInserts);

          if (blocksError) throw blocksError;
        }

        // 4. Insert charges
        if (structure.charges && structure.charges.length > 0) {
          const chargeInserts = structure.charges.map(charge => ({
            tariff_structure_id: tariff.id,
            charge_type: charge.chargeType,
            charge_amount: charge.chargeAmount,
            description: charge.description,
            unit: charge.unit
          }));

          const { error: chargesError } = await supabase
            .from("tariff_charges")
            .insert(chargeInserts);

          if (chargesError) throw chargesError;
        }

        // 5. Insert TOU periods if applicable
        if (structure.usesTou && structure.touPeriods && structure.touPeriods.length > 0) {
          const touInserts = structure.touPeriods.map(period => ({
            tariff_structure_id: tariff.id,
            period_type: period.periodType,
            season: period.season,
            day_type: period.dayType,
            start_hour: period.startHour,
            end_hour: period.endHour,
            energy_charge_cents: period.energyChargeCents
          }));

          const { error: touError } = await supabase
            .from("tariff_time_periods")
            .insert(touInserts);

          if (touError) throw touError;
        }
      }

      toast.success("Tariff data saved successfully");
      setIsOpen(false);
      setFile(null);
      setExtractedData(null);
      
      // Refresh the page to show new data
      window.location.reload();
    } catch (error: any) {
      console.error("Error saving tariff data:", error);
      toast.error(error.message || "Failed to save tariff data");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <FileUp className="w-4 h-4" />
          Import from PDF
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Tariff from PDF</DialogTitle>
          <DialogDescription>
            Upload a NERSA tariff PDF document to automatically extract and import tariff structures
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pdf-file">Select PDF Document</Label>
            <Input
              id="pdf-file"
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              disabled={isProcessing || isSaving}
            />
          </div>

          {file && !extractedData && (
            <Button
              onClick={handleProcess}
              disabled={isProcessing}
              className="w-full"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing PDF...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Extract Tariff Data
                </>
              )}
            </Button>
          )}

          {extractedData && (
            <ScrollArea className="h-[500px] border rounded-lg p-4">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Supply Authority</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p><strong>Name:</strong> {extractedData.supplyAuthority.name}</p>
                      {extractedData.supplyAuthority.region && (
                        <p><strong>Region:</strong> {extractedData.supplyAuthority.region}</p>
                      )}
                      {extractedData.supplyAuthority.nersaIncreasePercentage && (
                        <p><strong>NERSA Increase:</strong> {extractedData.supplyAuthority.nersaIncreasePercentage}%</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">
                    Tariff Structures ({extractedData.tariffStructures.length})
                  </h3>
                  {extractedData.tariffStructures.map((structure, idx) => (
                    <Card key={idx}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          {structure.name}
                          <Badge>{structure.tariffType}</Badge>
                          {structure.usesTou && <Badge variant="outline">TOU</Badge>}
                        </CardTitle>
                        <CardDescription>{structure.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div>
                          <p className="text-sm text-muted-foreground">
                            Effective: {structure.effectiveFrom}
                            {structure.effectiveTo && ` - ${structure.effectiveTo}`}
                          </p>
                        </div>

                        {structure.blocks.length > 0 && (
                          <div>
                            <h4 className="font-semibold mb-2">Blocks ({structure.blocks.length})</h4>
                            <div className="space-y-1">
                              {structure.blocks.map((block, bidx) => (
                                <p key={bidx} className="text-sm">
                                  Block {block.blockNumber}: {block.kwhFrom} - {block.kwhTo || '∞'} kWh 
                                  @ {block.energyChargeCents}c/kWh
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {structure.charges.length > 0 && (
                          <div>
                            <h4 className="font-semibold mb-2">Charges ({structure.charges.length})</h4>
                            <div className="space-y-1">
                              {structure.charges.map((charge, cidx) => (
                                <p key={cidx} className="text-sm">
                                  {charge.description}: R{charge.chargeAmount} {charge.unit}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {structure.touPeriods && structure.touPeriods.length > 0 && (
                          <div>
                            <h4 className="font-semibold mb-2">TOU Periods ({structure.touPeriods.length})</h4>
                            <div className="space-y-1">
                              {structure.touPeriods.map((period, pidx) => (
                                <p key={pidx} className="text-sm">
                                  {period.periodType} ({period.season}, {period.dayType}): 
                                  {period.startHour}:00-{period.endHour}:00 @ {period.energyChargeCents}c/kWh
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex-1"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save to Database"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setExtractedData(null);
                      setFile(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </ScrollArea>
          )}

          {!extractedData && !file && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Select a NERSA tariff PDF document to begin
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
