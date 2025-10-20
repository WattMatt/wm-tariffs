import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { Plus, MapPin, ArrowLeft, Building2, Pencil } from "lucide-react";
import { toast } from "sonner";

interface Client {
  id: string;
  name: string;
  code: string;
  contact_email: string | null;
  contact_phone: string | null;
  logo_url: string | null;
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
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);

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

  const handleLogoUpload = async (file: File) => {
    if (!id) return null;
    
    setUploadingLogo(true);
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${id}.${fileExt}`;
    const filePath = fileName;

    const { error: uploadError } = await supabase.storage
      .from('client-logos')
      .upload(filePath, file, { upsert: true });

    setUploadingLogo(false);

    if (uploadError) {
      toast.error("Failed to upload logo");
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('client-logos')
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const handleEditClient = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const updateData: any = {
      name: formData.get("name") as string,
      code: formData.get("code") as string,
      contact_email: formData.get("email") as string,
      contact_phone: formData.get("phone") as string,
    };

    // Upload logo if one was selected
    if (logoFile) {
      const logoUrl = await handleLogoUpload(logoFile);
      if (logoUrl) {
        updateData.logo_url = logoUrl;
      }
    }

    const { error } = await supabase
      .from("clients")
      .update(updateData)
      .eq("id", id);

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Client updated successfully");
      setIsEditDialogOpen(false);
      setLogoFile(null);
      fetchClient();
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
            <Avatar className="w-16 h-16">
              <AvatarImage src={client.logo_url || ""} />
              <AvatarFallback>
                <Building2 className="w-8 h-8" />
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-4xl font-bold mb-2">{client.name}</h1>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="font-mono">{client.code}</span>
                {client.contact_email && <span>{client.contact_email}</span>}
                {client.contact_phone && <span>{client.contact_phone}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsEditDialogOpen(true)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit Client
            </Button>
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
        </div>

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Client</DialogTitle>
              <DialogDescription>Update client organization details</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleEditClient} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="logo">Client Logo</Label>
                <div className="flex items-center gap-4">
                  <Avatar className="w-16 h-16">
                    <AvatarImage src={logoFile ? URL.createObjectURL(logoFile) : client?.logo_url || ""} />
                    <AvatarFallback><Building2 className="w-8 h-8" /></AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <Input
                      id="logo"
                      type="file"
                      accept="image/*"
                      onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                      className="cursor-pointer"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Upload a new logo (optional)</p>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Client Name</Label>
                <Input 
                  id="name" 
                  name="name" 
                  required 
                  placeholder="Acme Corporation"
                  defaultValue={client?.name}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">Client Code</Label>
                <Input 
                  id="code" 
                  name="code" 
                  required 
                  placeholder="ACM001"
                  defaultValue={client?.code}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Contact Email</Label>
                <Input 
                  id="email" 
                  name="email" 
                  type="email" 
                  placeholder="contact@acme.com"
                  defaultValue={client?.contact_email || ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Contact Phone</Label>
                <Input 
                  id="phone" 
                  name="phone" 
                  type="tel" 
                  placeholder="+27 11 123 4567"
                  defaultValue={client?.contact_phone || ""}
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading || uploadingLogo}>
                {isLoading || uploadingLogo ? "Updating..." : "Update Client"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

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
