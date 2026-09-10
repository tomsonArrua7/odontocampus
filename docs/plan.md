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
| Dominio `odontocampus.com.ar` | Apuntar el DNS |
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
                          Supabase ──▶ Esquema ──▶ ANON_KEY en config.js
                              │
                              └──▶ SMTP (Resend) ──▶ primer ingreso real
```

El frontend de cuentas ya está escrito y probado. **Lo único que le falta es la
`ANON_KEY`**: hasta que esté, se apaga solo y el sitio funciona como siempre.

---

## Bloque A — Repositorio ✅ hecho

- [x] 💻 Reestructurar: el sitio vive en `public/`, que es exactamente lo que se
      copia a `htdocs/`. Así `docs/` e `infra/` nunca llegan al navegador.
- [x] 💻 `.gitignore` que bloquea `.env`, claves y backups
- [x] 💻 `git init` + primer commit
- [x] 🙋 Repositorio remoto creado: `github.com/tomsonArrua7/odontocampus`
- [x] 💻 Primer push

> **Revisar que el repositorio sea privado.** En `public/js/data.js` todavía
> hay un WhatsApp y un email de ejemplo, y conviene reemplazarlos por los
> reales antes de abrirlo.

---

## Bloque B — Cuentas y dominio 🙋

Nada de esto lo puedo hacer yo. Es lo que más tarda, así que conviene arrancar
por acá.

- [x] **Dominio `odontocampus.com.ar`** ✅ obtenido
- [ ] 👥 **Decidir a nombre de quién queda.** Si va a nombre de una persona y esa
      persona se aleja de FOE, la agrupación pierde el dominio. Esto se decide
      antes de tramitarlo, no después.
- [ ] **Resend: agregar `odontocampus.com.ar`** — la cuenta ya existe y está
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
- [ ] CloudPanel → **Create a Static HTML Site** para `odontocampus.com.ar`,
      y después agregarle `www.odontocampus.com.ar` en *Domains*
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

- [x] `config.js` — URL de la API y `ANON_KEY`, con apagado automático
- [x] `api.js` — cliente propio: sesión, renovación de token, REST
- [x] `cripto.js` — PBKDF2 + AES-GCM, probado de punta a punta
- [x] `auth.js` — ingreso en dos pasos y panel de cuenta
- [x] `sync.js` — consentimiento, cifrado, mezcla local/remoto
- [x] `calculator.js` — avisa a la sincronización en cada cambio
- [x] Exportar mis datos (Ley 25.326)
- [ ] 🙋 Pegar la `ANON_KEY` real en `config.js` cuando exista el servidor
- [ ] Borrado de cuenta automático (hoy es por correo, y la interfaz lo dice)
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

Con el dominio y el repositorio listos, quedan tres pasos tuyos:

1. **Resend → Add domain** `odontocampus.com.ar` y cargar SPF y DKIM. Los
   registros tardan en propagar: conviene largarlo ya aunque falte el resto.
2. **Los dos sitios en CloudPanel** (Static HTML Site + Reverse Proxy) y sus
   certificados.
3. **Supabase** en `/opt/supabase`, con el override de puertos.

La guía completa está en
[`despliegue-cloudpanel.md`](despliegue-cloudpanel.md).

Del lado del código, lo que queda depende de que exista el servidor: pegar la
`ANON_KEY` en `config.js`, la CSP en el vhost y el borrado de cuenta.
