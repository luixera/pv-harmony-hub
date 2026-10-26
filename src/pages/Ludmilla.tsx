import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Radar } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  estadoDaEstacao, useLudmillaDisponivel, usePedirRun, usePortalCaptchas, useRunsCriacaoCpfl,
} from '@/hooks/useLudmilla';
import { useAgentConfig } from '@/hooks/useAgentConfig';
import { useCaixaDaLudmilla } from '@/hooks/useCaixaDaLudmilla';
import { useFilaDeDecisoes } from '@/hooks/useFilaDeDecisoes';
import { useAgora } from '@/hooks/useAgora';
import { useWindowSize } from '@/hooks/useWindowSize';
import { FILTRO_INICIAL, contarPendentes, type FiltroDaCaixa } from '@/lib/ludmillaCaixa';
import { alertasDasContas, chipsDaFaixa } from '@/lib/ludmillaPainel';
import { AbaDecidirConectada } from '@/components/ludmilla/decidir/AbaDecidirConectada';
import { AlertasDasContas } from '@/components/ludmilla/topo/AlertasDasContas';
import { FaixaDeSaude } from '@/components/ludmilla/topo/FaixaDeSaude';
import { BarraDeAbas } from '@/components/ludmilla/topo/BarraDeAbas';
import { ABAS_DA_LUDMILLA, type AbaDaLudmilla } from '@/components/ludmilla/topo/abas';
import { CartaoCaptcha } from '@/components/ludmilla/abas/CartaoCaptcha';
import { AbaConcessionarias } from '@/components/ludmilla/abas/AbaConcessionarias';
import { AbaCriacoesCpfl } from '@/components/ludmilla/abas/CriacoesCpfl';
import { RegistroDaLudmilla } from '@/components/ludmilla/abas/RegistroDaLudmilla';

/**
 * LUDMILLA — a caixa de entrada de decisões (spec 2026-10-22).
 *
 * O que a equipe vem fazer aqui é DECIDIR: a aba de abertura é a lista de
 * recomendações + A fazer, com o detalhe ao lado (computador) ou por cima
 * (celular). Configuração e histórico foram para abas secundárias. A Ludmilla
 * só sugere: quem aplica é uma pessoa, pelas MESMAS RPCs de sempre — a decisão
 * espera 8 s antes de ir, e é isso que faz o "Desfazer".
 *
 * O topo vale para todas as abas: o código da imagem da Elektro (expira em 5 min)
 * acima de tudo, os alertas das contas e a faixa de saúde. No celular a barra das
 * abas vem ANTES disso, logo abaixo da barra do app, e gruda ali ao rolar
 * (decisão do usuário, 22/10/2026: embaixo já há a barra de atalhos). Para grudar,
 * ela precisa ser filha direta do contêiner da página — aqui, o `<Tabs>`.
 *
 * Há DOIS meios de acompanhamento, e cada cartão diz qual é o seu
 * (`portal_accounts.acompanhamento`): `portal`, em que ela entra no site da
 * concessionária, e `email`, em que ela lê a caixa e interpreta as mensagens
 * (EDP, ENEL).
 */
