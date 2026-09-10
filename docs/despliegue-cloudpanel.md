# Despliegue en CloudPanel + Supabase autoalojado

Guía de montaje para `odontocampus.com.ar`.

> **Antes de empezar, tres advertencias que evitan un desastre.** Leelas aunque
> saltees el resto.
>
> 1. **La base de datos nunca se publica.** Postgres queda solo en la red
>    interna de Docker. Se administra por túnel SSH, no por puerto abierto.
> 2. **Kong (Supabase) usa el puerto 8443, que es el del panel de CloudPanel.**
>    Hay conflicto. Solo publicamos Kong en `127.0.0.1:8000`.
> 3. **El compose oficial de Supabase publica en `0.0.0.0`.** Sin corregirlo,
>    `http://TU_IP:8000` responde sin TLS y salteando el proxy.

---

## 1. Topología

CloudPanel **reemplaza a Caddy** en el plan original: gestiona Nginx y renueva
los certificados Let's Encrypt solo. Nosotros solo declaramos los sitios.

```
                         Internet
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   Nginx de CloudPanel  :80 / :443     │  ← TLS acá
        └───────────┬───────────────┬───────────┘
                    │               │
   odontocampus.com.ar         api.odontocampus.com.ar
     (Static HTML Site)          (Reverse Proxy)
                    │               │
                    ▼               ▼
          /home/USUARIO/htdocs   127.0.0.1:8000
             (nuestros            (Kong de Supabase)
              archivos)                │
                          ┌────────────┼────────────┬─────────────┐
                          ▼            ▼            ▼             ▼
                       GoTrue      PostgREST     Storage      Realtime
                       (auth)      (datos)      (archivos)
                          └────────────┼────────────┴─────────────┘
                                       ▼
                              PostgreSQL  (red interna, sin puerto público)
```

**Studio (el panel de Supabase) no se publica.** Se accede por túnel SSH. En una
instalación autoalojada, Studio queda protegido apenas por una contraseña básica
de Kong; exponerlo a internet es regalar la base entera.

---

## 2. Los dos sitios en CloudPanel

### `odontocampus.com.ar` → **Create a Static HTML Site**

No hace falta Node ni PHP: el sitio es HTML, CSS y JS. Los archivos van a
`/home/<usuario-del-sitio>/htdocs/odontocampus.com.ar/`.

Después de crearlo: **Sites → odontocampus.com.ar → SSL/TLS → Actions → New
Let's Encrypt Certificate**. Agregá también `www.odontocampus.com.ar`.

### `api.odontocampus.com.ar` → **Create a Reverse Proxy**

| Campo | Valor |
|---|---|
| Domain Name | `api.odontocampus.com.ar` |
| Reverse Proxy URL | `http://127.0.0.1:8000` |

Certificado Let's Encrypt igual que el anterior.

### DNS: delegar nic.ar a Cloudflare

Un `.com.ar` se registra en **nic.ar**, que por defecto queda con los
servidores de nombres del propio NIC. Para que manden los registros que cargás
en Cloudflare hay que **delegar**: decirle a nic.ar que la autoridad sobre la
zona pasa a los servidores de Cloudflare.

**Cargar los registros en Cloudflare no alcanza.** Mientras la delegación no
esté hecha, esos registros no los ve nadie: el dominio sigue resolviendo (o no
resolviendo) por nic.ar. Es el error más común y cuesta darse cuenta, porque el
panel de Cloudflare muestra todo en verde.

#### 1. Los servidores de Cloudflare

En Cloudflare, botón **Continue to activation**. Te da dos nombres del estilo:

```
alice.ns.cloudflare.com
bob.ns.cloudflare.com
```

Son **específicos de tu cuenta**: no sirven los de otro dominio tuyo.

#### 2. Cargarlos en nic.ar

