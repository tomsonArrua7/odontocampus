#!/usr/bin/env bash
# ==========================================================================
# OdontoCampus — Verificar o reemplazar la clave de Resend (SMTP)
#
# Uso, como root:
#
#   bash /home/odontocampus/htdocs/odontocampus.com.ar/infra/supabase/cambiar-clave-smtp.sh --verificar
#       Comprueba la clave guardada. No cambia nada.
#
#   bash /home/odontocampus/htdocs/odontocampus.com.ar/infra/supabase/cambiar-clave-smtp.sh
#       Pide una clave nueva, la comprueba y, sólo si es válida, la instala.
#
# --------------------------------------------------------------------------
# POR QUÉ EXISTE
#
#   En la instalación real, Auth respondía "535 Authentication credentials
#   invalid": Resend rechazaba la clave guardada en SMTP_PASS y nadie podía
#   recibir su código de acceso.
#
#   · generar-claves.sh no se puede volver a correr: regeneraría todos los
#     secretos y dejaría la base inaccesible.
#   · Editar el .env escribiendo la clave dentro de un comando la deja en el
#     historial de la terminal.
#   · Guardar una clave sin probarla repite el problema: el error aparece
#     recién cuando alguien no recibe su código.
#
#   Este script comprueba la clave contra la API de Resend ANTES de guardarla
#   (sin enviar ningún correo), no la muestra, no la pasa como argumento de un
#   proceso, toca sólo SMTP_PASS y recrea sólo el contenedor de Auth.
# ==========================================================================
set -Eeuo pipefail
umask 077

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
DOMINIO="odontocampus.com.ar"

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

valor() {
  local linea
  linea=$(grep -m1 "^$1=" "$2" 2>/dev/null) || true
  linea="${linea#*=}"
  printf '%s' "${linea%$'\r'}"
}

# --------------------------------------------------------------------------
# Controles previos
# --------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || fallar "Correlo como root."
command -v curl >/dev/null || fallar "Falta curl."
cd "$SUPABASE_DIR" 2>/dev/null || fallar "No existe $SUPABASE_DIR."
[[ -f .env ]] || fallar "No encuentro $SUPABASE_DIR/.env."

# --------------------------------------------------------------------------
# Forma de la clave
#
# Las claves de Resend son "re_" seguido de letras, números y guiones bajos.
# Cualquier otra cosa (espacios, comillas, caracteres de control) es un error
# de copiado: por ejemplo, algunas terminales envuelven lo pegado en
# secuencias invisibles. Se rechaza antes de consultar a nadie.
# --------------------------------------------------------------------------
forma_valida() {
  [[ "$1" =~ ^re_[A-Za-z0-9_]{16,}$ ]]
}

# --------------------------------------------------------------------------
# Consulta a Resend, sin enviar ningún correo.
#
# Se pide la lista de dominios. Una clave con permiso "Sending access" no
# tiene acceso a eso, y Resend lo rechaza con un error de clave RESTRINGIDA:
# esa respuesta confirma que la clave existe y es válida para enviar. Una
# clave inexistente o mal copiada devuelve un error distinto.
#
# La clave va por la entrada estándar de curl (-H @-), no como argumento:
# los argumentos de un proceso los puede ver cualquier usuario del servidor
# mientras corre, y en este hay varios usuarios de sitios.
#
# Imprime una sola palabra: envio | completa | invalida | sin-conexion | otro
# --------------------------------------------------------------------------
consultar_resend() {
  local clave="$1" salida codigo cuerpo
  if ! salida=$(printf 'Authorization: Bearer %s\n' "$clave" \
        | curl -s -m 20 -H @- -w $'\n%{http_code}' https://api.resend.com/domains); then
    echo "sin-conexion"
    return
  fi
  codigo="${salida##*$'\n'}"
  cuerpo="${salida%$'\n'*}"

  if [[ "$codigo" == "200" ]]; then
    echo "completa"
  elif [[ "$cuerpo" == *restricted* ]]; then
    echo "envio"
  elif [[ "$cuerpo" == *suspended* ]]; then
    echo "suspendida"
  elif [[ "$codigo" == "400" || "$codigo" == "401" || "$codigo" == "403" ]]; then
    echo "invalida"
  else
    echo "otro"
  fi
}

explicar() {
  case "$1" in
    envio)
      verde "La clave es válida y tiene permiso sólo de envío (lo correcto)." ;;
    completa)
      amarillo "La clave es válida, pero tiene ACCESO COMPLETO a la cuenta de Resend."
      echo "Funciona, pero si se filtra permite borrar dominios y ver todos los envíos."
      echo "Conviene reemplazarla por una con permiso 'Sending access'." ;;
    invalida)
      rojo "Resend rechaza la clave: no existe, fue borrada o está mal copiada." ;;
    suspendida)
      rojo "La clave existe, pero Resend la tiene suspendida (o suspendió la cuenta)."
      echo "Revisá el panel de Resend: una clave nueva no lo resuelve si la cuenta está suspendida." ;;
    sin-conexion)
      rojo "No se pudo contactar a api.resend.com desde el servidor." ;;
    *)
      amarillo "Resend respondió algo inesperado. Probá de nuevo en unos minutos." ;;
  esac
}

