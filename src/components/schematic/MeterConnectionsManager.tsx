import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Plus, GitBranch, ArrowRight } from "lucide-react";

interface MeterData {
  id: string;
  meter_number: string;
  name: string | null;
  meter_type: string;
}

interface Connection {
  id?: string;
  parent_meter_id: string;
  child_meter_id: string;
}

interface MeterConnectionsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  schematicId: string;
}

export function MeterConnectionsManager({ open, onOpenChange, siteId, schematicId }: MeterConnectionsManagerProps) {
  const [meters, setMeters] = useState<MeterData[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [newConnection, setNewConnection] = useState<Partial<Connection>>({});

  useEffect(() => {
    if (open) {
      fetchMeters();
      fetchConnections();
    }
  }, [open, siteId]);

  const fetchMeters = async () => {
    const { data, error } = await supabase
      .from('meters')
      .select('id, meter_number, name, meter_type')
      .eq('site_id', siteId)
      .order('meter_type', { ascending: true })
      .order('meter_number', { ascending: true });

    if (error) {
      toast.error('Failed to load meters');
      return;
    }

    setMeters(data || []);
  };

  const fetchConnections = async () => {
    const { data: siteMeters } = await supabase
      .from('meters')
      .select('id')
      .eq('site_id', siteId);

    if (!siteMeters) return;

    const meterIds = siteMeters.map(m => m.id);

    const { data, error } = await supabase
      .from('meter_connections')
      .select('*')
      .or(`child_meter_id.in.(${meterIds.join(',')}),parent_meter_id.in.(${meterIds.join(',')})`);

    if (error) {
      toast.error('Failed to load connections');
      return;
    }

    setConnections(data || []);
  };

  const handleAddConnection = async () => {
    if (!newConnection.parent_meter_id || !newConnection.child_meter_id) {
      toast.error('Please select both parent and child meters');
      return;
    }

    if (newConnection.parent_meter_id === newConnection.child_meter_id) {
      toast.error('A meter cannot be connected to itself');
      return;
    }

    // Check for duplicate
    const duplicate = connections.find(
      c => c.parent_meter_id === newConnection.parent_meter_id && 
           c.child_meter_id === newConnection.child_meter_id
    );

    if (duplicate) {
      toast.error('This connection already exists');
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from('meter_connections')
      .insert({
        parent_meter_id: newConnection.parent_meter_id,
        child_meter_id: newConnection.child_meter_id
      });

    if (error) {
      toast.error('Failed to create connection');
      setLoading(false);
      return;
    }

    toast.success('Connection created');
    setNewConnection({});
    fetchConnections();
    setLoading(false);
  };

  const handleDeleteConnection = async (connectionId: string) => {
    // First, get the connection details to find associated lines
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) return;

    console.log('Deleting connection:', connection);

    // Delete associated schematic lines - find all lines for this connection
    const { data: linesToDelete, error: fetchError } = await supabase
      .from('schematic_lines')
      .select('id')
      .eq('schematic_id', schematicId)
      .eq('line_type', 'connection');

    if (fetchError) {
      console.error('Error fetching schematic lines:', fetchError);
    }

    // Filter lines that match this connection in metadata
    const lineIdsToDelete = linesToDelete?.filter((line: any) => {
      // Need to fetch full records to check metadata
      return true; // We'll delete by metadata filter instead
    }).map(l => l.id) || [];

    console.log('Deleting schematic lines for connection');

    // Delete lines using RPC or direct filter on JSONB
    // Since contains might not work, let's get all lines and filter in memory
    const { data: allLines } = await supabase
      .from('schematic_lines')
      .select('*')
      .eq('schematic_id', schematicId)
      .eq('line_type', 'connection');

    const matchingLines = allLines?.filter((line: any) => 
      line.metadata?.parent_meter_id === connection.parent_meter_id &&
      line.metadata?.child_meter_id === connection.child_meter_id
    ) || [];

    console.log('Found matching lines:', matchingLines.length);

    // Delete each matching line
    for (const line of matchingLines) {
      const { error: deleteError } = await supabase
        .from('schematic_lines')
        .delete()
        .eq('id', line.id);
      
      if (deleteError) {
        console.error('Error deleting line:', deleteError);
      }
    }

    // Delete the connection
    const { error } = await supabase
      .from('meter_connections')
      .delete()
      .eq('id', connectionId);

    if (error) {
      toast.error('Failed to delete connection');
      return;
    }

    console.log('Connection and lines deleted successfully');
    toast.success('Connection and associated lines deleted');
    fetchConnections();
  };

  const getMeterLabel = (meterId: string) => {
    const meter = meters.find(m => m.id === meterId);
    return meter ? `${meter.meter_number} - ${meter.name || 'Unnamed'}` : 'Unknown';
  };

  const getMeterType = (meterId: string) => {
    const meter = meters.find(m => m.id === meterId);
    return meter?.meter_type || 'unknown';
  };

  const getMetersByType = (type: string) => {
    return meters.filter(m => m.meter_type === type);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Manage Meter Connections
          </DialogTitle>
          <DialogDescription>
            Define the electrical hierarchy showing which meters feed which other meters
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          {/* Add New Connection */}
          <div className="space-y-4 border-r pr-6">
            <h3 className="font-semibold flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add New Connection
            </h3>

            <div className="space-y-3">
              <div>
                <Label>Parent Meter (Supplies Power)</Label>
                <Select
                  value={newConnection.parent_meter_id}
                  onValueChange={(value) => setNewConnection({ ...newConnection, parent_meter_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select parent meter..." />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Bulk/Check Meters</div>
                    {getMetersByType('bulk_meter').map(meter => (
                      <SelectItem key={meter.id} value={meter.id}>
                        {meter.meter_number} - {meter.name || 'Unnamed'}
                      </SelectItem>
                    ))}
                    {getMetersByType('check_meter').map(meter => (
                      <SelectItem key={meter.id} value={meter.id}>
                        {meter.meter_number} - {meter.name || 'Unnamed'}
                      </SelectItem>
                    ))}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">Tenant Meters</div>
                    {getMetersByType('tenant_meter').map(meter => (
                      <SelectItem key={meter.id} value={meter.id}>
                        {meter.meter_number} - {meter.name || 'Unnamed'}
                      </SelectItem>
                    ))}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">Other</div>
                    {getMetersByType('other').map(meter => (
                      <SelectItem key={meter.id} value={meter.id}>
                        {meter.meter_number} - {meter.name || 'Unnamed'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-center">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>

              <div>
                <Label>Child Meter (Receives Power)</Label>
                <Select
                  value={newConnection.child_meter_id}
                  onValueChange={(value) => setNewConnection({ ...newConnection, child_meter_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select child meter..." />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Check Meters</div>
                    {getMetersByType('check_meter').map(meter => (
                      <SelectItem key={meter.id} value={meter.id}>
                        {meter.meter_number} - {meter.name || 'Unnamed'}
                      </SelectItem>
                    ))}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">Tenant Meters</div>
                    {getMetersByType('tenant_meter').map(meter => (
                      <SelectItem key={meter.id} value={meter.id}>
                        {meter.meter_number} - {meter.name || 'Unnamed'}
                      </SelectItem>
                    ))}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">Other</div>
                    {getMetersByType('other').map(meter => (
                      <SelectItem key={meter.id} value={meter.id}>
                        {meter.meter_number} - {meter.name || 'Unnamed'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleAddConnection} 
                disabled={loading || !newConnection.parent_meter_id || !newConnection.child_meter_id}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Connection
              </Button>
            </div>
          </div>

          {/* Existing Connections */}
          <div className="space-y-4">
            <h3 className="font-semibold">
              Existing Connections ({connections.length})
            </h3>

            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-2">
                {connections.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No connections defined yet
                  </div>
                ) : (
                  connections.map(connection => (
                    <div
                      key={connection.id}
                      className="p-3 border rounded-lg space-y-2 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 space-y-3">
                          {/* Parent meter row */}
                          <div className="flex items-center justify-between gap-3">
                            <Badge variant="outline" className="text-xs whitespace-nowrap">
                              {getMeterType(connection.parent_meter_id)}
                            </Badge>
                            <span className="text-sm font-medium text-right flex-1">
                              {getMeterLabel(connection.parent_meter_id)}
                            </span>
                          </div>
                          
                          {/* Arrow row */}
                          <div className="flex justify-center">
                            <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
                          </div>

                          {/* Child meter row */}
                          <div className="flex items-center justify-between gap-3">
                            <Badge variant="outline" className="text-xs whitespace-nowrap">
                              {getMeterType(connection.child_meter_id)}
                            </Badge>
                            <span className="text-sm text-right flex-1">
                              {getMeterLabel(connection.child_meter_id)}
                            </span>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => connection.id && handleDeleteConnection(connection.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
