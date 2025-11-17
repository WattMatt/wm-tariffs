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
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Tariff Analysis</CardTitle>
            <CardDescription>
              Compare assigned tariffs against uploaded documents
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BarChart3 className="w-16 h-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center max-w-md">
              This feature will analyze and compare your selected tariffs against the extracted data from uploaded documents.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Coming soon...
            </p>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
