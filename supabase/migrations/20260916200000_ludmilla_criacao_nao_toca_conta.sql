-- Ludmilla: um run de criação de projeto (criar_projeto) que falha é um
-- problema do ROTEIRO do formulário, não da conta do portal. Antes, qualquer
-- run com erro gravava ultimo_erro na conta e o cartão da CPFL na /ludmilla
-- mostrava "Campo Nº da UC não ficou visível" como se a varredura tivesse
-- quebrado (16/09/2026). Agora criar_projeto só toca a conta quando o erro é
-- de login (p_situacao_conta = 'erro' | 'sessao_expirada').

CREATE OR REPLACE FUNCTION public.ludmilla_finalizar_run_impl(
  p_run_id UUID, p_situacao TEXT, p_erro TEXT, p_resultado JSONB, p_print_path TEXT,
  p_protocolos INTEGER, p_mudancas INTEGER, p_situacao_conta TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _account UUID; _tipo TEXT; _conta public.portal_accounts%ROWTYPE; _dest UUID; _login_falhou BOOLEAN;
BEGIN
  UPDATE public.portal_sync_runs
     SET situacao = p_situacao, terminado_em = now(), erro = p_erro, resultado = p_resultado,
         print_path = p_print_path, protocolos_lidos = p_protocolos, mudancas = p_mudancas
   WHERE id = p_run_id
   RETURNING account_id, tipo INTO _account, _tipo;
  IF _account IS NULL THEN RETURN; END IF;

  _login_falhou := p_situacao_conta IN ('erro', 'sessao_expirada');

  IF _tipo = 'criar_projeto' AND NOT _login_falhou THEN
    -- criação falhou por causa do formulário: a conta continua como estava
    SELECT * INTO _conta FROM public.portal_accounts WHERE id = _account;
  ELSE
    UPDATE public.portal_accounts
       SET situacao = coalesce(p_situacao_conta, situacao),
           ultimo_erro = CASE WHEN p_situacao = 'erro' THEN p_erro ELSE NULL END,
           ultima_varredura_em = CASE WHEN _tipo = 'varredura' AND p_situacao = 'ok' THEN now() ELSE ultima_varredura_em END
     WHERE id = _account
     RETURNING * INTO _conta;
  END IF;

  IF _tipo = 'varredura' AND p_situacao = 'ok' THEN
    PERFORM public.ludmilla_registrar_varredura(p_run_id);
  END IF;

  -- Estação local sem ninguém para o login: avisa os admins pelo sino.
  IF _conta.modo = 'local' AND p_situacao_conta = 'sessao_expirada' THEN
    FOR _dest IN SELECT p.id FROM public.profiles p WHERE p.tenant_id = _conta.tenant_id AND p.role = 'admin' LOOP
      INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
      VALUES (_conta.tenant_id, _dest, '📡 Ludmilla precisa de login na Elektro',
              coalesce(p_erro, 'A estação abriu o portal, mas ninguém digitou o CAPTCHA.') || ' Ela tenta de novo no próximo horário.',
              'ludmilla', NULL, FALSE);
    END LOOP;
  END IF;
END;
$$;

-- Limpa o resíduo: conta cujo ultimo_erro veio de um run de criação.
UPDATE public.portal_accounts a
   SET ultimo_erro = NULL
 WHERE a.ultimo_erro IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.portal_sync_runs r
      WHERE r.account_id = a.id AND r.tipo = 'criar_projeto' AND r.erro = a.ultimo_erro
   );
