import { useNavigate } from 'react-router-dom';
import type { AgentConfigSafe } from '@/hooks/useAgentConfig';
import type { PortalAccount, PortalRun, TipoRun } from '@/hooks/useLudmilla';
import type { AlertaUrgente } from '@/lib/ludmillaPainel';
import { CartaoDaConta } from '@/components/ludmilla/abas/CartaoDaConta';
import { AbaCriacoesCpfl } from '@/components/ludmilla/abas/CriacoesCpfl';
import { AlertasDasContas } from '@/components/ludmilla/topo/AlertasDasContas';

export interface PropsDeOndeEuLeio {
  contas: PortalAccount[];
  nomeDaConta: (id: string) => string;
  caixa: AgentConfigSafe | null | undefined;
  /** true = configurada · false = não configurada · null = sem resposta */
  caixaPronta: boolean | null;
  caixaFalhou: boolean;
  agora: number;
  verificando: boolean;
  onVerificar: (accountId: string, tipo: TipoRun) => void;
  alertas: AlertaUrgente[];
  /** "Ainda não acompanho CEMIG e Energisa." ou null */
  naoAcompanhadas: string | null;
  runsCriacao: PortalRun[];
}

/**
 * "ONDE EU LEIO" (spec §4.4, direita dos Ajustes): o que hoje está na aba Concessionárias — os
 * alertas das contas, um cartão por conta (situação, meio, última leitura, Ler agora, Acesso ao
 * portal, regras de e-mail, o que ela leu na caixa), as criações na CPFL e as concessionárias que
 * ela ainda não acompanha. Os cartões são os de hoje (`CartaoDaConta`), sem mudar o que fazem.
 */
export function OndeEuLeio(p: PropsDeOndeEuLeio) {
  const navigate = useNavigate();
  const contas = [...p.contas].sort((a, b) => p.nomeDaConta(a.id).localeCompare(p.nomeDaConta(b.id), 'pt-BR'));
  const temCpfl = p.contas.some(c => c.connector === 'cpfl');
  return (
    <div className="flex flex-col gap-3 p-4 sm:p-5" data-painel="onde-eu-leio">
      <h2 className="m-0 text-base font-extrabold">Onde eu leio</h2>
      <AlertasDasContas alertas={p.alertas} />
      {contas.length === 0 && (
        <p className="m-0 text-sm text-lm-suave">Ainda não tenho nenhuma conta. Em Concessionárias, use o ícone de chave para cadastrar o acesso.</p>
      )}
      {contas.map(c => (
        <CartaoDaConta
          key={c.id} conta={c} nome={p.nomeDaConta(c.id)} caixa={p.caixa} caixaPronta={p.caixaPronta} caixaFalhou={p.caixaFalhou}
          agora={p.agora} verificando={p.verificando} onVerificar={tipo => p.onVerificar(c.id, tipo)}
          onAcessoAoPortal={() => navigate('/admin/energy-concessionaires')}
        />
      ))}
      {temCpfl && <section className="flex flex-col gap-2 pt-2"><AbaCriacoesCpfl runs={p.runsCriacao} /></section>}
      {p.naoAcompanhadas && <p className="m-0 text-[13px] leading-normal text-lm-suave">{p.naoAcompanhadas}</p>}
    </div>
  );
}
