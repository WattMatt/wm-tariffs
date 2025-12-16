import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Database, Trash2, Edit, Save, X, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface MeterReading {
  id: string;
  reading_timestamp: string;
  metadata: any;
  uploaded_by: string | null;
}

// Helper to extract kWh value from metadata.imported_fields
const extractKwhValue = (metadata: any): number => {
  const importedFields = metadata?.imported_fields;
  if (!importedFields) return 0;
  const kwhFieldNames = ['P1 (kWh)', 'P1', 'kWh', 'kwh', 'Value', 'value'];
  for (const fieldName of kwhFieldNames) {
    if (importedFields[fieldName] !== undefined) {
      return Number(importedFields[fieldName]) || 0;
    }
  }
  for (const [, value] of Object.entries(importedFields)) {
    const num = Number(value);
    if (!isNaN(num)) return num;
  }
  return 0;
};

interface MeterReadingsViewProps {
  isOpen: boolean;
  onClose: () => void;
  meterId: string;
  meterNumber: string;
}

export default function MeterReadingsView({ isOpen, onClose, meterId, meterNumber }: MeterReadingsViewProps) {
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ timestamp: string; value: string }>({ timestamp: "", value: "" });
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    if (isOpen && meterId) {
      fetchReadings();
    }
  }, [isOpen, meterId, page]);

  // Set up realtime subscription for live reading updates
  useEffect(() => {
    if (!isOpen || !meterId) return;
    
    const channel = supabase
      .channel('meter-readings-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'meter_readings',
          filter: `meter_id=eq.${meterId}`
        },
        () => {
          console.log('Readings changed, reloading...');
          fetchReadings();
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, meterId]);

  const fetchReadings = async () => {
    setIsLoading(true);
    
    console.log("Fetching readings for meter:", meterId, "page:", page);
    
    // Get total count
    const { count, error: countError } = await supabase
      .from("meter_readings")
      .select("*", { count: "exact", head: true })
      .eq("meter_id", meterId);
    
    if (countError) {
      console.error("Error fetching count:", countError);
      toast.error("Failed to fetch reading count: " + countError.message);
      setIsLoading(false);
      return;
    }
    
    console.log("Total count for meter:", count);
    setTotalCount(count || 0);

    // Get paginated data
    const { data, error } = await supabase
      .from("meter_readings")
      .select("*")
      .eq("meter_id", meterId)
      .order("reading_timestamp", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error("Error fetching readings:", error);
      toast.error("Failed to fetch readings: " + error.message);
    } else {
      console.log("Fetched readings:", data?.length, "records");
      setReadings(data || []);
    }
    setIsLoading(false);
  };

  const handleEdit = (reading: MeterReading) => {
    setEditingId(reading.id);
    const kwhValue = extractKwhValue(reading.metadata);
    setEditValues({
      timestamp: new Date(reading.reading_timestamp).toISOString().slice(0, 16),
      value: kwhValue.toString(),
    });
  };

  const handleSave = async (id: string) => {
    // Find the reading to get the existing metadata
    const reading = readings.find(r => r.id === id);
    if (!reading) return;
    
    // Find the kWh field name to update in imported_fields
    const importedFields = reading.metadata?.imported_fields || {};
    const kwhFieldNames = ['P1 (kWh)', 'P1', 'kWh', 'kwh', 'Value', 'value'];
    let kwhFieldKey: string | null = null;
    
    for (const fieldName of kwhFieldNames) {
      if (importedFields[fieldName] !== undefined) {
        kwhFieldKey = fieldName;
        break;
      }
    }
    
    // If no existing kWh field found, use 'P1 (kWh)' as default
    if (!kwhFieldKey) {
      kwhFieldKey = 'P1 (kWh)';
    }
    
    // Update the metadata with the new value
    const updatedMetadata = {
      ...reading.metadata,
      imported_fields: {
        ...importedFields,
        [kwhFieldKey]: parseFloat(editValues.value)
      }
    };
    
    const { error } = await supabase
      .from("meter_readings")
      .update({
        reading_timestamp: new Date(editValues.timestamp).toISOString(),
        metadata: updatedMetadata,
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update reading");
    } else {
      toast.success("Reading updated");
      setEditingId(null);
      fetchReadings();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this reading?")) return;

    const { error } = await supabase
      .from("meter_readings")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete reading");
    } else {
      toast.success("Reading deleted");
      fetchReadings();
    }
  };

  const getMetadataColumns = () => {
    if (readings.length === 0) return [];
    const firstMetadata = readings[0].metadata?.imported_fields || {};
    return Object.keys(firstMetadata).filter(key => 
      !['timestamp', 'reading_timestamp'].some(excluded => key.toLowerCase().includes(excluded))
    );
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Meter Readings - {meterNumber}
              </DialogTitle>
              <DialogDescription>
                View and manage imported CSV data ({totalCount} total readings)
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchReadings}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading readings...</p>
          </div>
        ) : readings.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Database className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No readings found</h3>
              <p className="text-muted-foreground">Upload a CSV file to import meter readings</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>kWh Value</TableHead>
                      {getMetadataColumns().map(col => (
                        <TableHead key={col}>{col}</TableHead>
                      ))}
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {readings.map((reading) => (
                    <TableRow key={reading.id}>
                      <TableCell>
                        {editingId === reading.id ? (
                          <Input
                            type="datetime-local"
                            value={editValues.timestamp}
                            onChange={(e) => setEditValues({ ...editValues, timestamp: e.target.value })}
                            className="w-48"
                          />
                        ) : (
                          <span className="font-mono text-sm">
                            {new Date(reading.reading_timestamp).toLocaleString()}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingId === reading.id ? (
                          <Input
                            type="number"
                            step="0.001"
                            value={editValues.value}
                            onChange={(e) => setEditValues({ ...editValues, value: e.target.value })}
                            className="w-32"
                          />
                        ) : (
                          <span className="font-mono">{extractKwhValue(reading.metadata).toFixed(3)}</span>
                        )}
                      </TableCell>
                      {getMetadataColumns().map(col => (
                        <TableCell key={col} className="text-sm">
                          {reading.metadata?.imported_fields?.[col] || "—"}
                        </TableCell>
                      ))}
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {reading.metadata?.source_file || "Manual"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          {editingId === reading.id ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleSave(reading.id)}
                              >
                                <Save className="w-4 h-4 text-green-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingId(null)}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEdit(reading)}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(reading.id)}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, totalCount)} of {totalCount}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
