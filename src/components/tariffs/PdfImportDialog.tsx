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
import ExtractionSteps from "./ExtractionSteps";

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

export default function PdfImportDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedTariffData | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const getCurrentStep = () => {
    if (isSaving) return "save";
    if (extractedData) return "review";
    if (isProcessing) return "extract";
    if (file) return "upload";
    return "upload";
  };

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
    console.log("Starting PDF processing for:", file.name);

    try {
      // Extract text from PDF
      console.log("Extracting text from PDF...");
      const documentContent = await extractTextFromPdf(file);
      console.log("Extracted text length:", documentContent.length, "characters");

      if (!documentContent || documentContent.length < 100) {
        throw new Error("Failed to extract meaningful text from PDF. The file may be image-based or corrupted.");
      }

      // Call edge function to extract structured data
      console.log("Calling edge function to extract tariff data...");
      const { data, error } = await supabase.functions.invoke("extract-tariff-data", {
        body: { documentContent }
      });

      console.log("Edge function response:", { data, error });

      if (error) {
        console.error("Edge function error:", error);
        throw error;
      }

      if (!data) {
        throw new Error("No response from extraction service");
      }

      if (!data.success) {
        console.error("Extraction failed:", data.error);
        throw new Error(data.error || "Failed to extract data");
      }

      if (!data.data || !data.data.supplyAuthority || !data.data.tariffStructures) {
        console.error("Invalid data structure:", data);
        throw new Error("Extracted data is missing required fields");
      }

      console.log("Successfully extracted tariff data:", data.data);
      setExtractedData(data.data);
      toast.success(`Extracted ${data.data.tariffStructures.length} tariff structure(s). Review and save to database.`);
    } catch (error: any) {
      console.error("Error processing PDF:", error);
      toast.error(error.message || "Failed to process PDF");
      setExtractedData(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!extractedData) return;

    setIsSaving(true);
    console.log("Starting to save extracted data to database...");

    try {
      // 1. Insert supply authority
      console.log("Inserting supply authority:", extractedData.supplyAuthority.name);
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

      if (authorityError) {
        console.error("Error inserting supply authority:", authorityError);
        throw new Error(`Failed to create supply authority: ${authorityError.message}`);
      }

      console.log("Supply authority created:", authority);

      // 2. Insert tariff structures
      let structuresCreated = 0;
      for (const structure of extractedData.tariffStructures) {
        console.log(`Inserting tariff structure ${structuresCreated + 1}:`, structure.name);
        
        const { data: tariff, error: tariffError } = await supabase
          .from("tariff_structures")
          .insert({
            supply_authority_id: authority.id,
            name: structure.name,
            tariff_type: structure.tariffType,
            voltage_level: structure.voltageLevel,
            transmission_zone: structure.transmissionZone,
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

        if (tariffError) {
          console.error(`Error inserting tariff structure ${structure.name}:`, tariffError);
          throw new Error(`Failed to create tariff "${structure.name}": ${tariffError.message}`);
        }

        console.log("Tariff structure created:", tariff);

        // 3. Insert blocks
        if (structure.blocks && structure.blocks.length > 0) {
          console.log(`Inserting ${structure.blocks.length} blocks for ${structure.name}`);
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

          if (blocksError) {
            console.error(`Error inserting blocks for ${structure.name}:`, blocksError);
            throw new Error(`Failed to create blocks for "${structure.name}": ${blocksError.message}`);
          }
          console.log(`Blocks inserted successfully`);
        }

        // 4. Insert charges
        if (structure.charges && structure.charges.length > 0) {
          console.log(`Inserting ${structure.charges.length} charges for ${structure.name}`);
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

          if (chargesError) {
            console.error(`Error inserting charges for ${structure.name}:`, chargesError);
            throw new Error(`Failed to create charges for "${structure.name}": ${chargesError.message}`);
          }
          console.log(`Charges inserted successfully`);
        }

        // 5. Insert TOU periods if applicable
        if (structure.usesTou && structure.touPeriods && structure.touPeriods.length > 0) {
          console.log(`Inserting ${structure.touPeriods.length} TOU periods for ${structure.name}`);
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

          if (touError) {
            console.error(`Error inserting TOU periods for ${structure.name}:`, touError);
            throw new Error(`Failed to create TOU periods for "${structure.name}": ${touError.message}`);
          }
          console.log(`TOU periods inserted successfully`);
        }

        structuresCreated++;
      }

      console.log(`Successfully saved ${structuresCreated} tariff structures`);
      toast.success(`Successfully saved ${structuresCreated} tariff structure(s) to database!`);
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

        <ExtractionSteps currentStep={getCurrentStep()} />

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
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Selected: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(2)} KB)
              </div>
              <Button
                onClick={handleProcess}
                disabled={isProcessing}
                className="w-full"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing PDF (this may take 30-60 seconds)...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Extract Tariff Data with AI
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                The AI will analyze the document and extract tariff structures, charges, and TOU periods
              </p>
            </div>
          )}

          {extractedData && (
            <div className="space-y-4">
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold">Extraction Complete - Review Before Saving</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  The AI has extracted the following tariff data. Please review carefully before saving to the database.
                </p>
              </div>

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
                          {structure.voltageLevel && (
                            <Badge variant="secondary" className="text-xs">{structure.voltageLevel}</Badge>
                          )}
                        </CardTitle>
                        <CardDescription>
                          {structure.description}
                          {structure.transmissionZone && (
                            <span className="ml-2 text-xs">Zone: {structure.transmissionZone}</span>
                          )}
                        </CardDescription>
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
                                  @ R{(block.energyChargeCents / 100).toFixed(4)}/kWh
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
                                  {period.startHour}:00-{period.endHour}:00 @ R{(period.energyChargeCents / 100).toFixed(4)}/kWh
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="flex gap-2 pt-4 border-t">
                  <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex-1"
                    size="lg"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving to Database...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Confirm & Save to Database
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setExtractedData(null);
                      setFile(null);
                    }}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
              </ScrollArea>
            </div>
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
