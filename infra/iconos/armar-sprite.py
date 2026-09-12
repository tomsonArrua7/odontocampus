# -*- coding: utf-8 -*-
"""Arma el sprite de íconos de OdontoCampus.

Lo genérico sale de Lucide (licencia ISC, se autoaloja: no queda ninguna
dependencia de un CDN). Lo odontológico se dibuja acá, porque no existe en
ningún set: el diente y el espejo bucal.
"""
import io
import os
import re
import sys
import urllib.request

DESTINO = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "..", "public", "iconos-sprite.svg")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lucide")
BASE = "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/"

# id propio -> candidatos de nombre en Lucide (los nombres cambiaron entre
# versiones: circle-help/help-circle, triangle-alert/alert-triangle...)
MAPA = [
    ("buscar",        ["search"]),
    ("cerrar",        ["x"]),
    ("menu",          ["menu"]),
    ("ojo",           ["eye"]),
    ("ojo-tachado",   ["eye-off"]),
    ("calendario",    ["calendar-check"]),
    ("reloj",         ["clock"]),
    ("historial",     ["clock-arrow-down"]),
    ("certificado",   ["award"]),
    ("calculadora",   ["calculator"]),
    ("rotar",         ["refresh-cw"]),
    ("deshacer",      ["rotate-ccw"]),
    ("persona",       ["user"]),
    ("persona-mas",   ["user-plus"]),
    ("persona-ok",    ["user-check"]),
    ("imprimir",      ["printer"]),
    ("documento",     ["file-text"]),
    ("archivo",       ["archive"]),
    ("descargar",     ["download"]),
    ("subir",         ["cloud-upload", "upload-cloud"]),
    ("cargando",      ["loader-circle", "loader-2"]),
    ("info",          ["info"]),
    ("pregunta",      ["circle-question-mark"]),
    ("libro",         ["book-open"]),
    ("marcador",      ["bookmark"]),
    ("tacho",         ["trash"]),
    ("maletin",       ["briefcase-medical"]),
    ("etiqueta",      ["tag"]),
    ("escudo",        ["shield-check"]),
    ("avion",         ["send"]),
    ("candado",       ["lock"]),
    ("casa",          ["house", "home"]),
    ("birrete",       ["graduation-cap"]),
    ("megafono",      ["megaphone"]),
    ("video",         ["video"]),
    ("alerta",        ["triangle-alert", "alert-triangle"]),
    ("sol",           ["sun"]),
    ("luna",          ["moon"]),
    ("celular",       ["smartphone"]),
    ("pin",           ["map-pin"]),
    ("lista",         ["list-checks"]),
    ("idea",          ["lightbulb"]),
    ("llave",         ["key-round", "key"]),
    ("filtro",        ["funnel", "filter"]),
    ("sobre",         ["mail-open"]),
    ("monitor",       ["monitor"]),
    ("base-datos",    ["database"]),
    ("copiar",        ["copy"]),
    ("balanza",       ["scale"]),
    ("estrella",      ["star"]),
    ("tilde",         ["check"]),
    ("tilde-circulo", ["circle-check", "check-circle-2"]),
    ("diana",         ["target"]),
    ("columnas",      ["landmark"]),
    ("flecha-der",    ["arrow-right"]),
    ("flecha-izq",    ["arrow-left"]),
    ("entrar",        ["log-in"]),
    ("salir",         ["log-out"]),
    ("externo",       ["external-link"]),
    ("chat",          ["message-circle"]),
    ("herramientas",  ["wrench"]),
    ("enchufe",       ["unplug"]),
    ("lapiz",         ["pencil"]),
    ("wifi",          ["wifi"]),
]

# Dibujados a mano, en la misma retícula de 24 y con el mismo trazo.
PROPIOS = {
    # Molar: corona redondeada arriba y dos raíces. Mismo gesto que el favicon.
    "diente": '<path d="M6.4 8.6C6.4 5.2 8.9 3 12 3s5.6 2.2 5.6 5.6c0 1.9-.6 3-1 4.4-.5 1.9-.5 6.5-2.2 6.5-1.3 0-1.1-4.2-2.4-4.2s-1.1 4.2-2.4 4.2c-1.7 0-1.7-4.6-2.2-6.5-.4-1.4-1-2.5-1-4.4Z"/>',
    # NOTA: acá había un espejo bucal (cabezal redondo y mango en diagonal).
    # Se descartó: a 24 px era indistinguible de la lupa del buscador, y dos
    # íconos parecidos con significados distintos confunden más de lo que
    # aporta el guiño. Para instrumental se usa el maletín clínico.
    # Instagram: Lucide quitó los íconos de marcas, así que va dibujado con el
    # mismo trazo. Es el marco, el lente y el punto: lo mínimo reconocible.
    "instagram": '<rect width="18" height="18" x="3" y="3" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M16.9 7.1h.01"/>',
}

