# Ludmilla — cobrar a ENEL sobre a troca do relógio (e ler a ENEL de hora em hora) — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

> **QUANDO COMEÇAR — outras frentes mexem nos mesmos arquivos.** Este plano foi escrito para rodar **DEPOIS** de três frentes em andamento em 24/10/2026:
> 1. a **Task 8 da página nova** da Ludmilla (`src/pages/Ludmilla.tsx`, `src/hooks/useLudmilla.ts`, `Sidebar`, e as mudanças ainda não commitadas em `src/components/ludmilla/decidir/*`, `src/lib/ludmillaPainel.ts`, `src/hooks/useLudmillaDecidir.ts`);
> 2. a leitura da pasta **"Todos os e-mails"** (`worker/ludmilla/src/email/caixa.ts` e `email/enel/run.ts`, teste `test/email-pasta.test.ts`);
> 3. o **nome de PJ abreviado + "troca realizada" → Concluído** (`email/enel/decidir.ts`, `classificar.ts`, `run.ts`).
>
> Cada tarefa começa por um passo "Conferir que a frente anterior terminou" que **para** se o arquivo ainda tem mudança não commitada de outra sessão. As Tasks 1–2 (só banco) não encostam em arquivo dessas frentes; mesmo assim, comece por elas só depois do OK do usuário.

**Objetivo:** a nota de serviço de troca do relógio que a ENEL manda vira uma cobrança agendada; 7 dias depois ela aparece na aba Decidir com o e-mail pronto e editável, e só sai quando uma pessoa clica em **Enviar** — pela mesma conta Gmail que a Ludmilla lê, como resposta na conversa da nota, só para @enel.com/@br.enel.com e no máximo 1 vez a cada 7 dias por nota. Junto, a leitura da ENEL passa a ser automática, de hora em hora, de segunda a sexta, das 8h às 18h.

**Arquitetura:** o banco ganha a tabela `portal_cobrancas` (escrita só por RPC), a trava do destinatário (`ludmilla_endereco_da_enel`, a mesma expressão do worker), um tipo novo de A fazer (`cobrar_troca`) e de run (`enviar_cobranca`), e duas funções agendadas por um `pg_cron` NOVO (`ludmilla_agendar_email`, `ludmilla_cobrancas_abrir_vencidas`) — o agendador da CPFL não muda. No worker, o run da ENEL agenda e encerra cobranças (lógica pura com teste), e o run novo `enviar_cobranca` manda o e-mail aprovado por SMTP (`nodemailer`), com as travas conferidas de novo antes de qualquer byte sair. Na tela, o A fazer da cobrança mostra Para, Assunto e Texto (editável), com **Enviar** (pela fila do Desfazer de 8 s) e **Dispensar**.

**Tecnologias:** Supabase (Postgres, RLS, PL/pgSQL, pg_cron), worker Node 22 + TypeScript (imapflow, mailparser, **nodemailer 10.0.16** — nova), React 18 + TypeScript + Vite, React Query 5, sonner, vitest (ambiente `node`), `node:test` no worker.

**Spec:** `docs/superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md` (aprovada pelo usuário em 24/10/2026, com o modelo do e-mail e a assinatura "Equipe GD Manager").

## Restrições globais

Valem para TODA tarefa, além do que ela pede.

- **"A Ludmilla prepara, uma pessoa aprova. Nada sai sem clique"** (spec §2). Nenhum caminho do worker manda e-mail sem uma cobrança `aguardando_envio` aprovada por uma pessoa da equipe, ligada ao run pelo `run_id`.
- **Destinatário travado no worker E no banco**: "o destinatário tem de ser um endereço **@enel.com** ou **@br.enel.com** (o remetente da nota)". A expressão é UMA, `^[a-z0-9][a-z0-9._%+-]*@(br\.)?enel\.com$`, sobre o endereço já normalizado (minúsculo, sem nome, um só); um teste do worker lê a migração e confere que é a mesma.
- **"No máximo 1 envio por nota a cada 7 dias"**; a 1ª cobrança vence **7 dias** depois do e-mail da nota; "sem resposta, **de novo a cada 7 dias**".
- **Leitura automática da ENEL**: função NOVA `ludmilla_agendar_email()`, cron NOVO `0 11-21 * * 1-5` (UTC = 8h–18h de Brasília, seg–sex). Enfileira `varredura_email` só para conta `acompanhamento = 'email'`, `identificacao = 'remetente'`, `enabled`, sem run aberto.
- **O agendador da CPFL NÃO muda**: `ludmilla_agendar_varreduras` com md5 do `prosrc` **`3d0d2d0f1e7455ec701230bc925e1bde`** (medido no banco vivo em 24/10/2026) antes e depois; crons `ludmilla-08h` (`0 11 * * *`) e `ludmilla-17h` (`0 20 * * *`) iguais.
- **O caminho da EDP não muda**: `worker/ludmilla/src/email/index.ts` sem diff; nenhuma função da EDP reescrita; a EDP (`protocolo_no_assunto`) não entra no agendador novo; o "Verificar agora" continua igual.
- **SMTP**: `smtp.gmail.com`, a MESMA conta e a MESMA senha de app do IMAP, lidas por `credencialDaCaixa` (RPC `ludmilla_email_credencial`, só `service_role`). A senha nunca passa pelo front nem pelo log.
- **Dependência nova**: `nodemailer` **10.0.16**, versão EXATA (sem `^`), publicada em 07/10/2026 (17 dias antes deste plano). Justificativa: montar mensagem RFC 5322 com `In-Reply-To`/`References`, assunto UTF-8 (RFC 2047), corpo quoted-printable e SMTP AUTH sobre TLS à mão é onde mora o erro; o nodemailer é o padrão do Node, licença MIT-0, **zero dependências**, tipos próprios desde a 10 (não precisa de `@types`), e é do mesmo autor do `imapflow` e do `mailparser` que o worker já usa. As versões abaixo de 7.0.7 têm o aviso GHSA-mm7p-fcc7-pg87 (e-mail para domínio errado por endereço ambíguo) — mais um motivo para o envelope SMTP explícito desta entrega.
- **Log**: "nunca leva assunto, nome, texto do e-mail nem endereço de cliente. O endereço da ENEL pode ir." O número da nota também não vai (só `com_numero: true/false`). A mensagem crua de erro do SMTP não vai para log nem banco: só a razão curta e o código (`falhaDoEnvio`).
- **Modelo do e-mail** (spec §5, aprovado): Para = o remetente do e-mail da nota; Assunto = `RE: <assunto do e-mail da nota>`; Texto:

  > Prezados, bom dia.
  >
  > Referente à nota de serviço nº **{NOTA}**, aberta em **{DATA DA NOTA}** para a troca do medidor da instalação **{UC}** — titular **{TITULAR}**, NT **{NT}**:
  >
  > poderiam, por gentileza, confirmar se a troca já foi executada? Caso tenha sido reprogramada, pedimos a gentileza de nos informar a nova data.
  >
  > Atenciosamente,
  > **{ASSINATURA}**

  "bom dia" vira "boa tarde" depois do meio-dia, na hora do envio. A partir da 2ª cobrança a primeira linha passa a ser "Prezados, retomando o e-mail abaixo: …". **{ASSINATURA} = "Equipe GD Manager"**, num lugar só (`ASSINATURA_DA_COBRANCA`, `src/lib/ludmillaCobranca.ts`).
- **A Ludmilla continua nunca pedindo vistoria nem a troca**, e nunca envia documento. Pedir a troca é a fase 2, fora daqui.
- **Só a equipe do GD Manager**: banco por `public.ludmilla_equipe_ok()`; política **RESTRICTIVE** `tenant_id = public.get_user_tenant_id((SELECT auth.uid()))`; tela por `useLudmillaDisponivel()`.
- **Testes só com dados inventados** (titulares, UCs, NTs, notas, Message-IDs `@exemplo.test`/`@enel.test`). O único endereço real é o remetente público da regra da ENEL (`canalgd.sp@br.enel.com`), que já está nos testes de hoje. Mutações nas travas, uma a uma, cada uma desfeita.
- **Verificação**: antes de mexer em TypeScript do front, medir `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` (baseline **65**; uma QUEDA grande = falha de parse, não melhoria); no fim, o mesmo número, `npm run build` sem erro e `npx vitest run` sem `failed`.
- **Worker**: testado SEMPRE em pasta própria, nunca com `npm test` (o `dist-test/` é de outras sessões): `cd worker/ludmilla && npx tsc -p tsconfig.test.json --outDir _dt-cobranca && node --test _dt-cobranca/test/*.test.js` — conferir `# fail 0` no fim. `_*` já é ignorado pelo `worker/ludmilla/.gitignore`. Apagar `_dt-cobranca/` no fim de cada tarefa.
- **Banco**: `npx -y supabase db query --linked -f arquivo.sql` (só o último SELECT com linhas volta; RPC com guarda de `service_role` devolve vazio pelo CLI — ler `prosrc`). RLS se prova com impersonação dentro de `begin; … rollback;`. Função reescrita parte SEMPRE do `prosrc` VIVO, com o md5 conferido. PL/pgSQL só falha ao rodar: toda função nova é EXECUTADA na prova.
- **Prova na tela**: harness com dublês e dados inventados, nunca senha nem sessão de verdade; apagado ANTES do commit e NUNCA commitado (`git status --short` não pode listar `harness-cobranca*`).
- **Commits**: `git add <caminhos>` + `git commit -F "$RASCUNHO/msg-tN.txt" -- <caminhos>`; a mensagem vai num arquivo escrito com a ferramenta Write (o heredoc do bash desta máquina come a linha em branco), com linha em branco depois do título e o trailer `Co-Authored-By:` do modelo que executa. Conferir com `git show --stat HEAD`. **Não mexer no `stash@{0}`** (é de outra sessão). **Push** é do usuário (Task 10).
- **`$RASCUNHO`** = o diretório de rascunho (scratchpad) da SUA sessão, fora do repositório. Comandos rodam da raiz do repositório, salvo quando o passo diz `cd worker/ludmilla`.
- **Celular**: `useWindowSize()` (`isMobile` < 640 px, `isDesktop` ≥ 1024 px). Abaixo de 767 px todo botão tem `min-height: 48px` (`src/index.css`): nunca pôr `minHeight` menor inline. Nada de `position: sticky`. Campo de texto com fonte de 16 px no celular (o iOS dá zoom em fonte menor).

## Decisões tomadas além da spec

1. **Estado `enviando`** entre `aguardando_envio` e a volta para `agendada`: o robô "pega" a cobrança numa transação (`ludmilla_cobranca_iniciar_envio`) antes de abrir o SMTP — no máximo um envio por aprovação. Não há `enviada` persistente: enviada, a linha volta direto a `agendada` com `vence_em = agora + 7 dias`, como a spec manda; o envio aparece em `enviadas` e `ultima_enviada_em`.
2. **Uma aprovação = uma tentativa.** Falhou, a aprovação é limpa, o erro fica na linha e abre um A fazer novo "A cobrança da nota N não saiu"; o texto aprovado fica como rascunho para a próxima tentativa. Envio que começou e não confirmou em 30 min volta para a equipe com "confira a pasta Enviados do Gmail antes de enviar de novo" — **nunca reenvia sozinho**.
3. **Colunas além da lista da spec**: `data_nota`, `prazo_dias`, `texto_aprovado`, `aprovada_em`, `ultimo_texto_enviado`, `run_id`, `motivo_encerramento`, `encerrada_por`, `criado_em`, `atualizado_em`. **`referencias`** no lugar de `references` (palavra reservada do SQL).
4. **Reprogramação** = e-mail de troca "não executada" que traz o número da nota (o "Reenviamos a nota de serviço …"): reabre o prazo de 7 dias **da mesma nota**. Falha sem número não mexe na cobrança (o sino da falha já existe). Nota NOVA (com número) do mesmo projeto encerra a anterior ("substituída pela nota N"). E-mail mais velho que a nota em andamento é ignorado (`mais_antiga`).
5. **O A fazer da cobrança é uma linha de `portal_afazeres`** (`tipo = 'cobrar_troca'`, coluna nova `cobranca_id`, no máximo UM aberto por cobrança), aberta por `ludmilla_cobrancas_abrir_vencidas` num cron próprio às `:05` do mesmo horário da leitura. Assim o contador da barra lateral e a lista já contam sem mexer neles. Esse A fazer **não tem "Marcar como feito"**: só Enviar e Dispensar. Se alguém o fechar pela RPC genérica, o cron o reabre enquanto a cobrança esperar decisão.
6. **O texto é montado na tela** (função pura com teste); a 2ª cobrança em diante **cita a anterior embaixo**, para o "retomando o e-mail abaixo" ser verdade. O robô só troca "bom dia"/"boa tarde" da primeira linha na hora do envio, e só se a pessoa não mexeu nela. Dado que falta vira `[NÚMERO DA NOTA]`, `[UC]`, `[TITULAR]` ou `[NT]` no texto e **trava o Enviar** (tela E banco).
7. **"Enviar" passa pela fila do Desfazer** (8 s, a mesma da página nova): o aviso diz "PRJ-x: cobrança da nota N vai para canalgd.sp@br.enel.com" e só depois chama `ludmilla_cobranca_aprovar`.
8. **Só a aprovação cria o run `enviar_cobranca`.** Um run do mesmo tipo criado por `ludmilla_pedir_run` é recusado pelo robô: o `run_id` da cobrança não bate.
9. **O run `enviar_cobranca` fecha pelas RPCs da cobrança**, não por `ludmilla_finalizar_run`: erro de envio não suja a saúde da conta da ENEL. `ludmilla_registro` ganha o rótulo "Cobrança à ENEL … (troca do relógio)" (duas linhas, a partir do `prosrc` vivo); nada mais dele muda.
10. **SMTP na 465 (TLS), com recaída na 587 (STARTTLS) só quando a falha é na CONEXÃO** (`command = 'CONN'`: nada foi transmitido). O envelope SMTP é explícito (`envelope.to = [o endereço travado]`), sem Cc/Bcc, só texto, sem acesso a arquivo ou URL.
11. **Teste de SMTP na VPS pelo workflow** `ludmilla-worker.yml` (entrada de lista fechada `smtp`): `verificar` conecta e autentica sem mandar nada; `enviar_para_a_propria_caixa` manda um e-mail de teste com **de = para = a caixa da Ludmilla** (não aceita outro endereço). A chave SSH só existe nos segredos do GitHub.
12. **Os dois crons entram SÓ na Task 10**, depois de o robô e a tela estarem no ar: antes disso o A fazer apareceria numa tela que não sabe enviar, e a leitura de hora em hora concluiria e-mails de nota sem agendar cobrança.
13. **Notas já lidas** (5 e-mails de "troca agendada" da ENEL no banco em 24/10/2026) não viram cobrança sozinhas: a Task 10 oferece "ler de novo" esses e-mails, só com o OK do usuário.
14. **Comentário no card e histórico** quando a cobrança sai: comentário assinado pela Ludmilla (`00000000-10d1-4000-8000-000000000002`); histórico com a pessoa que aprovou como autora (a regra da casa: "Aplicar = pessoa autora, Ludmilla origem").

## Respostas do usuário às dúvidas do plano (25/10/2026) — VALEM MAIS que o plano

1. **Notas já lidas: só daqui para frente.** Os 5 e-mails de nota já lidos NÃO viram cobrança, nem por "ler de novo". A Task 10 tira essa oferta.
2. **O comentário "cobrança enviada à ENEL" é VISÍVEL para a empresa integradora** (comentário comum do card, não interno). O histórico do projeto segue como está.
3. **Antes da 1ª cobrança real, um teste para a própria caixa** (o `enviar_para_a_propria_caixa` da Task 6) — só depois, com o usuário, a primeira para a ENEL.
4. **Se a HostGator bloquear o SMTP de saída: mandar pela API do Gmail** (não pedir liberação de porta). O plano segue com SMTP; a Task 6 (teste na VPS) decide: se `verificar` não conectar nem na 465 nem na 587, PARAR e abrir uma tarefa nova de envio pela Gmail API (`users.messages.send` com `threadId`, credencial OAuth do Google com escopo `gmail.send`, guardada no Vault — nunca no chat), em vez de insistir no SMTP.

## Mapa de arquivos

| Arquivo | Tarefa | Responsabilidade |
|---|---|---|
| `supabase/migrations/20261024150000_ludmilla_cobranca_troca.sql` | 1 | trava do destinatário, `portal_cobrancas` + RLS, A fazer `cobrar_troca`, run `enviar_cobranca`, RPCs do robô e da equipe, `ludmilla_cobrancas_abrir_vencidas`, rótulo no `ludmilla_registro` |
| `supabase/migrations/20261024160000_ludmilla_enel_agendada.sql` | 2 | `ludmilla_agendar_email()` (sem cron) |
| `supabase/migrations/20261024170000_ludmilla_enel_cron.sql` | 2 (escreve), 10 (aplica) | os dois crons novos |
| `worker/ludmilla/src/email/enel/classificar.ts` | 3 | exporta `textoNovo` (a parte nova do corpo, decodificada) |
| `worker/ludmilla/src/email/enel/cobranca.ts` (+ `test/enel-cobranca.test.ts`) | 3 | nota de serviço, endereço, travas, assunto, cabeçalhos, vencimento, saudação, `cobrancaDaMensagem`, `podeEnviar` |
| `worker/ludmilla/src/email/caixa.ts` | 4 | `MensagemLida.referencias` (cabeçalho `References`) |
| `worker/ludmilla/src/fila.ts` | 4, 5, 6 | `Run.tipo` + RPCs das cobranças + `contaDaEnel` |
| `worker/ludmilla/src/email/enel/run.ts` (+ `test/enel-cobranca-run.test.ts`) | 4 | o run da ENEL agenda e encerra cobranças |
| `worker/ludmilla/src/email/smtp.ts` (+ `test/enel-envio.test.ts`) | 5 | transporte, opções do envio, recaída de porta, razão da falha |
| `worker/ludmilla/src/email/enel/enviar.ts` | 5 | o run `enviar_cobranca` |
| `worker/ludmilla/src/index.ts` | 5 | desvia `enviar_cobranca` antes do Playwright |
| `worker/ludmilla/package.json`, `package-lock.json` | 5 | `nodemailer` 10.0.16 |
| `worker/ludmilla/src/email/enel/teste-smtp.ts` (+ `test/enel-teste-smtp.test.ts`) | 6 | CLI `--verificar` / `--enviar-para-a-propria-caixa` |
| `worker/ludmilla/deploy/instalar.sh`, `.github/workflows/ludmilla-worker.yml` | 6 | comando `ludmilla-teste-smtp` na VPS e a entrada `smtp` do workflow |
| `src/lib/ludmillaCobranca.ts` (+ `.test.ts`, `.fixtures.ts`) | 7 | o e-mail da cobrança, saudação, lacunas, resumo |
| `src/lib/ludmillaCaixa.ts`, `src/lib/ludmillaPainel.ts` (+ `ludmillaPainel.cobranca.test.ts`) | 7 | tipo `cobrar_troca`, selo, ações Enviar/Dispensar, textos, situação decidida |
| `src/hooks/useLudmillaDecidir.ts` (+ `useLudmillaDecidir.cobranca.test.ts`) | 8 | embed da cobrança no A fazer; Enviar e Dispensar |
| `src/components/ludmilla/decidir/{AbaDecidir,PainelDeDetalhe,DetalheConectado}.tsx` | 8 | seção "O e-mail que vai para a ENEL" e os botões |
| `docs/modules/integrations/ludmilla.md`, `docs/adr/0012-ludmilla-envia-com-clique.md`, `docs/adr/README.md`, `docs/project/{integrations,security}.md`, `CLAUDE.md` | 9 | documentação |

---

### Task 1: Banco — as cobranças, a trava do destinatário e o A fazer da cobrança

**Files:**
- Create: `supabase/migrations/20261024150000_ludmilla_cobranca_troca.sql`
- Test: `$RASCUNHO/prova_cobranca.sql`, `$RASCUNHO/prova_mutacao_trava.sql`, `$RASCUNHO/antes_cobranca.sql`, `$RASCUNHO/registro_antigo.sql` (fora do repositório; não commitar)

**Interfaces:**
- Consumes: `public.ludmilla_equipe_ok()`, `public.get_user_tenant_id(uuid)`, tabelas `portal_accounts`, `portal_email_mensagens`, `portal_afazeres`, `portal_sync_runs`, `projects`, `profiles`, `comments`, `project_history`.
- Produces:
  - `public.ludmilla_endereco_da_enel(p_endereco text) RETURNS boolean` (IMMUTABLE).
  - tabela `public.portal_cobrancas (id, tenant_id, account_id, project_id, nota_servico text null ^\d{12}$, mensagem_id uuid null → portal_email_mensagens, data_nota timestamptz, prazo_dias int null, para text, assunto text, in_reply_to text null, referencias text null, vence_em timestamptz, situacao text ∈ agendada|aguardando_envio|enviando|encerrada|dispensada, enviadas int, ultima_enviada_em, ultimo_texto_enviado, aprovada_por uuid null, aprovada_em, texto_aprovado, run_id uuid null, erro, encerrada_por, motivo_encerramento, criado_em, atualizado_em)`; únicas `(account_id, nota_servico)` e `(mensagem_id)`.
  - `portal_afazeres.cobranca_id uuid null → portal_cobrancas ON DELETE CASCADE`; `tipo` aceita `'cobrar_troca'`; índice único parcial "um A fazer aberto por cobrança".
  - `portal_sync_runs.tipo` aceita `'enviar_cobranca'`.
  - Robô (só `service_role`): `ludmilla_cobranca_agendar(p_account_id uuid, p_message_id text, p_project_id uuid, p_nota text, p_data_nota timestamptz, p_prazo_dias integer, p_para text, p_assunto text, p_in_reply_to text, p_referencias text) RETURNS text` ∈ `criada|atualizada|mantida|mais_antiga|projeto_inativo|para_recusado|conta_recusada|mensagem_inexistente`; `ludmilla_cobranca_encerrar_por_troca(p_account_id uuid, p_project_id uuid, p_quando timestamptz) RETURNS integer`; `ludmilla_cobranca_iniciar_envio(p_run_id uuid) RETURNS TABLE (recusa text, cobranca_id uuid, situacao_anterior text, aprovada_por uuid, ultima_enviada_em timestamptz, para text, assunto text, texto text, in_reply_to text, referencias text, nota_servico text)` (sempre UMA linha; `recusa` nula = pode enviar, e a cobrança já está `enviando`); `ludmilla_cobranca_enviada(p_run_id uuid, p_message_id text) RETURNS void`; `ludmilla_cobranca_falhou(p_run_id uuid, p_erro text) RETURNS void`.
  - Equipe (`authenticated` + `ludmilla_equipe_ok()`): `ludmilla_cobranca_aprovar(p_cobranca_id uuid, p_texto text) RETURNS uuid` (o id do run); `ludmilla_cobranca_dispensar(p_cobranca_id uuid) RETURNS boolean` (`false` = já estava decidida).
  - Agendamento (só `postgres`, pelo cron da Task 10): `ludmilla_cobrancas_abrir_vencidas() RETURNS integer` (quantos A fazer abriu).
  - `ludmilla_registro`: mesma assinatura e retorno; o run `enviar_cobranca` sai como "Cobrança à <concessionária> (troca do relógio)", com "nota N para <endereço>" no detalhe.

- [ ] **Step 1: Conferir o estado de antes e o corpo vivo do Registro**

Escreva `$RASCUNHO/antes_cobranca.sql`:

```sql
select json_build_object(
  'md5_cpfl', (select md5(prosrc) from pg_proc where proname = 'ludmilla_agendar_varreduras'),
  'md5_registro', (select md5(prosrc) from pg_proc where proname = 'ludmilla_registro'),
  'tipo_afazer', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'portal_afazeres_tipo_check'),
  'tipo_run', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'portal_sync_runs_tipo_check'),
  'tabela_ja_existe', to_regclass('public.portal_cobrancas') is not null
) as antes;
```

Run: `npx -y supabase db query --linked -f "$RASCUNHO/antes_cobranca.sql"`
Expected: `md5_cpfl = 3d0d2d0f1e7455ec701230bc925e1bde`, `md5_registro = ff561bfc0a7abff9803c2b7ca2893f0c`, `tipo_afazer` com as 4 de hoje (`vistoria_aprovada, troca_falhou, devolucao, aviso`), `tipo_run` com as 6 de hoje (`…, criar_projeto, varredura_email`), `tabela_ja_existe = false`. Se o `md5_registro` for OUTRO, alguém mudou `ludmilla_registro` depois de 05/10: pare e copie o corpo vivo (`select pg_get_functiondef('public.ludmilla_registro(integer,text)'::regprocedure)`) para a seção 6 do Step 4, acrescentando nele só as duas linhas `-- NOVO`. Se `tipo_afazer` ou `tipo_run` tiverem valores a mais, inclua-os nas listas do Step 4. Confira também que `ls supabase/migrations | sort | tail -1` é anterior a `20261024150000`; se não for, use o timestamp de agora no nome do arquivo (e nos Steps seguintes), com o mesmo sufixo.

- [ ] **Step 2: Provar que o corpo da migração de 05/10 é o corpo vivo**

```bash
{ echo 'begin;'; sed -n '78,221p' supabase/migrations/20261005130000_ludmilla_email_run.sql; \
  echo "select md5(prosrc) as md5_do_arquivo from pg_proc where proname = 'ludmilla_registro';"; echo 'rollback;'; } \
  > "$RASCUNHO/registro_antigo.sql"
npx -y supabase db query --linked -f "$RASCUNHO/registro_antigo.sql"
```

Expected: `md5_do_arquivo = ff561bfc0a7abff9803c2b7ca2893f0c` (o bloco das linhas 78–221 recriado numa transação desfeita dá o mesmo corpo que está no ar). Se der outro md5, a seção 6 do Step 4 tem de partir do `pg_get_functiondef` vivo, não do arquivo.

- [ ] **Step 3: Escrever a prova (o teste) e rodar vermelho**

Escreva `$RASCUNHO/prova_cobranca.sql`:

```sql
-- PROVA da migração 20261024150000_ludmilla_cobranca_troca — tudo numa transação DESFEITA no fim.
-- Esperado: a tabela final (passo, ok, detalhe) com TODAS as linhas ok = true.
-- Dados inventados: Message-IDs @exemplo.test, notas 400000000123/456/789/999, textos "PROVA".
begin;

do $$ begin
  if to_regclass('public.portal_cobrancas') is null then
    raise exception 'VERMELHO: a tabela portal_cobrancas ainda não existe';
  end if;
end $$;

create temp table _prova (em timestamptz default clock_timestamp(), passo text, ok boolean, detalhe text);
grant insert, select on _prova to authenticated, anon;

create temp table _ctx as
select a.id as conta, a.tenant_id as tenant,
  (select x.id from public.portal_accounts x where x.connector = 'cpfl' limit 1) as conta_cpfl,
  (select p.id from public.profiles p where p.tenant_id = a.tenant_id and p.role = 'staff' and p.active order by p.id limit 1) as staff_gd,
  (select p.id from public.profiles p where p.tenant_id = a.tenant_id and p.role = 'company' and p.active order by p.id limit 1) as empresa_gd,
  (select p.id from public.profiles p join public.tenants t on t.id = p.tenant_id
    where not t.is_library and p.role in ('admin', 'staff') and p.active order by p.id limit 1) as de_fora,
  (select pr.id from public.projects pr
    where pr.tenant_id = a.tenant_id and pr.concessionaire_id = a.concessionaire_id
      and not pr.is_deleted and pr.archived_at is null and pr.status::text <> 'completed'
    order by pr.created_at desc limit 1) as projeto
from public.portal_accounts a where a.connector = 'enel' limit 1;
alter table _ctx add column codigo text;
update _ctx set codigo = (select code from public.projects where id = _ctx.projeto);
grant select on _ctx to authenticated, anon;

create temp table _ids (nome text primary key, id uuid);
grant insert, select on _ids to authenticated, anon;

insert into _prova (passo, ok, detalhe)
select 'contexto: conta ENEL, conta CPFL, staff, empresa, outro tenant e projeto ativo da ENEL',
       conta is not null and conta_cpfl is not null and staff_gd is not null and empresa_gd is not null
       and de_fora is not null and projeto is not null,
       concat_ws(' ', conta, conta_cpfl, staff_gd, empresa_gd, de_fora, projeto, codigo)
from _ctx;

-- as mensagens que o robô já teria aberto (a tentativa abre a linha antes de tudo)
insert into public.portal_email_mensagens (tenant_id, account_id, message_id, protocolo, project_id, assunto, concluida, tentativas)
select c.tenant, c.conta, m.id, '', c.projeto, 'PROVA cobrança — pode apagar', false, 1
  from _ctx c, (values ('<prova-nota-a@exemplo.test>'), ('<prova-nota-b@exemplo.test>'),
                       ('<prova-nota-c@exemplo.test>'), ('<prova-nota-d@exemplo.test>')) as m(id);

-- ── o robô (service_role) agenda ───────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

insert into _prova (passo, ok, detalhe)
select 'agendar recusa destinatário fora da ENEL', r = 'para_recusado', r
from (select public.ludmilla_cobranca_agendar(c.conta, '<prova-nota-a@exemplo.test>', c.projeto, '400000000123',
        '2026-10-01 15:00+00', 7, 'canal@exemplo.test', 'RE: PROVA', '<prova-nota-a@exemplo.test>', null) as r from _ctx c) x;
insert into _prova (passo, ok, detalhe)
select 'agendar recusa conta que não é a da ENEL', r = 'conta_recusada', r
from (select public.ludmilla_cobranca_agendar(c.conta_cpfl, '<prova-nota-a@exemplo.test>', c.projeto, '400000000123',
        '2026-10-01 15:00+00', 7, 'canalgd.sp@br.enel.com', 'RE: PROVA', null, null) as r from _ctx c) x;
insert into _prova (passo, ok, detalhe)
select 'agendar recusa projeto que não existe', r = 'projeto_inativo', r
from (select public.ludmilla_cobranca_agendar(c.conta, '<prova-nota-a@exemplo.test>', gen_random_uuid(), '400000000123',
        '2026-10-01 15:00+00', 7, 'canalgd.sp@br.enel.com', 'RE: PROVA', null, null) as r from _ctx c) x;
insert into _prova (passo, ok, detalhe)
select 'agendar cria a cobrança da nota', r = 'criada', r
from (select public.ludmilla_cobranca_agendar(c.conta, '<prova-nota-a@exemplo.test>', c.projeto, '400000000123',
        '2026-10-01 15:00+00', 7, 'canalgd.sp@br.enel.com', 'RE: PROVA TROCA',
        '<prova-nota-a@exemplo.test>', '<prova-pedido@exemplo.test> <prova-nota-a@exemplo.test>') as r from _ctx c) x;
insert into _ids select '123', id from public.portal_cobrancas where nota_servico = '400000000123';
insert into _prova (passo, ok, detalhe)
select 'nasce agendada, vence 7 dias depois do e-mail da nota, com os cabeçalhos da resposta',
       situacao = 'agendada' and vence_em = '2026-10-08 15:00+00' and prazo_dias = 7
       and in_reply_to = '<prova-nota-a@exemplo.test>' and referencias = '<prova-pedido@exemplo.test> <prova-nota-a@exemplo.test>'
       and enviadas = 0 and aprovada_por is null,
       situacao || ' ' || vence_em
from public.portal_cobrancas where id = (select id from _ids where nome = '123');
insert into _prova (passo, ok, detalhe)
select 'agendar de novo o mesmo e-mail não duplica', r = 'mantida' and (select count(*) from public.portal_cobrancas where nota_servico = '400000000123') = 1, r
from (select public.ludmilla_cobranca_agendar(c.conta, '<prova-nota-a@exemplo.test>', c.projeto, '400000000123',
        '2026-10-01 15:00+00', 7, 'canalgd.sp@br.enel.com', 'RE: PROVA TROCA', '<prova-nota-a@exemplo.test>', null) as r from _ctx c) x;
-- ATENÇÃO ao escrever prova: o que a função grava NÃO é visto pelo resto do MESMO
-- comando (o comando de fora usa a foto do começo). Chamar num comando, conferir no seguinte.
insert into _prova (passo, ok, detalhe)
select 'a ENEL reenvia a MESMA nota mais tarde: atualiza a linha', r = 'atualizada', r
from (select public.ludmilla_cobranca_agendar(c.conta, '<prova-nota-b@exemplo.test>', c.projeto, '400000000123',
        '2026-10-05 15:00+00', null, 'canalgd.sp@br.enel.com', 'RE: PROVA TROCA', '<prova-nota-b@exemplo.test>', null) as r from _ctx c) x;
insert into _prova (passo, ok, detalhe)
select '…e o prazo recomeça da data nova', vence_em = '2026-10-12 15:00+00' and prazo_dias is null, vence_em::text
from public.portal_cobrancas where id = (select id from _ids where nome = '123');
insert into _prova (passo, ok, detalhe)
select 'reler o e-mail velho da mesma nota não mexe', r = 'mantida', r
from (select public.ludmilla_cobranca_agendar(c.conta, '<prova-nota-a@exemplo.test>', c.projeto, '400000000123',
        '2026-10-01 15:00+00', 7, 'canalgd.sp@br.enel.com', 'RE: PROVA TROCA', '<prova-nota-a@exemplo.test>', null) as r from _ctx c) x;
insert into _prova (passo, ok, detalhe)
select '…o prazo continua o da data nova', vence_em = '2026-10-12 15:00+00', vence_em::text
from public.portal_cobrancas where id = (select id from _ids where nome = '123');
insert into _prova (passo, ok, detalhe)
select 'nota NOVA do mesmo projeto cria outra cobrança', r = 'criada', r
from (select public.ludmilla_cobranca_agendar(c.conta, '<prova-nota-c@exemplo.test>', c.projeto, '400000000456',
        '2026-10-10 15:00+00', 5, 'canalgd.sp@br.enel.com', 'RE: PROVA TROCA', '<prova-nota-c@exemplo.test>', null) as r from _ctx c) x;
insert into _ids select '456', id from public.portal_cobrancas where nota_servico = '400000000456';
insert into _prova (passo, ok, detalhe)
select '…e encerra a anterior como substituída', situacao = 'encerrada' and motivo_encerramento = 'substituída pela nota 400000000456',
       situacao || ' · ' || coalesce(motivo_encerramento, '')
from public.portal_cobrancas where id = (select id from _ids where nome = '123');
insert into _prova (passo, ok, detalhe)
select 'e-mail da nota antiga lido depois da nova é ignorado (mais_antiga)', r = 'mais_antiga', r
from (select public.ludmilla_cobranca_agendar(c.conta, '<prova-nota-b@exemplo.test>', c.projeto, '400000000123',
        '2026-10-05 15:00+00', null, 'canalgd.sp@br.enel.com', 'RE: PROVA TROCA', null, null) as r from _ctx c) x;
insert into _prova (passo, ok, detalhe)
select 'nota sem número legível: cobrança criada sem o número', r = 'criada', r
from (select public.ludmilla_cobranca_agendar(c.conta, '<prova-nota-d@exemplo.test>', c.projeto, null,
        '2026-10-11 15:00+00', null, 'canalgd.sp@br.enel.com', 'RE: PROVA TROCA', '<prova-nota-d@exemplo.test>', null) as r from _ctx c) x;
insert into _ids select 'sem', c.id from public.portal_cobrancas c
  join public.portal_email_mensagens m on m.id = c.mensagem_id where m.message_id = '<prova-nota-d@exemplo.test>';
insert into _prova (passo, ok, detalhe)
select 'a nota sem número NÃO encerra a numerada', situacao = 'agendada', situacao
from public.portal_cobrancas where id = (select id from _ids where nome = '456');
insert into _prova (passo, ok, detalhe)
select 'reler a sem número mais tarde, com cabeçalho podre, atualiza', r = 'atualizada', r
from (select public.ludmilla_cobranca_agendar(c.conta, '<prova-nota-d@exemplo.test>', c.projeto, null,
        '2026-10-11 16:00+00', null, 'canalgd.sp@br.enel.com', E'RE: PROVA\r\nBcc: x@exemplo.test', E'<a@b>\r\nBcc: x', null) as r from _ctx c) x;
insert into _prova (passo, ok, detalhe)
select '…sem gravar o In-Reply-To podre e sem CR/LF no assunto', in_reply_to is null and assunto !~ '[[:cntrl:]]',
       coalesce(in_reply_to, 'nulo') || ' · ' || assunto
from public.portal_cobrancas where id = (select id from _ids where nome = 'sem');

-- ── vencimento (o cron chama como postgres) ────────────────────────────────
update public.portal_cobrancas set vence_em = now() - interval '1 minute' where id = (select id from _ids where nome = '456');
insert into _prova (passo, ok, detalhe)
select 'abrir_vencidas abre o A fazer das vencidas', n >= 2, n::text
from (select public.ludmilla_cobrancas_abrir_vencidas() as n) x;
insert into _prova (passo, ok, detalhe)
select 'a vencida fica aguardando_envio, com UM A fazer cobrar_troca aberto, com o código e a nota no título',
       (select situacao from public.portal_cobrancas where id = (select id from _ids where nome = '456')) = 'aguardando_envio'
       and count(*) = 1 and bool_and(f.tipo = 'cobrar_troca' and f.titulo like '%' || (select codigo from _ctx) || '%nota 400000000456%'),
       string_agg(f.titulo, ' | ')
from public.portal_afazeres f where f.cobranca_id = (select id from _ids where nome = '456') and f.feito_em is null;
insert into _prova (passo, ok, detalhe)
select 'a sem número abre A fazer avisando para conferir', bool_and(f.titulo like '%nota sem número%' and f.mensagem like '%confira antes de enviar%'), count(*)::text
from public.portal_afazeres f where f.cobranca_id = (select id from _ids where nome = 'sem') and f.feito_em is null;
insert into _prova (passo, ok, detalhe)
select 'abrir_vencidas de novo não duplica o A fazer', n = 0, n::text
from (select public.ludmilla_cobrancas_abrir_vencidas() as n) x;

-- ── staff do GD Manager ────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select staff_gd from _ctx), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into _prova (passo, ok, detalhe)
select 'equipe do GD vê as cobranças', count(*) >= 3, count(*)::text
from public.portal_cobrancas where id in (select id from _ids);
do $$ begin
  begin
    perform public.ludmilla_cobranca_aprovar((select id from _ids where nome = '456'),
      'Prezados, bom dia. Referente à nota da instalação [UC]: poderiam confirmar? Equipe GD Manager');
    insert into _prova (passo, ok, detalhe) values ('aprovar recusa texto com lacuna', false, 'aceitou');
  exception when others then
    insert into _prova (passo, ok, detalhe) values ('aprovar recusa texto com lacuna', sqlerrm like '%[UC]%', sqlerrm);
  end;
  begin
    perform public.ludmilla_cobranca_aprovar((select id from _ids where nome = '456'), 'curto');
    insert into _prova (passo, ok, detalhe) values ('aprovar recusa texto curto', false, 'aceitou');
  exception when others then
    insert into _prova (passo, ok, detalhe) values ('aprovar recusa texto curto', true, sqlerrm);
  end;
end $$;
insert into _ids select 'run1', public.ludmilla_cobranca_aprovar((select id from _ids where nome = '456'),
  E'Prezados, bom dia.\n\nPROVA de texto aprovado — pode apagar.\n\nAtenciosamente,\nEquipe GD Manager');
insert into _prova (passo, ok, detalhe)
select 'aprovar devolve o run', (select id from _ids where nome = 'run1') is not null, (select id from _ids where nome = 'run1')::text;
insert into _prova (passo, ok, detalhe)
select 'o A fazer da cobrança fica feito por quem aprovou',
       bool_and(f.feito_por = (select staff_gd from _ctx) and f.feito_em is not null), count(*)::text
from public.portal_afazeres f where f.cobranca_id = (select id from _ids where nome = '456');
do $$ begin
  begin
    perform public.ludmilla_cobranca_aprovar((select id from _ids where nome = '456'),
      E'Prezados, bom dia.\n\nSegundo clique — pode apagar.\n\nEquipe GD Manager');
    insert into _prova (passo, ok, detalhe) values ('aprovar duas vezes é recusado', false, 'aceitou');
  exception when others then
    insert into _prova (passo, ok, detalhe) values ('aprovar duas vezes é recusado', sqlerrm like '%já foi aprovada%', sqlerrm);
  end;
  begin
    update public.portal_cobrancas set situacao = 'dispensada' where id = (select id from _ids where nome = '456');
    insert into _prova (passo, ok, detalhe) values ('escrita direta na tabela é barrada', false, 'o UPDATE passou');
  exception when insufficient_privilege then
    insert into _prova (passo, ok, detalhe) values ('escrita direta na tabela é barrada', true, sqlerrm);
  end;
  begin
    perform 1 from public.ludmilla_cobranca_iniciar_envio((select id from _ids where nome = 'run1'));
    insert into _prova (passo, ok, detalhe) values ('a equipe não chama a RPC do robô', false, 'a função aceitou');
  exception when others then
    insert into _prova (passo, ok, detalhe) values ('a equipe não chama a RPC do robô', true, sqlerrm);
  end;
end $$;
insert into _prova (passo, ok, detalhe)
select 'dispensar a sem número: true na 1ª', public.ludmilla_cobranca_dispensar((select id from _ids where nome = 'sem')), null;
insert into _prova (passo, ok, detalhe)
select 'dispensar de novo: false (já estava decidida)', not public.ludmilla_cobranca_dispensar((select id from _ids where nome = 'sem')), null;
reset role;

insert into _prova (passo, ok, detalhe)
select 'dispensada: situação, quem, e o A fazer dela fechado por quem dispensou',
       c.situacao = 'dispensada' and c.encerrada_por = (select staff_gd from _ctx)
       and not exists (select 1 from public.portal_afazeres f where f.cobranca_id = c.id and f.feito_em is null),
       c.situacao
from public.portal_cobrancas c where c.id = (select id from _ids where nome = 'sem');
insert into _prova (passo, ok, detalhe)
select 'o run nasceu enviar_cobranca, na fila, pedido por quem aprovou, apontando a cobrança',
       r.tipo = 'enviar_cobranca' and r.situacao = 'na_fila' and r.pedido_por = (select staff_gd from _ctx)
       and r.dados ->> 'cobranca_id' = (select id from _ids where nome = '456')::text, r.tipo || ' ' || r.situacao
from public.portal_sync_runs r where r.id = (select id from _ids where nome = 'run1');

-- ── o robô envia ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

insert into _prova (passo, ok, detalhe)
select 'iniciar com o run ainda na fila é recusado', x.recusa is not null, x.recusa
from public.ludmilla_cobranca_iniciar_envio((select id from _ids where nome = 'run1')) x;
update public.portal_sync_runs set situacao = 'rodando', iniciado_em = now() where id = (select id from _ids where nome = 'run1');
-- um run do mesmo tipo que NÃO veio da aprovação (como se alguém chamasse ludmilla_pedir_run)
with novo as (
  insert into public.portal_sync_runs (tenant_id, account_id, tipo, situacao, dados)
  select tenant, conta, 'enviar_cobranca', 'rodando', jsonb_build_object('cobranca_id', (select id from _ids where nome = '456')) from _ctx
  returning id)
insert into _ids select 'avulso', id from novo;
insert into _prova (passo, ok, detalhe)
select 'run avulso (não veio da aprovação) é recusado', x.recusa like '%não veio da aprovação%', x.recusa
from public.ludmilla_cobranca_iniciar_envio((select id from _ids where nome = 'avulso')) x;
select public.ludmilla_cobranca_falhou((select id from _ids where nome = 'avulso'), 'este pedido de envio não veio da aprovação da cobrança');
insert into _prova (passo, ok, detalhe)
select 'fechar o avulso não mexe na cobrança aprovada',
       c.situacao = 'aguardando_envio' and c.aprovada_por = (select staff_gd from _ctx) and c.run_id = (select id from _ids where nome = 'run1'),
       c.situacao
from public.portal_cobrancas c where c.id = (select id from _ids where nome = '456');

create temp table _envio as
select * from public.ludmilla_cobranca_iniciar_envio((select id from _ids where nome = 'run1'));
insert into _prova (passo, ok, detalhe)
select 'iniciar o run da aprovação devolve o e-mail aprovado',
       recusa is null and para = 'canalgd.sp@br.enel.com' and texto like 'Prezados, bom dia.%PROVA de texto aprovado%'
       and nota_servico = '400000000456' and in_reply_to = '<prova-nota-c@exemplo.test>'
       and situacao_anterior = 'aguardando_envio' and aprovada_por = (select staff_gd from _ctx),
       coalesce(recusa, 'ok')
from _envio;
insert into _prova (passo, ok, detalhe)
select '…e a cobrança passa a enviando', situacao = 'enviando', situacao
from public.portal_cobrancas where id = (select id from _ids where nome = '456');
insert into _prova (passo, ok, detalhe)
select 'iniciar de novo é recusado (no máximo um envio por aprovação)', x.recusa is not null, x.recusa
from public.ludmilla_cobranca_iniciar_envio((select id from _ids where nome = 'run1')) x;

select public.ludmilla_cobranca_enviada((select id from _ids where nome = 'run1'), '<prova-enviada@exemplo.test>');
insert into _prova (passo, ok, detalhe)
select 'enviada: volta a agendada, conta 1 envio, próxima em 7 dias, guarda o texto que saiu',
       situacao = 'agendada' and enviadas = 1 and ultima_enviada_em = now() and vence_em = now() + interval '7 days'
       and texto_aprovado is null and aprovada_por is null and ultimo_texto_enviado like '%PROVA de texto aprovado%',
       situacao || ' ' || enviadas
from public.portal_cobrancas where id = (select id from _ids where nome = '456');
insert into _prova (passo, ok, detalhe)
select 'comentário da Ludmilla no card, com a nota, a ENEL e quem aprovou', count(*) = 1, max(message)
from public.comments
where project_id = (select projeto from _ctx) and user_id = '00000000-10d1-4000-8000-000000000002'
  and message like '📡 Ludmilla: cobrança da nota 400000000456 enviada à ENEL (canalgd.sp@br.enel.com), aprovada por %';
insert into _prova (passo, ok, detalhe)
select 'histórico do projeto com a pessoa que aprovou como autora', count(*) = 1, max(description)
from public.project_history
where project_id = (select projeto from _ctx) and action = 'Cobrança enviada à ENEL' and user_id = (select staff_gd from _ctx)
  and description like 'Cobrança da nota 400000000456 enviada à ENEL; aprovada por %';
insert into _prova (passo, ok, detalhe)
select 'o run fecha ok com a nota e o destinatário',
       situacao = 'ok' and resultado ->> 'nota' = '400000000456' and resultado ->> 'para' = 'canalgd.sp@br.enel.com', situacao
from public.portal_sync_runs where id = (select id from _ids where nome = 'run1');

-- ── a trava dos 7 dias ─────────────────────────────────────────────────────
update public.portal_cobrancas set situacao = 'aguardando_envio' where id = (select id from _ids where nome = '456');
select set_config('request.jwt.claims', json_build_object('sub', (select staff_gd from _ctx), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.ludmilla_cobranca_aprovar((select id from _ids where nome = '456'),
      E'Prezados, bom dia.\n\nCedo demais — PROVA, pode apagar.\n\nEquipe GD Manager');
    insert into _prova (passo, ok, detalhe) values ('aprovar antes de 7 dias do último envio é recusado', false, 'aceitou');
  exception when others then
    insert into _prova (passo, ok, detalhe) values ('aprovar antes de 7 dias do último envio é recusado', sqlerrm like '%7 dias%', sqlerrm);
  end;
end $$;
reset role;
update public.portal_cobrancas set ultima_enviada_em = now() - interval '7 days' - interval '1 minute'
 where id = (select id from _ids where nome = '456');
select set_config('request.jwt.claims', json_build_object('sub', (select staff_gd from _ctx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _ids select 'run2', public.ludmilla_cobranca_aprovar((select id from _ids where nome = '456'),
  E'Prezados, bom dia.\n\nSegunda cobrança — PROVA, pode apagar.\n\nEquipe GD Manager');
reset role;
insert into _prova (passo, ok, detalhe)
select 'passados 7 dias e 1 minuto, aprova de novo', (select id from _ids where nome = 'run2') is not null, null;

-- ── a falha do envio ───────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
update public.portal_sync_runs set situacao = 'rodando', iniciado_em = now() where id = (select id from _ids where nome = 'run2');
create temp table _envio2 as
select * from public.ludmilla_cobranca_iniciar_envio((select id from _ids where nome = 'run2'));
insert into _prova (passo, ok, detalhe)
select 'passados 7 dias, o robô pode iniciar', recusa is null, coalesce(recusa, 'ok') from _envio2;
select public.ludmilla_cobranca_falhou((select id from _ids where nome = 'run2'), 'o Gmail recusou a senha de app da caixa (EAUTH 535)');
insert into _prova (passo, ok, detalhe)
select 'falhou: volta a esperar a equipe, sem aprovação, com o erro e o texto como rascunho',
       situacao = 'aguardando_envio' and aprovada_por is null and erro like '%EAUTH%' and texto_aprovado like '%Segunda cobrança%',
       situacao || ' · ' || coalesce(erro, '')
from public.portal_cobrancas where id = (select id from _ids where nome = '456');
insert into _prova (passo, ok, detalhe)
select '…com UM A fazer novo dizendo que não saiu', count(*) = 1 and bool_and(titulo like '%não saiu%' and mensagem like '%Enviados%'),
       count(*)::text
from public.portal_afazeres where cobranca_id = (select id from _ids where nome = '456') and feito_em is null;
insert into _prova (passo, ok, detalhe)
select '…e o run fecha com erro', situacao = 'erro' and erro like '%EAUTH%', situacao
from public.portal_sync_runs where id = (select id from _ids where nome = 'run2');

-- ── quando as cobranças param ──────────────────────────────────────────────
insert into _prova (passo, ok, detalhe)
select 'troca realizada encerra a cobrança ativa do projeto', n = 1, n::text
from (select public.ludmilla_cobranca_encerrar_por_troca((select conta from _ctx), (select projeto from _ctx), now()) as n) x;
insert into _prova (passo, ok, detalhe)
select '…com o motivo, e fecha o A fazer aberto dela',
       c.situacao = 'encerrada' and c.motivo_encerramento like '%troca do relógio foi feita%'
       and not exists (select 1 from public.portal_afazeres f where f.cobranca_id = c.id and f.feito_em is null),
       c.situacao
from public.portal_cobrancas c where c.id = (select id from _ids where nome = '456');

with novo as (
  insert into public.portal_cobrancas (tenant_id, account_id, project_id, nota_servico, data_nota, para, assunto, vence_em)
  select tenant, conta, null, '400000000789', now() - interval '10 days', 'canalgd.sp@br.enel.com', 'RE: PROVA', now() - interval '3 days'
    from _ctx
  returning id)
insert into _ids select '789', id from novo;
with novo as (
  insert into public.portal_cobrancas (tenant_id, account_id, project_id, nota_servico, data_nota, para, assunto, vence_em,
                                       situacao, aprovada_por, aprovada_em, texto_aprovado, atualizado_em)
  select tenant, conta, projeto, '400000000999', now() - interval '9 days', 'canalgd.sp@br.enel.com', 'RE: PROVA',
         now() - interval '2 days', 'enviando', staff_gd, now() - interval '41 minutes',
         E'Prezados, bom dia.\n\nPROVA presa no envio — pode apagar.\n\nEquipe GD Manager', now() - interval '40 minutes'
    from _ctx
  returning id)
insert into _ids select '999', id from novo;
select public.ludmilla_cobrancas_abrir_vencidas();
insert into _prova (passo, ok, detalhe)
select 'projeto que sumiu: a cobrança é encerrada e não abre A fazer',
       c.situacao = 'encerrada' and c.motivo_encerramento like '%concluído ou arquivado%'
       and not exists (select 1 from public.portal_afazeres f where f.cobranca_id = c.id),
       c.situacao
from public.portal_cobrancas c where c.id = (select id from _ids where nome = '789');
insert into _prova (passo, ok, detalhe)
select 'envio preso há 40 min volta para a equipe (nunca reenvia sozinho), com A fazer "pode não ter saído"',
       c.situacao = 'aguardando_envio' and c.aprovada_por is null and c.erro like '%não confirmou%'
       and exists (select 1 from public.portal_afazeres f where f.cobranca_id = c.id and f.feito_em is null and f.titulo like '%pode não ter saído%'),
       c.situacao
from public.portal_cobrancas c where c.id = (select id from _ids where nome = '999');

-- ── o Registro ─────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select staff_gd from _ctx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _prova (passo, ok, detalhe)
select 'Registro: o envio aparece como cobrança à ENEL, com a nota', count(*) >= 1, max(r.titulo || ' · ' || r.detalhe)
from public.ludmilla_registro(500, null) r
where r.titulo like 'Cobrança à %(troca do relógio)' and r.detalhe like 'nota 400000000456%';
insert into _prova (passo, ok, detalhe)
select 'Registro: o envio que falhou aparece com o motivo', count(*) >= 1, null
from public.ludmilla_registro(500, null) r
where r.titulo like 'Cobrança à %' and r.situacao = 'erro' and r.detalhe like '%EAUTH%';
reset role;

-- ── empresa integradora, outro tenant, anônimo ─────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select empresa_gd from _ctx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _prova (passo, ok, detalhe)
select 'empresa integradora não vê cobranças', not exists (select 1 from public.portal_cobrancas), null;
do $$ begin
  begin
    perform public.ludmilla_cobranca_dispensar((select id from _ids where nome = '999'));
    insert into _prova (passo, ok, detalhe) values ('empresa integradora não dispensa', false, 'aceitou');
  exception when others then
    insert into _prova (passo, ok, detalhe) values ('empresa integradora não dispensa', true, sqlerrm);
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select de_fora from _ctx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _prova (passo, ok, detalhe)
select 'outro tenant não vê cobranças', not exists (select 1 from public.portal_cobrancas), null;
do $$ begin
  begin
    perform public.ludmilla_cobranca_aprovar((select id from _ids where nome = '999'),
      E'Prezados, bom dia.\n\nDe fora — PROVA.\n\nEquipe GD Manager');
    insert into _prova (passo, ok, detalhe) values ('outro tenant não aprova', false, 'aceitou');
  exception when others then
    insert into _prova (passo, ok, detalhe) values ('outro tenant não aprova', true, sqlerrm);
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$ begin
  begin
    perform 1 from public.portal_cobrancas limit 1;
    insert into _prova (passo, ok, detalhe) values ('anônimo não lê a tabela', false, 'o SELECT passou');
  exception when insufficient_privilege then
    insert into _prova (passo, ok, detalhe) values ('anônimo não lê a tabela', true, sqlerrm);
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── a trava do destinatário no banco (a MESMA expressão do worker) ─────────
do $$
declare _e text;
begin
  foreach _e in array array['X@ENEL.COM', 'canalgd.sp@br.enel.com.exemplo.test', 'x@enel.com.br', 'x@evil.enel.com',
                            E'x@enel.com\nBcc: y@exemplo.test', 'a@enel.com,b@exemplo.test', 'x y@enel.com', '',
                            'x@enelxcom', '.x@enel.com'] loop
    begin
      insert into public.portal_cobrancas (tenant_id, account_id, data_nota, para, assunto, vence_em)
      select tenant, conta, now(), _e, 'RE: PROVA', now() + interval '30 days' from _ctx;
      insert into _prova (passo, ok, detalhe) values ('a trava barra ' || quote_literal(_e), false, 'o INSERT passou');
    exception when check_violation then
      insert into _prova (passo, ok, detalhe) values ('a trava barra ' || quote_literal(_e), true, null);
    end;
  end loop;
  foreach _e in array array['canalgd.sp@br.enel.com', 'tecnico.abc@enel.com'] loop
    begin
      insert into public.portal_cobrancas (tenant_id, account_id, data_nota, para, assunto, vence_em)
      select tenant, conta, now(), _e, 'RE: PROVA', now() + interval '30 days' from _ctx;
      insert into _prova (passo, ok, detalhe) values ('a trava deixa ' || _e, true, null);
    exception when others then
      insert into _prova (passo, ok, detalhe) values ('a trava deixa ' || _e, false, sqlerrm);
    end;
  end loop;
end $$;
insert into _prova (passo, ok, detalhe)
select 'a trava não aceita nulo', public.ludmilla_endereco_da_enel(null) = false, null;

-- ── a CPFL não mudou ───────────────────────────────────────────────────────
insert into _prova (passo, ok, detalhe)
select 'agendador da CPFL intacto (md5)', md5(prosrc) = '3d0d2d0f1e7455ec701230bc925e1bde', md5(prosrc)
from pg_proc where proname = 'ludmilla_agendar_varreduras';

select passo, ok, detalhe from _prova order by em;
rollback;
```

Run: `npx -y supabase db query --linked -f "$RASCUNHO/prova_cobranca.sql"`
Expected: FALHA com `VERMELHO: a tabela portal_cobrancas ainda não existe` (o erro aborta a transação antes de qualquer escrita).

- [ ] **Step 4: Escrever a migração**

Crie `supabase/migrations/20261024150000_ludmilla_cobranca_troca.sql`:

```sql
-- ============================================================================
-- LUDMILLA — cobrar a ENEL sobre a troca do relógio (24/10/2026)
-- Spec: docs/superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md §3.2–§3.5
-- Plano: docs/superpowers/plans/2026-10-24-ludmilla-enel-cobranca-troca.md (Task 1)
--
-- 1. ludmilla_endereco_da_enel(texto): a trava do destinatário. A MESMA expressão do
--    worker (worker/ludmilla/src/email/enel/cobranca.ts, REGEX_DESTINATARIO_ENEL); um
--    teste do worker lê ESTE arquivo e confere.
-- 2. portal_cobrancas: uma linha por nota de serviço (única por conta + nota). Leitura
--    só da equipe do GD Manager; escrita só por RPC.
-- 3. portal_afazeres: tipo 'cobrar_troca' e coluna cobranca_id (no máximo UM A fazer
--    aberto por cobrança).
-- 4. portal_sync_runs: tipo 'enviar_cobranca'.
-- 5. RPCs do robô (só service_role), da equipe (o "Enviar" e o "Dispensar") e do
--    agendamento (ludmilla_cobrancas_abrir_vencidas; o cron entra na 20261024170000).
-- 6. ludmilla_registro: corpo do prosrc VIVO (md5 ff561bfc0a7abff9803c2b7ca2893f0c, =
--    20261005130000), com DUAS linhas novas, marcadas NOVO, para o run de envio.
--
-- NÃO mexe em ludmilla_agendar_varreduras (CPFL), ludmilla_email_registrar,
-- ludmilla_email_avisar, ludmilla_afazer_feito, ludmilla_claim_run, ludmilla_pedir_run
-- nem ludmilla_finalizar_run_impl. Nada aqui manda e-mail: quem manda é o worker, e só
-- depois do clique (ludmilla_cobranca_aprovar).
-- ============================================================================

-- ── 1. A trava do destinatário ──────────────────────────────────────────────
-- UM endereço, já normalizado (minúsculo, sem nome, sem espaço), @enel.com ou
-- @br.enel.com. Maiúscula, subdomínio, lista, quebra de linha: tudo falso.
CREATE OR REPLACE FUNCTION public.ludmilla_endereco_da_enel(p_endereco TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(p_endereco ~ '^[a-z0-9][a-z0-9._%+-]*@(br\.)?enel\.com$', FALSE);
$$;
REVOKE ALL ON FUNCTION public.ludmilla_endereco_da_enel(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_endereco_da_enel(TEXT) TO authenticated, service_role;

-- ── 2. A tabela ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_cobrancas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id           UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  project_id           UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- 12 dígitos; NULL = o robô não achou o número (a tela pede "confira o número da nota")
  nota_servico         TEXT CHECK (nota_servico IS NULL OR nota_servico ~ '^[0-9]{12}$'),
  -- o e-mail que abriu (ou reabriu) a nota: portal_email_mensagens.id, NÃO o Message-ID
  mensagem_id          UUID REFERENCES public.portal_email_mensagens(id) ON DELETE SET NULL,
  data_nota            TIMESTAMPTZ NOT NULL,
  prazo_dias           INTEGER CHECK (prazo_dias IS NULL OR prazo_dias BETWEEN 1 AND 365),
  para                 TEXT NOT NULL CONSTRAINT portal_cobrancas_para_da_enel CHECK (public.ludmilla_endereco_da_enel(para)),
  assunto              TEXT NOT NULL CHECK (length(assunto) BETWEEN 1 AND 300 AND assunto !~ '[[:cntrl:]]'),
  -- os cabeçalhos da resposta na conversa da nota ("references" é palavra reservada do SQL)
  in_reply_to          TEXT CHECK (in_reply_to IS NULL OR in_reply_to ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$'),
  referencias          TEXT CHECK (referencias IS NULL
                                   OR referencias ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>( <[^<>[:space:]]+@[^<>[:space:]]+>)*$'),
  vence_em             TIMESTAMPTZ NOT NULL,
  situacao             TEXT NOT NULL DEFAULT 'agendada'
                       CHECK (situacao IN ('agendada', 'aguardando_envio', 'enviando', 'encerrada', 'dispensada')),
  enviadas             INTEGER NOT NULL DEFAULT 0 CHECK (enviadas >= 0),
  ultima_enviada_em    TIMESTAMPTZ,
  ultimo_texto_enviado TEXT,
  aprovada_por         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  aprovada_em          TIMESTAMPTZ,
  -- o texto do clique; numa falha fica como rascunho para a próxima tentativa
  texto_aprovado       TEXT CHECK (texto_aprovado IS NULL OR length(texto_aprovado) BETWEEN 20 AND 5000),
  run_id               UUID REFERENCES public.portal_sync_runs(id) ON DELETE SET NULL,
  erro                 TEXT,
  encerrada_por        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  motivo_encerramento  TEXT,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_cobrancas_nota_unica UNIQUE (account_id, nota_servico),
  CONSTRAINT portal_cobrancas_mensagem_unica UNIQUE (mensagem_id)
);
CREATE INDEX IF NOT EXISTS idx_portal_cobrancas_vencimento
  ON public.portal_cobrancas (situacao, vence_em) WHERE situacao IN ('agendada', 'aguardando_envio', 'enviando');
CREATE INDEX IF NOT EXISTS idx_portal_cobrancas_projeto ON public.portal_cobrancas (project_id);
CREATE INDEX IF NOT EXISTS idx_portal_cobrancas_run ON public.portal_cobrancas (run_id);

ALTER TABLE public.portal_cobrancas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.portal_cobrancas;
CREATE POLICY tenant_isolation ON public.portal_cobrancas
  AS RESTRICTIVE FOR ALL
  USING (tenant_id = public.get_user_tenant_id((SELECT auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((SELECT auth.uid())));
DROP POLICY IF EXISTS equipe_le_cobrancas ON public.portal_cobrancas;
CREATE POLICY equipe_le_cobrancas ON public.portal_cobrancas
  FOR SELECT USING ((SELECT public.ludmilla_equipe_ok()));
-- nenhuma política de escrita: só as RPCs SECURITY DEFINER escrevem
REVOKE ALL ON public.portal_cobrancas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.portal_cobrancas FROM authenticated;
GRANT SELECT ON public.portal_cobrancas TO authenticated;

-- ── 3. O A fazer da cobrança ────────────────────────────────────────────────
ALTER TABLE public.portal_afazeres
  ADD COLUMN IF NOT EXISTS cobranca_id UUID REFERENCES public.portal_cobrancas(id) ON DELETE CASCADE;
ALTER TABLE public.portal_afazeres DROP CONSTRAINT IF EXISTS portal_afazeres_tipo_check;
ALTER TABLE public.portal_afazeres ADD CONSTRAINT portal_afazeres_tipo_check
  CHECK (tipo IN ('vistoria_aprovada', 'troca_falhou', 'devolucao', 'aviso', 'cobrar_troca'));
ALTER TABLE public.portal_afazeres DROP CONSTRAINT IF EXISTS portal_afazeres_cobranca_coerente;
ALTER TABLE public.portal_afazeres ADD CONSTRAINT portal_afazeres_cobranca_coerente
  CHECK ((tipo = 'cobrar_troca') = (cobranca_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS portal_afazeres_uma_cobranca_aberta
  ON public.portal_afazeres (cobranca_id) WHERE cobranca_id IS NOT NULL AND feito_em IS NULL;

-- ── 4. O run de envio ───────────────────────────────────────────────────────
ALTER TABLE public.portal_sync_runs DROP CONSTRAINT IF EXISTS portal_sync_runs_tipo_check;
ALTER TABLE public.portal_sync_runs ADD CONSTRAINT portal_sync_runs_tipo_check
  CHECK (tipo IN ('reconhecimento', 'teste_login', 'descoberta', 'varredura', 'criar_projeto', 'varredura_email', 'enviar_cobranca'));

-- ── 5a. Ajudantes internos (ninguém de fora chama) ──────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_fechar_afazer(p_cobranca_id UUID, p_por UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.portal_afazeres SET feito_por = p_por, feito_em = now()
   WHERE cobranca_id = p_cobranca_id AND feito_em IS NULL;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_fechar_afazer(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- Sem título/mensagem: os do "venceu" (a nota, o projeto, a data e o pedido de conferir
-- quando falta o número). Não abre se já houver um aberto para a cobrança.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_abrir_afazer(
  p_cobranca_id UUID, p_titulo TEXT DEFAULT NULL, p_mensagem TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _c public.portal_cobrancas%ROWTYPE; _codigo TEXT; _titulo TEXT; _mensagem TEXT; _n INTEGER;
BEGIN
  SELECT * INTO _c FROM public.portal_cobrancas WHERE id = p_cobranca_id;
  IF _c.id IS NULL THEN RETURN 0; END IF;
  SELECT p.code INTO _codigo FROM public.projects p WHERE p.id = _c.project_id;
  _titulo := coalesce(p_titulo,
    '📡 Cobrar a ENEL — troca do relógio do ' || coalesce(_codigo, 'projeto')
    || ' (nota ' || coalesce(_c.nota_servico, 'sem número') || ')');
  _mensagem := coalesce(p_mensagem,
    CASE WHEN _c.enviadas > 0 AND _c.ultima_enviada_em IS NOT NULL
         THEN 'A última cobrança saiu em ' || to_char(_c.ultima_enviada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
              || ' e a ENEL não confirmou a troca. Revise o e-mail e envie de novo, ou dispense.'
         ELSE 'A nota de serviço foi aberta em ' || to_char(_c.data_nota AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
              || ' e a ENEL ainda não confirmou a troca. Revise o e-mail e envie, ou dispense.'
    END
    || CASE WHEN _c.nota_servico IS NULL
            THEN ' Não achei o número da nota no e-mail da ENEL: confira antes de enviar.' ELSE '' END);
  INSERT INTO public.portal_afazeres (tenant_id, account_id, project_id, cobranca_id, tipo, titulo, mensagem)
  SELECT _c.tenant_id, _c.account_id, _c.project_id, _c.id, 'cobrar_troca', left(_titulo, 200), left(_mensagem, 1000)
   WHERE NOT EXISTS (SELECT 1 FROM public.portal_afazeres f WHERE f.cobranca_id = _c.id AND f.feito_em IS NULL);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_abrir_afazer(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- ── 5b. O robô agenda (leitura da ENEL) ─────────────────────────────────────
-- Devolve: criada | atualizada | mantida | mais_antiga | projeto_inativo | para_recusado
--          | conta_recusada | mensagem_inexistente. Recusa por código, nunca por erro:
-- quem chama é o tratamento de UM e-mail, e um erro faria a mensagem ser relida 5 vezes.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_agendar(
  p_account_id UUID, p_message_id TEXT, p_project_id UUID, p_nota TEXT, p_data_nota TIMESTAMPTZ,
  p_prazo_dias INTEGER, p_para TEXT, p_assunto TEXT, p_in_reply_to TEXT, p_referencias TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _conta public.portal_accounts%ROWTYPE; _proj public.projects%ROWTYPE; _msg UUID;
  _c public.portal_cobrancas%ROWTYPE; _id UUID; _resultado TEXT; _velha UUID;
  _nota TEXT := nullif(btrim(coalesce(p_nota, '')), '');
  _prazo INTEGER := CASE WHEN p_prazo_dias BETWEEN 1 AND 365 THEN p_prazo_dias END;
  _irt TEXT := CASE WHEN p_in_reply_to ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$' THEN p_in_reply_to END;
  _refs TEXT := CASE WHEN p_referencias ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>( <[^<>[:space:]]+@[^<>[:space:]]+>)*$'
                     THEN p_referencias END;
  _assunto TEXT := left(btrim(regexp_replace(coalesce(p_assunto, ''), '[[:cntrl:]]+', ' ', 'g')), 300);
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô agenda cobranças';
  END IF;
  IF _nota IS NOT NULL AND _nota !~ '^[0-9]{12}$' THEN _nota := NULL; END IF;
  IF _assunto = '' THEN _assunto := 'RE: TROCA DE RELÓGIO'; END IF;

  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  IF _conta.id IS NULL OR _conta.connector <> 'enel' THEN RETURN 'conta_recusada'; END IF;
  SELECT * INTO _proj FROM public.projects
   WHERE id = p_project_id AND tenant_id = _conta.tenant_id AND concessionaire_id = _conta.concessionaire_id;
  IF _proj.id IS NULL OR _proj.is_deleted OR _proj.archived_at IS NOT NULL OR _proj.status::text = 'completed' THEN
    RETURN 'projeto_inativo';
  END IF;
  IF NOT public.ludmilla_endereco_da_enel(p_para) THEN RETURN 'para_recusado'; END IF;
  SELECT m.id INTO _msg FROM public.portal_email_mensagens m
   WHERE m.account_id = p_account_id AND m.message_id = p_message_id AND m.protocolo = '';
  IF _msg IS NULL THEN RETURN 'mensagem_inexistente'; END IF;

  -- e-mail mais velho que a nota em andamento do projeto (2ª leitura de um e-mail antigo)
  IF EXISTS (SELECT 1 FROM public.portal_cobrancas c
              WHERE c.project_id = p_project_id AND c.situacao IN ('agendada', 'aguardando_envio', 'enviando')
                AND c.data_nota > p_data_nota AND c.nota_servico IS DISTINCT FROM _nota) THEN
    RETURN 'mais_antiga';
  END IF;

  IF _nota IS NOT NULL THEN
    SELECT * INTO _c FROM public.portal_cobrancas c
     WHERE c.account_id = p_account_id AND c.nota_servico = _nota FOR UPDATE;
  END IF;
  IF _c.id IS NULL THEN
    SELECT * INTO _c FROM public.portal_cobrancas c WHERE c.mensagem_id = _msg FOR UPDATE;
  END IF;

  IF _c.id IS NULL THEN
    INSERT INTO public.portal_cobrancas
      (tenant_id, account_id, project_id, nota_servico, mensagem_id, data_nota, prazo_dias,
       para, assunto, in_reply_to, referencias, vence_em)
    VALUES
      (_conta.tenant_id, p_account_id, p_project_id, _nota, _msg, p_data_nota, _prazo,
       p_para, _assunto, _irt, _refs, p_data_nota + interval '7 days')
    RETURNING id INTO _id;
    _resultado := 'criada';
  ELSIF _c.nota_servico IS NOT NULL AND _nota IS NOT NULL AND _c.nota_servico <> _nota THEN
    RETURN 'mantida';
  ELSIF _c.situacao IN ('agendada', 'aguardando_envio')
        AND (p_data_nota > _c.data_nota OR (_c.nota_servico IS NULL AND _nota IS NOT NULL)) THEN
    -- o mesmo e-mail pode estar preso a outra linha (sem número): solta antes de mover
    UPDATE public.portal_cobrancas SET mensagem_id = NULL WHERE mensagem_id = _msg AND id <> _c.id;
    UPDATE public.portal_cobrancas
       SET nota_servico = coalesce(_nota, nota_servico), mensagem_id = _msg,
           data_nota = greatest(p_data_nota, data_nota), prazo_dias = _prazo,
           para = p_para, assunto = _assunto, in_reply_to = _irt, referencias = _refs,
           vence_em = greatest(p_data_nota, data_nota) + interval '7 days', situacao = 'agendada',
           aprovada_por = NULL, aprovada_em = NULL, texto_aprovado = NULL, erro = NULL, atualizado_em = now()
     WHERE id = _c.id;
    -- a ENEL respondeu (reenviou ou reprogramou): o A fazer aberto perdeu o sentido
    PERFORM public.ludmilla_cobranca_fechar_afazer(_c.id, NULL);
    _id := _c.id;
    _resultado := 'atualizada';
  ELSE
    RETURN 'mantida';
  END IF;

  -- a nota NOVA (com número) encerra as mais antigas do mesmo projeto
  IF _nota IS NOT NULL THEN
    FOR _velha IN SELECT c.id FROM public.portal_cobrancas c
                   WHERE c.project_id = p_project_id AND c.id <> _id
                     AND c.situacao IN ('agendada', 'aguardando_envio')
                     AND c.nota_servico IS DISTINCT FROM _nota AND c.data_nota <= p_data_nota
                   FOR UPDATE LOOP
      UPDATE public.portal_cobrancas
         SET situacao = 'encerrada', motivo_encerramento = 'substituída pela nota ' || _nota, atualizado_em = now()
       WHERE id = _velha;
      PERFORM public.ludmilla_cobranca_fechar_afazer(_velha, NULL);
    END LOOP;
  END IF;
  RETURN _resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_agendar(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_agendar(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- A ENEL avisou que a troca foi feita: as cobranças do projeto param (spec §3.5).
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_encerrar_por_troca(p_account_id UUID, p_project_id UUID, p_quando TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id UUID; _n INTEGER := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô encerra cobranças pela troca';
  END IF;
  FOR _id IN SELECT c.id FROM public.portal_cobrancas c
              WHERE c.account_id = p_account_id AND c.project_id = p_project_id
                AND c.situacao IN ('agendada', 'aguardando_envio')
                AND c.data_nota <= coalesce(p_quando, now())
              FOR UPDATE LOOP
    UPDATE public.portal_cobrancas
       SET situacao = 'encerrada', motivo_encerramento = 'a ENEL avisou que a troca do relógio foi feita', atualizado_em = now()
     WHERE id = _id;
    PERFORM public.ludmilla_cobranca_fechar_afazer(_id, NULL);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_encerrar_por_troca(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_encerrar_por_troca(UUID, UUID, TIMESTAMPTZ) TO service_role;

-- ── 5c. O agendamento (o cron da 20261024170000 chama, como postgres) ───────
CREATE OR REPLACE FUNCTION public.ludmilla_cobrancas_abrir_vencidas()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _r RECORD; _n INTEGER := 0;
BEGIN
  -- 1. projeto concluído, arquivado, apagado ou sumido: as cobranças param
  FOR _r IN SELECT c.id FROM public.portal_cobrancas c
              LEFT JOIN public.projects p ON p.id = c.project_id
             WHERE c.situacao IN ('agendada', 'aguardando_envio')
               AND (p.id IS NULL OR p.is_deleted OR p.archived_at IS NOT NULL OR p.status::text = 'completed')
             FOR UPDATE OF c LOOP
    UPDATE public.portal_cobrancas
       SET situacao = 'encerrada', motivo_encerramento = 'o projeto foi concluído ou arquivado', atualizado_em = now()
     WHERE id = _r.id;
    PERFORM public.ludmilla_cobranca_fechar_afazer(_r.id, NULL);
  END LOOP;

  -- 2. envio que começou e não confirmou em 30 min: volta para a equipe. NUNCA reenvia sozinho.
  FOR _r IN SELECT c.id, c.nota_servico FROM public.portal_cobrancas c
             WHERE c.situacao = 'enviando' AND c.atualizado_em < now() - interval '30 minutes'
             FOR UPDATE LOOP
    UPDATE public.portal_cobrancas
       SET situacao = 'aguardando_envio', aprovada_por = NULL, aprovada_em = NULL,
           erro = 'o robô começou o envio e não confirmou; confira a pasta Enviados do Gmail antes de enviar de novo',
           atualizado_em = now()
     WHERE id = _r.id;
    _n := _n + public.ludmilla_cobranca_abrir_afazer(_r.id,
      '📡 A cobrança da nota ' || coalesce(_r.nota_servico, 'sem número') || ' pode não ter saído',
      'O robô começou o envio e não confirmou. Confira a pasta Enviados do Gmail antes de enviar de novo.');
  END LOOP;

  -- 3. venceu: aparece para a equipe aprovar (o texto é montado na tela)
  FOR _r IN SELECT c.id FROM public.portal_cobrancas c
              JOIN public.portal_accounts a ON a.id = c.account_id AND a.enabled
             WHERE c.situacao = 'agendada' AND c.vence_em <= now()
             FOR UPDATE OF c LOOP
    UPDATE public.portal_cobrancas
       SET situacao = 'aguardando_envio', texto_aprovado = NULL, erro = NULL, atualizado_em = now()
     WHERE id = _r.id;
    _n := _n + public.ludmilla_cobranca_abrir_afazer(_r.id);
  END LOOP;

  -- 4. esperando a equipe, sem aprovação e sem A fazer aberto (alguém o fechou pela RPC
  --    genérica de "Feito"): reabre. Só Enviar ou Dispensar decidem uma cobrança.
  FOR _r IN SELECT c.id FROM public.portal_cobrancas c
              JOIN public.portal_accounts a ON a.id = c.account_id AND a.enabled
             WHERE c.situacao = 'aguardando_envio' AND c.aprovada_por IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.portal_afazeres f WHERE f.cobranca_id = c.id AND f.feito_em IS NULL) LOOP
    _n := _n + public.ludmilla_cobranca_abrir_afazer(_r.id);
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobrancas_abrir_vencidas() FROM PUBLIC, anon, authenticated, service_role;

-- ── 5d. A equipe: o clique em "Enviar" e em "Dispensar" ─────────────────────
-- "Enviar": confere TUDO de novo (o front pode ser contornado), grava quem aprovou e o
-- texto, e põe o envio na fila do robô. Uma aprovação = uma tentativa de envio.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_aprovar(p_cobranca_id UUID, p_texto TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid UUID := (SELECT auth.uid()); _tenant UUID; _c public.portal_cobrancas%ROWTYPE;
  _texto TEXT := btrim(coalesce(p_texto, '')); _run UUID; _quem TEXT; _lacuna TEXT;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  _tenant := public.get_user_tenant_id(_uid);
  SELECT * INTO _c FROM public.portal_cobrancas WHERE id = p_cobranca_id AND tenant_id = _tenant FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
  IF _c.situacao <> 'aguardando_envio' THEN
    RAISE EXCEPTION 'Esta cobrança não está esperando envio (situação: %).', _c.situacao;
  END IF;
  IF _c.aprovada_por IS NOT NULL THEN
    SELECT name INTO _quem FROM public.profiles WHERE id = _c.aprovada_por;
    RAISE EXCEPTION 'Esta cobrança já foi aprovada por % e está saindo.', coalesce(_quem, 'alguém da equipe');
  END IF;
  IF NOT public.ludmilla_endereco_da_enel(_c.para) THEN
    RAISE EXCEPTION 'O destinatário não é um endereço da ENEL: nada foi enviado.';
  END IF;
  IF _c.ultima_enviada_em IS NOT NULL AND _c.ultima_enviada_em > now() - interval '7 days' THEN
    RAISE EXCEPTION 'Já saiu uma cobrança desta nota em %: a próxima só depois de 7 dias.',
      to_char(_c.ultima_enviada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  END IF;
  IF length(_texto) < 20 OR length(_texto) > 5000 THEN
    RAISE EXCEPTION 'O texto do e-mail precisa ter entre 20 e 5000 caracteres.';
  END IF;
  -- as lacunas do modelo (src/lib/ludmillaCobranca.ts, LACUNAS; um teste confere as duas listas)
  FOREACH _lacuna IN ARRAY ARRAY['[NÚMERO DA NOTA]', '[UC]', '[TITULAR]', '[NT]'] LOOP
    IF strpos(_texto, _lacuna) > 0 THEN RAISE EXCEPTION 'Complete no texto: %.', _lacuna; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _c.project_id AND NOT p.is_deleted
                   AND p.archived_at IS NULL AND p.status::text <> 'completed') THEN
    RAISE EXCEPTION 'O projeto foi concluído ou arquivado: a cobrança não sai.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_accounts a WHERE a.id = _c.account_id AND a.enabled) THEN
    RAISE EXCEPTION 'A conta da ENEL está desligada na Ludmilla.';
  END IF;

  INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo, pedido_por, dados)
  VALUES (_c.tenant_id, _c.account_id, 'enviar_cobranca', _uid, jsonb_build_object('cobranca_id', _c.id))
  RETURNING id INTO _run;

  UPDATE public.portal_cobrancas
     SET aprovada_por = _uid, aprovada_em = now(), texto_aprovado = _texto, run_id = _run, erro = NULL, atualizado_em = now()
   WHERE id = _c.id;
  PERFORM public.ludmilla_cobranca_fechar_afazer(_c.id, _uid);
  RETURN _run;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_aprovar(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_aprovar(UUID, TEXT) TO authenticated;

-- "Dispensar": encerra a cobrança daquela nota, sem novas. false = já estava decidida.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_dispensar(p_cobranca_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (SELECT auth.uid()); _tenant UUID; _c public.portal_cobrancas%ROWTYPE;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  _tenant := public.get_user_tenant_id(_uid);
  SELECT * INTO _c FROM public.portal_cobrancas WHERE id = p_cobranca_id AND tenant_id = _tenant FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
  IF _c.situacao IN ('dispensada', 'encerrada') THEN RETURN FALSE; END IF;
  IF _c.situacao = 'enviando' THEN RAISE EXCEPTION 'O envio desta cobrança já começou.'; END IF;
  UPDATE public.portal_cobrancas
     SET situacao = 'dispensada', encerrada_por = _uid, motivo_encerramento = 'dispensada pela equipe', atualizado_em = now()
   WHERE id = _c.id;
  PERFORM public.ludmilla_cobranca_fechar_afazer(_c.id, _uid);
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_dispensar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_dispensar(UUID) TO authenticated;

-- ── 5e. O robô envia ────────────────────────────────────────────────────────
-- SEMPRE uma linha. `recusa` nula = pode enviar, e a cobrança JÁ está `enviando` (o robô
-- a pegou: um segundo pedido com o mesmo run é recusado). Só o run que a APROVAÇÃO criou
-- (`portal_cobrancas.run_id`) serve.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_iniciar_envio(p_run_id UUID)
RETURNS TABLE (recusa TEXT, cobranca_id UUID, situacao_anterior TEXT, aprovada_por UUID,
               ultima_enviada_em TIMESTAMPTZ, para TEXT, assunto TEXT, texto TEXT,
               in_reply_to TEXT, referencias TEXT, nota_servico TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE _r public.portal_sync_runs%ROWTYPE; _c public.portal_cobrancas%ROWTYPE; _id UUID; _recusa TEXT;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô envia cobranças';
  END IF;
  SELECT * INTO _r FROM public.portal_sync_runs s WHERE s.id = p_run_id;
  IF _r.id IS NULL OR _r.tipo <> 'enviar_cobranca' OR _r.situacao <> 'rodando' THEN
    _recusa := 'este run não é um envio de cobrança em andamento';
  ELSE
    BEGIN
      _id := (_r.dados ->> 'cobranca_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      _id := NULL;
    END;
    SELECT * INTO _c FROM public.portal_cobrancas c WHERE c.id = _id AND c.account_id = _r.account_id FOR UPDATE;
    _recusa := CASE
      WHEN _c.id IS NULL THEN 'a cobrança deste run não existe'
      WHEN _c.run_id IS DISTINCT FROM p_run_id THEN 'este pedido de envio não veio da aprovação da cobrança'
      WHEN _c.situacao <> 'aguardando_envio' THEN 'a cobrança não está esperando envio (situação: ' || _c.situacao || ')'
      WHEN _c.aprovada_por IS NULL OR _c.texto_aprovado IS NULL THEN 'a cobrança não foi aprovada por uma pessoa da equipe'
      WHEN NOT public.ludmilla_endereco_da_enel(_c.para) THEN 'o destinatário não é um endereço da ENEL'
      WHEN _c.ultima_enviada_em IS NOT NULL AND _c.ultima_enviada_em > now() - interval '7 days'
        THEN 'já saiu uma cobrança desta nota há menos de 7 dias'
      WHEN NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _c.project_id AND NOT p.is_deleted
                         AND p.archived_at IS NULL AND p.status::text <> 'completed')
        THEN 'o projeto foi concluído ou arquivado'
    END;
  END IF;
  IF _recusa IS NOT NULL THEN
    RETURN QUERY SELECT _recusa, _c.id, _c.situacao, NULL::uuid, NULL::timestamptz,
                        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  UPDATE public.portal_cobrancas c SET situacao = 'enviando', atualizado_em = now() WHERE c.id = _c.id;
  RETURN QUERY SELECT NULL::text, _c.id, 'aguardando_envio'::text, _c.aprovada_por, _c.ultima_enviada_em,
                      _c.para, _c.assunto, _c.texto_aprovado, _c.in_reply_to, _c.referencias, _c.nota_servico;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_iniciar_envio(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_iniciar_envio(UUID) TO service_role;

-- Saiu: histórico (a pessoa que aprovou é a autora), comentário no card (assinado pela
-- Ludmilla), a próxima em 7 dias, e o run fechado.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_enviada(p_run_id UUID, p_message_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _c public.portal_cobrancas%ROWTYPE; _nome TEXT; _nota TEXT;
  _ludmilla CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra o envio';
  END IF;
  SELECT * INTO _c FROM public.portal_cobrancas c WHERE c.run_id = p_run_id AND c.situacao = 'enviando' FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'nenhuma cobrança em envio para o run %', p_run_id; END IF;
  SELECT pr.name INTO _nome FROM public.profiles pr WHERE pr.id = _c.aprovada_por;
  _nota := coalesce(_c.nota_servico, 'sem número');

  UPDATE public.portal_cobrancas
     SET situacao = 'agendada', enviadas = _c.enviadas + 1, ultima_enviada_em = now(),
         ultimo_texto_enviado = _c.texto_aprovado, vence_em = now() + interval '7 days',
         aprovada_por = NULL, aprovada_em = NULL, texto_aprovado = NULL, erro = NULL, atualizado_em = now()
   WHERE id = _c.id;

  IF _c.project_id IS NOT NULL THEN
    INSERT INTO public.comments (project_id, user_id, message, type)
    VALUES (_c.project_id, _ludmilla,
            '📡 Ludmilla: cobrança da nota ' || _nota || ' enviada à ENEL (' || _c.para || '), aprovada por '
            || coalesce(_nome, 'alguém da equipe') || '.',
            'comment');
    INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
    VALUES (_c.project_id, 'Cobrança enviada à ENEL',
            'Cobrança da nota ' || _nota || ' enviada à ENEL; aprovada por ' || coalesce(_nome, 'alguém da equipe') || '.',
            coalesce(_c.aprovada_por, _ludmilla), coalesce(_nome, 'Ludmilla'));
  END IF;

  UPDATE public.portal_sync_runs
     SET situacao = 'ok', terminado_em = now(), erro = NULL,
         resultado = jsonb_build_object('cobranca_id', _c.id, 'nota', _c.nota_servico, 'para', _c.para,
                                        'enviada', _c.enviadas + 1, 'message_id', left(p_message_id, 300))
   WHERE id = p_run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_enviada(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_enviada(UUID, TEXT) TO service_role;

-- Não saiu (ou foi recusada): fecha o run com erro e, se a cobrança é DESTE run, devolve
-- à equipe sem a aprovação (o texto fica como rascunho) e com um A fazer dizendo por quê.
-- Não tenta de novo sozinha.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_falhou(p_run_id UUID, p_erro TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _c public.portal_cobrancas%ROWTYPE; _erro TEXT := left(coalesce(nullif(btrim(p_erro), ''), 'falha sem detalhe'), 500);
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra a falha do envio';
  END IF;
  UPDATE public.portal_sync_runs SET situacao = 'erro', terminado_em = now(), erro = _erro
   WHERE id = p_run_id AND tipo = 'enviar_cobranca' AND situacao IN ('na_fila', 'rodando');
  SELECT * INTO _c FROM public.portal_cobrancas c
   WHERE c.run_id = p_run_id AND c.situacao IN ('enviando', 'aguardando_envio') FOR UPDATE;
  IF _c.id IS NULL THEN RETURN; END IF;
  UPDATE public.portal_cobrancas
     SET situacao = 'aguardando_envio', aprovada_por = NULL, aprovada_em = NULL, erro = _erro, atualizado_em = now()
   WHERE id = _c.id;
  PERFORM public.ludmilla_cobranca_abrir_afazer(_c.id,
    '📡 A cobrança da nota ' || coalesce(_c.nota_servico, 'sem número') || ' não saiu',
    'O envio falhou: ' || _erro || '. Confira a pasta Enviados do Gmail antes de enviar de novo.');
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_falhou(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_falhou(UUID, TEXT) TO service_role;

-- ── 6. Registro: o run de envio com nome próprio ────────────────────────────
-- Corpo de 20261005130000 (= prosrc vivo, md5 ff561bfc0a7abff9803c2b7ca2893f0c),
-- com DUAS linhas novas, marcadas NOVO. Assinatura, retorno, STABLE, SECURITY
-- DEFINER, search_path, REVOKE, GRANT e COMMENT iguais.
CREATE OR REPLACE FUNCTION public.ludmilla_registro(p_limite INTEGER DEFAULT 120, p_ator TEXT DEFAULT NULL)
RETURNS TABLE (
  quando TIMESTAMPTZ, ator TEXT, quem TEXT, acao TEXT, titulo TEXT, detalhe TEXT,
  situacao TEXT, project_id UUID, projeto TEXT, protocolo TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _tenant UUID;
BEGIN
  IF NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  _tenant := public.get_user_tenant_id((select auth.uid()));

  RETURN QUERY
  WITH portais AS (
    SELECT a.id, coalesce(c.name, upper(a.connector)) AS nome
      FROM public.portal_accounts a
      LEFT JOIN public.energy_concessionaires c ON c.id = a.concessionaire_id
     WHERE a.tenant_id = _tenant
  ),
  eventos AS (
    -- visitas ao portal (e, desde out/2026, leituras da caixa de e-mail)
    SELECT coalesce(r.terminado_em, r.iniciado_em, r.pedido_em) AS quando,
           'ludmilla'::text AS ator,
           coalesce(p.name, 'agendamento') AS quem,
           'visita'::text AS acao,
           CASE r.tipo
             WHEN 'varredura' THEN 'Varredura no portal ' || po.nome
             WHEN 'varredura_email' THEN 'Leitura dos e-mails da ' || po.nome
             WHEN 'enviar_cobranca' THEN 'Cobrança à ' || po.nome || ' (troca do relógio)' -- NOVO (24/10/2026)
             WHEN 'criar_projeto' THEN 'Criação de projeto no portal ' || po.nome
             WHEN 'teste_login' THEN 'Teste de acesso ao portal ' || po.nome
             WHEN 'descoberta' THEN 'Descoberta das telas do portal ' || po.nome
             ELSE 'Reconhecimento da tela do portal ' || po.nome END AS titulo,
           CASE WHEN r.situacao = 'erro' THEN r.erro
                WHEN r.tipo = 'varredura' THEN r.protocolos_lidos || ' protocolos lidos · ' || r.mudancas || ' recomendação(ões)'
                WHEN r.tipo = 'varredura_email' THEN r.protocolos_lidos || ' projetos conferidos · ' || r.mudancas || ' documento(s) anexado(s)'
                  -- protocolo cuja busca o servidor recusou: sai da frase quando
                  -- é zero (nullif), e some de vez em run antigo sem o campo
                  || coalesce(' · ' || nullif(r.resultado ->> 'falhas', '0') || ' com falha', '')
                WHEN r.tipo = 'enviar_cobranca' THEN 'nota ' || coalesce(r.resultado ->> 'nota', 'sem número') || coalesce(' para ' || (r.resultado ->> 'para'), '') -- NOVO (24/10/2026)
                ELSE 'Situação: ' || r.situacao END AS detalhe,
           CASE WHEN r.situacao = 'erro' THEN 'erro' WHEN r.situacao = 'ok' THEN 'ok' ELSE 'aviso' END AS situacao,
           NULL::uuid AS project_id, NULL::text AS projeto, NULL::text AS protocolo
      FROM public.portal_sync_runs r
      JOIN portais po ON po.id = r.account_id
      LEFT JOIN public.profiles p ON p.id = r.pedido_por
     WHERE r.tenant_id = _tenant AND r.situacao IN ('ok', 'erro')

    UNION ALL
    -- recomendações que ela levantou
    SELECT u.detectado_em, 'ludmilla', 'Ludmilla', 'recomendacao',
           'Mudança no portal: ' || u.status_portal,
           'Protocolo ' || u.protocolo || coalesce(' · ' || u.titular_portal, '')
             || coalesce(' · sugere ' || u.recomendacao, ' · sem etapa sugerida')
             || CASE WHEN u.casamento IS NOT NULL AND u.casamento <> 'protocolo' THEN ' · casado por ' || u.casamento ELSE '' END,
           CASE WHEN u.project_id IS NULL THEN 'aviso' ELSE 'ok' END,
           u.project_id, pr.code, u.protocolo
      FROM public.portal_updates u
      LEFT JOIN public.projects pr ON pr.id = u.project_id
     WHERE u.tenant_id = _tenant

    UNION ALL
    -- o que a equipe decidiu sobre cada recomendação
    SELECT u.aplicada_em, 'equipe', coalesce(p.name, 'equipe'),
           CASE WHEN u.situacao = 'aplicada' THEN 'aplicada' ELSE 'ignorada' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'Recomendação aplicada' ELSE 'Recomendação ignorada' END,
           'Protocolo ' || u.protocolo || coalesce(' · ' || pr.code, '')
             || CASE WHEN u.situacao = 'aplicada' THEN coalesce(' → ' || u.recomendacao, '') ELSE '' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'ok' ELSE 'aviso' END,
           u.project_id, pr.code, u.protocolo
      FROM public.portal_updates u
      LEFT JOIN public.projects pr ON pr.id = u.project_id
      LEFT JOIN public.profiles p ON p.id = u.aplicada_por
     WHERE u.tenant_id = _tenant AND u.situacao IN ('aplicada', 'ignorada') AND u.aplicada_em IS NOT NULL

    UNION ALL
    -- anexos que ela trouxe do portal para o card
    SELECT coalesce(x.enviado_em, x.created_at), 'ludmilla', 'Ludmilla', 'anexo',
           CASE x.situacao WHEN 'enviado' THEN 'Anexo da concessionária no card'
                           WHEN 'bloqueado' THEN 'Anexo bloqueado (titular/UC não conferem)'
                           WHEN 'erro' THEN 'Anexo falhou' ELSE 'Anexo pendente' END,
           x.nome_arquivo || ' · protocolo ' || x.protocolo || coalesce(' · ' || x.motivo, '')
             || coalesce(' · conferido por ' || x.conferido_por, ''),
           CASE x.situacao WHEN 'enviado' THEN 'ok' WHEN 'erro' THEN 'erro' ELSE 'aviso' END,
           x.project_id, pr.code, x.protocolo
      FROM public.portal_anexos x
      LEFT JOIN public.projects pr ON pr.id = x.project_id
     WHERE x.tenant_id = _tenant

    UNION ALL
    -- pareceres do portal virando comentário no card
    SELECT pa.created_at, 'ludmilla', 'Ludmilla', 'parecer',
           'Parecer da concessionária no card',
           coalesce(pa.analise || ' · ', '') || coalesce(pa.status, '') || ' · protocolo ' || pa.protocolo,
           'ok', pa.project_id, pr.code, pa.protocolo
      FROM public.portal_pareceres pa
      LEFT JOIN public.projects pr ON pr.id = pa.project_id
     WHERE pa.tenant_id = _tenant

    UNION ALL
    -- código da imagem: ela pediu
    SELECT ca.criado_em, 'ludmilla', 'Ludmilla', 'captcha_pedido',
           'Pediu o código da imagem (' || po.nome || ')',
           'Tentativa ' || ca.tentativa || coalesce(' · ' || ca.mensagem, '') || ' · ' || ca.situacao,
           CASE ca.situacao WHEN 'usado' THEN 'ok' WHEN 'expirado' THEN 'erro' ELSE 'aviso' END,
           NULL::uuid, NULL::text, NULL::text
      FROM public.portal_captchas ca
      JOIN portais po ON po.id = ca.account_id
     WHERE ca.tenant_id = _tenant

    UNION ALL
    -- código da imagem: alguém respondeu
    SELECT ca.respondido_em, 'equipe', coalesce(p.name, 'equipe'), 'captcha_respondido',
           'Código da imagem respondido (' || po.nome || ')',
           'Tentativa ' || ca.tentativa, 'ok', NULL::uuid, NULL::text, NULL::text
      FROM public.portal_captchas ca
      JOIN portais po ON po.id = ca.account_id
      LEFT JOIN public.profiles p ON p.id = ca.respondido_por
     WHERE ca.tenant_id = _tenant AND ca.respondido_em IS NOT NULL

    UNION ALL
    -- tarefas encerradas porque o projeto mudou de etapa
    SELECT k.completed_at,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'ludmilla' ELSE 'equipe' END,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'Ludmilla' ELSE coalesce(p.name, 'equipe') END,
           'tarefa_encerrada', 'Tarefa encerrada: ' || k.title,
           regexp_replace(split_part(k.description, '✅ ', 2), E'\\s+', ' ', 'g'),
           'ok', k.project_id, pr.code, NULL::text
      FROM public.tasks k
      LEFT JOIN public.projects pr ON pr.id = k.project_id
      LEFT JOIN public.profiles p ON p.id = k.completed_by
     WHERE k.tenant_id = _tenant AND k.status = 'completed' AND k.completed_at IS NOT NULL
       AND k.description LIKE '%✅ Encerrada%'
  )
  SELECT e.quando, e.ator, e.quem, e.acao, e.titulo, e.detalhe, e.situacao, e.project_id, e.projeto, e.protocolo
    FROM eventos e
   WHERE e.quando IS NOT NULL
     AND (p_ator IS NULL OR e.ator = p_ator)
   ORDER BY e.quando DESC
   LIMIT greatest(1, least(coalesce(p_limite, 120), 500));
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_registro(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_registro(INTEGER, TEXT) TO authenticated;
COMMENT ON FUNCTION public.ludmilla_registro(INTEGER, TEXT) IS
  'Registro da Ludmilla: leitura unificada de visitas (portal e e-mail), recomendações, decisões da equipe, anexos, pareceres, códigos de imagem e tarefas encerradas.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 5: Conferir que o Registro só ganhou as duas linhas**

```bash
diff <(sed -n '78,221p' supabase/migrations/20261005130000_ludmilla_email_run.sql) \
     <(awk '/^CREATE OR REPLACE FUNCTION public.ludmilla_registro/,/^  .Registro da Ludmilla: leitura unificada/' \
           supabase/migrations/20261024150000_ludmilla_cobranca_troca.sql)
```

Expected: exatamente duas linhas `>`, as duas com `-- NOVO (24/10/2026)` e `enviar_cobranca`, e nenhuma linha `<`.

- [ ] **Step 6: Aplicar e rodar a prova (verde)**

Run: `npx -y supabase db query --linked -f supabase/migrations/20261024150000_ludmilla_cobranca_troca.sql`
Expected: sem erro.

Run: `npx -y supabase db query --linked -f "$RASCUNHO/prova_cobranca.sql"`
Expected: todas as linhas com `ok = true` (conte as `false`: zero). Linha `false` = defeito na migração: corrija o arquivo, aplique de novo (é tudo `CREATE OR REPLACE`/`IF NOT EXISTS`/`DROP … IF EXISTS`) e rode a prova outra vez.

- [ ] **Step 7: Mutação da trava do destinatário no banco**

Escreva `$RASCUNHO/prova_mutacao_trava.sql`:

```sql
-- MUTAÇÃO: enfraquece a trava SÓ nesta transação e tenta gravar destinatários de fora.
-- Esperado: acusou = 3 (com a trava fraca eles passariam; a prova do Step 3 os pega).
begin;
create or replace function public.ludmilla_endereco_da_enel(p_endereco text)
returns boolean language sql immutable set search_path = '' as $$ select p_endereco is not null $$;
create temp table _m (endereco text, passou boolean);
do $$
declare _e text;
begin
  foreach _e in array array['canalgd.sp@br.enel.com.exemplo.test', 'x@enel.com.br', 'x@evil.enel.com'] loop
    begin
      insert into public.portal_cobrancas (tenant_id, account_id, data_nota, para, assunto, vence_em)
      select a.tenant_id, a.id, now(), _e, 'RE: MUTAÇÃO', now() + interval '30 days'
        from public.portal_accounts a where a.connector = 'enel' limit 1;
      insert into _m values (_e, true);
    exception when check_violation then
      insert into _m values (_e, false);
    end;
  end loop;
end $$;
select count(*) filter (where passou) as acusou, string_agg(endereco, ', ') filter (where passou) as passaram from _m;
rollback;
```

Run: `npx -y supabase db query --linked -f "$RASCUNHO/prova_mutacao_trava.sql"`
Expected: `acusou = 3`. Depois, confirme que a função de verdade voltou: `select public.ludmilla_endereco_da_enel('x@enel.com.br')` → `false`.

- [ ] **Step 8: Commit**

Escreva `$RASCUNHO/msg-t1.txt` (com a ferramenta Write):

```text
feat(ludmilla): cobranças da troca do relógio na ENEL no banco

Tabela portal_cobrancas (uma por nota de serviço, escrita só por RPC,
leitura só da equipe), trava do destinatário @enel.com/@br.enel.com
também no banco, A fazer cobrar_troca, run enviar_cobranca e as RPCs
do robô (agendar, encerrar pela troca, iniciar envio, enviada, falhou)
e da equipe (aprovar = o clique em Enviar, dispensar). O Registro ganha
o rótulo do envio. Nada sai sem clique; no máximo 1 envio por nota a
cada 7 dias. Agendador da CPFL intacto (md5 3d0d2d0f…).

Co-Authored-By: <o modelo que executou> <noreply@anthropic.com>
```

```bash
git add supabase/migrations/20261024150000_ludmilla_cobranca_troca.sql
git commit -F "$RASCUNHO/msg-t1.txt" -- supabase/migrations/20261024150000_ludmilla_cobranca_troca.sql
git show --stat HEAD
```

Expected: o commit tem SÓ esse arquivo.

---

### Task 2: Banco — a leitura da ENEL de hora em hora (função nova; o cron fica escrito, não aplicado)

**Files:**
- Create: `supabase/migrations/20261024160000_ludmilla_enel_agendada.sql`
- Create (NÃO aplicar nesta tarefa): `supabase/migrations/20261024170000_ludmilla_enel_cron.sql`
- Test: `$RASCUNHO/prova_agendar_email.sql`

**Interfaces:**
- Consumes: `portal_accounts (enabled, acompanhamento, identificacao, modo)`, `portal_sync_runs`; `public.ludmilla_cobrancas_abrir_vencidas()` (Task 1).
- Produces:
  - `public.ludmilla_agendar_email() RETURNS integer` — quantas leituras enfileirou; só `postgres` (o cron) chama.
  - o arquivo do cron (aplicado na Task 10): jobs `ludmilla-enel-email` (`0 11-21 * * 1-5` → `ludmilla_agendar_email()`) e `ludmilla-cobrancas` (`5 11-21 * * 1-5` → `ludmilla_cobrancas_abrir_vencidas()`).

- [ ] **Step 1: Medir a CPFL antes**

Escreva `$RASCUNHO/cpfl_agora.sql`:

```sql
select (select md5(prosrc) from pg_proc where proname = 'ludmilla_agendar_varreduras') as md5_cpfl,
       (select json_agg(json_build_object('j', jobname, 's', schedule, 'c', command) order by jobname)
          from cron.job where jobname like 'ludmilla%') as crons;
```

Run: `npx -y supabase db query --linked -f "$RASCUNHO/cpfl_agora.sql"`
Expected: `md5_cpfl = 3d0d2d0f1e7455ec701230bc925e1bde`; `crons` = só `ludmilla-08h` (`0 11 * * *`) e `ludmilla-17h` (`0 20 * * *`), os dois com ` SELECT public.ludmilla_agendar_varreduras(); `. Guarde a saída em `$RASCUNHO/cpfl_antes.out` para comparar.

- [ ] **Step 2: Escrever a prova e rodar vermelho**

Escreva `$RASCUNHO/prova_agendar_email.sql`:

```sql
-- PROVA da 20261024160000 — transação DESFEITA. Esperado: todas as linhas ok = true.
begin;
do $$ begin
  if to_regprocedure('public.ludmilla_agendar_email()') is null then
    raise exception 'VERMELHO: ludmilla_agendar_email() ainda não existe';
  end if;
end $$;

create temp table _prova (em timestamptz default clock_timestamp(), passo text, ok boolean, detalhe text);
grant insert, select on _prova to authenticated;

-- quem deveria receber leitura agora: e-mail, por remetente, ligada, não-estação, sem run aberto
create temp table _elegiveis as
select a.id from public.portal_accounts a
 where a.enabled and a.acompanhamento = 'email' and a.identificacao = 'remetente' and coalesce(a.modo, 'vps') <> 'local'
   and not exists (select 1 from public.portal_sync_runs r where r.account_id = a.id and r.situacao in ('na_fila', 'rodando'));

insert into _prova (passo, ok, detalhe)
select '1ª chamada enfileira uma leitura por conta elegível', n = (select count(*) from _elegiveis), n::text
from (select public.ludmilla_agendar_email() as n) x;
insert into _prova (passo, ok, detalhe)
select 'as leituras novas são varredura_email, sem pedido_por, só nas elegíveis',
       count(*) = (select count(*) from _elegiveis)
       and bool_and(r.tipo = 'varredura_email' and r.pedido_por is null and r.account_id in (select id from _elegiveis)),
       count(*)::text
from public.portal_sync_runs r where r.pedido_em = now();
insert into _prova (passo, ok, detalhe)
select 'a EDP (protocolo no assunto) não recebe leitura agendada', count(*) = 0, count(*)::text
from public.portal_sync_runs r join public.portal_accounts a on a.id = r.account_id
where r.pedido_em = now() and a.identificacao = 'protocolo_no_assunto';
insert into _prova (passo, ok, detalhe)
select 'portal (CPFL, Elektro) não recebe nada', count(*) = 0, count(*)::text
from public.portal_sync_runs r join public.portal_accounts a on a.id = r.account_id
where r.pedido_em = now() and a.acompanhamento = 'portal';
insert into _prova (passo, ok, detalhe)
select '2ª chamada não empilha', n = 0, n::text from (select public.ludmilla_agendar_email() as n) x;

-- quem não é o cron não chama
select set_config('request.jwt.claims', json_build_object(
  'sub', (select p.id from public.profiles p join public.tenants t on t.id = p.tenant_id
           where t.is_library and p.role = 'staff' and p.active order by p.id limit 1),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.ludmilla_agendar_email();
    insert into _prova (passo, ok, detalhe) values ('a equipe não chama o agendador', false, 'a função aceitou');
  exception when insufficient_privilege then
    insert into _prova (passo, ok, detalhe) values ('a equipe não chama o agendador', true, sqlerrm);
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

insert into _prova (passo, ok, detalhe)
select 'agendador da CPFL intacto (md5)', md5(prosrc) = '3d0d2d0f1e7455ec701230bc925e1bde', md5(prosrc)
from pg_proc where proname = 'ludmilla_agendar_varreduras';
insert into _prova (passo, ok, detalhe)
select 'crons da CPFL intactos e nenhum cron novo ainda',
       count(*) = 2 and bool_and((jobname = 'ludmilla-08h' and schedule = '0 11 * * *')
                                 or (jobname = 'ludmilla-17h' and schedule = '0 20 * * *')),
       string_agg(jobname || ' ' || schedule, ', ')
from cron.job where jobname like 'ludmilla%';

select passo, ok, detalhe from _prova order by em;
rollback;
```

Run: `npx -y supabase db query --linked -f "$RASCUNHO/prova_agendar_email.sql"`
Expected: FALHA com `VERMELHO: ludmilla_agendar_email() ainda não existe`.

- [ ] **Step 3: Escrever a migração da função**

Crie `supabase/migrations/20261024160000_ludmilla_enel_agendada.sql`:

```sql
-- ============================================================================
-- LUDMILLA — a leitura da ENEL fica automática (24/10/2026)
-- Spec: docs/superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md §3.1
--
-- Função NOVA, ao lado do agendador da CPFL. `ludmilla_agendar_varreduras` NÃO muda
-- (md5 do prosrc 3d0d2d0f1e7455ec701230bc925e1bde antes e depois): ela só enfileira
-- conta com login e secret_id, e é essa "proteção acidental" que mantém a varredura de
-- PORTAL longe das contas de e-mail (docs/modules/integrations/ludmilla.md).
--
-- Esta enfileira `varredura_email` para conta de e-mail que parte do REMETENTE (hoje só
-- a ENEL), ligada, fora da estação local, sem run aberto. A EDP (protocolo no assunto)
-- continua manual: o primeiro run dela ainda está pendente.
--
-- O cron entra em OUTRO arquivo (20261024170000), aplicado só depois de o robô e a tela
-- da cobrança estarem no ar.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ludmilla_agendar_email()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _a RECORD;
BEGIN
  FOR _a IN SELECT a.id, a.tenant_id FROM public.portal_accounts a
             WHERE a.enabled AND a.acompanhamento = 'email' AND a.identificacao = 'remetente'
               AND coalesce(a.modo, 'vps') <> 'local' LOOP
    IF NOT EXISTS (SELECT 1 FROM public.portal_sync_runs r
                    WHERE r.account_id = _a.id AND r.situacao IN ('na_fila', 'rodando')) THEN
      INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo) VALUES (_a.tenant_id, _a.id, 'varredura_email');
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_agendar_email() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.ludmilla_agendar_email() IS
  'Enfileira varredura_email para as contas de e-mail por remetente (ENEL), ligadas, fora da estação local e sem run aberto. Chamada pelo cron ludmilla-enel-email (seg–sex, 8h–18h de Brasília). Não é o agendador da CPFL.';
```

- [ ] **Step 4: Escrever (e NÃO aplicar) a migração do cron**

Crie `supabase/migrations/20261024170000_ludmilla_enel_cron.sql`:

```sql
-- ============================================================================
-- LUDMILLA — os crons da ENEL (24/10/2026). APLICAR SÓ NA TASK 10 do plano
-- docs/superpowers/plans/2026-10-24-ludmilla-enel-cobranca-troca.md, depois de o robô
-- (enviar_cobranca) e a tela (Enviar/Dispensar) estarem no ar.
--
-- Seg–sex, das 8h às 18h de Brasília = 11h–21h UTC (sem horário de verão desde 2019).
--   ludmilla-enel-email  :00 → lê a caixa da ENEL (ludmilla_agendar_email)
--   ludmilla-cobrancas   :05 → abre o A fazer das cobranças vencidas
-- Os crons da CPFL (ludmilla-08h, ludmilla-17h) NÃO são tocados.
-- Desligar: SELECT cron.unschedule('ludmilla-enel-email'); SELECT cron.unschedule('ludmilla-cobrancas');
-- ============================================================================
SELECT cron.unschedule('ludmilla-enel-email') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ludmilla-enel-email');
SELECT cron.unschedule('ludmilla-cobrancas') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ludmilla-cobrancas');
SELECT cron.schedule('ludmilla-enel-email', '0 11-21 * * 1-5', $cron$ SELECT public.ludmilla_agendar_email(); $cron$);
SELECT cron.schedule('ludmilla-cobrancas', '5 11-21 * * 1-5', $cron$ SELECT public.ludmilla_cobrancas_abrir_vencidas(); $cron$);
```

- [ ] **Step 5: Aplicar a função e rodar a prova (verde)**

Run: `npx -y supabase db query --linked -f supabase/migrations/20261024160000_ludmilla_enel_agendada.sql`
Run: `npx -y supabase db query --linked -f "$RASCUNHO/prova_agendar_email.sql"`
Expected: todas as linhas `ok = true` (a 1ª chamada devolve o número de contas elegíveis — 1, a ENEL, se ela não tiver run aberto; e a prova desfaz tudo).

- [ ] **Step 6: Provar que a CPFL ficou intacta**

Run: `npx -y supabase db query --linked -f "$RASCUNHO/cpfl_agora.sql"`
Expected: a MESMA saída de `$RASCUNHO/cpfl_antes.out` (md5 `3d0d2d0f1e7455ec701230bc925e1bde`, os dois crons de sempre, nenhum cron novo).

- [ ] **Step 7: Commit**

Escreva `$RASCUNHO/msg-t2.txt`:

```text
feat(ludmilla): leitura da ENEL agendada (função nova, cron à parte)

ludmilla_agendar_email() enfileira varredura_email para a conta de
e-mail por remetente (ENEL), ligada, fora da estação e sem run aberto.
O cron (seg–sex, 8h–18h de Brasília, mais o das cobranças vencidas às
:05) fica no arquivo 20261024170000, aplicado só depois de o robô e a
tela da cobrança estarem no ar. Agendador da CPFL intacto (md5
3d0d2d0f… antes e depois); EDP continua manual.

Co-Authored-By: <o modelo que executou> <noreply@anthropic.com>
```

```bash
git add supabase/migrations/20261024160000_ludmilla_enel_agendada.sql supabase/migrations/20261024170000_ludmilla_enel_cron.sql
git commit -F "$RASCUNHO/msg-t2.txt" -- supabase/migrations/20261024160000_ludmilla_enel_agendada.sql supabase/migrations/20261024170000_ludmilla_enel_cron.sql
git show --stat HEAD
```

---

### Task 3: Worker — a lógica pura da cobrança (nota, travas, resposta, saudação)

**Files:**
- Modify: `worker/ludmilla/src/email/enel/classificar.ts` (exportar `textoNovo`; `classificarCorpo` passa a usá-lo — mesmo comportamento)
- Create: `worker/ludmilla/src/email/enel/cobranca.ts`
- Test: `worker/ludmilla/test/enel-cobranca.test.ts`

**Interfaces:**
- Consumes: `semAcento` (`../util.js`); `Classificacao`, `semCitacao` e a decodificação de entidades (`./classificar.js`); `MensagemLida` (`../caixa.js`, só o tipo; o campo `referencias` entra na Task 4 e aqui é lido como opcional); a forma da "troca realizada" entregue pela frente anterior.
- Produces (em `email/enel/cobranca.ts`):
  - `DIAS_ENTRE_COBRANCAS = 7`; `REGEX_DESTINATARIO_ENEL: RegExp`; `MAX_REFERENCIAS = 20`.
  - `notaDeServico(corpo: string | null | undefined): string | null`
  - `enderecoDoRemetente(remetente: string | null | undefined): string | null`
  - `destinatarioDaEnel(endereco: string | null | undefined): boolean`
  - `assuntoDaResposta(assunto: string | null | undefined): string`
  - `cabecalhosDaResposta(messageId: string, referencias?: readonly string[]): { inReplyTo: string | null; referencias: string[] }`
  - `vencimento(base: Date): Date`; `dataBr(d: Date | string): string`; `horaEmBrasilia(agora: Date): number`; `saudacaoNaHora(agora: Date): 'bom dia' | 'boa tarde'`; `ajustarSaudacao(texto: string, agora: Date): string`
  - `interface DadosDaCobranca { nota: string | null; dataNota: string; prazoDias: number | null; para: string; assunto: string; inReplyTo: string | null; referencias: string[] }`
  - `type NotaDaMensagem = { tipo: 'nenhuma' } | { tipo: 'fora_da_enel' } | { tipo: 'nota'; dados: DadosDaCobranca }`
  - `cobrancaDaMensagem(c: Classificacao, m: Pick<MensagemLida, 'messageId' | 'assunto' | 'remetente' | 'recebidoEm' | 'texto'> & { referencias?: string[] }, agora: Date): NotaDaMensagem`
  - `trocaFoiRealizada(c: Classificacao): boolean`
  - `interface EstadoDoEnvio { situacaoAnterior: string | null; aprovadaPor: string | null; ultimaEnviadaEm: string | null; para: string | null; texto: string | null }` e `podeEnviar(c: EstadoDoEnvio, agora: Date): { ok: true } | { ok: false; motivo: string }`
  - em `classificar.ts`: `textoNovo(corpo: string | null | undefined): string`

- [ ] **Step 1: Conferir que as frentes do worker terminaram**

```bash
git status --short worker/ludmilla/src worker/ludmilla/test
grep -n "realizada" worker/ludmilla/src/email/enel/classificar.ts
grep -n "export function abrirPasta\|export function escolherPasta" worker/ludmilla/src/email/caixa.ts
```

Expected: `git status` VAZIO (nada de outra sessão por commitar nesses arquivos); o `grep` do `classificar.ts` mostra o estado `'realizada'` no tipo `Classificacao` (a frente "troca realizada → Concluído"); o do `caixa.ts` mostra as duas funções (a frente "Todos os e-mails"). Se qualquer um falhar, PARE: a frente anterior não terminou. Anote como a frente escreveu a troca realizada no tipo (ex.: `{ tipo: 'troca_relogio'; estado: 'realizada' }`) e a frase de exemplo que o teste dela usa: as duas entram no Step 2 (`trocaFoiRealizada` e o teste dela são o ÚNICO ponto deste plano que conhece esse nome).

- [ ] **Step 2: Escrever o teste que falha**

Crie `worker/ludmilla/test/enel-cobranca.test.ts`:

```ts
// worker/ludmilla/test/enel-cobranca.test.ts
// A cobrança da troca do relógio — as funções puras. Notas, UCs, NTs, Message-IDs e
// endereços são inventados; o único endereço real é o remetente público da regra da
// ENEL (canalgd.sp@br.enel.com), que já está nos testes de hoje.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DIAS_ENTRE_COBRANCAS, MAX_REFERENCIAS, REGEX_DESTINATARIO_ENEL, ajustarSaudacao, assuntoDaResposta,
  cabecalhosDaResposta, cobrancaDaMensagem, dataBr, destinatarioDaEnel, enderecoDoRemetente, notaDeServico,
  podeEnviar, saudacaoNaHora, trocaFoiRealizada, vencimento, type EstadoDoEnvio,
} from '../src/email/enel/cobranca.js';
import { classificarCorpo, textoNovo } from '../src/email/enel/classificar.js';

const AGENDADA = 'Prezado(a), boa tarde! Nota de serviço criada 400012345678 , na data de 01/10/2026 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis. Protocolo: 9876543210 . Atenciosamente';
const REENVIO = 'Prezado(a), bom dia! Reenviamos a nota de serviço 400012345678 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis. Motivo da rejeição: Fechado Sem Acesso ao Centro de Medição. 06.10.2026 Protocolo: 9876543210 . Atenciosamente';
const FALHA_SEM_NOTA = 'Identificamos que a tentativa de troca do medidor no dia 15/09 não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução.';
const COM_CITACAO = 'Reenviamos a nota de serviço 400012345678 , para a troca do medidor bidirecional. -------------- Mensagem original -------------- De: Equipe [equipe@exemplo.test] Assunto: TROCA DE RELOGIO Prezado, nota de serviço criada 400099999999 para a troca do medidor';
const FONTE_DA_MIGRACAO = new URL('../../../../supabase/migrations/20261024150000_ludmilla_cobranca_troca.sql', import.meta.url);

// ── a nota de serviço ──────────────────────────────────────────────────────

test('notaDeServico: os 12 dígitos logo depois de "nota de serviço" (criada, reenviada, informada)', () => {
  assert.equal(notaDeServico(AGENDADA), '400012345678');
  assert.equal(notaDeServico(REENVIO), '400012345678');
  assert.equal(notaDeServico('informamos que a nota de serviço 400012345678 , referente a instalação: 2222222222 , foi criada'), '400012345678');
});

test('notaDeServico: também depois de "ordem" e com "nº" no meio', () => {
  assert.equal(notaDeServico('Ordem de serviço nº 400012345678 para a troca do medidor'), '400012345678');
  assert.equal(notaDeServico('a ordem 400012345678 foi aberta'), '400012345678');
});

test('notaDeServico: entidades HTML decodificadas', () => {
  assert.equal(notaDeServico('Reenviamos a nota de servi&ccedil;o 400012345678 , para a troca'), '400012345678');
  assert.equal(notaDeServico('Reenviamos a nota de servi&amp;ccedil;o&nbsp;400012345678 , para a troca'), '400012345678');
});

test('notaDeServico: só a parte NOVA do e-mail (a citação traz a nota antiga)', () => {
  assert.equal(notaDeServico(COM_CITACAO), '400012345678');
});

test('notaDeServico: regra estrita — ambíguo, curto, longo, longe ou sem o termo = null', () => {
  assert.equal(notaDeServico('nota de serviço 400012345678 e nota de serviço 400087654321'), null, 'duas notas diferentes');
  assert.equal(notaDeServico('nota de serviço 400012345678 e de novo a nota de serviço 400012345678'), '400012345678', 'a mesma, repetida');
  assert.equal(notaDeServico('nota de serviço 40001234567 criada'), null, '11 dígitos');
  assert.equal(notaDeServico('nota de serviço 4000123456789 criada'), null, '13 dígitos');
  assert.equal(notaDeServico('nota de serviço referente à instalação 2222222222 e ao pedido 400012345678'), null, 'outro número antes');
  assert.equal(notaDeServico(`nota de serviço ${'x'.repeat(60)} 400012345678`), null, 'mais de 40 caracteres de distância');
  assert.equal(notaDeServico('protocolo 400012345678'), null, 'sem o termo');
  assert.equal(notaDeServico(''), null);
  assert.equal(notaDeServico(null), null);
});

test('textoNovo: corta a citação e decodifica (o mesmo texto que o classificador lê)', () => {
  assert.doesNotMatch(textoNovo(COM_CITACAO), /400099999999/);
  assert.match(textoNovo('servi&ccedil;o'), /serviço/);
});

// ── o destinatário ─────────────────────────────────────────────────────────

test('enderecoDoRemetente: o endereço entre <>, minúsculo; ou o endereço sozinho', () => {
  assert.equal(enderecoDoRemetente('Canal GD <canalgd.sp@br.enel.com>'), 'canalgd.sp@br.enel.com');
  assert.equal(enderecoDoRemetente('"ENEL, Canal GD" <CanalGD.SP@BR.ENEL.COM>'), 'canalgd.sp@br.enel.com');
  assert.equal(enderecoDoRemetente('  tecnico.abc@enel.com  '), 'tecnico.abc@enel.com');
});

test('enderecoDoRemetente: mais de um endereço, espaço ou quebra de linha = null', () => {
  assert.equal(enderecoDoRemetente('a <x@enel.com>, b <y@enel.com>'), null);
  assert.equal(enderecoDoRemetente('x@enel.com y@enel.com'), null);
  assert.equal(enderecoDoRemetente('x@enel.com, y@enel.com'), null);
  assert.equal(enderecoDoRemetente('Nome <x@enel.com>\r\nBcc: y@exemplo.test'), null);
  assert.equal(enderecoDoRemetente(''), null);
  assert.equal(enderecoDoRemetente(null), null);
});

test('destinatarioDaEnel: só @enel.com e @br.enel.com, um endereço, já minúsculo', () => {
  assert.equal(destinatarioDaEnel('canalgd.sp@br.enel.com'), true);
  assert.equal(destinatarioDaEnel('tecnico.abc@enel.com'), true);
  for (const fora of [
    'x@enel.com.br', 'canalgd.sp@br.enel.com.exemplo.test', 'x@evil.enel.com', 'x@enelxcom', 'X@ENEL.COM',
    'x y@enel.com', 'a@enel.com,b@exemplo.test', '.x@enel.com', '@enel.com', 'x@enel.com\nBcc: y@exemplo.test', '',
  ]) {
    assert.equal(destinatarioDaEnel(fora), false, fora);
  }
  assert.equal(destinatarioDaEnel(null), false);
});

test('a trava do destinatário é a MESMA no worker e no banco (a migração usa a mesma expressão)', () => {
  const sql = readFileSync(FONTE_DA_MIGRACAO, 'utf8');
  assert.equal(REGEX_DESTINATARIO_ENEL.flags, '', 'sem i: maiúscula não passa (o endereço chega normalizado)');
  assert.ok(sql.includes(`'${REGEX_DESTINATARIO_ENEL.source}'`), `a migração não tem '${REGEX_DESTINATARIO_ENEL.source}'`);
});

// ── a resposta na conversa da nota ─────────────────────────────────────────

test('assuntoDaResposta: "RE: " uma vez só, sem quebra de linha, até 300', () => {
  assert.equal(assuntoDaResposta('TROCA DE RELÓGIO - NT 391000010'), 'RE: TROCA DE RELÓGIO - NT 391000010');
  assert.equal(assuntoDaResposta('RE: TROCA DE RELÓGIO - NT 391000010'), 'RE: TROCA DE RELÓGIO - NT 391000010');
  assert.equal(assuntoDaResposta('re: troca'), 're: troca');
  assert.equal(assuntoDaResposta('RES: troca'), 'RES: troca');
  assert.equal(assuntoDaResposta('troca\r\nBcc: y@exemplo.test'), 'RE: troca Bcc: y@exemplo.test');
  assert.equal(assuntoDaResposta(''), 'RE: TROCA DE RELÓGIO');
  assert.equal(assuntoDaResposta('x'.repeat(400)).length, 300);
});

test('cabecalhosDaResposta: In-Reply-To = a nota; References = as dela + a nota, no fim', () => {
  assert.deepEqual(
    cabecalhosDaResposta('<n@enel.test>', ['<a@exemplo.test>', '<n@enel.test>', 'lixo', '<b@exemplo.test>', '<a@exemplo.test>']),
    { inReplyTo: '<n@enel.test>', referencias: ['<a@exemplo.test>', '<b@exemplo.test>', '<n@enel.test>'] },
  );
});

test('cabecalhosDaResposta: sem Message-ID de verdade, não liga a nada inventado', () => {
  assert.deepEqual(cabecalhosDaResposta('imap-uid-7', ['<a@exemplo.test>']), { inReplyTo: null, referencias: ['<a@exemplo.test>'] });
  assert.deepEqual(cabecalhosDaResposta('<a@b>\r\nBcc: x', []), { inReplyTo: null, referencias: [] });
});

test('cabecalhosDaResposta: no máximo 20 referências, a nota sempre a última', () => {
  const muitas = Array.from({ length: 30 }, (_, i) => `<r${i}@exemplo.test>`);
  const r = cabecalhosDaResposta('<n@enel.test>', muitas);
  assert.equal(r.referencias.length, MAX_REFERENCIAS);
  assert.equal(r.referencias.at(-1), '<n@enel.test>');
});

// ── quando vence, a data e a saudação ──────────────────────────────────────

test('vencimento: 7 dias depois', () => {
  assert.equal(DIAS_ENTRE_COBRANCAS, 7);
  assert.equal(vencimento(new Date('2026-10-01T15:00:00Z')).toISOString(), '2026-10-08T15:00:00.000Z');
});

test('dataBr: dd/mm/aaaa no horário de Brasília', () => {
  assert.equal(dataBr(new Date('2026-10-01T02:00:00Z')), '30/09/2026');
  assert.equal(dataBr('2026-10-08T15:00:00Z'), '08/10/2026');
});

test('saudacaoNaHora: "bom dia" até 11:59 de Brasília, "boa tarde" a partir do meio-dia', () => {
  assert.equal(saudacaoNaHora(new Date('2026-10-24T14:59:00Z')), 'bom dia');
  assert.equal(saudacaoNaHora(new Date('2026-10-24T15:00:00Z')), 'boa tarde');
  assert.equal(saudacaoNaHora(new Date('2026-10-25T02:00:00Z')), 'boa tarde');
  assert.equal(saudacaoNaHora(new Date('2026-10-24T10:00:00Z')), 'bom dia');
});

test('ajustarSaudacao: troca só a 1ª linha do modelo; texto que a pessoa mexeu fica', () => {
  const tarde = new Date('2026-10-24T16:00:00Z');
  assert.equal(ajustarSaudacao('Prezados, bom dia.\n\nResto do texto.', tarde), 'Prezados, boa tarde.\n\nResto do texto.');
  assert.equal(ajustarSaudacao('Prezados, boa tarde.\n\nResto.', new Date('2026-10-24T12:00:00Z')), 'Prezados, bom dia.\n\nResto.');
  assert.equal(ajustarSaudacao('Olá, equipe.\n\nResto.', tarde), 'Olá, equipe.\n\nResto.');
  assert.equal(ajustarSaudacao('Prezados, retomando o e-mail abaixo:\n\nResto.', tarde), 'Prezados, retomando o e-mail abaixo:\n\nResto.');
  assert.equal(ajustarSaudacao('Topo.\n> Prezados, bom dia.', tarde), 'Topo.\n> Prezados, bom dia.', 'a citação não muda');
});

// ── o e-mail da nota vira os dados da cobrança ─────────────────────────────

const mensagem = (o: Partial<{ messageId: string; assunto: string; remetente: string; recebidoEm: Date | null; texto: string; referencias: string[] }> = {}) => ({
  messageId: '<cob-nota-1@enel.test>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
  remetente: 'Canal GD <canalgd.sp@br.enel.com>', recebidoEm: new Date('2026-10-01T15:00:00Z'),
  texto: AGENDADA, referencias: ['<cob-pedido@exemplo.test>'], ...o,
});
const AGORA = new Date('2026-10-24T12:00:00Z');

test('cobrancaDaMensagem: a troca agendada vira a cobrança, com tudo o que a resposta precisa', () => {
  assert.deepEqual(cobrancaDaMensagem(classificarCorpo(AGENDADA), mensagem(), AGORA), {
    tipo: 'nota',
    dados: {
      nota: '400012345678', dataNota: '2026-10-01T15:00:00.000Z', prazoDias: 7,
      para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
      inReplyTo: '<cob-nota-1@enel.test>', referencias: ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>'],
    },
  });
});

test('cobrancaDaMensagem: o reenvio da nota (troca que falhou COM o número) reabre a mesma nota, sem prazo', () => {
  const r = cobrancaDaMensagem(classificarCorpo(REENVIO), mensagem({ texto: REENVIO }), AGORA);
  assert.equal(r.tipo, 'nota');
  if (r.tipo === 'nota') { assert.equal(r.dados.nota, '400012345678'); assert.equal(r.dados.prazoDias, null); }
});

test('cobrancaDaMensagem: falha SEM número, vistoria, carta ou nada = nenhuma', () => {
  assert.deepEqual(cobrancaDaMensagem(classificarCorpo(FALHA_SEM_NOTA), mensagem({ texto: FALHA_SEM_NOTA }), AGORA), { tipo: 'nenhuma' });
  assert.deepEqual(cobrancaDaMensagem({ tipo: 'resultado_vistoria', aprovada: true }, mensagem(), AGORA), { tipo: 'nenhuma' });
  assert.deepEqual(cobrancaDaMensagem(null, mensagem(), AGORA), { tipo: 'nenhuma' });
});

test('cobrancaDaMensagem: remetente que só PARECE da ENEL não vira cobrança', () => {
  assert.deepEqual(
    cobrancaDaMensagem(classificarCorpo(AGENDADA), mensagem({ remetente: 'Canal <canalgd.sp@br.enel.com.exemplo.test>' }), AGORA),
    { tipo: 'fora_da_enel' },
  );
});

test('cobrancaDaMensagem: nota sem número legível ainda vira cobrança (a tela pede conferir)', () => {
  const sem = 'Nota de serviço criada , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis.';
  const r = cobrancaDaMensagem(classificarCorpo(sem), mensagem({ texto: sem }), AGORA);
  assert.equal(r.tipo, 'nota');
  if (r.tipo === 'nota') assert.equal(r.dados.nota, null);
});

test('cobrancaDaMensagem: sem data no e-mail vale a hora da leitura; prazo absurdo vira nulo', () => {
  const r = cobrancaDaMensagem({ tipo: 'troca_relogio', estado: 'agendada', prazoDias: 999 }, mensagem({ recebidoEm: null }), AGORA);
  assert.equal(r.tipo, 'nota');
  if (r.tipo === 'nota') { assert.equal(r.dados.dataNota, AGORA.toISOString()); assert.equal(r.dados.prazoDias, null); }
});

test('cobrancaDaMensagem: sem o cabeçalho References, só a nota', () => {
  const r = cobrancaDaMensagem(classificarCorpo(AGENDADA), { ...mensagem(), referencias: undefined }, AGORA);
  if (r.tipo !== 'nota') throw new Error('esperava nota');
  assert.deepEqual(r.dados.referencias, ['<cob-nota-1@enel.test>']);
});

// A frase vem da frente "troca realizada → Concluído" (Step 1): troque pela do teste dela se for outra.
const REALIZADA = 'Prezado(a), informamos que a troca do medidor já foi realizada através da nota de serviço 400012345678 .';

test('trocaFoiRealizada: só a troca feita', () => {
  assert.equal(trocaFoiRealizada(classificarCorpo(REALIZADA)), true);
  assert.equal(trocaFoiRealizada(classificarCorpo(AGENDADA)), false);
  assert.equal(trocaFoiRealizada(classificarCorpo(FALHA_SEM_NOTA)), false);
  assert.equal(trocaFoiRealizada(null), false);
});

// ── a trava do envio no worker ─────────────────────────────────────────────

const ESTADO: EstadoDoEnvio = {
  situacaoAnterior: 'aguardando_envio', aprovadaPor: 'pessoa-1', ultimaEnviadaEm: null,
  para: 'canalgd.sp@br.enel.com', texto: 'Prezados, bom dia.\n\nTexto aprovado de exemplo.',
};
const DIA = 86_400_000;

test('podeEnviar: aprovada, esperando, para a ENEL, com texto = pode', () => {
  assert.deepEqual(podeEnviar(ESTADO, AGORA), { ok: true });
});

test('podeEnviar: sem aprovação, fora de aguardando_envio, fora da ENEL ou sem texto = não', () => {
  assert.equal(podeEnviar({ ...ESTADO, aprovadaPor: null }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, situacaoAnterior: 'agendada' }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, situacaoAnterior: null }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, para: 'canal@exemplo.test' }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, para: 'Canal <canalgd.sp@br.enel.com>' }, AGORA).ok, false, 'tem de vir normalizado');
  assert.equal(podeEnviar({ ...ESTADO, texto: '   ' }, AGORA).ok, false);
});

test('podeEnviar: 7 dias cravados desde o último envio pode; um minuto antes, não; data ilegível, não', () => {
  const ha = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();
  assert.equal(podeEnviar({ ...ESTADO, ultimaEnviadaEm: ha(7 * DIA) }, AGORA).ok, true);
  assert.equal(podeEnviar({ ...ESTADO, ultimaEnviadaEm: ha(7 * DIA - 60_000) }, AGORA).ok, false);
  assert.equal(podeEnviar({ ...ESTADO, ultimaEnviadaEm: 'ontem' }, AGORA).ok, false);
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
cd worker/ludmilla && npx tsc -p tsconfig.test.json --outDir _dt-cobranca
```

Expected: FALHA de compilação — `Cannot find module '../src/email/enel/cobranca.js'` e `Module '"../src/email/enel/classificar.js"' has no exported member 'textoNovo'`.

- [ ] **Step 4: Exportar `textoNovo` do classificador**

Em `worker/ludmilla/src/email/enel/classificar.ts`, logo ANTES de `export function classificarCorpo`, acrescente:

```ts
/**
 * A parte NOVA do corpo (sem a citação), com as entidades HTML decodificadas e achatada —
 * exatamente o que o classificador lê. A cobrança (cobranca.ts) tira o número da nota
 * daqui: a citação traz a nota ANTIGA do mesmo projeto.
 */
export function textoNovo(corpo: string | null | undefined): string {
  return semCitacao(decodificarEntidades(corpo ?? ''));
}
```

E, dentro de `classificarCorpo`, troque a primeira linha

```ts
  const util = semCitacao(decodificarEntidades(corpo ?? ''));
```

por

```ts
  const util = textoNovo(corpo);
```

(mesmo comportamento: os testes do classificador seguem sem edição).

- [ ] **Step 5: Escrever `cobranca.ts`**

Crie `worker/ludmilla/src/email/enel/cobranca.ts`:

```ts
// worker/ludmilla/src/email/enel/cobranca.ts
import type { MensagemLida } from '../caixa.js';
import { semAcento } from '../util.js';
import { textoNovo, type Classificacao } from './classificar.js';

/**
 * A COBRANÇA DA TROCA DO RELÓGIO NA ENEL — o que não precisa de banco nem de rede.
 * Spec: docs/superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md.
 *
 * Duas pontas:
 *  · na LEITURA (run `varredura_email`): o e-mail que abre ou reabre uma nota de serviço
 *    vira os dados de uma cobrança agendada (`cobrancaDaMensagem`);
 *  · no ENVIO (run `enviar_cobranca`): as travas que valem ANTES de qualquer byte sair
 *    (`podeEnviar`) e a saudação na hora do envio (`ajustarSaudacao`).
 * As travas existem TAMBÉM no banco (migração 20261024150000); um teste confere que a
 * expressão do destinatário é a mesma nas duas pontas. Nada aqui manda e-mail.
 */

export const DIAS_ENTRE_COBRANCAS = 7;
const DIA = 86_400_000;
const FUSO = 'America/Sao_Paulo';

/**
 * O destinatário: UM endereço, já minúsculo, @enel.com ou @br.enel.com. A MESMA expressão
 * de `public.ludmilla_endereco_da_enel` (o teste lê a migração). Sem a flag `i` de propósito:
 * o endereço chega normalizado por `enderecoDoRemetente`, e maiúscula aqui é sinal de que
 * ele não passou por lá.
 */
export const REGEX_DESTINATARIO_ENEL = /^[a-z0-9][a-z0-9._%+-]*@(br\.)?enel\.com$/;

/** Um Message-ID de verdade: `<algo@algo>`, sem espaço nem quebra de linha. */
const ID_DE_MENSAGEM = /^<[^<>\s]+@[^<>\s]+>$/;
export const MAX_REFERENCIAS = 20;

/**
 * O número da nota de serviço: 12 dígitos CONTÍGUOS logo depois de "nota de serviço" ou
 * "ordem" (até 40 caracteres sem dígito no meio, para "criada nº"). Só a parte NOVA do
 * e-mail, com as entidades decodificadas. Dois números diferentes = ambíguo = null: a
 * cobrança nasce sem número e a tela pede "confira o número da nota" (spec §6).
 */
const NOTA = /(?:nota de servico|ordem(?: de servico)?)\D{0,40}?(?<!\d)(\d{12})(?!\d)/g;
export function notaDeServico(corpo: string | null | undefined): string | null {
  const t = semAcento(textoNovo(corpo)).toLowerCase();
  const achadas = new Set([...t.matchAll(NOTA)].map(m => m[1]));
  return achadas.size === 1 ? [...achadas][0] : null;
}

/**
 * O endereço do remetente, minúsculo: o que está entre `<>` ("Canal GD <x@y>") ou o
 * endereço sozinho. Mais de um endereço, espaço ou quebra de linha = null (não há para
 * quem responder com segurança).
 */
export function enderecoDoRemetente(remetente: string | null | undefined): string | null {
  const t = (remetente ?? '').trim();
  if (!t || /[\r\n]/.test(t)) return null;
  const entre = [...t.matchAll(/<([^<>]*)>/g)].map(x => x[1].trim());
  let e: string;
  if (entre.length > 1) return null;
  if (entre.length === 1) e = entre[0];
  else {
    if (/[\s,;]/.test(t)) return null;
    e = t;
  }
  e = e.toLowerCase();
  return e === '' || /[\s,;<>]/.test(e) ? null : e;
}

/** A trava do destinatário (a mesma do banco). */
export function destinatarioDaEnel(endereco: string | null | undefined): boolean {
  return typeof endereco === 'string' && REGEX_DESTINATARIO_ENEL.test(endereco);
}

/** "RE: " + o assunto da nota, uma vez só, sem caractere de controle, até 300. */
export function assuntoDaResposta(assunto: string | null | undefined): string {
  const limpo = (assunto ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const base = limpo || 'TROCA DE RELÓGIO';
  return (/^(re|res)\s*:/i.test(base) ? base : `RE: ${base}`).slice(0, 300);
}

/**
 * Os cabeçalhos que põem a resposta NA conversa da nota: `In-Reply-To` = o Message-ID da
 * nota; `References` = as referências dela + o Message-ID dela, no fim (RFC 5322 §3.6.4).
 * Só ids de verdade; sem o da nota (`imap-uid-N`, envelope sem Message-ID), não há a quem
 * ligar e o e-mail vai só com o "RE:".
 */
export function cabecalhosDaResposta(messageId: string, referencias: readonly string[] = []): {
  inReplyTo: string | null; referencias: string[];
} {
  const inReplyTo = ID_DE_MENSAGEM.test(messageId) ? messageId : null;
  const lista = [...referencias.filter(x => ID_DE_MENSAGEM.test(x) && x !== inReplyTo), ...(inReplyTo ? [inReplyTo] : [])];
  return { inReplyTo, referencias: [...new Set(lista)].slice(-MAX_REFERENCIAS) };
}

/** A cobrança vence 7 dias depois da base (o e-mail da nota, ou o último envio). */
export function vencimento(base: Date): Date {
  return new Date(base.getTime() + DIAS_ENTRE_COBRANCAS * DIA);
}

/** dd/mm/aaaa no horário de Brasília. */
export function dataBr(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' }).format(x);
}

/** A hora (0–23) em Brasília. */
export function horaEmBrasilia(agora: Date): number {
  const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', hourCycle: 'h23' }).formatToParts(agora);
  return Number(partes.find(p => p.type === 'hour')?.value ?? '0');
}

/** "bom dia" até 11:59 de Brasília; "boa tarde" a partir do meio-dia (spec §5). */
export function saudacaoNaHora(agora: Date): 'bom dia' | 'boa tarde' {
  return horaEmBrasilia(agora) < 12 ? 'bom dia' : 'boa tarde';
}

/**
 * Na hora do envio, a 1ª linha do modelo ("Prezados, bom dia." / "Prezados, boa tarde.")
 * passa a dizer a saudação certa. Se a pessoa mexeu nessa linha, ela fica como está — o
 * robô nunca reescreve o que alguém aprovou.
 */
const PRIMEIRA_LINHA_DO_MODELO = /^Prezados, (?:bom dia|boa tarde)\.(?=\r?\n|$)/;
export function ajustarSaudacao(texto: string, agora: Date): string {
  return texto.replace(PRIMEIRA_LINHA_DO_MODELO, `Prezados, ${saudacaoNaHora(agora)}.`);
}

export interface DadosDaCobranca {
  nota: string | null;
  /** ISO: a data do e-mail da nota (sem data, a hora da leitura) */
  dataNota: string;
  prazoDias: number | null;
  para: string;
  assunto: string;
  inReplyTo: string | null;
  referencias: string[];
}

export type NotaDaMensagem =
  | { tipo: 'nenhuma' }
  /** o e-mail fala de uma nota, mas o remetente não é da ENEL: não há para quem cobrar */
  | { tipo: 'fora_da_enel' }
  | { tipo: 'nota'; dados: DadosDaCobranca };

/**
 * Este e-mail abre (ou reabre) uma nota de serviço? A troca AGENDADA sempre; a troca que
 * FALHOU só quando traz o número da nota (é o "Reenviamos a nota de serviço …", a
 * reprogramação). O remetente é quem recebe a cobrança, e tem de passar na trava.
 */
export function cobrancaDaMensagem(
  c: Classificacao,
  m: Pick<MensagemLida, 'messageId' | 'assunto' | 'remetente' | 'recebidoEm' | 'texto'> & { referencias?: string[] },
  agora: Date,
): NotaDaMensagem {
  if (c?.tipo !== 'troca_relogio') return { tipo: 'nenhuma' };
  if (c.estado !== 'agendada' && c.estado !== 'nao_executada') return { tipo: 'nenhuma' };
  const nota = notaDeServico(m.texto);
  if (c.estado === 'nao_executada' && nota === null) return { tipo: 'nenhuma' };
  const para = enderecoDoRemetente(m.remetente);
  if (para === null || !destinatarioDaEnel(para)) return { tipo: 'fora_da_enel' };
  const prazo = c.estado === 'agendada' ? c.prazoDias : null;
  const { inReplyTo, referencias } = cabecalhosDaResposta(m.messageId, m.referencias ?? []);
  return {
    tipo: 'nota',
    dados: {
      nota,
      dataNota: (m.recebidoEm ?? agora).toISOString(),
      prazoDias: prazo !== null && prazo >= 1 && prazo <= 365 ? prazo : null,
      para,
      assunto: assuntoDaResposta(m.assunto),
      inReplyTo,
      referencias,
    },
  };
}

/**
 * A ENEL disse que a troca foi feita. A classificação vem da frente "troca realizada →
 * Concluído": este é o ÚNICO ponto da cobrança que conhece o nome desse estado.
 */
export function trocaFoiRealizada(c: Classificacao): boolean {
  return c?.tipo === 'troca_relogio' && c.estado === 'realizada';
}

export interface EstadoDoEnvio {
  situacaoAnterior: string | null;
  aprovadaPor: string | null;
  ultimaEnviadaEm: string | null;
  para: string | null;
  texto: string | null;
}

/**
 * A trava do envio NO WORKER, independente do banco (spec §3.4: "verificadas no worker
 * E no banco"). Data ilegível do último envio = não envia (na dúvida, nada sai).
 */
export function podeEnviar(c: EstadoDoEnvio, agora: Date): { ok: true } | { ok: false; motivo: string } {
  if (c.situacaoAnterior !== 'aguardando_envio') {
    return { ok: false, motivo: `a cobrança não estava esperando envio (${c.situacaoAnterior ?? 'sem situação'})` };
  }
  if (!c.aprovadaPor) return { ok: false, motivo: 'a cobrança não foi aprovada por uma pessoa da equipe' };
  if (!destinatarioDaEnel(c.para)) return { ok: false, motivo: 'o destinatário não é um endereço @enel.com ou @br.enel.com' };
  if (c.ultimaEnviadaEm !== null) {
    const t = Date.parse(c.ultimaEnviadaEm);
    if (!Number.isFinite(t) || agora.getTime() - t < DIAS_ENTRE_COBRANCAS * DIA) {
      return { ok: false, motivo: 'já saiu uma cobrança desta nota há menos de 7 dias' };
    }
  }
  if (!(c.texto ?? '').trim()) return { ok: false, motivo: 'a cobrança está sem texto' };
  return { ok: true };
}
```

Se no Step 1 a frente "troca realizada" tiver escrito o estado com outro nome, troque `'realizada'` em `trocaFoiRealizada` (e só lá) pelo nome dela.

- [ ] **Step 6: Rodar e ver passar**

```bash
cd worker/ludmilla && rm -rf _dt-cobranca && npx tsc -p tsconfig.test.json --outDir _dt-cobranca && node --test _dt-cobranca/test/*.test.js 2>&1 | tail -12
```

Expected: `# fail 0`, e o total de testes = o de antes + os 29 novos (anote os dois números).

- [ ] **Step 7: Mutações nas travas (uma por vez; cada uma desfeita antes da próxima)**

Para cada linha abaixo: faça a troca em `src/email/enel/cobranca.ts` com a ferramenta Edit, rode `cd worker/ludmilla && rm -rf _dt-cobranca && npx tsc -p tsconfig.test.json --outDir _dt-cobranca && node --test _dt-cobranca/test/enel-cobranca.test.js 2>&1 | grep -E "^# (pass|fail)"`, confirme `# fail` ≥ 1 no teste indicado e DESFAÇA a troca.

| Mutação | O teste que tem de cair |
|---|---|
| `/^[a-z0-9]…enel\.com$/` → sem o `^` | `destinatarioDaEnel: só @enel.com…` (`x y@enel.com`) e a paridade com o banco |
| … → sem o `$` | `destinatarioDaEnel` (`x@enel.com.br`) e a paridade |
| `(br\.)?` → `([a-z0-9-]+\.)?` | `destinatarioDaEnel` (`x@evil.enel.com`) e a paridade |
| `e = e.toLowerCase();` → apagada | `enderecoDoRemetente: o endereço entre <>, minúsculo…` |
| `< DIAS_ENTRE_COBRANCAS * DIA` → `<= DIAS_ENTRE_COBRANCAS * DIA` | `podeEnviar: 7 dias cravados…` |
| `if (!c.aprovadaPor) return …` → apagada | `podeEnviar: sem aprovação…` |
| `if (achadas.size === 1 …` → `achadas.size >= 1` | `notaDeServico: regra estrita…` (duas notas) |

Depois da última, rode a suíte inteira de novo (Step 6): `# fail 0`.

- [ ] **Step 8: Commit**

Escreva `$RASCUNHO/msg-t3.txt`:

```text
feat(ludmilla): lógica pura da cobrança da troca na ENEL

Número da nota de serviço (12 dígitos junto de "nota de serviço" ou
"ordem", só na parte nova do e-mail), endereço do remetente, a trava
do destinatário @enel.com/@br.enel.com (a mesma expressão do banco,
conferida por teste), assunto RE:, In-Reply-To/References, vencimento
de 7 dias, saudação na hora do envio e a trava do envio no worker.
classificar.ts só exporta textoNovo (o mesmo texto que já lia).

Co-Authored-By: <o modelo que executou> <noreply@anthropic.com>
```

```bash
cd worker/ludmilla && rm -rf _dt-cobranca && cd ../..
git add worker/ludmilla/src/email/enel/cobranca.ts worker/ludmilla/src/email/enel/classificar.ts worker/ludmilla/test/enel-cobranca.test.ts
git commit -F "$RASCUNHO/msg-t3.txt" -- worker/ludmilla/src/email/enel/cobranca.ts worker/ludmilla/src/email/enel/classificar.ts worker/ludmilla/test/enel-cobranca.test.ts
git show --stat HEAD
```

---

### Task 4: Worker — o run da ENEL agenda a cobrança da nota e a encerra na troca feita

**Files:**
- Modify: `worker/ludmilla/src/email/caixa.ts` (`MensagemLida.referencias`, preenchido em `extrairMensagem`)
- Modify: `worker/ludmilla/src/fila.ts` (`CobrancaParaAgendar`, `agendarCobranca`, `encerrarCobrancasPorTroca`)
- Modify: `worker/ludmilla/src/email/enel/run.ts` (`DepsEnel` + `DEPS_ENEL` + o bloco da cobrança em `tratarMensagemEnel`)
- Test: `worker/ludmilla/test/enel-cobranca-run.test.ts` (arquivo NOVO: os testes de hoje ficam sem uma vírgula alterada)

**Interfaces:**
- Consumes: `cobrancaDaMensagem`, `trocaFoiRealizada`, `vencimento`, `dataBr` (Task 3); RPCs `ludmilla_cobranca_agendar` e `ludmilla_cobranca_encerrar_por_troca` (Task 1).
- Produces:
  - `MensagemLida.referencias?: string[]` — os Message-IDs do cabeçalho `References` do e-mail.
  - em `fila.ts`: `interface CobrancaParaAgendar { accountId: string; messageId: string; projectId: string; nota: string | null; dataNota: string; prazoDias: number | null; para: string; assunto: string; inReplyTo: string | null; referencias: string[] }`; `agendarCobranca(p: CobrancaParaAgendar): Promise<string>`; `encerrarCobrancasPorTroca(accountId: string, projectId: string, quando: string): Promise<number>`.
  - em `run.ts`: `DepsEnel.agendarCobranca?` e `DepsEnel.encerrarCobrancas?` (opcionais: os dublês de hoje seguem válidos); `DEPS_ENEL` com as duas.

- [ ] **Step 1: Conferir que as frentes do worker terminaram**

Run: `git status --short worker/ludmilla/src worker/ludmilla/test`
Expected: vazio, e a Task 3 commitada (`git log --oneline -1 -- worker/ludmilla/src/email/enel/cobranca.ts`). Se houver mudança de outra sessão, PARE.

- [ ] **Step 2: Escrever o teste que falha**

Crie `worker/ludmilla/test/enel-cobranca-run.test.ts`:

```ts
// worker/ludmilla/test/enel-cobranca-run.test.ts
// O run da ENEL agenda a cobrança da nota e a encerra quando a ENEL avisa que trocou.
// Dublês que GRAVAM o que foi chamado. Titular, UC, NT, notas e Message-IDs inventados;
// o canalgd.sp@br.enel.com é o remetente público da regra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from 'mailparser';
import { DEPS_ENEL, tratarMensagemEnel, type DepsEnel } from '../src/email/enel/run.js';
import type { ProjetoEnel } from '../src/email/enel/identificar.js';
import { extrairMensagem, type MensagemLida } from '../src/email/caixa.js';
import type { RegraEmail } from '../src/email/util.js';
import type { CobrancaParaAgendar, EmailLido, Run } from '../src/fila.js';

const RUN: Run = { id: 'run-cob', tenant_id: 'tenant-cob', account_id: 'conta-enel', tipo: 'varredura_email', situacao: 'rodando' };
const REGRAS: RegraEmail[] = [
  { id: 'r-canal', remetente: 'canalgd.sp@br.enel.com', assunto: '', tipo_documento: 'troca_relogio', anexar: true, ler_pdf: true },
  { id: 'r-carta', remetente: 'nao.responda@enel.com', assunto: '', tipo_documento: 'carta_projeto', anexar: true, ler_pdf: true },
];
const PA: ProjetoEnel = {
  project_id: 'id-cob-1', company_id: 'empresa-cob', codigo: 'GD-COB-001', protocolo: '391000010',
  uc: '0055001001', titular: 'TEODORICO VALADARES QUINTINO', status: 'approved', ativo: true,
};

const AGORA = new Date('2026-10-24T12:00:00Z');
const AGENDADA = 'Prezado(a), boa tarde! Nota de serviço criada 400012345678 , na data de 01/10/2026 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis. Protocolo: 9876543210 . Atenciosamente';
const REENVIO = 'Prezado(a), bom dia! Reenviamos a nota de serviço 400012345678 , referente a instalação 2222222222 , para a troca do medidor bidirecional, com o prazo de execução de até 5 dias úteis. Motivo da rejeição: Fechado Sem Acesso ao Centro de Medição. 06.10.2026 Protocolo: 9876543210 . Atenciosamente';
const FALHA_SEM_NOTA = 'Identificamos que a tentativa de troca do medidor no dia 15/09 não foi executada pelo seguinte motivo: Cliente Não Permitiu Execução.';
const SEM_NUMERO = 'Nota de serviço criada , para a troca do medidor bidirecional, com o prazo de execução de até 7 dias úteis.';
// A frase vem da frente "troca realizada → Concluído": use a do teste dela, se for outra.
const REALIZADA = 'Prezado(a), informamos que a troca do medidor já foi realizada através da nota de serviço 400012345678 .';

const mensagem = (o: Partial<MensagemLida> = {}): MensagemLida => ({
  uid: 1, messageId: '<cob-nota-1@enel.test>', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
  remetente: 'Canal GD <canalgd.sp@br.enel.com>', recebidoEm: new Date('2026-10-01T15:00:00Z'),
  texto: AGENDADA, anexos: [], anexosSemNome: 0, referencias: ['<cob-pedido@exemplo.test>'], ...o,
});

interface Diario {
  ordem: string[]; registros: EmailLido[]; agendadas: CobrancaParaAgendar[]; encerradas: [string, string, string][];
}

/**
 * Se a frente anterior tiver posto um campo OBRIGATÓRIO a mais em `DepsEnel`, o tsc aponta
 * aqui: acrescente um dublê que não faz nada, no mesmo formato dos de baixo.
 */
function dubles(o: { agendarFalha?: boolean; resposta?: string; semCobranca?: boolean } = {}): { deps: DepsEnel; d: Diario } {
  const d: Diario = { ordem: [], registros: [], agendadas: [], encerradas: [] };
  const deps: DepsEnel = {
    async abrirTentativa() { d.ordem.push('abrirTentativa'); return 1; },
    async anexoDeEmail() { return { situacao: 'ja_resolvido' }; },
    async subirDocumento() { return 'caminho'; },
    async anexoEnviado() { /* nada */ },
    async anexoErro() { /* nada */ },
    async registrarEmailLido(p) { d.ordem.push('registrarEmailLido'); d.registros.push(p); },
    async avisar() { d.ordem.push('avisar'); return 1; },
    async lerParecer() { throw new Error('a IA não deveria ser chamada nestes casos'); },
  };
  if (!o.semCobranca) {
    deps.agendarCobranca = async p => {
      d.ordem.push('agendarCobranca');
      if (o.agendarFalha) throw new Error('Não consegui agendar a cobrança da troca (código 23514)');
      d.agendadas.push(p);
      return o.resposta ?? 'criada';
    };
    deps.encerrarCobrancas = async (conta, projeto, quando) => {
      d.ordem.push('encerrarCobrancas');
      d.encerradas.push([conta, projeto, quando]);
      return 1;
    };
  }
  return { deps, d };
}

async function comLogs<T>(f: () => Promise<T>): Promise<{ r: T; logs: string }> {
  const original = console.log;
  const linhas: string[] = [];
  console.log = (linha?: unknown) => { linhas.push(String(linha)); };
  try { return { r: await f(), logs: linhas.join('\n') }; } finally { console.log = original; }
}
const tratar = (m: MensagemLida, deps: DepsEnel) => comLogs(() => tratarMensagemEnel(RUN, m, REGRAS, [PA], deps, AGORA));
const ultimoRegistro = (d: Diario): EmailLido => {
  const r = d.registros.at(-1);
  if (!r) throw new Error('nenhum registro');
  return r;
};

test('troca agendada: agenda a cobrança da nota com tudo o que a resposta precisa', async () => {
  const { deps, d } = dubles();
  const { r } = await tratar(mensagem(), deps);
  assert.equal(r.situacao, 'tratado');
  assert.deepEqual(d.agendadas, [{
    accountId: 'conta-enel', messageId: '<cob-nota-1@enel.test>', projectId: 'id-cob-1',
    nota: '400012345678', dataNota: '2026-10-01T15:00:00.000Z', prazoDias: 7,
    para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
    inReplyTo: '<cob-nota-1@enel.test>', referencias: ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>'],
  }]);
});

test('a cobrança é agendada ANTES do registro concluído (falha de banco = mensagem relida, não perdida)', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem(), deps);
  assert.ok(d.ordem.indexOf('agendarCobranca') < d.ordem.lastIndexOf('registrarEmailLido'), d.ordem.join(' > '));
});

test('o histórico da mensagem diz para quando a cobrança ficou', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem(), deps);
  assert.match(String(ultimoRegistro(d).motivo), /cobrança da nota 400012345678 à ENEL agendada para 08\/10\/2026/);
});

test('o reenvio da nota (troca que falhou com o número) reabre a mesma nota', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({ texto: REENVIO }), deps);
  assert.equal(d.agendadas.length, 1);
  assert.equal(d.agendadas[0].nota, '400012345678');
  assert.equal(d.agendadas[0].prazoDias, null);
});

test('falha sem número, e Carta, não agendam nada', async () => {
  const a = dubles();
  await tratar(mensagem({ texto: FALHA_SEM_NOTA }), a.deps);
  assert.equal(a.d.agendadas.length, 0);
  const b = dubles();
  await tratar(mensagem({ remetente: 'ENEL <nao.responda@enel.com>', assunto: 'Carta - NT 391000010', texto: '' }), b.deps);
  assert.equal(b.d.agendadas.length, 0);
});

test('remetente que só PARECE da ENEL casa a regra, mas não vira cobrança', async () => {
  const { deps, d } = dubles();
  const { logs } = await tratar(mensagem({ remetente: 'Canal <canalgd.sp@br.enel.com.exemplo.test>' }), deps);
  assert.equal(d.agendadas.length, 0);
  assert.match(logs, /fora da ENEL/);
});

test('nota sem número: agenda assim mesmo, e o histórico avisa para conferir', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({ texto: SEM_NUMERO }), deps);
  assert.equal(d.agendadas[0].nota, null);
  assert.match(String(ultimoRegistro(d).motivo), /SEM o número da nota/);
});

test('o banco respondeu "mantida": nada de ressalva de agendamento', async () => {
  const { deps, d } = dubles({ resposta: 'mantida' });
  await tratar(mensagem(), deps);
  // "troca do relógio agendada" (a anotação de sempre) continua; só a ressalva da cobrança some
  assert.doesNotMatch(String(ultimoRegistro(d).motivo ?? ''), /à ENEL agendada/);
});

test('o agendamento falhou: o tratamento REJEITA e nada fica registrado como concluído', async () => {
  const { deps, d } = dubles({ agendarFalha: true });
  await assert.rejects(tratar(mensagem(), deps), /agendar a cobrança/);
  assert.equal(d.registros.length, 0, 'a linha aberta pela tentativa fica concluida=false: a retentativa agenda');
});

test('troca realizada: encerra as cobranças do projeto, com a data do e-mail', async () => {
  const { deps, d } = dubles();
  await tratar(mensagem({ texto: REALIZADA, recebidoEm: new Date('2026-10-20T15:00:00Z') }), deps);
  assert.deepEqual(d.encerradas, [['conta-enel', 'id-cob-1', '2026-10-20T15:00:00.000Z']]);
  assert.equal(d.agendadas.length, 0);
  assert.match(String(ultimoRegistro(d).motivo), /cobrança\(s\) à ENEL encerrada\(s\)/);
});

test('o log não leva titular, assunto, número da nota nem texto', async () => {
  const { deps } = dubles();
  const { logs } = await tratar(mensagem(), deps);
  assert.match(logs, /cobrança da troca/);
  for (const proibido of ['TEODORICO', 'QUINTINO', 'TROCA DE RELÓGIO', '400012345678', 'Prezado']) {
    assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
  }
});

test('dublês antigos, sem as funções de cobrança: o tratamento segue igual', async () => {
  const { deps, d } = dubles({ semCobranca: true });
  const { r } = await tratar(mensagem(), deps);
  assert.equal(r.situacao, 'tratado');
  assert.equal(d.registros.length, 1);
});

test('DEPS_ENEL de produção tem as duas funções de cobrança', () => {
  assert.equal(typeof DEPS_ENEL.agendarCobranca, 'function');
  assert.equal(typeof DEPS_ENEL.encerrarCobrancas, 'function');
});

test('extrairMensagem lê o cabeçalho References', async () => {
  const eml = [
    'From: Canal GD <canalgd.sp@br.enel.com>',
    'To: equipe@exemplo.test',
    'Subject: RE: TROCA DE RELOGIO - NT 391000010',
    'Message-ID: <cob-nota-1@enel.test>',
    'In-Reply-To: <cob-pedido@exemplo.test>',
    'References: <cob-primeiro@exemplo.test> <cob-pedido@exemplo.test>',
    'Date: Thu, 01 Oct 2026 12:00:00 -0300',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Nota de servico criada 400012345678 para a troca do medidor.',
  ].join('\r\n');
  const m = extrairMensagem(await simpleParser(eml), 9);
  assert.deepEqual(m.referencias, ['<cob-primeiro@exemplo.test>', '<cob-pedido@exemplo.test>']);
  const sem = extrairMensagem(await simpleParser(eml.replace(/^References:.*\r\n/m, '')), 9);
  assert.deepEqual(sem.referencias, []);
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
cd worker/ludmilla && rm -rf _dt-cobranca && npx tsc -p tsconfig.test.json --outDir _dt-cobranca
```

Expected: FALHA de compilação — `'CobrancaParaAgendar'` não exportado de `fila.js`, `agendarCobranca` não existe em `DepsEnel`, `referencias` não existe em `MensagemLida`.

- [ ] **Step 4: `MensagemLida.referencias` em `caixa.ts`**

Em `worker/ludmilla/src/email/caixa.ts`, na interface `MensagemLida`, depois de `anexosSemNome: number;`, acrescente:

```ts
  /**
   * Os Message-IDs do cabeçalho `References` (a conversa até aqui). A cobrança da troca
   * responde NA conversa da nota e precisa deles (email/enel/cobranca.ts). Opcional: quem
   * monta `MensagemLida` à mão (os testes) não precisa dizer.
   */
  referencias?: string[];
```

E em `extrairMensagem`, no objeto devolvido, depois de `anexosSemNome,`, acrescente:

```ts
    // mailparser devolve texto OU lista, conforme o e-mail; cada item pode ter vários ids
    referencias: ([] as string[]).concat(p.references ?? []).flatMap(r => String(r).split(/\s+/)).filter(r => r.length > 0),
```

- [ ] **Step 5: As duas RPCs em `fila.ts`**

No fim de `worker/ludmilla/src/fila.ts`, acrescente:

```ts
// ── Cobrança da troca do relógio (ENEL) ──────────────────────────────────────
// Nome SIMPLES, como as outras RPCs de e-mail: só a VPS chama (service_role). O erro
// do PostgREST pode citar a linha recusada (assunto, nome) — por isso a exceção leva
// só o CÓDIGO, nunca a mensagem crua (ela sobe para o log de quem chama).

export interface CobrancaParaAgendar {
  accountId: string; messageId: string; projectId: string;
  nota: string | null; dataNota: string; prazoDias: number | null;
  para: string; assunto: string; inReplyTo: string | null; referencias: string[];
}

/** `criada | atualizada | mantida | mais_antiga | projeto_inativo | para_recusado | conta_recusada | mensagem_inexistente` */
export async function agendarCobranca(p: CobrancaParaAgendar): Promise<string> {
  const { data, error } = await supabase().rpc('ludmilla_cobranca_agendar' as never, {
    p_account_id: p.accountId, p_message_id: p.messageId, p_project_id: p.projectId, p_nota: p.nota,
    p_data_nota: p.dataNota, p_prazo_dias: p.prazoDias, p_para: p.para, p_assunto: p.assunto,
    p_in_reply_to: p.inReplyTo, p_referencias: p.referencias.length ? p.referencias.join(' ') : null,
  } as never);
  if (error) throw new Error(`Não consegui agendar a cobrança da troca (código ${error.code ?? 'sem código'})`);
  return String(data ?? '');
}

/** A ENEL avisou que trocou: encerra as cobranças do projeto. Devolve quantas. */
export async function encerrarCobrancasPorTroca(accountId: string, projectId: string, quando: string): Promise<number> {
  const { data, error } = await supabase().rpc('ludmilla_cobranca_encerrar_por_troca' as never, {
    p_account_id: accountId, p_project_id: projectId, p_quando: quando,
  } as never);
  if (error) throw new Error(`Não consegui encerrar as cobranças da troca (código ${error.code ?? 'sem código'})`);
  return Number(data ?? 0);
}
```

- [ ] **Step 6: O run da ENEL agenda e encerra**

Em `worker/ludmilla/src/email/enel/run.ts`:

1. Nos imports de `../../fila.js`, acrescente `agendarCobranca, encerrarCobrancasPorTroca,` e, numa linha nova:

```ts
import { cobrancaDaMensagem, dataBr, trocaFoiRealizada, vencimento } from './cobranca.js';
```

2. Na interface `DepsEnel`, depois do último campo, acrescente:

```ts
  /**
   * Cobrança da troca do relógio (24/10/2026). OPCIONAIS só para os dublês que já
   * existiam não mudarem; `DEPS_ENEL` (produção) tem as duas — um teste confere.
   */
  agendarCobranca?: typeof agendarCobranca;
  encerrarCobrancas?: typeof encerrarCobrancasPorTroca;
```

3. Em `DEPS_ENEL`, acrescente `agendarCobranca, encerrarCobrancas: encerrarCobrancasPorTroca,` à lista.

4. Em `tratarMensagemEnel`, no caminho do projeto achado, logo ANTES da linha `const concluida = !passageira && !anexoFalhou;`, acrescente:

```ts
  // A cobrança da troca do relógio (spec 2026-10-24 §3.2 e §3.5). ANTES do registro
  // concluído, pelo mesmo motivo do sino: se o banco falhar, a exceção sobe com a linha
  // ainda `concluida = false` (aberta em abrirTentativa) e a retentativa agenda. Só o
  // código do projeto vai para o log: a nota, o assunto e o endereço ficam no banco.
  const daNota = cobrancaDaMensagem(classificacao, m, agora);
  if (daNota.tipo === 'nota' && deps.agendarCobranca) {
    const r = await deps.agendarCobranca({
      accountId: run.account_id, messageId: m.messageId, projectId: projeto.project_id, ...daNota.dados,
    });
    if (r === 'criada' || r === 'atualizada') {
      ressalvas.push(daNota.dados.nota
        ? `cobrança da nota ${daNota.dados.nota} à ENEL agendada para ${dataBr(vencimento(new Date(daNota.dados.dataNota)))}`
        : 'cobrança à ENEL agendada SEM o número da nota (não achei no e-mail): confira antes de enviar');
    }
    log('cobrança da troca', { projeto: projeto.codigo, resultado: r, com_numero: daNota.dados.nota !== null });
  } else if (daNota.tipo === 'fora_da_enel') {
    log('nota de serviço de remetente fora da ENEL: não agendei cobrança', { nivel: 'aviso', projeto: projeto.codigo });
  }
  if (trocaFoiRealizada(classificacao) && deps.encerrarCobrancas) {
    const n = await deps.encerrarCobrancas(run.account_id, projeto.project_id, (m.recebidoEm ?? agora).toISOString());
    if (n > 0) ressalvas.push(`${n} cobrança(s) à ENEL encerrada(s): a troca foi feita`);
    log('cobranças encerradas pela troca', { projeto: projeto.codigo, encerradas: n });
  }
```

(`classificacao`, `projeto`, `ressalvas`, `agora`, `m`, `run` e `log` já existem nesse ponto da função. Se a frente "troca realizada" mexeu nesse trecho, o ponto de inserção continua sendo "antes do `const concluida`".)

- [ ] **Step 7: Rodar e ver passar, e a suíte inteira**

```bash
cd worker/ludmilla && rm -rf _dt-cobranca && npx tsc -p tsconfig.test.json --outDir _dt-cobranca && node --test _dt-cobranca/test/*.test.js 2>&1 | tail -12
git diff --stat -- worker/ludmilla/src/email/index.ts worker/ludmilla/test/enel-run.test.ts worker/ludmilla/test/email-run.test.ts
```

Expected: `# fail 0`; o total = o da Task 3 + os 14 novos; o `git diff --stat` VAZIO (o caminho da EDP e os testes de hoje sem mudança).

- [ ] **Step 8: Mutação — o agendamento DEPOIS do registro**

Com a ferramenta Edit, mova o bloco do Step 6.4 para DEPOIS do `await deps.registrarEmailLido({ … })` final. Rode o Step 7: tem de cair `a cobrança é agendada ANTES do registro concluído` e `o agendamento falhou: … nada fica registrado como concluído`. Desfaça e rode de novo: `# fail 0`.

- [ ] **Step 9: Compilar o robô de verdade**

Run: `cd worker/ludmilla && npx tsc -p tsconfig.json --noEmit`
Expected: sem erro.

- [ ] **Step 10: Commit**

Escreva `$RASCUNHO/msg-t4.txt`:

```text
feat(ludmilla): a leitura da ENEL agenda a cobrança da nota de serviço

E-mail de troca agendada (ou o reenvio da nota com o número) vira uma
cobrança agendada para 7 dias depois, com o destinatário travado na
ENEL e os cabeçalhos para responder na conversa da nota; "troca
realizada" encerra as cobranças do projeto. Agendado ANTES do registro
concluído: falha de banco faz a mensagem ser relida, não perdida. EDP
intacta; os testes de hoje sem mudança (arquivo de teste novo).

Co-Authored-By: <o modelo que executou> <noreply@anthropic.com>
```

```bash
cd worker/ludmilla && rm -rf _dt-cobranca && cd ../..
git add worker/ludmilla/src/email/caixa.ts worker/ludmilla/src/fila.ts worker/ludmilla/src/email/enel/run.ts worker/ludmilla/test/enel-cobranca-run.test.ts
git commit -F "$RASCUNHO/msg-t4.txt" -- worker/ludmilla/src/email/caixa.ts worker/ludmilla/src/fila.ts worker/ludmilla/src/email/enel/run.ts worker/ludmilla/test/enel-cobranca-run.test.ts
git show --stat HEAD
```

---

### Task 5: Worker — o run `enviar_cobranca` (SMTP, travas de novo, nunca reenvia sozinho)

**Files:**
- Modify: `worker/ludmilla/package.json`, `worker/ludmilla/package-lock.json` (`nodemailer` 10.0.16 exata)
- Create: `worker/ludmilla/src/email/smtp.ts`
- Create: `worker/ludmilla/src/email/enel/enviar.ts`
- Modify: `worker/ludmilla/src/fila.ts` (`Run.tipo`, `CobrancaParaEnviar`, `iniciarEnvioDeCobranca`, `cobrancaEnviada`, `cobrancaFalhou`)
- Modify: `worker/ludmilla/src/index.ts` (desvio do run antes do Playwright)
- Test: `worker/ludmilla/test/enel-envio.test.ts`

**Interfaces:**
- Consumes: `podeEnviar`, `ajustarSaudacao` (Task 3); `credencialDaCaixa` (`fila.ts`, a de hoje); RPCs `ludmilla_cobranca_iniciar_envio`, `ludmilla_cobranca_enviada`, `ludmilla_cobranca_falhou` (Task 1).
- Produces:
  - em `email/smtp.ts`: `interface EmailDeSaida { de; para; assunto; texto: string; inReplyTo: string | null; referencias: string[] }`; `interface TransporteDeEnvio { sendMail(o: SendMailOptions): Promise<{ messageId: string }>; verify(): Promise<unknown>; close(): void }`; `PORTAS_DO_SMTP = [465, 587]`; `type PortaDoSmtp = 465 | 587`; `opcoesDoEnvio(m): SendMailOptions`; `opcoesDoTransporte(c, porta)`; `transporteGmail(c, porta): TransporteDeEnvio`; `deveTentarOutraPorta(e: unknown): boolean`; `enviarPorSmtp(c, m, criar?): Promise<string>` (o Message-ID que saiu); `verificarSmtp(c, criar?): Promise<{ porta: PortaDoSmtp }>`; `falhaDoEnvio(e: unknown): string`.
  - em `email/enel/enviar.ts`: `interface DepsEnvio`, `DEPS_ENVIO`, `type ResultadoDoEnvio = 'enviada' | 'enviada_sem_registro' | 'recusada' | 'falhou'`, `executarEnvioDeCobranca(run: Run, deps?: DepsEnvio, agora?: () => Date): Promise<ResultadoDoEnvio>` (nunca lança).
  - em `fila.ts`: `Run.tipo` aceita `'enviar_cobranca'`; `interface CobrancaParaEnviar { recusa; cobrancaId; situacaoAnterior; aprovadaPor; ultimaEnviadaEm; para; assunto; texto: string | null; inReplyTo: string | null; referencias: string[]; nota: string | null }`; `iniciarEnvioDeCobranca(runId): Promise<CobrancaParaEnviar>`; `cobrancaEnviada(runId, messageId): Promise<void>`; `cobrancaFalhou(runId, erro): Promise<void>`.

- [ ] **Step 1: Conferir a frente anterior e a dependência**

```bash
git status --short worker/ludmilla
cd worker/ludmilla
npm view nodemailer@10.0.16 version time.10.0.16 license dependencies
```

Expected: `git status` vazio; `10.0.16`, `2026-10-07T13:45:26.303Z` (mais de 14 dias antes do dia da execução), `MIT-0`, e nenhuma dependência listada.

- [ ] **Step 2: Instalar com a versão fixa e auditar**

```bash
cd worker/ludmilla
npm i -E nodemailer@10.0.16 --no-fund
npm audit --omit=dev
grep -n '"nodemailer"' package.json
```

Expected: `package.json` com `"nodemailer": "10.0.16"` (SEM `^`); `package-lock.json` atualizado; `npm audit` sem aviso para o `nodemailer` (aviso de outro pacote que já existia antes: anote e siga). Se houver aviso para o `nodemailer` 10.0.16: PARE e leve ao usuário a versão mais antiga, publicada há mais de 14 dias, que o corrige. O nodemailer 10 traz os próprios tipos: NÃO instale `@types/nodemailer`.

- [ ] **Step 3: Escrever o teste que falha**

Crie `worker/ludmilla/test/enel-envio.test.ts`:

```ts
// worker/ludmilla/test/enel-envio.test.ts
// O envio da cobrança aprovada: o que o SMTP recebe, as travas do worker e o que vai
// (e o que NUNCA vai) para o banco e para o log. Senha, caixa e textos inventados; nada
// sai para a rede (dublês e o streamTransport do nodemailer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {
  PORTAS_DO_SMTP, deveTentarOutraPorta, enviarPorSmtp, falhaDoEnvio, opcoesDoEnvio, opcoesDoTransporte, verificarSmtp,
  type EmailDeSaida, type PortaDoSmtp, type TransporteDeEnvio,
} from '../src/email/smtp.js';
import { executarEnvioDeCobranca, type DepsEnvio } from '../src/email/enel/enviar.js';
import type { CobrancaParaEnviar, Run } from '../src/fila.js';

const SENHA_FALSA = 'abcd efgh ijkl mnop';
const CAIXA = { email: 'ludmilla.caixa@exemplo.test', senha: SENHA_FALSA };
const SAIDA: EmailDeSaida = {
  de: CAIXA.email, para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
  texto: 'Prezados, bom dia.\n\nTexto aprovado de exemplo.\n\nAtenciosamente,\nEquipe GD Manager',
  inReplyTo: '<cob-nota-1@enel.test>', referencias: ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>'],
};

async function comLogs<T>(f: () => Promise<T>): Promise<{ r: T; logs: string }> {
  const original = console.log;
  const linhas: string[] = [];
  console.log = (linha?: unknown) => { linhas.push(String(linha)); };
  try { return { r: await f(), logs: linhas.join('\n') }; } finally { console.log = original; }
}
const erro = (o: Record<string, unknown>, msg = 'falhou') => Object.assign(new Error(msg), o);

// ── o que o SMTP recebe ────────────────────────────────────────────────────

test('opcoesDoEnvio: envelope SÓ com o destinatário travado, sem Cc/Bcc, só texto, sem arquivo nem URL', () => {
  const o = opcoesDoEnvio(SAIDA);
  assert.deepEqual(o.envelope, { from: CAIXA.email, to: ['canalgd.sp@br.enel.com'] });
  assert.equal(o.to, 'canalgd.sp@br.enel.com');
  for (const k of ['cc', 'bcc', 'html', 'attachments', 'replyTo']) assert.equal(k in o, false, k);
  assert.equal(o.disableFileAccess, true);
  assert.equal(o.disableUrlAccess, true);
  assert.equal(o.inReplyTo, '<cob-nota-1@enel.test>');
  assert.deepEqual(o.references, ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>']);
});

test('opcoesDoEnvio: sem a nota, nada de In-Reply-To nem References', () => {
  const o = opcoesDoEnvio({ ...SAIDA, inReplyTo: null, referencias: [] });
  assert.equal('inReplyTo' in o, false);
  assert.equal('references' in o, false);
});

test('a mensagem que o nodemailer monta: na conversa da nota e para o destinatário certo (sem rede)', async () => {
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const info = await t.sendMail(opcoesDoEnvio(SAIDA)) as unknown as { message: Buffer; envelope: { from: string; to: string[] } };
  const bruto = info.message.toString('utf8');
  assert.deepEqual(info.envelope, { from: CAIXA.email, to: ['canalgd.sp@br.enel.com'] });
  assert.match(bruto, /^To: canalgd\.sp@br\.enel\.com$/m);
  assert.match(bruto, /^From: ludmilla\.caixa@exemplo\.test$/m);
  assert.match(bruto, /^In-Reply-To: <cob-nota-1@enel\.test>$/m);
  assert.match(bruto, /^References: <cob-pedido@exemplo\.test> <cob-nota-1@enel\.test>$/m);
  assert.match(bruto, /^Subject: /m);
  assert.doesNotMatch(bruto, /^(Cc|Bcc):/im);
  assert.match(bruto, /Equipe GD Manager/);
});

test('opcoesDoTransporte: 465 com TLS, 587 com STARTTLS obrigatório, senha sem espaços, sem log', () => {
  const a = opcoesDoTransporte(CAIXA, 465);
  assert.equal(a.host, 'smtp.gmail.com');
  assert.equal(a.secure, true);
  assert.equal(a.requireTLS, false);
  assert.equal(a.auth.user, CAIXA.email);
  assert.equal(a.auth.pass, 'abcdefghijklmnop');
  assert.equal(a.logger, false);
  assert.equal(a.debug, false);
  const b = opcoesDoTransporte(CAIXA, 587);
  assert.equal(b.secure, false);
  assert.equal(b.requireTLS, true);
  assert.deepEqual([...PORTAS_DO_SMTP], [465, 587]);
});

test('deveTentarOutraPorta: só falha de CONEXÃO (nada foi transmitido)', () => {
  assert.equal(deveTentarOutraPorta(erro({ code: 'ECONNECTION', command: 'CONN' })), true);
  assert.equal(deveTentarOutraPorta(erro({ code: 'ETIMEDOUT', command: 'CONN' })), true);
  assert.equal(deveTentarOutraPorta(erro({ code: 'EAUTH', command: 'AUTH PLAIN' })), false);
  assert.equal(deveTentarOutraPorta(erro({ code: 'ETIMEDOUT', command: 'DATA' })), false);
  assert.equal(deveTentarOutraPorta(erro({})), false);
  assert.equal(deveTentarOutraPorta(null), false);
});

function transportes(roteiro: (Error | string)[]) {
  const portas: PortaDoSmtp[] = [];
  const fechados: PortaDoSmtp[] = [];
  const criar = (_c: { email: string; senha: string }, porta: PortaDoSmtp): TransporteDeEnvio => {
    portas.push(porta);
    const passo = roteiro[portas.length - 1];
    return {
      async sendMail() { if (passo instanceof Error) throw passo; return { messageId: passo }; },
      async verify() { if (passo instanceof Error) throw passo; return true; },
      close() { fechados.push(porta); },
    };
  };
  return { criar, portas, fechados };
}

test('enviarPorSmtp: a 465 não conecta → tenta a 587; fecha os dois transportes', async () => {
  const t = transportes([erro({ code: 'ECONNECTION', command: 'CONN' }), '<enviada@exemplo.test>']);
  assert.equal(await enviarPorSmtp(CAIXA, SAIDA, t.criar), '<enviada@exemplo.test>');
  assert.deepEqual(t.portas, [465, 587]);
  assert.deepEqual(t.fechados, [465, 587]);
});

test('enviarPorSmtp: senha recusada NÃO tenta a outra porta', async () => {
  const t = transportes([erro({ code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 })]);
  await assert.rejects(enviarPorSmtp(CAIXA, SAIDA, t.criar), (e: Error & { code?: string }) => e.code === 'EAUTH');
  assert.deepEqual(t.portas, [465]);
  assert.deepEqual(t.fechados, [465]);
});

test('enviarPorSmtp: as duas portas sem conexão → sobe o último erro', async () => {
  const t = transportes([erro({ code: 'ETIMEDOUT', command: 'CONN' }), erro({ code: 'ECONNECTION', command: 'CONN' })]);
  await assert.rejects(enviarPorSmtp(CAIXA, SAIDA, t.criar), (e: Error & { code?: string }) => e.code === 'ECONNECTION');
});

test('verificarSmtp: diz qual porta respondeu, sem mandar nada', async () => {
  const t = transportes([erro({ code: 'ETIMEDOUT', command: 'CONN' }), 'ok']);
  assert.deepEqual(await verificarSmtp(CAIXA, t.criar), { porta: 587 });
});

test('falhaDoEnvio: razão curta e código; NUNCA a mensagem crua (pode ter senha, caixa ou texto)', () => {
  const comSenha = erro({ code: 'EAUTH', responseCode: 535 }, `Invalid login: 535 user ${CAIXA.email} pass ${SENHA_FALSA}`);
  const r = falhaDoEnvio(comSenha);
  assert.match(r, /senha de app/);
  assert.match(r, /EAUTH 535/);
  assert.ok(!r.includes(SENHA_FALSA) && !r.includes('abcdefghijklmnop') && !r.includes(CAIXA.email), r);
  assert.match(falhaDoEnvio(erro({ code: 'ECONNECTION' })), /não consegui falar com o servidor/);
  assert.match(falhaDoEnvio(erro({ code: 'EENVELOPE', responseCode: 550 })), /recusou o destinatário/);
  assert.match(falhaDoEnvio(erro({ responseCode: 554 })), /recusou a mensagem/);
  assert.equal(falhaDoEnvio(new Error('qualquer coisa com Prezados, bom dia')), 'falha inesperada no envio');
  assert.equal(falhaDoEnvio('texto solto'), 'falha inesperada no envio');
});

// ── o run enviar_cobranca ──────────────────────────────────────────────────

const RUN: Run = { id: 'run-envio-1', tenant_id: 'tenant-cob', account_id: 'conta-enel', tipo: 'enviar_cobranca', situacao: 'rodando' };
const COBRANCA: CobrancaParaEnviar = {
  recusa: null, cobrancaId: 'c-1', situacaoAnterior: 'aguardando_envio', aprovadaPor: 'pessoa-1', ultimaEnviadaEm: null,
  para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
  texto: 'Prezados, bom dia.\n\nReferente à nota de serviço nº 400012345678 — titular TEODORICO VALADARES QUINTINO.\n\nAtenciosamente,\nEquipe GD Manager',
  inReplyTo: '<cob-nota-1@enel.test>', referencias: ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>'], nota: '400012345678',
};
/** 13:00 em Brasília */
const TARDE = new Date('2026-10-24T16:00:00Z');

function envio(o: {
  cobranca?: Partial<CobrancaParaEnviar>; iniciarFalha?: boolean; credFalha?: boolean; smtp?: Error; enviadaFalhas?: number;
} = {}) {
  const d = { ordem: [] as string[], enviados: [] as EmailDeSaida[], enviadas: [] as [string, string][], falhas: [] as [string, string][] };
  let falhasDaEnviada = o.enviadaFalhas ?? 0;
  const deps: DepsEnvio = {
    async iniciarEnvio(runId) {
      d.ordem.push('iniciar');
      if (o.iniciarFalha) throw new Error('rede caiu');
      assert.equal(runId, RUN.id);
      return { ...COBRANCA, ...o.cobranca };
    },
    async credencialDaCaixa(conta) {
      d.ordem.push('credencial');
      if (o.credFalha) throw new Error('sem agent_config');
      assert.equal(conta, RUN.account_id);
      return CAIXA;
    },
    async enviar(c, m) {
      d.ordem.push('enviar');
      assert.equal(c.senha, SENHA_FALSA);
      if (o.smtp) throw o.smtp;
      d.enviados.push(m);
      return '<saiu-1@exemplo.test>';
    },
    async enviada(runId, id) {
      d.ordem.push('enviada');
      if (falhasDaEnviada-- > 0) throw new Error('banco fora');
      d.enviadas.push([runId, id]);
    },
    async falhou(runId, motivo) { d.ordem.push('falhou'); d.falhas.push([runId, motivo]); },
  };
  return { deps, d };
}
const rodar = (deps: DepsEnvio) => comLogs(() => executarEnvioDeCobranca(RUN, deps, () => TARDE));

test('aprovada e travada na ENEL: sai UMA vez, com a saudação da hora, e o banco registra', async () => {
  const { deps, d } = envio();
  const { r } = await rodar(deps);
  assert.equal(r, 'enviada');
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'enviada']);
  assert.equal(d.enviados.length, 1);
  const m = d.enviados[0];
  assert.equal(m.de, CAIXA.email);
  assert.equal(m.para, 'canalgd.sp@br.enel.com');
  assert.equal(m.assunto, 'RE: TROCA DE RELÓGIO - NT 391000010');
  assert.equal(m.texto, COBRANCA.texto!.replace('Prezados, bom dia.', 'Prezados, boa tarde.'));
  assert.equal(m.inReplyTo, '<cob-nota-1@enel.test>');
  assert.deepEqual(m.referencias, ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>']);
  assert.deepEqual(d.enviadas, [[RUN.id, '<saiu-1@exemplo.test>']]);
  assert.deepEqual(d.falhas, []);
});

test('o banco recusou: nada sai, e o banco fecha com o motivo dele', async () => {
  const recusa = 'este pedido de envio não veio da aprovação da cobrança';
  const { deps, d } = envio({ cobranca: { recusa, para: null, texto: null } });
  assert.equal((await rodar(deps)).r, 'recusada');
  assert.deepEqual(d.ordem, ['iniciar', 'falhou']);
  assert.deepEqual(d.falhas, [[RUN.id, recusa]]);
});

for (const [caso, cobranca, motivo] of [
  ['destinatário fora da ENEL vindo do banco', { para: 'canal@exemplo.test' }, /@enel\.com/],
  ['menos de 7 dias desde o último envio', { ultimaEnviadaEm: new Date(TARDE.getTime() - 2 * 86_400_000).toISOString() }, /7 dias/],
  ['sem aprovação de uma pessoa', { aprovadaPor: null }, /aprovada/],
  ['não estava esperando envio', { situacaoAnterior: 'agendada' }, /esperando envio/],
] as [string, Partial<CobrancaParaEnviar>, RegExp][]) {
  test(`trava do WORKER (o banco deixou passar): ${caso} — nada sai`, async () => {
    const { deps, d } = envio({ cobranca });
    assert.equal((await rodar(deps)).r, 'recusada');
    assert.equal(d.enviados.length, 0);
    assert.ok(!d.ordem.includes('enviar'));
    assert.match(d.falhas[0][1], motivo);
    assert.match(d.falhas[0][1], /nada foi enviado/);
  });
}

test('o SMTP recusou a senha: o banco recebe a razão curta, nunca a senha nem o texto; o log idem', async () => {
  const smtp = erro({ code: 'EAUTH', responseCode: 535 }, `Invalid login ${SENHA_FALSA} Referente à nota de serviço nº 400012345678 — titular TEODORICO`);
  const { deps, d } = envio({ smtp });
  const { r, logs } = await rodar(deps);
  assert.equal(r, 'falhou');
  assert.match(d.falhas[0][1], /senha de app.*EAUTH 535/);
  for (const proibido of [SENHA_FALSA, 'abcdefghijklmnop', 'TEODORICO', 'Referente', '400012345678']) {
    assert.ok(!d.falhas[0][1].includes(proibido), `o banco recebeu "${proibido}"`);
    assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
  }
});

test('saiu e o registro falhou UMA vez: tenta de novo e registra; NUNCA chama falhou', async () => {
  const { deps, d } = envio({ enviadaFalhas: 1 });
  assert.equal((await rodar(deps)).r, 'enviada');
  assert.deepEqual(d.enviadas, [[RUN.id, '<saiu-1@exemplo.test>']]);
  assert.deepEqual(d.falhas, []);
});

test('saiu e o registro falhou DUAS vezes: enviada_sem_registro, sem falhou (devolver faria alguém reenviar)', async () => {
  const { deps, d } = envio({ enviadaFalhas: 2 });
  assert.equal((await rodar(deps)).r, 'enviada_sem_registro');
  assert.equal(d.enviados.length, 1);
  assert.deepEqual(d.falhas, []);
});

test('sem o acesso à caixa: nada sai', async () => {
  const { deps, d } = envio({ credFalha: true });
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.equal(d.enviados.length, 0);
  assert.match(d.falhas[0][1], /acesso à caixa/);
});

test('o banco caiu no começo: nada sai', async () => {
  const { deps, d } = envio({ iniciarFalha: true });
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.deepEqual(d.ordem, ['iniciar', 'falhou']);
});

test('o log diz o run e o endereço da ENEL, e nada do texto, do assunto, do titular, da nota ou da senha', async () => {
  const { deps } = envio();
  const { logs } = await rodar(deps);
  assert.match(logs, new RegExp(RUN.id));
  assert.match(logs, /canalgd\.sp@br\.enel\.com/);
  for (const proibido of ['TEODORICO', 'Referente', 'RELÓGIO', '400012345678', SENHA_FALSA, 'abcdefghijklmnop', CAIXA.email]) {
    assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
  }
});
```

- [ ] **Step 4: Rodar e ver falhar**

```bash
cd worker/ludmilla && rm -rf _dt-cobranca && npx tsc -p tsconfig.test.json --outDir _dt-cobranca
```

Expected: FALHA de compilação — `Cannot find module '../src/email/smtp.js'`, `'../src/email/enel/enviar.js'`, e `CobrancaParaEnviar` não exportado.

- [ ] **Step 5: `fila.ts` — o tipo do run e as três RPCs do envio**

Em `worker/ludmilla/src/fila.ts`, na interface `Run`, troque a linha do `tipo` por:

```ts
  tipo: 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura' | 'criar_projeto' | 'varredura_email' | 'enviar_cobranca';
```

E no fim do arquivo, depois de `encerrarCobrancasPorTroca` (Task 4), acrescente:

```ts
/** O que `ludmilla_cobranca_iniciar_envio` devolve. `recusa` nula = pode enviar (a cobrança já está `enviando`). */
export interface CobrancaParaEnviar {
  recusa: string | null;
  cobrancaId: string | null;
  situacaoAnterior: string | null;
  aprovadaPor: string | null;
  ultimaEnviadaEm: string | null;
  para: string | null;
  assunto: string | null;
  texto: string | null;
  inReplyTo: string | null;
  referencias: string[];
  nota: string | null;
}

export async function iniciarEnvioDeCobranca(runId: string): Promise<CobrancaParaEnviar> {
  const { data, error } = await supabase().rpc('ludmilla_cobranca_iniciar_envio' as never, { p_run_id: runId } as never);
  if (error) throw new Error(`Não consegui iniciar o envio da cobrança (código ${error.code ?? 'sem código'})`);
  const l = ((data ?? []) as Record<string, unknown>[])[0];
  // a RPC responde SEMPRE uma linha: vazio é função velha no banco — melhor estourar
  if (!l) throw new Error('o banco não respondeu ao pedido de envio (ludmilla_cobranca_iniciar_envio está desatualizada?)');
  const s = (k: string): string | null => (l[k] == null ? null : String(l[k]));
  return {
    recusa: s('recusa'), cobrancaId: s('cobranca_id'), situacaoAnterior: s('situacao_anterior'),
    aprovadaPor: s('aprovada_por'), ultimaEnviadaEm: s('ultima_enviada_em'), para: s('para'),
    assunto: s('assunto'), texto: s('texto'), inReplyTo: s('in_reply_to'),
    referencias: (s('referencias') ?? '').split(' ').filter(x => x.length > 0), nota: s('nota_servico'),
  };
}

export async function cobrancaEnviada(runId: string, messageId: string): Promise<void> {
  const { error } = await supabase().rpc('ludmilla_cobranca_enviada' as never, { p_run_id: runId, p_message_id: messageId } as never);
  if (error) throw new Error(`Não consegui registrar o envio da cobrança (código ${error.code ?? 'sem código'})`);
}

/** O motivo vai para o banco e para a tela: só razão curta, nunca mensagem crua de terceiro. */
export async function cobrancaFalhou(runId: string, erro: string): Promise<void> {
  const { error } = await supabase().rpc('ludmilla_cobranca_falhou' as never, { p_run_id: runId, p_erro: erro.slice(0, 500) } as never);
  if (error) throw new Error(`Não consegui registrar a falha do envio (código ${error.code ?? 'sem código'})`);
}
```

- [ ] **Step 6: `smtp.ts`**

Crie `worker/ludmilla/src/email/smtp.ts`:

```ts
// worker/ludmilla/src/email/smtp.ts
import nodemailer, { type SendMailOptions } from 'nodemailer';

/**
 * O ENVIO por SMTP — só o da cobrança da troca, aprovada por uma pessoa
 * (email/enel/enviar.ts). A MESMA conta Gmail e a MESMA senha de app do IMAP
 * (`credencialDaCaixa`). Nada aqui decide SE envia: isso é das travas (`podeEnviar` e o
 * banco). Aqui se garante COMO: envelope SMTP explícito (só o destinatário travado), sem
 * Cc/Bcc, só texto, sem anexo, sem acesso a arquivo ou URL, sem log da biblioteca.
 */

export interface EmailDeSaida {
  de: string;
  para: string;
  assunto: string;
  texto: string;
  inReplyTo: string | null;
  referencias: string[];
}

/** O pedaço do transporte que usamos (o teste usa um de mentira). */
export interface TransporteDeEnvio {
  sendMail(o: SendMailOptions): Promise<{ messageId: string }>;
  verify(): Promise<unknown>;
  close(): void;
}

/** 465 (TLS direto) primeiro; 587 (STARTTLS) só se a 465 nem conectar. */
export const PORTAS_DO_SMTP = [465, 587] as const;
export type PortaDoSmtp = (typeof PORTAS_DO_SMTP)[number];
type Caixa = { email: string; senha: string };
type CriarTransporte = (c: Caixa, porta: PortaDoSmtp) => TransporteDeEnvio;

export function opcoesDoEnvio(m: EmailDeSaida): SendMailOptions {
  return {
    from: m.de,
    to: m.para,
    subject: m.assunto,
    text: m.texto,
    ...(m.inReplyTo ? { inReplyTo: m.inReplyTo } : {}),
    ...(m.referencias.length ? { references: m.referencias } : {}),
    // o RCPT TO é EXATAMENTE o destinatário travado: o nodemailer não tira endereço do cabeçalho
    envelope: { from: m.de, to: [m.para] },
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function opcoesDoTransporte(c: Caixa, porta: PortaDoSmtp) {
  return {
    host: 'smtp.gmail.com',
    port: porta,
    secure: porta === 465,
    requireTLS: porta !== 465,
    // a senha de app do Gmail aparece com espaços; o IMAP (caixa.ts) já tira, aqui também
    auth: { user: c.email, pass: c.senha.replace(/\s+/g, '') },
    logger: false,
    debug: false,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  };
}

export function transporteGmail(c: Caixa, porta: PortaDoSmtp): TransporteDeEnvio {
  const t = nodemailer.createTransport(opcoesDoTransporte(c, porta));
  return {
    sendMail: async o => ({ messageId: String((await t.sendMail(o)).messageId ?? '') }),
    verify: () => t.verify(),
    close: () => t.close(),
  };
}

/**
 * Só a falha na CONEXÃO autoriza a outra porta: o nodemailer marca `command = 'CONN'`
 * quando nada foi transmitido. Senha recusada, destinatário recusado ou queda no meio do
 * DATA NÃO tentam de novo (no último, a mensagem pode ter saído).
 */
export function deveTentarOutraPorta(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { command?: unknown }).command === 'CONN';
}

async function nasPortas<T>(c: Caixa, criar: CriarTransporte, fazer: (t: TransporteDeEnvio, porta: PortaDoSmtp) => Promise<T>): Promise<T> {
  let ultimo: unknown = new Error('nenhuma porta do SMTP tentada');
  for (const porta of PORTAS_DO_SMTP) {
    const t = criar(c, porta);
    try {
      return await fazer(t, porta);
    } catch (e) {
      ultimo = e;
      if (!deveTentarOutraPorta(e)) throw e;
    } finally {
      t.close();
    }
  }
  throw ultimo;
}

/** Manda o e-mail; devolve o Message-ID que saiu. */
export function enviarPorSmtp(c: Caixa, m: EmailDeSaida, criar: CriarTransporte = transporteGmail): Promise<string> {
  return nasPortas(c, criar, async t => (await t.sendMail(opcoesDoEnvio(m))).messageId);
}

/** Conecta e autentica, SEM mandar nada (o teste da VPS, Task 6). Diz qual porta respondeu. */
export function verificarSmtp(c: Caixa, criar: CriarTransporte = transporteGmail): Promise<{ porta: PortaDoSmtp }> {
  return nasPortas(c, criar, async (t, porta) => { await t.verify(); return { porta }; });
}

/**
 * A razão CURTA da falha, com o código — o que vai para o banco, para a tela e para o log.
 * A mensagem crua do servidor fica de fora: ela pode citar a caixa, o texto ou a senha.
 */
export function falhaDoEnvio(e: unknown): string {
  const x = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; responseCode?: unknown };
  const codigo = typeof x.code === 'string' ? x.code : '';
  const resposta = typeof x.responseCode === 'number' ? x.responseCode : null;
  const razao =
    codigo === 'EAUTH' || resposta === 535 ? 'o Gmail recusou a senha de app da caixa'
    : codigo === 'EENVELOPE' || resposta === 550 || resposta === 551 || resposta === 553 ? 'o servidor recusou o destinatário'
    : codigo === 'EMESSAGE' || resposta === 552 || resposta === 554 ? 'o servidor recusou a mensagem'
    : ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'ECONNREFUSED', 'ECONNRESET'].includes(codigo)
      ? 'não consegui falar com o servidor de e-mail (porta bloqueada ou rede fora)'
    : 'falha inesperada no envio';
  const cod = [codigo, resposta === null ? '' : String(resposta)].filter(s => s !== '').join(' ');
  return cod ? `${razao} (${cod})` : razao;
}
```

- [ ] **Step 7: `enviar.ts`**

Crie `worker/ludmilla/src/email/enel/enviar.ts`:

```ts
// worker/ludmilla/src/email/enel/enviar.ts
import {
  cobrancaEnviada, cobrancaFalhou, credencialDaCaixa, iniciarEnvioDeCobranca, type CobrancaParaEnviar, type Run,
} from '../../fila.js';
import { enviarPorSmtp, falhaDoEnvio, type EmailDeSaida } from '../smtp.js';
import { ajustarSaudacao, podeEnviar } from './cobranca.js';

/**
 * Run `enviar_cobranca`: manda a cobrança que UMA PESSOA aprovou na aba Decidir.
 *  1. o banco "pega" a cobrança (`iniciarEnvio`: confere as travas e a deixa `enviando`);
 *  2. o worker confere as travas DE NOVO (`podeEnviar`), sem confiar no banco;
 *  3. SMTP pela caixa da Ludmilla, na conversa da nota;
 *  4. `enviada` (histórico, card, próxima em 7 dias) — ou `falhou` (volta para a equipe).
 * Depois que o SMTP aceitou, NADA chama `falhou`: devolver a cobrança faria alguém reenviar.
 * Nunca lança (o laço principal não tem try). Log: o run, o endereço da ENEL e a razão
 * curta — nunca o texto, o assunto, o titular, a nota ou a senha.
 */

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

export interface DepsEnvio {
  iniciarEnvio: (runId: string) => Promise<CobrancaParaEnviar>;
  credencialDaCaixa: (accountId: string) => Promise<{ email: string; senha: string }>;
  enviar: (c: { email: string; senha: string }, m: EmailDeSaida) => Promise<string>;
  enviada: (runId: string, messageId: string) => Promise<void>;
  falhou: (runId: string, erro: string) => Promise<void>;
}
export const DEPS_ENVIO: DepsEnvio = {
  iniciarEnvio: iniciarEnvioDeCobranca,
  credencialDaCaixa,
  enviar: (c, m) => enviarPorSmtp(c, m),
  enviada: cobrancaEnviada,
  falhou: cobrancaFalhou,
};

export type ResultadoDoEnvio = 'enviada' | 'enviada_sem_registro' | 'recusada' | 'falhou';

export async function executarEnvioDeCobranca(
  run: Run, deps: DepsEnvio = DEPS_ENVIO, agora: () => Date = () => new Date(),
): Promise<ResultadoDoEnvio> {
  log('envio de cobrança iniciado', { run: run.id });
  const fechar = async (r: 'recusada' | 'falhou', motivo: string): Promise<ResultadoDoEnvio> => {
    log(r === 'recusada' ? 'cobrança não enviada: a trava recusou' : 'cobrança não enviada: falhou', { nivel: 'falha', run: run.id, motivo });
    await deps.falhou(run.id, motivo).catch(() => log('não consegui fechar o envio no banco', { nivel: 'falha', run: run.id }));
    return r;
  };

  let c: CobrancaParaEnviar;
  try {
    c = await deps.iniciarEnvio(run.id);
  } catch {
    return fechar('falhou', 'não consegui ler a cobrança no banco');
  }
  if (c.recusa) return fechar('recusada', c.recusa);

  // a trava do WORKER, independente do banco (spec §3.4)
  const pode = podeEnviar(
    { situacaoAnterior: c.situacaoAnterior, aprovadaPor: c.aprovadaPor, ultimaEnviadaEm: c.ultimaEnviadaEm, para: c.para, texto: c.texto },
    agora(),
  );
  if (!pode.ok) return fechar('recusada', `${pode.motivo}: nada foi enviado`);

  let caixa: { email: string; senha: string };
  try {
    caixa = await deps.credencialDaCaixa(run.account_id);
  } catch {
    return fechar('falhou', 'não consegui ler o acesso à caixa de e-mail');
  }

  const saida: EmailDeSaida = {
    de: caixa.email,
    para: c.para ?? '',
    assunto: c.assunto ?? 'RE: TROCA DE RELÓGIO',
    texto: ajustarSaudacao(c.texto ?? '', agora()),
    inReplyTo: c.inReplyTo,
    referencias: c.referencias,
  };
  let id: string;
  try {
    id = await deps.enviar(caixa, saida);
  } catch (e) {
    return fechar('falhou', falhaDoEnvio(e));
  }

  // SAIU. Registrar (duas tentativas); se o banco não responder, o envio que "não
  // confirmou" volta para a equipe em 30 min com o aviso de conferir a pasta Enviados.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      await deps.enviada(run.id, id);
      log('cobrança enviada à ENEL', { run: run.id, para: saida.para });
      return 'enviada';
    } catch {
      log('o e-mail SAIU, mas não consegui registrar no banco', { nivel: 'falha', run: run.id, tentativa });
    }
  }
  return 'enviada_sem_registro';
}
```

- [ ] **Step 8: Desviar o run no laço**

Em `worker/ludmilla/src/index.ts`, acrescente o import

```ts
import { executarEnvioDeCobranca } from './email/enel/enviar.js';
```

e, logo DEPOIS do bloco `if (run.tipo === 'varredura_email') { … continue; }`, acrescente:

```ts
    if (run.tipo === 'enviar_cobranca') {
      // a cobrança que uma pessoa aprovou sai por SMTP (email/enel/enviar.ts): não abre
      // navegador. Só a VPS pega este run: a conta da ENEL é 'vps', e a fila da estação
      // (ludmilla_claim_run_local) só pega conta 'local'.
      await executarEnvioDeCobranca(run).catch(e => log('o envio da cobrança caiu', { run: run.id, classe: (e as Error).name }));
      await dormir(5_000);
      continue;
    }
```

- [ ] **Step 9: Rodar e ver passar; compilar o robô**

```bash
cd worker/ludmilla && rm -rf _dt-cobranca && npx tsc -p tsconfig.test.json --outDir _dt-cobranca && node --test _dt-cobranca/test/*.test.js 2>&1 | tail -12
npx tsc -p tsconfig.json --noEmit
git diff --stat -- src/email/index.ts src/email/rotear.ts src/email/caixa.ts
```

Expected: `# fail 0`, total = o da Task 4 + os 22 novos; `tsc` sem erro; o `git diff --stat` VAZIO (nem a EDP, nem o roteamento, nem a leitura mudaram nesta tarefa).

- [ ] **Step 10: Mutações**

Uma por vez, com Edit, rodando `node --test _dt-cobranca/test/enel-envio.test.js` depois de recompilar, e desfazendo:

| Mutação | O teste que tem de cair |
|---|---|
| em `enviar.ts`, apagar `if (!pode.ok) return fechar(…)` | os quatro `trava do WORKER (o banco deixou passar): …` |
| em `smtp.ts`, `if (!deveTentarOutraPorta(e)) throw e;` → apagada | `enviarPorSmtp: senha recusada NÃO tenta a outra porta` |
| em `smtp.ts`, `envelope: { from: m.de, to: [m.para] },` → apagada | `opcoesDoEnvio: envelope SÓ com o destinatário travado…` |
| em `enviar.ts`, trocar `return 'enviada_sem_registro';` por `return fechar('falhou', 'sem registro');` | `saiu e o registro falhou DUAS vezes…` |

Depois da última, a suíte inteira de novo: `# fail 0`.

- [ ] **Step 11: Commit**

Escreva `$RASCUNHO/msg-t5.txt`:

```text
feat(ludmilla): run enviar_cobranca manda a cobrança aprovada por SMTP

O banco pega a cobrança (aprovada, para a ENEL, 7 dias desde o último
envio) e o worker confere tudo de novo antes de abrir o SMTP pela mesma
conta e senha de app do IMAP. Resposta na conversa da nota (In-Reply-To,
References), envelope só com o destinatário travado, saudação da hora.
Falha volta para a equipe com a razão curta; depois que saiu, nunca
devolve (nada de reenvio). Dependência nova: nodemailer 10.0.16 exata
(zero dependências, tipos próprios, mesmo autor do imapflow/mailparser).

Co-Authored-By: <o modelo que executou> <noreply@anthropic.com>
```

```bash
cd worker/ludmilla && rm -rf _dt-cobranca && cd ../..
git add worker/ludmilla/package.json worker/ludmilla/package-lock.json worker/ludmilla/src/email/smtp.ts worker/ludmilla/src/email/enel/enviar.ts worker/ludmilla/src/fila.ts worker/ludmilla/src/index.ts worker/ludmilla/test/enel-envio.test.ts
git commit -F "$RASCUNHO/msg-t5.txt" -- worker/ludmilla/package.json worker/ludmilla/package-lock.json worker/ludmilla/src/email/smtp.ts worker/ludmilla/src/email/enel/enviar.ts worker/ludmilla/src/fila.ts worker/ludmilla/src/index.ts worker/ludmilla/test/enel-envio.test.ts
git show --stat HEAD
```

---

### Task 6: Worker — o teste do SMTP na VPS (verificar; e-mail só para a própria caixa)

**Files:**
- Create: `worker/ludmilla/src/email/enel/teste-smtp.ts`
- Modify: `worker/ludmilla/src/fila.ts` (`contaDaEnel`)
- Modify: `worker/ludmilla/deploy/instalar.sh` (comando `/usr/local/bin/ludmilla-teste-smtp`)
- Modify: `.github/workflows/ludmilla-worker.yml` (entrada `smtp` + o passo)
- Test: `worker/ludmilla/test/enel-teste-smtp.test.ts`

**Interfaces:**
- Consumes: `verificarSmtp`, `enviarPorSmtp`, `falhaDoEnvio`, `EmailDeSaida` (Task 5); `credencialDaCaixa`.
- Produces:
  - `modoDoTeste(argv: readonly string[]): 'verificar' | 'enviar' | null`; `emailDeTeste(caixa: string, agora: Date): EmailDeSaida` (de = para = a caixa).
  - em `fila.ts`: `contaDaEnel(): Promise<string>` (o id da conta da ENEL por e-mail).
  - na VPS: `sudo ludmilla-teste-smtp --verificar | --enviar-para-a-propria-caixa`; no GitHub: `gh workflow run ludmilla-worker.yml -f smtp=verificar` (ou `enviar_para_a_propria_caixa`). A Task 10 usa.

- [ ] **Step 1: Escrever o teste que falha**

Crie `worker/ludmilla/test/enel-teste-smtp.test.ts`:

```ts
// worker/ludmilla/test/enel-teste-smtp.test.ts
// O teste do SMTP da VPS: só dois modos, e o e-mail de teste nunca sai da própria caixa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailDeTeste, modoDoTeste } from '../src/email/enel/teste-smtp.js';

test('modoDoTeste: só os dois modos, sozinhos', () => {
  assert.equal(modoDoTeste(['--verificar']), 'verificar');
  assert.equal(modoDoTeste(['--enviar-para-a-propria-caixa']), 'enviar');
  assert.equal(modoDoTeste([]), null);
  assert.equal(modoDoTeste(['--verificar', '--enviar-para-a-propria-caixa']), null);
  assert.equal(modoDoTeste(['--enviar-para-a-propria-caixa', 'alguem@exemplo.test']), null, 'não aceita destinatário');
  assert.equal(modoDoTeste(['--para', 'alguem@exemplo.test']), null);
});

test('emailDeTeste: de = para = a caixa da Ludmilla, sem conversa nenhuma', () => {
  const m = emailDeTeste('ludmilla.caixa@exemplo.test', new Date('2026-10-24T12:00:00Z'));
  assert.equal(m.de, 'ludmilla.caixa@exemplo.test');
  assert.equal(m.para, 'ludmilla.caixa@exemplo.test');
  assert.equal(m.inReplyTo, null);
  assert.deepEqual(m.referencias, []);
  assert.match(m.assunto, /Teste de envio da Ludmilla/);
  assert.match(m.texto, /Nenhuma concessionária recebeu/);
});
```

Run: `cd worker/ludmilla && rm -rf _dt-cobranca && npx tsc -p tsconfig.test.json --outDir _dt-cobranca`
Expected: FALHA — `Cannot find module '../src/email/enel/teste-smtp.js'`.

- [ ] **Step 2: `contaDaEnel` em `fila.ts`**

No fim de `worker/ludmilla/src/fila.ts`:

```ts
/** A conta da ENEL por e-mail (a única que cobra). Só a VPS chama (service role). */
export async function contaDaEnel(): Promise<string> {
  const { data, error } = await supabase()
    .from('portal_accounts')
    .select('id')
    .eq('connector', 'enel')
    .eq('acompanhamento', 'email')
    .limit(1);
  if (error) throw new Error(`Não consegui achar a conta da ENEL (código ${error.code ?? 'sem código'})`);
  const id = ((data ?? []) as { id: string }[])[0]?.id;
  if (!id) throw new Error('Não há conta da ENEL por e-mail.');
  return id;
}
```

- [ ] **Step 3: O comando**

Crie `worker/ludmilla/src/email/enel/teste-smtp.ts`:

```ts
// worker/ludmilla/src/email/enel/teste-smtp.ts
import { pathToFileURL } from 'node:url';
import { contaDaEnel, credencialDaCaixa } from '../../fila.js';
import { enviarPorSmtp, falhaDoEnvio, verificarSmtp, type EmailDeSaida } from '../smtp.js';

/**
 * Teste do SMTP da caixa da Ludmilla, na VPS, pelo workflow `ludmilla-worker.yml`
 * (entrada `smtp`, lista fechada) → `/usr/local/bin/ludmilla-teste-smtp`:
 *   --verificar                    conecta e autentica; NÃO manda nada
 *   --enviar-para-a-propria-caixa  UM e-mail de teste com de = para = a caixa da Ludmilla
 * Não existe opção de destinatário: o teste nunca escreve para ninguém de fora. A saída
 * é UMA linha JSON, sem a senha e sem o endereço da caixa.
 */

export type ModoDoTeste = 'verificar' | 'enviar';

export function modoDoTeste(argv: readonly string[]): ModoDoTeste | null {
  if (argv.length !== 1) return null;
  if (argv[0] === '--verificar') return 'verificar';
  if (argv[0] === '--enviar-para-a-propria-caixa') return 'enviar';
  return null;
}

export function emailDeTeste(caixa: string, agora: Date): EmailDeSaida {
  return {
    de: caixa,
    para: caixa,
    assunto: 'Teste de envio da Ludmilla (pode apagar)',
    texto: `Teste do SMTP da caixa da Ludmilla em ${agora.toISOString()}. Nenhuma concessionária recebeu esta mensagem.`,
    inReplyTo: null,
    referencias: [],
  };
}

const saida = (o: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

async function principal(): Promise<number> {
  const modo = modoDoTeste(process.argv.slice(2));
  if (!modo) { saida({ msg: 'uso: --verificar | --enviar-para-a-propria-caixa' }); return 2; }
  let caixa: { email: string; senha: string };
  try {
    caixa = await credencialDaCaixa(await contaDaEnel());
  } catch {
    saida({ msg: 'teste do smtp falhou', razao: 'não consegui ler o acesso à caixa (conta da ENEL / agent_config)' });
    return 1;
  }
  try {
    if (modo === 'verificar') {
      const { porta } = await verificarSmtp(caixa);
      saida({ msg: 'smtp ok: conectou e autenticou, nada foi enviado', porta });
    } else {
      const id = await enviarPorSmtp(caixa, emailDeTeste(caixa.email, new Date()));
      saida({ msg: 'teste enviado para a própria caixa da Ludmilla', enviado: id !== '' });
    }
    return 0;
  } catch (e) {
    saida({ msg: 'teste do smtp falhou', razao: falhaDoEnvio(e) });
    return 1;
  }
}

// só quando rodado como comando (importar no teste não executa)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void principal().then(c => process.exit(c));
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd worker/ludmilla && rm -rf _dt-cobranca && npx tsc -p tsconfig.test.json --outDir _dt-cobranca && node --test _dt-cobranca/test/*.test.js 2>&1 | tail -12
npx tsc -p tsconfig.json --noEmit
```

Expected: `# fail 0` (total da Task 5 + 2); `tsc` sem erro.

- [ ] **Step 5: O comando na VPS (`instalar.sh`)**

Em `worker/ludmilla/deploy/instalar.sh`, logo DEPOIS da linha `echo "espaço em /var/tmp: …"` (fim do bloco do comando `bdgd`) e ANTES de `passo "ambiente em $ENV_DIR/env (só root lê)"`, acrescente:

```bash
passo "comando ludmilla-teste-smtp (/usr/local/bin/ludmilla-teste-smtp)"
# Teste do SMTP da caixa da Ludmilla (cobrança da troca na ENEL). As mesmas armadilhas do
# bdgd: o env é 600 e só o root lê, e o comando roda como o usuário ludmilla. Só aceita
# os dois modos fixos — nunca um destinatário.
cat > /usr/local/bin/ludmilla-teste-smtp <<'WRAP'
#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "rode com sudo: sudo ludmilla-teste-smtp --verificar" >&2; exit 1; }
case "${1:-}" in
  --verificar|--enviar-para-a-propria-caixa) ;;
  *) echo "uso: sudo ludmilla-teste-smtp --verificar | --enviar-para-a-propria-caixa" >&2; exit 1 ;;
esac
[ -r /etc/ludmilla/env ] || { echo "falta /etc/ludmilla/env — rode o deploy do worker primeiro" >&2; exit 1; }
set -a; . /etc/ludmilla/env; set +a
: "${SUPABASE_URL:?SUPABASE_URL ausente em /etc/ludmilla/env}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY ausente em /etc/ludmilla/env}"
exec sudo -u ludmilla -H env \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  PATH=/usr/local/bin:/usr/bin:/bin \
  node /opt/ludmilla/dist/email/enel/teste-smtp.js "$1"
WRAP
chmod 755 /usr/local/bin/ludmilla-teste-smtp
echo "instalado: sudo ludmilla-teste-smtp --verificar"
```

Run: `bash -n worker/ludmilla/deploy/instalar.sh`
Expected: sem saída (sintaxe ok).

- [ ] **Step 6: A entrada `smtp` do workflow**

Em `.github/workflows/ludmilla-worker.yml`, em `on.workflow_dispatch.inputs`, depois do bloco `bdgd_forcar:` (que termina em `default: false`), acrescente:

```yaml
      # Teste do SMTP da caixa (cobrança da troca na ENEL) depois do deploy. Lista FECHADA:
      # vira um argumento fixo no comando remoto, nunca texto vindo de fora.
      smtp:
        description: 'Depois do deploy, testar o SMTP da caixa: verificar (não envia) ou enviar para a própria caixa'
        type: choice
        default: ''
        options:
          - ''
          - verificar
          - enviar_para_a_propria_caixa
```

E no FIM do arquivo, depois do passo `Ingestão da BDGD`, acrescente:

```yaml
      # Roda o comando que o instalar.sh acabou de instalar. Nenhum segredo passa por
      # aqui: o comando lê /etc/ludmilla/env na própria VPS. A saída é uma linha JSON.
      - name: Teste do SMTP
        if: ${{ inputs.smtp != '' && !inputs.simular }}
        timeout-minutes: 5
        env:
          MODO: ${{ inputs.smtp }}
        run: |
          case "$MODO" in
            verificar) ARG="--verificar" ;;
            enviar_para_a_propria_caixa) ARG="--enviar-para-a-propria-caixa" ;;
            *) echo "modo inválido: $MODO" >&2; exit 1 ;;
          esac
          ssh -i ~/.ssh/deploy_key -p ${{ secrets.VPS_SSH_PORT }} -o StrictHostKeyChecking=no \
            ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} \
            "/usr/local/bin/ludmilla-teste-smtp $ARG"
```

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/ludmilla-worker.yml','utf8'); if(!/smtp:\n\s+description/.test(y)||!/name: Teste do SMTP/.test(y)) process.exit(1); console.log('ok')"`
Expected: `ok`. (Sem `actionlint` na máquina: a validação real é o primeiro `gh workflow run` da Task 10.)

- [ ] **Step 7: Commit**

Escreva `$RASCUNHO/msg-t6.txt`:

```text
feat(ludmilla): teste do SMTP da caixa na VPS pelo workflow

ludmilla-teste-smtp --verificar conecta e autentica sem mandar nada;
--enviar-para-a-propria-caixa manda UM e-mail de teste com de = para =
a caixa da Ludmilla. Não aceita destinatário. O workflow ganha a
entrada smtp (lista fechada); nenhum segredo passa pelo GitHub além do
que já passava.

Co-Authored-By: <o modelo que executou> <noreply@anthropic.com>
```

```bash
cd worker/ludmilla && rm -rf _dt-cobranca && cd ../..
git add worker/ludmilla/src/email/enel/teste-smtp.ts worker/ludmilla/src/fila.ts worker/ludmilla/deploy/instalar.sh .github/workflows/ludmilla-worker.yml worker/ludmilla/test/enel-teste-smtp.test.ts
git commit -F "$RASCUNHO/msg-t6.txt" -- worker/ludmilla/src/email/enel/teste-smtp.ts worker/ludmilla/src/fila.ts worker/ludmilla/deploy/instalar.sh .github/workflows/ludmilla-worker.yml worker/ludmilla/test/enel-teste-smtp.test.ts
git show --stat HEAD
```

---

### Task 7: Front — a lógica pura (o e-mail da cobrança, o selo, Enviar/Dispensar)

**Files:**
- Create: `src/lib/ludmillaCobranca.ts`
- Create: `src/lib/ludmillaCobranca.fixtures.ts` (dados inventados; código do app NUNCA importa)
- Modify: `src/lib/ludmillaCaixa.ts` (tipo `cobrar_troca`, campos `cobranca_id`/`cobranca` no `Afazer`, selo, busca pela nota)
- Modify: `src/lib/ludmillaPainel.ts` (ações, texto do aviso com Desfazer, situação decidida, visibilidade, comentário do agendamento)
- Test: `src/lib/ludmillaCobranca.test.ts`, `src/lib/ludmillaPainel.cobranca.test.ts` (arquivos NOVOS)

**Interfaces:**
- Consumes: `ItemDaCaixa`, `Afazer`, `itensDaCaixa`, `filtrarItens` (`ludmillaCaixa.ts`); fixtures de `ludmillaCaixa.fixtures.ts` (`TENANT`, `CONTAS_DE_EXEMPLO`, `F_VISTORIA`, `nomeDaContaDeExemplo`, `rotuloDeExemplo`); a migração da Task 1 (o teste lê as lacunas dela).
- Produces:
  - em `ludmillaCobranca.ts`: `ASSINATURA_DA_COBRANCA = 'Equipe GD Manager'`; `LACUNAS = ['[NÚMERO DA NOTA]', '[UC]', '[TITULAR]', '[NT]']`; `TAMANHO_MAXIMO_DO_TEXTO = 5000`; `type SituacaoDaCobranca`; `interface CobrancaDoAfazer` (o embed); `dataBr(d)`, `horaEmBrasilia(d)`, `saudacao(d)`, `dadosDoEmail(c)`, `montarEmailDeCobranca(c, agora): string`, `rascunhoDaCobranca(c, agora): string`, `textoPronto(texto): { ok: true; porque: null } | { ok: false; porque: string }`, `resumoDaCobranca(c): string`.
  - em `ludmillaCaixa.ts`: `TipoAfazer` + `'cobrar_troca'`; `Afazer.cobranca_id?: string | null`, `Afazer.cobranca?: CobrancaDoAfazer | null`.
  - em `ludmillaPainel.ts`: `AcaoDaDecisao` + `'enviar_cobranca' | 'dispensar_cobranca'`; `acoesDoItem(item, etapa, texto = '')`; `SituacaoDecidida.rotulo` + `'Aprovada' | 'Dispensada' | 'Encerrada'`; `VisibilidadeDoDetalhe.cobranca: boolean`.
  - em `ludmillaCobranca.fixtures.ts`: `COBRANCA_BASE`, `cobrancaAfazer(id, c, extra)`, `F_COBRANCA`, `F_COBRANCA_SEM_NOTA`, `F_COBRANCA_FALHOU`, `F_COBRANCA_SEGUNDA`, `F_COBRANCA_APROVADA`, `F_COBRANCA_DISPENSADA`, `F_COBRANCA_ENCERRADA`, `AFAZERES_DE_COBRANCA`.

- [ ] **Step 1: Conferir a frente da página nova e medir o tsc**

```bash
git status --short src/
git log --oneline -3 -- src/pages/Ludmilla.tsx
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"
```

Expected: `git status --short src/` VAZIO (a Task 8 da página nova commitada, sem harness dela na árvore — nem `src/harness-pagina.tsx` nem `src/harness-duble/`); o último commit de `Ludmilla.tsx` é o da Task 8 da página nova; o tsc dá **65** (anote o número; é o baseline desta tarefa). Se `git status` listar qualquer coisa, PARE: a frente anterior não terminou.

- [ ] **Step 2: As fixtures**

Crie `src/lib/ludmillaCobranca.fixtures.ts`:

```ts
/**
 * DADOS INVENTADOS da cobrança da troca do relógio, para testes e harness. Nenhum nome,
 * nota, UC ou NT aqui é de verdade (o canalgd.sp@br.enel.com é o remetente público da
 * regra da ENEL). Código do app NUNCA importa este arquivo.
 */
import type { Afazer } from '@/lib/ludmillaCaixa';
import type { CobrancaDoAfazer } from '@/lib/ludmillaCobranca';
import { TENANT } from '@/lib/ludmillaCaixa.fixtures';

export const COBRANCA_BASE: CobrancaDoAfazer = {
  id: 'c-1', nota_servico: '400000000123', data_nota: '2026-10-01T15:00:00Z', prazo_dias: 7,
  para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - MARTA EXEMPLO PRADO - NT 391000099',
  situacao: 'aguardando_envio', enviadas: 0, ultima_enviada_em: null, ultimo_texto_enviado: null,
  texto_aprovado: null, erro: null, motivo_encerramento: null, vence_em: '2026-10-08T15:00:00Z',
  projeto: { protocol_number: '391000099', project_general_data: { holder_name: 'MARTA EXEMPLO PRADO', uc_number: '0055009001' } },
};

const projeto = (id: string, code: string, titular: string) => ({
  id, code, status: 'approved', title: titular, companies: { name: 'Solar Exemplo' }, project_general_data: { holder_name: titular },
});

export const cobrancaAfazer = (id: string, c: Partial<CobrancaDoAfazer>, extra: Partial<Afazer> = {}): Afazer => ({
  id, tenant_id: TENANT, account_id: 'conta-enel', project_id: 'p-20001', mensagem_id: null, tipo: 'cobrar_troca',
  titulo: '📡 Cobrar a ENEL — troca do relógio do PRJ-20001 (nota 400000000123)',
  mensagem: 'A nota de serviço foi aberta em 01/10/2026 e a ENEL ainda não confirmou a troca. Revise o e-mail e envie, ou dispense.',
  criado_em: '2026-10-22T11:05:00Z', feito_por: null, feito_em: null,
  project: projeto('p-20001', 'PRJ-20001', 'MARTA EXEMPLO PRADO'), feito: null,
  cobranca_id: c.id ?? COBRANCA_BASE.id, cobranca: { ...COBRANCA_BASE, ...c }, ...extra,
});

export const F_COBRANCA = cobrancaAfazer('f-cob', {});
export const F_COBRANCA_SEM_NOTA = cobrancaAfazer('f-cob-sem', { id: 'c-2', nota_servico: null }, {
  titulo: '📡 Cobrar a ENEL — troca do relógio do PRJ-20001 (nota sem número)', criado_em: '2026-10-22T11:06:00Z',
});
export const F_COBRANCA_FALHOU = cobrancaAfazer('f-cob-falhou', {
  id: 'c-3', erro: 'o Gmail recusou a senha de app da caixa (EAUTH 535)',
  texto_aprovado: 'Prezados, bom dia.\n\nTexto que a equipe já tinha aprovado (exemplo).\n\nAtenciosamente,\nEquipe GD Manager',
}, { titulo: '📡 A cobrança da nota 400000000123 não saiu', criado_em: '2026-10-22T11:07:00Z' });
export const F_COBRANCA_SEGUNDA = cobrancaAfazer('f-cob-2a', {
  id: 'c-4', enviadas: 1, ultima_enviada_em: '2026-10-15T14:00:00Z',
  ultimo_texto_enviado: 'Prezados, bom dia.\n\nPrimeira cobrança (exemplo).\n\nAtenciosamente,\nEquipe GD Manager',
}, { criado_em: '2026-10-22T11:08:00Z' });
export const F_COBRANCA_APROVADA = cobrancaAfazer('f-cob-ok', {
  id: 'c-5', situacao: 'agendada', enviadas: 1, ultima_enviada_em: '2026-10-22T14:00:00Z', vence_em: '2026-10-29T14:00:00Z',
}, { feito_por: 'pessoa-2', feito_em: '2026-10-22T13:59:00Z', feito: { name: 'Bia Exemplo' } });
export const F_COBRANCA_DISPENSADA = cobrancaAfazer('f-cob-disp', { id: 'c-6', situacao: 'dispensada' }, {
  feito_por: 'pessoa-2', feito_em: '2026-10-21T10:00:00Z', feito: { name: 'Bia Exemplo' },
});
export const F_COBRANCA_ENCERRADA = cobrancaAfazer('f-cob-enc', {
  id: 'c-7', situacao: 'encerrada', motivo_encerramento: 'a ENEL avisou que a troca do relógio foi feita',
}, { feito_em: '2026-10-20T09:00:00Z' });

export const AFAZERES_DE_COBRANCA = [
  F_COBRANCA, F_COBRANCA_SEM_NOTA, F_COBRANCA_FALHOU, F_COBRANCA_SEGUNDA,
  F_COBRANCA_APROVADA, F_COBRANCA_DISPENSADA, F_COBRANCA_ENCERRADA,
];
```

- [ ] **Step 3: Escrever os testes que falham**

Crie `src/lib/ludmillaCobranca.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ASSINATURA_DA_COBRANCA, LACUNAS, TAMANHO_MAXIMO_DO_TEXTO, dadosDoEmail, dataBr, montarEmailDeCobranca,
  rascunhoDaCobranca, resumoDaCobranca, saudacao, textoPronto,
} from '@/lib/ludmillaCobranca';
import { COBRANCA_BASE } from '@/lib/ludmillaCobranca.fixtures';

/** 10:00 e 13:00 em Brasília */
const MANHA = new Date('2026-10-24T13:00:00Z');
const TARDE = new Date('2026-10-24T16:00:00Z');

describe('montarEmailDeCobranca — o modelo aprovado pelo usuário (spec §5)', () => {
  it('1ª cobrança de manhã: o texto inteiro, como aprovado', () => {
    expect(montarEmailDeCobranca(COBRANCA_BASE, MANHA)).toBe([
      'Prezados, bom dia.',
      '',
      'Referente à nota de serviço nº 400000000123, aberta em 01/10/2026 para a troca do medidor da instalação 0055009001 — titular MARTA EXEMPLO PRADO, NT 391000099:',
      '',
      'poderiam, por gentileza, confirmar se a troca já foi executada? Caso tenha sido reprogramada, pedimos a gentileza de nos informar a nova data.',
      '',
      'Atenciosamente,',
      'Equipe GD Manager',
    ].join('\n'));
  });

  it('depois do meio-dia: "boa tarde"', () => {
    expect(montarEmailDeCobranca(COBRANCA_BASE, TARDE).split('\n')[0]).toBe('Prezados, boa tarde.');
  });

  it('2ª cobrança: "retomando o e-mail abaixo", e a anterior citada embaixo', () => {
    const t = montarEmailDeCobranca({
      ...COBRANCA_BASE, enviadas: 1, ultima_enviada_em: '2026-10-15T14:00:00Z',
      ultimo_texto_enviado: 'Prezados, bom dia.\n\nPrimeira cobrança.',
    }, TARDE);
    expect(t.split('\n')[0]).toBe('Prezados, retomando o e-mail abaixo:');
    expect(t).toContain('Referente à nota de serviço nº 400000000123, aberta em 01/10/2026');
    expect(t).toContain('Atenciosamente,\nEquipe GD Manager\n\nEm 15/10/2026, Equipe GD Manager escreveu:\n> Prezados, bom dia.\n>\n> Primeira cobrança.');
  });

  it('o que falta no cadastro vira lacuna no texto (e trava o Enviar)', () => {
    const t = montarEmailDeCobranca({ ...COBRANCA_BASE, nota_servico: null, projeto: { protocol_number: 'Sem protocolo' } }, MANHA);
    for (const l of LACUNAS) expect(t).toContain(l);
  });

  it('o embed 1:1 que chega como lista também serve', () => {
    const d = dadosDoEmail({ ...COBRANCA_BASE, projeto: { protocol_number: '391.000.099', project_general_data: [{ holder_name: 'MARTA EXEMPLO PRADO', uc_number: '0055009001' }] } });
    expect(d).toEqual({ nota: '400000000123', dataDaNota: '01/10/2026', uc: '0055009001', titular: 'MARTA EXEMPLO PRADO', nt: '391000099' });
  });

  it('a assinatura mora num lugar só', () => {
    expect(ASSINATURA_DA_COBRANCA).toBe('Equipe GD Manager');
  });
});

describe('rascunhoDaCobranca', () => {
  it('o texto já aprovado que não saiu volta como rascunho; sem ele, o modelo', () => {
    expect(rascunhoDaCobranca({ ...COBRANCA_BASE, texto_aprovado: 'Prezados, bom dia.\n\nO que a pessoa escreveu.' }, MANHA))
      .toBe('Prezados, bom dia.\n\nO que a pessoa escreveu.');
    expect(rascunhoDaCobranca(COBRANCA_BASE, MANHA)).toBe(montarEmailDeCobranca(COBRANCA_BASE, MANHA));
  });
});

describe('textoPronto — a trava do Enviar na tela (o banco tem a mesma)', () => {
  it('modelo completo: pronto', () => {
    expect(textoPronto(montarEmailDeCobranca(COBRANCA_BASE, MANHA))).toEqual({ ok: true, porque: null });
  });
  it('lacuna, vazio ou longo demais: não', () => {
    expect(textoPronto('Prezados, bom dia. Instalação [UC], nota [NÚMERO DA NOTA].'))
      .toEqual({ ok: false, porque: 'Complete no texto: [NÚMERO DA NOTA], [UC].' });
    expect(textoPronto('   ').ok).toBe(false);
    expect(textoPronto('curto').ok).toBe(false);
    expect(textoPronto('x'.repeat(TAMANHO_MAXIMO_DO_TEXTO + 1)).ok).toBe(false);
  });
  it('as lacunas e o tamanho são os mesmos do banco (ludmilla_cobranca_aprovar)', () => {
    const sql = readFileSync('supabase/migrations/20261024150000_ludmilla_cobranca_troca.sql', 'utf8');
    for (const l of LACUNAS) expect(sql).toContain(`'${l}'`);
    expect(sql).toContain(`length(_texto) > ${TAMANHO_MAXIMO_DO_TEXTO}`);
  });
});

describe('saudacao e dataBr — horário de Brasília', () => {
  it('bom dia até 11:59, boa tarde a partir do meio-dia', () => {
    expect(saudacao(new Date('2026-10-24T14:59:00Z'))).toBe('bom dia');
    expect(saudacao(new Date('2026-10-24T15:00:00Z'))).toBe('boa tarde');
  });
  it('dd/mm/aaaa em Brasília', () => {
    expect(dataBr('2026-10-01T02:00:00Z')).toBe('30/09/2026');
  });
});

describe('resumoDaCobranca — o que a linha decidida diz', () => {
  it('cada situação', () => {
    expect(resumoDaCobranca({ ...COBRANCA_BASE, erro: 'o Gmail recusou a senha de app da caixa (EAUTH 535)' }))
      .toBe('O último envio não saiu: o Gmail recusou a senha de app da caixa (EAUTH 535)');
    expect(resumoDaCobranca(COBRANCA_BASE)).toBe('Esperando alguém da equipe revisar e enviar.');
    expect(resumoDaCobranca({ ...COBRANCA_BASE, situacao: 'enviando' })).toBe('Saindo agora pela caixa da Ludmilla.');
    expect(resumoDaCobranca({ ...COBRANCA_BASE, situacao: 'agendada', enviadas: 0 })).toBe('Agendada para 08/10/2026.');
    expect(resumoDaCobranca({ ...COBRANCA_BASE, situacao: 'agendada', enviadas: 2, ultima_enviada_em: '2026-10-22T14:00:00Z', vence_em: '2026-10-29T14:00:00Z' }))
      .toBe('Enviada 2× (a última em 22/10/2026). Próxima cobrança em 29/10/2026, se a ENEL não responder.');
    expect(resumoDaCobranca({ ...COBRANCA_BASE, situacao: 'encerrada', motivo_encerramento: 'a ENEL avisou que a troca do relógio foi feita' }))
      .toBe('Encerrada: a ENEL avisou que a troca do relógio foi feita');
    expect(resumoDaCobranca({ ...COBRANCA_BASE, situacao: 'dispensada' })).toBe('Dispensada pela equipe: não sai mais cobrança desta nota.');
  });
});
```

Crie `src/lib/ludmillaPainel.cobranca.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FILTRO_INICIAL, filtrarItens, itensDaCaixa, type ItemDaCaixa } from '@/lib/ludmillaCaixa';
import { acoesDoItem, situacaoDecidida, textoDaDecisao, visibilidadeDoDetalhe } from '@/lib/ludmillaPainel';
import { montarEmailDeCobranca } from '@/lib/ludmillaCobranca';
import { CONTAS_DE_EXEMPLO, F_VISTORIA, nomeDaContaDeExemplo, rotuloDeExemplo } from '@/lib/ludmillaCaixa.fixtures';
import {
  AFAZERES_DE_COBRANCA, COBRANCA_BASE, F_COBRANCA, F_COBRANCA_SEM_NOTA, cobrancaAfazer,
} from '@/lib/ludmillaCobranca.fixtures';

const itens = itensDaCaixa({
  updates: [], afazeres: [...AFAZERES_DE_COBRANCA, F_VISTORIA], contas: CONTAS_DE_EXEMPLO,
  nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
});
const item = (chave: string): ItemDaCaixa => {
  const i = itens.find(x => x.chave === chave);
  if (!i) throw new Error(`sem ${chave}`);
  return i;
};
const MANHA = new Date('2026-10-24T13:00:00Z');
const PRONTO = montarEmailDeCobranca(COBRANCA_BASE, MANHA);

describe('a cobrança na lista', () => {
  it('é um A fazer pendente com o selo "cobrar a ENEL"', () => {
    const i = item('f:f-cob');
    expect(i.situacao).toBe('pendente');
    expect(i.tipos).toEqual(['afazer']);
    expect(i.selos).toEqual([{ texto: 'A fazer: cobrar a ENEL', tom: 'afazer' }]);
  });
  it('a busca acha pelo número da nota', () => {
    const achados = filtrarItens(itens, { ...FILTRO_INICIAL, busca: '400000000123' }).map(i => i.chave);
    expect(achados).toContain('f:f-cob');
  });
});

describe('acoesDoItem — Enviar e Dispensar, nunca "Marcar como feito"', () => {
  it('texto pronto: Enviar habilitado e Dispensar', () => {
    expect(acoesDoItem(item('f:f-cob'), null, PRONTO)).toEqual({
      principal: { acao: 'enviar_cobranca', rotulo: 'Enviar', habilitada: true, porque: null },
      secundaria: { acao: 'dispensar_cobranca', rotulo: 'Dispensar' },
    });
  });
  it('texto com lacuna: Enviar desligado, dizendo o que falta', () => {
    const texto = montarEmailDeCobranca(F_COBRANCA_SEM_NOTA.cobranca!, MANHA);
    expect(acoesDoItem(item('f:f-cob-sem'), null, texto).principal)
      .toMatchObject({ acao: 'enviar_cobranca', habilitada: false, porque: 'Complete no texto: [NÚMERO DA NOTA].' });
  });
  it('texto vazio: Enviar desligado', () => {
    expect(acoesDoItem(item('f:f-cob'), null, '').principal?.habilitada).toBe(false);
  });
  it('a cobrança já saiu da espera (outra pessoa aprovou): Enviar desligado', () => {
    const outra = itensDaCaixa({
      updates: [], afazeres: [cobrancaAfazer('f-x', { id: 'c-x', situacao: 'enviando' })], contas: CONTAS_DE_EXEMPLO,
      nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
    })[0];
    expect(acoesDoItem(outra, null, PRONTO).principal).toMatchObject({ habilitada: false, porque: 'Esta cobrança não está mais esperando envio.' });
  });
  it('decidida: sem botões', () => {
    expect(acoesDoItem(item('f:f-cob-ok'), null, PRONTO)).toEqual({ principal: null, secundaria: null });
  });
  it('o A fazer comum continua com "Marcar como feito"', () => {
    expect(acoesDoItem(item('f:f-vistoria'), null).principal).toMatchObject({ acao: 'feito', rotulo: 'Marcar como feito' });
  });
});

describe('textoDaDecisao — o aviso com Desfazer diz para onde vai', () => {
  it('Enviar e Dispensar', () => {
    expect(textoDaDecisao(item('f:f-cob'), 'enviar_cobranca', null, rotuloDeExemplo))
      .toBe('PRJ-20001: cobrança da nota 400000000123 vai para canalgd.sp@br.enel.com');
    expect(textoDaDecisao(item('f:f-cob'), 'dispensar_cobranca', null, rotuloDeExemplo))
      .toBe('PRJ-20001: cobrança da nota 400000000123 dispensada');
    expect(textoDaDecisao(item('f:f-cob-sem'), 'enviar_cobranca', null, rotuloDeExemplo))
      .toBe('PRJ-20001: cobrança sem número de nota vai para canalgd.sp@br.enel.com');
  });
});

describe('situacaoDecidida — quem decidiu a cobrança', () => {
  it('aprovada, dispensada, ou encerrada pela Ludmilla', () => {
    expect(situacaoDecidida(item('f:f-cob-ok'))).toEqual({ rotulo: 'Aprovada', em: '2026-10-22T13:59:00Z', por: 'Bia Exemplo' });
    expect(situacaoDecidida(item('f:f-cob-disp'))).toMatchObject({ rotulo: 'Dispensada', por: 'Bia Exemplo' });
    expect(situacaoDecidida(item('f:f-cob-enc'))).toMatchObject({ rotulo: 'Encerrada', por: null });
  });
});

describe('visibilidadeDoDetalhe — a seção do e-mail só na cobrança', () => {
  it('cobrança: seção do e-mail, sem sugestão de etapa, com a linha do tempo do projeto', () => {
    expect(visibilidadeDoDetalhe(item('f:f-cob'))).toMatchObject({ cobranca: true, sugestao: false, seletor: false, linhaDoTempo: true });
  });
  it('o A fazer comum não tem a seção', () => {
    expect(visibilidadeDoDetalhe(item('f:f-vistoria')).cobranca).toBe(false);
  });
  it('a fixture do A fazer da cobrança é a mesma da lista', () => {
    expect(F_COBRANCA.cobranca?.para).toBe('canalgd.sp@br.enel.com');
  });
});
```

Run: `npx vitest run src/lib/ludmillaCobranca.test.ts src/lib/ludmillaPainel.cobranca.test.ts`
Expected: FALHA — `Failed to resolve import "@/lib/ludmillaCobranca"`.

- [ ] **Step 4: Escrever `ludmillaCobranca.ts`**

Crie `src/lib/ludmillaCobranca.ts`:

```ts
/**
 * A COBRANÇA DA TROCA DO RELÓGIO NA ENEL — funções puras, sem React.
 *
 * Spec: docs/superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md §3.3 e §5.
 * O texto que a pessoa revisa e aprova nasce AQUI. O robô só troca o "bom dia"/"boa tarde"
 * da primeira linha na hora do envio (worker/ludmilla/src/email/enel/cobranca.ts,
 * `ajustarSaudacao`), e só se ninguém mexeu nela — o resto sai como a pessoa aprovou.
 */

/** A assinatura (aprovada pelo usuário em 24/10/2026: "Pode ser, ótimo"). Trocar AQUI, e só aqui. */
export const ASSINATURA_DA_COBRANCA = 'Equipe GD Manager';

/** O que falta no cadastro vira uma destas no texto. Enquanto houver uma, nada sai (tela e banco). */
export const LACUNAS = ['[NÚMERO DA NOTA]', '[UC]', '[TITULAR]', '[NT]'] as const;

/** O mesmo teto de `ludmilla_cobranca_aprovar`. */
export const TAMANHO_MAXIMO_DO_TEXTO = 5000;
const TAMANHO_MINIMO_DO_TEXTO = 20;

export type SituacaoDaCobranca = 'agendada' | 'aguardando_envio' | 'enviando' | 'encerrada' | 'dispensada';

type DadosGerais = { holder_name?: string | null; uc_number?: string | null } | null | undefined;

/** O embed `cobranca:cobranca_id(...)` do A fazer (`SELECT_AFAZER`, useLudmillaDecidir.ts). */
export interface CobrancaDoAfazer {
  id: string;
  nota_servico: string | null;
  data_nota: string;
  prazo_dias: number | null;
  para: string;
  assunto: string;
  situacao: SituacaoDaCobranca;
  enviadas: number;
  ultima_enviada_em: string | null;
  ultimo_texto_enviado: string | null;
  texto_aprovado: string | null;
  erro: string | null;
  motivo_encerramento: string | null;
  vence_em: string;
  projeto?: { protocol_number: string | null; project_general_data?: DadosGerais | DadosGerais[] } | null;
}

const FUSO = 'America/Sao_Paulo';
const limpo = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** dd/mm/aaaa no horário de Brasília. */
export function dataBr(d: string | Date): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' }).format(x);
}

/** A hora (0–23) em Brasília. */
export function horaEmBrasilia(agora: Date): number {
  const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', hourCycle: 'h23' }).formatToParts(agora);
  return Number(partes.find(p => p.type === 'hour')?.value ?? '0');
}

/** "bom dia" até 11:59 de Brasília; "boa tarde" a partir do meio-dia. */
export function saudacao(agora: Date): 'bom dia' | 'boa tarde' {
  return horaEmBrasilia(agora) < 12 ? 'bom dia' : 'boa tarde';
}

export interface DadosDoEmail { nota: string; dataDaNota: string; uc: string; titular: string; nt: string }

/** O que preenche o modelo. NT = o protocolo do cadastro com 9 dígitos (na ENEL o protocolo É a NT). */
export function dadosDoEmail(c: CobrancaDoAfazer): DadosDoEmail {
  const bruto = c.projeto?.project_general_data;
  const g = Array.isArray(bruto) ? bruto[0] : bruto;
  const nt = (c.projeto?.protocol_number ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return {
    nota: c.nota_servico ?? '[NÚMERO DA NOTA]',
    dataDaNota: dataBr(c.data_nota),
    uc: limpo(g?.uc_number) ?? '[UC]',
    titular: limpo(g?.holder_name) ?? '[TITULAR]',
    nt: /^\d{9}$/.test(nt) ? nt : '[NT]',
  };
}

/** "> " em cada linha: a cobrança anterior, que o "retomando o e-mail abaixo" promete. */
const citar = (texto: string): string => texto.split(/\r?\n/).map(l => (l ? `> ${l}` : '>')).join('\n');

/**
 * O e-mail da cobrança (spec §5). A 1ª abre com a saudação da hora; da 2ª em diante, com
 * "Prezados, retomando o e-mail abaixo:" — e a cobrança anterior vai citada embaixo.
 */
export function montarEmailDeCobranca(c: CobrancaDoAfazer, agora: Date): string {
  const d = dadosDoEmail(c);
  const corpo = [
    c.enviadas > 0 ? 'Prezados, retomando o e-mail abaixo:' : `Prezados, ${saudacao(agora)}.`,
    '',
    `Referente à nota de serviço nº ${d.nota}, aberta em ${d.dataDaNota} para a troca do medidor da instalação ${d.uc} — titular ${d.titular}, NT ${d.nt}:`,
    '',
    'poderiam, por gentileza, confirmar se a troca já foi executada? Caso tenha sido reprogramada, pedimos a gentileza de nos informar a nova data.',
    '',
    'Atenciosamente,',
    ASSINATURA_DA_COBRANCA,
  ].join('\n');
  const anterior = c.enviadas > 0 ? limpo(c.ultimo_texto_enviado) : null;
  if (!anterior) return corpo;
  const cabecalho = c.ultima_enviada_em
    ? `Em ${dataBr(c.ultima_enviada_em)}, ${ASSINATURA_DA_COBRANCA} escreveu:`
    : `Na cobrança anterior, ${ASSINATURA_DA_COBRANCA} escreveu:`;
  return `${corpo}\n\n${cabecalho}\n${citar(anterior)}`;
}

/** O que a tela abre para editar: o texto já aprovado que não saiu (falha), senão o modelo. */
export function rascunhoDaCobranca(c: CobrancaDoAfazer, agora: Date): string {
  return limpo(c.texto_aprovado) ?? montarEmailDeCobranca(c, agora);
}

/** A trava do Enviar na tela. A do banco (`ludmilla_cobranca_aprovar`) é a mesma. */
export function textoPronto(texto: string): { ok: true; porque: null } | { ok: false; porque: string } {
  const t = texto.trim();
  if (t.length < TAMANHO_MINIMO_DO_TEXTO) return { ok: false, porque: 'Escreva o texto do e-mail.' };
  if (t.length > TAMANHO_MAXIMO_DO_TEXTO) return { ok: false, porque: `O texto passou de ${TAMANHO_MAXIMO_DO_TEXTO} caracteres.` };
  const falta = LACUNAS.filter(l => t.includes(l));
  if (falta.length > 0) return { ok: false, porque: `Complete no texto: ${falta.join(', ')}.` };
  return { ok: true, porque: null };
}

/** Uma frase sobre onde a cobrança está — para a linha já decidida. */
export function resumoDaCobranca(c: CobrancaDoAfazer): string {
  switch (c.situacao) {
    case 'aguardando_envio':
      return c.erro ? `O último envio não saiu: ${c.erro}` : 'Esperando alguém da equipe revisar e enviar.';
    case 'enviando':
      return 'Saindo agora pela caixa da Ludmilla.';
    case 'agendada':
      return c.enviadas > 0
        ? `Enviada ${c.enviadas}× (a última em ${dataBr(c.ultima_enviada_em ?? c.vence_em)}). Próxima cobrança em ${dataBr(c.vence_em)}, se a ENEL não responder.`
        : `Agendada para ${dataBr(c.vence_em)}.`;
    case 'encerrada':
      return c.motivo_encerramento ? `Encerrada: ${c.motivo_encerramento}` : 'Encerrada.';
    case 'dispensada':
      return 'Dispensada pela equipe: não sai mais cobrança desta nota.';
  }
}
```

- [ ] **Step 5: O tipo do A fazer em `ludmillaCaixa.ts`**

Em `src/lib/ludmillaCaixa.ts`:

1. Junto dos imports, acrescente `import type { CobrancaDoAfazer } from '@/lib/ludmillaCobranca';`.
2. Troque a linha do tipo por:

```ts
export type TipoAfazer = 'vistoria_aprovada' | 'troca_falhou' | 'devolucao' | 'aviso' | 'cobrar_troca';
```

3. Na interface `Afazer`, depois de `feito?: { name: string | null } | null;`, acrescente:

```ts
  /** só no `cobrar_troca`: a cobrança da troca do relógio (o embed de SELECT_AFAZER) */
  cobranca_id?: string | null;
  cobranca?: CobrancaDoAfazer | null;
```

4. Em `ROTULO_AFAZER`, acrescente a entrada `cobrar_troca: 'A fazer: cobrar a ENEL',`.
5. Em `doAfazer`, troque `textoDeBusca: textoDeBusca([codigo, titular, empresa, concessionaria]),` por:

```ts
      // a cobrança também se acha pelo número da nota de serviço
      textoDeBusca: textoDeBusca([codigo, titular, empresa, concessionaria, f.cobranca?.nota_servico]),
```

- [ ] **Step 6: As ações, os textos e a visibilidade em `ludmillaPainel.ts`**

Em `src/lib/ludmillaPainel.ts`:

1. Acrescente o import `import { textoPronto } from '@/lib/ludmillaCobranca';`.
2. Troque o comentário de `HORAS_SEM_LER_ATRASADA` (o trecho "O e-mail (EDP, ENEL) não tem agendamento: … Horas sem ler uma caixa de e-mail não são falha.") por:

```ts
 * Duas varreduras de portal por dia (cron `ludmilla-08h`/`ludmilla-17h`, 11h e 20h UTC):
 * mais de 18 h sem ler é rodada perdida. Vale SÓ para o portal. A ENEL por e-mail é lida de
 * hora em hora no expediente (cron `ludmilla-enel-email`, seg–sex 8h–18h, desde a cobrança da
 * troca, 24/10/2026) e a EDP só pelo "Verificar agora": fora do expediente, horas sem ler uma
 * caixa de e-mail não são falha.
```

3. Troque `export type AcaoDaDecisao = 'aplicar' | 'ignorar' | 'feito';` por:

```ts
export type AcaoDaDecisao = 'aplicar' | 'ignorar' | 'feito' | 'enviar_cobranca' | 'dispensar_cobranca';
```

4. Troque a interface `AcoesDoItem` por:

```ts
export interface AcoesDoItem {
  principal: { acao: 'aplicar' | 'feito' | 'enviar_cobranca'; rotulo: string; habilitada: boolean; porque: string | null } | null;
  secundaria: { acao: 'ignorar' | 'dispensar_cobranca'; rotulo: 'Ignorar' | 'Dispensar' } | null;
}
```

5. Troque a assinatura `export function acoesDoItem(item: ItemDaCaixa, etapa: string | null): AcoesDoItem {` por `export function acoesDoItem(item: ItemDaCaixa, etapa: string | null, texto = ''): AcoesDoItem {` e, logo depois da linha `if (item.situacao !== 'pendente') return { principal: null, secundaria: null };`, acrescente:

```ts
  // A cobrança da ENEL: só Enviar (o texto revisado) ou Dispensar — nunca "Marcar como feito".
  if (item.afazer?.tipo === 'cobrar_troca') {
    const c = item.afazer.cobranca ?? null;
    const porque = !c ? 'Não consegui carregar a cobrança.'
      : c.situacao !== 'aguardando_envio' ? 'Esta cobrança não está mais esperando envio.'
      : textoPronto(texto).porque;
    return {
      principal: { acao: 'enviar_cobranca', rotulo: 'Enviar', habilitada: porque === null, porque },
      secundaria: { acao: 'dispensar_cobranca', rotulo: 'Dispensar' },
    };
  }
```

6. Em `textoDaDecisao`, logo depois de `const quem = …;`, acrescente:

```ts
  if (acao === 'enviar_cobranca' || acao === 'dispensar_cobranca') {
    const c = item.afazer?.cobranca;
    const nota = c?.nota_servico ? `da nota ${c.nota_servico}` : 'sem número de nota';
    return acao === 'enviar_cobranca' ? `${quem}: cobrança ${nota} vai para ${c?.para ?? 'a ENEL'}` : `${quem}: cobrança ${nota} dispensada`;
  }
```

7. Troque `export interface SituacaoDecidida { rotulo: 'Aplicada' | 'Ignorada' | 'Feito'; …` por:

```ts
export interface SituacaoDecidida {
  rotulo: 'Aplicada' | 'Ignorada' | 'Feito' | 'Aprovada' | 'Dispensada' | 'Encerrada';
  em: string | null;
  por: string | null;
}
```

e em `situacaoDecidida`, ANTES de `if (item.afazer) return { rotulo: 'Feito', … }`, acrescente:

```ts
  if (item.afazer?.tipo === 'cobrar_troca') {
    const f = item.afazer;
    // sem quem fez = a Ludmilla fechou (a ENEL respondeu, nota nova, projeto concluído)
    const rotulo = f.cobranca?.situacao === 'dispensada' ? 'Dispensada' : f.feito_por ? 'Aprovada' : 'Encerrada';
    return { rotulo, em: f.feito_em, por: limpo(f.feito?.name) };
  }
```

8. Na interface `VisibilidadeDoDetalhe`, acrescente o campo

```ts
  /** "O e-mail que vai para a ENEL": só no A fazer da cobrança */
  cobranca: boolean;
```

e no objeto devolvido por `visibilidadeDoDetalhe`, acrescente `cobranca: item.afazer?.tipo === 'cobrar_troca',`.

- [ ] **Step 7: Rodar e ver passar; a suíte e o tsc**

```bash
npx vitest run src/lib/ludmillaCobranca.test.ts src/lib/ludmillaPainel.cobranca.test.ts
npx vitest run 2>&1 | tail -6
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"
```

Expected: os dois arquivos novos verdes; a suíte inteira sem `failed`; o tsc no MESMO número do Step 1 (65).

- [ ] **Step 8: Commit**

Escreva `$RASCUNHO/msg-t7.txt`:

```text
feat(ludmilla): lógica da tela da cobrança da troca na ENEL

O e-mail da cobrança nasce do modelo aprovado (saudação da hora,
"retomando o e-mail abaixo" com a anterior citada, assinatura num
lugar só), com lacunas que travam o Enviar quando falta dado. A caixa
ganha o A fazer cobrar_troca (selo, busca pela nota), com Enviar e
Dispensar no lugar de "Marcar como feito", o texto do aviso com
Desfazer e quem decidiu.

Co-Authored-By: <o modelo que executou> <noreply@anthropic.com>
```

```bash
git add src/lib/ludmillaCobranca.ts src/lib/ludmillaCobranca.fixtures.ts src/lib/ludmillaCobranca.test.ts src/lib/ludmillaPainel.cobranca.test.ts src/lib/ludmillaCaixa.ts src/lib/ludmillaPainel.ts
git commit -F "$RASCUNHO/msg-t7.txt" -- src/lib/ludmillaCobranca.ts src/lib/ludmillaCobranca.fixtures.ts src/lib/ludmillaCobranca.test.ts src/lib/ludmillaPainel.cobranca.test.ts src/lib/ludmillaCaixa.ts src/lib/ludmillaPainel.ts
git show --stat HEAD
```

---

### Task 8: Front — a cobrança na aba Decidir (o e-mail editável, Enviar pela fila do Desfazer, Dispensar)

**Files:**
- Modify: `src/hooks/useLudmillaDecidir.ts` (embed da cobrança em `SELECT_AFAZER`; `aprovarCobrancaNoBanco`, `dispensarCobrancaNoBanco`; `useAcoesDaCaixa` ganha `enviarCobranca` e `dispensarCobranca`)
- Modify: `src/components/ludmilla/decidir/AbaDecidir.tsx` (`AcoesDaCaixa` + o texto no `onDecidir`)
- Modify: `src/components/ludmilla/decidir/PainelDeDetalhe.tsx` (seção "O e-mail que vai para a ENEL" e os botões)
- Modify: `src/components/ludmilla/decidir/DetalheConectado.tsx` (o rascunho, uma vez por item)
- Test: `src/hooks/useLudmillaDecidir.cobranca.test.ts` (NOVO); `$RASCUNHO/verificar-selects.mjs`
- Test (harness, apagar antes do commit): `harness-cobranca.html`, `src/harness-cobranca.tsx`

**Interfaces:**
- Consumes: Task 7 inteira; `useFilaDeDecisoes` (8 s de Desfazer); `mensagemDeErro` (`@/lib/ludmillaCartao`); RPCs `ludmilla_cobranca_aprovar`, `ludmilla_cobranca_dispensar` (Task 1).
- Produces:
  - `AcoesDaCaixa = { aplicar; ignorar; feito; enviarCobranca(cobrancaId: string, texto: string): Promise<unknown>; dispensarCobranca(cobrancaId: string): Promise<unknown> }`.
  - `PropsDoDetalhe.onDecidir(acao: AcaoDaDecisao, etapa: string | null, texto?: string)`; `DadosDoDetalhe.rascunhoDaCobranca?: string | null`.
  - Atributos de prova: `data-teste="cobranca"`, `cobranca-para`, `cobranca-assunto`, `cobranca-texto`, `cobranca-resumo` (mais os de hoje: `data-linha`, `data-detalhe`, `botoes-da-decisao`, `previa-da-decisao`).

- [ ] **Step 1: Medir o tsc e conferir a árvore**

```bash
git status --short src/
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"
```

Expected: `git status` vazio (a Task 7 commitada); tsc = **65**.

- [ ] **Step 2: O teste dos hooks (vermelho)**

Crie `src/hooks/useLudmillaDecidir.cobranca.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAcoesDaCaixa } from './useLudmillaDecidir';

/**
 * A cola do Enviar e do Dispensar da cobrança: chama a RPC certa, com o id da COBRANÇA e
 * o texto revisado; REJEITA quando o banco recusa (é o que faz a fila do Desfazer devolver
 * a linha) mostrando o motivo dele; e só depois de gravar atualiza o A fazer, a linha do
 * tempo e o detalhe. Os dublês são os mesmos de useLudmillaDecidir.test.ts, com `rpc`.
 */
const m = vi.hoisted(() => ({ rpc: vi.fn(), invalidar: vi.fn(), erro: vi.fn(), info: vi.fn() }));

vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { info: m.info, error: m.erro }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: m.rpc } }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: m.invalidar }),
  useMutation: () => ({ mutateAsync: vi.fn() }),
  useQuery: vi.fn(),
}));
vi.mock('@/hooks/useLudmilla', () => ({
  useAplicarUpdate: () => ({ mutateAsync: vi.fn() }),
  useIgnorarUpdate: () => ({ mutateAsync: vi.fn() }),
  useLudmillaDisponivel: () => true,
}));

const chaves = () => m.invalidar.mock.calls.map(c => (c[0] as { queryKey: unknown[] }).queryKey[0]);

describe('useAcoesDaCaixa — Enviar e Dispensar da cobrança', () => {
  beforeEach(() => {
    for (const f of [m.rpc, m.invalidar, m.erro, m.info]) f.mockReset();
    m.invalidar.mockResolvedValue(undefined);
  });

  it('enviar: aprova com o id da cobrança e o texto, e DEPOIS atualiza A fazer, linha do tempo e detalhe', async () => {
    m.rpc.mockResolvedValue({ data: 'run-1', error: null });
    await useAcoesDaCaixa().enviarCobranca('c-1', 'Prezados, bom dia. Texto revisado.');
    expect(m.rpc).toHaveBeenCalledWith('ludmilla_cobranca_aprovar', { p_cobranca_id: 'c-1', p_texto: 'Prezados, bom dia. Texto revisado.' });
    expect(chaves()).toEqual(['portal-afazeres', 'ludmilla-linha-do-tempo', 'projeto-do-detalhe']);
  });

  it('enviar REJEITA quando o banco recusa, mostra o motivo dele e não atualiza nada', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'Já saiu uma cobrança desta nota em 22/10/2026 14:00: a próxima só depois de 7 dias.' } });
    await expect(useAcoesDaCaixa().enviarCobranca('c-1', 'x')).rejects.toMatchObject({ message: expect.stringContaining('7 dias') });
    expect(m.erro).toHaveBeenCalledWith(expect.stringContaining('7 dias'));
    expect(m.invalidar).not.toHaveBeenCalled();
  });

  it('dispensar: a RPC certa; false avisa que alguém já tinha decidido', async () => {
    m.rpc.mockResolvedValue({ data: false, error: null });
    expect(await useAcoesDaCaixa().dispensarCobranca('c-2')).toBe(false);
    expect(m.rpc).toHaveBeenCalledWith('ludmilla_cobranca_dispensar', { p_cobranca_id: 'c-2' });
    expect(m.info).toHaveBeenCalled();
    expect(chaves()).toContain('portal-afazeres');
  });

  it('dispensar REJEITA quando o banco recusa', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'O envio desta cobrança já começou.' } });
    await expect(useAcoesDaCaixa().dispensarCobranca('c-2')).rejects.toMatchObject({ message: 'O envio desta cobrança já começou.' });
    expect(m.erro).toHaveBeenCalledWith('O envio desta cobrança já começou.');
  });
});
```

Run: `npx vitest run src/hooks/useLudmillaDecidir.cobranca.test.ts`
Expected: FALHA — `enviarCobranca is not a function`.

- [ ] **Step 3: Os hooks**

Em `src/hooks/useLudmillaDecidir.ts`:

1. Acrescente o import `import { mensagemDeErro } from '@/lib/ludmillaCartao';`.
2. Troque a constante `SELECT_AFAZER` por (UMA linha só: a verificação do Step 5 lê a constante por expressão regular):

```ts
export const SELECT_AFAZER = '*, project:projects(id, code, status, title, companies:company_id(name), project_general_data(holder_name)), feito:feito_por(name), cobranca:cobranca_id(id, nota_servico, data_nota, prazo_dias, para, assunto, situacao, enviadas, ultima_enviada_em, ultimo_texto_enviado, texto_aprovado, erro, motivo_encerramento, vence_em, projeto:project_id(protocol_number, project_general_data(holder_name, uc_number)))';
```

3. Depois de `useMarcarAfazerFeito`, acrescente:

```ts
/** "Enviar" da cobrança: grava quem aprovou e o texto, e põe o envio na fila do robô. Devolve o id do run. */
export async function aprovarCobrancaNoBanco(cobrancaId: string, texto: string): Promise<string> {
  const { data, error } = await supabase.rpc('ludmilla_cobranca_aprovar' as never, { p_cobranca_id: cobrancaId, p_texto: texto } as never);
  if (error) throw error;
  return String(data ?? '');
}

/** "Dispensar": encerra a cobrança daquela nota, sem novas. `false` = alguém já tinha decidido. */
export async function dispensarCobrancaNoBanco(cobrancaId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('ludmilla_cobranca_dispensar' as never, { p_cobranca_id: cobrancaId } as never);
  if (error) throw error;
  return data === true;
}
```

4. Em `useAcoesDaCaixa`, dentro do objeto devolvido pelo `useMemo`, depois de `feito`, acrescente:

```ts
      /**
       * "Enviar" da cobrança (pela fila do Desfazer). REJEITA na recusa do banco — trava dos
       * 7 dias, lacuna no texto, alguém aprovou antes — e o motivo DELE vai para a tela.
       */
      enviarCobranca: async (cobrancaId: string, texto: string): Promise<void> => {
        try {
          await aprovarCobrancaNoBanco(cobrancaId, texto);
        } catch (e) {
          toast.error(mensagemDeErro(e) ?? 'Não consegui enviar a cobrança.');
          throw e;
        }
        void qc.invalidateQueries({ queryKey: ['portal-afazeres'], exact: false });
        atualizarDetalhe();
      },
      /** "Dispensar" da cobrança. `false` = alguém da equipe já tinha decidido. */
      dispensarCobranca: async (cobrancaId: string): Promise<boolean> => {
        let mudou: boolean;
        try {
          mudou = await dispensarCobrancaNoBanco(cobrancaId);
        } catch (e) {
          toast.error(mensagemDeErro(e) ?? 'Não consegui dispensar a cobrança.');
          throw e;
        }
        void qc.invalidateQueries({ queryKey: ['portal-afazeres'], exact: false });
        atualizarDetalhe();
        if (!mudou) toast.info('Alguém da equipe já tinha decidido esta cobrança.');
        return mudou;
      },
```

Run: `npx vitest run src/hooks/useLudmillaDecidir.cobranca.test.ts src/hooks/useLudmillaDecidir.test.ts`
Expected: os dois verdes (o de hoje sem mudança).

- [ ] **Step 4: A tela**

**4a.** Em `src/components/ludmilla/decidir/AbaDecidir.tsx`:

- na interface `AcoesDaCaixa`, depois de `feito`, acrescente:

```ts
  /** a cobrança da troca na ENEL: o id é o da COBRANÇA (`afazer.cobranca_id`), não o do A fazer */
  enviarCobranca: (cobrancaId: string, texto: string) => Promise<unknown>;
  dispensarCobranca: (cobrancaId: string) => Promise<unknown>;
```

- em `PropsDaAbaDecidir.detalhe`, troque o tipo do 3º parâmetro por `onDecidir: (acao: AcaoDaDecisao, etapa: string | null, texto?: string) => void`;
- troque a assinatura `const decidirItem = (item: ItemDaCaixa, acao: AcaoDaDecisao, etapa: string | null) => {` por `const decidirItem = (item: ItemDaCaixa, acao: AcaoDaDecisao, etapa: string | null, texto?: string) => {` e o `const executar = …` por:

```ts
    const cobrancaId = item.afazer?.cobranca_id ?? '';
    const executar = acao === 'feito' ? () => p.acoes.feito(item.id)
      : acao === 'ignorar' ? () => p.acoes.ignorar(item.id)
      : acao === 'enviar_cobranca' ? () => p.acoes.enviarCobranca(cobrancaId, texto ?? '')
      : acao === 'dispensar_cobranca' ? () => p.acoes.dispensarCobranca(cobrancaId)
      : () => p.acoes.aplicar(item.id, etapa);
```

- no `renderDetalhe`, troque `(acao, etapa) => decidirItem(item, acao, etapa)` por `(acao, etapa, texto) => decidirItem(item, acao, etapa, texto)`.

**4b.** Em `src/components/ludmilla/decidir/PainelDeDetalhe.tsx`:

- no import do `lucide-react`, acrescente `Send`; acrescente os imports

```ts
import { Textarea } from '@/components/ui/textarea';
import { TAMANHO_MAXIMO_DO_TEXTO, dataBr, resumoDaCobranca } from '@/lib/ludmillaCobranca';
```

- em `DadosDoDetalhe`, acrescente `rascunhoDaCobranca?: string | null;` (o texto que o editor da cobrança abre);
- em `PropsDoDetalhe`, troque `onDecidir: (acao: AcaoDaDecisao, etapa: string | null) => void;` por `onDecidir: (acao: AcaoDaDecisao, etapa: string | null, texto?: string) => void;`;
- logo DEPOIS da função `OQueChegouSecao`, acrescente:

```tsx
/** O A fazer da cobrança da ENEL: o e-mail pronto, com o texto editável (spec §3.3). */
function CobrancaSecao({ item, texto, onTexto }: { item: ItemDaCaixa; texto: string; onTexto: (t: string) => void }) {
  const c = item.afazer?.cobranca;
  if (!c) {
    return (
      <Secao titulo="O e-mail que vai para a ENEL">
        <p className="text-xs text-amber-800">Não consegui carregar a cobrança. Recarregue a página.</p>
      </Secao>
    );
  }
  const pendente = item.situacao === 'pendente';
  return (
    <Secao titulo="O e-mail que vai para a ENEL">
      <div className="space-y-2 text-sm" data-teste="cobranca">
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="pt-0.5 text-xs text-muted-foreground">Para</dt>
          <dd className="break-all font-mono text-xs" data-teste="cobranca-para">{c.para}</dd>
          <dt className="pt-0.5 text-xs text-muted-foreground">Assunto</dt>
          <dd className="break-words font-mono text-xs" data-teste="cobranca-assunto">{c.assunto}</dd>
        </dl>
        {pendente && c.erro && (
          <p className="flex items-start gap-1.5 break-words rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
            <ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
            O último envio não saiu: {c.erro}. Confira a pasta Enviados do Gmail antes de enviar de novo.
          </p>
        )}
        {pendente && !c.nota_servico && (
          <p className="flex items-start gap-1.5 break-words text-xs text-amber-800">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
            Não achei o número da nota no e-mail da ENEL: confira e complete onde está [NÚMERO DA NOTA].
          </p>
        )}
        {pendente && c.enviadas > 0 && (
          <p className="text-xs text-muted-foreground">
            Esta é a {c.enviadas + 1}ª cobrança desta nota{c.ultima_enviada_em ? ` (a última saiu em ${dataBr(c.ultima_enviada_em)})` : ''}.
          </p>
        )}
        {pendente ? (
          // 16 px no celular: o iOS dá zoom em campo com fonte menor
          <Textarea
            value={texto} onChange={e => onTexto(e.target.value)} rows={12} maxLength={TAMANHO_MAXIMO_DO_TEXTO}
            aria-label="Texto do e-mail para a ENEL" data-teste="cobranca-texto" className="font-mono text-base sm:text-xs"
          />
        ) : (
          <p className="text-xs text-muted-foreground" data-teste="cobranca-resumo">{resumoDaCobranca(c)}</p>
        )}
      </div>
    </Secao>
  );
}
```

- troque a função `BotoesDaDecisao` inteira por esta (se a frente anterior tiver acrescentado algo nela, preserve e aplique só: o parâmetro `texto`; `acoesDoItem(item, etapa || null, texto)`; a prévia também para `enviar_cobranca`; o `onDecidir(secundaria.acao, null)`; o texto no `onDecidir` do principal; o ícone `Send`):

```tsx
function BotoesDaDecisao({ item, etapa, texto, onDecidir, rotuloEtapa }: {
  item: ItemDaCaixa; etapa: string; texto: string; onDecidir: PropsDoDetalhe['onDecidir']; rotuloEtapa: DadosDoDetalhe['rotuloEtapa'];
}) {
  const decidida = situacaoDecidida(item);
  if (decidida) {
    return (
      <p data-teste="botoes-da-decisao" className="text-sm text-muted-foreground">
        {decidida.rotulo}{decidida.por ? ` por ${decidida.por}` : ''}{decidida.em ? ` em ${dataCurta(decidida.em)}` : ''}.
      </p>
    );
  }
  // bloqueado: só "Dispensar"; A fazer: só "Marcar como feito"; cobrança: "Enviar" (o texto revisado) e "Dispensar"
  const { principal, secundaria } = acoesDoItem(item, etapa || null, texto);
  // o que o botão vai fazer, à vista sem rolar (o mesmo texto do aviso com "Desfazer")
  const previa = principal?.habilitada && (principal.acao === 'aplicar' || principal.acao === 'enviar_cobranca')
    ? textoDaDecisao(item, principal.acao, etapa || null, rotuloEtapa) : null;
  const Icone = principal?.acao === 'enviar_cobranca' ? Send : CheckCircle2;
  return (
    <div data-teste="botoes-da-decisao" className="space-y-1.5">
      {previa && (
        <p data-teste="previa-da-decisao" className="flex items-start gap-1 break-words text-xs text-muted-foreground">
          <ArrowRight size={12} className="mt-0.5 shrink-0" aria-hidden /> {previa}
        </p>
      )}
      <div className="flex gap-2">
        {secundaria && (
          <Button variant="outline" className="flex-1 gap-1.5 sm:flex-none" onClick={() => onDecidir(secundaria.acao, null)}>
            <XCircle size={15} aria-hidden /> {secundaria.rotulo}
          </Button>
        )}
        {principal && (
          <Button className="flex-1 gap-1.5 sm:flex-none" disabled={!principal.habilitada}
            onClick={() => onDecidir(
              principal.acao,
              principal.acao === 'aplicar' ? (etapa || null) : null,
              principal.acao === 'enviar_cobranca' ? texto : undefined,
            )}>
            <Icone size={15} aria-hidden /> {principal.rotulo}
          </Button>
        )}
      </div>
      {principal?.porque && <p className="text-xs text-muted-foreground">{principal.porque}</p>}
    </div>
  );
}
```

- em `DetalheDaDecisao`, depois da linha do `useState` da etapa, acrescente

```tsx
  // o texto da cobrança nasce do rascunho UMA vez (o pai troca a `key` quando o item muda)
  const [texto, setTexto] = useState<string>(dados.rascunhoDaCobranca ?? '');
```

troque a linha do `botoes` por

```tsx
  const botoes = <BotoesDaDecisao item={item} etapa={etapa} texto={texto} onDecidir={onDecidir} rotuloEtapa={dados.rotuloEtapa} />;
```

acrescente, junto das outras seções,

```tsx
  const cobranca = v.cobranca ? <CobrancaSecao item={item} texto={texto} onTexto={setTexto} /> : null;
```

e troque `{quem}{chegou}{documentos}{sugestao}{linha}` por `{quem}{chegou}{cobranca}{documentos}{sugestao}{linha}`.

**4c.** Em `src/components/ludmilla/decidir/DetalheConectado.tsx`:

- acrescente `import { useState } from 'react';` e `import { rascunhoDaCobranca } from '@/lib/ludmillaCobranca';`;
- no tipo da prop, troque `onDecidir: (acao: AcaoDaDecisao, etapa: string | null) => void;` por `onDecidir: (acao: AcaoDaDecisao, etapa: string | null, texto?: string) => void;`;
- depois de `const linha = useLinhaDoTempo(item.projectId);`, acrescente:

```tsx
  // o rascunho nasce UMA vez por item: o refetch de 5 min do A fazer não apaga o que a pessoa editou
  const [rascunho] = useState<string | null>(() => (item.afazer?.cobranca ? rascunhoDaCobranca(item.afazer.cobranca, new Date()) : null));
```

- no objeto `dados`, acrescente `rascunhoDaCobranca: rascunho,`.

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: o mesmo número do Step 1 (65). Se subir, o erro novo está num destes quatro arquivos — corrija antes de seguir.

- [ ] **Step 5: Conferir os selects contra o PostgREST de verdade**

Escreva `$RASCUNHO/verificar-selects.mjs`:

```js
// Confere que o select do A fazer (com o embed novo da cobrança) é aceito pelo PostgREST, e
// que o embed de hoje da mensagem de e-mail continua sem ambiguidade depois da tabela nova.
// Anônimo: a tabela nega (42501) DEPOIS de planejar a consulta; relação errada dá PGRST200/201
// e coluna errada dá 42703 ANTES. Nenhum dado volta.
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const url = env.VITE_SUPABASE_URL;
const chave = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const fonte = readFileSync('src/hooks/useLudmillaDecidir.ts', 'utf8');
const afazer = fonte.match(/export const SELECT_AFAZER = '([^']+)'/)?.[1];
if (!afazer) throw new Error('SELECT_AFAZER não encontrado');

const consultas = [
  ['SELECT_AFAZER', 'portal_afazeres', afazer, true],
  ['mensagem de hoje (useLudmilla.ts)', 'portal_email_mensagens', '*, project:projects(id, code, status, title)', true],
  ['CONTROLE (coluna que não existe: tem de FALHAR)', 'portal_afazeres', afazer.replace('nota_servico', 'nota_que_nao_existe'), false],
];
for (const [nome, tabela, sel, deveAceitar] of consultas) {
  const r = await fetch(`${url}/rest/v1/${tabela}?select=${encodeURIComponent(sel)}&limit=1`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  });
  const corpo = await r.json().catch(() => null);
  const codigo = corpo && !Array.isArray(corpo) ? corpo.code : null;
  const aceitou = r.ok || codigo === '42501';
  const ok = aceitou === deveAceitar;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${nome} → ${r.status} ${codigo ?? ''}`);
  if (!ok) { console.log(JSON.stringify(corpo)); process.exitCode = 1; }
}
```

Run: `node "$RASCUNHO/verificar-selects.mjs"`
Expected: três `OK` — `SELECT_AFAZER` e a mensagem de hoje aceitas (`42501` ou `200`), e o CONTROLE recusado com `400 42703` (prova de que a sonda chega a planejar a consulta). `PGRST200`/`PGRST201` em qualquer uma = embed errado ou ambíguo: corrija o select (ou o FK da Task 1) antes de seguir.

- [ ] **Step 6: O harness (o teste de tela)**

Crie `harness-cobranca.html` (raiz):

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Harness — cobrança da ENEL</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/harness-cobranca.tsx"></script>
  </body>
</html>
```

Crie `src/harness-cobranca.tsx`:

```tsx
// HARNESS DA COBRANÇA NA ABA DECIDIR — dados inventados, nenhuma rede. APAGAR antes do commit.
import '@/index.css';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import { AbaDecidir, type AcoesDaCaixa } from '@/components/ludmilla/decidir/AbaDecidir';
import { DetalheDaDecisao } from '@/components/ludmilla/decidir/PainelDeDetalhe';
import { useFilaDeDecisoes } from '@/hooks/useFilaDeDecisoes';
import { useWindowSize } from '@/hooks/useWindowSize';
import { FILTRO_INICIAL, itensDaCaixa, type FiltroDaCaixa } from '@/lib/ludmillaCaixa';
import { rascunhoDaCobranca } from '@/lib/ludmillaCobranca';
import {
  AGORA, CONTAS_DE_EXEMPLO, ETAPAS_DE_EXEMPLO, F_VISTORIA, LINHA_DO_TEMPO_DE_EXEMPLO, nomeDaContaDeExemplo, rotuloDeExemplo,
} from '@/lib/ludmillaCaixa.fixtures';
import { AFAZERES_DE_COBRANCA } from '@/lib/ludmillaCobranca.fixtures';

declare global { interface Window { __decisoes: string[] } }
window.__decisoes = [];
const gravar = (o: string) => { window.__decisoes.push(o); return Promise.resolve(); };

function Harness() {
  const [filtro, setFiltro] = useState<FiltroDaCaixa>(FILTRO_INICIAL);
  const itens = useMemo(() => itensDaCaixa({
    updates: [], afazeres: [...AFAZERES_DE_COBRANCA, F_VISTORIA], contas: CONTAS_DE_EXEMPLO,
    nomeDaConta: nomeDaContaDeExemplo, rotuloEtapa: rotuloDeExemplo,
  }), []);
  const { ocultos, decidir } = useFilaDeDecisoes(itens);
  const { isDesktop } = useWindowSize();
  const acoes: AcoesDaCaixa = {
    aplicar: (id, etapa) => gravar(`aplicar:${id}:${etapa ?? ''}`),
    ignorar: id => gravar(`ignorar:${id}`),
    feito: id => gravar(`feito:${id}`),
    enviarCobranca: (id, texto) => gravar(`enviar:${id}:${texto}`),
    dispensarCobranca: id => gravar(`dispensar:${id}`),
  };
  return (
    <div className="mx-auto max-w-7xl p-4">
      <AbaDecidir
        itens={itens} filtro={filtro} onFiltro={setFiltro} contaId={null} ocultos={ocultos} decidir={decidir}
        acoes={acoes} rotuloEtapa={rotuloDeExemplo} carregando={false} buscando={false} erro={null}
        onTentarDeNovo={() => undefined} agora={AGORA} modo={isDesktop ? 'lado_a_lado' : 'folha'}
        detalhe={(item, layout, onDecidir) => (
          <DetalheDaDecisao
            key={item.chave} layout={layout} onDecidir={onDecidir}
            onAbrirProjeto={id => window.__decisoes.push(`abrir:${id}`)}
            urlDoDocumento={async () => null}
            dados={{
              item, chegou: null, ressalva: null,
              projeto: item.projectId ? { uc: '0055009001', protocoloNoCadastro: '391000099' } : null,
              documentos: null, linhaDoTempo: item.projectId ? LINHA_DO_TEMPO_DE_EXEMPLO : [],
              etapas: ETAPAS_DE_EXEMPLO, rotuloEtapa: rotuloDeExemplo,
              rascunhoDaCobranca: item.afazer?.cobranca ? rascunhoDaCobranca(item.afazer.cobranca, new Date()) : null,
            }}
          />
        )}
      />
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
```

Run (em segundo plano): `npx vite --port 5176 --strictPort`
Abra `http://localhost:5176/harness-cobranca.html` no navegador do Claude, em 1280 × 900.

- [ ] **Step 7: Provar na tela — computador**

Rode no console da página (ferramenta de JavaScript do navegador), um bloco por vez, conferindo o resultado:

```js
// 1. a cobrança está na lista e o detalhe mostra o e-mail pronto
const linha = c => document.querySelector(`[data-linha="${c}"]`);
const detalhe = c => document.querySelector(`[data-detalhe="${c}"]`);
const espera = ms => new Promise(r => setTimeout(r, ms));
const escrever = (ta, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, v); ta.dispatchEvent(new Event('input', { bubbles: true })); };
linha('f:f-cob').click(); await espera(300);
const d = detalhe('f:f-cob');
({
  para: d.querySelector('[data-teste=cobranca-para]')?.textContent,
  assunto: d.querySelector('[data-teste=cobranca-assunto]')?.textContent,
  primeira: d.querySelector('[data-teste=cobranca-texto]')?.value.split('\n')[0],
  assinatura: d.querySelector('[data-teste=cobranca-texto]')?.value.trim().split('\n').at(-1),
  enviarLigado: [...d.querySelectorAll('button')].find(b => b.textContent.includes('Enviar'))?.disabled === false,
  temDispensar: [...d.querySelectorAll('button')].some(b => b.textContent.includes('Dispensar')),
  semFeito: ![...d.querySelectorAll('button')].some(b => b.textContent.includes('Marcar como feito')),
  previa: d.querySelector('[data-teste=previa-da-decisao]')?.textContent.trim(),
})
```

Expected: `para = "canalgd.sp@br.enel.com"`, o assunto `RE: TROCA DE RELÓGIO - MARTA EXEMPLO PRADO - NT 391000099`, `primeira` = `Prezados, bom dia.` ou `Prezados, boa tarde.` (pela hora de Brasília de agora), `assinatura = "Equipe GD Manager"`, `enviarLigado`, `temDispensar` e `semFeito` = `true`, `previa = "PRJ-20001: cobrança da nota 400000000123 vai para canalgd.sp@br.enel.com"`.

```js
// 2. lacuna no texto desliga o Enviar, e dizer o que falta; tirar religa
const ta = detalhe('f:f-cob').querySelector('textarea'); const original = ta.value;
escrever(ta, original + '\n[UC]'); await espera(100);
const b1 = [...detalhe('f:f-cob').querySelectorAll('button')].find(b => b.textContent.includes('Enviar'));
const porque = detalhe('f:f-cob').querySelector('[data-teste=botoes-da-decisao]').textContent;
escrever(ta, original + '\nObrigada.'); await espera(100);
const b2 = [...detalhe('f:f-cob').querySelectorAll('button')].find(b => b.textContent.includes('Enviar'));
({ desligou: b1.disabled, porque: /Complete no texto: \[UC\]/.test(porque), religou: !b2.disabled })
```

Expected: `{ desligou: true, porque: true, religou: true }`.

```js
// 3. Enviar passa pela fila do Desfazer e manda o texto EDITADO, com o id da COBRANÇA
[...detalhe('f:f-cob').querySelectorAll('button')].find(b => b.textContent.includes('Enviar')).click();
await espera(300);
const sumiu = !linha('f:f-cob');
const aviso = [...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent).join(' | ');
await espera(8500);
({ sumiu, aviso, gravado: window.__decisoes.find(x => x.startsWith('enviar:')) })
```

Expected: `sumiu = true`; `aviso` contém `cobrança da nota 400000000123 vai para canalgd.sp@br.enel.com` e `Desfazer`; `gravado` começa com `enviar:c-1:Prezados,` e termina com `Obrigada.`.

```js
// 4. sem número, falhou, 2ª cobrança
linha('f:f-cob-sem').click(); await espera(300);
const s = detalhe('f:f-cob-sem');
const r1 = { aviso: /Não achei o número da nota/.test(s.textContent), enviarDesligado: [...s.querySelectorAll('button')].find(b => b.textContent.includes('Enviar')).disabled };
linha('f:f-cob-falhou').click(); await espera(300);
const f = detalhe('f:f-cob-falhou');
const r2 = { erro: /O último envio não saiu: o Gmail recusou a senha de app da caixa \(EAUTH 535\)/.test(f.textContent), rascunho: /Texto que a equipe já tinha aprovado/.test(f.querySelector('textarea').value) };
linha('f:f-cob-2a').click(); await espera(300);
const g = detalhe('f:f-cob-2a');
const r3 = { segunda: /Esta é a 2ª cobrança desta nota \(a última saiu em 15\/10\/2026\)/.test(g.textContent), primeira: g.querySelector('textarea').value.split('\n')[0], cita: /Em 15\/10\/2026, Equipe GD Manager escreveu:\n> Prezados, bom dia\./.test(g.querySelector('textarea').value) };
({ r1, r2, r3 })
```

Expected: `r1 = { aviso: true, enviarDesligado: true }`; `r2 = { erro: true, rascunho: true }`; `r3 = { segunda: true, primeira: 'Prezados, retomando o e-mail abaixo:', cita: true }`.

```js
// 5. Dispensar, e o A fazer comum segue com "Marcar como feito"
[...detalhe('f:f-cob-2a').querySelectorAll('button')].find(b => b.textContent.includes('Dispensar')).click();
await espera(8500);
linha('f:f-vistoria').click(); await espera(300);
({ dispensou: window.__decisoes.includes('dispensar:c-4'),
   comum: [...detalhe('f:f-vistoria').querySelectorAll('button')].some(b => b.textContent.includes('Marcar como feito')),
   semEmail: !detalhe('f:f-vistoria').querySelector('[data-teste=cobranca]') })
```

Expected: `{ dispensou: true, comum: true, semEmail: true }`.

Depois, no filtro de situação da caixa, escolha **Aplicadas**, abra `PRJ-20001` da linha `f:f-cob-ok` e confira na tela: "Aprovada por Bia Exemplo em …" nos botões e o resumo "Enviada 1× (a última em 22/10/2026). Próxima cobrança em 29/10/2026, se a ENEL não responder."; na `f:f-cob-disp`, "Dispensada por Bia Exemplo"; na `f:f-cob-enc`, "Encerrada" e "Encerrada: a ENEL avisou que a troca do relógio foi feita". Tire uma captura do detalhe da `f:f-cob` (Step 7.1) para o relatório.

- [ ] **Step 8: Provar na tela — celular**

Mude a janela para 390 × 844 (`resize_window` preset `mobile`) e recarregue. Toque na linha `f:f-cob` (abre a folha por cima) e rode:

```js
const d = document.querySelector('[data-detalhe="f:f-cob"]');
const ta = d.querySelector('textarea');
const enviar = [...d.querySelectorAll('button')].find(b => b.textContent.includes('Enviar')).getBoundingClientRect();
({ fonte: getComputedStyle(ta).fontSize, enviarVisivel: enviar.bottom <= window.innerHeight && enviar.top >= 0,
   semRolagemDeLado: document.documentElement.scrollWidth <= window.innerWidth })
```

Expected: `{ fonte: '16px', enviarVisivel: true, semRolagemDeLado: true }`. Tire uma captura. Volte a janela para `desktop`.

- [ ] **Step 9: Apagar o harness e verificar o resto**

Pare o servidor do Vite. Apague `harness-cobranca.html` e `src/harness-cobranca.tsx`.

```bash
git status --short | grep -i harness-cobranca
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"
npm run build 2>&1 | tail -4
npx vitest run 2>&1 | tail -6
```

Expected: o `grep` VAZIO; tsc = 65; build sem erro; vitest sem `failed`.

- [ ] **Step 10: Commit**

Escreva `$RASCUNHO/msg-t8.txt`:

```text
feat(ludmilla): cobrança da troca na aba Decidir — e-mail editável, Enviar, Dispensar

O A fazer "Cobrar a ENEL" mostra Para, Assunto e o texto editável (o
rascunho nasce uma vez por item; o que não saiu volta como rascunho),
avisa nota sem número, envio que falhou e 2ª cobrança. Enviar passa
pela fila do Desfazer (8 s) e chama ludmilla_cobranca_aprovar com o id
da cobrança; Dispensar encerra a nota. O A fazer comum segue com
"Marcar como feito". Provado em harness com dados inventados (1280 e
390 px) e o select conferido no PostgREST.

Co-Authored-By: <o modelo que executou> <noreply@anthropic.com>
```

```bash
git add src/hooks/useLudmillaDecidir.ts src/hooks/useLudmillaDecidir.cobranca.test.ts src/components/ludmilla/decidir/AbaDecidir.tsx src/components/ludmilla/decidir/PainelDeDetalhe.tsx src/components/ludmilla/decidir/DetalheConectado.tsx
git commit -F "$RASCUNHO/msg-t8.txt" -- src/hooks/useLudmillaDecidir.ts src/hooks/useLudmillaDecidir.cobranca.test.ts src/components/ludmilla/decidir/AbaDecidir.tsx src/components/ludmilla/decidir/PainelDeDetalhe.tsx src/components/ludmilla/decidir/DetalheConectado.tsx
git show --stat HEAD
```

---

### Task 9: Documentação — módulo, ADR, integrações, segurança, índice e memória

**Files:**
- Modify: `docs/modules/integrations/ludmilla.md`
- Create: `docs/adr/0012-ludmilla-envia-com-clique.md`; Modify: `docs/adr/README.md`
- Modify: `docs/project/integrations.md`, `docs/project/security.md`, `CLAUDE.md`
- Modify (fora do repositório): a memória `ludmilla.md` e o `MEMORY.md` do projeto

**Interfaces:**
- Consumes: os nomes das Tasks 1–8 (tabela, RPCs, crons, arquivos).
- Produces: a doc que a Task 10 completa com o resultado do primeiro envio.

- [ ] **Step 1: O módulo**

Em `docs/modules/integrations/ludmilla.md`, dentro da seção "Acompanhamento por E-MAIL — a ENEL", logo ANTES de `### O que NÃO está provado` dessa seção, acrescente:

```markdown
### A cobrança da troca do relógio e a leitura de hora em hora (24/10/2026)

Spec [2026-10-24-ludmilla-enel-cobranca-troca-design.md](../../superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md) ·
plano [2026-10-24-ludmilla-enel-cobranca-troca.md](../../superpowers/plans/2026-10-24-ludmilla-enel-cobranca-troca.md) ·
ADR [0012](../../adr/0012-ludmilla-envia-com-clique.md).

**A primeira escrita da Ludmilla para fora por e-mail — e só com clique.** Quando a ENEL
abre a nota de serviço de troca do relógio (a troca `agendada` do classificador, ou o
"Reenviamos a nota de serviço …" de uma troca que falhou), o run grava uma linha em
`portal_cobrancas` (`ludmilla_cobranca_agendar`): o número da nota (12 dígitos junto de
"nota de serviço" ou "ordem", só na parte nova do e-mail; sem número, a linha nasce sem ele),
a data do e-mail, o prazo, o remetente (vira o Para), o assunto com "RE:" e o
`In-Reply-To`/`References` para responder **na conversa da nota**. Vence 7 dias depois.

No dia, `ludmilla_cobrancas_abrir_vencidas` (cron `ludmilla-cobrancas`, seg–sex às :05 das
8h às 18h) põe a cobrança em `aguardando_envio` e abre um **A fazer `cobrar_troca`** na aba
Decidir: Para, Assunto e o texto do modelo aprovado (`src/lib/ludmillaCobranca.ts`; assinatura
"Equipe GD Manager"), editável. **Enviar** passa pela fila do Desfazer (8 s) e chama
`ludmilla_cobranca_aprovar`, que confere tudo de novo e cria o run `enviar_cobranca`;
**Dispensar** (`ludmilla_cobranca_dispensar`) encerra a nota. Não há "Marcar como feito".

O worker (`email/enel/enviar.ts`) pega a cobrança (`ludmilla_cobranca_iniciar_envio`, que a
deixa `enviando`), confere as travas DE NOVO (`podeEnviar`) e manda por SMTP
(`email/smtp.ts`, nodemailer 10.0.16, `smtp.gmail.com` 465 com recaída na 587 só se nem
conectar) pela MESMA conta e senha de app do IMAP. Saiu: `ludmilla_cobranca_enviada` grava o
histórico do projeto (autora: quem aprovou), o comentário no card (assinado pela Ludmilla) e
agenda a próxima para 7 dias. Falhou: `ludmilla_cobranca_falhou` devolve à equipe com a razão
curta e um A fazer novo; **nunca reenvia sozinha**. Envio que não confirmou em 30 min volta com
"confira a pasta Enviados do Gmail".

**Travas, no worker E no banco:** destinatário `^[a-z0-9][a-z0-9._%+-]*@(br\.)?enel\.com$`
sobre o endereço normalizado (CHECK da tabela, `ludmilla_endereco_da_enel`, e
`REGEX_DESTINATARIO_ENEL` no worker — um teste confere que são a mesma); no máximo 1 envio por
nota a cada 7 dias; só cobrança `aguardando_envio` aprovada por uma pessoa e ligada ao run pelo
`run_id` (run criado por `ludmilla_pedir_run` é recusado); lacuna (`[UC]`, `[NT]`, `[TITULAR]`,
`[NÚMERO DA NOTA]`) no texto barra. Envelope SMTP explícito, sem Cc/Bcc, só texto.

**Param:** "troca realizada" do mesmo projeto (`ludmilla_cobranca_encerrar_por_troca`), nota
nova do mesmo projeto ("substituída"), Dispensar, projeto concluído/arquivado (o cron encerra).

**A leitura da ENEL ficou automática:** `ludmilla_agendar_email()` (função NOVA, cron
`ludmilla-enel-email`, `0 11-21 * * 1-5` UTC) enfileira `varredura_email` para conta de e-mail
por remetente, ligada, fora da estação, sem run aberto. O agendador da CPFL não mudou (md5
`3d0d2d0f1e7455ec701230bc925e1bde` antes e depois); a EDP continua manual.

Teste do SMTP na VPS: `gh workflow run ludmilla-worker.yml -f smtp=verificar` (conecta e
autentica, não envia) ou `-f smtp=enviar_para_a_propria_caixa` (de = para = a caixa da Ludmilla).
Desligar tudo: `select cron.unschedule('ludmilla-cobrancas'); select cron.unschedule('ludmilla-enel-email');`.
```

E no parágrafo de `### A proteção acidental do agendador`, troque a frase "O run de e-mail (`varredura_email`) hoje só nasce do "Verificar agora" ou de `INSERT`; **não há agendamento** e não deve haver antes de olhar os números do primeiro run." por:

```markdown
A ENEL ganhou agendamento PRÓPRIO em 24/10/2026 (`ludmilla_agendar_email`, cron
`ludmilla-enel-email`, de hora em hora no expediente), sem tocar neste agendador; a EDP segue
só pelo "Verificar agora".
```

- [ ] **Step 2: O ADR**

Crie `docs/adr/0012-ludmilla-envia-com-clique.md`:

```markdown
# ADR 0012 — A Ludmilla manda e-mail para a concessionária só com clique de uma pessoa

**Status**: aceito · **Data**: out/2026

## Contexto

Até out/2026 a Ludmilla só LIA: portal, caixa de e-mail e PDFs, e recomendava. Na ENEL, depois
da nota de serviço de troca do relógio, alguém precisa perguntar se a troca foi feita — e o
usuário pediu que ela prepare esse e-mail (spec 2026-10-24). É a primeira vez que o sistema
escreve, em nome da empresa, para fora: um e-mail errado para a concessionária é caro e não
volta.

## Decisões

1. **Nada sai sem clique.** A Ludmilla prepara o texto (modelo aprovado pelo usuário); uma
   pessoa da equipe revisa, pode editar e clica em Enviar. Envio automático é outra decisão.
2. **Destinatário travado em @enel.com / @br.enel.com, no worker E no banco**, com a mesma
   expressão nas duas pontas (um teste confere). No máximo 1 envio por nota a cada 7 dias.
3. **A mesma caixa e a mesma senha de app do IMAP**, por SMTP (`nodemailer`, versão fixa). A
   senha fica no `agent_config` do tenant, lida só por `service_role` na VPS; nunca passa pelo
   front nem pelo log. A resposta vai na conversa da nota (`In-Reply-To`/`References`).
4. **No máximo uma tentativa por aprovação.** O banco "pega" a cobrança antes do SMTP; falha
   devolve à equipe com a razão curta; depois que o SMTP aceitou, nada a devolve (senão alguém
   reenviaria).

## Consequências

- Uma dependência nova no worker (`nodemailer` 10.0.16, zero dependências, MIT-0).
- O SMTP de saída da VPS (465/587) precisa estar aberto; há um teste pelo workflow.
- Pedir a troca do relógio (fase 2) continua fora: é outra escrita, a desenhar.
```

E em `docs/adr/README.md`, acrescente a linha na tabela:

```markdown
| [0012](0012-ludmilla-envia-com-clique.md) | Ludmilla manda e-mail para a concessionária só com clique de uma pessoa | Aceito |
```

- [ ] **Step 3: Integrações, segurança e o índice**

Em `docs/project/integrations.md`, em "Serviços externos", depois do item da **Gmail API**, acrescente:

```markdown
- **Gmail IMAP/SMTP (Ludmilla)** — a Ludmilla lê a caixa por IMAP (`imapflow`) e, desde
  24/10/2026, manda a cobrança da troca do relógio à ENEL por SMTP (`smtp.gmail.com`, 465 ou
  587, `nodemailer` 10.0.16) — só depois do clique de uma pessoa e só para @enel.com /
  @br.enel.com. Mesma conta e senha de app do `agent_config` do Claudinho. Teste:
  `gh workflow run ludmilla-worker.yml -f smtp=verificar`. ADR 0012.
```

Em `docs/project/security.md`, antes de `## Monitoramento`, acrescente:

```markdown
## Envio de e-mail pela Ludmilla (out/2026)

A única escrita da Ludmilla para fora por e-mail é a cobrança da troca do relógio na ENEL
(ADR 0012). Travas, no worker e no banco: destinatário só @enel.com/@br.enel.com (CHECK em
`portal_cobrancas.para` + `podeEnviar`), no máximo 1 envio por nota a cada 7 dias, só cobrança
aprovada por pessoa da equipe e ligada ao run pelo `run_id`. Escrita na tabela só por RPC; leitura
só da equipe do GD Manager (RESTRICTIVE por tenant). A senha de app vem de `agent_config`, só por
`service_role`; o log e o banco recebem só a razão curta da falha do SMTP, nunca a mensagem crua.
```

Em `CLAUDE.md`, na linha da tabela de módulos da **Ludmilla**, troque SÓ o trecho da ENEL (em 25/10 era "ENEL por e-mail (pelos remetentes: acha o projeto por NT, UC ou nome) revisada, 1º run pendente — roteiro pronto, falta publicar o robô"; outras frentes podem tê-lo mudado — leia o que está lá) por um que termine em:

```markdown
ENEL por e-mail (pelos remetentes: acha o projeto por NT, UC ou nome), lida de hora em hora no expediente, com a cobrança da troca do relógio (sai só com clique)
```

O resto da linha (CPFL, EDP, Elektro) fica como está.

- [ ] **Step 4: A memória do módulo**

Na memória `ludmilla.md` do projeto (`C:\Users\luiza\.claude\projects\…\memory\ludmilla.md`), acrescente um parágrafo no fim:

```markdown
**Cobrança da troca do relógio na ENEL (24/10/2026, plano 2026-10-24-ludmilla-enel-cobranca-troca)** —
a 1ª escrita para fora por e-mail, SÓ com clique: nota de serviço → `portal_cobrancas` (vence em 7
dias) → cron `ludmilla-cobrancas` abre A fazer `cobrar_troca` → pessoa revisa/edita e clica Enviar
(fila do Desfazer) → `ludmilla_cobranca_aprovar` cria run `enviar_cobranca` → worker manda por
SMTP (nodemailer 10.0.16, mesma conta/senha do IMAP) na conversa da nota. Travas worker E banco:
@enel.com/@br.enel.com, 1 envio/nota/7 dias, run_id da aprovação. Nunca reenvia sozinha. Leitura
da ENEL agendada (cron `ludmilla-enel-email`, seg–sex 8h–18h); CPFL intacta (md5 3d0d2d0f…).
Teste SMTP: `gh workflow run ludmilla-worker.yml -f smtp=verificar`. Pedir a troca = fase 2.
```

e, no `MEMORY.md`, na linha da Ludmilla, acrescente `; ENEL lida de hora em hora + cobrança da troca do relógio só com clique (24/10)` ao fim da descrição.

- [ ] **Step 5: Commit**

Escreva `$RASCUNHO/msg-t9.txt`:

```text
docs(ludmilla): cobrança da troca na ENEL — módulo, ADR 0012, segurança

Seção nova no módulo (o fluxo da nota ao envio, as travas, quando
para, a leitura de hora em hora e o teste do SMTP), ADR 0012 (a
Ludmilla manda e-mail só com clique), integrações, segurança e a linha
do índice.

Co-Authored-By: <o modelo que executou> <noreply@anthropic.com>
```

```bash
git add docs/modules/integrations/ludmilla.md docs/adr/0012-ludmilla-envia-com-clique.md docs/adr/README.md docs/project/integrations.md docs/project/security.md CLAUDE.md
git commit -F "$RASCUNHO/msg-t9.txt" -- docs/modules/integrations/ludmilla.md docs/adr/0012-ludmilla-envia-com-clique.md docs/adr/README.md docs/project/integrations.md docs/project/security.md CLAUDE.md
git show --stat HEAD
```

---

### Task 10: Roteiro — publicar, ligar os crons e o primeiro envio (COM o usuário)

**Files:**
- Aplica: `supabase/migrations/20261024170000_ludmilla_enel_cron.sql` (escrita na Task 2)
- Modify: `docs/modules/integrations/ludmilla.md` (o resultado, em "O que NÃO está provado" da ENEL) e a memória
- Test: `$RASCUNHO/cobrancas_agora.sql`, `$RASCUNHO/crons_agora.sql`

**Interfaces:**
- Consumes: tudo das Tasks 1–9.
- Produces: o primeiro envio real (uma cobrança aprovada pelo usuário) OU um envio de teste para a própria caixa — o que o usuário escolher — e o registro do que se viu.

> **Regra deste roteiro:** cada passo que publica, liga cron, relê e-mail ou manda e-mail pede o OK do usuário NO CHAT antes. Quem clica em **Enviar** na `/ludmilla` é o usuário (ou quem ele indicar), nunca o agente.

- [ ] **Step 1: Publicar (o push é do usuário)**

```bash
git fetch origin
git log origin/main..HEAD --oneline
```

Mostre a lista ao usuário (ela pode ter commits de outras frentes) e peça o push. Depois do push, confira que o GitHub tem o worker inteiro e publique o robô já testando o SMTP (conecta e autentica; não manda nada):

```bash
git diff --stat origin/main..HEAD -- worker/ludmilla   # tem de vir VAZIO
gh workflow run ludmilla-worker.yml -f smtp=verificar
gh run list --workflow ludmilla-worker.yml --limit 1   # esperar completed / success
gh run view --log "$(gh run list --workflow ludmilla-worker.yml --limit 1 --json databaseId -q '.[0].databaseId')" | grep -E 'smtp ok|teste do smtp falhou'
```

Expected: `success` e a linha `{"…","msg":"smtp ok: conectou e autenticou, nada foi enviado","porta":465}` (ou `587`). O `deploy.yml` do push publica a tela; abra `/ludmilla` e confira que a aba Decidir abre (ainda sem cobrança).

Se vier `teste do smtp falhou` com "não consegui falar com o servidor de e-mail (porta bloqueada…)": a VPS não sai pela 465 nem pela 587 — **PARE** e converse com o usuário (pedir à HostGator a liberação da porta é a primeira opção). Com "o Gmail recusou a senha de app": a senha do `agent_config` não serve para SMTP — o usuário gera outra no Google e grava em Claudinho / Agente de e-mails; rode o `verificar` de novo.

- [ ] **Step 2: (opcional, com o OK do usuário) um envio de teste para a própria caixa**

```bash
gh workflow run ludmilla-worker.yml -f smtp=enviar_para_a_propria_caixa
```

Expected: `teste enviado para a própria caixa da Ludmilla` no log do run, e o usuário vê na caixa da Ludmilla o e-mail "Teste de envio da Ludmilla (pode apagar)", de = para = a própria caixa. Nenhuma concessionária recebe nada. (Ele não casa regra nenhuma da ENEL nem protocolo da EDP: a leitura ignora.)

- [ ] **Step 3: Ligar os crons (com o OK do usuário)**

Escreva `$RASCUNHO/crons_agora.sql`:

```sql
select (select md5(prosrc) from pg_proc where proname = 'ludmilla_agendar_varreduras') as md5_cpfl,
       (select json_agg(json_build_object('j', jobname, 's', schedule, 'c', command) order by jobname)
          from cron.job where jobname like 'ludmilla%') as crons;
```

```bash
npx -y supabase db query --linked -f supabase/migrations/20261024170000_ludmilla_enel_cron.sql
npx -y supabase db query --linked -f "$RASCUNHO/crons_agora.sql"
```

Expected: `md5_cpfl = 3d0d2d0f1e7455ec701230bc925e1bde`; quatro jobs — `ludmilla-08h` (`0 11 * * *`) e `ludmilla-17h` (`0 20 * * *`) iguais aos de antes, mais `ludmilla-cobrancas` (`5 11-21 * * 1-5`) e `ludmilla-enel-email` (`0 11-21 * * 1-5`).

- [ ] **Step 4: As notas já lidas (decisão do usuário)**

Escreva `$RASCUNHO/notas_antigas.sql` (só código do projeto e data: nada de nome nem assunto no chat):

```sql
select m.id, p.code, p.status::text as etapa,
       to_char(m.recebido_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') as recebido,
       (m.motivo ilike '%troca do relógio agendada%') as e_nota_nova
  from public.portal_email_mensagens m
  join public.portal_accounts a on a.id = m.account_id
  join public.projects p on p.id = m.project_id
 where a.connector = 'enel'
   and (m.motivo ilike '%troca do relógio agendada%' or m.motivo ilike '%troca do relógio não foi executada%')
   and not p.is_deleted and p.archived_at is null and p.status::text <> 'completed'
 order by m.recebido_em;
```

Run: `npx -y supabase db query --linked -f "$RASCUNHO/notas_antigas.sql"` e mostre a lista ao usuário (em 24/10 eram 5 e-mails de nota). Pergunte: **reler esses e-mails para virarem cobrança** (a próxima leitura agendada os trata de novo; anexo e sino não se repetem; IA só se o projeto tinha sido achado pelo PDF — no máximo US$ 0,10 cada), ou **só daqui para frente**? Com o "sim", rode:

```sql
-- $RASCUNHO/reler_notas.sql — o mesmo "Ler de novo" da tela, para a lista que o usuário aprovou
update public.portal_email_mensagens m set concluida = false, tentativas = 0
  from public.portal_accounts a, public.projects p
 where a.id = m.account_id and p.id = m.project_id and a.connector = 'enel'
   and (m.motivo ilike '%troca do relógio agendada%' or m.motivo ilike '%troca do relógio não foi executada%')
   and not p.is_deleted and p.archived_at is null and p.status::text <> 'completed'
returning m.id;
```

Expected: o mesmo número de linhas da listagem. As notas com mais de 7 dias viram A fazer na primeira passada do cron `ludmilla-cobrancas` (às :05, em dia útil).

- [ ] **Step 5: Acompanhar a primeira leitura agendada**

Escreva `$RASCUNHO/cobrancas_agora.sql`:

```sql
select json_build_object(
  'ultimos_runs_enel', (select json_agg(x) from (
      select r.tipo, r.situacao, r.pedido_por is null as agendado, r.pedido_em, r.terminado_em, r.erro,
             r.resultado ->> 'falhas' as falhas
        from public.portal_sync_runs r join public.portal_accounts a on a.id = r.account_id
       where a.connector = 'enel' order by r.pedido_em desc limit 5) x),
  'cobrancas', (select json_agg(x) from (
      select p.code, c.nota_servico is not null as com_numero, c.situacao, c.enviadas,
             c.vence_em, c.ultima_enviada_em, c.erro
        from public.portal_cobrancas c left join public.projects p on p.id = c.project_id
       order by c.atualizado_em desc limit 10) x),
  'afazeres_de_cobranca_abertos', (select count(*) from public.portal_afazeres where tipo = 'cobrar_troca' and feito_em is null)
) as agora;
```

Depois da primeira hora cheia de um dia útil entre 8h e 18h, rode `npx -y supabase db query --linked -f "$RASCUNHO/cobrancas_agora.sql"`.
Expected: um `varredura_email` com `agendado = true`, `situacao = ok`, `falhas = 0`; e, se houver e-mail de nota novo (ou se o Step 4 releu), linhas em `cobrancas` (`agendada` ou, vencidas, `aguardando_envio`) e A fazer abertos. Run com `erro`: leia o motivo antes de qualquer outro passo.

- [ ] **Step 6: A primeira cobrança de verdade (o usuário clica)**

Quando aparecer o A fazer "Cobrar a ENEL — troca do relógio do PRJ-x (nota N)" na aba Decidir, o **usuário** abre e confere: **Para** é @enel.com/@br.enel.com e é o Canal GD que mandou a nota; **Assunto** é "RE: …" da nota; o **texto** tem a nota, a data, a UC, o titular e a NT certos (lacuna desliga o Enviar). Edita se quiser e clica em **Enviar** (8 s para Desfazer).

Em até 1 minuto, rode `$RASCUNHO/cobrancas_agora.sql` de novo.
Expected: um run `enviar_cobranca` `ok`; a cobrança em `agendada` com `enviadas = 1`, `ultima_enviada_em` de agora e `vence_em` daqui a 7 dias; no card do projeto, o comentário "📡 Ludmilla: cobrança da nota N enviada à ENEL (…), aprovada por <pessoa>." e a linha no histórico. Peça ao usuário para conferir na pasta **Enviados** do Gmail da Ludmilla que o e-mail saiu UMA vez, **dentro da conversa da nota**.

Se o run vier `erro`: o A fazer "A cobrança da nota N não saiu" mostra a razão; nada é reenviado sozinho. Senha (`EAUTH`) ou porta (`ECONNECTION`): Step 1. Depois de corrigir, o usuário clica Enviar de novo.

- [ ] **Step 7: Parar já (se algo sair errado)**

```sql
-- $RASCUNHO/parar.sql — desliga o agendamento e cancela envio que ainda não saiu da fila
select cron.unschedule('ludmilla-cobrancas');
select cron.unschedule('ludmilla-enel-email');
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.ludmilla_cobranca_falhou(r.id, 'cancelado à mão') from public.portal_sync_runs r
 where r.tipo = 'enviar_cobranca' and r.situacao = 'na_fila';
commit;
```

Um `enviar_cobranca` já `rodando` não se cancela por SQL (o robô pega a fila a cada 30 s): ele termina sozinho, enviando ou falhando.

- [ ] **Step 8: Registrar o que se viu**

Em `docs/modules/integrations/ludmilla.md`, em "O que NÃO está provado" da ENEL, acrescente o resultado: a data do primeiro envio (ou do teste para a própria caixa), a porta do SMTP que respondeu, se o e-mail entrou na conversa da nota no Gmail, quantas cobranças o Step 4 gerou, e o que ainda não foi exercido (a 2ª cobrança de uma nota, a troca realizada encerrando de verdade, a recaída de porta). Atualize a memória `ludmilla.md` com a mesma frase. Commit só desses arquivos de doc, com `git commit -F … -- docs/modules/integrations/ludmilla.md`.

---

## Autorrevisão (feita ao escrever o plano)

**Cobertura da spec:**
- §2 "A Ludmilla prepara, uma pessoa aprova" → Task 1 (`ludmilla_cobranca_aprovar` é o único caminho para o run), Task 5 (o worker só envia com `run_id` da aprovação), Task 8 (o botão), Task 10 (o usuário clica).
- §2 "7 dias, de novo a cada 7" → Task 1 (`vence_em = data + 7`, `enviada` agenda +7, trava em `aprovar` e `iniciar_envio`), Task 3 (`vencimento`, `podeEnviar`).
- §2 "resposta na conversa da nota" → Task 3 (`assuntoDaResposta`, `cabecalhosDaResposta`), Task 4 (`MensagemLida.referencias`), Task 5 (`opcoesDoEnvio`, provado no `streamTransport`).
- §2 / §3.1 "de hora em hora no expediente", função NOVA, cron NOVO, CPFL intacta pelo md5, EDP manual, "Verificar agora" igual → Task 2 (função + prova + md5 antes/depois), Task 10 (cron + md5 de novo).
- §2 / §5 "modelo curto", "bom dia/boa tarde", "retomando", assinatura num lugar só → Task 7 (`montarEmailDeCobranca`, `ASSINATURA_DA_COBRANCA`), Task 3 (`ajustarSaudacao`).
- §2 "troca já realizada → sugerir Concluído (já em implementação)" → é da frente anterior; aqui ela ENCERRA as cobranças (Task 3 `trocaFoiRealizada`, Task 4).
- §3.2 número da nota (12 dígitos junto de "nota de serviço"/"ordem"), data, prazo, cabeçalhos, tabela com os campos, RLS RESTRICTIVE, escrita só por RPC, nota repetida não duplica → Tasks 1, 3, 4.
- §3.3 A fazer na aba Decidir com o título da spec, Para/Assunto/Texto editável, Enviar/Dispensar → Tasks 1 (`ludmilla_cobranca_abrir_afazer`), 7, 8.
- §3.4 run `enviar_cobranca`, mesma conta, senha nunca pelo front, travas no worker E no banco, histórico + comentário + próxima em 7 dias, erro volta e avisa sem tentar sozinho, log sem dado de cliente → Tasks 1, 5 (testes de privacidade com senha e texto na mensagem do erro).
- §3.5 quando param (troca realizada, dispensada, projeto concluído/arquivado) → Task 1 (encerrar, dispensar, cron) e Task 4.
- §4 nada muda na CPFL/EDP, leitura continua só leitura, fase 2 fora → Restrições globais, Tasks 2/4/5 (`git diff --stat` vazio nos arquivos da EDP).
- §6 riscos: e-mail errado (clique + trava + texto editável), nota mal lida (regra estrita, sem número = cobrança sem número com aviso), custo da leitura de hora em hora (aceito pela spec: "se pesar, otimizar"; ninguém otimiza agora), "Todos os e-mails" (conferido no Step 5 da Task 10, primeiro run agendado).

**Placeholders:** nenhum "TBD/depois/etc."; os três pontos que dependem de outra frente estão nomeados com o passo que os confere (Task 3 Step 1: o nome do estado "realizada" e a frase de exemplo; Task 4 Step 2: campo obrigatório novo em `DepsEnel`; Task 8 Step 4b: o que a Task 8 da página nova tenha acrescentado em `BotoesDaDecisao`). O `Co-Authored-By` das mensagens leva o modelo que executar (regra do repositório).

**Consistência de nomes:** `ludmilla_cobranca_agendar` / `agendarCobranca` / `DepsEnel.agendarCobranca`; `ludmilla_cobranca_encerrar_por_troca` / `encerrarCobrancasPorTroca` / `DepsEnel.encerrarCobrancas`; `ludmilla_cobranca_iniciar_envio` / `iniciarEnvioDeCobranca` / `DepsEnvio.iniciarEnvio` (colunas `situacao_anterior`, `aprovada_por`, `ultima_enviada_em`, `in_reply_to`, `referencias`, `nota_servico` ↔ `CobrancaParaEnviar`); `ludmilla_cobranca_aprovar` / `aprovarCobrancaNoBanco` / `AcoesDaCaixa.enviarCobranca`; `ludmilla_cobranca_dispensar` / `dispensarCobrancaNoBanco` / `AcoesDaCaixa.dispensarCobranca`; `AcaoDaDecisao` `'enviar_cobranca' | 'dispensar_cobranca'` em `ludmillaPainel.ts`, `AbaDecidir.tsx` e `PainelDeDetalhe.tsx`; `CobrancaDoAfazer` (colunas do embed de `SELECT_AFAZER`) = colunas de `portal_cobrancas`; lacunas e teto de 5000 iguais na tela e no banco (teste); a regex do destinatário igual no worker e no banco (teste).

