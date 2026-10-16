"""Descoberta das telas no aparelho da estação (roda na VPS, pelo workflow estacao-calibrar.yml).

Só uso normal dos apps: abre, toca, rola e lê o texto da tela (uiautomator). Não digita senha,
não grava dado de motorista. Salva tudo em capturas/calibracao-<data>/ para montar o telas.json:
  tela.json            modelo, Android, resolução, densidade
  <passo>.xml/.png/.txt  cada tela visitada (hierarquia, imagem, textos com posição)
  atm_lista.json       carregadores da busca vazia do ATM EVs (nome, km, público, endereço…)
  atm_fichas.json      plugues de cada carregador público até RAIO km (id, tipo, status) + o botão de fechar
  cury_locais.json     locais da lista "Locais de Recarga" da Cury e os carregadores de cada um

Uso: python3 calibrar.py [raio_km] [partes]     (padrão 15 e "atm,cury"; ex.: 15 cury)
"""
import datetime as dt, json, re, sys, time
from pathlib import Path
import coletor_tela as c

RAIO = float(sys.argv[1]) if len(sys.argv) > 1 else 15.0
PARTES = set((sys.argv[2] if len(sys.argv) > 2 else "atm,cury").replace(" ", "").split(","))
SAIDA = c.BASE / "capturas" / ("calibracao-" + dt.datetime.now().strftime("%Y%m%d-%H%M%S"))
SAIDA.mkdir(parents=True, exist_ok=True)
ATM, CURY = "br.com.atmoutsourcing.evscharger", "eco.spott.curyenergia"
RE_ATM = re.compile(r"^(.*?), ([0-9.]+) km, (.*), ([^,]+), ([^,]+)$")
RE_PLUG = re.compile(r"^(.*?), ID: (\d+), (.*)$")
RE_CURY = re.compile(r"^(.+?)\s*\nCarregadores:\s*\n(Local P[úu]blico|Local Privado)\n([\d.,]+) km - (.*)$", re.S)
RE_CARREG = re.compile(r"^(\d+ - \d+)\n(.*)$", re.S)
log = []


def nota(msg):
    linha = f"{dt.datetime.now():%H:%M:%S} {msg}"
    print(linha, flush=True)
    log.append(linha)


def capturar(nome):
    """xml + png + txt da tela atual."""
    xml = c.tela_xml()
    (SAIDA / f"{nome}.xml").write_text(xml, encoding="utf-8")
    try:
        (SAIDA / f"{nome}.png").write_bytes(c.adb("exec-out", "screencap", "-p", binario=True))
    except Exception as e:
        nota(f"  screencap falhou: {e}")
    itens = c.textos(xml)
    (SAIDA / f"{nome}.txt").write_text("\n".join(f"{t}\t{b}" for t, b in itens), encoding="utf-8")
    nota(f"  captura {nome}: {len(itens)} textos")
    return itens


def nos_clicaveis_sem_texto(xml):
    """Botões de ícone (sem texto): candidatos ao X da ficha, à seta de voltar etc."""
    import xml.etree.ElementTree as ET
    out = []
    try:
        for n in ET.fromstring(xml).iter("node"):
            if n.get("clickable") == "true" and not (n.get("text") or "").strip():
                out.append({"bounds": n.get("bounds"), "classe": n.get("class"), "desc": n.get("content-desc"),
                            "id": n.get("resource-id")})
    except ET.ParseError:
        pass
    return out


def esperar(texto, ate=20):
    fim = time.time() + ate
    while time.time() < fim:
        itens = c.textos(c.tela_xml())
        if any(texto.lower() in t.lower() for t, _ in itens):
            return itens
        time.sleep(1)
    raise RuntimeError(f"'{texto}' não apareceu em {ate} s")


def tocar_bounds(b):
    c.entrada("tap", *map(str, c.centro(b)))


