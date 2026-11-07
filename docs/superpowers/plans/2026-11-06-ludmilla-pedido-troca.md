# Ludmilla — pedido da troca do relógio: plano de implementação

**Goal:** no A fazer de vistoria aprovada, mostrar o e-mail pronto e enviar o pedido à ENEL com o clique de uma pessoa.

**Architecture:** tabela e RPCs próprias no banco; o robô reaproveita `enviar.ts` trocando as dependências; a tela
reaproveita o editor e a fila do Desfazer da cobrança.

**Tech Stack:** Postgres/RLS, Node 22 + `node:test` (robô), React + vitest (tela).

**Spec:** [2026-11-06-ludmilla-pedido-troca-design.md](../specs/2026-11-06-ludmilla-pedido-troca-design.md)

## Restrições globais

- Nada sai para a ENEL durante o desenvolvimento: SQL de prova só em `begin; … rollback;`, robô só com dublês.
- Nenhuma função da cobrança é alterada. Prova: md5 de `ludmilla_cobranca_*` antes e depois da migração.
- Banco: `supabase db query --linked --yes -f`, nunca `db push`. Commit com caminhos explícitos.
- Log e banco: só razão curta. Nunca texto, titular, nota, caixa ou senha.

## Task 1: Banco

**Files:** Create `supabase/migrations/20261106200000_ludmilla_pedido_troca.sql`, prova em SQL no rascunho da sessão.

**Produces:**
- `portal_pedidos_troca`; run `enviar_pedido_troca`; cron `ludmilla-pedidos-troca`.
- Equipe: `ludmilla_pedido_troca_rascunho(p_afazer_id uuid)` → `liberado, motivo, para, assunto, nt, titular, aprovacao_em, ja_pedido_em, pedido_situacao, pedido_erro, pedido_texto`; `ludmilla_pedido_troca_enviar(p_afazer_id uuid, p_texto text)` → uuid do run.
- Robô (`service_role`): `ludmilla_pedido_troca_iniciar_envio(p_run_id)`, `_enviado(p_run_id, p_message_id)`, `_falhou(p_run_id, p_erro)`, `_sem_confirmacao(p_run_id, p_erro)`.

**Prova, em `begin; … rollback;` com impersonação, antes de aplicar:**
1. PRJ-27803 libera; PRJ-60934 e PRJ-67567 dizem que a ENEL já respondeu; PRJ-90184 diz que o projeto foi concluído.
2. Enviar como pessoa cria pedido e run e fecha o A fazer; o 2º clique é recusado.
3. Recusados: agente Ludmilla, texto sem a NT, texto com lacuna, A fazer de outro tipo.
4. Iniciar → enviado grava comentário e histórico, e repetir não duplica.
5. Falhou reabre o A fazer e libera de novo; sem confirmação abre `aviso` e não libera.
6. `authenticated` não escreve na tabela; `anon` não executa as RPCs.

## Task 2: Robô

**Files:** Create `worker/ludmilla/src/email/enel/pedido-troca.ts`, `worker/ludmilla/test/enel-pedido-troca.test.ts`. Modify `email/enel/enviar.ts`, `fila.ts`, `index.ts`.

**Consumes:** as RPCs da Task 1. **Produces:** `executarEnvioDePedido(run)`; em `DepsEnvio`, `montarSaida?` e `travaExtra?`, opcionais, com a cobrança seguindo igual.

**Testes, escritos antes:**
1. O e-mail sai sem `RE:`, sem `In-Reply-To`, para o destinatário travado, com o assunto do banco.
2. A saudação vira "Boa tarde" à tarde, e texto com abertura editada não muda.
3. Assunto fora do modelo ou texto sem a NT do assunto: nada sai e o banco recebe `falhou`.
4. Queda no meio com "achou" em Enviados registra enviado; "não conferiu" vai para sem confirmação, nunca `falhou`.
5. O motivo que volta para a tela fala em pedido, não em cobrança.
6. Log sem texto, titular, caixa ou senha.
7. Toda a suíte da cobrança continua passando sem alteração.

## Task 3: Tela

**Files:** Create `src/lib/ludmillaPedidoTroca.ts`, `src/lib/ludmillaPedidoTroca.test.ts`, `src/lib/ludmillaPainel.pedido.test.ts`. Modify `src/lib/ludmillaPainel.ts`, `src/hooks/useLudmillaDecidir.ts`, `src/components/ludmilla/decidir/PainelDeDetalhe.tsx`, `DetalheConectado.tsx`.

**Consumes:** `ludmilla_pedido_troca_rascunho`, `ludmilla_pedido_troca_enviar`. **Produces:** ação `enviar_pedido`, `AcoesDaDecisao.enviarPedido(afazerId, texto)`.

**Testes, escritos antes:**
1. O modelo sai com a NT e a saudação da hora; o rascunho prefere o texto da tentativa que falhou.
2. Texto sem a NT ou com lacuna desliga o Enviar, com o motivo.
3. `acoesDoItem`: liberado dá Enviar + Marcar como feito; não liberado dá só Marcar como feito; carregando deixa o Enviar desligado; sem dados do pedido, tudo como antes.
4. `argumentosDaDecisao` leva o id do A fazer e o texto exato; `executarDecisao` chama `enviarPedido`.
5. A cobrança e os outros A fazer não mudam.

**Prova visual:** harness temporário com os estados do painel, no navegador, apagado antes do commit.

## Task 4: Verificar e publicar

1. Revisão de segurança (`security-review`) sobre a migração e as RPCs.
2. `tsc` contra o baseline de 65 erros, `npm run build`, `npm test`, suíte do robô.
3. Aplicar a migração; conferir md5 da cobrança, o cron e os grants.
4. Push; publicar o robô com `gh workflow run ludmilla-worker.yml` e conferir o site.
5. Doc do módulo, ADR 0012, roadmap, índice e memória.

O primeiro envio real é o clique do usuário no PRJ-27803. Nada aqui o faz.
