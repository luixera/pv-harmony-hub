# Ludmilla — Criar Projeto na CPFL

> Spec aprovado em 16/09/2026 após spike de observação do fluxo real no portal.

## Contexto

O GD Manager já gera toda a documentação do projeto (unifilar, ART, datasheets).
O próximo passo manual é abrir o portal da CPFL, preencher um formulário de 5 passos
e criar o projeto para que a concessionária possa analisar.

Esta spec define a automação desse preenchimento via Playwright (mesmo robô Ludmilla
que já lê a CPFL), acionada por um botão no modal do projeto.

**Escopo desta fase:**
- Criação do projeto (passos 1–5 + "Enviar Depois" no passo 6)
- Registro do node ID CPFL no banco
- Histórico com prints de cada passo

**Fora do escopo:**
- Upload de documentos (passo 6) — fase futura
- Geração de protocolo — só aparece após envio de documentos

---

## Fluxo do usuário

1. Admin ou projetista abre o modal de um projeto CPFL sem `cpfl_node_id`
2. Clica em **"Criar na CPFL"** (aba Geral & Comentários)
3. Um painel de progresso substitui o botão no modal
4. Os passos aparecem em tempo real com ícone de status e thumbnail clicável
5. Ao concluir: node ID exibido + link para o projeto no portal CPFL
6. Em caso de erro: mensagem em português + print do momento da falha
7. Todo o histórico de tentativas fica acessível em `/ludmilla`

---

## Banco de dados

### Nova tabela `portal_criacao_passos`

```sql
create table portal_criacao_passos (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references portal_sync_runs(id) on delete cascade,
  passo       int  not null,  -- 1..6
  nome        text not null,  -- 'introducao' | 'dados_uc' | 'dados_projeto' | 'dados_cliente' | 'revisao' | 'concluido'
  status      text not null check (status in ('rodando','ok','erro')),
  screenshot  text,           -- caminho no bucket ludmilla
  erro        text,           -- mensagem em português, nullable
  created_at  timestamptz not null default now()
);
```

RLS RESTRICTIVE: SELECT via `ludmilla_equipe_ok()`; INSERT somente `service_role`.

### Novo campo em `projects`

```sql
alter table projects add column cpfl_node_id text;
```

### Novo tipo de job

`portal_sync_runs.tipo = 'criar_projeto'`; `dados = { "project_id": "<uuid>" }`.

### Nova RPC `ludmilla_salvar_node_cpfl`

```sql
create or replace function ludmilla_salvar_node_cpfl(
  p_project_id uuid,
  p_node_id    text
) returns void language plpgsql security definer as $$
begin
  -- garante que o projeto pertence ao tenant da conta usada no run
  update projects
  set    cpfl_node_id = p_node_id
  where  id = p_project_id
    and  tenant_id = (
      select pa.tenant_id
      from   portal_sync_runs psr
      join   portal_accounts  pa on pa.id = psr.account_id
      where  psr.dados->>'project_id' = p_project_id::text
      order  by psr.created_at desc
      limit  1
    );
end;
$$;
```

### Nova RPC `ludmilla_registrar_passo_criacao`

Chamada pelo worker via `service_role` após cada passo:

```sql
create or replace function ludmilla_registrar_passo_criacao(
  p_run_id     uuid,
  p_passo      int,
  p_nome       text,
  p_status     text,
  p_screenshot text default null,
  p_erro       text default null
) returns void language plpgsql security definer as $$
begin
  insert into portal_criacao_passos(run_id, passo, nome, status, screenshot, erro)
  values (p_run_id, p_passo, p_nome, p_status, p_screenshot, p_erro)
  on conflict (run_id, passo) do update
    set status = excluded.status, screenshot = excluded.screenshot, erro = excluded.erro;
end;
$$;
```

### Poll do worker

Intervalo muda de 30 s → **5 s** enquanto `portal_sync_runs` tiver linhas `na_fila`;
volta a 30 s quando a fila zera.

---

## Worker

### Arquivo novo: `worker/ludmilla/src/conectores/cpfl-criar.ts`

Exporta `criarProjeto(page, dados, registrarPasso)`.

`registrarPasso(n, nome, status, screenshotPath?, erro?)` — helper que:
1. Faz screenshot da página
2. Faz upload ao bucket `ludmilla/{tenant_id}/criacao/{run_id}/passo-{n}.png`
3. Chama `ludmilla_registrar_passo_criacao(run_id, n, nome, status, path, erro)`

### Utilitário `worker/ludmilla/src/dms.ts`

Converte graus decimais → graus-minutos-segundos para os campos Latitude/Longitude:

```
-23.207407  →  "23°12'26.7\"S"
-46.891502  →  "46°53'29.4\"W"
```

### Passos de execução

