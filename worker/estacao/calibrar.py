"""Descoberta das telas no aparelho da estação (roda na VPS, pelo workflow estacao-calibrar.yml).

Só uso normal dos apps: abre, toca, rola e lê o texto da tela (uiautomator). Não digita senha,
não grava dado de motorista. Salva tudo em capturas/calibracao-<data>/ para montar o telas.json:
  tela.json            modelo, Android, resolução, densidade
  <passo>.xml/.png/.txt  cada tela visitada (hierarquia, imagem, textos com posição)
  atm_lista.json       carregadores da busca vazia do ATM EVs (nome, km, público, endereço…)
  atm_fichas.json      plugues de cada carregador público até RAIO km (id, tipo, status) + o botão de fechar
  cury_locais.json     locais da lista "Locais de Recarga" da Cury e os carregadores de cada um

Uso: python3 calibrar.py [raio_km] [partes]     (padrão 15 e "atm,cury"; ex.: 15 cury; 15 ensaio)
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

    if "memoria" in PARTES:   # só leitura: RAM, apps que mais ocupam, disco e o estado pela API do VMOS
        for titulo, cmd in [("meminfo", "grep -E 'MemTotal|MemFree|MemAvailable|Cached|SwapTotal|SwapFree' /proc/meminfo"),
                            ("uptime", "uptime"),
                            ("processos (PSS)", "dumpsys meminfo | sed -n '/Total PSS by process/,/Total PSS by OOM/p' | head -22"),
                            ("resumo", "dumpsys meminfo | grep -E 'Total RAM|Free RAM|Used RAM|Lost RAM|ZRAM'"),
                            ("disco", "df -h /data | tail -1")]:
            try:
                nota(f"── {titulo}\n" + c.adb("shell", cmd, timeout=60).strip())
            except Exception as e:
                nota(f"── {titulo}: {e}")
        if c.ANDROID == "vmos":
            try:
                import vmos
                est = vmos.estado()
                nota("── API VMOS: " + json.dumps({k: v for k, v in (est or {}).items()
                                                  if not re.search(r"key|token|secret|senha|pass", str(k), re.I)}, ensure_ascii=False)[:1500])
            except Exception as e:
                nota(f"── API VMOS: {e}")
    if "atm" in PARTES:
        descobrir_atm(w, h)
    if "cury" in PARTES:
        descobrir_cury(w, h)
    if "tupi_fichas" in PARTES:
        tupi_fichas(TUPI_ESTACOES, w, h)
    if "tupi_regiao" in PARTES:
        tupi_regiao(["Rio Preto", "Mirassol", "Bady"], w, h)
    if "tupi_busca" in PARTES:
        buscar_tupi(["BYD", "Monte Carlo", "Madero", "Jota", "Iguatemi"], w, h)   # sem acento: o input text do adb não aceita
    for parte in [p for p in PARTES if p.startswith("explorar:")]:
        explorar_app(parte.split(":", 1)[1], w, h)
    if "atm_busca" in PARTES:
        # como a busca da ATM se comporta neste aparelho (teclado com sugestão pode alterar o texto)
        c.executar_passo({"tipo": "abrir", "pacote": ATM, "espera": 3})
        esperar("Pesquisar", 40); time.sleep(2)
        c.executar_passo({"tipo": "tocar_texto", "texto": "Pesquisar", "espera": 4})
        capturar("busca_1_so_tocar")
        nota("  IME: " + c.adb("shell", "settings get secure default_input_method").strip())
        c.executar_passo({"tipo": "limpar_campo", "espera": 2})
        capturar("busca_2_limpo")
        c.entrada("keyevent", "62"); time.sleep(5)
        capturar("busca_3_espaco_tecla")
        c.executar_passo({"tipo": "limpar_campo", "espera": 2})
        c.executar_passo({"tipo": "digitar", "texto": " ", "espera": 5})
        capturar("busca_4_espaco_texto")
    so = next((p.split(":", 1)[1] for p in PARTES if p.startswith("ensaio:")), None)
    if "ensaio" in PARTES or so:
        nota(f"ENSAIO: {'só ' + so if so else 'ciclo completo'} com o telas.json, sem gravar (cada passo sai na hora)")
        c.DEPURAR = True          # imprime cada passo com o tempo: mantém a conexão viva e mostra o caminho
        c.DIR_FALHAS = SAIDA      # tela de cada falha e de cada leitura vazia vai para o artefato
        r = c.coletar(ensaio=True, so_fonte=so)
        nota(f"ENSAIO resumo: {r}")


PALAVRAS_LOGIN = ("senha", "password", "entrar com", "fazer login", "login", "cadastre-se", "criar conta", "e-mail")
CANDIDATOS = ("Lista", "Ver lista", "Listar", "Buscar", "Pesquisar", "Procurar", "Estações", "Pontos", "Carregadores",
              "Próximos", "Perto de mim", "Mapa")


# Avisos de primeiro uso: (texto que identifica o aviso, botão a tocar). Notificação = recusar;
# localização = só durante o uso (o app precisa dela para listar as estações próximas).
AVISOS = (("notificaç", ("Cancelar", "Agora não", "Não permitir")),
          ("localiza", ("Durante o uso do app", "Ao usar o app", "Permitir apenas durante o uso", "Permitir")),
          ("location", ("While using the app", "Allow")),
          ("cadastre-se para carregar", ("Agora não",)),     # Tupi: convite, não é login
          ("tutorial", ("Pular", "Fechar")),
          ("bem-vindo", ("Pular", "Fechar", "Começar")))


def passar_avisos(termo, rodadas=5):
    for k in range(rodadas):
        itens = c.textos(c.tela_xml())
        baixo = " ".join(t.lower() for t, _ in itens)
        tocou = False
        for chave, botoes in AVISOS:
            if chave in baixo:
                b = next((b for t, b in itens for bt in botoes if t.strip().lower() == bt.lower()), None)
                if b:
                    capturar(f"{termo}_00_aviso_{k}")
                    nota(f"  aviso '{chave}': tocando {[t for t, bb in itens if bb == b][:1]}")
                    tocar_bounds(b); time.sleep(3); tocou = True
                    break
        if not tocou:
            return


def buscar_tupi(termos, w, h):
    """Tupi: abre o app, passa os avisos, busca cada termo no campo do topo, captura os resultados,
    abre o 1º e captura a ficha (rolada também). Volta ao mapa entre um termo e outro."""
    pkg = "com.tupinamba"
    for n, termo in enumerate(termos):
        c.executar_passo({"tipo": "abrir", "pacote": pkg, "espera": 4})
        campo = None
        fim = time.time() + 30                     # os avisos chegam alguns segundos depois de abrir
        while time.time() < fim and not campo:
            passar_avisos("tupi")
            campo = next((b for t, b in c.textos(c.tela_xml()) if t.strip() in ("Pesquisar endereço", "Nome do local, estação ou endereço")), None)
            if campo:
                time.sleep(2); passar_avisos("tupi")   # o convite de cadastro pode surgir por cima do mapa
                campo = next((b for t, b in c.textos(c.tela_xml()) if t.strip() in ("Pesquisar endereço", "Nome do local, estação ou endereço")), None)
            else:
                time.sleep(2)
        if not campo:
            capturar(f"tupi_b{n}_sem_campo"); nota(f"  {termo}: campo de busca não achado"); continue
        tocar_bounds(campo); time.sleep(2)
        capturar(f"tupi_b{n}_1_campo")
        c.executar_passo({"tipo": "limpar_campo", "espera": 0.5})
        c.executar_passo({"tipo": "digitar", "texto": termo, "espera": 5})
        c.executar_passo({"tipo": "esconder_teclado", "espera": 1})
        itens = capturar(f"tupi_b{n}_2_resultados")
        # 1º resultado que contém o termo e não é o próprio campo
        res = next((b for t, b in itens if termo.lower() in t.lower() and not t.strip().lower() == termo.lower()), None)
        if not res:
            nota(f"  {termo}: nenhum resultado com o termo"); continue
        nota(f"  {termo}: tocando o 1º resultado {[t for t, b in itens if b == res][:1]}")
        tocar_bounds(res); time.sleep(6)
        passar_avisos("tupi")
        capturar(f"tupi_b{n}_3_ficha")
        (SAIDA / f"tupi_b{n}_3_ficha_botoes.json").write_text(
            json.dumps(nos_clicaveis_sem_texto(c.ULTIMO_XML), ensure_ascii=False, indent=1), encoding="utf-8")
        rolar(w, h, 0.35); capturar(f"tupi_b{n}_4_ficha_rolada")


RE_TUPI = re.compile(r"^(.*?), (Disponível|Ocupad[ao]|Indisponível|Offline|Off-line|Reservad[ao]|Em manutenção|Manutenção|Fora de serviço|Em uso|Carregando), (.*?), ([\d.,]+ ?kW)(?:, (.*))?$", re.S)
REGIAO_TUPI = ("rio preto", "mirassol", "bady bassit", "sjrp")


def abrir_busca_tupi(termo):
    """Abre a Tupi, passa os avisos, busca o termo e esconde o teclado. Devolve os itens da tela."""
    c.executar_passo({"tipo": "abrir", "pacote": "com.tupinamba", "espera": 4})
    campo, fim = None, time.time() + 30
    while time.time() < fim and not campo:
        passar_avisos("tupi")
        campo = next((b for t, b in c.textos(c.tela_xml()) if t.strip() in ("Pesquisar endereço", "Nome do local, estação ou endereço")), None)
        if campo:
            time.sleep(2); passar_avisos("tupi")
            campo = next((b for t, b in c.textos(c.tela_xml()) if t.strip() in ("Pesquisar endereço", "Nome do local, estação ou endereço")), None)
        else:
            time.sleep(2)
    if not campo:
        raise RuntimeError("campo de busca da Tupi não apareceu")
    tocar_bounds(campo); time.sleep(2)
    c.executar_passo({"tipo": "limpar_campo", "espera": 0.5})
    c.executar_passo({"tipo": "digitar", "texto": termo, "espera": 5})
    c.executar_passo({"tipo": "esconder_teclado", "espera": 1})
    return c.textos(c.tela_xml())


# Estações da Tupi na região (nomes iguais aos da API; termo de busca próprio, sem acento)
TUPI_ESTACOES = [
    ("Allma", "BYD | Allma Millazo - SJRP - 01"),
    ("Allma", "BYD | Allma Millazo - SJRP - 02"),
    ("Emporio Jota", "Charger Pro - Emporio Jota - SJRP"),
    ("Cia Charge", "Cia Charge | Madero Mirassol | Sao Jose do Rio Preto"),
    ("Interior Eventos", "HS/RM Recharge - Posto Monte Carlo Interior Eventos - Mirassol"),
    ("Alameda Iguatemi", "Bitcharge - Alameda Iguatemi 01"),
    ("Alameda Iguatemi", "Bitcharge - Alameda Iguatemi 02"),
]


def tupi_fichas(estacoes, w, h):
    """Abre a ficha de cada estação pelo termo próprio (o voltar leva ao mapa, com o campo de busca)."""
    out = []
    primeira = True
    for i, (termo, nome) in enumerate(estacoes):
        try:
            if primeira:
                abrir_busca_tupi(termo); primeira = False
            else:
                campo = next((b for t, b in c.textos(c.tela_xml()) if t.strip() in ("Pesquisar endereço", "Nome do local, estação ou endereço")
                              or t.strip().startswith(("Allma", "Emporio", "Cia Charge", "Interior", "Alameda"))), None)
                if not campo:
                    abrir_busca_tupi(termo)
                else:
                    tocar_bounds(campo); time.sleep(2)
                    c.executar_passo({"tipo": "limpar_campo", "espera": 0.5})
                    c.executar_passo({"tipo": "digitar", "texto": termo, "espera": 5})
                    c.executar_passo({"tipo": "esconder_teclado", "espera": 1})
        except RuntimeError as e:
            nota(f"  {nome}: {e}"); continue
        itens = c.textos(c.tela_xml())
        b = next((b for t, b in itens if t.strip().startswith(nome + ",")), None)
        if not b:
            capturar(f"tupi_f{i}_sem_resultado"); nota(f"  {nome}: não está nos resultados de '{termo}'"); continue
        tocar_bounds(b); time.sleep(5)
        itens = capturar(f"tupi_f{i}_ficha")
        tomadas = [t.strip() for t, _ in itens if re.match(r"^Tomada", t.strip())]
        nota(f"  {nome}: tomadas {tomadas}")
        out.append({"termo": termo, "nome": nome, "textos": [t for t, _ in itens if "Marcador" not in t][:60]})
        c.entrada("keyevent", "4"); time.sleep(2.5)
    (SAIDA / "tupi_fichas.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


def tupi_regiao(termos, w, h):
    """Lista as estações da região (busca por cidade), abre a ficha de cada uma e lê as tomadas."""
    estacoes, ordem = {}, []
    for termo in termos:
        try:
            abrir_busca_tupi(termo)
        except RuntimeError as e:
            nota(f"  {termo}: {e}"); continue
        capturar(f"tupi_r_{termo.replace(' ', '_')}_lista")
        for rolagem in range(12):
            novos = 0
            for t, b in c.textos(c.tela_xml()):
                m = RE_TUPI.match(t.strip())
                if not m or not any(r in m.group(3).lower() or r in m.group(1).lower() for r in REGIAO_TUPI):
                    continue
                nome = m.group(1).strip()
                if nome not in estacoes:
                    estacoes[nome] = {"nome": nome, "status": m.group(2), "endereco": m.group(3)[:140], "kw": m.group(4),
                                      "resto": (m.group(5) or "")[:80], "termo": termo, "tomadas": []}
                    ordem.append(nome); novos += 1
            if novos == 0 and rolagem > 1:
                break
            rolar(w, h, 0.4)
        nota(f"  {termo}: {len(ordem)} estações da região até agora")
    (SAIDA / "tupi_regiao.json").write_text(json.dumps([estacoes[n] for n in ordem], ensure_ascii=False, indent=1), encoding="utf-8")
    # fichas: busca de novo pelo termo de cada estação, toca nela e lê "Tomada N" + status
    for i, nome in enumerate(ordem):
        e = estacoes[nome]
        try:
            abrir_busca_tupi(e["termo"])
        except RuntimeError as er:
            nota(f"  {nome}: {er}"); continue
        achou = False
        for _ in range(12):
            itens = c.textos(c.tela_xml())
            b = next((b for t, b in itens if t.strip().startswith(nome + ",")), None)
            if b:
                tocar_bounds(b); achou = True; break
            rolar(w, h, 0.3)
        if not achou:
            nota(f"  {nome}: não achei na lista"); continue
        time.sleep(5)
        itens = c.textos(c.tela_xml())
        if i < 2:
            capturar(f"tupi_r_ficha_{i}")
        tomadas = []
        for k, (t, b) in enumerate(itens):
            mt = re.match(r"^Tomada (\d+)$", t.strip())
            if mt:
                st = next((tt for tt, _ in itens[k + 1:k + 4] if re.match(r"^(Dispon|Ocupad|Indispon|Offline|Off-line|Reservad|Em manuten|Manuten|Fora|Em uso|Carregando)", tt.strip())), None)
                pl = next((itens[j + 1][0] for j in range(k + 1, min(k + 8, len(itens) - 1)) if itens[j][0].strip() == "Plug:"), None)
                tomadas.append({"tomada": mt.group(1), "status": st, "plug": pl})
        # tomadas fora da tela (lista horizontal): rolar para a esquerda e ler de novo
        if tomadas:
            y = c.centro(next(b for t, b in itens if t.strip() == "Tomada 1"))[1]
            c.entrada("swipe", str(int(w * 0.85)), str(y), str(int(w * 0.15)), str(y), "400"); time.sleep(1.5)
            itens2 = c.textos(c.tela_xml())
            for k, (t, b) in enumerate(itens2):
                mt = re.match(r"^Tomada (\d+)$", t.strip())
                if mt and mt.group(1) not in [x["tomada"] for x in tomadas]:
                    st = next((tt for tt, _ in itens2[k + 1:k + 4] if re.match(r"^(Dispon|Ocupad|Indispon|Offline|Off-line|Reservad|Em manuten|Manuten|Fora|Em uso|Carregando)", tt.strip())), None)
                    tomadas.append({"tomada": mt.group(1), "status": st, "plug": None})
        e["tomadas"] = tomadas
        nota(f"  {nome}: {[(x['tomada'], x['status'], x['plug']) for x in tomadas]}")
        (SAIDA / "tupi_regiao.json").write_text(json.dumps([estacoes[n] for n in ordem], ensure_ascii=False, indent=1), encoding="utf-8")
        if i == 0:   # o "voltar" da ficha leva de volta à lista de resultados?
            c.entrada("keyevent", "4"); time.sleep(2.5)
            capturar("tupi_r_depois_do_voltar")


def explorar_app(termo, w, h):
    """Primeira visita a um app novo: acha o pacote pelo termo, abre, captura e toca nos botões que
    parecem levar à lista de carregadores (um de cada vez, capturando e voltando). Para em tela de login."""
    pacotes = [l.replace("package:", "").strip() for l in c.adb("shell", "pm list packages -3").splitlines()]
    nota(f"pacotes de terceiros: {pacotes}")
    alvo = [p for p in pacotes if termo.lower() in p.lower()]
    if not alvo:
        nota(f"nenhum pacote com '{termo}'"); return
    pkg = alvo[0]
    nota(f"{termo}: pacote {pkg}")
    c.executar_passo({"tipo": "abrir", "pacote": pkg, "espera": 12})
    passar_avisos(termo)
    itens = capturar(f"{termo}_01_inicio")
    (SAIDA / f"{termo}_01_inicio_botoes.json").write_text(
        json.dumps(nos_clicaveis_sem_texto(c.ULTIMO_XML), ensure_ascii=False, indent=1), encoding="utf-8")
    textos_baixos = " ".join(t.lower() for t, _ in itens)
    if any(p in textos_baixos for p in PALAVRAS_LOGIN) and not any(t.strip() in CANDIDATOS for t, _ in itens):
        nota(f"ATENÇÃO: {termo} parece pedir LOGIN — parar e pedir à pessoa"); return
    for i, alvo_txt in enumerate(CANDIDATOS):
        b = next((b for t, b in c.textos(c.tela_xml()) if t.strip().lower() == alvo_txt.lower()), None)
        if not b:
            continue
        nota(f"  tocando '{alvo_txt}'")
        tocar_bounds(b); time.sleep(5)
        itens2 = capturar(f"{termo}_02_{i:02d}_{alvo_txt.replace(' ', '_')}")
        (SAIDA / f"{termo}_02_{i:02d}_botoes.json").write_text(
            json.dumps(nos_clicaveis_sem_texto(c.ULTIMO_XML), ensure_ascii=False, indent=1), encoding="utf-8")
        if any(p in " ".join(t.lower() for t, _ in itens2) for p in PALAVRAS_LOGIN):
            nota(f"  ATENÇÃO: depois de '{alvo_txt}' apareceu LOGIN — parar")
            c.entrada("keyevent", "4"); time.sleep(2)
            continue
        rolar(w, h); capturar(f"{termo}_02_{i:02d}_rolado")
        c.entrada("keyevent", "4"); time.sleep(3)
    # toque no 1º marcador do mapa, se houver (fichas de estação costumam abrir assim)
    marcador = next((b for t, b in c.textos(c.tela_xml()) if "marker" in t.lower() or "marcador" in t.lower()), None)
    if marcador:
        nota("  tocando no 1º marcador do mapa")
        tocar_bounds(marcador); time.sleep(5)
        capturar(f"{termo}_03_marcador")


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
