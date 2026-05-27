"""Importa Negócios em aberto-2.xlsx → Supabase local.

Mapeia marcadores em (concessionária, integrador, status) e cria:
- energy_concessionaires (apenas as ausentes)
- companies (1 por integrador)
- projects + project_general_data
- vincula created_by ao admin teste@gmail.com

CPF/CNPJ/UC/endereço ficam como '—' pra preenchimento manual posterior.
"""
import pandas as pd
import sys

EXCEL = '/Users/carloshenriqueborges/Downloads/Negócios em aberto-2.xlsx'

CONCESSIONARIAS = {
    'CERRP', 'CPFL', 'EDP', 'ELEKTRO', 'ENERGISA MS', 'ENERGISA SP', 'EQUATORIAL - GO',
}
STATUS_LABELS = {
    'PREPARAÇÃO DE DOCS', 'EM ANÁLISE', 'COLETA DE ASSINATURAS',
    'PROJETO APROVADO', 'TROCA MEDIDOR', 'ART EMITIDA', 'REVISÃO DE PROJETO',
}
RUIDO = {'PROJETO 1', 'PROJETO 2'}

STATUS_MAP = {
    'PROJETO APROVADO':       'approved',
    'TROCA MEDIDOR':          'approved',
    'EM ANÁLISE':             'analysis',
    'REVISÃO DE PROJETO':     'analysis',
    'PREPARAÇÃO DE DOCS':     'documentation',
    'COLETA DE ASSINATURAS':  'documentation',
    'ART EMITIDA':            'documentation',
}

def esc(s):
    if s is None: return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"

def main():
    df = pd.read_excel(EXCEL, sheet_name='Ploomes')

    integradores = set()
    concessionarias = set()
    rows = []
    for _, r in df.iterrows():
        tags = [t.strip() for t in str(r['Marcadores']).split(';') if t.strip() and t.strip() not in RUIDO]
        integ = next((t for t in tags if t not in CONCESSIONARIAS and t not in STATUS_LABELS), None)
        conc = next((t for t in tags if t in CONCESSIONARIAS), None)
        status_label = next((t for t in tags if t in STATUS_LABELS), None)
        status = STATUS_MAP.get(status_label, 'completed') if status_label else 'completed'
        if integ:
            integradores.add(integ)
        if conc:
            concessionarias.add(conc)
        rows.append({
            'cliente': str(r['Cliente']).strip(),
            'titulo':  str(r['Título']).strip(),
            'integrador': integ,
            'concessionaria': conc,
            'status_label': status_label,
            'status': status,
            'dias_no_estagio': int(r['Dias no estágio']) if pd.notna(r['Dias no estágio']) else 0,
        })

    print(f"-- {len(rows)} projetos, {len(integradores)} integradores, {len(concessionarias)} concessionárias")
    print()

    # ── 1. Concessionárias ───────────────────────────────────────────────────
    print("-- ═══ CONCESSIONÁRIAS ═══")
    for c in sorted(concessionarias):
        print(f"INSERT INTO public.energy_concessionaires (name, is_active) VALUES ({esc(c)}, true) ON CONFLICT (name) DO NOTHING;")
    print()

    # ── 2. Companies (integradores) ──────────────────────────────────────────
    print("-- ═══ COMPANIES (INTEGRADORES) ═══")
    for i, integ in enumerate(sorted(integradores)):
        slug = integ.lower().replace(' ', '-').replace('ã', 'a').replace('õ', 'o').replace('í', 'i').replace('é', 'e')
        cnpj = f"00.000.{(i+1):03d}/0001-{(i+1)*7:02d}"
        email = f"{slug.replace('-','.')[:40]}@import.local"
        print(f"INSERT INTO public.companies (name, cnpj, contact_name, contact_email, active) VALUES ({esc(integ)}, {esc(cnpj)}, {esc(integ)}, {esc(email)}, true) ON CONFLICT (cnpj) DO NOTHING;")
    print()

    # ── 3. Projects + general_data ───────────────────────────────────────────
    print("-- ═══ PROJECTS ═══")
    print("DO $$")
    print("DECLARE")
    print("  v_admin_id    uuid := (SELECT id FROM auth.users WHERE email = 'teste@gmail.com' LIMIT 1);")
    print("  v_company_id  uuid;")
    print("  v_conc_id     uuid;")
    print("  v_project_id  uuid;")
    print("BEGIN")
    for r in rows:
        comp = r['integrador'] or 'SEM INTEGRADOR'
        if comp == 'SEM INTEGRADOR':
            continue  # skip os 2 órfãos
        conc_name = r['concessionaria']
        title = r['cliente'][:200]
        status = r['status']
        print(f"  v_company_id := (SELECT id FROM public.companies WHERE name = {esc(comp)} LIMIT 1);")
        if conc_name:
            print(f"  v_conc_id := (SELECT id FROM public.energy_concessionaires WHERE name = {esc(conc_name)} LIMIT 1);")
        else:
            print(f"  v_conc_id := NULL;")
        print(f"  INSERT INTO public.projects (title, company_id, status, source, created_by, concessionaire_id)")
        print(f"    VALUES ({esc(title)}, v_company_id, {esc(status)}::project_status, 'admin'::project_source, v_admin_id, v_conc_id)")
        print(f"    RETURNING id INTO v_project_id;")
        print(f"  INSERT INTO public.project_general_data (project_id, holder_name, holder_cpf_cnpj, address, city, state, uc_number, utility_company)")
        print(f"    VALUES (v_project_id, {esc(title)}, '—', '—', '—', 'SP', '—', {esc(conc_name or '—')});")
    print("END $$;")
    print()
    print("-- Resumo")
    print("SELECT 'concessionaires' AS table, count(*) FROM public.energy_concessionaires")
    print("UNION ALL SELECT 'companies', count(*) FROM public.companies")
    print("UNION ALL SELECT 'projects', count(*) FROM public.projects;")

if __name__ == '__main__':
    main()
