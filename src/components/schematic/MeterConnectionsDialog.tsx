import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, ArrowRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MeterConnectionsDialogProps {
  siteId: string;
  onClose: () => void;
}

interface Connection {
  id: string;
  child_meter_id: string;
  parent_meter_id: string;
  child_meter: any;
  parent_meter: any;
}

export default function MeterConnectionsDialog({ siteId, onClose }: MeterConnectionsDialogProps) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [meters, setMeters] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [childMeterId, setChildMeterId] = useState("");
  const [parentMeterId, setParentMeterId] = useState("");

  useEffect(() => {
    fetchConnections();
    fetchMeters();
  }, [siteId]);

  const fetchMeters = async () => {
    const { data } = await supabase
      .from("meters")
      .select("*")
      .eq("site_id", siteId)
      .order("meter_number");

    setMeters(data || []);
  };

  const fetchConnections = async () => {
    setIsLoading(true);
    
    const { data } = await supabase
      .from("meter_connections")
      .select(`
        *,
        child_meter:child_meter_id (id, meter_number, meter_type),
        parent_meter:parent_meter_id (id, meter_number, meter_type)
      `)
      .or(`child_meter_id.in.(${meters.map(m => m.id).join(',')}),parent_meter_id.in.(${meters.map(m => m.id).join(',')})`)
      .order("created_at", { ascending: false });

    setConnections(data || []);
    setIsLoading(false);
  };

  const handleAddConnection = async () => {
    if (!childMeterId || !parentMeterId) {
      toast.error("Please select both child and parent meters");
      return;
    }

    if (childMeterId === parentMeterId) {
      toast.error("A meter cannot be connected to itself");
      return;
    }

    const { error } = await supabase
      .from("meter_connections")
      .insert({
        child_meter_id: childMeterId,
        parent_meter_id: parentMeterId
      });

    if (error) {
      toast.error("Failed to create connection");
      return;
    }

    toast.success("Connection created");
    setChildMeterId("");
    setParentMeterId("");
    setIsAdding(false);
    fetchConnections();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("meter_connections")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete connection");
      return;
    }

    toast.success("Connection deleted");
    fetchConnections();
  };


  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Meter Connections & Hierarchy</DialogTitle>
          <DialogDescription>
            Manage meter relationships and tariff structure flow
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isAdding ? (
            <Button onClick={() => setIsAdding(true)} className="w-full">
              Add Connection
            </Button>
          ) : (
            <div className="space-y-3 p-4 border rounded-lg">
              <h3 className="font-semibold">New Connection</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm mb-2 block">Child Meter (From)</label>
                  <Select value={childMeterId} onValueChange={setChildMeterId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select meter" />
                    </SelectTrigger>
                    <SelectContent>
                      {meters.map((meter) => (
                        <SelectItem key={meter.id} value={meter.id}>
                          {meter.meter_number} ({meter.meter_type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm mb-2 block">Parent Meter (To)</label>
                  <Select value={parentMeterId} onValueChange={setParentMeterId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select meter" />
                    </SelectTrigger>
                    <SelectContent>
                      {meters.map((meter) => (
                        <SelectItem key={meter.id} value={meter.id}>
                          {meter.meter_number} ({meter.meter_type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddConnection} className="flex-1">
                  Create Connection
                </Button>
                <Button variant="outline" onClick={() => setIsAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {isLoading ? (
            <p className="text-center text-muted-foreground py-8">Loading connections...</p>
          ) : connections.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <p>No meter connections defined yet</p>
              <p className="text-sm mt-2">Add connections to show meter hierarchy</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Child Meter</TableHead>
                  <TableHead className="text-center">→</TableHead>
                  <TableHead>Parent Meter</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((conn) => (
                  <TableRow key={conn.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{conn.child_meter?.meter_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {conn.child_meter?.meter_type}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <ArrowRight className="w-4 h-4 mx-auto" />
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{conn.parent_meter?.meter_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {conn.parent_meter?.meter_type}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(conn.id)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
