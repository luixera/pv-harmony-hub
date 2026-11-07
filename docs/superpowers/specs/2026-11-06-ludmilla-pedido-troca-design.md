# Ludmilla — pedir à ENEL a troca do relógio (fase 2 da ENEL por e-mail)

Data: 06/11/2026. Desenho aprovado pelo usuário no chat. Continua a
[spec da ENEL por e-mail](2026-10-13-ludmilla-enel-email-design.md) §13 e reaproveita o envio da
[cobrança](2026-10-24-ludmilla-enel-cobranca-troca-design.md).

## 1. O que o usuário pediu

> "assim que a vistoria for aprovada, liberar para pedir a troca do relógio (caso ainda não tenha sido feita)"

Hoje o A fazer "pedir a troca do relógio" só lembra, e alguém escreve o e-mail à mão no Gmail.

## 2. Decisões

| Pergunta | Resposta |
|---|---|
| O clique envia direto? | **Não.** O A fazer mostra o e-mail pronto, editável; Enviar tem 8 s para desfazer |
| Quem pode enviar? | Só uma pessoa da equipe, como na cobrança |
| Comentário no card | Comum, visível para a empresa, como na cobrança |
| Reaproveitar a tabela da cobrança? | **Não.** Tabela e funções próprias: a cobrança ainda não fez o primeiro envio real |
| Fora desta entrega | Reabrir troca que falhou, anexos, fechar sozinho os A fazer velhos, botão no modal do projeto |

## 3. O e-mail

Modelo tirado dos pedidos reais da equipe, conferido nos assuntos das respostas da ENEL em 06/11/2026.

- **Para:** `canalgd.sp@br.enel.com`, fixo.
- **Assunto:** `TROCA DE RELÓGIO - <TITULAR EM MAIÚSCULAS> - NT <9 dígitos>`, fixo, montado no banco.
- **Texto, editável:**

```
Bom dia caro analista, a NT <n> passou pela etapa de vistoria, por gentileza seguir para a troca de relógio.

Atenciosamente,
Equipe GD Manager
```

"Bom dia" vira "Boa tarde" a partir do meio-dia, na tela e de novo na hora do envio, se ninguém mexeu nessa abertura.
É um e-mail novo, sem `In-Reply-To` e sem `RE:`.

## 4. Quando libera

Só no A fazer `vistoria_aprovada` aberto, com projeto. A data da aprovação é a da mensagem ligada ao A fazer.

| Situação | Tela |
|---|---|
| Nenhum sinal de pedido depois da aprovação, com NT e titular | **e-mail editável + Enviar** |
| Há sinal de pedido depois da aprovação | sem Enviar; "a ENEL já respondeu sobre a troca em DD/MM" |
| Pedido deste A fazer saindo, enviado ou sem confirmação | sem Enviar; diz a situação |
| O envio anterior falhou | e-mail com o texto da tentativa e o motivo da falha |
| Falta NT ou titular | sem Enviar; diz o que falta |
| Projeto concluído/arquivado, conta desligada | sem Enviar; diz o motivo |

"Marcar como feito" continua disponível em todos os casos, para o pedido feito por fora.

**Sinal de pedido:** mensagem da conta da ENEL com `recebido_em` depois da aprovação, do tipo
`troca_relogio`, ou `resposta_automatica` com "troca" no assunto, ligada ao projeto **ou com a NT no assunto**.
E-mail devolvido (`devolucao`) não conta: pedido que voltou não foi feito.

**A NT**, nesta ordem: protocolo do cadastro com 9 dígitos (sem zeros à esquerda); Carta pendente de
aplicar; número depois do token NT no assunto de e-mail ligado ao projeto. Vale só se houver UMA candidata e ela não
for de outro projeto. A função que o robô usa (`ludmilla_email_nts_conhecidas`) só responde a `service_role`, e não é
alterada.

## 5. O fluxo

1. **Enviar** passa pela fila do Desfazer e chama `ludmilla_pedido_troca_enviar(afazer, texto)`. Ela reavalia tudo sob
   trava do A fazer, grava o pedido, cria o run `enviar_pedido_troca` e fecha o A fazer em nome de quem clicou.
2. O robô pega o run, inicia o envio no banco, confere as travas de novo e manda por SMTP, reaproveitando `enviar.ts`:
   mesma conta, mesma conferência na pasta Enviados, mesmo Message-ID no único reenvio.
3. **Saiu:** pedido `enviado`, comentário no card e histórico com quem aprovou. Se a ENEL abrir a nota, a cobrança
   nasce sozinha pelo caminho que já existe.
4. **Nada saiu:** pedido `falhou`, o A fazer reabre com o motivo e o texto da tentativa. Nunca reenvia sozinha.
5. **Não deu para saber:** pedido `sem_confirmacao`, A fazer `aviso` para conferir no Gmail, sem botão Enviar.

## 6. As travas

No banco e de novo no robô: destinatário `@enel.com`/`@br.enel.com`; aprovação de pessoa ativa da equipe, do mesmo
tenant; texto presente. Só no banco: um pedido por A fazer (`UNIQUE`), reavaliação da regra, projeto ativo, conta
ligada, texto de 20 a 5000 caracteres, sem lacuna e citando a NT. Só no robô, de forma independente: o assunto tem de
ter a forma do modelo e o texto tem de citar a NT do assunto.

Envio preso: o cron `ludmilla-pedidos-troca` (seg–sex, :10, das 8h às 18h) trata `enviando` há mais de 30 min como sem
confirmação, e o pedido que nem chegou a sair há mais de 2 h como falha com "nada saiu".

## 7. O que não muda

Nenhuma função da cobrança, nem `ludmilla_agendar_email`, nem `ludmilla_claim_run`, nem a leitura. `ludmilla_registro`
ganha só o rótulo do run novo, a partir do `prosrc` vivo, com o md5 conferido.

## 8. Riscos

- **E-mail errado para a ENEL:** clique humano, destinatário fixo, assunto do banco e texto à vista.
- **Pedido em dobro:** a regra da §4, o `UNIQUE` e a trava do A fazer. Resta o pedido feito por fora nos minutos antes
  da resposta automática chegar: a leitura só enxerga o que vem da ENEL.
- **Sinal falso:** "troca" no assunto por outro motivo esconderia o Enviar. O erro é para o lado seguro: o pedido sai pelo
  Gmail, e a tela diz por quê.
- **Aprovação sem projeto:** não libera nada; o A fazer continua como lembrete.
