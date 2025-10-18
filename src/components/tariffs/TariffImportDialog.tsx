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

interface MunicipalityInfo {
  name: string;
  nersaIncrease: number;
  province?: string;
}

interface MunicipalityProgress extends MunicipalityInfo {
  status: 'pending' | 'extracting' | 'saving' | 'complete' | 'error';
  error?: string;
  data?: ExtractedTariffData;
}

export default function PdfImportDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [municipalities, setMunicipalities] = useState<MunicipalityProgress[]>([]);
  const [currentMunicipality, setCurrentMunicipality] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const fileType = selectedFile.type;
      const fileName = selectedFile.name.toLowerCase();
      
      if (
        fileType === "application/pdf" || 
        fileType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        fileType === "application/vnd.ms-excel" ||
        fileName.endsWith('.xlsx') ||
        fileName.endsWith('.xls')
      ) {
        setFile(selectedFile);
        setMunicipalities([]);
        setCurrentMunicipality(null);
      } else {
        toast.error("Please select a PDF or Excel file");
      }
    }
  };

  const extractTextFromPdf = async (pdfFile: File): Promise<string> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = "";
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

  const handleIdentifyMunicipalities = async () => {
    if (!file) {
      toast.error("Please select a file");
      return;
    }

    setIsProcessing(true);
    const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
    
    console.log(`Processing ${isExcel ? 'Excel' : 'PDF'} file:`, file.name);

    try {
      if (isExcel) {
        await handleExcelIdentification();
      } else {
        await handlePdfIdentification();
      }
    } catch (error: any) {
      console.error("Error identifying municipalities:", error);
      toast.error(error.message || "Failed to identify municipalities");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExcelIdentification = async () => {
    const XLSX = await import('xlsx');
    const arrayBuffer = await file!.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    const foundMunicipalities: MunicipalityProgress[] = [];
    
    // Process each sheet
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      // Look for municipality header in first few rows
      for (let i = 0; i < Math.min(5, jsonData.length); i++) {
        const row = jsonData[i];
        const cellValue = row[0]?.toString() || '';
        
        // Match pattern: "MUNICIPALITY - XX.XX%"
        const match = cellValue.match(/^([A-Z\s&]+?)\s*-\s*(\d+\.?\d*)%/);
        if (match) {
          const name = match[1].trim();
          const nersaIncrease = parseFloat(match[2]);
          
          foundMunicipalities.push({
            name,
            nersaIncrease,
            province: 'Eastern Cape', // Can be extracted from filename or sheet
            status: 'pending'
          });
          break; // Found municipality for this sheet, move to next
        }
      }
    }
    
    if (foundMunicipalities.length === 0) {
      throw new Error("No municipalities found in Excel file. Expected format: 'MUNICIPALITY - XX.XX%'");
    }
    
    setMunicipalities(foundMunicipalities);
    toast.success(`Found ${foundMunicipalities.length} municipality/municipalities in Excel. Ready to extract!`);
  };

  const handlePdfIdentification = async () => {
    const documentContent = await extractTextFromPdf(file!);
    console.log("Extracted text length:", documentContent.length);

    const { data, error } = await supabase.functions.invoke("extract-tariff-data", {
      body: { documentContent, phase: "identify" }
    });

    if (error) throw error;
    if (!data.success || !data.municipalities) {
      throw new Error("Failed to identify municipalities");
    }

    const foundMunicipalities: MunicipalityProgress[] = data.municipalities.map((m: MunicipalityInfo) => ({
      name: m.name,
      nersaIncrease: m.nersaIncrease,
      province: m.province,
      status: 'pending' as const
    }));

    setMunicipalities(foundMunicipalities);
    toast.success(`Found ${foundMunicipalities.length} municipality/municipalities. Click each to extract and save.`);
  };

  const handleExtractAndSave = async (municipalityName: string, index: number) => {
    if (!file) return;

    setCurrentMunicipality(municipalityName);
    setMunicipalities(prev => prev.map((m, i) => 
      i === index ? { ...m, status: 'extracting' } : m
    ));

    const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');

    try {
      let extractedData: ExtractedTariffData;
      
      if (isExcel) {
        extractedData = await extractFromExcel(municipalityName);
      } else {
        const documentContent = await extractTextFromPdf(file);
        console.log(`Extracting tariffs for: ${municipalityName}`);
        
        const { data, error } = await supabase.functions.invoke("extract-tariff-data", {
          body: { documentContent, phase: "extract", municipalityName }
        });

        if (error) throw error;
        if (!data.success || !data.data) {
          throw new Error("Failed to extract tariff data");
        }
        
        extractedData = data.data;
      }

      console.log(`Extracted ${extractedData.tariffStructures.length} tariff structures`);

      // Update status to saving
      setMunicipalities(prev => prev.map((m, i) => 
        i === index ? { ...m, status: 'saving', data: extractedData } : m
      ));

      // Save to database
      await saveTariffData(extractedData);

      // Mark as complete
      setMunicipalities(prev => prev.map((m, i) => 
        i === index ? { ...m, status: 'complete' } : m
      ));

      toast.success(`Successfully saved tariffs for ${municipalityName}`);
    } catch (error: any) {
      console.error(`Error processing ${municipalityName}:`, error);
      setMunicipalities(prev => prev.map((m, i) => 
        i === index ? { ...m, status: 'error', error: error.message } : m
      ));
      toast.error(`Failed to process ${municipalityName}: ${error.message}`);
    } finally {
      setCurrentMunicipality(null);
    }
  };

  const extractFromExcel = async (municipalityName: string): Promise<ExtractedTariffData> => {
    const XLSX = await import('xlsx');
    const arrayBuffer = await file!.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    // Find the sheet for this municipality
    let targetSheet = null;
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      // Check first few rows for municipality name
      for (let i = 0; i < Math.min(5, jsonData.length); i++) {
        const cellValue = jsonData[i][0]?.toString() || '';
        if (cellValue.includes(municipalityName)) {
          targetSheet = jsonData;
          break;
        }
      }
      if (targetSheet) break;
    }
    
    if (!targetSheet) {
      throw new Error(`Municipality ${municipalityName} not found in Excel file`);
    }
    
    // Parse the sheet data
    const tariffStructures: any[] = [];
    let currentTariff: any = null;
    let nersaIncrease = 0;
    
    for (let i = 0; i < targetSheet.length; i++) {
      const row = targetSheet[i];
      const col0 = row[0]?.toString().trim() || '';
      const col1 = row[1];
      
      // Extract NERSA percentage from header
      if (col0.includes('%')) {
        const match = col0.match(/(\d+\.?\d*)%/);
        if (match) nersaIncrease = parseFloat(match[1]);
        continue;
      }
      
      // Detect new tariff section (no value in col1, descriptive name)
      if (col0 && !col1 && !col0.includes('Block') && !col0.includes('Charge') && !col0.includes('Season')) {
        // Save previous tariff if exists
        if (currentTariff && (currentTariff.blocks.length > 0 || currentTariff.charges.length > 0)) {
          tariffStructures.push(currentTariff);
        }
        
        // Start new tariff
        const tariffType = col0.toLowerCase().includes('domestic') ? 'domestic' :
                          col0.toLowerCase().includes('commercial') ? 'commercial' :
                          col0.toLowerCase().includes('industrial') ? 'industrial' :
                          col0.toLowerCase().includes('agricultural') ? 'agricultural' : 'commercial';
        
        currentTariff = {
          name: col0,
          tariffType,
          meterConfiguration: col0.toLowerCase().includes('prepaid') ? 'prepaid' : 
                             col0.toLowerCase().includes('conventional') ? 'conventional' : null,
          effectiveFrom: '2025-07-01',
          effectiveTo: null,
          description: col0,
          usesTou: false,
          blocks: [],
          charges: [],
          touPeriods: []
        };
        continue;
      }
      
      // Parse blocks
      if (col0.includes('Block') && col1) {
        const blockMatch = col0.match(/Block \d+ \((.+?)\)/);
        if (blockMatch && currentTariff) {
          const range = blockMatch[1];
          const [from, to] = range.includes('-') ? 
            range.split('-').map(s => parseFloat(s.trim())) :
            range.includes('>') ? [parseFloat(range.replace('>', '')), null] :
            [0, null];
          
          currentTariff.blocks.push({
            blockNumber: currentTariff.blocks.length + 1,
            kwhFrom: from,
            kwhTo: to,
            energyChargeCents: parseFloat(col1.toString().replace(/\s/g, ''))
          });
        }
        continue;
      }
      
      // Parse charges
      if (col0.includes('Charge') && col1 && currentTariff) {
        const chargeType = col0.includes('Basic') ? 'basic_monthly' :
                          col0.includes('Demand') ? 'distribution_network_capacity' :
                          col0.includes('Energy') ? 'service' : 'service';
        
        const unit = col0.includes('R/month') || col0.includes('month') ? 'R/month' :
                    col0.includes('R/kVA') ? 'R/kVA/month' :
                    col0.includes('c/kWh') || col0.includes('Energy') ? 'c/kWh' : 'R/month';
        
        currentTariff.charges.push({
          chargeType,
          chargeAmount: parseFloat(col1.toString().replace(/\s/g, '')),
          description: col0,
          unit
        });
      }
    }
    
    // Add last tariff
    if (currentTariff && (currentTariff.blocks.length > 0 || currentTariff.charges.length > 0)) {
      tariffStructures.push(currentTariff);
    }
    
    return {
      supplyAuthority: {
        name: municipalityName,
        region: 'Eastern Cape',
        nersaIncreasePercentage: nersaIncrease
      },
      tariffStructures
    };
  };

  const saveTariffData = async (extractedData: ExtractedTariffData) => {
    console.log("Saving tariff data:", extractedData);
    
    // 1. Check if supply authority already exists
    const { data: existingAuthority } = await supabase
      .from("supply_authorities")
      .select("id")
      .eq("name", extractedData.supplyAuthority.name)
      .maybeSingle();

    let authorityId: string;

    if (existingAuthority) {
      console.log("Using existing supply authority:", existingAuthority.id);
      authorityId = existingAuthority.id;
    } else {
      // Insert new supply authority
      const { data: newAuthority, error: authorityError } = await supabase
        .from("supply_authorities")
        .insert({
          name: extractedData.supplyAuthority.name,
          region: extractedData.supplyAuthority.region,
          nersa_increase_percentage: extractedData.supplyAuthority.nersaIncreasePercentage,
          active: true
        })
        .select()
        .single();

      if (authorityError) throw new Error(`Failed to create supply authority: ${authorityError.message}`);
      console.log("Created new supply authority:", newAuthority.id);
      authorityId = newAuthority.id;
    }

    // 2. Insert tariff structures
    for (const structure of extractedData.tariffStructures) {
      console.log(`Saving tariff structure: ${structure.name}`);
      
      const { data: tariff, error: tariffError } = await supabase
        .from("tariff_structures")
        .insert({
          supply_authority_id: authorityId,
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

      if (tariffError) throw new Error(`Failed to create tariff "${structure.name}": ${tariffError.message}`);

      // Insert blocks
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

        if (blocksError) throw new Error(`Failed to create blocks: ${blocksError.message}`);
      }

      // Insert charges
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

        if (chargesError) throw new Error(`Failed to create charges: ${chargesError.message}`);
      }

      // Insert TOU periods
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

        if (touError) throw new Error(`Failed to create TOU periods: ${touError.message}`);
      }
    }
  };

  const getStatusIcon = (status: MunicipalityProgress['status']) => {
    switch (status) {
      case 'pending':
        return <AlertCircle className="w-5 h-5 text-muted-foreground" />;
      case 'extracting':
      case 'saving':
        return <Loader2 className="w-5 h-5 animate-spin text-primary" />;
      case 'complete':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-destructive" />;
    }
  };

  const getStatusText = (status: MunicipalityProgress['status']) => {
    switch (status) {
      case 'pending':
        return 'Ready to process';
      case 'extracting':
        return 'Extracting tariffs...';
      case 'saving':
        return 'Saving to database...';
      case 'complete':
        return 'Complete';
      case 'error':
        return 'Failed';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <FileUp className="w-4 h-4" />
          Import Tariffs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Tariff Data</DialogTitle>
          <DialogDescription>
            Upload a NERSA tariff document (PDF or Excel). Excel files are recommended for faster, more accurate extraction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pdf-file">Select Document</Label>
            <Input
              id="pdf-file"
              type="file"
              accept=".pdf,.xlsx,.xls"
              onChange={handleFileChange}
              disabled={isProcessing}
            />
            <p className="text-xs text-muted-foreground">
              Supported formats: PDF or Excel (.xlsx, .xls). Excel is faster and more accurate!
            </p>
          </div>

          {file && municipalities.length === 0 && (
            <Button
              onClick={handleIdentifyMunicipalities}
              disabled={isProcessing}
              className="w-full"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Identifying Municipalities...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Identify Municipalities
                </>
              )}
            </Button>
          )}

          {municipalities.length > 0 && (
            <div className="space-y-4">
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                <h3 className="font-semibold mb-2">Found {municipalities.length} Municipality/Municipalities</h3>
                <p className="text-sm text-muted-foreground">
                  Click "Extract & Save" for each municipality to process them individually.
                </p>
              </div>

              <ScrollArea className="h-[400px] border rounded-lg p-4">
                <div className="space-y-3">
                  {municipalities.map((municipality, index) => (
                    <Card key={index}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {getStatusIcon(municipality.status)}
                            <div>
                              <CardTitle className="text-lg">{municipality.name}</CardTitle>
                              <CardDescription>
                                {municipality.province && `${municipality.province} · `}
                                NERSA: {municipality.nersaIncrease}% · {getStatusText(municipality.status)}
                              </CardDescription>
                              {municipality.error && (
                                <p className="text-sm text-destructive mt-1">{municipality.error}</p>
                              )}
                            </div>
                          </div>
                          <Button
                            onClick={() => handleExtractAndSave(municipality.name, index)}
                            disabled={
                              municipality.status !== 'pending' || 
                              currentMunicipality !== null
                            }
                            size="sm"
                          >
                            {municipality.status === 'pending' ? 'Extract & Save' : getStatusText(municipality.status)}
                          </Button>
                        </div>
                      </CardHeader>
                      {municipality.data && municipality.status === 'complete' && (
                        <CardContent className="pt-0">
                          <p className="text-sm text-muted-foreground">
                            Saved {municipality.data.tariffStructures.length} tariff structure(s)
                          </p>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              </ScrollArea>

              {municipalities.every(m => m.status === 'complete') && (
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setIsOpen(false);
                      setFile(null);
                      setMunicipalities([]);
                      window.location.reload();
                    }}
                    className="flex-1"
                    size="lg"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Done - Refresh Page
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
