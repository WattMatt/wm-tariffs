import { ReactNode, useEffect, useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { User } from "@supabase/supabase-js";
import { 
  LayoutDashboard, 
  Building2, 
  MapPin, 
  Gauge, 
  BarChart3, 
  LogOut,
  Zap,
  Users,
  FileText,
  ChevronLeft,
  ChevronRight,
  LineChart,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardLayoutProps {
  children: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{ full_name: string } | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    // Persist collapsed state in localStorage
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved === 'true';
  });

  // Update localStorage when collapsed state changes
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      setUser(session.user);
      
      // Fetch profile
      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .single();
      
      if (profileData) {
        setProfile(profileData);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        navigate("/auth");
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
    { icon: Building2, label: "Clients", path: "/clients" },
    { icon: LineChart, label: "Load Profile", path: "/load-profile" },
    { icon: FileText, label: "Tariffs", path: "/tariffs" },
    { icon: Users, label: "Users", path: "/users" },
    { icon: Settings, label: "Settings", path: "/settings" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <aside className={cn(
        "fixed left-0 top-0 h-full bg-secondary border-r border-border flex flex-col transition-all duration-300",
        collapsed ? "w-20" : "w-64"
      )}>
        {/* Collapse Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-6 z-50 h-6 w-6 rounded-full border bg-background shadow-md"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>

        <div className={cn("border-b border-border/50", collapsed ? "p-4" : "p-6")}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
              <Zap className="w-6 h-6 text-white" />
            </div>
            {!collapsed && (
              <div>
                <h1 className="text-lg font-bold text-secondary-foreground">Energy Recovery</h1>
                <p className="text-xs text-muted-foreground">Utility Platform</p>
              </div>
            )}
          </div>
        </div>

        <nav className={cn("flex-1 space-y-1", collapsed ? "p-2" : "p-4")}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path}>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full text-secondary-foreground/70 hover:text-secondary-foreground hover:bg-secondary-foreground/10",
                    collapsed ? "justify-center p-3 h-12" : "justify-start",
                    isActive && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  )}
                >
                  <Icon className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4 mr-3")} />
                  {!collapsed && item.label}
                </Button>
              </Link>
            );
          })}
        </nav>

        <div className={cn("border-t border-border/50", collapsed ? "p-2" : "p-4")}>
          {!collapsed && (
            <div className="mb-3 px-3">
              <p className="text-sm font-medium text-secondary-foreground">{profile?.full_name || "User"}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          )}
          <Button
            variant="ghost"
            className={cn(
              "w-full text-secondary-foreground/70 hover:text-destructive",
              collapsed ? "justify-center p-3 h-12" : "justify-start"
            )}
            onClick={handleSignOut}
          >
            <LogOut className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4 mr-3")} />
            {!collapsed && "Sign Out"}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={cn(
        "p-8 transition-all duration-300",
        collapsed ? "ml-20" : "ml-64"
      )}>
        {children}
      </main>
    </div>
  );
};
