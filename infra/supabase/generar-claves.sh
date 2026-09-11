#!/usr/bin/env bash
# ==========================================================================
# OdontoCampus — Generación de claves y configuración de Supabase
#
# Uso, como root, UNA SOLA VEZ, antes del primer `docker compose up`:
#
#   cd /opt/supabase && cp .env.example .env
#   bash /home/odontocampus/htdocs/odontocampus.com.ar/infra/supabase/generar-claves.sh
#
# --------------------------------------------------------------------------
# QUÉ HACE
#   · Genera todos los secretos con openssl, en el propio servidor.
#   · Firma ANON_KEY y SERVICE_ROLE_KEY con el JWT_SECRET (HS256).
#   · Escribe todo en /opt/supabase/.env y lo deja con permisos 600.
#   · Pide la clave de Resend sin mostrarla ni dejarla en el historial.
#   · Muestra únicamente la ANON_KEY, que es pública y va en config.js.
#
# POR QUÉ UN SCRIPT Y NO EL GENERADOR WEB DE LA DOCUMENTACIÓN
#   Para usar ese generador hay que pegar el JWT_SECRET en una página. Esa es
#   la clave que firma todas las sesiones: con ella se puede fabricar un token
#   de administrador. Acá no sale del servidor.
#
# POR QUÉ UNA SOLA VEZ
#   · POSTGRES_PASSWORD queda grabada en la base la primera vez que arranca.
#     Si después cambia en el .env, los servicios no pueden conectarse y todo
#     falla con errores de autenticación difíciles de rastrear.
#   · Cambiar JWT_SECRET invalida todas las sesiones y la ANON_KEY que ya está
#     en config.js: el sitio deja de poder hablar con la API.
#   Por eso el script se niega a correr dos veces. Rotar claves es un
#   procedimiento aparte, no volver a ejecutar esto.
# ==========================================================================
set -Eeuo pipefail
umask 077

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
ENV_FILE="${SUPABASE_DIR}/.env"
MARCA="# claves-generadas-por: generar-claves.sh"

DOMINIO="odontocampus.com.ar"
SITE_URL="https://${DOMINIO}"
API_URL="https://api.${DOMINIO}"
REMITENTE="no-responder@${DOMINIO}"

rojo()     { printf '\033[31m%s\033[0m\n' "$*"; }
verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
amarillo() { printf '\033[33m%s\033[0m\n' "$*"; }

# --------------------------------------------------------------------------
# Controles previos: nada se toca hasta pasar todos
# --------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  rojo "Correlo como root."
  exit 1
fi

if ! command -v openssl >/dev/null; then
  rojo "Falta openssl."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  rojo "No encuentro $ENV_FILE"
  echo "Primero: cd $SUPABASE_DIR && cp .env.example .env"
  exit 1
fi

if grep -qF "$MARCA" "$ENV_FILE"; then
  rojo "Este .env ya tiene claves generadas. El script no se vuelve a correr."
  echo "Regenerar POSTGRES_PASSWORD con la base creada la deja inaccesible,"
  echo "y cambiar JWT_SECRET desconecta el sitio de la API."
  exit 1
fi

DATOS_DB="${SUPABASE_DIR}/volumes/db/data"
if [[ -d "$DATOS_DB" ]] && [[ -n "$(ls -A "$DATOS_DB" 2>/dev/null)" ]]; then
  rojo "La base ya fue inicializada ($DATOS_DB no está vacío)."
  echo "Generar una POSTGRES_PASSWORD nueva ahora rompería la conexión a la base."
  exit 1
fi

# --------------------------------------------------------------------------
# Claves asimétricas: este script todavía NO las genera
#
# Las versiones de Supabase de 2026 agregaron un segundo sistema de claves
# (JWT_KEYS, JWT_JWKS, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY,
# ANON_KEY_ASYMMETRIC, SERVICE_ROLE_KEY_ASYMMETRIC). Si el .env las trae y el
# script las dejara como están, quedarían los valores de ejemplo del
# repositorio de Supabase: públicos, conocidos por cualquiera y suficientes
# para fabricar un token de administrador.
#
# Mejor no correr que correr así: se aborta antes de tocar nada.
# --------------------------------------------------------------------------
NO_SOPORTADAS=(JWT_KEYS JWT_JWKS SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY ANON_KEY_ASYMMETRIC SERVICE_ROLE_KEY_ASYMMETRIC)
encontradas=()
for variable in "${NO_SOPORTADAS[@]}"; do
  if grep -q "^${variable}=" "$ENV_FILE"; then
    encontradas+=("$variable")
  fi
done

