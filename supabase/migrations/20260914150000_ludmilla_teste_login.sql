-- Ludmilla: run do tipo `teste_login`.
--
-- Entra no portal com a credencial cadastrada, PARA logo depois de enviar a
-- senha e conta o que viu: caiu em "Meus Projetos", pediu código por e-mail,
-- pediu código por SMS ou recusou a senha. É a descoberta do segundo fator
-- feita pelo próprio robô, na VPS, sem precisar da sessão do navegador do
-- usuário. Só leitura: não clica em mais nada.

ALTER TABLE public.portal_sync_runs DROP CONSTRAINT IF EXISTS portal_sync_runs_tipo_check;
ALTER TABLE public.portal_sync_runs
  ADD CONSTRAINT portal_sync_runs_tipo_check
  CHECK (tipo IN ('reconhecimento', 'teste_login', 'varredura'));

-- A conta lista os próprios runs recentes na tela de acesso: a equipe já lê
-- `portal_sync_runs` (política equipe_le_runs). Nada a mudar.

COMMENT ON COLUMN public.portal_sync_runs.tipo IS
  'reconhecimento = tela de login sem credencial · teste_login = entra e conta o que vê depois da senha · varredura = lê os protocolos';
