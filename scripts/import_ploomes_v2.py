"""Importa Negocios em aberto - ENRIQUECIDA.xlsx → Supabase local.

Versão 2 — planilha enriquecida do usuário com:
- Tamanho kWp → project_equipment.total_installed_power
- Valor a Pagar → project_financials.project_value
- Data de Pagamento (preenchida) → marca como paid
- Data Chegada → projects.created_at
- Projeto Concluído (preenchida) → força status='completed'

LIMPA tudo da importação anterior antes (DELETE em projects + companies de @import.local).
"""
import pandas as pd

EXCEL = '/Users/carloshenriqueborges/Downloads/Negocios em aberto - ENRIQUECIDA.xlsx'

STATUS_MAP = {
    'TROCA MEDIDOR':              'approved',
    'troca medidor':              'approved',
    'APROVADO':                   'approved',
    'PROJETO APROVADO':           'approved',
    'APROVADO - OBRA DE REDE':    'approved',
    'EM ANÁLISE':                 'analysis',
    'EM ANALISE':                 'analysis',
    'REVISAO':                    'analysis',
    'AGUARDANDO':                 'pending',
}

def esc(s):
    if s is None or (isinstance(s, float) and pd.isna(s)): return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"

def num(v):
    if v is None or pd.isna(v): return 'NULL'
    return str(float(v))

def dt(v):
    if v is None or pd.isna(v): return 'NULL'
    if hasattr(v, 'isoformat'):
        return "'" + v.isoformat() + "'"
    return esc(v)

