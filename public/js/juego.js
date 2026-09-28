/* ==========================================================================
   ODONTOCAMPUS — ODONTOPREGUNTADOS
   Preguntas de opción múltiple para practicar, sobre todo de las materias
   del ciclo básico.

   --------------------------------------------------------------------------
   DE DÓNDE SALEN LAS PREGUNTAS

   De una planilla de Google que carga FOE, igual que las mesas: quien
   escribe las preguntas no necesita tocar el código, y corregir un error es
   editar una celda. La planilla se configura desde el panel de
   administración (clave `planilla_preguntas`).

   Formato de la planilla (una fila por pregunta, con encabezado):
     Materia | Pregunta | Opción A | Opción B | Opción C | Opción D | Correcta | Explicación
   "Correcta" es la letra (A, B, C o D) o el texto exacto de la opción.
   Las columnas se ubican por su título, así que el orden puede cambiar.

   --------------------------------------------------------------------------
   POR QUÉ NO PIDE CUENTA

   Practicar no guarda nada de nadie: el puntaje queda en este navegador. Es
   lo único de Mi carrera que se puede usar sin cuenta, a propósito: es la
   puerta de entrada más fácil.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var esc = UI.esc, escAttr = UI.escAttr;

  var POR_RONDA = 10;
  var CLAVE_CACHE = "odontocampus_preguntas_v1";
  var CLAVE_PUNTAJES = "odontocampus_puntajes_v1";
  var LETRAS = ["A", "B", "C", "D"];

  function leerJSON(clave) {
    try {
      var crudo = localStorage.getItem(clave);
      var datos = crudo ? JSON.parse(crudo) : null;
      return datos && typeof datos === "object" ? datos : null;
    } catch (e) { return null; }
  }

  function escribirJSON(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
  }

  /** Mezcla sin sesgo (Fisher-Yates). */
  function mezclar(lista) {
    var copia = lista.slice();
    for (var i = copia.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copia[i]; copia[i] = copia[j]; copia[j] = t;
    }
    return copia;
  }

  var OdontoJuego = {
    preguntas: null,     // null: sin cargar todavía
    cargando: false,
    error: null,
    materia: "todas",
    ronda: [],
    indice: 0,
    aciertos: 0,
    respondida: false,

    init: function () {
      var self = this;

      UI.registerActions({
        juegoEmpezar: function () { self.empezar(); },
        juegoResponder: function (data) { self.responder(Number(data.opcion)); },
        juegoSiguiente: function () { self.siguiente(); },
        juegoSalir: function () { self.pintarInicio(); },
        juegoRecargar: function () { self.preguntas = null; self.error = null; self.mostrar(); }
      });

      var select = document.getElementById("juego-materia");
      if (select) {
        UI.on(select, "change", function () {
          self.materia = select.value;
          self.pintarInicio();
        });
      }

      // Las teclas 1 a 4 responden: practicar de a veinte preguntas con el
      // mouse cansa.
      UI.on(document, "keydown", function (event) {
        if (!self.jugando() || self.respondida) return;
        if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
        var n = "1234".indexOf(event.key);
        if (n === -1) return;
        var pregunta = self.ronda[self.indice];
        if (!pregunta || n >= pregunta.opciones.length) return;
        event.preventDefault();
        self.responder(n);
      });
    },

    visible: function () {
      var panel = document.getElementById("panel-juego");
      return !!panel && !panel.hidden;
    },

    jugando: function () {
      return this.visible() && !!this.ronda.length && this.indice < this.ronda.length;
    },

    /* ====================================================================
       CARGA DE LA PLANILLA
       ==================================================================== */
    configuracion: function () {
      var sheets = global.OdontoLiveSheets;
      return sheets ? sheets.planilla("planilla_preguntas") : { sheetId: "", gid: "0" };
    },

    mostrar: function () {
      var self = this;
      if (this.preguntas || this.cargando) { this.pintar(); return; }

      var cfg = this.configuracion();
      if (!cfg.sheetId) {
        // Puede que la configuración todavía no haya llegado: se usa lo guardado.
        var guardadas = leerJSON(CLAVE_CACHE);
        this.preguntas = guardadas && guardadas.preguntas ? guardadas.preguntas : [];
        this.pintar();
        return;
      }

      this.cargando = true;
      this.pintar();

      fetch(global.OdontoLiveSheets.endpoint(cfg.sheetId, cfg.gid))
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          if ((res.headers.get("content-type") || "").indexOf("text/csv") === -1) {
            throw new Error("La planilla de preguntas no está compartida para ver con el enlace.");
          }
          return res.text();
        })
        .then(function (csv) {
          self.preguntas = self.parsear(csv);
          self.cargando = false;
          self.error = null;
          escribirJSON(CLAVE_CACHE, { preguntas: self.preguntas, fecha: Date.now() });
          self.pintar();
        })
        .catch(function (error) {
          self.cargando = false;
          var guardadas = leerJSON(CLAVE_CACHE);
          if (guardadas && guardadas.preguntas && guardadas.preguntas.length) {
            self.preguntas = guardadas.preguntas;
            self.error = null;
          } else {
            self.preguntas = [];
            self.error = error.message;
          }
          self.pintar();
        });
    },

    /**
     * Lee la planilla ubicando las columnas por su título. Descarta en
     * silencio las filas incompletas: una pregunta a medio escribir es peor
     * que una pregunta menos.
     */
    parsear: function (csv) {
      var sheets = global.OdontoLiveSheets;
      var filas = sheets.splitCSV(csv);
      var cols = null;
      var preguntas = [];

      filas.forEach(function (fila) {
        var celdas = fila.map(function (c) { return (c || "").replace(/\s+/g, " ").trim(); });
        if (!celdas.some(Boolean)) return;

        var normal = celdas.map(function (c) { return UI.normalizar(c); });

        if (!cols) {
          var iPregunta = normal.indexOf("pregunta");
          if (iPregunta === -1) return; // todavía no llegamos al encabezado
          cols = { pregunta: iPregunta, opciones: [], materia: -1, correcta: -1, explicacion: -1 };
          normal.forEach(function (texto, i) {
            if (texto === "materia" || texto === "tema") cols.materia = i;
            else if (/^opcion ?[abcd]$/.test(texto) || /^[abcd]$/.test(texto) ||
                     /^respuesta ?[abcd]$/.test(texto)) cols.opciones.push(i);
            else if (texto === "correcta" || texto === "respuesta correcta" || texto === "correcto") cols.correcta = i;
            else if (texto === "explicacion" || texto === "por que" || texto === "justificacion") cols.explicacion = i;
          });
          return;
        }

        var enunciado = celdas[cols.pregunta];
        if (!enunciado) return;

        var opciones = cols.opciones.map(function (i) { return celdas[i] || ""; }).filter(Boolean);
        if (opciones.length < 2) return;

        var bruta = celdas[cols.correcta] || "";
        var correcta = -1;
        var letra = UI.normalizar(bruta).replace(/[^a-d]/g, "");
        if (letra.length === 1) correcta = LETRAS.indexOf(letra.toUpperCase());
        if (correcta === -1 || correcta >= opciones.length) {
          opciones.forEach(function (op, i) {
            if (UI.normalizar(op) === UI.normalizar(bruta)) correcta = i;
          });
        }
        if (correcta === -1 || correcta >= opciones.length) return;

        preguntas.push({
          materia: cols.materia !== -1 ? (celdas[cols.materia] || "General") : "General",
          enunciado: enunciado,
          opciones: opciones,
          correcta: correcta,
          explicacion: cols.explicacion !== -1 ? (celdas[cols.explicacion] || "") : ""
        });
      });

      return preguntas;
    },

    materias: function () {
      var vistas = {};
      (this.preguntas || []).forEach(function (p) { vistas[p.materia] = (vistas[p.materia] || 0) + 1; });
      return Object.keys(vistas).sort(function (a, b) { return a.localeCompare(b, "es"); })
        .map(function (nombre) { return { nombre: nombre, cantidad: vistas[nombre] }; });
    },

    delTema: function () {
      var materia = this.materia;
      return (this.preguntas || []).filter(function (p) {
        return materia === "todas" || p.materia === materia;
      });
    },

    /* ====================================================================
       PUNTAJES (en este navegador)
       ==================================================================== */
    puntajes: function () {
      return leerJSON(CLAVE_PUNTAJES) || {};
    },

    guardarPuntaje: function (aciertos, total) {
      var todos = this.puntajes();
      var actual = todos[this.materia] || { mejor: 0, rondas: 0 };
      actual.rondas += 1;
      actual.mejor = Math.max(actual.mejor, Math.round((aciertos / total) * 100));
      todos[this.materia] = actual;
      escribirJSON(CLAVE_PUNTAJES, todos);
      return actual;
    },

    /* ====================================================================
       PARTIDA
       ==================================================================== */
    empezar: function () {
      var disponibles = this.delTema();
      if (!disponibles.length) return;

      this.ronda = mezclar(disponibles).slice(0, POR_RONDA).map(function (pregunta) {
        // Las opciones se mezclan en cada partida: si siempre es la B, se
        // aprende la letra y no la respuesta.
        var orden = mezclar(pregunta.opciones.map(function (texto, i) { return { texto: texto, i: i }; }));
        return {
          materia: pregunta.materia,
          enunciado: pregunta.enunciado,
          explicacion: pregunta.explicacion,
          opciones: orden.map(function (o) { return o.texto; }),
          correcta: orden.map(function (o) { return o.i; }).indexOf(pregunta.correcta)
        };
      });

      this.indice = 0;
      this.aciertos = 0;
      this.respondida = false;
      this.pintarPregunta();
    },

    responder: function (opcion) {
      if (this.respondida) return;
      var pregunta = this.ronda[this.indice];
      if (!pregunta || opcion < 0 || opcion >= pregunta.opciones.length) return;

      this.respondida = true;
      pregunta.elegida = opcion;
      if (opcion === pregunta.correcta) {
        this.aciertos++;
        UI.vibrar(12);
      } else {
        UI.vibrar([30, 50, 30]);
      }
      this.pintarPregunta();

      var siguiente = document.getElementById("juego-siguiente");
      if (siguiente) siguiente.focus();
    },

    siguiente: function () {
      this.indice++;
      this.respondida = false;
      if (this.indice >= this.ronda.length) this.pintarResultado();
      else this.pintarPregunta();
    },

    /* ====================================================================
       PANTALLAS
       ==================================================================== */
    pintar: function () {
      if (this.jugando()) this.pintarPregunta();
      else this.pintarInicio();
    },

    caja: function () {
      return document.getElementById("juego-caja");
    },

    pintarInicio: function () {
      var cont = this.caja();
      if (!cont) return;

      this.ronda = [];
      var select = document.getElementById("juego-materia");
      var controles = document.getElementById("juego-controles");

      if (this.cargando) {
        if (controles) controles.hidden = true;
        cont.innerHTML = '<div class="juego-estado">' + UI.icono("cargando", "ic-gira") +
          "<p>Buscando las preguntas…</p></div>";
        return;
      }

      if (this.error) {
        if (controles) controles.hidden = true;
        cont.innerHTML = '<div class="juego-estado">' + UI.icono("enchufe") +
          "<h3>No pudimos traer las preguntas</h3><p>" + esc(this.error) + "</p>" +
          '<button type="button" class="btn btn-secondary" data-action="juegoRecargar">' +
          UI.icono("rotar") + " Probar de nuevo</button></div>";
        return;
      }

      if (!this.preguntas || !this.preguntas.length) {
        if (controles) controles.hidden = true;
        var esAdmin = global.OdontoAdmin && global.OdontoAdmin.esAdmin;
        cont.innerHTML = '<div class="juego-estado">' + UI.icono("pregunta") +
          "<h3>Todavía no hay preguntas cargadas</h3>" +
          "<p>Odontopreguntados lee las preguntas de una planilla de FOE. Cuando la carguen, " +
          "vas a poder practicar desde acá.</p>" +
          (esAdmin
            ? '<button type="button" class="btn btn-magenta" data-action="ir" data-destino="admin/planillas">' +
              "Cargar la planilla</button>"
            : "") +
          "</div>";
        return;
      }

      // Desplegable de materias, con cuántas preguntas tiene cada una.
      if (select && select.options.length <= 1) {
        select.innerHTML = '<option value="todas">Todas las materias (' + this.preguntas.length + ")</option>" +
          this.materias().map(function (m) {
            return '<option value="' + escAttr(m.nombre) + '">' + esc(m.nombre) + " (" + m.cantidad + ")</option>";
          }).join("");
        select.value = this.materia;
      }
      if (controles) controles.hidden = false;

      var disponibles = this.delTema().length;
      var puntaje = this.puntajes()[this.materia];

      cont.innerHTML =
        '<div class="juego-inicio">' +
          "<p class=\"juego-lead\">Diez preguntas al azar, con la explicación al lado de cada respuesta. " +
          "No se guarda nada: es para practicar.</p>" +
          '<p class="juego-dato">' + esc(UI.plural(disponibles, "pregunta")) + " disponible" +
            (disponibles === 1 ? "" : "s") +
            (puntaje ? " · tu mejor ronda: " + puntaje.mejor + "%" : "") + "</p>" +
          '<button type="button" class="btn btn-magenta btn-lg" data-action="juegoEmpezar"' +
            (disponibles ? "" : " disabled") + ">" +
            UI.icono("diente") + " Empezar" +
          "</button>" +
        "</div>";
    },

    pintarPregunta: function () {
      var cont = this.caja();
      var pregunta = this.ronda[this.indice];
      if (!cont || !pregunta) return;

      var controles = document.getElementById("juego-controles");
      if (controles) controles.hidden = true;

      var respondida = this.respondida;
      var avance = (this.indice + (respondida ? 1 : 0)) / this.ronda.length * 100;

      var opciones = pregunta.opciones.map(function (texto, i) {
        var clases = ["juego-opcion"];
        if (respondida && i === pregunta.correcta) clases.push("es-correcta");
        else if (respondida && i === pregunta.elegida) clases.push("es-incorrecta");
        return (
          "<li>" +
            '<button type="button" class="' + clases.join(" ") + '" data-action="juegoResponder" ' +
                    'data-opcion="' + i + '"' + (respondida ? " disabled" : "") + ">" +
              '<span class="juego-letra" aria-hidden="true">' + LETRAS[i] + "</span>" +
              "<span>" + esc(texto) + "</span>" +
            "</button>" +
          "</li>"
        );
      }).join("");

      var acierto = respondida && pregunta.elegida === pregunta.correcta;

      cont.innerHTML =
        '<div class="juego-cabecera">' +
          "<p>Pregunta " + (this.indice + 1) + " de " + this.ronda.length +
            ' · <span class="juego-aciertos">' + this.aciertos + " correctas</span></p>" +
          '<div class="juego-barra"><span style="width:' + avance + '%"></span></div>' +
        "</div>" +
        '<article class="juego-pregunta">' +
          '<p class="juego-materia">' + esc(pregunta.materia) + "</p>" +
          "<h3>" + esc(pregunta.enunciado) + "</h3>" +
          '<ul class="juego-opciones">' + opciones + "</ul>" +
          (respondida
            ? '<div class="juego-respuesta ' + (acierto ? "es-bien" : "es-mal") + '" role="status">' +
                "<p><strong>" + (acierto ? "Correcto" : "No era esa") + ".</strong> " +
                (acierto ? "" : "La respuesta es " + esc(pregunta.opciones[pregunta.correcta]) + ". ") +
                esc(pregunta.explicacion) + "</p>" +
                '<button type="button" class="btn btn-magenta" id="juego-siguiente" data-action="juegoSiguiente">' +
                  (this.indice + 1 >= this.ronda.length ? "Ver resultado" : "Siguiente") +
                  UI.icono("flecha-der") +
                "</button>" +
              "</div>"
            : '<p class="juego-ayuda">Tocá una opción, o usá las teclas 1 a ' + pregunta.opciones.length + ".</p>") +
        "</article>";
    },

    pintarResultado: function () {
      var cont = this.caja();
      if (!cont) return;

      var total = this.ronda.length;
      var porcentaje = Math.round((this.aciertos / total) * 100);
      var puntaje = this.guardarPuntaje(this.aciertos, total);

      var mensaje = porcentaje === 100 ? "Impecable."
        : porcentaje >= 70 ? "Vas bien."
        : porcentaje >= 40 ? "Ahí va: repasá las que fallaste."
        : "Esta materia pide otra vuelta de carpeta.";

      var falladas = this.ronda.filter(function (p) { return p.elegida !== p.correcta; });

      cont.innerHTML =
        '<div class="juego-resultado">' +
          '<p class="juego-puntaje">' + this.aciertos + " / " + total + "</p>" +
          "<p class=\"juego-lead\">" + esc(mensaje) + " Tu mejor ronda en este tema: " + puntaje.mejor + "%.</p>" +
          (falladas.length
            ? "<h3>Para repasar</h3><ul class=\"juego-repaso\">" + falladas.map(function (p) {
                return "<li><strong>" + esc(p.enunciado) + "</strong><small>" +
                  esc(p.opciones[p.correcta]) + (p.explicacion ? " — " + esc(p.explicacion) : "") + "</small></li>";
              }).join("") + "</ul>"
            : "") +
          '<div class="juego-acciones">' +
            '<button type="button" class="btn btn-magenta" data-action="juegoEmpezar">Jugar otra ronda</button>' +
            '<button type="button" class="btn btn-secondary" data-action="juegoSalir">Cambiar de materia</button>' +
          "</div>" +
        "</div>";

      UI.announce("Terminaste con " + this.aciertos + " de " + total + " correctas.");
      if (porcentaje === 100) this.festejar();
    },

    /** Ronda perfecta: una lluvia corta de piezas, con los colores de marca. */
    festejar: function () {
      var quieto = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (quieto) return;
      UI.vibrar([15, 40, 15, 40, 30]);

      var capa = document.createElement("div");
      capa.className = "festejo";
      capa.setAttribute("aria-hidden", "true");
      var colores = ["var(--accent)", "var(--text)", "var(--success)", "var(--on-brand-accent)"];
      var piezas = "";
      for (var i = 0; i < 46; i++) {
        piezas += '<i style="left:' + (Math.random() * 100).toFixed(1) + "%;" +
          "background:" + colores[i % colores.length] + ";" +
          "animation-delay:" + (Math.random() * 0.35).toFixed(2) + "s;" +
          "--dur-caida:" + (1.2 + Math.random() * 0.9).toFixed(2) + "s;" +
          "--dx:" + ((Math.random() - 0.5) * 160).toFixed(0) + "px;" +
          "--giro:" + (Math.random() * 900).toFixed(0) + 'deg"></i>';
      }
      capa.innerHTML = piezas;
      document.body.appendChild(capa);
      global.setTimeout(function () { capa.remove(); }, 2600);
    }
  };

  global.OdontoJuego = OdontoJuego;
})(window);
