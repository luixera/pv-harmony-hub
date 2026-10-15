import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { motion } from 'framer-motion';
import { useWindowSize } from '@/hooks/useWindowSize';
import { cn } from '@/lib/utils';
import { BottomNav } from '@/components/layout/BottomNav';
import { useTaskAlerts } from '@/hooks/useTaskAlerts';
import { OnboardingController } from '@/components/onboarding/OnboardingController';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { isMobile } = useWindowSize();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useTaskAlerts();

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

      {/* Tour de boas-vindas (1º acesso + reabertura manual) */}
      <OnboardingController />
    </div>
  );
}
