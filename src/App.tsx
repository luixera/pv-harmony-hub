import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";

// Eager: leves e usadas no caminho crítico (login + dashboards)
import Login from "./pages/Login";
import DashboardAdmin from "./pages/DashboardAdmin";
import DashboardStaff from "./pages/DashboardStaff";
import DashboardCompany from "./pages/DashboardCompany";
import ProjectsKanban from "./pages/ProjectsKanban";
import NotFound from "./pages/NotFound";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import PublicProjectForm from "./pages/PublicProjectForm";
import PublicFormSuccess from "./pages/PublicFormSuccess";

// Lazy: pesadas (Google Maps, recharts, html2pdf, mammoth, docxtemplater)
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const NewProject = lazy(() => import("./pages/NewProject"));
const ProjectSuccess = lazy(() => import("./pages/ProjectSuccess"));
const Companies = lazy(() => import("./pages/admin/Companies"));
const Users = lazy(() => import("./pages/admin/Users"));
const ViewAsCompany = lazy(() => import("./pages/admin/ViewAsCompany"));
const Financial = lazy(() => import("./pages/admin/Financial"));
const CompanyFinancial = lazy(() => import("./pages/company/CompanyFinancial"));
const FormConfig = lazy(() => import("./pages/admin/FormConfig"));
const KanbanConfig = lazy(() => import("./pages/admin/KanbanConfig"));
const EnergyConcessionaires = lazy(() => import("./pages/admin/EnergyConcessionaires"));
const ProjectsMap = lazy(() => import("./pages/ProjectsMap"));
const Profile = lazy(() => import("./pages/Profile"));
const Reports = lazy(() => import("./pages/admin/Reports"));
const Tasks = lazy(() => import("./pages/Tasks"));
const EmailUpdates = lazy(() => import("./pages/EmailUpdates"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      retry: 1,
    },
  },
});

function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}

function AppRoutes() {
  const { isAuthenticated, user } = useAuth();
  
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to={user?.role === 'admin' ? '/dashboard-admin' : user?.role === 'staff' ? '/dashboard-staff' : '/dashboard-company'} /> : <Login />} />
      <Route path="/" element={<Navigate to="/login" replace />} />
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
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
