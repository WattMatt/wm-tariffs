import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Gauge, BarChart3, FileText, Building2, Coins, Pencil, TrendingUp, DollarSign } from "lucide-react";
import { toast } from "sonner";
import MetersTab from "@/components/site/MetersTab";
import SchematicsTab from "@/components/site/SchematicsTab";
import ReconciliationTab from "@/components/site/ReconciliationTab";
import LoadProfilesTab from "@/components/site/LoadProfilesTab";
import TariffAssignmentTab from "@/components/site/TariffAssignmentTab";
import CostCalculationTab from "@/components/site/CostCalculationTab";
import SiteReportExport from "@/components/site/SiteReportExport";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Site {
  id: string;
  name: string;
  address: string | null;
  council_connection_point: string | null;
  supply_authority_id: string | null;
  clients: {
    id: string;
    name: string;
    code: string;
  } | null;
  supply_authorities: {
    id: string;
    name: string;
    region: string;
  } | null;
}

interface SupplyAuthority {
  id: string;
  name: string;
  region: string;
}

export default function SiteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [site, setSite] = useState<Site | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [supplyAuthorities, setSupplyAuthorities] = useState<SupplyAuthority[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [selectedProvince, setSelectedProvince] = useState<string>("");
  const [filteredAuthorities, setFilteredAuthorities] = useState<SupplyAuthority[]>([]);

  useEffect(() => {
    if (id) {
      fetchSite();
      fetchSupplyAuthorities();
    }
  }, [id]);

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

  const fetchSite = async () => {
    const { data, error } = await supabase
      .from("sites")
      .select("*, clients(id, name, code), supply_authorities(id, name, region)")
      .eq("id", id)
      .single();

    if (error) {
      toast.error("Failed to load site");
      navigate("/clients");
    } else {
      setSite(data);
      if (data.supply_authorities?.region) {
        setSelectedProvince(data.supply_authorities.region);
      }
    }
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

  const handleEditSite = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const supplyAuthorityId = formData.get("supply_authority") as string;

    const { error } = await supabase
      .from("sites")
      .update({
        name: formData.get("name") as string,
        address: formData.get("address") as string,
        council_connection_point: formData.get("connection") as string,
        supply_authority_id: supplyAuthorityId || null,
      })
      .eq("id", id);

    setIsLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Site updated successfully");
      setIsEditDialogOpen(false);
      setSelectedProvince("");
      fetchSite();
    }
  };

  if (!site) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Loading site...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => navigate(`/clients/${site.clients?.id}`)}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to {site.clients?.name}
          </Button>
        </div>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">{site.name}</h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {site.clients && (
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  <span>{site.clients.name}</span>
                  <span className="font-mono">({site.clients.code})</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <SiteReportExport site={site} />
            <Button variant="outline" onClick={() => setIsEditDialogOpen(true)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit Site
            </Button>
          </div>
        </div>

        {(site.address || site.council_connection_point) && (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Site Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {site.address && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Address</p>
                  <p className="font-medium">{site.address}</p>
                </div>
              )}
              {site.council_connection_point && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Council Connection Point</p>
                  <p className="font-mono font-medium">{site.council_connection_point}</p>
                </div>
              )}
              {site.supply_authorities && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Supply Authority</p>
                  <p className="font-medium">{site.supply_authorities.name}</p>
                  <p className="text-xs text-muted-foreground">{site.supply_authorities.region}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="meters" className="space-y-6">
          <TabsList className="grid w-full grid-cols-6 lg:w-auto">
            <TabsTrigger value="meters" className="gap-2">
              <Gauge className="w-4 h-4" />
              Meters
            </TabsTrigger>
            <TabsTrigger value="schematics" className="gap-2">
              <FileText className="w-4 h-4" />
              Schematics
            </TabsTrigger>
            <TabsTrigger value="reconciliation" className="gap-2">
              <BarChart3 className="w-4 h-4" />
              Reconciliation
            </TabsTrigger>
            <TabsTrigger value="load-profiles" className="gap-2">
              <TrendingUp className="w-4 h-4" />
              Load Profiles
            </TabsTrigger>
            <TabsTrigger value="tariffs" className="gap-2">
              <DollarSign className="w-4 h-4" />
              Tariffs
            </TabsTrigger>
            <TabsTrigger value="costs" className="gap-2">
              <Coins className="w-4 h-4" />
              Costs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="meters">
            <MetersTab siteId={id!} />
          </TabsContent>

          <TabsContent value="schematics">
            <SchematicsTab siteId={id!} />
          </TabsContent>

          <TabsContent value="reconciliation">
            <ReconciliationTab siteId={id!} />
          </TabsContent>

          <TabsContent value="load-profiles">
            <LoadProfilesTab siteId={id!} />
          </TabsContent>

          <TabsContent value="tariffs">
            <TariffAssignmentTab siteId={id!} />
          </TabsContent>

          <TabsContent value="costs">
            <CostCalculationTab siteId={id!} />
          </TabsContent>
        </Tabs>

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Site</DialogTitle>
              <DialogDescription>Update site details</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleEditSite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Site Name *</Label>
                <Input 
                  id="name" 
                  name="name" 
                  required 
                  placeholder="Main Distribution Center"
                  defaultValue={site?.name}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input 
                  id="address" 
                  name="address" 
                  placeholder="123 Industrial Rd, City"
                  defaultValue={site?.address || ""}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="connection">Council Connection Point</Label>
                <Input 
                  id="connection" 
                  name="connection" 
                  placeholder="800kVA"
                  defaultValue={site?.council_connection_point || ""}
                />
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
                    defaultValue={site?.supply_authority_id || undefined}
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
                {isLoading ? "Updating..." : "Update Site"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
