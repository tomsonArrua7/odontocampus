# OdontoCampus — FOE Odontología UNLP

Plataforma estudiantil de la Facultad de Odontología de la UNLP.
Sitio estático: HTML, CSS y JavaScript sin dependencias de compilación.

---

## Cómo levantarlo

```bash
python run_server.py
```

Abre `http://localhost:8080/index.html`. Para usar otro puerto: `python run_server.py 3000`.

El servidor de desarrollo envía cabeceras `no-cache`: al editar un CSS o un JS y
recargar, siempre se ve la última versión. Sin eso uno termina depurando un
archivo viejo que el navegador guardó.

> No abras `index.html` con doble clic. Bajo `file://` el navegador bloquea la
> lectura de las planillas y no vas a ver mesas ni reválidas.

---

## Arquitectura de la información

La navegación está organizada por **momento de uso**, no por tipo de contenido.
Un estudiante no piensa "quiero ir a la sección Reválidas": piensa "¿cuándo
rindo?", "¿qué llevo a la clínica?", "¿cómo vengo?".

| Destino | Pestañas internas | La pregunta que responde |
|---|---|---|
| **Inicio** | — | ¿Qué me toca ahora? |
| **Cuándo rindo** | Mesas de finales · Reválidas y actualizaciones | ¿Cuándo y dónde rindo? |
| **Cursada y clínica** | Historias clínicas · Instrumental · Bolsa de compra y venta | ¿Qué necesito para atender? |
| **Biblioteca** | — | ¿Con qué estudio? |
| **Mi promedio** | — | ¿Cómo vengo? |

### Rutas

El estado vive en el hash: `#seccion` o `#seccion/pestaña`.
Ejemplos: `#fechas/revalidas`, `#cursada/instrumental`, `#carrera`.

Los enlaces de versiones anteriores (`#mesas`, `#calculadora`, `#historias`,
`#carrera/permutas`…) siguen funcionando: hay una tabla de alias en `js/app.js`
y la URL se normaliza sola. Si alguien guardó un enlace o lo compartió por
WhatsApp, no se le rompe.

---

## Estructura de archivos

```
public/               EL SITIO. Es exactamente lo que se copia a htdocs/
  index.html          Marcado único de toda la aplicación
  css/
    01-tokens.css     Sistema de diseño: color, tipografía, espaciado, tema oscuro
    02-base.css       Reset, tipografía base, foco visible, accesibilidad
    03-components.css Botones, formularios, tarjetas, pestañas, modales, estados
    04-sections.css   Encabezado, hero, y cada sección de la aplicación
    05-responsive.css Puntos de corte, alto contraste
    06-cuentas.css    Acceso, panel de cuenta, entrada a Mi promedio
  js/
    config.js         URL de la API y clave pública. Lo único que cambia por entorno
    core.js           Núcleo: escapado, DOM, acciones, modales, pestañas, tema, fechas
    api.js            Cliente de Supabase: sesión, renovación de token, REST
    data.js           Contenido editable a mano (noticias, plan, apuntes, bolsa…)
    live_sheets.js    Sincronización con las planillas de mesas y reválidas
    calculator.js     Promedio y avance de carrera (sólo calcula y dibuja)
    carrera.js        Mi promedio con cuenta: acceso, guardado, copia local
    auth.js           Registro, ingreso con contraseña, recuperación, Mi cuenta
    chatbot.js        OdontoBot (buscador de preguntas frecuentes)
    app.js            Router, inicio, historias clínicas, biblioteca, buscador

infra/                Todo lo del servidor
  supabase/           Compose de ajustes y esquema SQL con RLS
  backup/             Backup cifrado y su restauración

docs/                 plan.md, arquitectura.md, despliegue-cloudpanel.md
run_server.py         Servidor de desarrollo (sirve public/)
```

**Por qué `public/` está separado:** es la única carpeta que se sube al
servidor. Así `docs/` e `infra/` —que incluyen el esquema de la base y los
procedimientos— no pueden quedar expuestos al navegador por un error de
configuración. El servidor clona el repositorio entero, pero la raíz web
apunta a `public/`: `.git/`, `docs/` e `infra/` quedan fuera del alcance
del navegador.

El orden de los `<script>` importa: `config.js` y `core.js` primero,
`app.js` último.

### Al cambiar un CSS o un JS, subí el `?v=` de `index.html`

El Vhost del servidor manda **diez años de caché** para `css/` y `js/`. Sin
cambiar la dirección del archivo, Cloudflare y el navegador de cada estudiante
siguen usando la copia vieja: el sitio nuevo carga con los archivos anteriores.

Por eso cada `<link>` y cada `<script>` llevan `?v=AAAAMMDD`. Al publicar un
cambio se sube esa fecha **en todas las líneas**. Lo mismo vale para las
plantillas de correo, cuyo `?v=` está en
`infra/supabase/docker-compose.override.yml`.

