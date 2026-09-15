# Ludmilla — Elektro pela estação local (coworking)

**Data:** 2026-09-15 · **Estado:** aprovado em conversa · **Escopo:** sub-projeto
Elektro. Spec-mãe: `2026-09-14-ludmilla-design.md`.

## 1. Por que não é igual à CPFL

- O Portal GD da Neoenergia Elektro (`gdneoenergiaelektro.neoenergia.com`)
  devolve **403 (Akamai)** a navegador sem tela e a IP de datacenter — o
  robô da VPS nem vê a tela de login. Um **Chrome de verdade, com janela, na
  máquina de uma pessoa** passa (testado em 15/09/2026: 200, "Portal GD
  Acessante").
- O login tem **CAPTCHA de imagem** em todo acesso (app JSF/PrimeFaces,
  campos `j_idt14:j_idt16` e-mail, `j_idt14:j_idt18` senha,
  `j_idt14:captchaCode`). **A Ludmilla não resolve CAPTCHA** — regra fixa,
  também a pedido. Uma pessoa digita os caracteres.
- A Elektro **não avisa por e-mail** de forma confiável (usuário): o caminho
  do Claudinho está descartado.

Decisão do usuário: rodar numa **máquina Windows do coworking**, que fica
ligada o dia inteiro, às vezes com gente por perto, às vezes não.

## 2. O que muda no desenho

O robô é o **mesmo** `worker/ludmilla`, em **modo local**
(`LUDMILLA_MODO=local`):

| | VPS (CPFL) | Local (Elektro) |
|---|---|---|
| navegador | headless shell | **Chrome instalado, com janela**, perfil persistente próprio |
| acesso ao banco | service role | **usuário `staff` dedicado** (`ludmilla.coworking`), sessão guardada em `%LOCALAPPDATA%\Ludmilla\` |
| runs que pega | todos | só contas com `modo = 'local'` e `operador_local` = o usuário dele |
| credenciais do portal | RPC service role | RPC só para o `operador_local` da conta |
| login no portal | robô | **robô preenche e-mail/senha; pessoa digita o CAPTCHA** |
| quando ninguém atende | — | run fecha como `sessao_expirada` ("aguardando login no coworking"), sino para admins, tenta no próximo horário |

### 2.1 Banco

- `portal_accounts`: `modo TEXT ('vps'|'local') DEFAULT 'vps'`,
  `operador_local UUID` (o usuário da estação), `estacao_vista_em TIMESTAMPTZ`
  (heartbeat: a página mostra online/offline).
- RPCs para equipe autenticada, todas checando tenant e
  `operador_local = auth.uid()`:
  - `ludmilla_claim_run_local()` — próximo run `na_fila` das contas locais
    do operador (SKIP LOCKED).
  - `ludmilla_finalizar_run_local(...)` — mesma assinatura da de service
    role; delega para a implementação comum (`ludmilla_finalizar_run_impl`).
  - `ludmilla_portal_credentials_local(p_account_id)` — login/senha do
    Vault, só o operador da conta.
  - `ludmilla_estacao_pulsa(p_account_id)` — heartbeat.
  - `ludmilla_anexos_pendentes_local`, `ludmilla_anexo_enviado_local`,
    `ludmilla_anexo_erro_local`, `ludmilla_protocolos_de_interesse_local` —
    idem, com a checagem do operador.
- Sino: `ludmilla_finalizar_run_impl` notifica admins quando uma conta local
  fica `sessao_expirada` ("a Ludmilla precisa que alguém faça o login…").
- **Agendamento 2×/dia** (08h e 17h Brasília = 11:00 e 20:00 UTC) via
  `pg_cron`: `ludmilla_agendar_varreduras()` insere `varredura` para toda
  conta `enabled` com login — vale para VPS e local.

### 2.2 Robô em modo local

- `chromium.launchPersistentContext(<perfil>, { channel: 'chrome', headless: false })`;
  perfil em `%LOCALAPPDATA%\Ludmilla\chrome-elektro`. Contexto vive entre runs
  (cookies do portal podem sobreviver); a janela fecha ao terminar.
- Conector Elektro:
  - `entrar`: abre o portal; se há formulário de login → preenche e-mail e
    senha, foca o campo do CAPTCHA, **avisa** (balão do Windows + a própria
    janela do Chrome na frente) e **espera até 5 min** a URL/tela mudar. Sem
    resposta → `ErroLudmilla('sessao_expirada', 'Ninguém fez o login…')`.
  - `descobrir`: depois do login, guarda HTML/rede das telas (lista de
    solicitações, paginação, detalhe) — o roteiro de leitura é escrito sobre
    isso (JSF não tem API JSON; a leitura será da tela).
  - `varrer`: escrito após a descoberta. Sem escrita no portal.
- Laço local: `pegarRunLocal` a cada 30 s; `pulsar` a cada 60 s; sem run,
  Chrome fechado.

### 2.3 Instalação (Windows)

`worker/ludmilla/deploy/windows/instalar.ps1`: instala Node 22 (winget) se
faltar; copia o programa para `%LOCALAPPDATA%\Ludmilla\app`; `npm ci`;
pede e-mail/senha do **usuário da estação** no GD Manager (uma vez; guarda
a sessão); registra tarefa no Agendador ("Ludmilla", no logon, sem janela);
inicia. `atualizar.ps1` baixa a versão nova do repositório.

## 3. Limites

- Nunca resolve CAPTCHA, nunca chama endpoint de escrita do portal.
- A senha da Elektro passa pela máquina do coworking só em memória, na hora
  do preenchimento (decisão do usuário: "a pessoa só resolve o CAPTCHA").
- O usuário `ludmilla.coworking` é `staff` sem projetos atribuídos: enxerga
  o que a RLS dá à equipe do tenant, nada mais.

## 4. Aceite

Na máquina do coworking: tarefa instalada; "Verificar agora" na Elektro
abre o Chrome, preenche e-mail/senha, avisa; a pessoa digita o CAPTCHA; a
descoberta guarda as telas no bucket. Depois do roteiro: varredura em `ok`
com protocolos lidos e recomendações na página.
