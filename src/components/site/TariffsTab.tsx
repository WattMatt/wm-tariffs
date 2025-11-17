import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, BarChart3 } from "lucide-react";
import TariffAssignmentTab from "./TariffAssignmentTab";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface TariffsTabProps {
  siteId: string;
}

export default function TariffsTab({ siteId }: TariffsTabProps) {
  return (
    <Tabs defaultValue="assignments" className="space-y-6">
      <TabsList className="grid w-full grid-cols-2 lg:w-auto">
        <TabsTrigger value="assignments" className="gap-2">
          <DollarSign className="w-4 h-4" />
          Assignments
        </TabsTrigger>
        <TabsTrigger value="analysis" className="gap-2">
          <BarChart3 className="w-4 h-4" />
          Analysis
        </TabsTrigger>
      </TabsList>

      <TabsContent value="assignments">
        <TariffAssignmentTab siteId={siteId} />
      </TabsContent>

      <TabsContent value="analysis">
        <TariffAssignmentTab siteId={siteId} hideLocationInfo={true} showDocumentCharts={true} />
      </TabsContent>
    </Tabs>
  );
}
