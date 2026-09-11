# OdontoCampus — Arquitectura del backend

Documento de diseño. Todavía no hay código de backend: esto es lo que vamos a
construir y por qué.

**Decisiones tomadas por el equipo:**

| Decisión | Elegido |
|---|---|
| Verificación de identidad | Registro abierto con email verificado |
| Notas del promedio | Sincronizadas al servidor, con consentimiento explícito |
| Infraestructura | VPS propio, con un responsable técnico |
| Plataforma | CloudPanel + Supabase autoalojado |

> ### Qué cambió después de elegir CloudPanel + Supabase
>
> Este documento se escribió antes de saber que el servidor ya tenía
> CloudPanel y que íbamos a autoalojar Supabase. **Tres secciones quedaron
> desactualizadas.** El procedimiento real está en
> [`despliegue-cloudpanel.md`](despliegue-cloudpanel.md); acá queda anotado
> qué se reemplazó y por qué, para que nadie siga la versión vieja.
>
> | Este documento decía | Ahora es | Por qué |
> |---|---|---|
> | Caddy como proxy | **Nginx de CloudPanel** | CloudPanel ya gestiona Nginx y renueva Let's Encrypt solo. Agregar Caddy sería una segunda pieza compitiendo por los puertos 80 y 443. |
> | API propia en Node + Fastify (§7) | **Supabase autoalojado** | Auth con enlace por email, Postgres, RLS, Storage y REST ya resueltos. Menos código propio que mantener con un equipo que rota. |
> | Sesión en cookie `httpOnly` (§3) | **Token en `localStorage`** | El sitio es estático y las cookies `httpOnly` requieren una capa de servidor que renderice. Es un compromiso real, detallado en §7 del documento de despliegue. |
> | Permutas de comisión (§4, §10 fase 2) | **Dadas de baja** | Decisión del equipo: no van a la web. La tabla se quitó del esquema y el módulo del sitio. Queda en el historial de git por si alguna vez se retoma. |
>
> **Lo que NO cambió, y es lo más importante:** las notas se cifran en el
> navegador y la base no tiene columna `nota`, `promedio` ni `materia`
> (§5 de este documento). Con Supabase esa decisión se vuelve más necesaria,
> no menos: `SERVICE_ROLE_KEY` y el acceso directo a Postgres saltean RLS
> por completo.
>
> El cambio grande de mentalidad: **ya no hay una API nuestra que valide
> permisos.** El navegador habla directo con PostgREST usando una clave
> pública, y lo único que separa a un usuario de la base entera son las
> políticas RLS de `infra/supabase/sql/001_esquema.sql`.

---

## 1. Principio rector: el login suma, no tapa

Hoy el sitio dice en su portada *"Todo abierto, sin cuenta ni contraseña"*. Ese
es su mayor valor y la razón por la que se usa: alguien quiere saber a qué hora
rinde mañana y lo averigua en diez segundos.

**Meter login delante de eso empeora el producto.** La cuenta se ofrece en
contexto, nunca como barrera de entrada.

| Sigue público, sin cuenta | Requiere cuenta |
|---|---|
| Mesas de finales y reválidas | Promedio sincronizado entre dispositivos |
| Historias clínicas | Permutas reales |
| Instrumental por cátedra | Bolsa con identidad |
| Biblioteca (lectura) | Avisos "tu mesa es mañana" |
| Buscador global | Subir apuntes |

El botón de cuenta va en el encabezado, junto al de tema. El ofrecimiento de
sincronizar el promedio aparece **dentro de la sección del promedio**, cuando la
persona ya cargó al menos una nota. Nunca un modal al entrar.

---

## 2. Topología

```
                    Internet
                       │
                       ▼
              ┌─────────────────┐
              │  Caddy  :80/:443│   ← único puerto público
              └────────┬────────┘
                       │  red interna de Docker
          ┌────────────┴────────────┐
          ▼                         ▼
   ┌─────────────┐          ┌──────────────┐
   │  archivos   │          │  API Fastify │
   │  estáticos  │          │    :3000     │
   └─────────────┘          └──────┬───────┘
                                   │  red interna
                                   ▼
                            ┌──────────────┐
                            │ PostgreSQL16 │  sin `ports:` publicados
                            └──────┬───────┘
                                   │
                                   ▼
                          pg_dump diario → B2/S3
```

### La base de datos nunca se expone

Postgres **no lleva `ports:` en el `docker-compose`**. No escucha en ninguna
interfaz pública. Solo la API lo alcanza, por nombre de servicio dentro de la
red interna de Docker.

