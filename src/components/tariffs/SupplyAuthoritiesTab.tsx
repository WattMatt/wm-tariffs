import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Building2 } from "lucide-react";
import { toast } from "sonner";

interface SupplyAuthority {
  id: string;
  name: string;
  region: string | null;
  nersa_increase_percentage: number | null;
  active: boolean;
  created_at: string;
}

export default function SupplyAuthoritiesTab() {
  const [authorities, setAuthorities] = useState<SupplyAuthority[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchAuthorities();
  }, []);

  const fetchAuthorities = async () => {
    const { data, error } = await supabase
      .from("supply_authorities")
      .select("*")
      .order("name");

    if (error) {
      toast.error("Failed to fetch supply authorities");
    } else {
      setAuthorities(data || []);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);

    const { error } = await supabase.from("supply_authorities").insert({
      name: formData.get("name") as string,
      region: formData.get("region") as string,
      nersa_increase_percentage: parseFloat(formData.get("increase") as string) || null,
      active: true,
    });

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Supply authority created");
      setIsDialogOpen(false);
      fetchAuthorities();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Supply Authorities</h2>
          <p className="text-muted-foreground">Municipalities and utility providers</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Add Authority
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Supply Authority</DialogTitle>
              <DialogDescription>Create a new municipality or utility provider</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Authority Name</Label>
                <Input id="name" name="name" required placeholder="Ba-Phalaborwa Municipality" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="region">Region/Province</Label>
                <Input id="region" name="region" placeholder="Limpopo Province" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="increase">NERSA Increase %</Label>
                <Input
                  id="increase"
                  name="increase"
                  type="number"
                  step="0.01"
                  placeholder="12.92"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creating..." : "Create Authority"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {authorities.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Building2 className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No supply authorities yet</h3>
            <p className="text-muted-foreground mb-4">Add municipalities and utility providers</p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Authority
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>All Supply Authorities</CardTitle>
            <CardDescription>
              {authorities.length} authorit{authorities.length !== 1 ? "ies" : "y"} registered
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>NERSA Increase</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {authorities.map((authority) => (
                  <TableRow key={authority.id}>
                    <TableCell className="font-medium">{authority.name}</TableCell>
                    <TableCell>{authority.region || "—"}</TableCell>
                    <TableCell>
                      {authority.nersa_increase_percentage ? (
                        <Badge variant="outline" className="font-mono">
                          {authority.nersa_increase_percentage}%
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {authority.active ? (
                        <Badge className="bg-accent text-accent-foreground">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(authority.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
