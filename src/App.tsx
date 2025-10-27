import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import ClientDetail from "./pages/ClientDetail";
import SiteDetail from "./pages/SiteDetail";
import Sites from "./pages/Sites";
import Meters from "./pages/Meters";
import Reconciliation from "./pages/Reconciliation";
import Users from "./pages/Users";
import Schematics from "./pages/Schematics";
import SchematicViewer from "./pages/SchematicViewer";
import Tariffs from "./pages/Tariffs";
import LoadProfile from "./pages/LoadProfile";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/sites/:id" element={<SiteDetail />} />
          {/* Legacy routes for backwards compatibility */}
          <Route path="/sites" element={<Sites />} />
          <Route path="/meters" element={<Meters />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
          <Route path="/schematics" element={<Schematics />} />
          <Route path="/schematics/:id" element={<SchematicViewer />} />
          <Route path="/tariffs" element={<Tariffs />} />
          <Route path="/load-profile" element={<LoadProfile />} />
          <Route path="/users" element={<Users />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