if (( ${#encontradas[@]} )); then
  rojo "Tu versión de Supabase usa claves que este script todavía no sabe generar:"
  echo "  ${encontradas[*]}"
  echo
  echo "Dejarlas con los valores de ejemplo permitiría fabricar tokens de administrador."
  echo "No se modificó nada."
  exit 1
fi

# --------------------------------------------------------------------------
# La clave de Resend se pide ANTES de escribir nada: si falta, no queda un
# .env a medio configurar.
# --------------------------------------------------------------------------
echo
echo "Necesito la clave de API de Resend para ${DOMINIO}."
echo "Creala en Resend -> API Keys, con permiso 'Sending access'"
echo "y restringida al dominio ${DOMINIO} (no uses la de otro proyecto)."
echo
read -rsp "Pegala acá (no se ve mientras escribís) y apretá Enter: " SMTP_PASS
echo

if [[ -z "$SMTP_PASS" ]]; then
  rojo "Sin clave de Resend no se pueden enviar códigos y nadie podría ingresar."
  exit 1
fi
if [[ "$SMTP_PASS" != re_* ]]; then
  amarillo "Aviso: las claves de Resend empiezan con 're_'. Revisá que sea la correcta."
fi

# --------------------------------------------------------------------------
# Escritura
# --------------------------------------------------------------------------
cp -p "$ENV_FILE" "${ENV_FILE}.original"
trap 'rojo "Falló en la línea $LINENO. El .env sin tocar quedó en ${ENV_FILE}.original"' ERR

aplicadas=()
ausentes=()

# Reemplaza CLAVE=... sólo si la variable existe en el .env.
# Supabase agrega y quita variables entre versiones: en lugar de adivinar,
# se toca lo que está y se informa lo que no.
# El valor pasa por ENVIRON y no por `awk -v`: -v interpreta barras
# invertidas y podría alterar un secreto.
set_env() {
  local clave="$1" valor="$2"
  if grep -q "^${clave}=" "$ENV_FILE"; then
    CLAVE="$clave" VALOR="$valor" awk '
      BEGIN { c = ENVIRON["CLAVE"]; v = ENVIRON["VALOR"] }
      index($0, c "=") == 1 { print c "=" v; next }
      { print }
    ' "$ENV_FILE" > "${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "$ENV_FILE"
    aplicadas+=("$clave")
  else
    ausentes+=("$clave")
  fi
}

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# JWT HS256 firmado con JWT_SECRET. Vence a los 5 años.
jwt() {
  local rol="$1" iat exp cabecera cuerpo firma
  iat=$(date +%s)
  exp=$((iat + 5 * 365 * 24 * 3600))
  cabecera=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  cuerpo=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$rol" "$iat" "$exp" | b64url)
  firma=$(printf '%s.%s' "$cabecera" "$cuerpo" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
  printf '%s.%s.%s' "$cabecera" "$cuerpo" "$firma"
}

# Hexadecimal a propósito: sin caracteres como / + = que rompen las URLs
# de conexión a Postgres o hay que escapar en YAML.
JWT_SECRET=$(openssl rand -hex 32)

set_env JWT_SECRET                    "$JWT_SECRET"
set_env ANON_KEY                      "$(jwt anon)"
set_env SERVICE_ROLE_KEY              "$(jwt service_role)"
set_env JWT_EXPIRY                    "3600"

set_env POSTGRES_PASSWORD             "$(openssl rand -hex 24)"
set_env DASHBOARD_USERNAME            "foe"
set_env DASHBOARD_PASSWORD            "$(openssl rand -hex 16)"
set_env SECRET_KEY_BASE               "$(openssl rand -hex 32)"
set_env VAULT_ENC_KEY                 "$(openssl rand -hex 16)"
set_env PG_META_CRYPTO_KEY            "$(openssl rand -hex 16)"
set_env LOGFLARE_API_KEY              "$(openssl rand -hex 24)"
set_env LOGFLARE_PUBLIC_ACCESS_TOKEN  "$(openssl rand -hex 24)"
set_env LOGFLARE_PRIVATE_ACCESS_TOKEN "$(openssl rand -hex 24)"

set_env SITE_URL                      "$SITE_URL"
set_env API_EXTERNAL_URL              "$API_URL"
set_env SUPABASE_PUBLIC_URL           "$API_URL"
set_env ADDITIONAL_REDIRECT_URLS      "https://www.${DOMINIO}"

set_env SMTP_HOST                     "smtp.resend.com"
set_env SMTP_PORT                     "465"
set_env SMTP_USER                     "resend"
set_env SMTP_PASS                     "$SMTP_PASS"
set_env SMTP_ADMIN_EMAIL              "$REMITENTE"
set_env SMTP_SENDER_NAME              "OdontoCampus"

set_env ENABLE_EMAIL_SIGNUP           "true"
set_env ENABLE_EMAIL_AUTOCONFIRM      "false"
set_env ENABLE_ANONYMOUS_USERS        "false"
set_env ENABLE_PHONE_SIGNUP           "false"
set_env ENABLE_PHONE_AUTOCONFIRM      "false"
set_env DISABLE_SIGNUP                "false"

printf '\n%s %s\n' "$MARCA" "$(date -Iseconds)" >> "$ENV_FILE"
chmod 600 "$ENV_FILE" "${ENV_FILE}.original"
unset SMTP_PASS JWT_SECRET

# --------------------------------------------------------------------------
# Resultado
# --------------------------------------------------------------------------
echo
verde "Listo: ${#aplicadas[@]} variables configuradas en $ENV_FILE"

if (( ${#ausentes[@]} )); then
  echo
  amarillo "No existen en tu .env (es normal: cambian entre versiones de Supabase):"
  echo "  ${ausentes[*]}"
fi

echo
echo "ANON_KEY — es pública, va en public/js/config.js:"
echo
grep '^ANON_KEY=' "$ENV_FILE" | cut -d= -f2-
echo
echo "Los demás secretos NO se muestran. Pasalos a tu gestor de contraseñas con:"
echo
echo "  grep -E '^(POSTGRES_PASSWORD|DASHBOARD_PASSWORD|SERVICE_ROLE_KEY|JWT_SECRET)=' $ENV_FILE"
echo
amarillo "No los copies en capturas de pantalla ni en chats."