def main():
    df = pd.read_excel(EXCEL, sheet_name='Ploomes')

    integradores = set()
    concessionarias = set()
    rows = []
    for _, r in df.iterrows():
        integ = str(r['Integrador (Proj.)']).strip() if pd.notna(r['Integrador (Proj.)']) else None
        conc = str(r['Concessionária (Proj.)']).strip() if pd.notna(r['Concessionária (Proj.)']) else None
        status_raw = str(r['Status Projeto (Proj.)']).strip() if pd.notna(r['Status Projeto (Proj.)']) else None
        status = STATUS_MAP.get(status_raw, 'pending') if status_raw else 'pending'
        # Projeto Concluído com data preenchida sobrescreve
        if pd.notna(r['Projeto Concluído']):
            status = 'completed'
        if integ: integradores.add(integ)
        if conc:  concessionarias.add(conc)
        rows.append({
            'cliente':    str(r['Cliente']).strip(),
            'integrador': integ,
            'concessionaria': conc,
            'status':     status,
            'kwp':        r['Tamanho do Projeto (kWp)'] if pd.notna(r['Tamanho do Projeto (kWp)']) else None,
            'valor':      r['Valor a Pagar (Proj.)']   if pd.notna(r['Valor a Pagar (Proj.)']) else None,
            'data_pagto': r['Data de Pagamento (Proj.)'] if pd.notna(r['Data de Pagamento (Proj.)']) else None,
            'data_chegada': r['Data Chegada do Projeto'] if pd.notna(r['Data Chegada do Projeto']) else None,
            'data_concluido': r['Projeto Concluído'] if pd.notna(r['Projeto Concluído']) else None,
        })

    print("-- ═══════════════════════════════════════")
    print("-- LIMPEZA: remover import anterior")
    print("-- ═══════════════════════════════════════")
    print("DELETE FROM public.project_history WHERE project_id IN (SELECT id FROM public.projects);")
    print("DELETE FROM public.project_financials WHERE project_id IN (SELECT id FROM public.projects);")
    print("DELETE FROM public.project_equipment WHERE project_id IN (SELECT id FROM public.projects);")
    print("DELETE FROM public.project_general_data WHERE project_id IN (SELECT id FROM public.projects);")
    print("DELETE FROM public.comments WHERE project_id IN (SELECT id FROM public.projects);")
    print("DELETE FROM public.documents WHERE project_id IN (SELECT id FROM public.projects);")
    print("DELETE FROM public.projects;")
    print("DELETE FROM public.companies WHERE contact_email LIKE '%@import.local';")
    print()

    print(f"-- {len(rows)} projetos, {len(integradores)} integradores, {len(concessionarias)} concessionárias")
    print()

    # ── Concessionárias ──────────────────────────────────────────────────────
    print("-- ═══ CONCESSIONÁRIAS ═══")
    for c in sorted(concessionarias):
        print(f"INSERT INTO public.energy_concessionaires (name, is_active) VALUES ({esc(c)}, true) ON CONFLICT (name) DO NOTHING;")
    print()

    # ── Companies ────────────────────────────────────────────────────────────
    print("-- ═══ COMPANIES (INTEGRADORES) ═══")
    for i, integ in enumerate(sorted(integradores)):
        slug = integ.lower().replace(' ', '-')
        cnpj = f"00.000.{(i+1):03d}/0001-{(i+1)*7 % 100:02d}"
        email = f"{slug[:40]}@import.local"
        print(f"INSERT INTO public.companies (name, cnpj, contact_name, contact_email, active) "
              f"VALUES ({esc(integ)}, {esc(cnpj)}, {esc(integ)}, {esc(email)}, true);")
    print()

    # ── Projects + relacionados ──────────────────────────────────────────────
    print("-- ═══ PROJECTS + RELACIONADOS ═══")
    print("DO $$")
    print("DECLARE")
    print("  v_admin_id    uuid := (SELECT id FROM auth.users WHERE email = 'teste@gmail.com' LIMIT 1);")
    print("  v_company_id  uuid;")
    print("  v_conc_id     uuid;")
    print("  v_project_id  uuid;")
    print("BEGIN")
    for r in rows:
        if not r['integrador']: continue
        title = r['cliente'][:200]
        # company lookup
        print(f"  v_company_id := (SELECT id FROM public.companies WHERE name = {esc(r['integrador'])} LIMIT 1);")
        if r['concessionaria']:
            print(f"  v_conc_id := (SELECT id FROM public.energy_concessionaires WHERE name = {esc(r['concessionaria'])} LIMIT 1);")
        else:
            print(f"  v_conc_id := NULL;")
        # insert project
        created_at = dt(r['data_chegada']) if r['data_chegada'] else 'NOW()'
        print(f"  INSERT INTO public.projects "
              f"(title, company_id, status, source, created_by, concessionaire_id, created_at, last_status_change)")
        print(f"    VALUES ({esc(title)}, v_company_id, {esc(r['status'])}::project_status, 'admin'::project_source, "
              f"v_admin_id, v_conc_id, {created_at}, {created_at})")
        print(f"    RETURNING id INTO v_project_id;")
        # general data
        print(f"  INSERT INTO public.project_general_data "
              f"(project_id, holder_name, holder_cpf_cnpj, address, city, state, uc_number, utility_company)")
        print(f"    VALUES (v_project_id, {esc(title)}, '—', '—', '—', 'SP', '—', {esc(r['concessionaria'] or '—')});")
        # equipment (só se tem kWp)
        if r['kwp']:
            kwp = float(r['kwp'])
            # estimativa de módulos: kWp / 0.55 (módulos de 550W)
            mod_est = max(1, int(round(kwp / 0.55)))
            print(f"  INSERT INTO public.project_equipment "
                  f"(project_id, inverter_model, module_quantity, total_installed_power)")
            print(f"    VALUES (v_project_id, '—', {mod_est}, {kwp});")
        # financial
        if r['valor']:
            valor = float(r['valor'])
            pago = valor if r['data_pagto'] else 0
            pay_status = 'paid' if r['data_pagto'] else 'pending'
            print(f"  INSERT INTO public.project_financials "
                  f"(project_id, project_value, paid_value, payment_status)")
            print(f"    VALUES (v_project_id, {valor}, {pago}, '{pay_status}'::payment_status);")
    print("END $$;")
    print()
    print("-- Resumo")
    print("SELECT 'concessionaires' AS t, count(*) FROM public.energy_concessionaires")
    print("UNION ALL SELECT 'companies (import)', count(*) FROM public.companies WHERE contact_email LIKE '%@import.local'")
    print("UNION ALL SELECT 'projects', count(*) FROM public.projects")
    print("UNION ALL SELECT 'with equipment', count(*) FROM public.project_equipment")
    print("UNION ALL SELECT 'with financials', count(*) FROM public.project_financials")
    print("UNION ALL SELECT 'paid', count(*) FROM public.project_financials WHERE payment_status = 'paid';")

if __name__ == '__main__':
    main()
