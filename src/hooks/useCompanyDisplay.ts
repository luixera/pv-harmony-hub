import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentUserStaffSettings } from '@/hooks/useStaffSettings';

/**
 * Hook that determines if the current user should see company names hidden
 * and provides a function to get the display name for a company
 */
export function useCompanyDisplay() {
  const { user } = useAuth();
  const { data: staffSettings } = useCurrentUserStaffSettings();

  const shouldHideCompanyName = 
    user?.role === 'staff' && 
    staffSettings?.hide_company_name === true;

  /**
   * Returns the company display name.
   * If user should have company name hidden, returns "Cliente" instead.
   *
   * `useCallback` porque esta função é passada para componentes memoizados (as
   * colunas do Kanban): recriada a cada render, ela sozinha anularia o
   * React.memo e o quadro inteiro voltaria a re-renderizar a cada mudança.
   */
  const getCompanyDisplayName = useCallback((companyName: string | undefined | null): string => {
    if (shouldHideCompanyName) {
      return 'Cliente';
    }
    return companyName || '-';
  }, [shouldHideCompanyName]);

  return {
    shouldHideCompanyName,
    getCompanyDisplayName,
  };
}
