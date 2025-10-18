import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Plus } from "lucide-react";
import SupplyAuthoritiesTab from "@/components/tariffs/SupplyAuthoritiesTab";
import TariffStructuresTab from "@/components/tariffs/TariffStructuresTab";
import TariffImportDialog from "@/components/tariffs/TariffImportDialog";

export default function Tariffs() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">NERSA Tariffs</h1>
            <p className="text-muted-foreground">
              Manage supply authorities and tariff structures for accurate cost calculations
            </p>
          </div>
          <TariffImportDialog />
        </div>

        <Tabs defaultValue="authorities" className="space-y-6">
          <TabsList>
            <TabsTrigger value="authorities">Supply Authorities</TabsTrigger>
            <TabsTrigger value="structures">Tariff Structures</TabsTrigger>
          </TabsList>

          <TabsContent value="authorities">
            <SupplyAuthoritiesTab />
          </TabsContent>

          <TabsContent value="structures">
            <TariffStructuresTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
