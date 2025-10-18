import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Gauge, BarChart3, FileText, Building2 } from "lucide-react";
import { toast } from "sonner";
import MetersTab from "@/components/site/MetersTab";
import SchematicsTab from "@/components/site/SchematicsTab";
import ReconciliationTab from "@/components/site/ReconciliationTab";

interface Site {
  id: string;
  name: string;
  address: string | null;
  council_connection_point: string | null;
  clients: {
    id: string;
    name: string;
    code: string;
  } | null;
}

export default function SiteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [site, setSite] = useState<Site | null>(null);

  useEffect(() => {
    if (id) {
      fetchSite();
    }
  }, [id]);

  const fetchSite = async () => {
    const { data, error } = await supabase
      .from("sites")
      .select("*, clients(id, name, code)")
      .eq("id", id)
      .single();

    if (error) {
      toast.error("Failed to load site");
      navigate("/clients");
    } else {
      setSite(data);
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
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="meters" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 lg:w-auto">
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
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