1. Entrar a [nic.ar](https://nic.ar) e iniciar sesión (Clave Fiscal de AFIP).
2. **Mis dominios** → `odontocampus.com.ar`.
3. Buscar la opción de **delegación** o **DNS** del dominio.
4. Reemplazar los servidores que estén cargados por los dos de Cloudflare.
5. Guardar y confirmar.

> Las etiquetas exactas del panel de nic.ar cambian cada tanto. Lo que buscás
> es la pantalla donde se editan los *servidores de nombres* (nameservers) del
> dominio, no los registros A: esos van del lado de Cloudflare.

#### 3. Esperar y verificar

La propagación suele tardar entre unas horas y un día. Cloudflare avisa por
correo cuando la zona queda activa, pero conviene comprobarlo:

```bash
# ¿Quién manda sobre el dominio? Deben aparecer los de Cloudflare.
nslookup -type=NS odontocampus.com.ar

# ¿Resuelven los tres nombres a la IP del servidor?
nslookup odontocampus.com.ar 1.1.1.1
nslookup www.odontocampus.com.ar 1.1.1.1
nslookup api.odontocampus.com.ar 1.1.1.1
```

Los tres tienen que devolver la IP del servidor. **Recién entonces** se piden
los certificados.

### Registros en Cloudflare

| Tipo | Nombre | Valor | Proxy |
|---|---|---|---|
| A | `@` | IP del servidor | DNS only (nube gris) |
| A | `www` | IP del servidor | DNS only |
| A | `api` | IP del servidor | DNS only |

**Dejá la nube gris hasta tener los certificados emitidos.** Let's Encrypt
valida por HTTP contra el servidor: si Cloudflare intercepta el tráfico antes,
la validación se complica innecesariamente.

### A nombre de quién

`.com.ar` requiere CUIT argentino. Conviene definir a nombre de quién queda
antes de tramitarlo: si va a nombre de una persona y esa persona se aleja de
FOE, la agrupación pierde el dominio.

---

## 3. Instalar Supabase

Como usuario con sudo, **fuera** del directorio de los sitios:

```bash
sudo mkdir -p /opt/supabase && cd /opt/supabase
sudo git clone --depth 1 https://github.com/supabase/supabase.git repo
sudo cp -r repo/docker/* .
sudo cp .env.example .env
```

### 3.1 Generar las claves

Necesitás cuatro secretos. **Ninguno se reutiliza de otro proyecto.**

```bash
# JWT_SECRET  (mínimo 40 caracteres)
openssl rand -base64 48 | tr -d '\n'

# POSTGRES_PASSWORD
openssl rand -base64 32 | tr -d '\n/+='

# DASHBOARD_PASSWORD
openssl rand -base64 24 | tr -d '\n/+='

# SECRET_KEY_BASE  (Realtime)
openssl rand -base64 48 | tr -d '\n'
```

`ANON_KEY` y `SERVICE_ROLE_KEY` son JWT firmados con tu `JWT_SECRET`. Se generan
con el generador de la documentación de Supabase (*Self-Hosting → Generate API
Keys*) pegando ahí el `JWT_SECRET`. No sirven los del `.env.example`: son
públicos y conocidos por todo el mundo.

> **`SERVICE_ROLE_KEY` saltea todas las políticas de seguridad.** Nunca va al
> navegador, nunca al repositorio, nunca a un mensaje de WhatsApp. Solo vive en
> el `.env` del servidor.

### 3.2 Variables que hay que cambiar sí o sí

```dotenv
POSTGRES_PASSWORD=<generado>
JWT_SECRET=<generado>
ANON_KEY=<generado a partir del JWT_SECRET>
SERVICE_ROLE_KEY=<generado a partir del JWT_SECRET>
SECRET_KEY_BASE=<generado>

DASHBOARD_USERNAME=foe
DASHBOARD_PASSWORD=<generado>

SITE_URL=https://odontocampus.com.ar
API_EXTERNAL_URL=https://api.odontocampus.com.ar
SUPABASE_PUBLIC_URL=https://api.odontocampus.com.ar
ADDITIONAL_REDIRECT_URLS=https://www.odontocampus.com.ar

# Correo: sin esto NADIE puede iniciar sesión
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=<clave del proveedor>
SMTP_ADMIN_EMAIL=hola@odontocampus.com.ar
SMTP_SENDER_NAME=OdontoCampus

ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false
DISABLE_SIGNUP=false
```

**El SMTP es la pieza que más se olvida.** El acceso es por código enviado al
email: sin correo saliente funcionando, el sistema queda inutilizable. Resend o
Brevo tienen capa gratuita suficiente. Hay que verificar el dominio y cargar los
registros SPF y DKIM, o los códigos van a parar a spam.

Permisos del `.env`, que contiene todos los secretos:

```bash
sudo chmod 600 /opt/supabase/.env
```

### 3.3 Cerrar los puertos

Copiá `infra/supabase/docker-compose.override.yml` de este repositorio a
`/opt/supabase/`. Ata todo a `127.0.0.1` y quita el puerto de Postgres.

**Verificá primero qué servicios trae tu versión**, porque cambian entre
lanzamientos:

```bash
cd /opt/supabase && docker compose config --services
```

Comentá en el override los bloques de servicios que no aparezcan en esa lista:
si definís un servicio inexistente, Compose intenta crearlo sin imagen y falla.

### 3.4 Levantar

```bash
cd /opt/supabase
docker compose up -d
docker compose ps
```

**La comprobación que importa**, desde tu máquina (no desde el servidor):

```bash
# Debe fallar o dar timeout. Si responde, la base está expuesta.
nc -zv TU_IP 5432
nc -zv TU_IP 8000
```

Y desde el servidor, que sí responda por dentro:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/auth/v1/health
```

### 3.5 Firewall

CloudPanel trae uno. Dejá abiertos solo:

| Puerto | Para qué |
|---|---|
| 22 | SSH |
| 80 | Let's Encrypt y redirección |
| 443 | El sitio |
| 8443 | Panel de CloudPanel (mejor, restringido por IP) |

Nada de 8000, 5432, 3000, 4000.

---

## 4. Ajustes del proxy inverso

CloudPanel genera un vhost estándar. Para la API hacen falta dos cosas más:
websockets (Realtime) y cuerpos de subida más grandes (Storage).

En **Sites → api.odontocampus.com.ar → Vhost**, dentro del `location /`:

```nginx
client_max_body_size 50m;

proxy_http_version 1.1;
proxy_set_header Upgrade           $http_upgrade;
proxy_set_header Connection        $connection_upgrade;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;

proxy_read_timeout    300s;
proxy_connect_timeout 60s;
proxy_buffering       off;   # necesario para Realtime
```

**No agregues cabeceras CORS en Nginx.** Kong ya las emite; duplicarlas produce
un `Access-Control-Allow-Origin` doble y el navegador rechaza *todas* las
respuestas. Es un error difícil de diagnosticar porque el error del navegador no
dice que el problema es la duplicación.

### Studio, por túnel SSH

```bash
ssh -L 8000:127.0.0.1:8000 usuario@servidor
```

Y abrís `http://localhost:8000` en tu navegador. Usuario y contraseña son
`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.

Para Postgres con un cliente gráfico (DBeaver, TablePlus):

```bash
ssh -L 5432:127.0.0.1:5432 usuario@servidor
```

---

## 5. El esquema

`infra/supabase/sql/001_esquema.sql` crea las tablas y **las políticas de
seguridad a nivel de fila (RLS)**.

```bash
scp infra/supabase/sql/001_esquema.sql usuario@servidor:/tmp/
ssh usuario@servidor
cd /opt/supabase
docker compose exec -T db psql -U postgres -d postgres < /tmp/001_esquema.sql
```

### Por qué RLS es ahora *todo* el modelo de seguridad

Esto es lo más importante de este documento.

Con Supabase no escribimos una API que valide permisos. **El navegador habla
directo con PostgREST usando la `ANON_KEY`, que es pública por diseño y viaja
dentro de nuestro JavaScript.** Cualquiera puede leerla, y eso está bien.

Lo que impide que esa clave lea toda la base son las políticas RLS.

- **Sin RLS, una tabla es legible y escribible por cualquiera que abra el sitio.**
- Con RLS mal escrito, pasa lo mismo pero cuesta más darse cuenta.

Regla: **ninguna tabla en `public` sin `enable row level security` y sin al
menos una política.** Antes de cada despliegue:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by rowsecurity, tablename;
```

Todas tienen que decir `t`.

### El Advisor de Studio: revisarlo siempre

Studio trae un analizador (**Advisor**) que detecta tablas sin RLS y columnas
sensibles expuestas. **Correrlo después de cada cambio de esquema es
obligatorio**, no opcional.

No es una precaución hipotética. En el otro proyecto del equipo
(`dndjursoc.com.ar`), el Advisor detectó una tabla `instagram_config` sin RLS
con una columna `access_token` dentro: cualquiera con la `ANON_KEY` —que está
en el JavaScript del sitio, a la vista— podía leer ese token con un solo
`curl`.

El patrón a evitar es siempre el mismo: **se crea una tabla desde Studio para
resolver algo rápido y nadie le activa RLS.** Queda pública sin que nadie lo
note, porque desde el navegador todo funciona igual.

Si aparece una exposición así, cerrar la tabla no alcanza: **hay que rotar la
credencial expuesta.** Estuvo accesible, y no hay forma de saber quién la leyó.

---

## 6. Las notas siguen siendo ilegibles para FOE

El diseño del documento de arquitectura **no cambia** con Supabase; si acaso, se
vuelve más necesario.

RLS impide que un estudiante lea las notas de otro. Pero **`SERVICE_ROLE_KEY` y
el acceso directo a Postgres saltean RLS por completo**. Quien administre el
servidor puede leer cualquier fila.

Por eso las notas se cifran **en el navegador** antes de enviarse. El servidor
guarda un texto opaco. La base no tiene una columna `nota`, ni `promedio`, ni
`materia`: **no se puede construir un ranking de promedios ni con acceso total a
la base**, porque no hay contra qué consultar.

Esa es la única respuesta seria al miedo —razonable— de que una agrupación
política vea quién va atrasado.

---

## 7. Un cambio respecto de lo que recomendé antes

En el documento de arquitectura propuse la sesión en cookie `httpOnly`. **Con
`supabase-js` sobre un sitio estático eso no es posible**: la biblioteca guarda
el token en `localStorage`, y las cookies `httpOnly` requieren una capa de
servidor que renderice, que acá no tenemos.

Es un compromiso real: un XSS podría robar la sesión. Lo compensamos con

- el escapado estricto que ya tiene todo el frontend (`OdontoUI.esc`),
- una Content-Security-Policy estricta en el vhost del sitio,
- tokens de vida corta con rotación del refresh token,
- y ningún `innerHTML` con datos sin escapar, nunca.

Lo digo explícitamente porque contradice lo que recomendé antes y conviene que
quede asentado por qué.

---

## 8. Backups

`infra/backup/backup.sh`, en cron diario. Detalles en el propio script.

**Una restauración probada por cuatrimestre.** Un backup que nunca se restauró
no es un backup: es una carpeta.

---

## 9. Recursos

No hay un número único: **depende de cuántos componentes levantes**, no de
"Supabase" como bloque. La versión completa son unos diez contenedores; la que
necesitamos para las fases 1 a 3 son cuatro.

### Qué necesitamos de verdad

| Componente | ¿Hace falta? | Para qué |
|---|---|---|
| **PostgreSQL** | Sí | La base |
| **GoTrue** (auth) | Sí | Acceso por código de email |
| **PostgREST** (rest) | Sí | Leer y escribir desde el navegador |
| **Kong** (gateway) | Sí | Unifica todo bajo `api.odontocampus.com.ar` |
| Storage | Recién en fase 4 | Subida de apuntes |
| Realtime | No | No tenemos nada en vivo |
| Studio | No | Se administra por túnel SSH con psql o DBeaver |
| Analytics (Logflare) | No | Métricas internas que no vamos a mirar |
| Vector | No | Recolección de logs |
| Supavisor / imgproxy | No | Pooler y miniaturas |

Los cuatro primeros son livianos. **Lo pesado es lo que no necesitamos**, y
`analytics` es el que más come.

### Sobre servidores de 2 GB

**Dato comprobado del propio equipo:** `dndjursoc.com.ar` corre Supabase
autoalojado completo —con Studio incluido— en un servidor de 2 GB con
CloudPanel, y funciona bien. Así que la versión completa entra.

Aun así, dos recaudos: configurar swap (abajo) y tener presente que el margen
es chico. Si el servidor empieza a matar contenedores al azar bajo carga, el
primer sospechoso es `analytics`.

**No estimes: medí.** Sobre el servidor que ya funciona:

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}'
free -h && swapon --show
```

Y si vas a quedarte en 2 GB, configurá swap antes de instalar nada. Es lo que
evita que el kernel mate un contenedor al azar bajo un pico de memoria:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl -w vm.swappiness=10
```

