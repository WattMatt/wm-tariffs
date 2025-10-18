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
      
      let municipalityFound = false;
      
      // Look for municipality header in first 10 rows
      for (let i = 0; i < Math.min(10, jsonData.length); i++) {
        const row = jsonData[i];
        const cellValue = row[0]?.toString() || '';
        
        // Pattern 1: "MUNICIPALITY - XX.XX%"
        let match = cellValue.match(/^([A-Z\s&]+?)\s*-?\s*(\d+[,.]?\d*)%/);
        if (match) {
          const name = match[1].trim();
          const nersaIncrease = parseFloat(match[2].replace(',', '.'));
          
          foundMunicipalities.push({
            name,
            nersaIncrease,
            province: file!.name.includes('Eastern') ? 'Eastern Cape' : 
                     file!.name.includes('Free') ? 'Free State' : 
                     file!.name.includes('Western') ? 'Western Cape' :
                     file!.name.includes('Northern') ? 'Northern Cape' :
                     file!.name.includes('Gauteng') ? 'Gauteng' :
                     file!.name.includes('KwaZulu') || file!.name.includes('KZN') ? 'KwaZulu-Natal' :
                     file!.name.includes('Limpopo') ? 'Limpopo' :
                     file!.name.includes('Mpumalanga') ? 'Mpumalanga' :
                     file!.name.includes('North West') || file!.name.includes('NorthWest') ? 'North West' : 'Unknown',
            status: 'pending'
          });
          municipalityFound = true;
          break;
        }
        
        // Pattern 2: Municipality name followed by percentage in same cell or nearby (e.g., "Nkandla 10,89%")
        const nameWithPercent = cellValue.match(/^([A-Z][A-Za-z\s&]+?)\s+(\d+[,.]?\d*)%/);
        if (nameWithPercent && !municipalityFound) {
          const name = nameWithPercent[1].trim();
          const nersaIncrease = parseFloat(nameWithPercent[2].replace(',', '.'));
          
          foundMunicipalities.push({
            name,
            nersaIncrease,
            province: file!.name.includes('Eastern') ? 'Eastern Cape' : 
                     file!.name.includes('Free') ? 'Free State' : 
                     file!.name.includes('Western') ? 'Western Cape' :
                     file!.name.includes('Northern') ? 'Northern Cape' :
                     file!.name.includes('Gauteng') ? 'Gauteng' :
                     file!.name.includes('KwaZulu') || file!.name.includes('KZN') ? 'KwaZulu-Natal' :
                     file!.name.includes('Limpopo') ? 'Limpopo' :
                     file!.name.includes('Mpumalanga') ? 'Mpumalanga' :
                     file!.name.includes('North West') || file!.name.includes('NorthWest') ? 'North West' : 'Unknown',
            status: 'pending'
          });
          municipalityFound = true;
          break;
        }
        
        // Pattern 3: Look for cells containing percentage (e.g., "10,89%")
        for (let j = 0; j < row.length; j++) {
          const cell = row[j]?.toString() || '';
          const percentMatch = cell.match(/(\d+[,.]?\d*)%/);
          if (percentMatch) {
            // Look for municipality name in nearby cells or previous rows
            let municipalityName = '';
            
            // Check current row for municipality name
            if (j > 0) {
              municipalityName = row[j - 1]?.toString().trim() || '';
            }
            
            // Check previous rows if not found
            if (!municipalityName && i > 0) {
              municipalityName = jsonData[i - 1][0]?.toString().trim() || '';
            }
            
            // Use sheet name if still not found
            if (!municipalityName) {
              municipalityName = sheetName;
            }
            
            if (municipalityName && !foundMunicipalities.some(m => m.name === municipalityName)) {
              foundMunicipalities.push({
                name: municipalityName,
                nersaIncrease: parseFloat(percentMatch[1].replace(',', '.')),
                province: file!.name.includes('Eastern') ? 'Eastern Cape' : 
                         file!.name.includes('Free') ? 'Free State' : 
                         file!.name.includes('Western') ? 'Western Cape' :
                         file!.name.includes('Northern') ? 'Northern Cape' :
                         file!.name.includes('Gauteng') ? 'Gauteng' :
                         file!.name.includes('KwaZulu') || file!.name.includes('KZN') ? 'KwaZulu-Natal' :
                         file!.name.includes('Limpopo') ? 'Limpopo' :
                         file!.name.includes('Mpumalanga') ? 'Mpumalanga' :
                         file!.name.includes('North West') || file!.name.includes('NorthWest') ? 'North West' : 'Unknown',
                status: 'pending'
              });
              municipalityFound = true;
              break;
            }
          }
        }
        
        if (municipalityFound) break;
      }
      
      // If still no pattern found, use sheet name as municipality
      if (!municipalityFound && sheetName && !sheetName.match(/^Sheet\d+$/i)) {
        foundMunicipalities.push({
          name: sheetName,
          nersaIncrease: 0,
          province: file!.name.includes('Eastern') ? 'Eastern Cape' : 
                   file!.name.includes('Free') ? 'Free State' : 'Unknown',
          status: 'pending'
        });
      }
    }
    
    if (foundMunicipalities.length === 0) {
      throw new Error("No municipalities found in Excel file. Please ensure each sheet contains municipality data.");
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

  const processSingleMunicipality = async (municipalityName: string, index: number) => {
    const isExcel = file!.name.toLowerCase().endsWith('.xlsx') || file!.name.toLowerCase().endsWith('.xls');

    try {
      let extractedData: ExtractedTariffData;
      
      if (isExcel) {
        extractedData = await extractFromExcel(municipalityName);
      } else {
        const documentContent = await extractTextFromPdf(file!);
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

      return true;
    } catch (error: any) {
      console.error(`Error processing ${municipalityName}:`, error);
      setMunicipalities(prev => prev.map((m, i) => 
        i === index ? { ...m, status: 'error', error: error.message } : m
      ));
      throw error;
    }
  };

  const handleExtractAndSave = async (municipalityName: string, index: number) => {
    if (!file) return;

    setCurrentMunicipality(municipalityName);
    setMunicipalities(prev => prev.map((m, i) => 
      i === index ? { ...m, status: 'extracting' } : m
    ));

    try {
      await processSingleMunicipality(municipalityName, index);
      toast.success(`Successfully saved tariffs for ${municipalityName}`);
    } catch (error: any) {
      toast.error(`Failed to process ${municipalityName}: ${error.message}`);
    } finally {
      setCurrentMunicipality(null);
    }
  };

  const handleBulkExtractAndSave = async () => {
    if (!file) return;

    setIsProcessing(true);
    let successCount = 0;
    let failCount = 0;

    console.log(`Starting bulk processing of ${municipalities.length} municipalities`);

    for (let i = 0; i < municipalities.length; i++) {
      const municipality = municipalities[i];
      
      // Skip already completed or currently processing
      if (municipality.status === 'complete') {
        successCount++;
        continue;
      }

      setCurrentMunicipality(municipality.name);
      setMunicipalities(prev => prev.map((m, idx) => 
        idx === i ? { ...m, status: 'extracting' } : m
      ));

      try {
        await processSingleMunicipality(municipality.name, i);
        successCount++;
        console.log(`✓ Completed ${municipality.name} (${successCount}/${municipalities.length})`);
      } catch (error: any) {
        failCount++;
        console.error(`✗ Failed ${municipality.name}:`, error.message);
        // Continue with next municipality even if this one fails
      }

      // Small delay between municipalities to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setCurrentMunicipality(null);
    setIsProcessing(false);

    if (failCount === 0) {
      toast.success(`Successfully processed all ${successCount} municipalities!`);
    } else {
      toast.warning(`Completed ${successCount} municipalities, ${failCount} failed. Check logs for details.`);
    }
  };

  const extractFromExcel = async (municipalityName: string): Promise<ExtractedTariffData> => {
    const XLSX = await import('xlsx');
    const arrayBuffer = await file!.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    // Find the sheet for this municipality
    let targetSheet = null;
    let matchedSheetName = '';
    const normalizedMunicipality = municipalityName.toLowerCase().trim();
    
    // First try: Check if sheet name matches municipality
    for (const sheetName of workbook.SheetNames) {
      if (sheetName.toLowerCase().includes(normalizedMunicipality) || 
          normalizedMunicipality.includes(sheetName.toLowerCase())) {
        const worksheet = workbook.Sheets[sheetName];
        targetSheet = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        matchedSheetName = sheetName;
        console.log(`Found municipality by sheet name: ${sheetName}`);
        break;
      }
    }
    
    // Second try: Check sheet content for municipality name
    if (!targetSheet) {
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        // Check first 10 rows for municipality name (case-insensitive partial match)
        for (let i = 0; i < Math.min(10, jsonData.length); i++) {
          const cellValue = jsonData[i][0]?.toString().toLowerCase() || '';
          if (cellValue.includes(normalizedMunicipality) || 
              normalizedMunicipality.includes(cellValue)) {
            targetSheet = jsonData;
            matchedSheetName = sheetName;
            console.log(`Found municipality in sheet content: ${sheetName}`);
            break;
          }
        }
        if (targetSheet) break;
      }
    }
    
    // Third try: If still not found and there's only one sheet, use it
    if (!targetSheet && workbook.SheetNames.length === 1) {
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      targetSheet = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      matchedSheetName = sheetName;
      console.log(`Using single sheet: ${sheetName}`);
    }
    
    if (!targetSheet) {
      throw new Error(`Municipality "${municipalityName}" not found in Excel file. Available sheets: ${workbook.SheetNames.join(', ')}`);
    }
    
    // Parse the sheet data
    const tariffStructures: any[] = [];
    let currentTariff: any = null;
    let nersaIncrease = 0;
    let currentSeason: string | null = null; // Track Summer/Winter or Low/High Season
    
    for (let i = 0; i < targetSheet.length; i++) {
      const row = targetSheet[i];
      const col0 = row[0]?.toString().trim() || '';
      const col1 = row[1];
      
      // Extract NERSA percentage from header
      if (col0.includes('%')) {
        const match = col0.match(/(\d+[,.]?\d*)%/);
        if (match) nersaIncrease = parseFloat(match[1].replace(',', '.'));
        continue;
      }
      
      // Track season context
      if (col0.match(/^(Summer|Winter|Low Season|High Season)$/i) && !col1) {
        currentSeason = col0;
        console.log(`Season context: ${currentSeason}`);
        continue;
      }
      
      // Detect new tariff section - improved detection for various formats
      const isTariffHeader = 
        // Pattern 1: Numbered sections like "1. Tariff I:"
        col0.match(/^\d+\./) ||
        // Pattern 2: Lines ending with colon that describe tariffs
        (col0.endsWith(':') && !col1 && !col0.match(/^(Basic|Demand|Access|Service|Energy|Peak|Standard|Off)/i)) ||
        // Pattern 3: ALL CAPS descriptive headers (min 10 chars to catch more patterns)
        (col0 === col0.toUpperCase() && col0.length >= 10 && !col1 && 
         col0.match(/(DOMESTIC|BUSINESS|COMMERCIAL|INDUSTRIAL|AGRICULTURAL|RESELLER|BULK|SCALE)/)) ||
        // Pattern 4: Specific tariff descriptors (more flexible - handles single word like "Commercial")
        (col0.match(/^(Domestic|Business|Commercial|Industrial|Agricultural|Conventional|Prepaid)/i) && 
         (!col1 || col1.toString().trim() === '') &&
         col0.length > 5) ||
        // Pattern 5: Lines that look like tariff headers even without keywords
        (col0.match(/.*(Tariff|Supply|Scale|Demand|Meter).*$/i) && !col1 && col0.length > 8);
      
      if (isTariffHeader) {
        // Save previous tariff if exists
        if (currentTariff && (currentTariff.blocks.length > 0 || currentTariff.charges.length > 0 || currentTariff.touPeriods.length > 0)) {
          tariffStructures.push(currentTariff);
        }
        
        // Start new tariff
        const tariffType = col0.toLowerCase().includes('domestic') || col0.toLowerCase().includes('indigent') || col0.toLowerCase().includes('lifeline') ? 'domestic' :
                          col0.toLowerCase().includes('business') || col0.toLowerCase().includes('commercial') || col0.toLowerCase().includes('reseller') ? 'commercial' :
                          col0.toLowerCase().includes('industrial') ? 'industrial' :
                          col0.toLowerCase().includes('agricultural') || col0.toLowerCase().includes('farm') ? 'agricultural' : 'commercial';
        
        // Check if this is a TOU tariff
        const isTou = col0.toLowerCase().includes('flex') || col0.toLowerCase().includes('tou') || col0.toLowerCase().includes('time of use');
        
        currentTariff = {
          name: col0.replace(/^\d+\.\s*/, '').replace(/:$/, '').trim(), // Clean up name
          tariffType,
          meterConfiguration: col0.toLowerCase().includes('prepaid') ? 'prepaid' : 
                             col0.toLowerCase().includes('conventional') ? 'conventional' : null,
          effectiveFrom: '2025-07-01',
          effectiveTo: null,
          description: col0,
          usesTou: isTou,
          touType: isTou ? 'megaflex' : null,
          blocks: [],
          charges: [],
          touPeriods: []
        };
        currentSeason = null; // Reset season for new tariff
        continue;
      }
      
      if (!currentTariff) continue;
      
      // Parse blocks - improved to handle different formats
      if (col0.match(/Block \d+/i) && col1) {
        const blockMatch = col0.match(/Block \d+ \((.+?)\)/i);
        if (blockMatch) {
          const range = blockMatch[1];
          let from = 0;
          let to: number | null = null;
          
          // Parse range patterns
          if (range.includes('–') || range.includes('-')) {
            // Split on dash (including en-dash and em-dash)
            const parts = range.split(/[–-]/).map(s => s.trim());
            from = parseFloat(parts[0].replace(/[^\d.]/g, ''));
            to = parts[1] ? parseFloat(parts[1].replace(/[^\d.]/g, '')) : null;
          } else if (range.includes('>')) {
            // Greater than pattern like ">650kWh"
            from = parseFloat(range.replace(/[^\d.]/g, ''));
            to = null;
          } else {
            // Single number or other format
            from = parseFloat(range.replace(/[^\d.]/g, '')) || 0;
          }
          
          // Parse value - handle both c/kWh (already in cents) and R/kWh (needs conversion)
          const valueStr = col1.toString().replace(/\s/g, '').replace(',', '.');
          let energyCharge = parseFloat(valueStr);
          
          // If value is less than 10, assume it's in R/kWh and convert to cents
          if (energyCharge < 10) {
            energyCharge = energyCharge * 100;
          }
          
          // Only add block if energy charge is valid
          if (!isNaN(energyCharge) && isFinite(energyCharge) && energyCharge > 0) {
            currentTariff.blocks.push({
              blockNumber: currentTariff.blocks.length + 1,
              kwhFrom: from,
              kwhTo: to,
              energyChargeCents: energyCharge
            });
          } else {
            console.warn(`Skipping invalid block energy charge for "${col0}":`, col1);
          }
        }
        continue;
      }
      
      // Parse TOU periods (Peak/Standard/Off-peak) - improved detection
      if (col0.match(/^(Peak|Standard|Off-?peak)/i) && col1) {
        const periodType = col0.toLowerCase().includes('peak') && !col0.toLowerCase().includes('off') ? 'peak' :
                          col0.toLowerCase().includes('off') ? 'offpeak' : 'standard';
        
        // Parse value - handle both c/kWh and R/kWh
        const valueStr = col1.toString().replace(/\s/g, '').replace(',', '.');
        let energyCharge = parseFloat(valueStr);
        
        // If value is less than 10, assume it's in R/kWh and convert to cents
        if (energyCharge < 10) {
          energyCharge = energyCharge * 100;
        }
        
        if (!isNaN(energyCharge) && isFinite(energyCharge) && energyCharge > 0) {
          currentTariff.usesTou = true;
          currentTariff.touType = 'megaflex';
          
          // Map season to standard format
          const season = currentSeason && (currentSeason.toLowerCase().includes('summer') || currentSeason.toLowerCase().includes('low')) ? 'summer' : 'winter';
          
          // Default time ranges for different periods
          const timeRanges = {
            peak: { start: 7, end: 10 },
            standard: { start: 6, end: 22 },
            offpeak: { start: 22, end: 6 }
          };
          
          currentTariff.touPeriods.push({
            periodType,
            season,
            dayType: 'weekday',
            startHour: timeRanges[periodType as keyof typeof timeRanges].start,
            endHour: timeRanges[periodType as keyof typeof timeRanges].end,
            energyChargeCents: energyCharge
          });
        }
        continue;
      }
      
      // Parse fixed charges - improved to handle various charge types
      if (col0.match(/(Basic|Demand|Access|Service|Capacity|Network|Fixed).*[Cc]harge/i) && col1) {
        const chargeType = col0.toLowerCase().includes('basic') || col0.toLowerCase().includes('monthly') ? 'basic_monthly' :
                          col0.toLowerCase().includes('demand') ? 'demand_kva' :
                          col0.toLowerCase().includes('access') ? 'access_charge' :
                          col0.toLowerCase().includes('capacity') ? 'capacity_charge' :
                          col0.toLowerCase().includes('network') ? 'network_charge' :
                          col0.toLowerCase().includes('fixed') ? 'fixed_charge' :
                          col0.toLowerCase().includes('service') ? 'service_charge' : 'service_charge';
        
        const unit = col0.includes('R/month') || col0.toLowerCase().includes('monthly') || col0.toLowerCase().includes('/month') ? 'R/month' :
                    col0.includes('R/kVA') || col0.toLowerCase().includes('kva') || col0.toLowerCase().includes('/kva') ? 'R/kVA/month' :
                    col0.includes('R/kWh') || col0.toLowerCase().includes('/kwh') ? 'R/kWh' : 'R/month';
        
        // Parse and validate charge amount
        const valueStr = col1.toString().replace(/\s/g, '').replace(',', '.');
        const chargeAmount = parseFloat(valueStr);
        
        // Only add charge if amount is a valid number and positive
        if (!isNaN(chargeAmount) && isFinite(chargeAmount) && chargeAmount > 0) {
          currentTariff.charges.push({
            chargeType,
            chargeAmount,
            description: col0,
            unit
          });
        } else {
          console.warn(`Skipping invalid charge amount for "${col0}":`, col1);
        }
        continue;
      }
      
      // Parse energy charge lines (for simple tariffs without blocks)
      // Enhanced to handle bullet points and various formats
      const energyChargeMatch = col0.match(/[o·•-]?\s*Energy [Cc]harge:?\s*(c\/kWh)?/i);
      if (energyChargeMatch && col1 && currentTariff.blocks.length === 0) {
        // Parse value - handle both c/kWh and R/kWh
        const valueStr = col1.toString().replace(/\s/g, '').replace(',', '.');
        let energyCharge = parseFloat(valueStr);
        
        // If value is less than 10, assume it's in R/kWh and convert to cents
        if (energyCharge < 10) {
          energyCharge = energyCharge * 100;
        }
        
        if (!isNaN(energyCharge) && isFinite(energyCharge) && energyCharge > 0) {
          // Check if we already added this exact energy charge to avoid duplicates
          const isDuplicate = currentTariff.blocks.some(b => 
            Math.abs(b.energyChargeCents - energyCharge) < 0.01
          );
          
          if (!isDuplicate) {
            // Add as a single-rate tariff (block with no limits)
            currentTariff.blocks.push({
              blockNumber: currentTariff.blocks.length + 1,
              kwhFrom: 0,
              kwhTo: null,
              energyChargeCents: energyCharge
            });
          }
        }
      }
    }
    
    // Add last tariff
    if (currentTariff && (currentTariff.blocks.length > 0 || currentTariff.charges.length > 0 || currentTariff.touPeriods.length > 0)) {
      tariffStructures.push(currentTariff);
    }
    
    return {
      supplyAuthority: {
        name: municipalityName,
        region: file!.name.includes('Eastern') ? 'Eastern Cape' : 
               file!.name.includes('Free') ? 'Free State' : 
               file!.name.includes('Western') ? 'Western Cape' :
               file!.name.includes('Northern') ? 'Northern Cape' :
               file!.name.includes('Gauteng') ? 'Gauteng' :
               file!.name.includes('KwaZulu') || file!.name.includes('KZN') ? 'KwaZulu-Natal' :
               file!.name.includes('Limpopo') ? 'Limpopo' :
               file!.name.includes('Mpumalanga') ? 'Mpumalanga' :
               file!.name.includes('North West') || file!.name.includes('NorthWest') ? 'North West' : 'Unknown',
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
      console.log("Updating existing supply authority:", existingAuthority.id);
      
      // Update the region and NERSA percentage to ensure they're current
      const { error: updateError } = await supabase
        .from("supply_authorities")
        .update({
          region: extractedData.supplyAuthority.region,
          nersa_increase_percentage: extractedData.supplyAuthority.nersaIncreasePercentage
        })
        .eq("id", existingAuthority.id);
      
      if (updateError) {
        console.error("Failed to update supply authority:", updateError);
      }
      
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
      
      // Check if tariff already exists
      const { data: existingTariff } = await supabase
        .from("tariff_structures")
        .select("id")
        .eq("supply_authority_id", authorityId)
        .eq("name", structure.name)
        .eq("effective_from", structure.effectiveFrom)
        .maybeSingle();

      let tariff;
      let isNewTariff = false;
      
      if (existingTariff) {
        console.log(`Tariff "${structure.name}" already exists, skipping...`);
        tariff = existingTariff;
      } else {
        const { data: newTariff, error: tariffError } = await supabase
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
        tariff = newTariff;
        isNewTariff = true;
      }

      // Only insert blocks, charges, and TOU periods if this is a new tariff
      if (isNewTariff) {
        // Insert blocks (check for duplicates first)
        if (structure.blocks && structure.blocks.length > 0) {
          for (const block of structure.blocks) {
            const { data: existingBlock } = await supabase
              .from("tariff_blocks")
              .select("id")
              .eq("tariff_structure_id", tariff.id)
              .eq("block_number", block.blockNumber)
              .maybeSingle();

            if (!existingBlock) {
              const { error: blockError } = await supabase
                .from("tariff_blocks")
                .insert({
                  tariff_structure_id: tariff.id,
                  block_number: block.blockNumber,
                  kwh_from: block.kwhFrom,
                  kwh_to: block.kwhTo,
                  energy_charge_cents: block.energyChargeCents
                });

              if (blockError) throw new Error(`Failed to create block ${block.blockNumber}: ${blockError.message}`);
            }
          }
        }

        // Insert charges (check for duplicates first)
        if (structure.charges && structure.charges.length > 0) {
          for (const charge of structure.charges) {
            const { data: existingCharge } = await supabase
              .from("tariff_charges")
              .select("id")
              .eq("tariff_structure_id", tariff.id)
              .eq("charge_type", charge.chargeType)
              .maybeSingle();

            if (!existingCharge) {
              // Validate charge amount before inserting
              if (isNaN(charge.chargeAmount) || !isFinite(charge.chargeAmount)) {
                console.error(`Invalid charge amount for ${charge.chargeType}:`, charge);
                continue; // Skip this charge
              }
              
              const { error: chargeError } = await supabase
                .from("tariff_charges")
                .insert({
                  tariff_structure_id: tariff.id,
                  charge_type: charge.chargeType,
                  charge_amount: charge.chargeAmount,
                  description: charge.description,
                  unit: charge.unit
                });

              if (chargeError) throw new Error(`Failed to create charge "${charge.chargeType}": ${chargeError.message}`);
            }
          }
        }

        // Insert TOU periods (check for duplicates first)
        if (structure.usesTou && structure.touPeriods && structure.touPeriods.length > 0) {
          for (const period of structure.touPeriods) {
            const { data: existingPeriod } = await supabase
              .from("tariff_time_periods")
              .select("id")
              .eq("tariff_structure_id", tariff.id)
              .eq("period_type", period.periodType)
              .eq("season", period.season)
              .eq("day_type", period.dayType)
              .maybeSingle();

            if (!existingPeriod) {
              const { error: touError } = await supabase
                .from("tariff_time_periods")
                .insert({
                  tariff_structure_id: tariff.id,
                  period_type: period.periodType,
                  season: period.season,
                  day_type: period.dayType,
                  start_hour: period.startHour,
                  end_hour: period.endHour,
                  energy_charge_cents: period.energyChargeCents
                });

              if (touError) throw new Error(`Failed to create TOU period: ${touError.message}`);
            }
          }
        }
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
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="font-semibold mb-2">Found {municipalities.length} Municipality/Municipalities</h3>
                    <p className="text-sm text-muted-foreground">
                      Process all at once or select individual municipalities.
                    </p>
                  </div>
                  <Button
                    onClick={handleBulkExtractAndSave}
                    disabled={
                      isProcessing || 
                      municipalities.every(m => m.status === 'complete')
                    }
                    size="sm"
                    className="whitespace-nowrap"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Extract & Save All
                      </>
                    )}
                  </Button>
                </div>
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
                          {municipality.status === 'pending' && (
                            <Button
                              onClick={() => handleExtractAndSave(municipality.name, index)}
                              disabled={currentMunicipality !== null || isProcessing}
                              size="sm"
                              variant="outline"
                            >
                              Process Only This
                            </Button>
                          )}
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
