# OdontoCampus — Plan de trabajo

Estado y orden de todo lo que falta. Ordenado por dependencias: cada bloque
supone que el anterior está cerrado.

**Convención:**

- 🙋 **Vos** — requiere tus manos: acceso al servidor, cuentas, dinero, decisiones.
- 💻 **Yo** — puedo escribirlo acá y lo aplicás vos.
- 👥 **Equipo** — hay que conversarlo en FOE, no lo decide una persona sola.

---

## Dónde estamos

| Hecho | Falta |
|---|---|
| Sitio completo funcionando (7 secciones, tema oscuro, accesible) | Está solo en tu máquina |
| Sincronización en vivo con las planillas | — |
| Documento de arquitectura | — |
| Guía de despliegue en CloudPanel | Ejecutarla |
| Esquema SQL con RLS | Aplicarlo |
| Script de backup | Instalarlo |
| Repositorio en `github.com/tomsonArrua7/odontocampus` | — |
| Dominio + registros en Cloudflare | Delegación en nic.ar |
| Frontend de cuentas completo (acceso, cifrado, sincronización) | Enchufarlo al servidor |
| Permutas dadas de baja | — |
| — | Servidor, SMTP, aplicar el esquema |

---

## Camino crítico

Lo que bloquea a todo lo demás, en orden:

```
Dominio ✅ ──▶ DNS ✅ ──▶ Sitios en CloudPanel ──▶ Certificados
                                                    │
                                                    ▼
                          Supabase ──▶ Esquema ──▶ clave publicable en config.js
                              │
                              └──▶ SMTP (Resend) ──▶ primer ingreso real
```

El frontend de cuentas ya está escrito y probado. **Lo único que le falta es la
clave publicable**: hasta que esté, se apaga solo y el sitio funciona como siempre.

---

## Bloque A — Repositorio ✅ hecho

- [x] 💻 Reestructurar: el sitio vive en `public/`, que es exactamente lo que se
      copia a `htdocs/`. Así `docs/` e `infra/` nunca llegan al navegador.
- [x] 💻 `.gitignore` que bloquea `.env`, claves y backups
- [x] 💻 `git init` + primer commit
- [x] 🙋 Repositorio remoto creado: `github.com/tomsonArrua7/odontocampus`
- [x] 💻 Primer push

> **El repositorio es público, y está bien que lo sea:** no contiene ningún
> secreto. La `ANON_KEY` es pública por diseño y la seguridad descansa en las
> políticas RLS, no en ocultar el esquema. La regla que no se rompe: **nunca
> se commitea un `.env`, una clave privada ni datos personales reales.**

---

## Bloque B — Cuentas y dominio 🙋

Nada de esto lo puedo hacer yo. Es lo que más tarda, así que conviene arrancar
por acá.

- [x] **Dominio `odontocampus.com.ar`** ✅ obtenido
- [ ] 👥 **Decidir a nombre de quién queda.** Si va a nombre de una persona y esa
      persona se aleja de FOE, la agrupación pierde el dominio. Esto se decide
      antes de tramitarlo, no después.
- [x] **Resend: agregar `odontocampus.com.ar`** — la cuenta ya existe y está
      paga (hoy tiene `dndjursoc.com.ar`), admite varios dominios. Falta
      *Add domain* y cargar los registros SPF y DKIM que te da.
- [ ] **Backblaze B2** para los backups (~1 USD/mes).
- [ ] **Bitwarden compartido** con FOE. Ahí van: dominio, VPS, Postgres,
      `SERVICE_ROLE_KEY`, SMTP, B2, y la frase del backup.

> **El SMTP es el que más se subestima.** El acceso es por código enviado por
> email: sin correo saliente andando, el sistema entero queda inutilizable. Y
> sin SPF/DKIM los códigos caen en spam, que desde afuera es indistinguible de
> un sistema roto.

---

## Bloque C — Servidor 🙋

Guía completa: [`despliegue-cloudpanel.md`](despliegue-cloudpanel.md).

- [x] DNS: `@`, `www` y `api` apuntando a `179.43.126.185`, en **DNS only**
- [x] Delegar el dominio en nic.ar a los nameservers de Cloudflare
- [x] CloudPanel → **Create a Static HTML Site** para `odontocampus.com.ar`
- [x] Agregarle `www.odontocampus.com.ar` en *Domains*
- [x] CloudPanel → **Create a Reverse Proxy** para `api.odontocampus.com.ar`
      → `http://127.0.0.1:8000`
- [x] Raíz del sitio apuntando a `public/` (reemplazando la marca `{{root}}` en el Vhost)
- [x] Regla de Nginx que devuelve 404 para archivos ocultos
- [x] Repositorio clonado como el usuario del sitio
- [x] **Verificar que `.git/config` e `infra/` den 404 desde afuera**
- [x] Certificados Let's Encrypt en ambos (después de que el DNS resuelva)
- [x] Docker instalado, con rotación de logs
- [ ] Supabase en `/opt/supabase`
- [x] Docker Hub con token de solo lectura (evita el límite de descargas por IP)
- [x] Claves con `infra/supabase/generar-claves.sh` (**una sola vez**, antes del primer arranque)
- [x] `docker-compose.override.yml` copiado (cierra los puertos)
- [ ] Firewall: solo 5469 (SSH), 80, 443 y el panel. **No cierres el 5469**
- [ ] **Verificar desde afuera** que 5432 y 8000 estén cerrados
- [x] Vhost de la API: sólo `/auth`, `/rest`, `/storage`, `/realtime` y `/functions`
- [x] Supabase levantado, puertos 8000, 5432 y 6543 sólo en 127.0.0.1
- [x] Verificado desde afuera: puertos cerrados, panel y `/pg/` en 404, Auth responde con la clave publicable
- [ ] **Correo con código funcionando** (el primer intento dio `535`: clave de Resend rechazada; se corrige con `cambiar-clave-smtp.sh`)
Actualizar el sitio, de ahí en adelante:

