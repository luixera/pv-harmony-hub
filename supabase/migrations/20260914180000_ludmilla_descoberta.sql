-- Ludmilla: run do tipo `descoberta`.
--
-- Entra no portal, navega até a lista de projetos e guarda o HTML das telas
-- (sem scripts) no bucket, ao lado do print. É como o roteiro de leitura
-- (`varrer`) é escrito: sobre a página real, não sobre um print.

ALTER TABLE public.portal_sync_runs DROP CONSTRAINT IF EXISTS portal_sync_runs_tipo_check;
ALTER TABLE public.portal_sync_runs
  ADD CONSTRAINT portal_sync_runs_tipo_check
  CHECK (tipo IN ('reconhecimento', 'teste_login', 'descoberta', 'varredura'));

COMMENT ON COLUMN public.portal_sync_runs.tipo IS
  'reconhecimento = tela de login sem credencial · teste_login = entra e conta o que vê depois da senha · descoberta = entra, navega até a lista e guarda o HTML · varredura = lê os protocolos';
