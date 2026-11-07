# ADR 0012 — A Ludmilla manda e-mail para a concessionária só com clique de uma pessoa

**Status**: aceito · **Data**: out/2026 (ligado em produção em 06/11/2026)

## Contexto

Até out/2026 a Ludmilla só LIA: portal, caixa de e-mail e PDFs, e recomendava. Na ENEL, depois
da nota de serviço de troca do relógio, alguém precisa perguntar se a troca foi feita, e o
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
4. **E-mail para a ENEL nunca sai em dobro.** O banco "pega" a cobrança antes do SMTP. Recusa
   do servidor devolve à equipe com a razão curta. Queda no meio do envio, quando não dá para
   saber se saiu, vai para a conferência na pasta Enviados: achou, conta como enviada; conferiu
   e não achou, reenvia UMA vez o mesmo e-mail, porque a aprovação vale para ele; não deu para
   conferir, conta como possivelmente enviada e avisa a equipe.

## Consequências

- Uma dependência nova no worker: `nodemailer` 10.1.4, versão exata, com exceção do usuário à
  regra dos 14 dias porque a anterior tinha avisos de segurança no `addressparser`.
- O SMTP de saída da VPS precisa estar aberto; há um teste pelo workflow. Medido em 06/11/2026:
  a porta 465 responde, e o Gmail mantém o Message-ID que o robô põe.
- Pedir a troca do relógio (fase 2) continua fora: é outra escrita, a desenhar. Pedido do
  usuário em 06/11/2026, anotado no roadmap.