export default function Ludmilla() {
  const disponivel = useLudmillaDisponivel();
  const navigate = useNavigate();
  const [aba, setAba] = useState<AbaDaLudmilla>('decidir');
  const [contaId, setContaId] = useState<string | null>(null);
  // mora aqui, não na aba: o conteúdo da aba desmonta ao trocar e a busca sumia na volta
  const [filtro, setFiltro] = useState<FiltroDaCaixa>(FILTRO_INICIAL);
  const caixa = useCaixaDaLudmilla('pendente');
  const { ocultos, decidir } = useFilaDeDecisoes(caixa.itens);
  const { data: captchas = [] } = usePortalCaptchas();
  // a caixa do agente de e-mails é por tenant: uma consulta serve para o topo e para todos os
  // cartões. Enquanto carrega, null — false acenderia o alerta "caixa não configurada" em toda abertura.
  // Consulta que falhou também é null: não prova que a caixa falta.
  const { data: agente, isLoading: carregandoAgente, isError: erroDoAgente } = useAgentConfig();
  const caixaPronta = carregandoAgente || erroDoAgente ? null : !!agente?.is_configured && !!agente.gmail_email;
  const { data: runsCriacao = [] } = useRunsCriacaoCpfl();
  const pedir = usePedirRun();
  const agora = useAgora(60_000);
  const { isMobile } = useWindowSize();

  if (!disponivel) {
    return (
      <MainLayout>
        <div className="p-8 text-sm text-muted-foreground">A Ludmilla está disponível só para a equipe do GD Manager.</div>
      </MainLayout>
    );
  }

  const estacaoDe = (c: Parameters<typeof estadoDaEstacao>[0]) => estadoDaEstacao(c, agora);
  const pendentes = contarPendentes(caixa.itens, ocultos);
  const chips = chipsDaFaixa(caixa.contas, {
    nomeDaConta: caixa.nomeDaConta, pendentesPorConta: pendentes.porConta, estacaoDe, caixaPronta, agora,
  });
  const alertas = alertasDasContas(caixa.contas, caixa.nomeDaConta, caixaPronta, estacaoDe);

  return (
    <MainLayout>
      {/* space-y-3 e a frase de uma linha: em 1280 × 800, com um alerta e a faixa em duas linhas, os
          botões do detalhe ainda cabem na tela sem rolar (altura.ts) */}
      <Tabs value={aba} onValueChange={v => setAba(v as AbaDaLudmilla)} className="mx-auto max-w-7xl space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Radar className="w-6 h-6 text-primary" /></div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">Ludmilla</h1>
            {/* no celular a frase empurraria a barra das abas para baixo */}
            <p className="hidden text-sm text-muted-foreground sm:block">
              O que mudou nas concessionárias, com a recomendação de etapa. Ela lê; você decide.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate('/admin/energy-concessionaires')}>
            <KeyRound size={14} /> Acessos aos portais
          </Button>
        </div>

        {isMobile && <BarraDeAbas ativa={aba} onTrocar={setAba} contadores={{ decidir: pendentes.total }} />}

        {/* Urgente primeiro, em qualquer aba: o código da imagem expira em 5 min */}
        {captchas.map(c => <CartaoCaptcha key={c.id} c={c} portal={caixa.nomeDaConta(c.account_id)} />)}
        <AlertasDasContas alertas={alertas} />

        <FaixaDeSaude
          chips={chips} contaId={contaId} verificando={pedir.isPending}
          onFiltrar={id => { setContaId(id); setAba('decidir'); }}
          onVerificar={c => pedir.mutate({ accountId: c.id, tipo: c.tipoDoRun })}
        />

        {!isMobile && (
          <TabsList className="h-auto flex-wrap">
            {ABAS_DA_LUDMILLA.map(a => (
              <TabsTrigger key={a.valor} value={a.valor} className="gap-1.5">
                {a.rotulo}
                {a.valor === 'decidir' && pendentes.total > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[11px] tabular-nums text-primary-foreground">
                    {pendentes.total}<span className="sr-only"> pendentes</span>
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        )}

        <TabsContent value="decidir" className="mt-0">
          <AbaDecidirConectada
            filtro={filtro} onFiltro={setFiltro} contaId={contaId} ocultos={ocultos} decidir={decidir} agora={agora}
          />
        </TabsContent>
        <TabsContent value="concessionarias" className="mt-0">
          <AbaConcessionarias
            contas={caixa.contas} nomeDaConta={caixa.nomeDaConta} caixa={agente} caixaPronta={caixaPronta} agora={agora}
            verificando={pedir.isPending} onVerificar={(accountId, tipo) => pedir.mutate({ accountId, tipo })}
          />
        </TabsContent>
        <TabsContent value="criacoes" className="mt-0">
          <AbaCriacoesCpfl runs={runsCriacao} />
        </TabsContent>
        <TabsContent value="registro" className="mt-0">
          <RegistroDaLudmilla />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
}
