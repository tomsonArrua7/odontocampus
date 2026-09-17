# -*- coding: utf-8 -*-
"""Genera los planes de estudio para el sitio y para la base.

Fuente única: los .json de esta carpeta, uno por plan.
Salidas (no se editan a mano):
  public/js/planes.js                    lo que usa Mi carrera en el navegador
  infra/supabase/sql/datos_planes.sql    lo mismo, para cargarlo en la base

Uso:  python infra/planes/generar.py
Después de cambiar un plan: subir el ?v= de planes.js en index.html y correr
datos_planes.sql en el servidor.
"""
import glob
import io
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, "..", ".."))
SALIDA_JS = os.path.join(RAIZ, "public", "js", "planes.js")
SALIDA_SQL = os.path.join(RAIZ, "infra", "supabase", "sql", "datos_planes.sql")

# El primero que admite inscriptos nuevos es el que se ofrece por defecto.
POR_DEFECTO = "7v16"
PERIODOS = ("anual", "1c", "2c", "bimestral")


def fallar(mensaje):
    sys.stderr.write("ERROR: " + mensaje + "\n")
    sys.exit(1)


def validar(plan, archivo):
    if not re.match(r"^[a-z0-9]{2,12}$", plan.get("id", "")):
        fallar("%s: id inválido" % archivo)
    for campo in ("carrera", "titulo", "facultad", "nombre"):
        if not plan.get(campo):
            fallar("%s: falta %s" % (archivo, campo))
    codigos = set()
    for m in plan["materias"]:
        c = m.get("codigo", "")
        if not re.match(r"^[0-9A-Z]{5}$", c):
            fallar("%s: código inválido %r" % (archivo, c))
        if c in codigos:
            fallar("%s: código repetido %s" % (archivo, c))
        codigos.add(c)
        if m.get("periodo") not in PERIODOS:
            fallar("%s: período inválido en %s" % (archivo, c))
        if not 1 <= int(m.get("anio", 0)) <= 6:
            fallar("%s: año inválido en %s" % (archivo, c))
    for m in plan["materias"]:
        for r in m.get("correlativas", []):
            if r not in codigos:
                fallar("%s: %s pide %s, que no está en el plan" % (archivo, m["codigo"], r))
            if r == m["codigo"]:
                fallar("%s: %s es correlativa de sí misma" % (archivo, r))


def sql_texto(valor):
    if valor is None:
        return "null"
    return "'" + str(valor).replace("'", "''") + "'"


planes = []
for archivo in sorted(glob.glob(os.path.join(AQUI, "*.json"))):
    plan = json.load(io.open(archivo, encoding="utf-8"))
    validar(plan, os.path.basename(archivo))
    planes.append(plan)

if not any(p["id"] == POR_DEFECTO for p in planes):
    fallar("no existe el plan por defecto " + POR_DEFECTO)

# --------------------------------------------------------------------------
# JavaScript
# --------------------------------------------------------------------------
datos_js = {
    "porDefecto": POR_DEFECTO,
    "planes": {},
}
for p in planes:
    datos_js["planes"][p["id"]] = {
        "id": p["id"],
        "carrera": p["carrera"],
        "titulo": p["titulo"],
        "facultad": p["facultad"],
        "nombre": p["nombre"],
        "horasComplementarias": p.get("horas_complementarias", 0),
        "materias": [
            dict(
                [("codigo", m["codigo"]), ("nombre", m["nombre"]), ("anio", m["anio"]),
                 ("periodo", m["periodo"]), ("correlativas", m.get("correlativas", []))]
                + ([("condicion", m["condicion"])] if m.get("condicion") else [])
            )
            for m in p["materias"]
        ],
    }

# Una materia por renglón: el archivo se lee (y se revisa en un diff) como
# una tabla, no como una escalera de llaves.
partes = []
for pid, p in datos_js["planes"].items():
    cabecera = dict((k, v) for k, v in p.items() if k != "materias")
    materias = ",\n".join("      " + json.dumps(m, ensure_ascii=False) for m in p["materias"])
    partes.append('    %s: %s,\n    "materias": [\n%s\n    ]}' % (
        json.dumps(pid), json.dumps(cabecera, ensure_ascii=False)[:-1], materias))
cuerpo = '{\n  "porDefecto": %s,\n  "planes": {\n%s\n  }\n}' % (
    json.dumps(datos_js["porDefecto"]), ",\n".join(partes))
