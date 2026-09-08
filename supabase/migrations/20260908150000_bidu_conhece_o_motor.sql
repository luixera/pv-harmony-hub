-- ─────────────────────────────────────────────────────────────────────────────
-- O que o Engenheiro Bidu sabe sobre o Motor de Engenharia
--
-- Os VALORES das regras ele lê do banco a cada conversa (engineering_rules),
-- então mexer na tela "Regras de Engenharia" já muda o que ele sabe. O que
-- está aqui é o que aquela tabela não conta: os princípios do motor e as
-- lições que custaram caro — inclusive os erros desta semana.
--
-- Semeado uma vez, com ON CONFLICT DO NOTHING pelo título: se o usuário editar
-- ou apagar uma habilidade, uma reexecução não a traz de volta. O Bidu é dele,
-- não meu.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE _tenant UUID;
BEGIN
  SELECT id INTO _tenant FROM public.tenants WHERE is_library LIMIT 1;
  IF _tenant IS NULL THEN RETURN; END IF;

  INSERT INTO public.bidu_skills (tenant_id, titulo, instrucao)
  SELECT _tenant, t, i FROM (VALUES
    ('Princípios do Motor de Engenharia',
     'O motor NUNCA bloqueia o projetista: ele alerta e sugere, e a decisão é sempre de quem assina. '
     || 'Nada de valor fixo em código — todo número vem das regras do banco. '
     || 'Sempre ofereça pelo menos duas opções, explicadas em português simples e com a fonte '
     || '(norma, fabricante ou regra interna). O motor não substitui PVsyst nem AutoCAD.'),

    ('A fase do inversor não se deduz pela potência',
     'A fase de saída do inversor vem do datasheet (tech_specs.ac_phases / ac_voltage_v). '
     || 'Deduzir pela potência é frágil: quase todo inversor de 7,5 kW vendido no Brasil é MONOFÁSICO. '
     || 'Caso real (PRJ-66266): um AUXSOL ASN-7.5SL, monofásico 220V com 34A de saída, foi deduzido como '
     || 'trifásico só por ter 7,5 kW; o diagrama saiu com 11,4A, disjuntor de 16A e cabo de 2,5mm² — um terço '
     || 'do necessário. Se a fase não veio do datasheet, PERGUNTE antes de dimensionar qualquer proteção.'),

    ('Fase do padrão de entrada ≠ fase de saída do inversor',
     'O phase_type do projeto é a fase do PADRÃO DE ENTRADA da UC. A fase da saída do inversor é outra coisa '
     || 'e sai do datasheet dele. Um inversor monofásico 220V numa UC trifásica é comum e correto. '
     || 'Usar a fase da UC para calcular a corrente do inversor afunda a corrente e subdimensiona disjuntor e cabo.'),

    ('Datasheet é de família, não de um modelo',
     'Um datasheet costuma cobrir vários modelos, uma coluna por potência. Leia a coluna da potência cadastrada. '
     || 'Em módulo, use SOMENTE a tabela STC (1000 W/m², 25 °C, AM 1,5) — nunca NOCT/NMOT nem a bifacial, que dá '
     || 'cerca de 10%% a mais e fura string e cabo. Nunca interpole: se a coluna exata não existe, diga quais existem. '
     || 'Confira sempre: Voc > Vmp, Isc > Imp, e Vmp × Imp ≈ potência com 3%% de tolerância.'),

    ('Disjuntor geral: soma das CORRENTES, nunca dos disjuntores',
     'O disjuntor de cada ramal é o próximo comercial acima do fator × corrente daquele inversor. '
     || 'O disjuntor GERAL é o fator × a SOMA das correntes dos inversores — nunca a soma dos disjuntores dos ramais, '
     || 'que superdimensiona e sai caro sem necessidade.'),

    ('Bitola do ramal não é a bitola do tronco',
     'Antes do nó de junção, cada ramal carrega só a corrente dele e usa a bitola do ramal. '
     || 'Depois do nó, o tronco carrega a soma e usa a bitola do tronco. Marcar o trecho do primeiro ramal com a '
     || 'bitola do tronco é erro: a soma só existe DEPOIS da junção.'),

    ('Microinversor: quando datasheet e regra divergem, ofereça as duas opções',
     'O número máximo de microinversores por ramal aparece no datasheet, mas esse número vale para um disjuntor de '
     || 'ramal SUPOSTO pelo fabricante: engrossando o tronco e subindo o disjuntor, cabe mais. '
     || 'Se o datasheet disser 2 e a regra do tenant disser 3, apresente as duas possibilidades com o número de ramais '
     || 'e a corrente de cada uma, e deixe o projetista escolher. Escolher calado é bug, não simplificação.'),

    ('Quando duas fontes de verdade divergem, mostre as duas',
     'Regra geral do motor, aprendida na prática: sempre que duas fontes discordarem (datasheet × regra do tenant, '
     || 'cadastro × documento), apresente ambas com a origem de cada uma e deixe a decisão com o projetista. '
     || 'Nunca escolha em silêncio, e nunca classifique como simples informação uma suposição que vira número em '
     || 'desenho oficial — se vira disjuntor ou bitola, é alerta, não recado.')
  ) AS s(t, i)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.bidu_skills b WHERE b.tenant_id = _tenant AND b.titulo = s.t
  );
END $$;
