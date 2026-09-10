#!/usr/bin/env bash
# ==========================================================================
# OdontoCampus — Backup de la base y de los archivos de Storage
#
# Instalación:
#   sudo cp backup.sh /opt/supabase/backup.sh
#   sudo chmod 700 /opt/supabase/backup.sh
#   sudo cp backup.env.example /opt/supabase/backup.env
#   sudo nano /opt/supabase/backup.env      # completar y guardar
#   sudo chmod 600 /opt/supabase/backup.env
#
# Cron, todos los días a las 03:15:
#   sudo crontab -e
#   15 3 * * * /opt/supabase/backup.sh >> /var/log/odontocampus-backup.log 2>&1
#
# --------------------------------------------------------------------------
# UN BACKUP QUE NUNCA SE RESTAURÓ NO ES UN BACKUP: ES UNA CARPETA.
# Probá una restauración completa una vez por cuatrimestre. El
# procedimiento está al final de este archivo.
# ==========================================================================

set -Eeuo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
DESTINO_LOCAL="${DESTINO_LOCAL:-/var/backups/odontocampus}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"
ENV_FILE="${ENV_FILE:-/opt/supabase/backup.env}"

# GPG_RECIPIENT o BACKUP_PASSPHRASE, y opcionalmente RCLONE_REMOTE
[[ -f "$ENV_FILE" ]] && . "$ENV_FILE"

FECHA="$(date +%Y-%m-%d_%H%M)"
TRABAJO="$(mktemp -d)"
trap 'rm -rf "$TRABAJO"' EXIT

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

fallo() {
  log "ERROR en la línea ${1:-?}. El backup NO se completó."
  # Enganchá acá un aviso real (correo, Telegram, ntfy). Un backup que
  # falla en silencio es peor que no tener backup: da falsa tranquilidad.
  exit 1
}
trap 'fallo $LINENO' ERR

mkdir -p "$DESTINO_LOCAL"
cd "$SUPABASE_DIR"

# --------------------------------------------------------------------------
# 1. Volcado de la base
#    Sale por la red interna de Docker: la base no tiene puerto publicado.
# --------------------------------------------------------------------------
log "Volcando PostgreSQL…"
docker compose exec -T db \
  pg_dumpall -U postgres --clean --if-exists \
  > "$TRABAJO/base_${FECHA}.sql"

TAMANO=$(stat -c%s "$TRABAJO/base_${FECHA}.sql")
if (( TAMANO < 10240 )); then
  log "El volcado pesa ${TAMANO} bytes: demasiado poco. Algo salió mal."
  exit 1
fi
log "Volcado listo: $(numfmt --to=iec "$TAMANO")"

# --------------------------------------------------------------------------
# 2. Archivos de Storage (apuntes, imágenes)
# --------------------------------------------------------------------------
if [[ -d "$SUPABASE_DIR/volumes/storage" ]]; then
  log "Empaquetando archivos de Storage…"
  tar -czf "$TRABAJO/storage_${FECHA}.tar.gz" -C "$SUPABASE_DIR/volumes" storage
fi

# --------------------------------------------------------------------------
# 3. Configuración
#    El .env tiene los secretos. Por eso el paquete se cifra sí o sí.
# --------------------------------------------------------------------------
cp "$SUPABASE_DIR/.env" "$TRABAJO/env_${FECHA}.txt"
[[ -f "$SUPABASE_DIR/docker-compose.override.yml" ]] && \
  cp "$SUPABASE_DIR/docker-compose.override.yml" "$TRABAJO/"

# --------------------------------------------------------------------------
# 4. Empaquetar y cifrar
#    Sin cifrar no se sube a ningún lado: el paquete contiene notas de
#    estudiantes y todos los secretos del servidor.
# --------------------------------------------------------------------------
PAQUETE="$DESTINO_LOCAL/odontocampus_${FECHA}.tar.gz"
tar -czf "$PAQUETE" -C "$TRABAJO" .

if [[ -n "${GPG_RECIPIENT:-}" ]]; then
  log "Cifrando con GPG…"
  gpg --batch --yes --trust-model always \
      --encrypt --recipient "$GPG_RECIPIENT" \
      --output "${PAQUETE}.gpg" "$PAQUETE"
  shred -u "$PAQUETE"
  PAQUETE="${PAQUETE}.gpg"
elif [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  log "Cifrando con contraseña…"
  gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "$BACKUP_PASSPHRASE" \
      --output "${PAQUETE}.gpg" "$PAQUETE"
  shred -u "$PAQUETE"
  PAQUETE="${PAQUETE}.gpg"
else
  log "ABORTADO: no hay GPG_RECIPIENT ni BACKUP_PASSPHRASE en $ENV_FILE."
  log "El paquete contiene notas de estudiantes y los secretos del servidor."
  shred -u "$PAQUETE"
  exit 1
fi

log "Paquete listo: $PAQUETE ($(du -h "$PAQUETE" | cut -f1))"

# --------------------------------------------------------------------------
# 5. Copia fuera del servidor
#    Un backup que vive en la misma máquina no protege del caso más
#    probable: que el servidor se pierda entero.
# --------------------------------------------------------------------------
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  log "Subiendo a ${RCLONE_REMOTE}…"
  rclone copy "$PAQUETE" "$RCLONE_REMOTE" --stats-one-line
  log "Subida completa."
else
  log "AVISO: sin RCLONE_REMOTE. El backup queda solo en este servidor."
  log "Si el servidor se pierde, se pierde también el backup."
fi

# --------------------------------------------------------------------------
# 6. Rotación local
# --------------------------------------------------------------------------
find "$DESTINO_LOCAL" -name 'odontocampus_*.tar.gz*' \
     -mtime "+${RETENCION_DIAS}" -delete

log "Backup terminado."


# ==========================================================================
# RESTAURACIÓN  — probar una vez por cuatrimestre, en un servidor de prueba
#
#   1. Descifrar y desempaquetar:
#        gpg --decrypt odontocampus_FECHA.tar.gz.gpg > paquete.tar.gz
#        mkdir recuperado && tar -xzf paquete.tar.gz -C recuperado
#
#   2. Levantar Supabase limpio con el .env recuperado.
#
#   3. Cargar la base:
#        docker compose exec -T db psql -U postgres < recuperado/base_FECHA.sql
#
#   4. Restaurar Storage:
#        tar -xzf recuperado/storage_FECHA.tar.gz -C /opt/supabase/volumes/
#
#   5. Verificar de verdad, no de palabra:
#        - iniciar sesión con una cuenta real
#        - que las notas de esa cuenta se descifren en el navegador
#        - que RLS siga activo:
#            select tablename, rowsecurity from pg_tables
#            where schemaname = 'public';
#
#   El punto 5 es el que importa. Los cuatro anteriores pueden "funcionar"
#   con una base vacía.
# ==========================================================================
