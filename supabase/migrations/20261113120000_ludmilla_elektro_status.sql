-- ============================================================================
-- LUDMILLA — tradução dos status do Portal GD da Elektro (13/11/2026)
--
-- A extensão do Chrome lê a lista de solicitações na sessão da pessoa e manda
-- { protocolo, status, titular } para a API ludmilla-status. O trilho da
-- varredura (ludmilla_registrar_varredura) traduz o status do portal em etapa
-- do Kanban por ESTE mapa, comparando o texto EXATO:
--     m.status_portal = _status
-- Por isso as frases vão como o portal as mostra — com acentos e maiúsculas,
-- conferidas na tela pelo usuário em 13/11/2026.
--
-- Só o que é inequívoco entra. Os demais status do portal
-- ("Aguardando Documentação", "Ponto de Conexão Aprovado",
-- "Solicitação Cancelada") ficam DE PROPÓSITO sem tradução: aparecem na
-- /ludmilla como novidade, sem sugerir etapa, até alguém decidir o destino —
-- o mesmo critério da semeadura da CPFL (20260914200000).
--
-- Mapa por tenant da biblioteca (is_library), como as demais concessionárias.
-- Idempotente: ON CONFLICT não mexe no que a equipe já ajustou à mão.
-- ============================================================================

INSERT INTO public.portal_status_map (tenant_id, connector, status_portal, project_status)
SELECT t.id, 'elektro', m.status_portal, m.project_status
FROM public.tenants t
CROSS JOIN (VALUES
  ('Aguardando solicitação de vistoria e Conexão', 'approved'),
  ('Realizando vistoria e Conexão',                'vistoria_solicitada'),
  ('Em Análise Técnica',                           'analysis'),
  ('Solicitação Concluída',                        'completed')
) AS m(status_portal, project_status)
WHERE t.is_library
ON CONFLICT (tenant_id, connector, status_portal) DO NOTHING;
