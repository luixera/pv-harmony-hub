import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useAgentConfig } from '@/hooks/useAgentConfig';
import { useAgora } from '@/hooks/useAgora';
import { useCaixaDaLudmilla } from '@/hooks/useCaixaDaLudmilla';
import { useFilaDeDecisoes } from '@/hooks/useFilaDeDecisoes';
import {
  estadoDaEstacao, useLudmillaDisponivel, usePedirRun, usePortalCaptchas, useRegistroLudmilla, useRunsCriacaoCpfl,
  type PortalAccount,
} from '@/hooks/useLudmilla';
import { useAcoesDaCaixa } from '@/hooks/useLudmillaDecidir';
import { useCarteiraDaLudmilla, useDesdeDoRecado, useLeiturasDesde, useNormaisDaLudmilla } from '@/hooks/useLudmillaPagina';
import { useStatusLabel, useStatusOrder } from '@/hooks/useStatusLabel';
import { useWindowSize } from '@/hooks/useWindowSize';
import { mensagemDeErro } from '@/lib/ludmillaCartao';
import { donosPorProjetoDe, fraseDasNaoAcompanhadas, naoAcompanhadas, proximoPasso } from '@/lib/ludmillaCarteira';
import { resumoDaFila } from '@/lib/ludmillaFila';
import { fraseDaProximaLeitura, leiturasDasContas, linhasDeLeitura, proximaLeitura, textoDaListaVazia } from '@/lib/ludmillaLeituras';
import { alertasDasContas } from '@/lib/ludmillaPainel';
import { diarioPorDia, fezSozinha, recadoDoDia, rotuloDoDesde } from '@/lib/ludmillaRecado';
import { CartaoCaptcha } from '@/components/ludmilla/abas/CartaoCaptcha';
import { DetalheConectado } from '@/components/ludmilla/decidir/DetalheConectado';
import { FichaConectada } from '@/components/ludmilla/pagina/FichaConectada';
import { OndeEuLeio } from '@/components/ludmilla/pagina/OndeEuLeio';
import { PaginaDaLudmilla } from '@/components/ludmilla/pagina/PaginaDaLudmilla';
import { modoDaPagina } from '@/components/ludmilla/pagina/modo';

/** O registro do Diário: 120 linhas; "Ver mais" leva a 400 (o teto de `ludmilla_registro` é 500). */
const DIARIO_CURTO = 120;
const DIARIO_LONGO = 400;

/**
 * LUDMILLA — a página nova (spec 2026-11-08, entrega 2): a estrutura A no mundo "Conta de luz".
 *
 * A página só liga os hooks à casca (`PaginaDaLudmilla`), que não lê banco. A Ludmilla continua só
 * sugerindo: quem decide é uma pessoa, pelas MESMAS RPCs de sempre, com o Desfazer de 8 s
 * (`useFilaDeDecisoes` + `useAcoesDaCaixa`). O que é novo vem da entrega 1 (`ludmilla_carteira`,
 * `ludmilla_normais`) e das contagens do recado. Só para a equipe do GD Manager.
 */
export default function Ludmilla() {
  const disponivel = useLudmillaDisponivel();
  if (!disponivel) {
    return (
      <MainLayout>
        <div className="p-8 text-sm text-muted-foreground">A Ludmilla está disponível só para a equipe do GD Manager.</div>
      </MainLayout>
    );
  }
  return (
    <MainLayout>
      <PaginaConectada />
    </MainLayout>
  );
}