Hay bots escaneando el puerto 5432 de todo internet las 24 horas. Una base
Postgres accesible desde afuera con una contraseña débil se cifra y se pide
rescate en cuestión de días. No es una hipótesis: es la causa más común de
pérdida total en proyectos de este tamaño.

Para administrarla se usa un túnel SSH, no un puerto abierto:

```bash
ssh -p 5469 -L 5432:localhost:5432 deploy@servidor
```

### Por qué Caddy y no Nginx

Renueva el certificado HTTPS solo. La causa número uno de *"el sitio se cayó y
nadie sabe por qué"* en proyectos mantenidos por voluntarios es un certificado
vencido a los 90 días, un sábado, cuando la persona que sabe está rindiendo.

### Por qué Node + Fastify

El repositorio ya es JavaScript. Una sola lengua significa que quien mantiene el
frontend puede leer el backend. En un equipo que rota cada camada, eso importa
más que cualquier ventaja de rendimiento.

### Por qué no hay Redis

A esta escala no aporta nada y es una pieza más que se puede caer. Las sesiones
van en Postgres. Se agrega cuando duela, no antes.

---

## 3. Autenticación: enlace por email, sin contraseña

La persona pone su email, recibe un código de 6 dígitos (válido 10 minutos), lo
ingresa y queda con sesión iniciada.

**Por qué sin contraseña:**

1. Esta población va a reutilizar la contraseña de Instagram. Si nos filtran la
   base, les comprometemos otras cuentas. Si no guardamos contraseñas, ese
   riesgo directamente no existe.
2. Desaparece el "olvidé mi contraseña", que es donde se pierde más gente.
3. Con registro abierto, el email verificado es nuestra única señal de identidad
   real. El magic link la verifica por construcción: no hay un paso extra que
   la gente puede saltear.

**La sesión va en cookie `httpOnly` + `SameSite=Lax` + `Secure`.** No en
`localStorage`. Ya escapamos todo lo que entra al DOM, pero no apostamos la
sesión de nadie a que ese escapado sea perfecto para siempre.

---

## 4. Modelo de datos

```sql
-- Identidad -----------------------------------------------------------------
usuarios
  id                  uuid primary key
  email               citext unique not null
  email_verificado_at timestamptz
  nombre_visible      text                 -- puede ser un apodo
  anio_carrera        smallint
  estado              text  -- activo | suspendido | eliminado
  creado_at, actualizado_at timestamptz

sesiones
  id            uuid primary key
  usuario_id    uuid references usuarios
  token_hash    bytea not null    -- NUNCA el token en claro
  user_agent    text
  ip_hash       bytea             -- hash, no la IP cruda
  expira_at     timestamptz
  revocada_at   timestamptz

codigos_acceso                    -- los códigos de 6 dígitos
  id, usuario_id, codigo_hash bytea, expira_at, usado_at, intentos smallint

-- Cumplimiento legal --------------------------------------------------------
consentimientos
  id, usuario_id, tipo, version_texto, otorgado_at, revocado_at

-- Datos académicos ----------------------------------------------------------
notas_academicas
  usuario_id      uuid primary key references usuarios
  payload_cifrado bytea not null   -- blob opaco, ver §5
  actualizado_at  timestamptz

-- Funciones sociales --------------------------------------------------------
permutas
  id, usuario_id, materia, anio, comision_actual, comision_deseada,
  motivo, estado, creado_at, expira_at

publicaciones_bolsa
  id, usuario_id, titulo, categoria, precio_texto, estado_uso,
  ubicacion, estado, creado_at, expira_at

-- Moderación y trazabilidad -------------------------------------------------
reportes
  id, tipo_objeto, objeto_id, reportante_id, motivo, estado, creado_at

eventos_auditoria
  id, actor_id, accion, objeto, metadata jsonb, creado_at
```

Cuatro decisiones que conviene no revertir:

- **`token_hash`, no el token.** Si la base se filtra, nadie puede secuestrar
  sesiones con lo que sacó.
- **`ip_hash`, no la IP.** Alcanza para detectar abuso y guarda un dato personal
  menos en crudo.
- **`expira_at` en permutas y bolsa.** Las publicaciones viejas son lo que mata
  cualquier tablón de clasificados. Vencen a los 60 días con un botón de
  renovar.
- **`nombre_visible` puede ser un apodo.** No pedimos nombre real. No lo
  necesitamos y pedirlo espanta gente.

---

## 5. Las notas: cifradas y opacas para FOE

Esta es la parte políticamente delicada del proyecto.

FOE es una agrupación. Un estudiante puede razonablemente temer que sus notas
—o el hecho de que va lento— queden visibles para la conducción. **Si no
resolvemos eso con una garantía verificable, y no solo con una promesa en el pie
de página, la gente no va a cargar sus notas. Y tendría razón.**