os.makedirs(CACHE, exist_ok=True)
informe = []
simbolos = []
faltan = []


def bajar(nombre):
    ruta = os.path.join(CACHE, nombre + ".svg")
    if os.path.exists(ruta):
        return io.open(ruta, encoding="utf-8").read()
    try:
        with urllib.request.urlopen(BASE + nombre + ".svg", timeout=20) as r:
            texto = r.read().decode("utf-8")
    except Exception:
        return None
    io.open(ruta, "w", encoding="utf-8", newline="").write(texto)
    return texto


def interior(svg):
    """Se queda con los trazos: saca la etiqueta raíz de Lucide."""
    cuerpo = re.sub(r"^.*?<svg[^>]*>", "", svg, flags=re.S)
    cuerpo = re.sub(r"</svg>\s*$", "", cuerpo, flags=re.S)
    return re.sub(r"\s+", " ", cuerpo).strip()


for ident, candidatos in MAPA:
    for nombre in candidatos:
        svg = bajar(nombre)
        if svg:
            simbolos.append((ident, interior(svg), nombre))
            break
    else:
        faltan.append((ident, candidatos))

for ident, cuerpo in PROPIOS.items():
    simbolos.append((ident, cuerpo, "propio"))

if faltan:
    for ident, candidatos in faltan:
        informe.append("FALTA %s (probé: %s)" % (ident, ", ".join(candidatos)))

cabecera = """<!--
  ODONTOCAMPUS · JUEGO DE ÍCONOS
  --------------------------------------------------------------------------
  Este archivo se pega dentro de index.html (ver el bloque <svg> oculto al
  principio del <body>). Está acá aparte para poder regenerarlo.

  Se usa así:   <svg class="ic" aria-hidden="true"><use href="#ic-buscar"></use></svg>

  Los íconos genéricos son de Lucide (https://lucide.dev), licencia ISC:
    Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
    part of Feather (MIT). All other copyright (c) for Lucide are held by
    Lucide Contributors 2022.
  Van autoalojados: no hay ninguna llamada a un CDN externo.

  El diente y el espejo bucal están dibujados para este proyecto, en la misma
  retícula de 24 y con el mismo trazo: ningún set general los tiene.

  El grosor, el color y el redondeo del trazo los pone la clase .ic en
  css/03-components.css. Acá no va ni color ni stroke-width.
-->
"""

partes = [cabecera, '<svg xmlns="http://www.w3.org/2000/svg" hidden aria-hidden="true">']
for ident, cuerpo, origen in sorted(simbolos):
    partes.append('  <symbol id="ic-%s" viewBox="0 0 24 24">%s</symbol>' % (ident, cuerpo))
partes.append("</svg>")
texto = "\n".join(partes) + "\n"

io.open(DESTINO, "w", encoding="utf-8", newline="").write(texto)

informe.append("OK    %d simbolos (%d de Lucide, %d propios), %d bytes"
               % (len(simbolos), len(simbolos) - len(PROPIOS), len(PROPIOS), len(texto)))

# El sitio no pide el sprite por separado: va embebido al principio de
# index.html, entre las dos marcas. Así no hay un pedido extra ni dudas de
# compatibilidad con las referencias externas de <use>.
INDICE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "index.html")
html = io.open(INDICE, encoding="utf-8").read()
inicio = html.find("<!-- ICONOS:")
fin = html.find("<!-- FIN ICONOS -->")
if inicio == -1 or fin == -1:
    informe.append("FALLO no se encontraron las marcas ICONOS en index.html")
else:
    nuevo = ('<!-- ICONOS: generado por infra/iconos/armar-sprite.py. No editar a mano. -->'
             + "\n" + texto.strip() + "\n")
    html = html[:inicio] + nuevo + html[fin:]
    io.open(INDICE, "w", encoding="utf-8", newline="").write(html)
    informe.append("OK    index.html actualizado con el sprite")
print("\n".join(informe))
sys.exit(1 if faltan else 0)
