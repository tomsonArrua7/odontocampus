#!/usr/bin/env bash
# ==========================================================================
# OdontoCampus — Claves y configuración de Supabase
#
# Uso, como root, UNA SOLA VEZ, antes del primer arranque:
#
#   cd /opt/supabase
#   cp .env.example .env
#   cp /home/odontocampus/htdocs/odontocampus.com.ar/infra/supabase/docker-compose.override.yml .
#   bash /home/odontocampus/htdocs/odontocampus.com.ar/infra/supabase/generar-claves.sh
#
# --------------------------------------------------------------------------
# QUÉ HACE
#
#   1. Genera los secretos con los scripts OFICIALES de Supabase
#      (utils/generate-keys.sh y utils/add-new-auth-keys.sh). No
#      reimplementamos criptografía: las claves asimétricas ES256 y las
#      opacas sb_publishable_ / sb_secret_ tienen formatos que mantiene
#      Supabase, y equivocarse ahí rompe todo o, peor, deja algo inseguro
#      sin que se note.
#   2. Configura lo que es nuestro: URLs, correo por Resend, registro por
#      email, override activado.
#   3. VERIFICA antes de dar el OK. Si algo no quedó bien, no marca el .env
#      como listo y dice qué falló, sin mostrar ningún secreto.
#
# POR QUÉ ENVOLVER LOS SCRIPTS OFICIALES EN LUGAR DE CORRERLOS A MANO
#
#   · Imprimen en pantalla TODOS los secretos, incluida la clave privada que
#     firma las sesiones. Acá esa salida se descarta: no queda en el
#     historial de la terminal ni en una captura de pantalla.
#   · Dejan copias .old del .env con los secretos adentro. Acá se borran.
#   · No se protegen contra una segunda ejecución. Correrlos de nuevo con la
#     base ya creada cambia POSTGRES_PASSWORD y la deja inaccesible.
#   · El .env.example trae COMPOSE_FILE=docker-compose.yml, y con eso Docker
#     Compose IGNORA docker-compose.override.yml sin avisar: ni el correo con
#     código ni el atado de puertos se aplicarían. Acá se corrige y se
#     comprueba.
# ==========================================================================
set -Eeuo pipefail
umask 077

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
MARCA="# claves-generadas-por: generar-claves.sh"

DOMINIO="odontocampus.com.ar"
SITE_URL="https://${DOMINIO}"
API_URL="https://api.${DOMINIO}"
REMITENTE="no-responder@${DOMINIO}"
ORIGEN_OVERRIDE="/home/odontocampus/htdocs/odontocampus.com.ar/infra/supabase/docker-compose.override.yml"

rojo()     { printf '\033[31m%s\033[0m\n' "$*"; }
verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
amarillo() { printf '\033[33m%s\033[0m\n' "$*"; }

fallar() {
  rojo "$1"
  shift
  local linea
  for linea in "$@"; do echo "$linea"; done
  exit 1
}

# Lee el valor de una variable de un archivo .env sin fallar si no existe.
valor() {
  local linea
  linea=$(grep -m1 "^$1=" "$2" 2>/dev/null) || true
  linea="${linea#*=}"
  printf '%s' "${linea%$'\r'}"
}

# --------------------------------------------------------------------------
# Controles previos: nada se toca hasta pasar todos
# --------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || fallar "Correlo como root."
command -v openssl >/dev/null || fallar "Falta openssl."
cd "$SUPABASE_DIR" 2>/dev/null || fallar "No existe $SUPABASE_DIR."

for requerido in .env.example docker-compose.yml utils/generate-keys.sh utils/add-new-auth-keys.sh; do
  [[ -f "$requerido" ]] || fallar "Falta $SUPABASE_DIR/$requerido." \
    "¿Copiaste el contenido de Supabase con: cp -r repo/docker/. . ?"
done

[[ -f .env ]] || fallar "Falta el .env." "Primero: cd $SUPABASE_DIR && cp .env.example .env"

[[ -f docker-compose.override.yml ]] || fallar "Falta docker-compose.override.yml." \
  "Copialo antes con:" "  cp $ORIGEN_OVERRIDE $SUPABASE_DIR/"

if grep -qF "$MARCA" .env; then
  fallar "Este .env ya tiene claves generadas. El script no se vuelve a correr." \
    "Regenerar POSTGRES_PASSWORD con la base creada la deja inaccesible," \
    "y cambiar las claves desconecta el sitio de la API."
