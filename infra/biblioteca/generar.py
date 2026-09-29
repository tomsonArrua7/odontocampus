# -*- coding: utf-8 -*-
"""Arma la planilla modelo de la Biblioteca recorriendo el Drive de FOE.

La carpeta pública "Biblioteca virtual" tiene una subcarpeta por asignatura
(Anatomia, Cirugía, OPS...) y, adentro, subcarpetas por nivel (I, II, III),
por cátedra (A, B) y "Bibliografía Recomendada" con los libros.

Este script la recorre y escribe:
  docs/biblioteca-modelo.csv          la planilla para importar a Google Sheets
                                      y que la mantengan los militantes
  public/js/biblioteca-datos.js       la misma información, para que el sitio
                                      muestre la biblioteca mientras no haya
                                      planilla configurada en el panel

Uso:  python infra/biblioteca/generar.py

No baja ningún archivo: sólo lee los nombres (la vista pública de la
carpeta). A los libros de "Bibliografía Recomendada" se los enlaza a la
CARPETA, nunca al PDF.
"""
import csv
import html
import io
import json
import os
import re
import sys
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, "..", ".."))
SALIDA_CSV = os.path.join(RAIZ, "docs", "biblioteca-modelo.csv")
SALIDA_JS = os.path.join(RAIZ, "public", "js", "biblioteca-datos.js")

CARPETA_RAIZ = "1OiXCvHi_7cALIDY8KaUZHKc3qBRc76Fv"

# Carpeta del Drive -> nombre de la asignatura como está en el plan 7v16 (sin
# el número). Así el sitio la encuentra en "Anatomía I", "Anatomía II"...
ASIGNATURAS = {
    "anatomia": "Anatomía",
    "biofisica": "Biofísica",
    "biologia": "Biología General",
    "biomateriales dentales": "Biomateriales",
    "bioquimica": "Bioquímica Estomatológica",
    "bioetica": "Bioética",
    "cirugia": "Cirugía",
    "diagnostico por imagenes": "Diagnóstico por Imágenes",
    "dimension psicologica de la atencion odontologica": "Dimensión Psicológica de la Atención Odontológica",
    "endodoncia": "Endodoncia",
    "farmacologia y terapeutica": "Farmacología y Terapéutica",
    "fisiologia": "Fisiología",
    "histologia": "Histología y Embriología",
    "microbiologia": "Microbiología y Parasitología",
    "odontologia integral ninos": "Odontología Integral Niños",
    "odontologia legal y forense": "Odontología Legal y Forense",
    "operatoria dental": "Operatoria Dental",
    "ops": "Odontología Preventiva y Social",
    "patologia y clinica estomatologica": "Patología y Clínica Estomatológica",
    "periodoncia": "Periodoncia",
    "protesis": "Prótesis",
}
ROMANOS = ["", "I", "II", "III", "IV", "V", "VI"]


def normalizar(texto):
    t = texto.lower().strip()
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), ("ñ", "n")):
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t)


def listar(fid):
    pedido = urllib.request.Request("https://drive.google.com/embeddedfolderview?id=" + fid,
                                    headers={"User-Agent": "Mozilla/5.0"})
    # Drive a veces tarda: tres intentos antes de rendirse.
    for intento in range(3):
        try:
            d = urllib.request.urlopen(pedido, timeout=45).read().decode("utf-8", "replace")
            break
        except Exception:
            if intento == 2:
                raise
            time.sleep(3)
    time.sleep(0.3)
    salida = []
    for m in re.finditer(r'<a href="([^"]+)"[^>]*>.*?<div class="flip-entry-title">(.*?)</div>', d, re.S):
        url, nombre = m.group(1), html.unescape(m.group(2)).strip()
        es_carpeta = "/folders/" in url
        ident = re.search(r"/folders/([A-Za-z0-9_-]+)" if es_carpeta else r"/d/([A-Za-z0-9_-]+)", url)
        salida.append({"carpeta": es_carpeta, "nombre": nombre, "id": ident.group(1) if ident else ""})
    return salida


def carpeta(fid):
    return "https://drive.google.com/drive/folders/" + fid


def titulo_de_libro(nombre):
    """ "Foe-Netter Atlas de Anatomia Humana 7a Edicion.pdf" -> "Netter Atlas de Anatomia Humana 7a Edicion" """
    t = re.sub(r"\.(pdf|rar|zip|docx?|pptx?|epub)$", "", nombre, flags=re.I)
    t = re.sub(r"^\s*foe\s*[-_.]\s*", "", t, flags=re.I)
    t = re.sub(r"\s*[-_]\s*foe\s*$", "", t, flags=re.I)
    t = re.sub(r"\s*\(\d+\)\s*$", "", t)
    t = t.replace("_", " ")
    return re.sub(r"\s+", " ", t).strip(" -.")


