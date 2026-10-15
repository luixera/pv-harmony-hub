# ADR 0010 — PWA com cache da casca, sem fila de escrita offline

**Status**: aceito · **Data**: out/2026

## Contexto

O GD Manager virou instalável no celular (spec
[2026-10-15-gd-mobile-pwa-design.md](../superpowers/specs/2026-10-15-gd-mobile-pwa-design.md)).
Os dois públicos da primeira fase são o **gestor acompanhando** e a **empresa
integradora** — gente que consulta o andamento e envia alguma coisa pontual, não
gente que preenche formulário dentro de uma subestação sem sinal.

Um service worker abre duas portas de uma vez. A primeira é guardar a casca
(HTML, JS, CSS, ícones), para o app abrir instantâneo e sobreviver a sinal ruim.
A segunda é guardar **escritas** feitas offline numa fila, para sincronizar
quando a rede voltar.

A segunda é a que parece generosa e é a que custa caro. No GD Manager, um
projeto tem etapa, histórico com autor, protocolo na concessionária e
financeiro — tudo com regra de negócio no banco e gatilho por mudança de etapa.
Uma fila de escrita significa: duas pessoas movendo o mesmo projeto, a mesma
etapa gravada duas vezes no `project_history`, e dado velho aplicado por cima de
dado novo quando o celular que ficou três horas sem sinal finalmente sincroniza.
Resolver isso exige versionamento por registro e política de conflito — um
subsistema inteiro, que não foi pedido.

## Decisões

1. **O service worker guarda só a casca.** `runtimeCaching: []`: nenhuma
   resposta do Supabase entra em cache. Dado sempre vem da rede. Sem rede, o app
   abre e mostra erro de carregamento — o que é honesto e previsível.

2. **Não existe fila de escrita offline.** Alternativa rejeitada: implementar
   `Background Sync`. O motivo não é esforço, é correção — sem política de
   conflito, a fila troca "não consegui salvar" por "salvei errado e ninguém
   percebeu". Se o **projetista em campo** entrar no escopo um dia, isso volta à
   mesa como decisão própria, com versionamento de registro junto.

3. **Atualização com aviso, não automática** (`registerType: 'prompt'`). Quando
   há versão nova, aparece um aviso com botão "Atualizar". Alternativa rejeitada:
   `autoUpdate` — recarrega a página sozinho e pode descartar o que a pessoa
   estava digitando num formulário longo, que é exatamente o que o GD Manager
   tem. Custo aceito: quem nunca clicar fica numa versão antiga. Como o
   `index.html` também está no precache, **depois da primeira visita quem manda
   na versão é esse aviso, não o `Cache-Control` do Nginx.**

4. **O precache exclui a família de PDF** (`html2pdf`, `pdf`, `jspdf`,
   `html2canvas`, `purify`, ~1,8 MB). Elas só entram quando alguém gera um
   documento, e aí há rede. Pelo mesmo motivo o limite por arquivo subiu para
   4 MiB: o chunk principal tem 3,6 MB e o padrão do workbox é 2 MiB — sem subir,
   o arquivo mais importante do app ficaria **fora** do precache, e o build
   avisaria isso numa linha fácil de não ver.

## Consequências

- O app abre rápido e instalado, e não finge funcionar sem rede.
- Nenhum dado de negócio fica guardado no aparelho — o que também é bom para a
  postura de segurança: celular perdido não carrega projeto de cliente.
- O precache (~4,3 MiB) é baixado na primeira visita. É o preço da abertura
  instantânea; reduzi-lo de verdade exige quebrar o chunk de 3,6 MB, que é
  débito técnico separado.
- Fica pendente, na VPS, uma regra de `no-cache` para `sw.js` e
  `manifest.webmanifest` no Nginx. O Chrome já ignora o cache HTTP do script do
  service worker, então nada quebra sem ela — mas é a rede de segurança para os
  outros navegadores.
