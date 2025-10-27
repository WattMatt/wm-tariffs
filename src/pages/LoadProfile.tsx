import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { LineChart } from "lucide-react";

const LoadProfile = () => {
  const navigate = useNavigate();

  return (
    <DashboardLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="p-12 text-center max-w-md">
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <LineChart className="w-10 h-10 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-3">Load Profile</h1>
          <p className="text-muted-foreground mb-8">
            This feature is coming soon. We're working on bringing you comprehensive load profile analysis and visualization tools.
          </p>
          <Button onClick={() => navigate("/dashboard")} size="lg">
            Return to Dashboard
          </Button>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default LoadProfile;
