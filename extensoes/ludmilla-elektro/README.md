# Ludmilla — extensão do Chrome para a Elektro

Lê a lista de solicitações do **Portal GD da Elektro** (Neoenergia), na sua
própria sessão, e envia os status para a Ludmilla. **Só leitura**: não faz
login, não clica em "Solicitar Vistoria", não baixa nada. Quem entra e digita
o CAPTCHA é você — por isso a Akamai não tem o que barrar.

Por que a extensão existe: o Portal GD bloqueia navegador automatizado antes do
login, então a Ludmilla não consegue ler a Elektro sozinha (ver
`docs/modules/integrations/ludmilla.md`). A pessoa lê; a extensão só copia o que
está na tela para o mesmo trilho das outras concessionárias.

## Instalar (uma vez)

1. No Chrome, abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha esta pasta
   (`extensoes/ludmilla-elektro`).
4. A extensão **Ludmilla — Elektro** aparece na barra. Fixe-a se quiser.

## Configurar a chave

1. No GD Manager, vá em **Concessionárias → Elektro → Chaves da API** e crie uma
   chave. Ela aparece **uma única vez** — copie na hora.
2. Clique na extensão → **Opções (chave)**, cole a chave `gdm_…` e **Salvar**.

A chave fica guardada só na extensão, nunca na página do portal.

## Usar

1. Entre no Portal GD da Elektro como sempre (você digita o código da imagem) e
   abra a **lista de solicitações**.
2. Clique no ícone da extensão. O popup diz quantas solicitações leu na página.
3. Clique em **Enviar para a Ludmilla**. Ele mostra quantas viraram cartão.
4. Na `/ludmilla`, confirme os cartões. **Nada se move sozinho.**

A lista tem páginas (1, 2, 3, 4). A extensão lê a **página aberta**. Envie
página a página, ou aumente "solicitações por página" e mande tudo de uma vez.

## O que ela envia

Por linha, só `protocolo`, `status` e `titular` — o que a API
`ludmilla-status` aceita. O casamento com o projeto (por protocolo e, se não
achar, por titular) e a tradução do status em etapa acontecem no servidor.

## Arquivos

| Arquivo | Papel |
|---|---|
| `manifest.json` | Declara a extensão; age só no domínio da Elektro. |
| `leitura.js` | Lê a tabela e monta o envio (funções puras testadas em `leitura.test.js`). |
| `content.js` | Na página: lê a tabela quando o popup pede. Só leitura. |
| `background.js` | Faz o POST para a API com a chave. |
| `popup.html` / `popup.js` | O botão "Enviar para a Ludmilla". |
| `options.html` / `options.js` | Onde você cola a chave. |

O teste do leitor roda com o resto do front: `npm test`.