def rolar(w, h, frac=0.45):
    c.entrada("swipe", str(w // 2), str(int(h * 0.78)), str(w // 2), str(int(h * (0.78 - frac))), "500")
    time.sleep(1.5)


def main():
    c.conectar_adb()
    info = c.adb("shell", "getprop ro.product.model; getprop ro.build.version.release; wm size; wm density")
    m = re.search(r"(\d+)x(\d+)", info.split("Override size")[-1] if "Override size" in info else info)
    w, h = (int(m.group(1)), int(m.group(2))) if m else (720, 1280)
    (SAIDA / "tela.json").write_text(json.dumps({"getprop_wm": info, "largura": w, "altura": h}, indent=1), encoding="utf-8")
    nota(f"aparelho: {info.strip()!r} -> {w}x{h}")
    if c.ANDROID == "vmos":
        try:
            import vmos; vmos.gps(); nota("GPS aplicado (Rio Preto)")
        except Exception as e:
            nota(f"GPS não aplicado: {e}")

    if "atm" in PARTES:
        descobrir_atm(w, h)
    if "cury" in PARTES:
        descobrir_cury(w, h)


def descobrir_atm(w, h):
    # ── ATM EVs ───────────────────────────────────────────────────────────────
    nota("ATM EVs: abrir")
    c.executar_passo({"tipo": "abrir", "pacote": ATM, "espera": 3})
    esperar("Pesquisar", 40); time.sleep(2)
    capturar("atm_01_mapa")
    c.executar_passo({"tipo": "tocar_texto", "texto": "Pesquisar", "espera": 2})
    c.executar_passo({"tipo": "digitar", "texto": " ", "espera": 6})
    capturar("atm_02_lista")
    lista, ordem = {}, []
    for rolagem in range(30):
        novos, longe = 0, False
        for t, b in c.textos(c.tela_xml()):
            mm = RE_ATM.match(t)
            if not mm:
                continue
            nome, km = mm.group(1), float(mm.group(2))
            if km > RAIO:
                longe = True
            if nome not in lista:
                lista[nome] = {"nome": nome, "km": km, "resto": mm.group(3)[:140], "publico": mm.group(4).strip(),
                               "situacao": mm.group(5).strip()}
                ordem.append(nome); novos += 1
        if longe or (novos == 0 and rolagem > 1):
            break
        rolar(w, h)
    (SAIDA / "atm_lista.json").write_text(json.dumps([lista[n] for n in ordem], ensure_ascii=False, indent=1), encoding="utf-8")
    nota(f"ATM: {len(ordem)} carregadores listados; até {RAIO} km: {sum(1 for n in ordem if lista[n]['km'] <= RAIO)}")
    if ordem and all(lista[n]["km"] == 0 for n in ordem[:5]):
        nota("ATENÇÃO: distâncias 0.00 km — o aparelho está sem posição (GPS)")

    # fichas: volta ao topo, toca cada público até RAIO e lê os plugues
    fichas, fechar = [], None
    alvo = [n for n in ordem if lista[n]["km"] <= RAIO and lista[n]["publico"].lower().startswith("p")]
    for i, nome in enumerate(alvo):
        for _ in range(8):   # topo
            c.entrada("swipe", str(w // 2), str(int(h * 0.3)), str(w // 2), str(int(h * 0.9)), "250")
        time.sleep(1)
        achou = False
        for _ in range(25):
            itens = c.textos(c.tela_xml())
            b = next((b for t, b in itens if t.strip() == nome.strip()), None)
            if b:
                tocar_bounds(b); achou = True; break
            rolar(w, h, 0.3)
        if not achou:
            nota(f"  {nome}: não achei na lista"); continue
        try:
            itens = esperar("Clique na tomada", 15); time.sleep(1)
        except RuntimeError as e:
            nota(f"  {nome}: ficha não abriu ({e})"); continue
        xml = c.tela_xml()
        if i < 2:
            capturar(f"atm_03_ficha_{i}")
            cand = nos_clicaveis_sem_texto(xml)
            (SAIDA / f"atm_03_ficha_{i}_botoes.json").write_text(json.dumps(cand, ensure_ascii=False, indent=1), encoding="utf-8")
        plugs = [{"tipo": mm.group(1), "id": mm.group(2), "status": mm.group(3)}
                 for t, _ in c.textos(xml) for mm in [RE_PLUG.match(t)] if mm]
        cards = [t for t, b in c.textos(xml) if re.search(r"(Motherboard|Eletroposto|PowerFlex|Tomadas|Wall ?Box|kW)", t, re.I)
                 and not RE_PLUG.match(t) and t != nome]
        fichas.append({"nome": nome, "km": lista[nome]["km"], "plugues": plugs, "cards": cards})
        nota(f"  {nome}: {[(p['id'], p['status']) for p in plugs]}")
        (SAIDA / "atm_fichas.json").write_text(json.dumps({"fechar_bounds": fechar, "fichas": fichas}, ensure_ascii=False, indent=1), encoding="utf-8")
        # fechar: o X é um botão sem texto no alto da ficha, à direita do título
        titulo = next((b for t, b in c.textos(xml) if t == nome), None)
        if fechar is None and titulo:
            ty = c.centro(titulo)[1]
            cands = [x for x in nos_clicaveis_sem_texto(xml) if x["bounds"]]
            cands = [x for x in cands if abs(c.centro(x["bounds"])[1] - ty) < h * 0.06 and c.centro(x["bounds"])[0] > w * 0.7]
            if cands:
                fechar = cands[0]["bounds"]
                nota(f"  botão de fechar da ficha: {fechar}")
        if fechar:
            tocar_bounds(fechar)
        else:
            c.entrada("keyevent", "4")
        time.sleep(1.5)
    (SAIDA / "atm_fichas.json").write_text(json.dumps({"fechar_bounds": fechar, "fichas": fichas}, ensure_ascii=False, indent=1), encoding="utf-8")


def descobrir_cury(w, h):
    # ── Cury ──────────────────────────────────────────────────────────────────
    nota("Cury: abrir")
    c.executar_passo({"tipo": "abrir", "pacote": CURY, "espera": 3})
    esperar("Lista", 40); time.sleep(2)
    capturar("cury_01_mapa")
    c.executar_passo({"tipo": "tocar_ate", "texto": "Lista", "aparecer": "Locais de Recarga", "fechar": ["Encerrar"],
                      "tentativas": 4, "ate": 8, "espera": 1})
    capturar("cury_02_lista")
    locais, ordem_c = {}, []
    for rolagem in range(12):
        novos = 0
        for t, b in c.textos(c.tela_xml()):
            mm = RE_CURY.match(t)
            if mm and mm.group(1).strip() not in locais:
                nome = mm.group(1).strip()
                locais[nome] = {"nome": nome, "publico": "blico" in mm.group(2), "km": mm.group(3), "endereco": mm.group(4)[:100],
                                "bounds": b, "carregadores": []}
                ordem_c.append(nome); novos += 1
        if novos == 0 and rolagem > 0:
            break
        rolar(w, h)
    nota(f"Cury: {len(ordem_c)} locais ({sum(1 for n in ordem_c if locais[n]['publico'])} públicos)")
    primeira = True
    for nome in [n for n in ordem_c if locais[n]["publico"]]:
        c.executar_passo({"tipo": "abrir", "pacote": CURY, "espera": 2})
        esperar("Lista", 40); time.sleep(1.5)
        c.executar_passo({"tipo": "tocar_ate", "texto": "Lista", "aparecer": "Locais de Recarga", "fechar": ["Encerrar"],
                          "tentativas": 4, "ate": 8, "espera": 1})
        achou = False
        for _ in range(10):
            b = next((b for t, b in c.textos(c.tela_xml()) for mm in [RE_CURY.match(t)] if mm and mm.group(1).strip() == nome), None)
            if b:
                x, y = c.centro(b); c.entrada("tap", str(x), str(min(y, int(h * 0.93)))); achou = True; break
            rolar(w, h, 0.3)
        if not achou:
            nota(f"  {nome}: não achei"); continue
        try:
            esperar("Escolha um carregador", 20); time.sleep(1)
        except RuntimeError as e:
            nota(f"  {nome}: ficha não abriu ({e})"); continue
        for t, b in c.textos(c.tela_xml()):
            if t.strip() == "Encerrar":
                tocar_bounds(b); time.sleep(1)
        if primeira:
            capturar("cury_03_ficha"); primeira = False
        for passada in range(2):
            for t, _ in c.textos(c.tela_xml()):
                mm = RE_CARREG.match(t)
                if mm and mm.group(1) not in [x["codigo"] for x in locais[nome]["carregadores"]]:
                    linhas = [l.strip() for l in mm.group(2).split("\n") if l.strip()]
                    kw = next((l for l in linhas if re.match(r"^[\d.,]+\s*kW$", l, re.I)), None)
                    st = linhas[linhas.index(kw) + 1] if kw and linhas.index(kw) + 1 < len(linhas) else None
                    locais[nome]["carregadores"].append({"codigo": mm.group(1), "kw": kw, "status": st, "linhas": linhas[:7]})
            rolar(w, h, 0.4)
        nota(f"  {nome}: {[(x['codigo'], x['kw'], x['status']) for x in locais[nome]['carregadores']]}")
        (SAIDA / "cury_locais.json").write_text(json.dumps([locais[n] for n in ordem_c], ensure_ascii=False, indent=1), encoding="utf-8")
    (SAIDA / "cury_locais.json").write_text(json.dumps([locais[n] for n in ordem_c], ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        nota(f"ERRO: {e!r}")
        try:
            capturar("erro_tela_final")
        except Exception:
            pass
        raise
    finally:
        (SAIDA / "log.txt").write_text("\n".join(log), encoding="utf-8")
        print("SAIDA=" + str(SAIDA))
