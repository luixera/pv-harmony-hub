import json, sys
sys.stdout.reconfigure(encoding="utf-8")
ARQ = "config/telas.json"
d = json.load(open(ARQ, encoding="utf-8"))
STATUS = r"^(?!Plug:|Pot[êe]ncia:|Tomada \d|\(|CCS|Tipo \d|CHAdeMO|GB/?T|[\d.,]+ ?kW|R[áa]pida|Ultra|Lenta|Carga|Reserva|Ociosidade|R\$|Tra[çc]ar rota|Iniciar)(.{2,40})$"   # 1º texto depois da âncora que não é rótulo: status cru, mesmo palavra nova
AVISOS = [["notificaç", ["Cancelar", "Agora não", "Não permitir"]],
          ["cadastre-se para carregar", ["Agora não"]],
          ["localização", ["Durante o uso do app", "Ao usar o app", "Permitir"]]]
# (termo de busca sem acento, nome no app, stationID da API, lat, lng, kW, tomadas)
EST = [
    ("Millazo - SJRP", "BYD | Allma Millazo - SJRP - 01", "CPBYDEUNAR", -20.8205196518591, -49.3988387404146, 60.0, 2),
    ("Millazo - SJRP", "BYD | Allma Millazo - SJRP - 02", "CPBYDWNTMP", -20.8204027263737, -49.3988592528833, 7.4, 0),
    ("Emporio Jota", "Charger Pro - Emporio Jota - SJRP", "CPCHARGERPRO06", -20.8079986760353, -49.3477268741974, 60.0, 2),
    ("Madero Mirassol", "Cia Charge | Madero Mirassol | Sao Jose do Rio Preto", "CPCIACHARGE039", -20.8144994703726, -49.4579850220892, 60.0, 2),
    ("Interior Eventos", "HS/RM Recharge - Posto Monte Carlo Interior Eventos - Mirassol", "HSRMMC003", -20.8137920166141, -49.4817502925997, 60.0, 2),
    ("Alameda Iguatemi", "Bitcharge - Alameda Iguatemi 01", "0312209102324230968", -20.8676516751615, -49.4163917468126, 7.4, 0),
    ("Alameda Iguatemi", "Bitcharge - Alameda Iguatemi 02", "0312209102324230414", -20.8676516751615, -49.4163917468126, 7.4, 0),
    # 18/10/2026 — cidades novas, só rápidos. Sem stationID da API (bloqueada): código próprio, sem " - ".
    # Coordenadas do OpenStreetMap (Ramiru's: centro do bairro CECAP; Califórnia: trecho da avenida pelo CEP).
    ("Ramiru", "Bitcharge - Ramiru's Churrascaria", "BITCHARGE_RAMIRUS_FERNANDOPOLIS", -20.2709672, -50.2407655, 60.0, 2),
    ("Votuporanga", "AUTO POSTO CALIFÓRNIA", "AUTO_POSTO_CALIFORNIA_VOTUPORANGA", -20.4097029, -49.9701070, 40.0, 0),
]
abrir = {"nome": "abrir a Tupi (quente: volta ao mapa onde parou; frio só se o processo morreu)", "passos": [
    {"tipo": "abrir", "pacote": "com.tupinamba", "quente": True, "espera": 3},
    {"tipo": "passar_avisos", "avisos": AVISOS, "ate_texto": "Filtrar", "ate": 40, "folga": 3, "espera": 0.5}], "regras": []}
roteiros = [abrir]
ac = 0
for termo, nome, sid, lat, lng, kw, n in EST:
    pronto = "Tomada 1" if n else "Plug:"
    passos = [
        {"tipo": "passar_avisos", "avisos": AVISOS, "ate_texto": "Filtrar", "ate": 12, "folga": 0, "espera": 0.3},   # convite de cadastro chega atrasado e cobre a busca
        {"tipo": "toque", "x": 250, "y": 220, "espera": 1.5},          # campo de busca (topo, mesmo lugar no mapa e na ficha)
        {"tipo": "limpar_campo", "espera": 0.5},
        {"tipo": "digitar", "texto": termo, "espera": 3},
        {"tipo": "esconder_teclado", "espera": 1},
        {"tipo": "esperar_texto", "texto": "RESULTADO", "ate": 12, "espera": 0.5},
        {"tipo": "tocar_texto_rolando", "texto": nome + ",", "rolagens": 6, "espera": 0.5},
        {"tipo": "esperar_texto", "texto": pronto, "ate": 15, "espera": 1},
        {"tipo": "esperar_texto", "texto": nome, "ate": 4, "espera": 0, "conferir": True}]
    regras = []
    for k in range(1, max(n, 1) + 1):
        regras.append({"local_id": sid, "local_nome": nome, "conector": f"{sid} - {k}", "potencia_kw": kw,
                       "lat": lat, "lng": lng,
                       "ancora": (rf"^Tomada {k}$" if n else r"^Plug:$"), "regex": STATUS})
    r = {"nome": nome, "passos": passos, "regras": regras, "depois": [{"tipo": "voltar", "espera": 2}]}
    if kw <= 22:
        r["intervalo_min"] = 16; r["grupo"] = ac % 2; ac += 1
    roteiros.append(r)
alvo = {"fonte": "tupi_app", "app": "Tupi (com.tupinamba) — API bloqueada pelo Cloudflare, leitura pela tela",
        "passo_lista_px": 160, "roteiros": roteiros,
        "recuperar": [{"tipo": "abrir", "pacote": "com.tupinamba", "espera": 4},
                      {"tipo": "passar_avisos", "avisos": AVISOS, "ate_texto": "Pesquisar endereço", "ate": 40, "folga": 4, "espera": 1}]}
d["alvos"] = [a for a in d["alvos"] if a["fonte"] != "tupi_app"] + [alvo]
if "tupi_app" not in d["_sobre"]:
    d["_sobre"] += " Tupi (fonte tupi_app): sem lista fixa; cada local é buscado pelo campo do topo (toque em coordenada), a ficha mostra 'Tomada N' + status (Bitcharge: 'Plug:' + status); 'recuperar' reabre o app quando um local falha."
open(ARQ, "w", encoding="utf-8").write(json.dumps(d, ensure_ascii=False, indent=1) + "\n")
print(len(roteiros), "roteiros;", sum(len(r["regras"]) for r in roteiros), "regras")
d = json.load(open(ARQ, encoding="utf-8"))
d["limite_s"] = 780
d["_sobre"] = d["_sobre"].replace("limite_s: nenhum roteiro novo começa depois disso (600 s:", "limite_s: nenhum roteiro novo começa depois disso (780 s desde a Tupi pelo app, 17/10/2026: Cury + ATM + Tupi passam de 10 min;")
open(ARQ, "w", encoding="utf-8").write(json.dumps(d, ensure_ascii=False, indent=1) + "\n")
print("limite", d["limite_s"])
