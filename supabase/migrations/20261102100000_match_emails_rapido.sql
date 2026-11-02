-- ============================================================================
-- CLAUDINHO DOS E-MAILS: o casamento voltou a caber no tempo (02/11/2026)
--
-- O que estava acontecendo (logs da função scan-emails, 11h e 20h de todo dia):
--   "Erro no matching SQL: canceling statement due to statement timeout"
--   "Matching: 0 vinculados, 0 com IA"
-- A varredura "concluía", mas o casamento morria por tempo — e por isso NENHUM
-- e-mail era vinculado nem analisado desde 28/07/2026 (último casamento que
-- deu certo). Em 02/11 havia 1.070 e-mails soltos, 201 citando protocolo de
-- projeto existente, e o modal prometia "o vínculo acontece na próxima
-- varredura" — que nunca vinha.
--
-- Por quê: `match_emails_to_protocols` cruzava TODOS os e-mails soltos com
-- TODOS os projetos (1.070 × 277 pares) e, em CADA par, recalculava
-- `txt_norm(assunto || corpo)` (corpo de até 5.000 caracteres) e avaliava
-- três regex. Trabalho proporcional a e-mails × projetos × tamanho do corpo.
--
-- A correção é só de custo — o CONTRATO é o mesmo (assinatura, colunas de
-- retorno, as três portas na mesma prioridade, o UPDATE e o RETURNING que o
-- scan-emails consome, o isolamento por tenant):
--   1. o texto normalizado de cada e-mail é calculado UMA vez (CTE
--      materializada), e o protocolo/UC/regex de cada projeto também;
--   2. a regex (UC inteira, titular) só roda nos pares em que o número ou o
--      primeiro nome já aparece por `position()` — barato — e o LIKE do
--      protocolo virou `position()` sobre o texto pronto;
--   3. o par só é tentado quando as concessionárias batem (um e-mail da CPFL
--      não é de projeto da ENEL) — quando o e-mail ou o projeto não têm a
--      concessionária, tenta como antes;
--   4. a porta do TITULAR (a mais cara e a mais fraca) só roda em e-mails dos
--      últimos 120 dias: ela existe para o e-mail que chega antes do
--      protocolo, e isso é coisa de semanas, não de meses.
-- Medido em 02/11 com o backlog inteiro (1.070 soltos): a 1ª versão (só 1 e 2)
-- casou 503 em 8,6 s; com 3 e 4 ficou abaixo do limite — ver prova no commit.
-- Copiado do prosrc vivo (pg_get_functiondef em 02/11/2026), não do arquivo
-- de migração — regra da casa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_emails_to_protocols(_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(email_update_id uuid, subject text, email_body text, protocol_number text, project_id uuid, conc_id uuid, conc_name text, match_by text, matched_value text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with emails as materialized (
    -- normalizado UMA vez por e-mail (antes era uma vez por par)
    select eu.id, eu.subject, eu.email_body, eu.tenant_id, eu.concessionaire_id,
           -- a porta do titular só vale para e-mail recente (ver cabeçalho, item 4)
           (eu.received_at is null or eu.received_at > now() - interval '120 days') as recente,
           public.txt_norm(coalesce(eu.subject, '') || ' ' || coalesce(eu.email_body, '')) as texto
    from email_updates eu
    where eu.project_id is null
      and (_tenant_id is null or eu.tenant_id = _tenant_id)
  ),
  projs as materialized (
    -- normalizado UMA vez por projeto
    select p.id, p.tenant_id, p.protocol_number, p.concessionaire_id, c.name as conc_name,
           g.uc_number, g.holder_name,
           case when p.protocol_number is not null
                 and p.protocol_number not ilike '%sem protocolo%'
                 and length(trim(p.protocol_number)) >= 4
                then public.txt_norm(p.protocol_number) end                       as proto_norm,
           case when g.uc_number is not null
                 and length(regexp_replace(g.uc_number, '\D', '', 'g')) >= 5
                then trim(g.uc_number) end                                        as uc,
           public.holder_name_regex(g.holder_name)                                 as holder_re,
           split_part(regexp_replace(trim(public.txt_norm(g.holder_name)), '\s+', ' ', 'g'), ' ', 1) as primeiro_nome
    from projects p
    left join energy_concessionaires c on c.id = p.concessionaire_id
    left join project_general_data g on g.project_id = p.id
    where p.is_deleted = false
  ),
  candidatos as (
    select distinct on (e.id)
      e.id                 as email_update_id,
      e.subject,
      e.email_body,
      pr.protocol_number,
      pr.id                as project_id,
      pr.concessionaire_id as conc_id,
      pr.conc_name,
      m.match_by,
      m.matched_value,
      m.prioridade
    from emails e
    -- ISOLAMENTO: e-mail e projeto precisam ser do MESMO tenant; e, quando os
    -- dois têm concessionária, ela tem de ser a mesma (item 3 do cabeçalho)
    join projs pr on pr.tenant_id is not distinct from e.tenant_id
                 and (e.concessionaire_id is null or pr.concessionaire_id is null
                      or e.concessionaire_id = pr.concessionaire_id)
    cross join lateral (
      select * from (values
        -- 1) PROTOCOLO — o mais forte
        ('protocol', pr.protocol_number, 1,
         pr.proto_norm is not null and position(pr.proto_norm in e.texto) > 0),
        -- 2) UNIDADE CONSUMIDORA — número próprio, casado inteiro; regex só onde o número já aparece
        ('uc', pr.uc, 2,
         pr.uc is not null
           and position(pr.uc in e.texto) > 0
           and e.texto ~ ('\m' || regexp_replace(pr.uc, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M')),
        -- 3) TITULAR — primeiro + último sobrenome; regex só onde o primeiro nome já aparece
        ('holder', pr.holder_name, 3,
         e.recente
           and pr.holder_re is not null
           and length(pr.primeiro_nome) >= 3
           and position(pr.primeiro_nome in e.texto) > 0
           and e.texto ~ pr.holder_re)
      ) as t(match_by, matched_value, prioridade, bateu)
      where t.bateu
    ) m
    order by e.id, m.prioridade
  ),
  updated as (
    update email_updates eu
    set
      project_id          = k.project_id,
      -- só o protocolo preenche o campo de protocolo; UC/titular deixam nulo
      protocol_number     = case when k.match_by = 'protocol' then k.protocol_number else eu.protocol_number end,
      protocol_matched    = (k.match_by = 'protocol'),
      match_type          = k.match_by,
      concessionaire_id   = coalesce(eu.concessionaire_id, k.conc_id),
      concessionaire_name = coalesce(eu.concessionaire_name, k.conc_name)
    from candidatos k
    where eu.id = k.email_update_id
    returning eu.id, k.subject, k.email_body, k.protocol_number, k.project_id,
              k.conc_id, k.conc_name, k.match_by, k.matched_value
  )
  select u.id, u.subject, u.email_body, u.protocol_number, u.project_id,
         u.conc_id, u.conc_name, u.match_by, u.matched_value
  from updated u;
end;
$function$;
