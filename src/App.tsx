import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { setTrackingIdentity, startSession, clearSession, logPageView } from "./lib/tracking";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import Login from "./pages/Login";
import DashboardAdmin from "./pages/DashboardAdmin";
import DashboardStaff from "./pages/DashboardStaff";
import DashboardCompany from "./pages/DashboardCompany";
import ProjectsKanban from "./pages/ProjectsKanban";
import ProjectDetail from "./pages/ProjectDetail";
import NewProject from "./pages/NewProject";
import ProjectSuccess from "./pages/ProjectSuccess";
import NotFound from "./pages/NotFound";
import Companies from "./pages/admin/Companies";
import Users from "./pages/admin/Users";
import ViewAsCompany from "./pages/admin/ViewAsCompany";
import PublicProjectForm from "./pages/PublicProjectForm";
import PublicFormSuccess from "./pages/PublicFormSuccess";
import Financial from "./pages/admin/Financial";
import CompanyFinancial from "./pages/company/CompanyFinancial";
import FormConfig from "./pages/admin/FormConfig";
import KanbanConfig from "./pages/admin/KanbanConfig";
import EnergyConcessionaires from "./pages/admin/EnergyConcessionaires";
import EquipmentCatalog from "./pages/admin/EquipmentCatalog";
import ProjectsMap from "./pages/ProjectsMap";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Profile from "./pages/Profile";
import Reports from "./pages/admin/Reports";
import Tasks from "./pages/Tasks";
import EmailUpdates from "./pages/EmailUpdates";
import Landing from "./pages/Landing";
import Signup from "./pages/Signup";
import PainelConsole from "./pages/painel/PainelConsole";
import { TenantGate } from "./components/layout/TenantGate";

const queryClient = new QueryClient();

/** Coleta de acessos: sessão no login + page views por navegação. */
function AccessTracker() {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (isAuthenticated && user) {
      setTrackingIdentity(user.id, user.tenantId ?? null);
      startSession();
    } else {
      setTrackingIdentity(null, null);
      clearSession();
    }
  }, [isAuthenticated, user]);
  useEffect(() => {
    if (isAuthenticated && user) logPageView(location.pathname);
  }, [location.pathname, isAuthenticated, user]);
  return null;
}

function AppRoutes() {
  const { isAuthenticated, user } = useAuth();

  return (
    <TenantGate>
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to={user?.role === 'admin' ? '/dashboard-admin' : user?.role === 'staff' ? '/dashboard-staff' : '/dashboard-company'} /> : <Login />} />
      <Route path="/" element={<Landing />} />
      <Route path="/cadastro" element={<Signup />} />
      <Route path="/dashboard-admin" element={<ProtectedRoute allowedRoles={['admin']}><DashboardAdmin /></ProtectedRoute>} />
      <Route path="/dashboard-staff" element={<ProtectedRoute allowedRoles={['staff']}><DashboardStaff /></ProtectedRoute>} />
      <Route path="/dashboard-company" element={<ProtectedRoute allowedRoles={['company']}><DashboardCompany /></ProtectedRoute>} />
      <Route path="/projects" element={<ProtectedRoute allowedRoles={['admin', 'staff']}><ProjectsKanban /></ProtectedRoute>} />
      <Route path="/project/:id" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
      <Route path="/new-project" element={<ProtectedRoute allowedRoles={['company', 'admin']}><NewProject /></ProtectedRoute>} />
      <Route path="/project-success" element={<ProtectedRoute allowedRoles={['company', 'admin']}><ProjectSuccess /></ProtectedRoute>} />
      <Route path="/company/projects" element={<ProtectedRoute allowedRoles={['company']}><DashboardCompany /></ProtectedRoute>} />
      <Route path="/admin/companies" element={<ProtectedRoute allowedRoles={['admin']}><Companies /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute allowedRoles={['admin']}><Users /></ProtectedRoute>} />
      <Route path="/admin/view-as-company" element={<ProtectedRoute allowedRoles={['admin']}><ViewAsCompany /></ProtectedRoute>} />
      <Route path="/admin/financial" element={<ProtectedRoute allowedRoles={['admin']}><Financial /></ProtectedRoute>} />
      <Route path="/admin/form-config" element={<ProtectedRoute allowedRoles={['admin']}><FormConfig /></ProtectedRoute>} />
      <Route path="/admin/kanban-config" element={<ProtectedRoute allowedRoles={['admin']}><KanbanConfig /></ProtectedRoute>} />
      <Route path="/admin/energy-concessionaires" element={<ProtectedRoute allowedRoles={['admin', 'staff']}><EnergyConcessionaires /></ProtectedRoute>} />
      <Route path="/admin/equipment" element={<ProtectedRoute allowedRoles={['admin', 'staff']}><EquipmentCatalog /></ProtectedRoute>} />
      <Route path="/company/financial" element={<ProtectedRoute allowedRoles={['company']}><CompanyFinancial /></ProtectedRoute>} />
      <Route path="/projects-map" element={<ProtectedRoute allowedRoles={['admin', 'staff', 'company']}><ProjectsMap /></ProtectedRoute>} />
      <Route path="/public-form/:token" element={<PublicProjectForm />} />
      <Route path="/public-form/success" element={<PublicFormSuccess />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/reports" element={<ProtectedRoute allowedRoles={['admin']}><Reports /></ProtectedRoute>} />
      <Route path="/tasks" element={<ProtectedRoute allowedRoles={['admin', 'staff']}><Tasks /></ProtectedRoute>} />
      <Route path="/email-updates" element={<ProtectedRoute allowedRoles={['admin', 'staff']}><EmailUpdates /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      {/* Console da plataforma (login próprio, só master) */}
      <Route path="/painel" element={<PainelConsole />} />
      <Route path="/master" element={<Navigate to="/painel" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </TenantGate>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AccessTracker />
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