js = """/* ==========================================================================
   ODONTOCAMPUS — PLANES DE ESTUDIO
   GENERADO por infra/planes/generar.py a partir de infra/planes/*.json.
   No se edita a mano: se cambia el .json y se vuelve a generar.

   Los códigos son los del SIU Guaraní. La misma información está en la base
   (tablas planes_estudio, plan_materias y plan_correlativas), cargada con
   infra/supabase/sql/datos_planes.sql, que sale del mismo .json.
   ========================================================================== */
window.ODONTO_PLANES = %s;
""" % cuerpo
io.open(SALIDA_JS, "w", encoding="utf-8", newline="\n").write(js)

# --------------------------------------------------------------------------
# SQL
# --------------------------------------------------------------------------
lineas = [
    "-- ==========================================================================",
    "-- OdontoCampus — Datos de los planes de estudio",
    "-- GENERADO por infra/planes/generar.py. No se edita a mano.",
    "--",
    "-- Requiere 004_planes_de_estudio.sql. Se puede correr las veces que haga",
    "-- falta: actualiza lo que cambió y no toca las materias de nadie.",
    "--",
    "--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < datos_planes.sql",
    "--",
    "-- Si una materia se sacó del .json y alguien la tiene cargada, la base no",
    "-- deja borrarla (on delete restrict) y todo se deshace: es a propósito.",
    "-- ==========================================================================",
    "",
    "begin;",
    "",
]
for p in planes:
    lineas += [
        "-- Plan %s: %s" % (p["id"], p["nombre"]),
        "insert into public.planes_estudio (id, carrera, titulo, facultad, nombre, horas_complementarias, fuente)",
        "values (%s, %s, %s, %s, %s, %d, %s)" % (
            sql_texto(p["id"]), sql_texto(p["carrera"]), sql_texto(p["titulo"]),
            sql_texto(p["facultad"]), sql_texto(p["nombre"]),
            int(p.get("horas_complementarias", 0)), sql_texto(p.get("fuente"))),
        "on conflict (id) do update set",
        "  carrera = excluded.carrera, titulo = excluded.titulo, facultad = excluded.facultad,",
        "  nombre = excluded.nombre, horas_complementarias = excluded.horas_complementarias,",
        "  fuente = excluded.fuente;",
        "",
        # El orden es único dentro del plan: se corre fuera de rango antes de
        # reescribirlo, para que reordenar no choque con el orden viejo.
        "update public.plan_materias set orden = orden + 250 where plan_id = %s and orden <= 250;" % sql_texto(p["id"]),
        "",
        "insert into public.plan_materias (plan_id, codigo, nombre, anio, periodo, orden, condicion) values",
    ]
    filas = []
    for i, m in enumerate(p["materias"], 1):
        filas.append("  (%s, %s, %s, %d, %s, %d, %s)" % (
            sql_texto(p["id"]), sql_texto(m["codigo"]), sql_texto(m["nombre"]),
            int(m["anio"]), sql_texto(m["periodo"]), i, sql_texto(m.get("condicion"))))
    lineas.append(",\n".join(filas))
    lineas += [
        "on conflict (plan_id, codigo) do update set",
        "  nombre = excluded.nombre, anio = excluded.anio, periodo = excluded.periodo,",
        "  orden = excluded.orden, condicion = excluded.condicion;",
        "",
        "delete from public.plan_materias where plan_id = %s and codigo not in (%s);" % (
            sql_texto(p["id"]), ", ".join(sql_texto(m["codigo"]) for m in p["materias"])),
        "",
        "delete from public.plan_correlativas where plan_id = %s;" % sql_texto(p["id"]),
    ]
    correl = []
    for m in p["materias"]:
        for r in m.get("correlativas", []):
            correl.append("  (%s, %s, %s)" % (sql_texto(p["id"]), sql_texto(m["codigo"]), sql_texto(r)))
    if correl:
        lineas.append("insert into public.plan_correlativas (plan_id, materia, requiere) values")
        lineas.append(",\n".join(correl) + ";")
    lineas.append("")

lineas += [
    "commit;",
    "",
    "select p.id, count(distinct m.codigo) as materias, count(c.*) as correlativas",
    "from public.planes_estudio p",
    "left join public.plan_materias m on m.plan_id = p.id",
    "left join public.plan_correlativas c on c.plan_id = m.plan_id and c.materia = m.codigo",
    "group by p.id order by p.id;",
    "",
]
io.open(SALIDA_SQL, "w", encoding="utf-8", newline="\n").write("\n".join(lineas))

for p in planes:
    n_corr = sum(len(m.get("correlativas", [])) for m in p["materias"])
    print("OK  %s: %d materias, %d correlativas" % (p["id"], len(p["materias"]), n_corr))
print("OK  " + os.path.relpath(SALIDA_JS, RAIZ))
print("OK  " + os.path.relpath(SALIDA_SQL, RAIZ))