**Pasó de verdad:** el día que se publicaron las cuentas con contraseña, el
`index.html` nuevo quedó cargando el `config.js` viejo —con la clave en
`PENDIENTE`— y el ingreso no aparecía por ningún lado.

---

## Sistema de diseño

**Todo color, tamaño de texto y espaciado sale de `css/01-tokens.css`.**
Si necesitás un valor nuevo, agregá un token; no escribas un `#hex` suelto en
otro archivo. Es la única forma de que el tema oscuro siga funcionando y de que
el conjunto no se desarme con el tiempo.

### Color

- `--accent` (#E6007E) para superficies y fondos.
- `--accent-text` (#C4006B) para **texto y enlaces**: el magenta institucional
  sobre blanco da 4.5:1, justo en el límite de AA. La variante oscura da 5.9:1 y
  se lee cómoda en párrafo largo.
- `--brand-surface` para las superficies oscuras de marca (encabezado, hero,
  pie, panel del promedio). Siguen oscuras en ambos temas: son la firma visual.
- Estados: `--success`, `--warning`, `--danger`, `--info`, cada uno con su `-bg`.

### Tipografía

Escala de `--fs-xs` (13px) a `--fs-5xl`. **El piso es 13px.** La versión
anterior bajaba a 11px en insignias y metadatos: ilegible en un celular, en un
pasillo, con poca luz.

### Tema oscuro

Se activa por preferencia del sistema y por elección explícita (el botón del
encabezado, que guarda en `localStorage`). Un script mínimo en el `<head>`
aplica el tema antes del primer pintado para que no haya destello blanco.

### Movimiento

Todas las animaciones se anulan bajo `prefers-reduced-motion: reduce`.

---

## Cuentas de usuario

El backend es **Supabase autoalojado**. Detalles en
[`docs/despliegue-cloudpanel.md`](docs/despliegue-cloudpanel.md).

### El sitio funciona sin backend

Mientras `js/config.js` tenga `publishableKey: "PENDIENTE"`, todo lo relativo a
cuentas se apaga solo: no aparece el botón de ingresar y Mi promedio avisa que
todavía no está disponible. **Nada de lo público —mesas, reválidas, historias
clínicas, instrumental, biblioteca— depende de la cuenta.** Si el servidor se
cae, se sigue pudiendo consultar a qué hora rendís.

### Cuentas con contraseña

Se entra con correo y contraseña. El correo se usa dos veces: para confirmar
la cuenta, una sola vez, y para elegir una contraseña nueva si se olvidó. Los
dos correos traen un botón que abre el sitio con un token, y `auth.js` lo
canjea (el porqué está al principio de ese archivo).

### Mi promedio pide cuenta

Es lo único del sitio que la pide, porque guarda datos de la persona. Las
materias viven en la tabla `materias_cursadas`, una fila por materia,
protegidas por RLS: nadie ve las de otra persona. Quien administra el servidor
sí puede leerlas, y se le dice así a cada estudiante antes de su primera
carga.

`carrera.js` guarda además una copia por usuario en el navegador, para que el
promedio se vea sin señal y ningún cambio se pierda si se corta el wifi: cada
cambio queda pendiente hasta que el servidor confirma que lo guardó. Al cerrar
sesión, esa copia se borra.

### La clave publicable es pública y está bien

La `SUPABASE_PUBLISHABLE_KEY` (empieza con `sb_publishable_`) va en `config.js`,
dentro del repositorio, a la vista de cualquiera. Así está pensado Supabase. **Lo que protege los datos no es un secreto: son las
políticas RLS** de `infra/supabase/sql/001_esquema.sql`.

Las que nunca van al repositorio ni al navegador son la `SUPABASE_SECRET_KEY`
y la `SERVICE_ROLE_KEY`: saltean todas las políticas y viven sólo en el `.env`
del servidor. `config.js` se niega a encender las cuentas si detecta una clave
que no empiece con `sb_publishable_`.

---

## Reglas para tocar el código

### 1. Nada entra al DOM sin escapar

Los datos de mesas y reválidas los edita gente ajena a este repositorio, y las
publicaciones de la bolsa las escribe cualquier estudiante. Todo
eso se inserta con `innerHTML`.

```js
var esc = OdontoUI.esc;
html += "<h3>" + esc(item.materia) + "</h3>";                  // texto
html += '<button data-id="' + OdontoUI.escAttr(item.id) + '">'; // atributo
html += '<a href="' + OdontoUI.safeUrl(enlace) + '">';          // URL
```

Sin esto, una celda de la planilla con `<img onerror=...>` se ejecuta en el
navegador de quien mire la página.

### 2. Nada de `onclick` en el HTML

Se usa delegación por `data-action`:

```html
<button type="button" data-action="verHC" data-id="hc-operatoria">Ver</button>
```

```js
OdontoUI.registerActions({
  verHC: function (data) { OdontoApp.verVistaPreviaHC(data.id); }
});
```

Mantiene la lógica fuera del marcado y deja la puerta abierta a una
Content-Security-Policy estricta cuando el sitio se publique.

### 3. Todo control necesita nombre accesible

Etiqueta visible cuando se puede, `visually-hidden` cuando no entra en el
diseño. Un `placeholder` no es una etiqueta: desaparece al escribir.

### 4. Los estados vacíos explican y ofrecen salida

Usá `OdontoUI.emptyState({ icon, title, text, action, actionLabel })`. Nunca
dejes una zona en blanco sin decir qué pasó y qué se puede hacer.

### 5. Los cambios de contenido dinámico se anuncian

`OdontoUI.announce("32 mesas")` para quien no ve la pantalla. Filtrar sin
anunciar es una acción silenciosa.

---

## Utilidades de `core.js`

| Función | Para qué |
|---|---|
| `esc`, `escAttr`, `safeUrl` | Escapado seguro |
| `$`, `$$`, `on`, `debounce` | DOM y eventos |
| `registerActions` | Registrar manejadores de `data-action` |
| `openModal`, `closeModal` | Modales con foco atrapado y restituido |
| `initTabs` | Pestañas con patrón ARIA y flechas del teclado |
| `theme` | Tema claro/oscuro persistente |
| `toast`, `announce` | Avisos visibles y para lector de pantalla |
| `parseFechaTexto`, `cuandoTexto`, `diasHasta` | Fechas en lenguaje humano |
| `emptyState`, `skeletonGrid` | Estados vacío y de carga |
| `copiar` | Portapapeles con respaldo para contextos no seguros |
| `normalizar` | Comparar texto sin acentos ni mayúsculas |

---

## Las planillas

`js/live_sheets.js` lee dos planillas publicadas de Google Sheets vía CSV.
Los IDs están al principio del archivo:

```js
sheetIdMesas: "1NC_lABOKN0w-...",
sheetIdRevalidas: "1KWy04FseDtScAqYQ3kFopI_...",
```

Formato esperado de cada fila:

| A | B | C | D | E |
|---|---|---|---|---|
| Materia | Horario | Modalidad / aula | ID de Zoom | Código de acceso |

Las filas cuya primera celda es un día (`Lunes 24 de agosto`, `27/8/2026`) se
toman como encabezado de jornada y todo lo que sigue queda bajo esa fecha.

**Importante:** las columnas se leen por posición. Si una celda queda vacía, se
respeta el hueco. (En la versión anterior las celdas vacías se descartaban y
todo se corría a la izquierda: había tarjetas que decían *"Horario: Zoom"*.)
Cuando la columna del horario trae una palabra de modalidad en vez de una hora,
se interpreta como modalidad y el horario queda como "a confirmar".

Si la planilla no responde, se usa la última copia guardada en `localStorage` y
el banner lo dice con la hora de esa copia. Si tampoco hay copia, se muestran
datos de ejemplo, también avisados.

El filtro de días se arma solo con los días que la planilla realmente trae.

---

## Pendientes conocidos

- **Biblioteca**: las fichas de apuntes existen pero no hay archivos detrás. El
  botón avisa que el material todavía no está subido.
- **Font Awesome** se carga completo desde un CDN (~300 KB). Cuando el conjunto
  de íconos esté estable, conviene reemplazarlo por un sprite SVG propio.
- **Datos de contacto**: el WhatsApp y el email de `js/data.js` y del pie de
  página son de ejemplo. Cambialos antes de publicar.
- **Fechas de trámites** (`fechasClave` en `js/data.js`) están escritas a mano y
  hay que actualizarlas cada cuatrimestre.

---

## Decisiones que conviene no revertir sin pensarlo

- **OdontoBot no se llama "IA".** Busca palabras clave en una lista escrita a
  mano. Anunciarlo como inteligencia artificial hacía que se le preguntara lo
  que no puede responder, y cada fallo restaba credibilidad al resto del sitio.
- **El chat muestra un descargo permanente.** Da dosis de anestésicos y pautas
  de antibióticos a estudiantes que atienden pacientes reales.
- **Las jornadas ya pasadas van al final y atenuadas**, no arriba. Se conservan
  para consulta, pero no compiten con lo que todavía importa.
- **El promedio no inventa notas.** Al marcar una materia como aprobada, la
  versión anterior le asignaba un 7 por defecto. Ahora se pide la nota real.
- **El pie de página aclara que ante una diferencia vale lo que publica la
  facultad.** Es una plataforma estudiantil, no la fuente oficial.
