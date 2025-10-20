import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Database, Trash2, Edit, Save, X, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface MeterReading {
  id: string;
  reading_timestamp: string;
  kwh_value: number;
  metadata: any;
  uploaded_by: string | null;
}

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

  const fetchReadings = async () => {
    setIsLoading(true);
    
    // Get total count
    const { count } = await supabase
      .from("meter_readings")
      .select("*", { count: "exact", head: true })
      .eq("meter_id", meterId);
    
    setTotalCount(count || 0);

    // Get paginated data
    const { data, error } = await supabase
      .from("meter_readings")
      .select("*")
      .eq("meter_id", meterId)
      .order("reading_timestamp", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      toast.error("Failed to fetch readings");
    } else {
      setReadings(data || []);
    }
    setIsLoading(false);
  };

  const handleEdit = (reading: MeterReading) => {
    setEditingId(reading.id);
    setEditValues({
      timestamp: new Date(reading.reading_timestamp).toISOString().slice(0, 16),
      value: reading.kwh_value.toString(),
    });
  };

  const handleSave = async (id: string) => {
    const { error } = await supabase
      .from("meter_readings")
      .update({
        reading_timestamp: new Date(editValues.timestamp).toISOString(),
        kwh_value: parseFloat(editValues.value),
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
          <DialogTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Meter Readings - {meterNumber}
          </DialogTitle>
          <DialogDescription>
            View and manage imported CSV data ({totalCount} total readings)
          </DialogDescription>
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
                    {getMetadataColumns().slice(0, 5).map(col => (
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
                          <span className="font-mono">{reading.kwh_value.toFixed(3)}</span>
                        )}
                      </TableCell>
                      {getMetadataColumns().slice(0, 5).map(col => (
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
