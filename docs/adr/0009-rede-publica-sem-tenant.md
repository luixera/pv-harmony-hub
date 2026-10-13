# ADR 0009 — Base pública de rede elétrica sem `tenant_id`

**Status**: aceito · **Data**: out/2026

## Contexto

O módulo de capacidade de rede (spec
[2026-10-10-capacidade-rede-design.md](../superpowers/specs/2026-10-10-capacidade-rede-design.md))
precisa guardar a **BDGD da ANEEL** — subestações, alimentadores e
transformadores de distribuição da CPFL, na ordem de centenas de milhares de
linhas por distribuidora.

Esse dado é **público e idêntico para todos os tenants**: é a rede física da
concessionária, publicada em dados abertos pela ANEEL. Nenhum tenant tem uma
versão própria dela, e nenhum tenant pode alterá-la.

O `CLAUDE.md` chama o isolamento de tenant de **inegociável**: todo dado de
negócio carrega `tenant_id` e é isolado por política RLS RESTRICTIVE
(ADR 0001). Seguir essa regra ao pé da letra aqui significaria replicar a base
inteira por tenant assinante.

## Decisões

1. **As tabelas `rede_*` não têm `tenant_id`.** Elas pertencem ao **tenant
   biblioteca** (`tenants.is_library`), como `engineering_rules` e as contas de
   portal da Ludmilla já fazem. Alternativa rejeitada: replicar por tenant —
   multiplicaria centenas de milhares de linhas por assinante sem nenhum ganho
   de isolamento, porque o conteúdo seria byte a byte o mesmo.

2. **RLS continua habilitada, com leitura restrita a master.** O acesso é o
   mesmo do Motor de Diagramas e do Motor de Engenharia: só a GD Manager. A
   política usa `public.is_master(auth.uid())` — a função que o projeto já
   emprega nas RPCs `console_*` e `master_*` —, envolvida em `(select …)` para
   não rodar por linha. O ADR 0003 (`app_metadata`) continua valendo para papel
   e tenant **dentro** do tenant; não é o gate de master, e é dali que o papel
   viria se a leitura fosse aberta a admin/staff no futuro.

3. **Escrita só por service role.** Nenhuma política de INSERT/UPDATE/DELETE
   para `authenticated`. A base é alimentada pelo script de ingestão que roda na
   VPS; não existe caminho pela API para alterá-la.

4. **O acesso master-only aqui não é confidencialidade.** O dado é aberto na
   ANEEL — qualquer um baixa o mesmo `.gdb`. A restrição é **controle de
   superfície de produto**: decisão do usuário de out/2026 de manter a
   ferramenta interna enquanto o indicador não é calibrado contra pareceres
   reais. É revisável sem mexer no modelo de dados: liberar para `admin`/`staff`
   do tenant é trocar a condição do helper, não migrar tabela.

## Consequências

**A favor**

- A base cresce uma vez, não por assinante: o banco sai de 58 MB para a faixa de
  300–400 MB em vez de multiplicar isso pelo número de tenants.
- Uma só ingestão anual alimenta todo mundo.
- Abrir a ferramenta para os tenants depois é mudança de política, não de schema.

**Contra, e aceito**

- Abre precedente para "dado público não leva `tenant_id`". Para não virar porta
  larga, o critério é estreito e fica registrado aqui: **só vale para dado
  externo, público, imutável pelo app e idêntico para todos os tenants**.
  Qualquer dado que um tenant possa alterar, ou que varie entre tenants, continua
  sob a regra do ADR 0001 sem exceção.
- Uma consulta que cruze rede com dado de tenant precisaria de cuidado extra com
  o isolamento. Hoje isso não existe: por decisão de escopo de 10/10/2026 o
  módulo **não cruza com projetos**. Se essa decisão mudar, o cruzamento deve
  ficar numa RPC `security definer` que filtre o lado do tenant explicitamente —
  nunca num `join` solto exposto pela API.