fi

if [[ -d volumes/db/data ]] && [[ -n "$(ls -A volumes/db/data 2>/dev/null)" ]]; then
  fallar "La base ya fue inicializada (volumes/db/data no está vacío)." \
    "Generar una POSTGRES_PASSWORD nueva ahora rompería la conexión a la base."
fi

# --------------------------------------------------------------------------
# La clave de Resend se pide ANTES de escribir nada
# --------------------------------------------------------------------------
echo
echo "Necesito la clave de API de Resend para ${DOMINIO}."
echo "Creala en Resend -> API Keys, con permiso 'Sending access'"
echo "y restringida al dominio ${DOMINIO} (no uses la de otro proyecto)."
echo
read -rsp "Pegala acá (no se ve mientras escribís) y apretá Enter: " SMTP_PASS
echo

[[ -n "$SMTP_PASS" ]] || fallar "Sin clave de Resend no se pueden enviar códigos y nadie podría ingresar."
[[ "$SMTP_PASS" == re_* ]] || amarillo "Aviso: las claves de Resend empiezan con 're_'. Revisá que sea la correcta."

# --------------------------------------------------------------------------
# Punto de partida limpio
# Si un intento anterior falló a mitad de camino, se vuelve al .env original
# en lugar de generar encima de un archivo a medio configurar.
# --------------------------------------------------------------------------
if [[ -f .env.original ]]; then
  amarillo "Hay un intento anterior sin terminar: se parte otra vez del .env original."
  cp -p .env.original .env
else
  cp -p .env .env.original
fi
# Antes de que existan los secretos: todo lo que se derive del .env nace 600.
chmod 600 .env .env.original

trap 'rojo "Falló en la línea $LINENO."; echo "El .env NO está listo: no levantes Supabase. Podés volver a correr el script."' ERR

# --------------------------------------------------------------------------
# 1. Secretos, con los generadores oficiales y sin mostrar su salida
# --------------------------------------------------------------------------
echo
echo "Generando secretos con los scripts oficiales de Supabase…"
sh utils/generate-keys.sh --update-env > /dev/null < /dev/null

echo "Generando claves asimétricas (la primera vez descarga una imagen de Node: puede tardar)…"
sh utils/add-new-auth-keys.sh --update-env > /dev/null < /dev/null

# Copias que dejan los scripts oficiales. .env.old tiene secretos adentro.
rm -f .env.old docker-compose.yml.old
chmod 600 .env

# --------------------------------------------------------------------------
# 2. Nuestra configuración
# --------------------------------------------------------------------------
aplicadas=()
ausentes=()

# Reemplaza CLAVE=... sólo si la variable existe en el .env: Supabase agrega y
# quita variables entre versiones, así que se toca lo que está y se informa
# lo que no. El valor pasa por ENVIRON y no por `awk -v`, que interpreta
# barras invertidas y podría alterar un valor.
set_env() {
  local clave="$1" valor_nuevo="$2"
  if grep -q "^${clave}=" .env; then
    CLAVE="$clave" VALOR="$valor_nuevo" awk '
      BEGIN { c = ENVIRON["CLAVE"]; v = ENVIRON["VALOR"] }
      index($0, c "=") == 1 { print c "=" v; next }
      { print }
    ' .env > .env.tmp
    mv .env.tmp .env
    aplicadas+=("$clave")
  else
    ausentes+=("$clave")
  fi
}

# Sin esto, Docker Compose ignora el override. Ver la cabecera del archivo.
set_env COMPOSE_FILE              "docker-compose.yml:docker-compose.override.yml"

set_env SITE_URL                  "$SITE_URL"
set_env SUPABASE_PUBLIC_URL       "$API_URL"
# En esta versión la URL externa de Auth incluye /auth/v1 (así la arma el
# setup.sh oficial). También es el emisor de los tokens.
set_env API_EXTERNAL_URL          "${API_URL}/auth/v1"
set_env ADDITIONAL_REDIRECT_URLS  "https://www.${DOMINIO}"
set_env JWT_EXPIRY                "3600"
set_env DASHBOARD_USERNAME        "foe"

set_env SMTP_HOST                 "smtp.resend.com"
set_env SMTP_PORT                 "465"
set_env SMTP_USER                 "resend"
set_env SMTP_PASS                 "$SMTP_PASS"
set_env SMTP_ADMIN_EMAIL          "$REMITENTE"
set_env SMTP_SENDER_NAME          "OdontoCampus"

