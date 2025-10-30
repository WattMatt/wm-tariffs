import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Gauge, Upload, Pencil, Trash2, Database, Trash } from "lucide-react";
import { toast } from "sonner";
import CsvImportDialog from "./CsvImportDialog";
import MeterReadingsView from "./MeterReadingsView";
import CsvBulkIngestionTool from "./CsvBulkIngestionTool";
import SingleCsvUploadDialog from "./SingleCsvUploadDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Meter {
  id: string;
  meter_number: string;
  meter_type: string;
  name: string | null;
  location: string | null;
  area: number | null;
  rating: string | null;
  cable_specification: string | null;
  serial_number: string | null;
  ct_type: string | null;
  tariff: string | null;
  tariff_structure_id: string | null;
  is_revenue_critical: boolean;
  created_at: string;
  has_raw_csv?: boolean;
  has_parsed?: boolean;
}

interface TariffStructure {
  id: string;
  name: string;
  tariff_type: string;
  description: string | null;
}

interface MetersTabProps {
  siteId: string;
}

export default function MetersTab({ siteId }: MetersTabProps) {
  const [meters, setMeters] = useState<Meter[]>([]);
  const [tariffStructures, setTariffStructures] = useState<TariffStructure[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevenueCritical, setIsRevenueCritical] = useState(false);
  const [csvImportMeterId, setCsvImportMeterId] = useState<string | null>(null);
  const [isCsvDialogOpen, setIsCsvDialogOpen] = useState(false);
  const [viewReadingsMeterId, setViewReadingsMeterId] = useState<string | null>(null);
  const [viewReadingsMeterNumber, setViewReadingsMeterNumber] = useState<string>("");
  const [isReadingsViewOpen, setIsReadingsViewOpen] = useState(false);
  const [isRawCsvViewOpen, setIsRawCsvViewOpen] = useState(false);
  const [rawCsvData, setRawCsvData] = useState<any[]>([]);
  const [rawCsvHeaders, setRawCsvHeaders] = useState<string[]>([]);
  const [parsedCsvData, setParsedCsvData] = useState<any[]>([]);
  const [parsedCsvHeaders, setParsedCsvHeaders] = useState<string[]>([]);
  const [isParsedCsvViewOpen, setIsParsedCsvViewOpen] = useState(false);
  const [editingMeter, setEditingMeter] = useState<Meter | null>(null);
  const [deletingMeterId, setDeletingMeterId] = useState<string | null>(null);
  const [singleUploadMeterId, setSingleUploadMeterId] = useState<string | null>(null);
  const [singleUploadMeterNumber, setSingleUploadMeterNumber] = useState<string>("");
  const [isSingleUploadOpen, setIsSingleUploadOpen] = useState(false);
  const [selectedMeterIds, setSelectedMeterIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkCsvDeleting, setIsBulkCsvDeleting] = useState(false);

  useEffect(() => {
    fetchMeters();
    fetchTariffStructures();
    
    // Set up realtime subscription for live meter and CSV file updates
    const metersChannel = supabase
      .channel('meters-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'meters',
          filter: `site_id=eq.${siteId}`
        },
        () => {
          console.log('Meters changed, reloading...');
          fetchMeters();
        }
      )
      .subscribe();
    
    const csvFilesChannel = supabase
      .channel('meter-csv-files-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'meter_csv_files',
          filter: `site_id=eq.${siteId}`
        },
        () => {
          console.log('CSV files changed, reloading meters...');
          fetchMeters();
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(metersChannel);
      supabase.removeChannel(csvFilesChannel);
    };
  }, [siteId]);

  const fetchTariffStructures = async () => {
    // Fetch site to get supply_authority_id
    const { data: site } = await supabase
      .from('sites')
      .select('supply_authority_id')
      .eq('id', siteId)
      .single();

    if (!site?.supply_authority_id) {
      return;
    }

    // Fetch tariff structures for the supply authority
    const { data, error } = await supabase
      .from('tariff_structures')
      .select('id, name, tariff_type, description')
      .eq('supply_authority_id', site.supply_authority_id)
      .eq('active', true)
      .order('name');

    if (error) {
      console.error('Error fetching tariff structures:', error);
      return;
    }

    setTariffStructures(data || []);
  };

  const fetchMeters = async () => {
    console.log("Fetching meters for siteId:", siteId);
    const { data, error } = await supabase
      .from("meters")
      .select("*")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch meters");
    } else {
      // Check which meters have raw CSV files and parsed data
      const metersWithStatus = await Promise.all(
        (data || []).map(async (meter) => {
          // Check for raw CSV files (uploaded)
          const { count: csvFilesCount } = await supabase
            .from("meter_csv_files")
            .select("*", { count: "exact", head: true })
            .eq("meter_id", meter.id);
          
          // Check for parsed CSV files (those with parsed_file_path)
          const { count: parsedFilesCount } = await supabase
            .from("meter_csv_files")
            .select("*", { count: "exact", head: true })
            .eq("meter_id", meter.id)
            .not("parsed_file_path", "is", null);
          
          const hasRawCsv = (csvFilesCount ?? 0) > 0;
          const hasParsed = (parsedFilesCount ?? 0) > 0;
          
          console.log(`Meter ${meter.meter_number}: Raw CSV: ${hasRawCsv}, Parsed: ${hasParsed}`);
          
          return {
            ...meter,
            has_raw_csv: hasRawCsv,
            has_parsed: hasParsed
          };
        })
      );
      
      setMeters(metersWithStatus);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const tariffStructureId = formData.get("tariff_structure_id") as string;
    const meterData = {
      meter_number: formData.get("meter_number") as string,
      meter_type: formData.get("meter_type") as string,
      name: formData.get("name") as string,
      location: formData.get("location") as string,
      area: formData.get("area") ? parseFloat(formData.get("area") as string) : null,
      rating: formData.get("rating") as string,
      cable_specification: formData.get("cable_specification") as string,
      serial_number: formData.get("serial_number") as string,
      ct_type: formData.get("ct_type") as string,
      tariff: formData.get("tariff") as string,
      tariff_structure_id: tariffStructureId === "none" ? null : tariffStructureId,
      is_revenue_critical: isRevenueCritical,
    };

    let error;
    if (editingMeter) {
      const { error: updateError } = await supabase
        .from("meters")
        .update(meterData)
        .eq("id", editingMeter.id);
      error = updateError;
    } else {
      const { error: insertError } = await supabase
        .from("meters")
        .insert({ ...meterData, site_id: siteId });
      error = insertError;
    }

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(editingMeter ? "Meter updated successfully" : "Meter created successfully");
      setIsDialogOpen(false);
      setEditingMeter(null);
      setIsRevenueCritical(false);
      fetchMeters();
    }
  };

  const handleEdit = (meter: Meter) => {
    setEditingMeter(meter);
    setIsRevenueCritical(meter.is_revenue_critical);
    setIsDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingMeterId) return;

    const { error } = await supabase
      .from("meters")
      .delete()
      .eq("id", deletingMeterId);

    if (error) {
      toast.error("Failed to delete meter");
    } else {
      toast.success("Meter deleted successfully");
      fetchMeters();
    }
    setDeletingMeterId(null);
  };

  const fetchRawCsvData = async (meterId: string) => {
    const { data: files, error: filesError } = await supabase
      .from('meter_csv_files')
      .select('file_path, file_name, separator, header_row_number')
      .eq('meter_id', meterId)
      .order('uploaded_at', { ascending: false })
      .limit(1);

    if (filesError || !files || files.length === 0) {
      toast.error("No CSV file found for this meter");
      return;
    }

    const { data: fileData, error: storageError } = await supabase.storage
      .from('meter-csvs')
      .download(files[0].file_path);

    if (storageError || !fileData) {
      toast.error("Failed to download CSV file");
      return;
    }

    // Use the stored separator to parse the file
    const separator = files[0].separator || 'tab';
    const headerRowNumber = files[0].header_row_number || 1;
    
    const separatorChar = separator === 'tab' ? '\t' : 
                          separator === 'comma' ? ',' : 
                          separator === 'semicolon' ? ';' : 
                          separator === 'space' ? ' ' : ',';

    const text = await fileData.text();
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return;

    // Use the header row number to determine which line contains headers
    const headerLine = Math.max(0, headerRowNumber - 1);
    if (headerLine >= lines.length) {
      toast.error("Invalid header row number");
      return;
    }

    const headers = lines[headerLine].split(separatorChar).map(h => h.trim());
    const rows = lines.slice(headerLine + 1).map(line => {
      const values = line.split(separatorChar).map(v => v.trim());
      return headers.reduce((obj, header, idx) => {
        obj[header] = values[idx] || '';
        return obj;
      }, {} as any);
    });

    setRawCsvHeaders(headers);
    setRawCsvData(rows);
  };

  const fetchParsedCsvData = async (meterId: string) => {
    // First, fetch the column mapping from the most recent parsed CSV file
    const { data: csvFile, error: csvError } = await supabase
      .from('meter_csv_files')
      .select('column_mapping')
      .eq('meter_id', meterId)
      .not('column_mapping', 'is', null)
      .order('parsed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (csvError) {
      console.error("Error fetching column mapping:", csvError);
    }

    const columnMapping = csvFile?.column_mapping as any;

    // Fetch readings from the database with metadata (column interpretation)
    const { data: readings, error } = await supabase
      .from('meter_readings')
      .select('*')
      .eq('meter_id', meterId)
      .order('reading_timestamp', { ascending: false })
      .limit(1000); // Limit to 1000 rows for performance

    if (error) {
      toast.error("Failed to fetch parsed data: " + error.message);
      return;
    }

    if (!readings || readings.length === 0) {
      toast.error("No parsed data found for this meter. Please parse the CSV first.");
      return;
    }

    // Extract all unique column names from the imported_fields metadata
    const allFieldNames = new Set<string>();
    readings.forEach(reading => {
      const metadata = reading.metadata as any;
      if (metadata && typeof metadata === 'object' && metadata.imported_fields) {
        Object.keys(metadata.imported_fields).forEach(key => allFieldNames.add(key));
      }
    });

    // Create headers using the original renamed headers from column mapping
    const headers: string[] = [];
    
    // Add timestamp header
    const timestampHeader = columnMapping?.renamedHeaders?.[columnMapping.dateColumn] || 'Timestamp';
    headers.push(timestampHeader);
    
    // Add kWh value header (from the valueColumn)
    const kwhHeader = columnMapping?.renamedHeaders?.[columnMapping.valueColumn] || 'kWh Value';
    headers.push(kwhHeader);
    
    // Only add kva_value if it exists in any reading
    const hasKva = readings.some(r => r.kva_value !== null);
    if (hasKva && columnMapping?.kvaColumn && columnMapping.kvaColumn !== '-1') {
      const kvaHeader = columnMapping.renamedHeaders?.[columnMapping.kvaColumn] || 'kVA Value';
      headers.push(kvaHeader);
    }
    
    // Add all metadata field names as separate columns (these already use renamed headers)
    const metadataFields = Array.from(allFieldNames).sort();
    headers.push(...metadataFields);

    // Convert readings to row format
    const rows = readings.map(reading => {
      const metadata = reading.metadata as any;
      const row: any = {
        [timestampHeader]: reading.reading_timestamp,
        [kwhHeader]: reading.kwh_value,
      };
      
      if (hasKva && columnMapping?.kvaColumn && columnMapping.kvaColumn !== '-1') {
        const kvaHeader = columnMapping.renamedHeaders?.[columnMapping.kvaColumn] || 'kVA Value';
        row[kvaHeader] = reading.kva_value;
      }
      
      // Add metadata fields
      metadataFields.forEach(field => {
        row[field] = metadata?.imported_fields?.[field] ?? '—';
      });
      
      return row;
    });

    setParsedCsvHeaders(headers);
    setParsedCsvData(rows);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingMeter(null);
    setIsRevenueCritical(false);
  };

  const getMeterTypeColor = (type: string) => {
    switch (type) {
      case "bulk_meter":
        return "bg-primary text-primary-foreground";
      case "check_meter":
        return "bg-warning text-warning-foreground";
      case "tenant_meter":
        return "bg-accent text-accent-foreground";
      case "other":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getMeterTypeLabel = (type: string) => {
    switch (type) {
      case "bulk_meter":
        return "Bulk Meter";
      case "check_meter":
        return "Check Meter";
      case "tenant_meter":
        return "Tenant Meter";
      case "other":
        return "Other";
      default:
        return type;
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedMeterIds(new Set(meters.map(m => m.id)));
    } else {
      setSelectedMeterIds(new Set());
    }
  };

  const handleSelectMeter = (meterId: string, checked: boolean) => {
    const newSelection = new Set(selectedMeterIds);
    if (checked) {
      newSelection.add(meterId);
    } else {
      newSelection.delete(meterId);
    }
    setSelectedMeterIds(newSelection);
  };

  const handleBulkDelete = async () => {
    if (selectedMeterIds.size === 0) return;
    
    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedMeterIds.size} meter${selectedMeterIds.size !== 1 ? 's' : ''}? This action cannot be undone and will also delete all associated readings and connections.`
    );
    
    if (!confirmed) return;
    
    setIsBulkDeleting(true);
    
    try {
      const { error } = await supabase
        .from("meters")
        .delete()
        .in("id", Array.from(selectedMeterIds));

      if (error) {
        toast.error("Failed to delete meters");
      } else {
        toast.success(`Successfully deleted ${selectedMeterIds.size} meter${selectedMeterIds.size !== 1 ? 's' : ''}`);
        setSelectedMeterIds(new Set());
        fetchMeters();
      }
    } catch (error) {
      toast.error("An error occurred while deleting meters");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleBulkDeleteCsvData = async () => {
    if (selectedMeterIds.size === 0) return;
    
    const confirmed = window.confirm(
      `Delete all CSV data for ${selectedMeterIds.size} selected meter${selectedMeterIds.size !== 1 ? 's' : ''}?\n\n` +
      `This will permanently remove:\n` +
      `• All CSV files from storage\n` +
      `• All meter readings from database\n` +
      `• All CSV file metadata\n\n` +
      `The meters themselves will NOT be deleted.\n\n` +
      `This action cannot be undone.`
    );
    
    if (!confirmed) return;
    
    setIsBulkCsvDeleting(true);
    
    try {
      const meterIds = Array.from(selectedMeterIds);
      
      // Step 1: Get all CSV file paths for selected meters
      const { data: csvFiles, error: fetchError } = await supabase
        .from('meter_csv_files')
        .select('file_path')
        .in('meter_id', meterIds);
      
      if (fetchError) throw fetchError;
      
      const filePaths = csvFiles?.map(f => f.file_path) || [];
      
      // Step 2: Delete files from storage (if any exist)
      let deletedFilesCount = 0;
      if (filePaths.length > 0) {
        const { data: deleteData, error: deleteError } = await supabase.functions.invoke('delete-meter-csvs', {
          body: { filePaths }
        });
        
        if (deleteError) throw deleteError;
        if (!deleteData.success) throw new Error(deleteData.error || 'File deletion failed');
        
        deletedFilesCount = deleteData.deletedCount;
      }
      
      // Step 3: Delete meter readings
      const { error: readingsError } = await supabase
        .from('meter_readings')
        .delete()
        .in('meter_id', meterIds);
      
      if (readingsError) throw readingsError;
      
      // Step 4: Delete CSV file metadata
      const { error: csvError } = await supabase
        .from('meter_csv_files')
        .delete()
        .in('meter_id', meterIds);
      
      if (csvError) throw csvError;
      
      toast.success(
        `Successfully deleted CSV data for ${selectedMeterIds.size} meter${selectedMeterIds.size !== 1 ? 's' : ''}: ` +
        `${deletedFilesCount} file${deletedFilesCount !== 1 ? 's' : ''} removed from storage`,
        { duration: 5000 }
      );
      
      setSelectedMeterIds(new Set());
      fetchMeters();
      
    } catch (error) {
      console.error('Error deleting CSV data:', error);
      toast.error("Failed to delete CSV data: " + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsBulkCsvDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold">Meters</h2>
          <p className="text-muted-foreground">Manage meters for this site</p>
        </div>
        <div className="flex gap-2">
          {selectedMeterIds.size > 0 && (
            <>
              <Button
                variant="outline"
                onClick={handleBulkDeleteCsvData}
                disabled={isBulkCsvDeleting}
                className="gap-2"
              >
                <Database className="w-4 h-4" />
                Delete CSV Data ({selectedMeterIds.size})
              </Button>
              <Button
                variant="outline"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
                className="gap-2"
              >
                <Trash className="w-4 h-4" />
                Delete {selectedMeterIds.size} Selected
              </Button>
            </>
          )}
          <CsvBulkIngestionTool siteId={siteId} onDataChange={fetchMeters} />
          <Dialog open={isDialogOpen} onOpenChange={handleCloseDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Add Meter
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingMeter ? "Edit Meter" : "Add New Meter"}</DialogTitle>
              <DialogDescription>
                {editingMeter ? "Update meter details" : "Register a new electrical meter with all required details"}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="meter_number">NO (Meter Number) *</Label>
                  <Input 
                    id="meter_number" 
                    name="meter_number" 
                    required 
                    placeholder="DB-03"
                    defaultValue={editingMeter?.meter_number}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">NAME *</Label>
                  <Input 
                    id="name" 
                    name="name" 
                    required 
                    placeholder="ACKERMANS"
                    defaultValue={editingMeter?.name || ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="area">AREA (m²) *</Label>
                  <Input 
                    id="area" 
                    name="area" 
                    type="number" 
                    step="0.01" 
                    required 
                    placeholder="406"
                    defaultValue={editingMeter?.area || ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rating">BREAKER SIZE (RATING) *</Label>
                  <Input 
                    id="rating" 
                    name="rating" 
                    required 
                    placeholder="100A TP"
                    defaultValue={editingMeter?.rating || ""}
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label htmlFor="cable_specification">CABLE *</Label>
                  <Input 
                    id="cable_specification" 
                    name="cable_specification" 
                    required 
                    placeholder="4C x 50mm² ALU ECC CABLE"
                    defaultValue={editingMeter?.cable_specification || ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="serial_number">SERIAL *</Label>
                  <Input 
                    id="serial_number" 
                    name="serial_number" 
                    required 
                    placeholder="35777285"
                    defaultValue={editingMeter?.serial_number || ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ct_type">CT *</Label>
                  <Input 
                    id="ct_type" 
                    name="ct_type" 
                    required 
                    placeholder="DOL"
                    defaultValue={editingMeter?.ct_type || ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="meter_type">Meter Type *</Label>
                  <Select name="meter_type" required defaultValue={editingMeter?.meter_type}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bulk_meter">Bulk Meter</SelectItem>
                      <SelectItem value="check_meter">Check Meter</SelectItem>
                      <SelectItem value="tenant_meter">Tenant Meter</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input 
                    id="location" 
                    name="location" 
                    placeholder="Building A, Floor 2"
                    defaultValue={editingMeter?.location || ""}
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label htmlFor="tariff_structure_id">Tariff Structure</Label>
                  <Select name="tariff_structure_id" defaultValue={editingMeter?.tariff_structure_id || undefined}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select tariff structure (optional)" />
                    </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {tariffStructures.map((tariff) => (
                        <SelectItem key={tariff.id} value={tariff.id}>
                          <div className="flex flex-col">
                            <span>{tariff.name} ({tariff.tariff_type})</span>
                            {tariff.description && (
                              <span className="text-xs text-muted-foreground">{tariff.description}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Or use Tariff Assignment tab for bulk assignment
                  </p>
                </div>

                <div className="space-y-2 col-span-2">
                  <Label htmlFor="tariff">Tariff Notes (Optional)</Label>
                  <Input 
                    id="tariff" 
                    name="tariff" 
                    placeholder="e.g. Special rate, Legacy tariff, etc."
                    defaultValue={editingMeter?.tariff || ""}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="revenue_critical"
                  checked={isRevenueCritical}
                  onCheckedChange={(checked) => setIsRevenueCritical(checked as boolean)}
                />
                <Label htmlFor="revenue_critical" className="cursor-pointer">
                  Mark as revenue critical
                </Label>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (editingMeter ? "Updating..." : "Creating...") : (editingMeter ? "Update Meter" : "Create Meter")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {meters.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Gauge className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No meters yet</h3>
            <p className="text-muted-foreground mb-4">Register your first meter for this site</p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Meter
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Site Meters</CardTitle>
            <CardDescription>
              {meters.length} meter{meters.length !== 1 ? "s" : ""} registered
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedMeterIds.size === meters.length && meters.length > 0}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all meters"
                    />
                  </TableHead>
                  <TableHead>NO</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Serial</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meters.map((meter) => (
                  <TableRow key={meter.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedMeterIds.has(meter.id)}
                        onCheckedChange={(checked) => handleSelectMeter(meter.id, checked as boolean)}
                        aria-label={`Select meter ${meter.meter_number}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono font-medium">{meter.meter_number}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{meter.name || "—"}</p>
                        {meter.location && (
                          <p className="text-xs text-muted-foreground">{meter.location}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getMeterTypeColor(meter.meter_type)}>
                        {getMeterTypeLabel(meter.meter_type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {meter.area ? `${meter.area}m²` : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {meter.rating || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {meter.serial_number || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        {meter.is_revenue_critical && (
                          <Badge variant="outline" className="text-destructive border-destructive">
                            Critical
                          </Badge>
                        )}
                        {meter.has_raw_csv && (
                          <Badge 
                            variant="outline" 
                            className="gap-1 bg-blue-500/10 border-blue-500/50 text-blue-600 dark:text-blue-400 cursor-pointer hover:bg-blue-500/20 transition-colors"
                            onClick={async () => {
                              await fetchRawCsvData(meter.id);
                              setIsRawCsvViewOpen(true);
                            }}
                            title="View raw CSV data"
                          >
                            <Database className="w-3 h-3" />
                            Raw
                          </Badge>
                        )}
                        {meter.has_parsed && (
                          <Badge 
                            variant="outline" 
                            className="gap-1 bg-green-500/10 border-green-500/50 text-green-600 dark:text-green-400 cursor-pointer hover:bg-green-500/20 transition-colors"
                            onClick={async () => {
                              await fetchParsedCsvData(meter.id);
                              setIsParsedCsvViewOpen(true);
                            }}
                            title="View parsed CSV data"
                          >
                            <Database className="w-3 h-3" />
                            Parsed
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(meter)}
                          title="Edit meter"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingMeterId(meter.id)}
                          title="Delete meter"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSingleUploadMeterId(meter.id);
                            setSingleUploadMeterNumber(meter.meter_number);
                            setIsSingleUploadOpen(true);
                          }}
                          title="Upload CSV data"
                        >
                          <Upload className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CsvImportDialog
        isOpen={isCsvDialogOpen}
        onClose={() => {
          setIsCsvDialogOpen(false);
          setCsvImportMeterId(null);
        }}
        meterId={csvImportMeterId || ""}
        onImportComplete={() => {
          fetchMeters();
        }}
      />

      <MeterReadingsView
        isOpen={isReadingsViewOpen}
        onClose={() => {
          setIsReadingsViewOpen(false);
          setViewReadingsMeterId(null);
          setViewReadingsMeterNumber("");
        }}
        meterId={viewReadingsMeterId || ""}
        meterNumber={viewReadingsMeterNumber}
      />

      <Dialog open={isRawCsvViewOpen} onOpenChange={setIsRawCsvViewOpen}>
        <DialogContent className="max-w-6xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Raw CSV Data</DialogTitle>
            <DialogDescription>
              View the data as it appears in the uploaded CSV file
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {rawCsvData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No CSV data available
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {rawCsvHeaders.map((header, idx) => (
                        <TableHead key={idx}>{header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawCsvData.map((row, idx) => (
                      <TableRow key={idx}>
                        {rawCsvHeaders.map((header, colIdx) => (
                          <TableCell key={colIdx} className="font-mono text-xs">
                            {row[header]}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingMeterId} onOpenChange={() => setDeletingMeterId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Meter</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this meter? This action cannot be undone and will also delete all associated readings and connections.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SingleCsvUploadDialog
        isOpen={isSingleUploadOpen}
        onOpenChange={setIsSingleUploadOpen}
        meterId={singleUploadMeterId || ""}
        meterNumber={singleUploadMeterNumber}
        siteId={siteId}
        onUploadComplete={fetchMeters}
      />

      <Dialog open={isParsedCsvViewOpen} onOpenChange={setIsParsedCsvViewOpen}>
        <DialogContent className="max-w-7xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Parsed CSV Data</DialogTitle>
            <DialogDescription>
              Data displayed using the column interpretation from the Parsing Configuration
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            {parsedCsvData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No parsed CSV data available. Please parse the file first.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <p className="text-sm text-muted-foreground">
                    {parsedCsvData.length} readings processed
                  </p>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        {parsedCsvHeaders.map((header, idx) => (
                          <TableHead key={idx} className="font-semibold">
                            {header}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedCsvData.map((row, idx) => (
                        <TableRow key={idx}>
                          {parsedCsvHeaders.map((header, colIdx) => (
                            <TableCell key={colIdx} className="font-mono text-xs">
                              {colIdx === 0 ? (
                                <span className="text-xs">
                                  {row[header] ? row[header].replace('T', ' ').replace('Z', '').substring(0, 19) : '—'}
                                </span>
                              ) : (
                                row[header]
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
