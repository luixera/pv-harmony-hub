import { useEffect, useState } from 'react';
import { useOnboarding } from '@/hooks/useOnboarding';
import { WelcomeTour } from './WelcomeTour';

/** Evento global para reabrir o tour manualmente (ex.: botão na sidebar). */
export const OPEN_TOUR_EVENT = 'open-welcome-tour';
export function openWelcomeTour() {
  window.dispatchEvent(new Event(OPEN_TOUR_EVENT));
}

/**
 * Mostra o tour de boas-vindas automaticamente no 1º acesso (por usuário) e
 * também quando disparado manualmente. Montado uma vez no MainLayout.
 */
export function OnboardingController() {
  const { pending, isLoading, complete } = useOnboarding();
  const [open, setOpen] = useState(false);

  // Abre sozinho no primeiro acesso
  useEffect(() => {
    if (!isLoading && pending) setOpen(true);
  }, [isLoading, pending]);

  // Reabertura manual ("rever tour")
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_TOUR_EVENT, handler);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, handler);
  }, []);

  if (!open) return null;

  const finish = () => { setOpen(false); complete(); };
  return <WelcomeTour onFinish={finish} onClose={() => setOpen(false)} />;
}
