import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Plus, MapPin } from "lucide-react";
import { toast } from "sonner";

interface Site {
  id: string;
  name: string;
  address: string | null;
  council_connection_point: string | null;
  created_at: string;
  clients: { name: string } | null;
}

interface Client {
  id: string;
  name: string;
}

export default function Sites() {
  const [sites, setSites] = useState<Site[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchSites();
    fetchClients();
  }, []);

  const fetchSites = async () => {
    const { data, error } = await supabase
      .from("sites")
      .select("*, clients(name)")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch sites");
    } else {
      setSites(data || []);
    }
  };

  const fetchClients = async () => {
    const { data } = await supabase
      .from("clients")
      .select("id, name")
      .order("name");
    setClients(data || []);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);

    const { error } = await supabase.from("sites").insert({
      name: formData.get("name") as string,
      client_id: formData.get("client") as string,
      address: formData.get("address") as string,
      council_connection_point: formData.get("connection") as string,
    });

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Site created successfully");
      setIsDialogOpen(false);
      fetchSites();
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">Sites</h1>
            <p className="text-muted-foreground">
              Manage physical monitoring locations
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Add Site
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Site</DialogTitle>
                <DialogDescription>
                  Create a new physical monitoring site
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="client">Client</Label>
                  <Select name="client" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Site Name</Label>
                  <Input id="name" name="name" required placeholder="Main Distribution Center" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" name="address" placeholder="123 Industrial Rd, City" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="connection">Council Connection Point</Label>
                  <Input id="connection" name="connection" placeholder="CCP-001" />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Creating..." : "Create Site"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {sites.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <MapPin className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No sites yet</h3>
              <p className="text-muted-foreground mb-4">Add your first monitoring site</p>
              <Button onClick={() => setIsDialogOpen(true)} disabled={clients.length === 0}>
                <Plus className="w-4 h-4 mr-2" />
                Add Site
              </Button>
              {clients.length === 0 && (
                <p className="text-sm text-warning mt-2">Please create a client first</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>All Sites</CardTitle>
              <CardDescription>{sites.length} site{sites.length !== 1 ? 's' : ''} registered</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site Name</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Connection Point</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sites.map((site) => (
                    <TableRow key={site.id}>
                      <TableCell className="font-medium">{site.name}</TableCell>
                      <TableCell>{site.clients?.name || "—"}</TableCell>
                      <TableCell>{site.address || "—"}</TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">{site.council_connection_point || "—"}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(site.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