def nivel(nombre):
    """ "II", "Materiales 2", "Fisiologia 1" -> 2. Otra cosa -> None. """
    n = nombre.strip().upper()
    if n in ROMANOS[1:]:
        return ROMANOS.index(n)
    m = re.search(r"(\d)\s*$", nombre)
    return int(m.group(1)) if m else None


filas = []  # Materia, Tipo, Título, Enlace, Autor o cátedra, Revisado


def fila(materia, tipo, titulo, enlace, autor=""):
    filas.append([materia, tipo, titulo, enlace, autor, "sí"])


raiz = listar(CARPETA_RAIZ)
for entrada in raiz:
    if not entrada["carpeta"]:
        continue
    asignatura = ASIGNATURAS.get(normalizar(entrada["nombre"]))
    if not asignatura:
        print("SIN ASIGNATURA:", entrada["nombre"])
        continue

    hijos = listar(entrada["id"])
    libros_sueltos = [h for h in hijos if not h["carpeta"]]

    for sub in [h for h in hijos if h["carpeta"]]:
        nombre = sub["nombre"].strip()
        contenido = listar(sub["id"])
        archivos = [c for c in contenido if not c["carpeta"]]
        cantidad = len(archivos) + len([c for c in contenido if c["carpeta"]])

        if normalizar(nombre).startswith("bibliografia"):
            for a in archivos:
                fila(asignatura, "Bibliografía", titulo_de_libro(a["nombre"]), carpeta(sub["id"]))
            continue
        if not cantidad:
            continue

        n = nivel(nombre)
        if n:
            fila(asignatura + " " + ROMANOS[n], "Apuntes", "Apuntes de " + asignatura + " " + ROMANOS[n],
                 carpeta(sub["id"]))
        elif re.fullmatch(r"(endo\s*)?[ab]", normalizar(nombre)):
            letra = nombre.strip()[-1].upper()
            fila(asignatura, "Cátedra", "Material de la cátedra " + letra, carpeta(sub["id"]), "Cátedra " + letra)
        else:
            limpio = re.sub(r"\s*\|.*$", "", nombre).strip(" -")
            fila(asignatura, "Material", limpio, carpeta(sub["id"]))

    # Archivos sueltos en la carpeta de la asignatura: en general son libros.
    for a in libros_sueltos:
        fila(asignatura, "Bibliografía", titulo_de_libro(a["nombre"]), carpeta(entrada["id"]))

    # La carpeta entera, por si alguien quiere recorrerla.
    fila(asignatura, "Carpeta", "Todo " + asignatura + " en la biblioteca virtual", carpeta(entrada["id"]))

# Lo que está en la raíz (diccionario, guía de historias clínicas)
for a in [r for r in raiz if not r["carpeta"]]:
    fila("General", "Bibliografía", titulo_de_libro(a["nombre"]), carpeta(CARPETA_RAIZ))

ENCABEZADO = ["Materia", "Tipo", "Título", "Enlace", "Autor o cátedra", "Revisado"]
with io.open(SALIDA_CSV, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(ENCABEZADO)
    w.writerows(filas)

datos = [dict(zip(["materia", "tipo", "titulo", "enlace", "autor"], r[:5])) for r in filas]
js = ("/* ==========================================================================\n"
      "   ODONTOCAMPUS — BIBLIOTECA (copia de respaldo)\n"
      "   GENERADO por infra/biblioteca/generar.py a partir del Drive de FOE.\n"
      "   No se edita a mano. El sitio usa esto sólo mientras no haya una planilla\n"
      "   de la biblioteca configurada en el panel de administración.\n"
      "   ========================================================================== */\n"
      "window.ODONTO_BIBLIOTECA = [\n" +
      ",\n".join("  " + json.dumps(d, ensure_ascii=False) for d in datos) + "\n];\n")
io.open(SALIDA_JS, "w", encoding="utf-8", newline="\n").write(js)

tipos = {}
for r in filas:
    tipos[r[1]] = tipos.get(r[1], 0) + 1
print("OK  %d filas: %s" % (len(filas), ", ".join("%s %d" % kv for kv in sorted(tipos.items()))))
print("OK  " + os.path.relpath(SALIDA_CSV, RAIZ))
print("OK  " + os.path.relpath(SALIDA_JS, RAIZ))
