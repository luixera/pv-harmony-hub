-- ============================================================================
-- CORREÇÃO: mapa de status da Elektro em caixa mista não casava (13/11/2026)
--
-- O casamento normaliza o status do portal com `ludmilla_normalizar_status()`
-- (MAIÚSCULAS, espaços colapsados) ANTES de procurar no `portal_status_map`
-- (comparação por texto exato). As 4 linhas da Elektro foram semeadas em caixa
-- mista ("Solicitação Concluída"), então NENHUM status casava: no 1º envio real
-- a lista trouxe 50 solicitações e 0 traduziram etapa (falha silenciosa).
--
-- Regrava as linhas da Elektro já na forma que o normalizador produz, usando o
-- PRÓPRIO normalizador — assim o mapa fica sempre idêntico ao que o casamento
-- calcula, mesmo que o normalizador mude. Idempotente e restrito à Elektro.
-- ============================================================================
UPDATE public.portal_status_map
   SET status_portal = public.ludmilla_normalizar_status(status_portal)
 WHERE connector = 'elektro'
   AND status_portal <> public.ludmilla_normalizar_status(status_portal);