La solución es técnica, no declarativa:

- Las notas se guardan como **un único blob cifrado por usuario**. La base no
  tiene una columna `nota`, ni `promedio`, ni `materia`.
- **No se puede construir un ranking de promedios ni una consulta del tipo
  "quiénes están atrasados", aunque alguien con acceso total a la base quisiera
  hacerlo.** No hay contra qué consultar.
- El panel de administración **no muestra notas**. No es que las oculte: no
  tiene forma de leerlas.
- Todo acceso administrativo a datos de un usuario queda en
  `eventos_auditoria`.

Cuando esto esté funcionando, hay que decirlo en la interfaz con esas palabras.
Es un argumento de confianza mucho más fuerte que "respetamos tu privacidad".

### El consentimiento

Hoy la pantalla del promedio promete: *"Tus notas quedan solo en este
dispositivo. No se envían a ningún servidor."* Eso es un compromiso asumido con
quien ya está usando la herramienta.

Migrar al servidor sin más lo rompe. El flujo tiene que ser:

1. La persona ya tiene notas cargadas localmente.
2. Aparece un ofrecimiento **en contexto**: "Guardalas en tu cuenta para verlas
   desde el celular y la notebook".
3. Explicación en una pantalla, sin letra chica: qué se guarda, cifrado, quién
   puede leerlo (nadie), cómo se borra.
4. Se registra en `consentimientos` con la versión del texto aceptado.
5. **Si no acepta, el promedio sigue funcionando exactamente igual que hoy.**
   La opción de no sincronizar no se degrada nunca.

### Derechos de la Ley 25.326

Argentina. Datos personales. Obligaciones reales, no formalismos:

- `GET /cuenta/exportar` → todo lo que tenemos sobre esa persona, en JSON.
- `DELETE /cuenta` → borrado real con 30 días de gracia, después irreversible.
- Finalidad declarada y responsable de datos identificado.

**Pendiente que no es técnico:** hay que definir *quién* es el responsable de
datos. ¿FOE como entidad? ¿Una persona física? Esto hay que resolverlo antes de
guardar la primera nota.

---

## 6. Anti-abuso: el precio del registro abierto

Con registro abierto, cualquiera con un email entra. La bolsa y las permutas
pasan a ser un vector de estafa. Las defensas van desde el día uno, no cuando
aparezca el primer problema:

| Medida | Por qué |
|---|---|
| Magic link obligatorio | Prueba que el email existe y es suyo |
| 3 códigos por email cada 15 min · 10 por IP por hora | Corta el envío masivo |
| Bloqueo de dominios desechables | Sube el costo de crear cuentas en serie |
| **Sin publicar en las primeras 24 h de la cuenta** | Fricción imperceptible para gente real, letal para spam automatizado |
| Máximo 5 publicaciones activas por cuenta | Evita el inundado del tablón |
| Botón de reportar en cada publicación → cola de moderación | La comunidad es el mejor detector |
| Vencimiento automático a 60 días | Publicaciones muertas fuera |
| **Cero pagos en la plataforma** | El sitio ya dice "coordiná en la facultad". Se refuerza. Sin dinero de por medio, la estafa posible es mucho menor |

Esto es un subsistema con trabajo propio, no una casilla de verificación. Hay
que asumir que alguien de FOE va a mirar la cola de reportes con alguna
regularidad.

---

## 7. La API (Fase 1)

```
POST   /auth/solicitar-codigo    { email }
POST   /auth/verificar           { email, codigo }  → cookie de sesión
POST   /auth/salir
GET    /auth/yo

GET    /perfil
PATCH  /perfil

POST   /notas/consentimiento
GET    /notas
PUT    /notas
DELETE /notas

GET    /cuenta/exportar
DELETE /cuenta
```

Todo con validación de esquema en el borde (Fastify + JSON Schema), límite de
tamaño de cuerpo y rate limiting por ruta.

---

## 8. Cambios en el frontend

Archivos nuevos:

- `js/api.js` — envoltorio de `fetch` con manejo de sesión y errores.
- `js/auth.js` — modal de acceso, estado de sesión en el encabezado.

Archivo modificado:

- `js/calculator.js` — capa de sincronización.

### Estrategia de sincronización: local primero

El uso real es en el pasillo de la facultad, con mala señal. **`localStorage`
sigue siendo la fuente de verdad para escribir**; el servidor es un espejo que
se actualiza cuando hay conexión.

Si la persona no tiene señal, la calculadora funciona igual. Si nunca inicia
sesión, funciona igual. La sincronización es una mejora, nunca un requisito.