### Desactivar `analytics`

No alcanza con apagarlo: **varios servicios lo declaran en su `depends_on`** y
el arranque queda trabado esperándolo. Hay que quitar esas referencias del
`docker-compose.yml` original.

Sumale que CloudPanel ya tiene su propio Nginx y sus servicios corriendo.

---

## 10. Orden de trabajo

1. [ ] DNS apuntando (`@`, `www`, `api`)
2. [ ] Sitio estático creado + Let's Encrypt
3. [ ] Reverse proxy creado + Let's Encrypt
4. [ ] Supabase instalado en `/opt/supabase`
5. [ ] Claves generadas, `.env` completo, `chmod 600`
6. [ ] Override de puertos aplicado
7. [ ] `docker compose up -d` y verificación **desde afuera** de que 5432 y 8000 están cerrados
8. [ ] Firewall configurado
9. [ ] Ajustes del vhost de la API (websockets, tamaño de cuerpo)
10. [ ] Esquema y RLS cargados, verificados con la consulta de `pg_tables`
11. [ ] **Advisor de Studio sin alertas críticas**
12. [ ] SMTP probado: que llegue un código real a una casilla real
13. [ ] Backup en cron **y una restauración probada**
14. [ ] Segunda clave SSH y credenciales en el gestor compartido

Los puntos 7, 10, 11 y 14 son los que no se pueden saltear.

Y una comprobación final, desde una ventana de incógnito, sin sesión iniciada:

```bash
# Con la ANON_KEY pública, ninguna de estas debe devolver datos.
curl -s "https://api.odontocampus.com.ar/rest/v1/notas_academicas?select=*" \
     -H "apikey: TU_ANON_KEY"
curl -s "https://api.odontocampus.com.ar/rest/v1/perfiles?select=*" \
     -H "apikey: TU_ANON_KEY"
```

Si alguna devuelve filas, hay una política mal escrita. **Esta prueba es la que
hay que correr antes de decir que el despliegue está listo**, porque es
exactamente lo que haría alguien que quiere sacar datos.
