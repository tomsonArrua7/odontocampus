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
| **Mi carrera** | Mi promedio · Permutas de comisión | ¿Cómo vengo? |

### Rutas

El estado vive en el hash: `#seccion` o `#seccion/pestaña`.
Ejemplos: `#fechas/revalidas`, `#cursada/instrumental`, `#carrera/promedio`.

Los enlaces de la versión anterior (`#mesas`, `#calculadora`, `#historias`…)
siguen funcionando: hay una tabla de alias en `js/app.js`. Si alguien guardó un
enlace o lo compartió por WhatsApp, no se le rompe.

---

## Estructura de archivos

```
index.html            Marcado único de toda la aplicación
run_server.py         Servidor de desarrollo

css/
  01-tokens.css       Sistema de diseño: color, tipografía, espaciado, tema oscuro
  02-base.css         Reset, tipografía base, foco visible, utilidades de accesibilidad
  03-components.css   Botones, formularios, tarjetas, pestañas, modales, avisos, estados
  04-sections.css     Encabezado, hero, y cada sección de la aplicación
  05-responsive.css   Puntos de corte, alto contraste

js/
  core.js             Núcleo: escapado, DOM, acciones, modales, pestañas, tema, fechas
  data.js             Contenido editable a mano (noticias, plan, apuntes, bolsa…)
  live_sheets.js      Sincronización con las planillas de mesas y reválidas
  calculator.js       Promedio y avance de carrera
  permutas.js         Tablón de permutas de comisión
  chatbot.js          OdontoBot (buscador de preguntas frecuentes)
  app.js              Router, panel de inicio, historias clínicas, biblioteca, buscador
```

El orden de los `<script>` importa: `core.js` primero, `app.js` último.

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

## Reglas para tocar el código

### 1. Nada entra al DOM sin escapar

Los datos de mesas y reválidas los edita gente ajena a este repositorio, y las
publicaciones de la bolsa y de permutas las escribe cualquier estudiante. Todo
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

- **Permutas**: las publicaciones se guardan en `localStorage`, o sea que cada
  persona ve solo las propias más las de ejemplo. Para que la permuta sirva de
  verdad hace falta un backend compartido. La interfaz lo dice explícitamente en
  vez de aparentar una red que no existe.
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
