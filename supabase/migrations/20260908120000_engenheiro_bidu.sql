-- ─────────────────────────────────────────────────────────────────────────────
-- Engenheiro Bidu — o projetista automático
--
-- Escopo combinado com o usuário (set/2026): o Bidu é DUAS coisas ao mesmo
-- tempo. Um projetista de verdade (usuário `staff`, a quem se atribui projeto,
-- que recebe tarefa com prazo e assina o que produz no histórico) E um painel
-- com chat dentro do projeto, onde ele recebe treinamento.
--
-- SEM SENHA de propósito: `encrypted_password` fica nulo e nenhum e-mail de
-- acesso é enviado, então ninguém entra como ele. É um funcionário que existe
-- para receber atribuição e assinar trabalho, não para logar.
--
-- Restrito ao tenant GD Manager (`is_library`), como o motor de diagramas.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  _bidu   UUID := '00000000-b1d0-4000-8000-000000000001';
  _tenant UUID;
BEGIN
  SELECT id INTO _tenant FROM public.tenants WHERE is_library LIMIT 1;
  IF _tenant IS NULL THEN
    RAISE NOTICE 'Sem tenant biblioteca — Bidu não criado.';
    RETURN;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (_bidu, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'bidu@gdmanager.local', now(),
          jsonb_build_object('provider', 'system', 'providers', ARRAY['system'],
                             'role', 'staff', 'tenant_id', _tenant),
          jsonb_build_object('name', 'Engenheiro Bidu'), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, email, role, tenant_id)
  VALUES (_bidu, 'Engenheiro Bidu', 'bidu@gdmanager.local', 'staff', _tenant)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tenant_id = EXCLUDED.tenant_id;
END $$;

-- ── Habilidades: o "treinamento" do Bidu ─────────────────────────────────────
-- Mesmo princípio do Motor de Engenharia: o conhecimento vive no BANCO, nunca
-- fixo em código. O que o usuário ensina pelo chat vira linha aqui.
CREATE TABLE IF NOT EXISTS public.bidu_skills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  instrucao   TEXT NOT NULL,
  -- Concessionária a que a habilidade se aplica; nulo = vale para todas.
  concessionaire_id UUID REFERENCES public.energy_concessionaires(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Conversa com o Bidu ──────────────────────────────────────────────────────
-- Por projeto quando a conversa é sobre um projeto, e geral (project_id nulo)
-- quando é treinamento solto.
CREATE TABLE IF NOT EXISTS public.bidu_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  -- 'user' = quem escreveu; 'bidu' = a resposta dele.
  autor       TEXT NOT NULL CHECK (autor IN ('user', 'bidu')),
  conteudo    TEXT NOT NULL,
  -- Quando a mensagem virou habilidade, aponta para ela.
  skill_id    UUID REFERENCES public.bidu_skills(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bidu_messages_projeto
  ON public.bidu_messages (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bidu_skills_tenant
  ON public.bidu_skills (tenant_id) WHERE enabled;

ALTER TABLE public.bidu_skills   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bidu_messages ENABLE ROW LEVEL SECURITY;

-- Isolamento de tenant (RESTRICTIVE: vale junto com qualquer outra política).
DROP POLICY IF EXISTS tenant_isolation ON public.bidu_skills;
CREATE POLICY tenant_isolation ON public.bidu_skills AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS tenant_isolation ON public.bidu_messages;
CREATE POLICY tenant_isolation ON public.bidu_messages AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Quem trabalha nos projetos conversa e treina: admin e projetista.
DROP POLICY IF EXISTS equipe_usa_bidu ON public.bidu_skills;
CREATE POLICY equipe_usa_bidu ON public.bidu_skills FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','staff')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','staff')));

DROP POLICY IF EXISTS equipe_conversa_bidu ON public.bidu_messages;
CREATE POLICY equipe_conversa_bidu ON public.bidu_messages FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','staff')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','staff')));

DROP TRIGGER IF EXISTS update_bidu_skills_updated_at ON public.bidu_skills;
CREATE TRIGGER update_bidu_skills_updated_at
  BEFORE UPDATE ON public.bidu_skills
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.bidu_skills IS
  'Treinamento do Engenheiro Bidu: o que ele sabe fazer. Nada fixo em código.';
