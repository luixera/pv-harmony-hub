# 🚀 Deploy automático — GitHub Actions

Cada `git push origin main` dispara build + deploy pra produção. Sem comando manual.

## 📋 Pré-requisitos (1ª vez só)

Configurar 6 secrets no GitHub. Vai em:

**Repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | O que é | Onde pegar |
|---|---|---|
| `VPS_HOST` | IP da VPS de hospedagem | Pede pro responsável pela VPS |
| `VPS_USER` | Usuário SSH na VPS | Pede pro responsável pela VPS |
| `VPS_SSH_KEY` | Conteúdo completo da chave privada de deploy (linhas `-----BEGIN OPENSSH PRIVATE KEY-----` até `-----END OPENSSH PRIVATE KEY-----`) | Pede pro responsável pela VPS — ele te manda por canal privado (Signal, WhatsApp, e-mail criptografado). **Nunca peça em chat público.** |
| `VITE_SUPABASE_URL` | URL do projeto Supabase | Supabase Dashboard → Settings → API → Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon key do Supabase (formato novo `sb_publishable_*` ou antigo `eyJ...`) | Supabase Dashboard → Settings → API → Project API keys → anon/public |
| `VITE_GOOGLE_MAPS_API_KEY` | API Key do Google Maps Platform | Google Cloud Console → APIs & Services → Credentials. **Restringir pra HTTP referer do domínio de produção antes de usar.** |

⚠️ **Os 3 últimos secrets também tem que estar no teu `.env.local`** se for rodar `npm run dev` localmente. O `.env.local` está no `.gitignore`, nunca commita.

## 🔄 Fluxo de trabalho

```bash
git checkout -b minha-feature
# ... edita código ...
git add .
git commit -m "feat: nova tela X"
git push origin minha-feature
# abre PR no GitHub → revisa → merge no main
# → push no main DISPARA o workflow automaticamente
# → ~3 minutos depois o site está atualizado
```

Acompanha o deploy em: **Repo → Actions → Deploy para produção**

## 🛠️ Disparar deploy manual

Se precisar redeployar sem commit novo:

**Repo → Actions → Deploy para produção → Run workflow → Branch: main → Run**

## 🐛 Se o deploy falhar

| Erro no log | Causa provável | Solução |
|---|---|---|
| `Permission denied (publickey)` | `VPS_SSH_KEY` errado ou chave não autorizada na VPS | Avisa o responsável pela VPS |
| `Connection timed out` | Firewall da VPS bloqueou o runner do GitHub | Avisa o responsável pela VPS |
| `npm ci` falha | `package-lock.json` fora de sincronia | Roda `npm install` local, commita o `package-lock.json` atualizado |
| Build falha com `VITE_*` undefined | Faltou criar o secret no GitHub | Confere lista acima |
| Smoke test retorna 500 | Build subiu mas algo quebrou em runtime | Abre F12 do navegador, vê o erro real |

## 🏗️ O que o workflow faz

1. Clona o repo
2. Instala Node 20 + cacheia `node_modules`
3. `npm ci` (instala dependências)
4. `npm run build` (gera `dist/`) **usando os secrets como env vars**
5. SSH na VPS usando a chave de deploy
6. `rsync` do `dist/` pra pasta de produção no nginx
7. `chown www-data` na pasta
8. Smoke test: confere se o site responde HTTP 200

Tempo total: ~2-3 minutos.

## 🔐 Sobre a segurança

- A `VPS_SSH_KEY` é uma chave **dedicada** que só serve pra esse deploy — não é a chave pessoal do dono da VPS. Se vazar, ele revoga só essa chave e o resto da VPS continua seguro.
- A VPS tem um serviço de defesa SSH que bana qualquer chave fora de whitelist — por isso só essa chave funciona.
- Todos os secrets ficam criptografados no GitHub e nunca aparecem no log do workflow (mascarados como `***`).
- **Nunca cole valores reais de secrets neste documento** — ele está num repositório público.

## 📡 Domínios

- **Produção:** apontada pela config do nginx na VPS
- **Staging:** subdomínio `staging.*` servindo `dist-staging/` (se precisar de deploy de branch específica em staging, dá pra adicionar um segundo workflow `deploy-staging.yml`)