# ==========================================================================
# MODO VERIFICAR
# ==========================================================================
if [[ "${1:-}" == "--verificar" ]]; then
  actual=$(valor SMTP_PASS .env)
  echo
  echo "Clave guardada en .env:"
  if [[ -z "$actual" ]]; then
    fallar "  SMTP_PASS está vacía."
  fi
  if forma_valida "$actual"; then
    echo "  forma: correcta (empieza con re_, ${#actual} caracteres)"
  else
    rojo "  forma: INCORRECTA (tiene espacios, comillas o caracteres que no corresponden)"
  fi

  resultado=$(consultar_resend "$actual")
  echo -n "  Resend: "; explicar "$resultado"

  # ¿El contenedor usa la misma clave que el .env? Si alguien editó el .env
  # y después hizo `restart` en vez de `up -d`, el contenedor sigue con la
  # vieja. Se compara sin mostrar ninguna de las dos.
  if en_contenedor=$(docker compose exec -T auth printenv GOTRUE_SMTP_PASS 2>/dev/null); then
    en_contenedor="${en_contenedor%$'\r'}"
    if [[ "$en_contenedor" == "$actual" ]]; then
      echo "  contenedor de Auth: usa la misma clave que el .env"
    else
      amarillo "  contenedor de Auth: usa OTRA clave. Aplicala con: docker compose up -d auth"
    fi
  else
    amarillo "  contenedor de Auth: no se pudo consultar (¿está levantado?)"
  fi
  unset actual en_contenedor
  echo
  exit 0
fi

# ==========================================================================
# MODO REEMPLAZAR
# ==========================================================================
echo
echo "Clave nueva de Resend para ${DOMINIO}."
echo "Creala en Resend -> API Keys -> Create API Key, con:"
echo "  Permission: Sending access"
echo "  Domain:     ${DOMINIO}"
echo "Resend la muestra una sola vez: copiala directo desde esa pantalla."
echo
read -rsp "Pegala acá (no se ve mientras escribís) y apretá Enter: " NUEVA
echo

forma_valida "$NUEVA" || fallar "La clave no tiene la forma de una clave de Resend (re_ seguido de letras y números)." \
  "Suele pasar al copiar con un espacio de más o desde una pantalla que agrega caracteres." \
  "No se modificó nada."

echo "Comprobando la clave con Resend (no se envía ningún correo)…"
resultado=$(consultar_resend "$NUEVA")
explicar "$resultado"

case "$resultado" in
  envio|completa) ;;
  *) unset NUEVA; fallar "No se modificó nada." ;;
esac

if ! grep -q "^SMTP_PASS=" .env; then
  unset NUEVA
  fallar "El .env no tiene la variable SMTP_PASS. No se modificó nada."
fi

# Escritura atómica: se arma el archivo completo aparte y se reemplaza de una
# vez. Si algo falla a mitad de camino, el .env original queda intacto.
NUEVA="$NUEVA" awk '
  BEGIN { v = ENVIRON["NUEVA"] }
  index($0, "SMTP_PASS=") == 1 { print "SMTP_PASS=" v; next }
  { print }
' .env > .env.tmp
chmod 600 .env.tmp
mv .env.tmp .env
unset NUEVA

verde "Clave guardada en el .env."
echo
echo "Aplicándola al contenedor de Auth (up -d, no restart: restart no relee el .env)…"
docker compose up -d auth

echo
verde "Listo. Volvé a pedir el código para comprobar que llega el correo."