```bash
cd ~/htdocs/odontocampus.com.ar && git pull --ff-only
```

> La verificación desde afuera no es opcional. Si el 5432 quedó abierto, hay
> bots que lo encuentran en horas.

---

## Bloque D — Base de datos 🙋 aplicar

- [x] Cargar [`001_esquema.sql`](../infra/supabase/sql/001_esquema.sql)
- [x] Cargar [`002_bolsa_y_privacidad.sql`](../infra/supabase/sql/002_bolsa_y_privacidad.sql)
- [ ] Correr las dos consultas de verificación del final del archivo
- [x] **`pruebas_rls.sql`: todas las pruebas en OK** (25 de 25)
- [ ] **Advisor de Studio sin alertas críticas**
- [ ] Prueba con `curl` y la clave publicable desde incógnito: no debe devolver nada

---

## Bloque E — Cuentas en el sitio 💻

Acá vuelve el trabajo mío. Archivos nuevos en `public/js/`:

- [x] `config.js` — URL de la API y `ANON_KEY`, con apagado automático
- [x] `api.js` — cliente propio: sesión, renovación de token, REST
- [x] `cripto.js` — PBKDF2 + AES-GCM, probado de punta a punta
- [x] `auth.js` — ingreso en dos pasos y panel de cuenta
- [x] `sync.js` — consentimiento, cifrado, mezcla local/remoto
- [x] `calculator.js` — avisa a la sincronización en cada cambio
- [x] Exportar mis datos (Ley 25.326)
- [ ] 🙋 Pegar la `SUPABASE_PUBLISHABLE_KEY` en `config.js` cuando arranque Supabase
- [x] Plantillas de correo con código (`public/email/`)
- [x] Borrado de cuenta real: función `eliminar_mi_cuenta`, con confirmación escrita
- [ ] CSP estricta en el vhost del sitio

**Principio que no se negocia:** el login suma, no tapa. Mesas, reválidas,
historias clínicas, instrumental y biblioteca siguen abiertas sin cuenta. Si
alguien no inicia sesión nunca, el sitio le funciona igual que hoy.

---

## Bloque G — Legal y moderación 👥

Esto no se puede saltear ni dejar para después: condiciona lo que se puede
guardar.

- [ ] **¿Quién es el responsable de datos ante la Ley 25.326?**
      Definirlo **antes** de guardar la primera nota.
- [ ] Redactar términos y política de privacidad, en castellano llano
- [ ] Redactar el texto de consentimiento para sincronizar notas
- [ ] **¿Quién mira la cola de reportes, y cada cuánto?** Con registro abierto
      no es opcional.
- [ ] ¿Qué hacemos si la facultad pide bajar algo? Conviene tener posición
      pensada antes, no durante.

---

## Bloque H — Que sobreviva a la próxima camada 🙋

Una tarde de trabajo. Sin esto, el proyecto muere el día que su responsable
técnico se recibe.

- [ ] **Dos claves SSH** en el servidor. La segunda persona no necesita saber
      operar: necesita poder entrar.
- [ ] Credenciales en el Bitwarden compartido
- [ ] `docs/runbook.md`: cómo desplegar, cómo restaurar, cómo rotar claves
- [ ] Backup en cron **y una restauración probada de punta a punta**

---

## Pendientes del sitio actual

Menores, pero anotados para que no se pierdan:

- [ ] 🙋 Datos de contacto reales — el WhatsApp y el email de `public/js/data.js`
      y del pie de página son de ejemplo
- [ ] 🙋 Actualizar `fechasClave` en `data.js` (escritas a mano, por cuatrimestre)
- [ ] 💻 Reemplazar Font Awesome (~300 KB desde CDN) por un sprite SVG propio
- [ ] 💻 Biblioteca: hoy las fichas existen pero no hay archivos detrás

---

## Empezá por acá

Con los dos sitios creados, en este orden:

1. **Raíz del sitio en `public/` y clonar el repositorio** como el usuario del
   sitio. Verificar que `.git/config` dé 404.
2. **Docker** como root, con la rotación de logs antes de levantar nada.
3. **Supabase** en `/opt/supabase`, con el override de puertos.

En paralelo, porque tardan en propagar: **delegación en nic.ar** y **Resend →
Add domain** con SPF y DKIM.

La guía completa está en
[`despliegue-cloudpanel.md`](despliegue-cloudpanel.md).

Del lado del código, lo que queda depende de que exista el servidor: pegar la
`ANON_KEY` en `config.js`, la CSP en el vhost y el borrado de cuenta.
