import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { motion } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { LayoutGrid, Kanban, PlusCircle, FolderOpen, Bell } from 'lucide-react';

interface MainLayoutProps {
  children: React.ReactNode;
}

function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const items = user?.role === 'company'
    ? [
        { icon: LayoutGrid, label: 'Dashboard', path: '/dashboard-company' },
        { icon: FolderOpen, label: 'Projetos', path: '/company/projects' },
        { icon: PlusCircle, label: 'Novo', path: '/new-project' },
        { icon: Bell, label: 'Avisos', path: '/notifications', disabled: true },
      ]
    : [
        { icon: LayoutGrid, label: 'Dashboard', path: user?.role === 'admin' ? '/dashboard-admin' : '/dashboard-staff' },
        { icon: Kanban, label: 'Kanban', path: '/projects' },
        { icon: PlusCircle, label: 'Novo', path: '/new-project', hidden: user?.role === 'staff' },
        { icon: Bell, label: 'Avisos', path: '/notifications', disabled: true },
      ];

  const visibleItems = items.filter(i => !i.hidden);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-sidebar border-t border-sidebar-border flex items-stretch h-16 safe-area-bottom">
      {visibleItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <button
            key={item.path}
            onClick={() => !item.disabled && navigate(item.path)}
            disabled={!!item.disabled}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-1 transition-colors min-h-[64px]",
              isActive ? "text-primary" : "text-muted-foreground",
              item.disabled && "opacity-40 cursor-not-allowed"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-none">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function MainLayout({ children }: MainLayoutProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F0F0F0]">
      <Sidebar
        open={isMobile ? sidebarOpen : true}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Desktop: offset by sidebar width; Mobile: no offset */}
      <div className={cn(
        "transition-all duration-300",
        !isMobile && "ml-64"
      )}>
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <motion.main
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={cn(
            "p-4 md:p-6",
            isMobile && "pb-20" // space for bottom nav
          )}
        >
          {children}
        </motion.main>
      </div>

      {/* Bottom navigation — mobile only */}
      {isMobile && <BottomNav />}
    </div>
  );
}
