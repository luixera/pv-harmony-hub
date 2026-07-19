import React from 'react';
import { logSystemEvent } from '@/lib/systemLog';

interface Props { children: React.ReactNode }
interface State { erro: Error | null }

/**
 * Última barreira: se um componente quebrar, o usuário vê uma tela explicativa
 * em vez de página branca, e o erro chega ao painel de monitoramento.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: React.ErrorInfo) {
    void logSystemEvent('frontend_crash', erro.message, {
      stack: erro.stack?.slice(0, 2000),
      componente: info.componentStack?.slice(0, 1000),
    });
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 14,
        padding: 32, textAlign: 'center', background: '#FAFAFA',
      }}>
        <p style={{ fontSize: 18, fontWeight: 700, color: '#1A1A1A' }}>
          Algo deu errado nesta tela
        </p>
        <p style={{ fontSize: 13, color: '#777', maxWidth: 420, lineHeight: 1.6 }}>
          O erro já foi registrado para a equipe. Você pode recarregar a página e
          tentar de novo — seus dados não foram perdidos.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 4, padding: '9px 20px', borderRadius: 8, border: 'none',
            background: '#F5A800', color: '#1A1A1A', fontWeight: 700,
            fontSize: 13, cursor: 'pointer',
          }}
        >
          Recarregar
        </button>
      </div>
    );
  }
}
