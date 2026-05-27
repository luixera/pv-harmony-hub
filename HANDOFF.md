# 🔄 Handoff — pv-harmony-hub

**Última sessão:** 2026-05-26
**Trabalho não-commitado:** P0 Security pack (5 itens) + P1 Foundation (5 itens) + import de dados reais

---

## ⚡ Pra retomar amanhã

### 1. Subir o ambiente (do zero, na ordem)

```bash
# 1. Colima (Docker VM) — se não estiver rodando
colima start

# 2. Supabase local (excluindo vector/edge-runtime — Colima quirk)
cd ~/Documents/VPS/projetos/pv-harmony-hub
supabase start -x vector,edge-runtime --ignore-health-check

# 3. Dev server (npm run dev) — ou usar preview MCP via Claude
npm run dev
```

URLs:
- App: http://localhost:5173
- Studio: http://127.0.0.1:54323
- API: http://127.0.0.1:54321

### 2. Login de teste

- Email: `teste@gmail.com`
- Senha: `123456`
- Role: admin

### 3. Conversar com o Orion (Claude)

No Claude Code, abra o diretório `~/Documents/VPS` e digite:

```
/AIOX:agents:aiox-master
```

Depois mande:

```
Continuar de onde paramos no pv-harmony-hub. Lê HANDOFF.md e a memória.
```

O Orion vai automaticamente carregar a memória persistida e este handoff, e te apresentar as próximas opções.

---

## 📊 Estado atual

| Camada | Status |
|---|---|
| Banco local | 26 migrações aplicadas, 110 projetos reais importados |
| Auth | Admin de teste criado e funcional |
| Dashboard | 41 ativos / 73 concluídos / R$ 32.100 em aberto / 89% aprovação |
| Financeiro | R$ 62.600 faturado / R$ 30.500 recebido (49%) / R$ 32.100 em aberto |
| P0 Security pack | ✅ 5/5 entregues, typecheck limpo, **não commitado** |
| P1 Foundation | ✅ 5/5 entregues, typecheck limpo, **não commitado** |
| Bug `due_date` no Financeiro | ✅ corrigido (era bug de prod também) |

## 📂 Arquivos importantes

- `.squad-analysis/00-ROADMAP.md` — roadmap consolidado pelo squad
- `.squad-analysis/01-architecture.md` a `04-devops-security.md` — auditorias detalhadas
- `scripts/import_ploomes_v2.py` — importa planilha enriquecida
- `supabase/migrations/2026052[67]*.sql` — migrações novas desta sessão

## 🎯 Próximos passos (em ordem discutida)

1. **Commitar** P0 e P1 como 2 PRs separados — pronto pra revisar, tudo testado
2. **Kanban personalizável** — feature pedida, arquitetura já existe (`kanban_models`, `kanban_columns` com flags avançados). Falta UI: editor visual, templates prontos, atribuir modelo por empresa. MVP ~3-4 dias
3. **Email Agent v2 (AI Operator)** — chat sobre o pipeline, alimentado por Gmail+Claude. Diferencial defensivo. ~2 semanas
4. **Bureau Positioning** — white-label + per-protocol billing + dashboard consolidado pro bureau. Reposicionamento comercial. ~3 semanas

## ⚠️ Pequenos tropeços conhecidos pra evitar

- `supabase start` SEM os flags `-x vector,edge-runtime` falha no Colima (socket mount)
- Login via `preview_fill` não dispara `onChange` do React — usar `supabase.auth.signInWithPassword` no console se precisar logar via automação
- Cache do TanStack Query persiste — reload completo (`window.location.reload()`) reseta
- `--no-verify-jwt` foi removido do deploy.yml; se for redeployar edge functions manualmente, garantir que isso NÃO entre de novo

---

**Quando voltar:** abre o repo, sobe os 3 serviços (colima → supabase → vite), invoca `/AIOX:agents:aiox-master` e pede "continuar de onde paramos no pv-harmony-hub". Está tudo persistido.
