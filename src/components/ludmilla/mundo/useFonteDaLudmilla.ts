import { useEffect } from 'react';

const ENDERECO = 'https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700;800&display=swap';

/**
 * Carrega a Public Sans só quando a página da Ludmilla abre (spec §3): o resto do GD continua no
 * Inter, e quem nunca abre a Ludmilla não baixa a fonte. Uma vez por documento. O CSP (só relatório)
 * já libera fonts.googleapis.com e fonts.gstatic.com (workflow nginx-cache-headers.yml).
 */
export function useFonteDaLudmilla(): void {
  useEffect(() => {
    if (document.head.querySelector('link[data-fonte-da-ludmilla]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ENDERECO;
    link.dataset.fonteDaLudmilla = '';
    document.head.appendChild(link);
  }, []);
}