function PaginaConectada() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const agora = useAgora(60_000);
  const { width } = useWindowSize();
  const rotulo = useStatusLabel();
  const etapas = useStatusOrder();
  const caixa = useCaixaDaLudmilla('pendente');
  const { ocultos, decidir } = useFilaDeDecisoes(caixa.itens);
  const acoes = useAcoesDaCaixa();
  const carteira = useCarteiraDaLudmilla();
  const normais = useNormaisDaLudmilla();
  const { data: captchas = [] } = usePortalCaptchas();
  // a caixa do agente de e-mails: carregando (ou falhou sem resposta anterior) é null, nunca false
  const { data: agente, isLoading: carregandoAgente, isError: erroDoAgente } = useAgentConfig();
  const semResposta = carregandoAgente || agente === undefined;
  const caixaPronta = semResposta ? null : !!agente?.is_configured && !!agente?.gmail_email;
  const caixaFalhou = semResposta && erroDoAgente;
  const { data: runsCriacao = [] } = useRunsCriacaoCpfl();
  const pedir = usePedirRun();
  const desde = useDesdeDoRecado(user?.id);
  const leiturasDesde = useLeiturasDesde(desde, caixa.contas);
  const [limiteDoDiario, setLimiteDoDiario] = useState(DIARIO_CURTO);
  const registro = useRegistroLudmilla(limiteDoDiario);
  const daLudmilla = useRegistroLudmilla(DIARIO_LONGO, 'ludmilla');

  const linhas = useMemo(() => carteira.data ?? [], [carteira.data]);
  const estacaoDe = (c: PortalAccount) => estadoDaEstacao(c, agora);
  const feitos = useMemo(() => fezSozinha(daLudmilla.data ?? [], desde), [daLudmilla.data, desde]);
  const resumo = resumoDaFila(caixa.itens, { ocultos, agora, donosPorProjeto: donosPorProjetoDe(linhas) });
  const leituras = leiturasDesde.isError
    ? null
    : leiturasDasContas(caixa.contas, caixa.nomeDaConta, leiturasDesde.data ?? { protocolos: {}, emails: {} });
  const recadoCarregando = caixa.carregando || carteira.isLoading || leiturasDesde.isLoading || daLudmilla.isLoading;
  // sem a carteira não sei o dono de nenhum item: não afirmo "N sem dono" (spec §4.6)
  const recado = recadoCarregando ? null : recadoDoDia({
    agora, desde, leituras, fizSozinha: feitos.length, separei: resumo.total, paraAgora: resumo.agora,
    semDono: carteira.isError ? 0 : resumo.semDono,
  });
  // a fila depende da carteira para saber o dono: carregando/falhou é estado da fila, nunca "Nada aqui agora"
  const erroDaFila = caixa.erro ? (mensagemDeErro(caixa.erro) ?? '')
    : carteira.isError ? 'Não consegui carregar os responsáveis de cada projeto.'
    : null;
  const proxima = fraseDaProximaLeitura(proximaLeitura(caixa.contas, caixa.nomeDaConta, agora), agora);
  const nao = fraseDasNaoAcompanhadas(naoAcompanhadas(linhas, caixa.contas.map(c => c.concessionaire_id)));
  const abrirProjeto = (id: string) => navigate(`/project/${id}`);

  return (
    <PaginaDaLudmilla
      modo={modoDaPagina(width)} agora={agora}
      usuario={user ? { id: user.id, role: user.role, name: user.name } : null}
      rotuloEtapa={rotulo} ordemDasEtapas={etapas.map(e => e.key)}
      itens={caixa.itens} ocultos={ocultos} decidir={decidir} acoes={acoes}
      fila={{
        carregando: caixa.carregando || carteira.isLoading, buscando: caixa.buscando,
        erro: erroDaFila, tentar: () => { caixa.tentarDeNovo(); void carteira.refetch(); },
      }}
      carteira={linhas} normais={normais.data ?? []}
      estadoDaCarteira={{
        carregando: carteira.isLoading, buscando: carteira.isFetching,
        erro: carteira.isError ? (mensagemDeErro(carteira.error) ?? '') : null, tentar: () => { void carteira.refetch(); },
      }}
      recado={recado} feitos={feitos} rotuloDoDesde={rotuloDoDesde(desde, agora)}
      diario={diarioPorDia(registro.data ?? [], agora)}
      estadoDoDiario={{
        carregando: registro.isLoading,
        erro: registro.isError ? (mensagemDeErro(registro.error) ?? '') : null,
        tentar: () => { void registro.refetch(); },
        podeVerMais: limiteDoDiario < DIARIO_LONGO && (registro.data?.length ?? 0) >= limiteDoDiario,
        verMais: () => setLimiteDoDiario(DIARIO_LONGO),
      }}
      leituras={linhasDeLeitura(caixa.contas, { nomeDaConta: caixa.nomeDaConta, estacaoDe, caixaPronta, captchas, agora })}
      textoDaListaVazia={textoDaListaVazia(proxima)}
      alertaUrgente={captchas.length > 0
        ? captchas.map(c => <CartaoCaptcha key={c.id} c={c} portal={caixa.nomeDaConta(c.account_id)} />)
        : null}
      detalhe={(item, layout, onDecidir, topo, historico) => (
        // a etapa do detalhe nasce da recomendação: refetch que muda a recomendação recria o detalhe
        <DetalheConectado
          key={`${item.chave}|${item.update?.recomendacao ?? ''}`} item={item} layout={layout} etapas={etapas}
          rotuloEtapa={rotulo} onDecidir={onDecidir} onAbrirProjeto={abrirProjeto} topo={topo} historico={historico}
        />
      )}
      ficha={(linha, historico, onVerNaFila) => (
        <FichaConectada
          key={linha.projectId} linha={linha} historico={historico} proximo={proximoPasso(linha, rotulo)}
          onVerNaFila={onVerNaFila} onAbrirProjeto={abrirProjeto} rotuloEtapa={rotulo}
        />
      )}
      ondeEuLeio={() => (
        <OndeEuLeio
          contas={caixa.contas} nomeDaConta={caixa.nomeDaConta} caixa={agente} caixaPronta={caixaPronta} caixaFalhou={caixaFalhou}
          agora={agora} verificando={pedir.isPending} onVerificar={(accountId, tipo) => pedir.mutate({ accountId, tipo })}
          alertas={alertasDasContas(caixa.contas, caixa.nomeDaConta, caixaPronta, estacaoDe)} naoAcompanhadas={nao}
          runsCriacao={runsCriacao}
        />
      )}
      onAbrirProjeto={abrirProjeto}
    />
  );
}
