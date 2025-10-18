import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Plus, MapPin, ArrowLeft, Building2 } from "lucide-react";
import { toast } from "sonner";

interface Client {
  id: string;
  name: string;
  code: string;
  contact_email: string | null;
  contact_phone: string | null;
}

interface Site {
  id: string;
  name: string;
  address: string | null;
  council_connection_point: string | null;
  created_at: string;
}

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (id) {
      fetchClient();
      fetchSites();
    }
  }, [id]);

  const fetchClient = async () => {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      toast.error("Failed to load client");
      navigate("/clients");
    } else {
      setClient(data);
    }
  };

  const fetchSites = async () => {
    const { data, error } = await supabase
      .from("sites")
      .select("*")
      .eq("client_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch sites");
    } else {
      setSites(data || []);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);

    const { error } = await supabase.from("sites").insert({
      name: formData.get("name") as string,
      client_id: id,
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

  if (!client) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Loading client...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate("/clients")}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Clients
            </Button>
            <div>
              <h1 className="text-4xl font-bold mb-2">{client.name}</h1>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="font-mono">{client.code}</span>
                {client.contact_email && <span>{client.contact_email}</span>}
                {client.contact_phone && <span>{client.contact_phone}</span>}
              </div>
            </div>
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
                <DialogDescription>Create a new monitoring site for {client.name}</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
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
              <p className="text-muted-foreground mb-4">Add the first monitoring site for this client</p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Site
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sites.map((site) => (
              <Card
                key={site.id}
                className="border-border/50 hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => navigate(`/sites/${site.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <MapPin className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{site.name}</CardTitle>
                        {site.address && (
                          <CardDescription className="text-xs mt-1">{site.address}</CardDescription>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {site.council_connection_point && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {site.council_connection_point}
                        </Badge>
                        <span className="text-xs text-muted-foreground">Connection Point</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Created {new Date(site.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
