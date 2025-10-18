import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Building2, MapPin, Gauge, TrendingUp } from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState({
    clients: 0,
    sites: 0,
    meters: 0,
    readings: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      const [clientsRes, sitesRes, metersRes, readingsRes] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("sites").select("id", { count: "exact", head: true }),
        supabase.from("meters").select("id", { count: "exact", head: true }),
        supabase.from("meter_readings").select("id", { count: "exact", head: true }),
      ]);

      setStats({
        clients: clientsRes.count || 0,
        sites: sitesRes.count || 0,
        meters: metersRes.count || 0,
        readings: readingsRes.count || 0,
      });
    };

    fetchStats();
  }, []);

  const statCards = [
    {
      title: "Clients",
      value: stats.clients,
      icon: Building2,
      description: "Total registered clients",
      color: "text-primary",
    },
    {
      title: "Sites",
      value: stats.sites,
      icon: MapPin,
      description: "Active monitoring sites",
      color: "text-accent",
    },
    {
      title: "Meters",
      value: stats.meters,
      icon: Gauge,
      description: "Connected meters",
      color: "text-warning",
    },
    {
      title: "Readings",
      value: stats.readings,
      icon: TrendingUp,
      description: "Data points collected",
      color: "text-primary",
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-bold mb-2">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your utility recovery tracking system
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.title} className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                  <Icon className={cn("w-5 h-5", stat.color)} />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Quick Start</CardTitle>
              <CardDescription>Get started with your utility tracking</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-primary">1</span>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Add Clients</h4>
                  <p className="text-sm text-muted-foreground">
                    Start by creating client records for organizations you track
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-primary">2</span>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Configure Sites</h4>
                  <p className="text-sm text-muted-foreground">
                    Add physical sites and define council connection points
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-primary">3</span>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Register Meters</h4>
                  <p className="text-sm text-muted-foreground">
                    Set up meters and link them to sites for tracking
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-primary">4</span>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Upload Data</h4>
                  <p className="text-sm text-muted-foreground">
                    Import meter readings via CSV and begin reconciliation
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>System Status</CardTitle>
              <CardDescription>Current platform health</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Database</span>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                  <span className="text-sm font-medium">Operational</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Authentication</span>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                  <span className="text-sm font-medium">Active</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Storage</span>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                  <span className="text-sm font-medium">Ready</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function cn(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}
