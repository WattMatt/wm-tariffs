import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import TariffStructuresTab from "@/components/tariffs/TariffStructuresTab";
import TariffImportDialog from "@/components/tariffs/TariffImportDialog";

interface SupplyAuthority {
  id: string;
  name: string;
  region: string | null;
  nersa_increase_percentage: number | null;
}

export default function Tariffs() {
  const [authorities, setAuthorities] = useState<SupplyAuthority[]>([]);
  const [selectedAuthority, setSelectedAuthority] = useState<string | null>(null);
  const [selectedAuthorityData, setSelectedAuthorityData] = useState<SupplyAuthority | null>(null);

  useEffect(() => {
    fetchAuthorities();
  }, []);

  useEffect(() => {
    if (selectedAuthority) {
      const authority = authorities.find(a => a.id === selectedAuthority);
      setSelectedAuthorityData(authority || null);
    } else {
      setSelectedAuthorityData(null);
    }
  }, [selectedAuthority, authorities]);

  const fetchAuthorities = async () => {
    const { data, error } = await supabase
      .from("supply_authorities")
      .select("*")
      .eq("active", true)
      .order("name");

    if (!error && data) {
      setAuthorities(data);
      // Auto-select first authority if available
      if (data.length > 0 && !selectedAuthority) {
        setSelectedAuthority(data[0].id);
      }
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">NERSA Tariffs</h1>
            <p className="text-muted-foreground">
              Select a supply authority to view and manage its tariff structures
            </p>
          </div>
          <TariffImportDialog />
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Supply Authority</CardTitle>
            <CardDescription>
              Select a municipality or utility provider to view its tariff structures
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="authority-select">Select Supply Authority</Label>
                <Select value={selectedAuthority || ""} onValueChange={setSelectedAuthority}>
                  <SelectTrigger id="authority-select" className="w-full bg-background">
                    <SelectValue placeholder="Choose a supply authority..." />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    {authorities.map((auth) => (
                      <SelectItem key={auth.id} value={auth.id}>
                        {auth.name}
                        {auth.region && ` (${auth.region})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedAuthorityData && (
                <div className="flex gap-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Region</p>
                    <p className="font-medium">{selectedAuthorityData.region || "—"}</p>
                  </div>
                  {selectedAuthorityData.nersa_increase_percentage && (
                    <div>
                      <p className="text-sm text-muted-foreground">NERSA Increase</p>
                      <p className="font-medium">{selectedAuthorityData.nersa_increase_percentage}%</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {selectedAuthority ? (
          <TariffStructuresTab 
            supplyAuthorityId={selectedAuthority}
            supplyAuthorityName={selectedAuthorityData?.name || ""}
          />
        ) : (
          <Card className="border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-muted-foreground">
                Please select a supply authority to view its tariff structures
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
