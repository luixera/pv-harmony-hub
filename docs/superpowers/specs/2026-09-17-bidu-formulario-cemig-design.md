# Bidu preenche o formulário da CEMIG

**Data:** 17/09/2026 · **Decisão do usuário:** botão no painel + pedido no chat; o Bidu propõe as 3 respostas e a pessoa confirma.

## Problema

O preenchimento do Formulário MicroGD existe (`gerarFormularioCemig`, 47
células, provado no PRJ-21470) mas só pela aba Documentos → Gerar documento,
com as 3 perguntas em branco e o arquivo indo para download. O Engenheiro
Bidu, que deveria ser o projetista, só conversa: ao pedir "preenche o
formulário da CEMIG" ele pergunta como se faz e nunca entrega.

## Desenho

1. **Ação do Bidu** (`BiduPanel` → botão "Preencher formulário da CEMIG",
   só quando a concessionária do projeto é CEMIG; e pelo chat, quando o
   `bidu-chat` devolve `acao: "preencher_formulario_cemig"`).
2. **Proposta das 3 respostas** (`proporRespostasCemig`, puro, testado):
   - o que a pessoa disse na conversa vence tudo;
   - depois as habilidades ensinadas (texto: "FAST TRACK = Sim até 10 kW",
     "Grid Zero sempre Não", "tipo de solicitação SEM alteração…");
   - depois o cadastro: categoria do padrão escolhida à mão → provável
     aumento de carga → "COM alteração de potência"; título/observações com
     "nova UC" → "Ligação de nova UC"; "ampliação"/"GD existente" → 3ª opção;
     senão "SEM alteração" (o mais comum). Grid Zero padrão Não. FAST TRACK
     sem habilidade → Não, com confiança baixa e o pedido de ensinar.
   Cada resposta vem com **motivo** e **confiança** (alta/média/baixa); a
   pessoa confirma ou ajusta num diálogo.
3. **Entrega**: gera o xlsx com o modelo da concessionária, **anexa nos
   documentos do projeto** (`extra_attachment`, bucket `project-documents`),
   registra comentário no card como Bidu (`bidu_anexar_documento`, SECURITY
   DEFINER, só equipe GD Manager), escreve no chat o que fez e os avisos
   (UTM fora do fuso, obrigatórios vazios) e oferece o download.
4. Faltando dado obrigatório: o diálogo mostra a lista antes de gerar.

## Fora do escopo

Planta de situação e posição dos módulos (entregáveis 2 e 3 do Bidu).

## Segurança

`bidu_anexar_documento` exige equipe (admin/staff) do tenant `is_library` e
projeto do mesmo tenant; `documents.uploaded_by` e `comments.user_id` = Bidu.
Bucket `project-documents` passa a aceitar xlsx/docx (os documentos gerados).