Conflictos: última escritura gana, por materia, con marca de tiempo. Simple y
suficiente para este caso — una persona editando sus propias notas en dos
dispositivos rara vez toca la misma materia a la vez.

---

## 9. Estructura del repositorio

```
public/                 el sitio actual (index.html, css/, js/, FOE.jpg)
api/
  src/
    routes/
    plugins/
    db/migrations/
  package.json
infra/
  docker-compose.yml
  Caddyfile
  .env.example          nunca .env real en el repo
  backup/backup.sh
docs/
  arquitectura.md       este documento
  runbook.md            qué hacer cuando se rompe
```

---

## 10. Fases

### Fase 0 — Infraestructura, todavía sin cuentas

1. Dominio. `.com.ar` se tramita en nic.ar y **requiere CUIT argentino**:
   conviene resolver a nombre de quién antes de empezar.
2. VPS. Recomendación: **DigitalOcean São Paulo** (~40 ms de latencia hasta La
   Plata) por sobre Hetzner Alemania (~200 ms), aunque Hetzner sea más barato.
   2 vCPU / 4 GB alcanza y sobra.
3. Docker + Compose + Caddy sirviendo el sitio estático actual con HTTPS.
4. Deploy: `git push` → GitHub Actions → SSH → `docker compose up -d`.
5. **Backups desde el día cero**, aunque no haya datos que perder. Es la única
   forma de probar que el mecanismo funciona antes de necesitarlo.

Objetivo: probar la cañería antes de meterle agua.

### Fase 1 — Cuentas + el promedio

Una rebanada vertical completa: registro → acceso → guardar → leer → borrar,
sobre la función menos riesgosa del sistema.

### Fase 2 — Permutas reales

Es lo que hoy está genuinamente roto: cada persona ve solo sus propias
publicaciones porque viven en `localStorage`. Es la primera función que
**necesita** un servidor para existir.

### Fase 3 — Bolsa con identidad + avisos de mesa

Los avisos ("tu mesa es mañana") requieren un worker con tareas programadas y
cruzar las materias que la persona marcó como regulares contra la planilla.
Es, probablemente, la función que más va a hacer que la gente cree una cuenta.

### Fase 4 — Biblioteca con subida de archivos

La más pesada: almacenamiento de objetos, moderación y derechos de autor de
material de cátedra. Dejarla para el final es deliberado.

---

## 11. Costos

| Concepto | USD/mes |
|---|---|
| VPS 2 vCPU / 4 GB | 12 – 18 |
| Almacenamiento de backups (B2) | ~1 |
| Dominio | ~1,5 (prorrateado) |
| Envío de emails (Resend / Brevo, capa gratuita) | 0 al principio |
| **Total** | **~USD 20** |

---

## 12. El riesgo que no es técnico

Se eligió VPS propio con un responsable técnico. Es la opción de más control y
menor costo, y es razonable. Pero tiene un punto único de falla que no es un
servidor: **es una persona**.

Cuando esa persona se reciba —y se va a recibir— la plataforma se queda sin
nadie que sepa entrar. Es cómo mueren la mayoría de los proyectos estudiantiles.

Mitigación mínima, una tarde de trabajo:

1. **Dos personas con clave SSH** en el servidor desde el arranque. La segunda
   no necesita saber operar: necesita poder entrar.
2. **Credenciales en un gestor compartido** (Bitwarden alcanza y es gratis):
   dominio, VPS, base, servicio de email, storage de backups.
3. **`infra/` versionado en el repositorio.** Si el servidor se pierde entero,
   se levanta otro desde el `docker-compose` más el último backup.
4. **`docs/runbook.md`**: cómo desplegar, cómo restaurar un backup, cómo rotar
   credenciales, a quién llamar.
5. **Restauración probada una vez por cuatrimestre.** Un backup que nunca se
   restauró no es un backup: es una carpeta.

Recomiendo hacer los cinco puntos en la Fase 0, antes de que haya datos de nadie
en juego.

---

## 13. Preguntas abiertas

1. **¿Quién es el responsable de datos ante la Ley 25.326?** Hay que definirlo
   antes de guardar la primera nota.
2. **¿A nombre de quién va el dominio y el VPS?** Si van a nombre de una persona
   y esa persona se aleja de FOE, la agrupación pierde su plataforma.
3. **¿Quién mira la cola de moderación, y con qué frecuencia?** Con registro
   abierto, esto no es opcional.
4. **¿Qué pasa si la facultad pide que se baje algo?** Conviene tener una
   posición pensada antes de que ocurra, no durante.
