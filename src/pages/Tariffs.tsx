import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
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
  const [provinces, setProvinces] = useState<string[]>([]);
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  const [selectedAuthority, setSelectedAuthority] = useState<string | null>(null);
  const [selectedAuthorityData, setSelectedAuthorityData] = useState<SupplyAuthority | null>(null);
  const [filteredAuthorities, setFilteredAuthorities] = useState<SupplyAuthority[]>([]);

  useEffect(() => {
    fetchAuthorities();
  }, []);

  useEffect(() => {
    if (selectedProvince) {
      const filtered = authorities.filter(a => a.region === selectedProvince);
      setFilteredAuthorities(filtered);
      
      // Auto-select first authority in the province
      if (filtered.length > 0) {
        setSelectedAuthority(filtered[0].id);
      } else {
        setSelectedAuthority(null);
      }
    } else {
      setFilteredAuthorities([]);
      setSelectedAuthority(null);
    }
  }, [selectedProvince, authorities]);

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
      
      // Extract unique provinces
      const uniqueProvinces = [...new Set(data.map(a => a.region).filter(Boolean))] as string[];
      setProvinces(uniqueProvinces.sort());
      
      // Auto-select first province if available
      if (uniqueProvinces.length > 0 && !selectedProvince) {
        setSelectedProvince(uniqueProvinces[0]);
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
              Select a province and municipality to view and manage tariff structures
            </p>
          </div>
          <TariffImportDialog />
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Location Selection</CardTitle>
            <CardDescription>
              Choose province first, then municipality to view tariff structures
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="province-select">Province</Label>
                <Select value={selectedProvince || ""} onValueChange={setSelectedProvince}>
                  <SelectTrigger id="province-select" className="w-full bg-background">
                    <SelectValue placeholder="Select province..." />
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

              {selectedProvince && (
                <div className="space-y-2">
                  <Label htmlFor="authority-select">Municipality / Supply Authority</Label>
                  <Select value={selectedAuthority || ""} onValueChange={setSelectedAuthority}>
                    <SelectTrigger id="authority-select" className="w-full bg-background">
                      <SelectValue placeholder="Select municipality..." />
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
              )}

              {selectedAuthorityData && (
                <div className="flex gap-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Province</p>
                    <p className="font-medium">{selectedAuthorityData.region || "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Municipality</p>
                    <p className="font-medium">{selectedAuthorityData.name}</p>
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
        ) : selectedProvince ? (
          <Card className="border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-muted-foreground">
                Please select a municipality to view its tariff structures
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-muted-foreground">
                Please select a province to begin
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
