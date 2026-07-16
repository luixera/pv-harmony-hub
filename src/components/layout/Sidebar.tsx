import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Kanban,
  FolderOpen,
  Building2,
  Users,
  FileText,
  Settings,
  PlusCircle,
  ChevronLeft,
  ChevronRight,
  Sun,
  DollarSign,
  FormInput,
  X,
  Map,
  UserCircle,
  BarChart2,
  CheckSquare,
  Mail,
  Zap,
} from 'lucide-react';
import { Cpu } from 'lucide-react';
import { useMyPendingTasks } from '@/hooks/useTasks';
import { useEmailUpdates } from '@/hooks/useEmailUpdates';
import { useTenant, useTenantFeatures } from '@/hooks/useTenant';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

interface SidebarItem {
  icon: React.ElementType;
  label: string;
  path: string;
  roles: ('admin' | 'staff' | 'company')[];
}

const sidebarItems: SidebarItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard-admin', roles: ['admin'] },
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard-staff', roles: ['staff'] },
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard-company', roles: ['company'] },
  { icon: Kanban, label: 'Kanban', path: '/projects', roles: ['admin', 'staff'] },
  { icon: CheckSquare, label: 'Tarefas', path: '/tasks', roles: ['admin', 'staff'] },
  { icon: Mail, label: 'Email', path: '/email-updates', roles: ['admin', 'staff'] },
  { icon: DollarSign, label: 'Financeiro', path: '/admin/financial', roles: ['admin'] },
  { icon: BarChart2, label: 'Relatórios', path: '/reports', roles: ['admin'] },
  { icon: FolderOpen, label: 'Meus Projetos', path: '/company/projects', roles: ['company'] },
  { icon: DollarSign, label: 'Financeiro', path: '/company/financial', roles: ['company'] },
  { icon: PlusCircle, label: 'Novo Projeto', path: '/new-project', roles: ['company'] },
  { icon: Building2, label: 'Empresas', path: '/admin/companies', roles: ['admin'] },
  { icon: Users, label: 'Usuários', path: '/admin/users', roles: ['admin'] },
  { icon: Sun, label: 'Concessionárias', path: '/admin/energy-concessionaires', roles: ['admin', 'staff'] },
  { icon: Cpu, label: 'Equipamentos', path: '/admin/equipment', roles: ['admin', 'staff'] },
  { icon: Zap, label: 'Automações', path: '/admin/automations', roles: ['admin'] },
  { icon: FormInput, label: 'Formulários', path: '/admin/form-config', roles: ['admin'] },
  { icon: Map, label: 'Mapa de Projetos', path: '/projects-map', roles: ['admin', 'staff'] },
  { icon: Kanban, label: 'Config. Kanban', path: '/admin/kanban-config', roles: ['admin'] },
  { icon: UserCircle, label: 'Meu Perfil', path: '/profile', roles: ['admin', 'staff', 'company'] },
  { icon: Settings, label: 'Configurações', path: '/settings', roles: ['admin'] },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const { data: pendingTasks  = [] } = useMyPendingTasks();
  const pendingCount = pendingTasks.length;
  const { data: emailUpdates = [] } = useEmailUpdates({ status: 'pending' });
  const emailBadge = emailUpdates.filter(u => u.ai_suggested_status !== null).length;
  const { data: tenant } = useTenant();
  const features = useTenantFeatures();

  // Rotas ocultadas conforme os recursos do plano do tenant
  const featureGate: Record<string, boolean> = {
    '/email-updates': features.email_agent !== false,
    '/projects-map': features.map !== false,
    '/reports': features.reports !== false,
    '/admin/automations': features.automations !== false,
  };

  const filteredItems = sidebarItems.filter(item =>
    user && item.roles.includes(user.role) && featureGate[item.path] !== false
  );

  // Marca exibida: logo/nome do tenant, com fallback para a marca padrão
  const brandLogo = tenant?.logo_url || '/logo.png';
  const brandName = tenant?.name || 'GD Manager';

  const handleNavClick = (path: string) => {
    navigate(path);
    if (isMobile && onClose) onClose();
  };

  if (isMobile) {
    return (
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={onClose}
            />
            {/* Drawer */}
            <motion.aside
              key="drawer"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed left-0 top-0 h-screen w-72 bg-sidebar border-r border-sidebar-border flex flex-col z-50"
            >
              {/* Header */}
              <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border">
                <Link to="/" className="flex items-center gap-3" onClick={onClose}>
                  <img src={brandLogo} alt={brandName} style={{ width: 36, height: 36, objectFit: 'contain' }} />
                  <div className="flex flex-col leading-tight">
                    <span className="font-bold text-lg text-white">{brandName}</span>
                    <span className="text-[11px] font-medium" style={{ color: '#F5A800' }}>GD Manager</span>
                  </div>
                </Link>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors text-muted-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Navigation */}
              <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto scrollbar-thin">
                {filteredItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  const badge = item.path === '/tasks' && pendingCount > 0 ? pendingCount : item.path === '/email-updates' && emailBadge > 0 ? emailBadge : 0;
                  return (
                    <button
                      key={item.path}
                      onClick={() => handleNavClick(item.path)}
                      className={cn(
                        "sidebar-item w-full min-h-[56px]",
                        isActive && "active"
                      )}
                    >
                      <div className="relative flex-shrink-0">
                        <item.icon className="w-5 h-5" />
                        {badge > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-0.5 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: '#E24B4A' }}>
                            {badge > 99 ? '99+' : badge}
                          </span>
                        )}
                      </div>
                      <span className="truncate text-base">{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* User info */}
              {user && (
                <div className="p-4 border-t border-sidebar-border">
                  <button
                    onClick={() => { navigate('/profile'); if (onClose) onClose(); }}
                    className="w-full text-left px-4 py-3 rounded-lg transition-colors hover:bg-white/10"
                    style={{ background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer' }}
                  >
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Conectado como</p>
                    <p className="text-sm font-medium truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{user.name}</p>
                    <p className="text-xs capitalize font-medium" style={{ color: '#F5A800' }}>{user.role}</p>
                  </button>
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    );
  }

  // Desktop sidebar
  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className={cn(
        "fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col z-40 transition-all duration-300",
        collapsed ? "w-20" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-3">
          <img src={brandLogo} alt={brandName} style={{ width: 36, height: 36, objectFit: 'contain' }} />
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col leading-tight"
            >
              <span className="font-bold text-lg text-white">{brandName}</span>
              <span className="text-[11px] font-medium" style={{ color: '#F5A800' }}>GD Manager</span>
            </motion.div>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors text-muted-foreground"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto scrollbar-thin">
        {filteredItems.map((item) => {
          const isActive = location.pathname === item.path;
          const badge = item.path === '/tasks' && pendingCount > 0 ? pendingCount : 0;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "sidebar-item w-full",
                isActive && "active"
              )}
            >
              <div className="relative flex-shrink-0">
                <item.icon className="w-5 h-5" />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-0.5 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: '#E24B4A' }}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="truncate"
                >
                  {item.label}
                </motion.span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User Role Indicator */}
      {!collapsed && user && (
        <div className="p-4 border-t border-sidebar-border">
          <button
            onClick={() => navigate('/profile')}
            className="w-full text-left px-4 py-3 rounded-lg bg-sidebar-accent hover:bg-sidebar-accent/80 transition-colors group"
            style={{ border: 'none', cursor: 'pointer' }}
          >
            <p className="text-xs text-muted-foreground">Conectado como</p>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{user.name}</p>
              <UserCircle className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2" />
            </div>
            <p className="text-xs text-primary capitalize">{user.role}</p>
          </button>
        </div>
      )}
    </motion.aside>
  );
}
