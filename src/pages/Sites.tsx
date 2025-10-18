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

interface SupplyAuthority {
  id: string;
  name: string;
  region: string;
}

export default function Sites() {
  const [sites, setSites] = useState<Site[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [supplyAuthorities, setSupplyAuthorities] = useState<SupplyAuthority[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [selectedProvince, setSelectedProvince] = useState<string>("");
  const [filteredAuthorities, setFilteredAuthorities] = useState<SupplyAuthority[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchSites();
    fetchClients();
    fetchSupplyAuthorities();
  }, []);

  useEffect(() => {
    if (selectedProvince) {
      const filtered = supplyAuthorities.filter(
        auth => auth.region === selectedProvince
      );
      setFilteredAuthorities(filtered);
    } else {
      setFilteredAuthorities([]);
    }
  }, [selectedProvince, supplyAuthorities]);

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

  const fetchSupplyAuthorities = async () => {
    const { data } = await supabase
      .from("supply_authorities")
      .select("id, name, region")
      .eq("active", true)
      .order("region, name");
    
    if (data) {
      setSupplyAuthorities(data);
      const uniqueProvinces = [...new Set(data.map(auth => auth.region))].filter(Boolean);
      setProvinces(uniqueProvinces.sort());
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const supplyAuthorityId = formData.get("supply_authority") as string;

    const { error } = await supabase.from("sites").insert({
      name: formData.get("name") as string,
      client_id: formData.get("client") as string,
      address: formData.get("address") as string,
      council_connection_point: formData.get("connection") as string,
      supply_authority_id: supplyAuthorityId || null,
    });

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Site created successfully");
      setIsDialogOpen(false);
      setSelectedProvince("");
      setFilteredAuthorities([]);
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
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add New Site</DialogTitle>
                <DialogDescription>
                  Create a new physical monitoring site
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="client">Client *</Label>
                  <Select name="client" required>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent className="bg-background z-50">
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Site Name *</Label>
                  <Input id="name" name="name" required placeholder="Main Distribution Center" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" name="address" placeholder="123 Industrial Rd, City" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="connection">Council Connection Point</Label>
                  <Input id="connection" name="connection" placeholder="800kVA" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="province">Province</Label>
                    <Select 
                      value={selectedProvince} 
                      onValueChange={setSelectedProvince}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select province" />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        {provinces.map((province) => (
                          <SelectItem key={province} value={province}>
                            {province}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="supply_authority">Municipality / Eskom</Label>
                    <Select 
                      name="supply_authority" 
                      disabled={!selectedProvince || filteredAuthorities.length === 0}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder={
                          !selectedProvince 
                            ? "Select province first" 
                            : filteredAuthorities.length === 0 
                              ? "No authorities" 
                              : "Select authority"
                        } />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        {filteredAuthorities.map((auth) => (
                          <SelectItem key={auth.id} value={auth.id}>
                            {auth.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
