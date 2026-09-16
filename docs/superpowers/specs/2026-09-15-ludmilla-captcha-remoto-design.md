# Ludmilla — CAPTCHA remoto pela equipe e sessão viva

**Data:** 15/09/2026 · **Decisão do usuário:** "Sim, os dois".

## Problema

A Elektro (Portal GD) só abre para um Chrome de verdade em IP de pessoa e
pede um código de imagem no login. A estação local resolve o IP; o código
exigia alguém sentado no PC do coworking a cada visita. O usuário pediu um
jeito de "o preenchimento acontecer" sem essa pessoa. A Ludmilla **não
resolve CAPTCHA** (nem OCR, nem IA, nem serviço de terceiros — decisão
firme). O que dá para tirar é a exigência de estar *naquele PC*, e a
frequência.

## Desenho

### 1. CAPTCHA remoto — a pessoa responde de onde estiver

1. A estação abre o portal, preenche e-mail e senha (do cofre) e, em vez de
   só esperar, **fotografa o código da imagem** (o `<img>` ao lado do campo),
   sobe em `ludmilla/{tenant}/captcha/{id}.png` e cria uma linha em
   `portal_captchas` (`aguardando`, vale 5 min). Sino para toda a equipe do
   tenant: "📡 Ludmilla precisa do código da Elektro" → clique abre `/ludmilla`.
   O balão local continua: quem estiver no PC também pode digitar no Chrome.
2. Na `/ludmilla` (funciona no celular) aparece o cartão "Digite o código da
   imagem" com a foto, um campo e "Enviar" → RPC `ludmilla_captcha_responder`
   (qualquer admin/staff do tenant; grava `resposta`, `respondido_por`).
3. A estação consulta a linha a cada 2 s (`ludmilla_captcha_ler`): com
   resposta, preenche o campo, envia o formulário e fecha a linha (`usado`).
   Portal recusou o código → linha `recusada` com a mensagem do portal, nova
   foto, nova linha (`tentativa` 2, 3). Ninguém respondeu em 5 min → linha
   `expirada`, run `sessao_expirada` (como hoje).
4. A resposta é 4–8 caracteres de uma imagem descartável: não é segredo. A
   imagem é apagada do bucket ao fechar a linha (melhor esforço).

Quem responde continua sendo uma pessoa — o CAPTCHA cumpre o papel dele. O
que muda é onde ela está.

### 2. Sessão viva — para pedir o código raramente

Depois de uma visita que entrou no portal, a estação **não fecha o Chrome**:
guarda o contexto por portal e, a cada 10 min, abre a URL base do portal
(GET, nunca recarrega um POST) e confere se o formulário de login voltou.
Sessão viva → `portal_accounts.sessao_viva_desde` fica preenchido (a página
mostra "sessão no portal viva desde …"); sessão morreu → fecha o contexto,
registra quanto durou, zera o campo. O próximo run entra de novo (e aí pede
o código, remoto ou local). Sem truque: é o que uma pessoa com a aba aberta
faz.

### Fora do escopo

Levar qualquer coisa para a VPS (Akamai bloqueia o IP antes do login);
resolver o código por máquina; proxy residencial ou outra forma de contornar
a proteção do portal.

## Segurança

- `portal_captchas` com RLS: equipe do tenant lê; escrita só por RPC.
- `ludmilla_captcha_pedir/ler/fechar`: service role OU operador da conta
  (`ludmilla_operador_ok`). `ludmilla_captcha_responder`: equipe do tenant.
- Imagem no bucket privado `ludmilla`, pasta do tenant (políticas já
  existentes de leitura pela equipe e escrita pelo operador; DELETE novo só
  em `{tenant}/captcha/`).
