import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Gauge, BarChart3, FileText, Building2, Coins, Pencil, TrendingUp, DollarSign, Activity, Calendar, FolderOpen, Sun, Zap, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import MetersTab from "@/components/site/MetersTab";
import SchematicsTab from "@/components/site/SchematicsTab";
import ReconciliationTab from "@/components/site/ReconciliationTab";
import LoadProfilesTab from "@/components/site/LoadProfilesTab";
import TariffsTab from "@/components/site/TariffsTab";
import CostCalculationTab from "@/components/site/CostCalculationTab";
import SiteReportExport from "@/components/site/SiteReportExport";
import DocumentsTab from "@/components/site/DocumentsTab";
import SiteOverview from "@/components/site/SiteOverview";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SiteSection = 'metering' | 'solar';

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
  const [searchParams] = useSearchParams();
  const [site, setSite] = useState<Site | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [supplyAuthorities, setSupplyAuthorities] = useState<SupplyAuthority[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [selectedProvince, setSelectedProvince] = useState<string>("");
  const [filteredAuthorities, setFilteredAuthorities] = useState<SupplyAuthority[]>([]);
  const [selectedSection, setSelectedSection] = useState<SiteSection>('metering');
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [siteStats, setSiteStats] = useState({
    meters: 0,
    readings: 0,
    latestReading: null as string | null,
    schematics: 0,
  });
  const [uploadProgress, setUploadProgress] = useState<{
    isUploading: boolean;
    current: number;
    total: number;
    action: string;
  }>({ isUploading: false, current: 0, total: 0, action: '' });

  useEffect(() => {
    if (id) {
      fetchSite();
      fetchSupplyAuthorities();
      fetchSiteStats();
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

  const fetchSiteStats = async () => {
    if (!id) return;

    // First get all meter IDs for this site
    const { data: meters } = await supabase
      .from("meters")
      .select("id")
      .eq("site_id", id);

    const meterIds = meters?.map(m => m.id) || [];

    // Then fetch stats
    const [metersRes, readingsRes, schematicsRes, latestReadingRes] = await Promise.all([
      supabase.from("meters").select("id", { count: "exact", head: true }).eq("site_id", id),
      meterIds.length > 0 
        ? supabase.from("meter_readings").select("id", { count: "exact", head: true }).in("meter_id", meterIds)
        : Promise.resolve({ count: 0 }),
      supabase.from("schematics").select("id", { count: "exact", head: true }).eq("site_id", id),
      meterIds.length > 0
        ? supabase.from("meter_readings")
            .select("reading_timestamp")
            .in("meter_id", meterIds)
            .order("reading_timestamp", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    setSiteStats({
      meters: metersRes.count || 0,
      readings: readingsRes.count || 0,
      latestReading: latestReadingRes.data?.reading_timestamp || null,
      schematics: schematicsRes.count || 0,
    });
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
            <Button variant="outline" onClick={() => setIsEditDialogOpen(true)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit Site
            </Button>
          </div>
        </div>

        {uploadProgress.isUploading && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <div>
                    <p className="font-medium">{uploadProgress.action}</p>
                    <p className="text-sm text-muted-foreground">
                      {uploadProgress.current} of {uploadProgress.total} files
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">
                    {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Meters
              </CardTitle>
              <Gauge className="w-5 h-5 text-warning" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{siteStats.meters}</div>
              <p className="text-xs text-muted-foreground mt-1">Connected meters</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Readings
              </CardTitle>
              <Activity className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{siteStats.readings.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">Data points collected</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Latest Reading
              </CardTitle>
              <Calendar className="w-5 h-5 text-accent" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">
                {siteStats.latestReading 
                  ? format(new Date(siteStats.latestReading), "MMM dd, yyyy")
                  : "No data"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {siteStats.latestReading 
                  ? format(new Date(siteStats.latestReading), "HH:mm")
                  : "Upload readings to begin"}
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Schematics
              </CardTitle>
              <FileText className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{siteStats.schematics}</div>
              <p className="text-xs text-muted-foreground mt-1">Uploaded diagrams</p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Site Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {(site.address || site.council_connection_point || site.supply_authorities) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              </div>
            )}
            
            <div className="space-y-3 pt-2 border-t">
              <div>
                <p className="text-sm font-medium mb-2">Site Sections</p>
                <p className="text-xs text-muted-foreground mb-3">Select a section to view its details</p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant={selectedSection === 'metering' ? 'default' : 'outline'}
                  onClick={() => setSelectedSection('metering')}
                  className="gap-2"
                >
                  <Zap className="w-4 h-4" />
                  Metering
                </Button>
                <Button
                  variant={selectedSection === 'solar' ? 'default' : 'outline'}
                  onClick={() => setSelectedSection('solar')}
                  className="gap-2"
                >
                  <Sun className="w-4 h-4" />
                  Solar Generation Report
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {selectedSection === 'metering' && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-9 lg:w-auto">
              <TabsTrigger value="overview" className="gap-2">
                <Activity className="w-4 h-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="schematics" className="gap-2">
                <FileText className="w-4 h-4" />
                Schematics
              </TabsTrigger>
              <TabsTrigger value="meters" className="gap-2">
                <Gauge className="w-4 h-4" />
                Meters
              </TabsTrigger>
              <TabsTrigger value="tariffs" className="gap-2">
                <DollarSign className="w-4 h-4" />
                Tariffs
              </TabsTrigger>
              <TabsTrigger value="documents" className="gap-2">
                <FolderOpen className="w-4 h-4" />
                Documents
              </TabsTrigger>
              <TabsTrigger value="load-profiles" className="gap-2">
                <TrendingUp className="w-4 h-4" />
                Energy Profiles
              </TabsTrigger>
              <TabsTrigger value="reconciliation" className="gap-2">
                <BarChart3 className="w-4 h-4" />
                Reconciliation
              </TabsTrigger>
              <TabsTrigger value="costs" className="gap-2">
                <Coins className="w-4 h-4" />
                Costs
              </TabsTrigger>
              <TabsTrigger value="audit-report" className="gap-2">
                <FileText className="w-4 h-4" />
                Audit Report
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <SiteOverview siteId={id!} siteName={site.name} />
            </TabsContent>

            <TabsContent value="schematics">
              <SchematicsTab siteId={id!} />
            </TabsContent>

            <TabsContent value="meters">
              <MetersTab siteId={id!} />
            </TabsContent>

            <TabsContent value="tariffs">
              <TariffsTab siteId={id!} />
            </TabsContent>

            <TabsContent value="documents">
              <DocumentsTab 
                siteId={id!} 
                onUploadProgressChange={setUploadProgress}
              />
            </TabsContent>

            <TabsContent value="load-profiles">
              <LoadProfilesTab siteId={id!} />
            </TabsContent>

            <TabsContent value="reconciliation">
              <ReconciliationTab siteId={id!} siteName={site?.name || ""} />
            </TabsContent>

            <TabsContent value="costs">
              <CostCalculationTab siteId={id!} />
            </TabsContent>

            <TabsContent value="audit-report">
              <SiteReportExport siteId={id!} siteName={site.name} />
            </TabsContent>
          </Tabs>
        )}

        {selectedSection === 'solar' && (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Solar Generation Report</CardTitle>
              <CardDescription>Solar generation data and analysis tools</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Sun className="w-16 h-16 text-warning mb-4" />
                <h3 className="text-xl font-semibold mb-2">Coming Soon</h3>
                <p className="text-muted-foreground max-w-md">
                  Solar generation reporting features are currently in development. 
                  This section will include solar production tracking, analysis, and reporting capabilities.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

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
