import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileCheck2, AlertCircle, CheckCircle2, DollarSign, Eye, FileText } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import TariffDetailsDialog from "@/components/tariffs/TariffDetailsDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface TariffAssignmentTabProps {
  siteId: string;
}

interface Site {
  id: string;
  name: string;
  supply_authority_id: string | null;
  supply_authorities: {
    id: string;
    name: string;
    region: string;
  } | null;
}

interface TariffStructure {
  id: string;
  name: string;
  tariff_type: string;
  voltage_level: string | null;
  effective_from: string;
  effective_to: string | null;
  description: string | null;
  uses_tou: boolean;
  supply_authority_id: string;
}

interface Meter {
  id: string;
  meter_number: string;
  name: string;
  tariff: string | null;
  meter_type: string;
}

interface DocumentShopNumber {
  documentId: string;
  fileName: string;
  shopNumber: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  currency: string;
  tenantName?: string;
  accountReference?: string;
  lineItems?: Array<{
    description: string;
    meter_number?: string;
    previous_reading?: number;
    current_reading?: number;
    consumption?: number;
    rate?: number;
    amount: number;
  }>;
}

export default function TariffAssignmentTab({ siteId }: TariffAssignmentTabProps) {
  const [site, setSite] = useState<Site | null>(null);
  const [tariffStructures, setTariffStructures] = useState<TariffStructure[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [selectedTariffs, setSelectedTariffs] = useState<{ [meterId: string]: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [viewingTariffId, setViewingTariffId] = useState<string | null>(null);
  const [viewingTariffName, setViewingTariffName] = useState<string>("");
  const [documentShopNumbers, setDocumentShopNumbers] = useState<DocumentShopNumber[]>([]);
  const [viewingShopDoc, setViewingShopDoc] = useState<DocumentShopNumber | null>(null);

  useEffect(() => {
    fetchSiteData();
    fetchMeters();
    fetchDocumentShopNumbers();
  }, [siteId]);

  useEffect(() => {
    if (site?.supply_authority_id) {
      fetchTariffStructures();
    }
  }, [site?.supply_authority_id]);

  const fetchSiteData = async () => {
    const { data, error } = await supabase
      .from("sites")
      .select("*, supply_authorities(id, name, region)")
      .eq("id", siteId)
      .single();

    if (error) {
      toast.error("Failed to load site data");
      return;
    }

    setSite(data);
  };

  const fetchTariffStructures = async () => {
    if (!site?.supply_authority_id) return;

    setIsLoading(true);
    const { data, error } = await supabase
      .from("tariff_structures")
      .select("*")
      .eq("supply_authority_id", site.supply_authority_id)
      .eq("active", true)
      .order("effective_from", { ascending: false });

    if (error) {
      toast.error("Failed to load tariff structures");
      setIsLoading(false);
      return;
    }

    setTariffStructures(data || []);
    setIsLoading(false);
  };

  const fetchMeters = async () => {
    const { data, error } = await supabase
      .from("meters")
      .select("id, meter_number, name, tariff, meter_type")
      .eq("site_id", siteId)
      .order("meter_number");

    if (error) {
      toast.error("Failed to load meters");
      return;
    }

    setMeters(data || []);
    
    // Initialize selected tariffs from existing data
    const tariffMap: { [meterId: string]: string } = {};
    data?.forEach((meter) => {
      if (meter.tariff) {
        tariffMap[meter.id] = meter.tariff;
      }
    });
    setSelectedTariffs(tariffMap);
  };

  const fetchDocumentShopNumbers = async () => {
    try {
      const { data, error } = await supabase
        .from("site_documents")
        .select(`
          id,
          file_name,
          document_extractions (
            extracted_data
          )
        `)
        .eq("site_id", siteId)
        .eq("extraction_status", "completed");

      if (error) throw error;

      const shopNumbers: DocumentShopNumber[] = [];
      data?.forEach((doc) => {
        const extraction = doc.document_extractions?.[0];
        if (extraction?.extracted_data) {
          const extractedData = extraction.extracted_data as any;
          if (extractedData?.shop_number) {
            shopNumbers.push({
              documentId: doc.id,
              fileName: doc.file_name,
              shopNumber: extractedData.shop_number,
              periodStart: extractedData.period_start || '',
              periodEnd: extractedData.period_end || '',
              totalAmount: extractedData.total_amount || 0,
              currency: extractedData.currency || 'ZAR',
              tenantName: extractedData.tenant_name,
              accountReference: extractedData.account_reference,
              lineItems: extractedData.line_items
            });
          }
        }
      });

      setDocumentShopNumbers(shopNumbers);
    } catch (error) {
      console.error("Error fetching document shop numbers:", error);
    }
  };

  const getMatchingShopNumbers = (meter: Meter): DocumentShopNumber[] => {
    // Extract just the number part from meter_number (e.g., "DB-11" → "11")
    const meterNumberParts = meter.meter_number.match(/\d+[A-Z]?$/i);
    const cleanMeterNumber = meterNumberParts ? meterNumberParts[0] : meter.meter_number;
    
    const matches = documentShopNumbers.filter(doc => {
      const shopNum = doc.shopNumber.toLowerCase();
      const meterNum = cleanMeterNumber.toLowerCase();
      const fullMeterNum = meter.meter_number.toLowerCase();
      const meterName = (meter.name || '').toLowerCase();
      
      // Exact match is preferred
      if (shopNum === meterNum || shopNum === fullMeterNum) {
        return true;
      }
      
      // Match if shop number is found in meter name
      if (meterName && shopNum === meterName) {
        return true;
      }
      
      return false;
    });
    
    // Deduplicate by shop number - keep only the most recent document per shop number
    const uniqueShopNumbers = new Map<string, DocumentShopNumber>();
    matches.forEach(doc => {
      const existing = uniqueShopNumbers.get(doc.shopNumber);
      if (!existing || doc.periodStart > existing.periodStart) {
        uniqueShopNumbers.set(doc.shopNumber, doc);
      }
    });
    
    return Array.from(uniqueShopNumbers.values());
  };

  const handleTariffChange = (meterId: string, tariffId: string) => {
    setSelectedTariffs((prev) => ({
      ...prev,
      [meterId]: tariffId,
    }));
  };

  const handleSaveAssignments = async () => {
    setIsSaving(true);

    try {
      const updates = Object.entries(selectedTariffs).map(([meterId, tariffId]) => {
        return supabase
          .from("meters")
          .update({ tariff: tariffId })
          .eq("id", meterId);
      });

      await Promise.all(updates);
      toast.success("Tariff assignments saved successfully");
      fetchMeters();
    } catch (error) {
      console.error("Error saving tariff assignments:", error);
      toast.error("Failed to save tariff assignments");
    } finally {
      setIsSaving(false);
    }
  };

  const getAssignmentStats = () => {
    const assigned = meters.filter((m) => selectedTariffs[m.id]).length;
    const total = meters.length;
    return { assigned, total, unassigned: total - assigned };
  };

  const hasUnsavedChanges = (meterId: string) => {
    const meter = meters.find(m => m.id === meterId);
    if (!meter) return false;
    
    const currentSelection = selectedTariffs[meterId];
    const savedTariff = meter.tariff;
    
    // If both are empty/null, no changes
    if (!currentSelection && !savedTariff) return false;
    
    // If one is set and the other isn't, or if they're different
    return currentSelection !== savedTariff;
  };

  const stats = getAssignmentStats();

  if (!site?.supply_authority_id) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Tariff Assignment
          </CardTitle>
          <CardDescription>Assign tariff structures to meters</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This site does not have a supply authority configured. Please edit the site details
              and select a province and municipality to access tariff structures.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Tariff Assignment
          </CardTitle>
          <CardDescription>
            Assign tariff structures from {site.supply_authorities?.name} to your meters
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Province</Label>
              <div className="p-3 border rounded-md bg-muted/50">
                <p className="font-medium">{site.supply_authorities?.region}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Municipality / Supply Authority</Label>
              <div className="p-3 border rounded-md bg-muted/50">
                <p className="font-medium">{site.supply_authorities?.name}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 p-4 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold text-primary">{stats.assigned}</p>
              <p className="text-sm text-muted-foreground">Assigned</p>
            </div>
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold text-muted-foreground">{stats.unassigned}</p>
              <p className="text-sm text-muted-foreground">Unassigned</p>
            </div>
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total Meters</p>
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <p className="text-muted-foreground">Loading tariff structures...</p>
            </div>
          )}

          {!isLoading && tariffStructures.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No active tariff structures found for {site.supply_authorities?.name}.
                Please add tariff structures in the Tariffs section.
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && tariffStructures.length > 0 && meters.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No meters found for this site. Please add meters first.
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && tariffStructures.length > 0 && meters.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Meter Tariff Assignments</h3>
                <Button onClick={handleSaveAssignments} disabled={isSaving}>
                  <FileCheck2 className="w-4 h-4 mr-2" />
                  {isSaving ? "Saving..." : "Save Assignments"}
                </Button>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Meter Number</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Shop Numbers</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Assigned Tariff Structure</TableHead>
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meters.map((meter) => {
                      const currentTariffId = selectedTariffs[meter.id];
                      const currentTariff = tariffStructures.find((t) => t.id === currentTariffId);
                      const hasAssignment = !!currentTariffId;
                      const matchingShops = getMatchingShopNumbers(meter);

                      return (
                        <TableRow key={meter.id}>
                          <TableCell className="font-mono font-medium">
                            {meter.meter_number}
                          </TableCell>
                          <TableCell>{meter.name || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{meter.meter_type}</Badge>
                          </TableCell>
                          <TableCell>
                            {matchingShops.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {matchingShops.map((shop, idx) => (
                                  <TooltipProvider key={idx}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-6 text-xs"
                                          onClick={() => setViewingShopDoc(shop)}
                                        >
                                          <FileText className="w-3 h-3 mr-1" />
                                          {shop.shopNumber}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>View document details</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {hasUnsavedChanges(meter.id) ? (
                              <Badge className="gap-1 bg-warning text-warning-foreground">
                                <AlertCircle className="w-3 h-3" />
                                Pending
                              </Badge>
                            ) : hasAssignment ? (
                              <Badge variant="default" className="gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                Assigned
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="gap-1">
                                <AlertCircle className="w-3 h-3" />
                                Unassigned
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={currentTariffId || ""}
                              onValueChange={(value) => handleTariffChange(meter.id, value)}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select tariff structure" />
                              </SelectTrigger>
                              <SelectContent>
                                {tariffStructures.map((tariff) => (
                                  <SelectItem key={tariff.id} value={tariff.id}>
                                    <div className="flex flex-col">
                                      <span className="font-medium">{tariff.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {tariff.tariff_type}
                                        {tariff.voltage_level && ` • ${tariff.voltage_level}`}
                                        {tariff.uses_tou && " • TOU"}
                                      </span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {currentTariffId && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  const tariffStructure = tariffStructures.find(t => t.id === currentTariffId);
                                  if (tariffStructure) {
                                    setViewingTariffId(currentTariffId);
                                    setViewingTariffName(tariffStructure.name);
                                  }
                                }}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {tariffStructures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Available Tariff Structures</CardTitle>
            <CardDescription>
              {tariffStructures.length} active tariff structure(s) from {site.supply_authorities?.name}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {tariffStructures.map((tariff) => (
                <div
                  key={tariff.id}
                  className="p-4 border rounded-lg hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <h4 className="font-semibold">{tariff.name}</h4>
                      {tariff.description && (
                        <p className="text-sm text-muted-foreground">{tariff.description}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{tariff.tariff_type}</Badge>
                        {tariff.voltage_level && (
                          <Badge variant="outline">{tariff.voltage_level}</Badge>
                        )}
                        {tariff.uses_tou && <Badge variant="secondary">Time-of-Use</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground pt-1">
                        <p>
                          Effective: {new Date(tariff.effective_from).toLocaleDateString()}
                          {tariff.effective_to && ` - ${new Date(tariff.effective_to).toLocaleDateString()}`}
                        </p>
                      </div>
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              setViewingTariffId(tariff.id);
                              setViewingTariffName(tariff.name);
                            }}
                            className="shrink-0"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>View Details</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {viewingTariffId && (
        <TariffDetailsDialog
          tariffId={viewingTariffId}
          tariffName={viewingTariffName}
          onClose={() => {
            setViewingTariffId(null);
            setViewingTariffName("");
          }}
        />
      )}

      {/* Shop Document Details Dialog */}
      <Dialog open={!!viewingShopDoc} onOpenChange={() => setViewingShopDoc(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Document Details</DialogTitle>
            <DialogDescription>
              Extracted information from uploaded document
            </DialogDescription>
          </DialogHeader>
          
          {viewingShopDoc && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Period Start</Label>
                  <p className="text-sm">
                    {viewingShopDoc.periodStart ? new Date(viewingShopDoc.periodStart).toLocaleDateString() : '—'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Period End</Label>
                  <p className="text-sm">
                    {viewingShopDoc.periodEnd ? new Date(viewingShopDoc.periodEnd).toLocaleDateString() : '—'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Currency</Label>
                  <p className="text-sm">{viewingShopDoc.currency}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Total Amount</Label>
                  <p className="text-sm font-medium">
                    {viewingShopDoc.totalAmount.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="space-y-4 p-4 border rounded-lg">
                <Label className="text-base font-semibold">Additional Details</Label>
                
                <div className="space-y-2">
                  <Label>Shop Number</Label>
                  <p className="text-sm">{viewingShopDoc.shopNumber}</p>
                </div>

                {viewingShopDoc.tenantName && (
                  <div className="space-y-2">
                    <Label>Tenant Name</Label>
                    <p className="text-sm">{viewingShopDoc.tenantName}</p>
                  </div>
                )}

                {viewingShopDoc.accountReference && (
                  <div className="space-y-2">
                    <Label>Account Reference</Label>
                    <p className="text-sm">{viewingShopDoc.accountReference}</p>
                  </div>
                )}

                {/* Line Items Section */}
                {viewingShopDoc.lineItems && viewingShopDoc.lineItems.length > 0 && (
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Line Items</Label>
                    <Accordion type="single" collapsible className="w-full">
                      {viewingShopDoc.lineItems.map((item, index) => (
                        <AccordionItem key={index} value={`item-${index}`}>
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex items-center justify-between w-full pr-4">
                              <span className="font-medium">{item.description || `Line Item ${index + 1}`}</span>
                              <span className="text-sm text-muted-foreground">
                                {viewingShopDoc.currency} {(item.amount || 0).toFixed(2)}
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-3 pt-2 text-sm">
                              {item.meter_number && (
                                <div>
                                  <Label className="text-xs text-muted-foreground">Meter Number</Label>
                                  <p>{item.meter_number}</p>
                                </div>
                              )}
                              
                              <div className="grid grid-cols-2 gap-3">
                                {item.previous_reading !== undefined && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Previous Reading</Label>
                                    <p>{item.previous_reading}</p>
                                  </div>
                                )}
                                {item.current_reading !== undefined && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Current Reading</Label>
                                    <p>{item.current_reading}</p>
                                  </div>
                                )}
                              </div>
                              
                              <div className="grid grid-cols-2 gap-3">
                                {item.consumption !== undefined && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Consumption</Label>
                                    <p>{item.consumption} kWh</p>
                                  </div>
                                )}
                                {item.rate !== undefined && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Rate</Label>
                                    <p>{item.rate.toFixed(4)} per kWh</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs text-muted-foreground">Document File</Label>
                <p className="text-sm">{viewingShopDoc.fileName}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
