import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Building2, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
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

interface Client {
  id: string;
  name: string;
  code: string;
  contact_email: string | null;
  contact_phone: string | null;
  logo_url: string | null;
  created_at: string;
}

export default function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch clients");
    } else {
      setClients(data || []);
    }
  };

  const handleLogoUpload = async (file: File, clientId?: string) => {
    setUploadingLogo(true);
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${clientId || Date.now()}.${fileExt}`;
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const clientData = {
      name: formData.get("name") as string,
      code: formData.get("code") as string,
      contact_email: formData.get("email") as string,
      contact_phone: formData.get("phone") as string,
    };

    let error;
    let clientId = editingClient?.id;
    
    if (editingClient) {
      const { error: updateError } = await supabase
        .from("clients")
        .update(clientData)
        .eq("id", editingClient.id);
      error = updateError;
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: newClient, error: insertError } = await supabase
        .from("clients")
        .insert({ ...clientData, created_by: user?.id })
        .select()
        .single();
      error = insertError;
      clientId = newClient?.id;
    }

    // Upload logo if one was selected
    if (!error && logoFile && clientId) {
      const logoUrl = await handleLogoUpload(logoFile, clientId);
      if (logoUrl) {
        await supabase
          .from("clients")
          .update({ logo_url: logoUrl })
          .eq("id", clientId);
      }
    }

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(editingClient ? "Client updated successfully" : "Client created successfully");
      setIsDialogOpen(false);
      setEditingClient(null);
      setLogoFile(null);
      fetchClients();
    }
  };

  const handleEdit = (e: React.MouseEvent, client: Client) => {
    e.stopPropagation();
    setEditingClient(client);
    setIsDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingClientId) return;

    const { error } = await supabase
      .from("clients")
      .delete()
      .eq("id", deletingClientId);

    if (error) {
      toast.error("Failed to delete client");
    } else {
      toast.success("Client deleted successfully");
      fetchClients();
    }
    setDeletingClientId(null);
  };

  const handleCloseDialog = () => {
    if (isDialogOpen) {
      setIsDialogOpen(false);
      setEditingClient(null);
      setLogoFile(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">Clients</h1>
            <p className="text-muted-foreground">
              Manage your client organizations
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Add Client
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingClient ? "Edit Client" : "Add New Client"}</DialogTitle>
                <DialogDescription>
                  {editingClient ? "Update client organization details" : "Create a new client organization record"}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="logo">Client Logo</Label>
                  <div className="flex items-center gap-4">
                    {(logoFile || editingClient?.logo_url) && (
                      <Avatar className="w-16 h-16">
                        <AvatarImage src={logoFile ? URL.createObjectURL(logoFile) : editingClient?.logo_url || ""} />
                        <AvatarFallback><Building2 className="w-8 h-8" /></AvatarFallback>
                      </Avatar>
                    )}
                    <div className="flex-1">
                      <Input
                        id="logo"
                        type="file"
                        accept="image/*"
                        onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                        className="cursor-pointer"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Upload a logo for this client</p>
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
                    defaultValue={editingClient?.name}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">Client Code</Label>
                  <Input 
                    id="code" 
                    name="code" 
                    required 
                    placeholder="ACM001"
                    defaultValue={editingClient?.code}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Contact Email</Label>
                  <Input 
                    id="email" 
                    name="email" 
                    type="email" 
                    placeholder="contact@acme.com"
                    defaultValue={editingClient?.contact_email || ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Contact Phone</Label>
                  <Input 
                    id="phone" 
                    name="phone" 
                    type="tel" 
                    placeholder="+27 11 123 4567"
                    defaultValue={editingClient?.contact_phone || ""}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading || uploadingLogo}>
                  {isLoading || uploadingLogo ? (editingClient ? "Updating..." : "Creating...") : (editingClient ? "Update Client" : "Create Client")}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {clients.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Building2 className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No clients yet</h3>
              <p className="text-muted-foreground mb-4">Get started by adding your first client</p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Client
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>All Clients</CardTitle>
              <CardDescription>{clients.length} client{clients.length !== 1 ? 's' : ''} registered</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Contact Email</TableHead>
                    <TableHead>Contact Phone</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell 
                        className="font-medium cursor-pointer hover:underline"
                        onClick={() => navigate(`/clients/${client.id}`)}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            <AvatarImage src={client.logo_url || ""} />
                            <AvatarFallback>
                              <Building2 className="w-5 h-5" />
                            </AvatarFallback>
                          </Avatar>
                          <span>{client.name}</span>
                        </div>
                      </TableCell>
                      <TableCell><span className="font-mono text-sm">{client.code}</span></TableCell>
                      <TableCell>{client.contact_email || "—"}</TableCell>
                      <TableCell>{client.contact_phone || "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleEdit(e, client)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingClientId(client.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
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

        <AlertDialog open={!!deletingClientId} onOpenChange={() => setDeletingClientId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Client</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this client? This action cannot be undone and will also delete all associated sites, meters, and data.
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
      </div>
    </DashboardLayout>
  );
}
