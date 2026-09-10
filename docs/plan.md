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
| Repositorio estructurado y con git | Subirlo a un remoto |
| — | Dominio, servidor, SMTP, frontend de cuentas |

---

## Camino crítico

Lo que bloquea a todo lo demás, en orden:

```
Dominio (CUIT) ──▶ DNS ──▶ Sitios en CloudPanel ──▶ Certificados
                                                        │
                                                        ▼
                              Supabase ──▶ SMTP ──▶ Frontend de cuentas
```

**El dominio bloquea la publicación, no la construcción.** Mientras se tramita,
se puede instalar Supabase, cargar el esquema y escribir todo el frontend de
cuentas contra la IP del servidor. No hay que quedarse esperando.

---

## Bloque A — Repositorio ✅ hecho

- [x] 💻 Reestructurar: el sitio vive en `public/`, que es exactamente lo que se
      copia a `htdocs/`. Así `docs/` e `infra/` nunca llegan al navegador.
- [x] 💻 `.gitignore` que bloquea `.env`, claves y backups
- [x] 💻 `git init` + primer commit
- [ ] 🙋 Crear el repositorio remoto y subirlo

```bash
# En GitHub: New repository → odontocampus → PRIVADO → sin README
git remote add origin git@github.com:USUARIO/odontocampus.git
git push -u origin main
```

**Privado, no público.** Todavía no, al menos: hay que revisar antes que no
haya quedado ningún dato de contacto real ni credencial en el historial.

---

## Bloque B — Cuentas y dominio 🙋

Nada de esto lo puedo hacer yo. Es lo que más tarda, así que conviene arrancar
por acá.

- [ ] **Dominio `odontocampus.com.ar`** en [nic.ar](https://nic.ar).
      **Requiere CUIT argentino.**
- [ ] 👥 **Decidir a nombre de quién queda.** Si va a nombre de una persona y esa
      persona se aleja de FOE, la agrupación pierde el dominio. Esto se decide
      antes de tramitarlo, no después.
- [ ] **Proveedor de correo saliente** — [Resend](https://resend.com) o
      [Brevo](https://brevo.com), capa gratuita. Verificar el dominio y cargar
      los registros SPF y DKIM.
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

- [ ] Swap de 4 GB (el servidor tiene 2 GB de RAM)
- [ ] DNS: `@`, `www` y `api` apuntando a la IP
- [ ] CloudPanel → **Create a Static HTML Site** para `odontocampus.com.ar`
- [ ] CloudPanel → **Create a Reverse Proxy** para `api.odontocampus.com.ar`
      → `http://127.0.0.1:8000`
- [ ] Certificados Let's Encrypt en ambos (después de que el DNS resuelva)
- [ ] Supabase en `/opt/supabase`
- [ ] Claves generadas de cero. **Las del `.env.example` son públicas.**
- [ ] `docker-compose.override.yml` copiado (cierra los puertos)
- [ ] Firewall: solo 22, 80, 443 y el panel
- [ ] **Verificar desde afuera** que 5432 y 8000 estén cerrados
- [ ] Ajustes del vhost de la API (websockets, `client_max_body_size`)
- [ ] Primer despliegue del sitio

```bash
rsync -avz --delete public/ usuario@servidor:/home/USUARIO/htdocs/odontocampus.com.ar/
```

> La verificación desde afuera no es opcional. Si el 5432 quedó abierto, hay
> bots que lo encuentran en horas.

---

## Bloque D — Base de datos 🙋 aplicar

- [ ] Cargar [`001_esquema.sql`](../infra/supabase/sql/001_esquema.sql)
- [ ] Correr las dos consultas de verificación del final del archivo
- [ ] **Advisor de Studio sin alertas críticas**
- [ ] Prueba con `curl` y la `ANON_KEY` desde incógnito: no debe devolver nada

---

## Bloque E — Cuentas en el sitio 💻

Acá vuelve el trabajo mío. Archivos nuevos en `public/js/`:

- [ ] `config.js` — URL de la API y `ANON_KEY` (pública, va en el repo)
- [ ] `supabase.js` — cliente
- [ ] `auth.js` — modal de acceso, estado de sesión en el encabezado
- [ ] `cripto.js` — cifrado de las notas **en el navegador**
- [ ] `calculator.js` — capa de sincronización, local primero
- [ ] Flujo de consentimiento antes de la primera sincronización
- [ ] `GET /cuenta/exportar` y borrado de cuenta (Ley 25.326)
- [ ] CSP estricta en el vhost del sitio

**Principio que no se negocia:** el login suma, no tapa. Mesas, reválidas,
historias clínicas, instrumental y biblioteca siguen abiertas sin cuenta. Si
alguien no inicia sesión nunca, el sitio le funciona igual que hoy.

---

## Bloque F — Permutas reales 💻

- [ ] Migrar `permutas.js` de `localStorage` a Supabase
- [ ] Botón de reportar
- [ ] Vencimiento a 60 días con opción de renovar

Es la primera función que **necesita** un servidor para existir: hoy cada
persona ve solamente sus propias publicaciones.

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

Tres cosas, en este orden, y ninguna depende de mí:

1. **Tramitar el dominio.** Es lo que más tarda y bloquea todo lo público.
2. **Crear el repositorio remoto y hacer el push.** Cinco minutos, y a partir de
   ahí el proyecto deja de vivir en una sola computadora.
3. **Dar de alta el proveedor SMTP y verificar el dominio.** Los registros DNS
   tardan en propagarse; conviene que estén andando antes de que haga falta.

Mientras tanto, decime en qué bloque querés que avance yo.
