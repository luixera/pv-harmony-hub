import { useNavigate } from 'react-router-dom';
import type { PortalAccount, TipoRun } from '@/hooks/useLudmilla';
import type { AgentConfigSafe } from '@/hooks/useAgentConfig';
import { CartaoDaConta } from './CartaoDaConta';

/**
 * Aba Concessionárias (spec §3.3): tudo o que antes empurrava as decisões para baixo — um cartão
 * por conta, com "Verificar agora", as regras de e-mail, os contadores e "O que ela leu na caixa".
 * A caixa do agente de e-mails é por tenant, e o "Verificar agora" é o MESMO da faixa de saúde:
 * a página consulta e pede uma vez só e passa para todos os cartões.
 */
export function AbaConcessionarias({ contas, nomeDaConta, caixa, caixaPronta, caixaFalhou, agora, verificando, onVerificar }: {
  contas: PortalAccount[];
  nomeDaConta: (id: string) => string;
  caixa: AgentConfigSafe | null | undefined;
  /** true = configurada · false = não configurada · null = sem resposta (carregando ou falhou) */
  caixaPronta: boolean | null;
  /** a consulta da caixa falhou sem resposta anterior (com `caixaPronta` null) */
  caixaFalhou: boolean;
  agora: number;
  verificando: boolean;
  onVerificar: (accountId: string, tipo: TipoRun) => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {contas.length === 0 && (
        <div className="rounded-xl border p-4 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
          Nenhum portal configurado. Em Concessionárias, use o ícone de chave para cadastrar o acesso.
        </div>
      )}
      {contas.map(c => (
        <CartaoDaConta
          key={c.id} conta={c} nome={nomeDaConta(c.id)} caixa={caixa} caixaPronta={caixaPronta} caixaFalhou={caixaFalhou} agora={agora}
          verificando={verificando} onVerificar={tipo => onVerificar(c.id, tipo)}
          onAcessoAoPortal={() => navigate('/admin/energy-concessionaires')}
        />
      ))}
    </div>
  );
}