| Passo | Nome | O que o robô faz |
|---|---|---|
| 1 | `introducao` | Navega para `/gestao-projetos/node/add/project_60`; seleciona "Orçamento de Conexão"; marca Não nos 3 checkboxes de necessidades; clica Avançar |
| 2 | `dados_uc` | Digita `unit_consumer` no campo Nº da UC; clica "Buscar"; aguarda auto-preenchimento; preenche Latitude e Longitude em DMS (`coordinates` do banco convertido); clica Avançar |
| 3 | `dados_projeto` | Preenche Título (`UFV [customers.name]`), Sistema de Compensação (fixo), Categoria Existente (valor retornado pelo Buscar; fallback: padrão de entrada do GD Manager), Fases + Disjuntor (valores retornados pelo Buscar; fallback: padrão de entrada), Caixa de medição + Cabos (padrão de entrada), módulos (`project_equipments`), Fonte geradora ENERGIA SOLAR; clica Avançar |
| 4 | `dados_cliente` | Digita `customers.cpf`; clica "Consultar"; aguarda auto-preenchimento; confirma endereço = da instalação; aceita os termos; clica Avançar |
| 5 | `revisao` | Clica Avançar; aguarda URL mudar para `/node/{id}/edit` (timeout 60 s via `comPaciencia`); extrai node ID com regex `/node\/(\d+)\/edit/`; chama `ludmilla_salvar_node_cpfl` |
| 6 | `concluido` | Clica "Enviar Depois"; captura print final |

**Erro: UC não encontrada na CPFL**
Se após clicar "Buscar" o portal não preencher o nome do cliente (campo vazio após 15 s),
o robô registra `erro` no passo `dados_uc` com mensagem "UC não encontrada no portal CPFL"
e para. O admin corrige a UC no GD Manager e tenta de novo.

**Regra do disjuntor/categoria:**
- Primário: valor retornado pelo "Buscar" da UC (CPFL é a fonte de verdade)
- Fallback: `project_general_data` (padrão de entrada do GD Manager) quando CPFL não retorna

**Em caso de erro em qualquer passo:**
- `registrarPasso(n, nome, 'erro', screenshot, mensagemEmPortugues)`
- `ludmilla_finalizar_run(run_id, 'erro', mensagem, screenshot)`
- Para a execução

---

## Frontend

### Botão "Criar na CPFL"

Localização: aba **Geral & Comentários** do modal de projeto, bloco do padrão de entrada.

Condições de exibição:
- Tenant `is_library`
- Usuário é `admin` ou `staff`
- `project.concessionaria === 'CPFL'`
- `project.cpfl_node_id` é null

Quando `cpfl_node_id` existe: substitui o botão por "Projeto CPFL: `{node_id}`" com link
para `cpfl.com.br/gestao-projetos/node/{node_id}`.

### Componente `CriarNaCpflPanel`

Ao clicar:
1. Chama `ludmilla_pedir_run(account_id, 'criar_projeto', { project_id })` onde `account_id`
   é a conta CPFL ativa do tenant (única conta com `concessionaire_id` = CPFL) — buscada
   junto com os dados do projeto no carregamento do modal
2. Recebe `run_id`
3. Subscreve Realtime em `portal_criacao_passos` filtrado por `run_id`
4. Renderiza cada linha conforme chega:

```
[ Criando projeto na CPFL... ]

✅  Introdução                    🖼️
✅  Dados da UC                   🖼️
🔄  Dados do projeto...
⬜  Dados do cliente
⬜  Revisão
⬜  Envio de documentos

❌  Dados do projeto — timeout ao aguardar módulos
    [ver print]   [Fechar]
```

- Thumbnail clicável → abre screenshot em tamanho cheio (URL assinada 1 h do bucket)
- Ao receber `nome='concluido'` e `status='ok'`: exibe node ID + link CPFL + botão Fechar
- Ao receber `status='erro'`: exibe erro em vermelho + print + botão Fechar

### Página `/ludmilla`

Adiciona renderização do tipo `criar_projeto` na lista de runs existente.
Ao expandir: mostra os passos de `portal_criacao_passos` com status e thumbnails,
igual ao histórico de varreduras.

---

## Segurança

| Ação | Quem pode |
|---|---|
| Acionar `criar_projeto` | admin/staff `is_library` via `ludmilla_pedir_run` |
| INSERT em `portal_criacao_passos` | somente `service_role` (worker) |
| SELECT em `portal_criacao_passos` | `ludmilla_equipe_ok()` |
| Gravar `cpfl_node_id` | somente via RPC `ludmilla_salvar_node_cpfl` (service_role) |
| Ler `cpfl_node_id` | políticas RLS existentes do projeto |

---

## Screenshots

Bucket: `ludmilla` (existente)
Pasta: `{tenant_id}/criacao/{run_id}/passo-{n}.png`
Exibição: URL assinada de 1 h, gerada no frontend via `supabase.storage.from('ludmilla').createSignedUrl(...)`

---

## O que não muda

- Robô da varredura CPFL: sem alteração
- Credenciais: mesma conta portal já cadastrada em `portal_accounts`
- Sessão Playwright: mesma sessão logada do worker existente
- Deploy: mesmo workflow `ludmilla-worker.yml`