set_env ENABLE_EMAIL_SIGNUP       "true"
set_env ENABLE_EMAIL_AUTOCONFIRM  "false"
set_env ENABLE_ANONYMOUS_USERS    "false"
set_env ENABLE_PHONE_SIGNUP       "false"
set_env ENABLE_PHONE_AUTOCONFIRM  "false"
set_env DISABLE_SIGNUP            "false"

# Vacías a propósito:
# · El asistente de IA del panel le mandaría a OpenAI el esquema y las
#   consultas. Con datos de estudiantes en la base, no.
set_env OPENAI_API_KEY            ""
# · Proxy con certificados que trae Supabase. Ese trabajo lo hace CloudPanel;
#   tener los dos pelearía por los puertos 80 y 443.
set_env PROXY_DOMAIN              ""
set_env CERTBOT_EMAIL             ""

unset SMTP_PASS
chmod 600 .env

# --------------------------------------------------------------------------
# 3. Verificación. Ningún mensaje muestra valores, sólo nombres.
# --------------------------------------------------------------------------
echo "Verificando…"
problemas=()

# 3a. Ningún secreto vacío ni con el valor de ejemplo. La lista sale del
#     propio .env.example: si una versión futura agrega un secreto nuevo que
#     nadie genera, esto lo detecta.
while IFS= read -r variable; do
  [[ "$variable" == "OPENAI_API_KEY" ]] && continue
  actual=$(valor "$variable" .env)
  ejemplo=$(valor "$variable" .env.example)
  if [[ -z "$actual" ]]; then
    problemas+=("$variable quedó vacía")
  elif [[ "$actual" == "$ejemplo" ]]; then
    problemas+=("$variable conserva el valor de ejemplo")
  fi
done < <(grep -oE '^[A-Z0-9_]+=' .env.example | tr -d '=' | grep -E 'KEY|SECRET|PASS|TOKEN|JWKS' || true)
unset actual ejemplo

# 3b. El script oficial tiene que haber activado las claves asimétricas en
#     docker-compose.yml. Si no pudo, lo avisa en una salida que descartamos.
for linea in GOTRUE_JWT_KEYS API_JWT_JWKS JWT_JWKS SUPABASE_JWKS; do
  grep -qE "^[ ]*${linea}:" docker-compose.yml || problemas+=("docker-compose.yml: $linea sigue comentada")
done

# 3c. Docker Compose tiene que estar cargando el override de verdad.
#     La configuración resuelta incluye secretos: sólo se busca en ella, no
#     se imprime.
if configuracion=$(docker compose config 2>/dev/null); then
  grep -q "GOTRUE_MAILER_TEMPLATES_MAGIC_LINK" <<<"$configuracion" \
    || problemas+=("el override no se aplica: falta la configuración del correo con código")
  grep -q "host_ip: 127.0.0.1" <<<"$configuracion" \
    || problemas+=("el override no se aplica: los puertos no quedan atados a 127.0.0.1")
else
  problemas+=("docker compose config falla. Para ver el error: docker compose config --quiet")
fi
unset configuracion

if (( ${#problemas[@]} )); then
  echo
  rojo "El .env NO está listo. No levantes Supabase."
  for problema in "${problemas[@]}"; do echo "  · $problema"; done
  echo
  echo "Corregí lo anterior y volvé a correr el script: parte otra vez del .env original."
  trap - ERR
  exit 1
fi

# --------------------------------------------------------------------------
# Listo
# --------------------------------------------------------------------------
printf '\n%s %s\n' "$MARCA" "$(date -Iseconds)" >> .env
chmod 600 .env
rm -f .env.original
trap - ERR

echo
verde "Listo: .env configurado y verificado (${#aplicadas[@]} ajustes propios)."

if (( ${#ausentes[@]} )); then
  echo
  amarillo "No existen en tu .env (normal: cambian entre versiones de Supabase):"
  echo "  ${ausentes[*]}"
fi

echo
echo "Clave publicable para public/js/config.js (es pública por diseño):"
echo
valor SUPABASE_PUBLISHABLE_KEY .env
echo
echo
echo "Guardá AHORA los secretos en el gestor de contraseñas. Para verlos:"
echo "  sh run.sh secrets"
amarillo "Esa salida tiene contraseñas: no la captures ni la pegues en chats."
echo
echo "Todavía no levantes Supabase: primero hay que cerrar el panel en el Vhost de la API."
