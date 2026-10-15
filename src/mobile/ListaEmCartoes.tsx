import type React from 'react';
import { useWindowSize } from '@/hooks/useWindowSize';
import { resumoDeCartao, type CampoDeCartao } from '@/mobile/resumoDeCartao';

export interface ItemDeCartao {
  id: string;
  titulo: string;
  selo?: { texto: string; cor: string };
  campos: CampoDeCartao[];
  aoAbrir?: () => void;
}

/**
 * No celular, lista vira CARTÃO; de 640 px para cima, a tela mostra o que já
 * mostrava (`children`). Tabela de 10 colunas em 390 px ou rola de lado ou
 * corta — foi o que o usuário viu no extrato financeiro.
 */
export function ListaEmCartoes({
  itens, vazio = 'Nada por aqui.', children,
}: { itens: ItemDeCartao[]; vazio?: string; children?: React.ReactNode }) {
  const { isMobile } = useWindowSize();
  if (!isMobile) return <>{children}</>;

  if (itens.length === 0) {
    return <p style={{ fontSize: 13, color: '#666', padding: '16px 4px', margin: 0 }}>{vazio}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {itens.map(item => {
        // Conteúdo idêntico nos dois casos. Usa span (não div/p) porque conteúdo de button tem de ser de frase.
        const conteudo = (
          <>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A' }}>{item.titulo}</span>
              {item.selo && (
                <span style={{ fontSize: 11, fontWeight: 600, color: item.selo.cor, border: `1px solid ${item.selo.cor}33`, borderRadius: 8, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                  {item.selo.texto}
                </span>
              )}
            </span>
            {resumoDeCartao(item.campos).map((c, i) => (
              <span key={i} style={{ display: 'block', fontSize: 12, color: '#1A1A1A', margin: '2px 0 0' }}>
                <span style={{ color: '#666' }}>{c.rotulo}: </span>{c.valor}
              </span>
            ))}
          </>
        );
        const estilo: React.CSSProperties = {
          textAlign: 'left', minHeight: 44, width: '100%',
          background: '#fff', border: '0.5px solid #E6E6E6', borderRadius: 12, padding: '12px 14px',
        };
        // Com ação, é botão (focável, Enter funciona). Sem ação, é só bloco visual, sem foco nem papel de botão.
        return item.aoAbrir ? (
          <button
            key={item.id}
            onClick={item.aoAbrir}
            // evita enviar o formulário pai ao tocar no cartão (o padrão do button é submit)
            type="button"
            style={{ ...estilo, cursor: 'pointer' }}
          >
            {conteudo}
          </button>
        ) : (
          <div key={item.id} style={estilo}>
            {conteudo}
          </div>
        );
      })}
    </div>
  );
}
