/* ==========================================================================
   ODONTOCAMPUS — ODONTOBOT
   Responde con lo que el sitio ya sabe: las preguntas frecuentes de FOE, la
   planilla de mesas, el plan de estudios y —si hay sesión— la agenda y el
   promedio de quien pregunta.

   Tres decisiones deliberadas:

   1. No se anuncia como "IA". No lo es: busca entre respuestas escritas a
      mano y consulta datos del propio sitio. Prometer menos y cumplir vale
      más que un nombre grandilocuente.

   2. Muestra un descargo permanente. Devuelve dosis de anestésicos y pautas
      de antibióticos a estudiantes que atienden pacientes reales: es material
      de estudio y no reemplaza al docente ni al prospecto.

   3. Cuando no sabe, lo dice y anota la consulta (sin quién la hizo) para que
      FOE vea qué falta escribir. Ver 007_consultas_del_bot.sql.

   --------------------------------------------------------------------------
   CÓMO BUSCA

   La versión anterior exigía que el tema apareciera tal cual dentro de la
   pregunta: con "amoxi" en vez de "amoxicilina" no encontraba nada. Ahora
   compara palabra por palabra, acepta principios de palabra y tolera una
   letra de diferencia, y suma puntos. Si dos respuestas quedan parejas,
   pregunta cuál en lugar de elegir a ciegas.

   Todo lo que escribe la persona se escapa antes de mostrarse. El formato
   (negrita, cursiva) se aplica después, sólo sobre texto que controla el
   sitio.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var esc = UI.esc, escAttr = UI.escAttr;

  function ahora() {
    return new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  }

  var BIENVENIDA =
    "¡Hola! Soy **OdontoBot**. Busco entre las preguntas frecuentes de FOE y en los datos del sitio.\n\n" +
    "Puedo ayudarte con:\n" +
    "• Cuándo se rinde una materia, según la planilla oficial\n" +
    "• Correlativas y año de cada materia del plan\n" +
    "• Dosis de anestésicos, antibióticos y protocolos clínicos\n" +
    "• Trámites en SIU Guaraní\n" +
    "• Tu agenda y tu promedio, si iniciaste sesión\n\n" +
    "¿Con qué arrancamos?";

  /* Palabras que aparecen en casi toda pregunta y no ayudan a distinguir. */
  var VACIAS = {
    que: 1, cual: 1, cuales: 1, como: 1, cuando: 1, donde: 1, para: 1, por: 1, con: 1, sin: 1,
    una: 1, uno: 1, unos: 1, unas: 1, los: 1, las: 1, del: 1, mis: 1, sus: 1, tus: 1,
    hay: 1, tengo: 1, tiene: 1, puedo: 1, sobre: 1, este: 1, esta: 1, esto: 1, eso: 1,
    the: 1, and: 1, hola: 1, saber: 1, quiero: 1, necesito: 1, favor: 1, gracias: 1,
    materia: 1, materias: 1
  };

  function palabras(texto) {
    return UI.normalizar(texto).split(/[^a-z0-9]+/).filter(function (p) {
      return p.length >= 3 && !VACIAS[p];
    });
  }

  /** ¿Son la misma palabra, con una letra de diferencia? */
  function casiIgual(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, fallas = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++fallas > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return fallas + (a.length - i) + (b.length - j) <= 1;
  }

  /** Dos palabras se parecen si una empieza como la otra ("amoxi"/"amoxicilina"). */
  function coincide(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.indexOf(a) === 0) return true;
    if (b.length >= 4 && a.indexOf(b) === 0) return true;
    return a.length >= 6 && b.length >= 6 && casiIgual(a, b);
  }

  function tieneAlguna(lista, patron) {
    return lista.some(function (p) { return patron.test(p); });
  }

  var OdontoBot = {
    mensajes: [],
    isOpen: false,

    init: function () {
      var self = this;

      this.mensajes = [{ remitente: "bot", texto: BIENVENIDA, hora: ahora() }];

      UI.registerActions({
        alternarChat: function () { self.toggleChat(); },
        sugerencia: function (data) { self.consultarPreguntaSugerida(data.texto); },
        botDesambiguar: function (data) { self.responderConIndice(Number(data.indice)); }
      });

      var form = document.getElementById("odontobot-form");
      if (form) {
        UI.on(form, "submit", function (event) {
          event.preventDefault();
          self.enviarMensaje();
        });
      }

      this.renderMensajes();
    },

    toggleChat: function () {
      var ventana = document.getElementById("odontobot-window");
      var boton = document.getElementById("odontobot-toggle-btn");
      if (!ventana) return;

      this.isOpen = !this.isOpen;
      ventana.classList.toggle("active", this.isOpen);

      if (boton) {
        boton.classList.toggle("hidden", this.isOpen);
        boton.setAttribute("aria-expanded", this.isOpen ? "true" : "false");
      }

      if (this.isOpen) {
        this.renderMensajes();
        global.setTimeout(function () {
          var input = document.getElementById("odontobot-input");
          if (input) input.focus();
        }, 180);
      } else if (boton) {
        boton.focus();
      }
    },

    enviarMensaje: function () {
      var input = document.getElementById("odontobot-input");
      if (!input) return;

      var consulta = input.value.trim();
      if (!consulta) return;

      this.mensajes.push({ remitente: "user", texto: consulta, hora: ahora() });
      input.value = "";
      this.renderMensajes();
      this.mostrarEscribiendo();

      var self = this;
      global.setTimeout(function () {
        self.quitarEscribiendo();
        self.decir(self.generarRespuesta(consulta));
      }, 500);
    },

    decir: function (respuesta) {
      if (typeof respuesta === "string") respuesta = { texto: respuesta };
      this.mensajes.push({
        remitente: "bot",
        texto: respuesta.texto,
        acciones: respuesta.acciones || null,
        hora: ahora()
      });
      this.renderMensajes();
    },

    consultarPreguntaSugerida: function (pregunta) {
      var input = document.getElementById("odontobot-input");
      if (!input) return;
      input.value = pregunta;
      this.enviarMensaje();
    },

    /* ====================================================================
       BÚSQUEDA EN LAS RESPUESTAS ESCRITAS
       ==================================================================== */
    puntajeDeTema: function (tema, tokens, textoNormal) {
      var partes = palabras(tema);
      if (!partes.length) return 0;

      /* Una palabra larga pesa más que una corta: "amoxicilina" dice mucho
         más sobre qué se está preguntando que "dosis", que aparece en
         cualquier consulta. Sin esto, "dosis de amoxi" contestaba sobre
         anestésicos, porque le ganaba el tema "dosis máxima". */
      function peso(parte) { return parte.length >= 8 ? 5 : (parte.length >= 6 ? 3 : 2); }

      // El tema completo dentro de la pregunta: la señal más fuerte.
      if (textoNormal.indexOf(UI.normalizar(tema)) !== -1) {
        return 2 + partes.reduce(function (suma, parte) { return suma + peso(parte) / 2; }, 0);
      }

      var puntos = 0, aciertos = 0;
      partes.forEach(function (parte) {
        if (tokens.some(function (t) { return coincide(t, parte); })) {
          aciertos++;
          puntos += peso(parte);
        }
      });
      if (!aciertos) return 0;
      // Un tema con partes sin acertar vale menos que uno acertado entero.
      return puntos - (partes.length - aciertos);
    },

    candidatas: function (consulta) {
      var self = this;
      var kb = (global.ODONTO_DATA && global.ODONTO_DATA.knowledgeBase) || [];
      var tokens = palabras(consulta);
      var textoNormal = UI.normalizar(consulta);

      return kb.map(function (entrada, indice) {
        var mejor = 0, tema = "";
        entrada.temas.forEach(function (t) {
          var p = self.puntajeDeTema(t, tokens, textoNormal);
          if (p > mejor) { mejor = p; tema = t; }
        });
        return { indice: indice, puntaje: mejor, tema: tema, entrada: entrada };
      }).filter(function (c) { return c.puntaje >= 2; })
        .sort(function (a, b) { return b.puntaje - a.puntaje; });
    },

    responderConIndice: function (indice) {
      var kb = (global.ODONTO_DATA && global.ODONTO_DATA.knowledgeBase) || [];
      if (!kb[indice]) return;
      this.decir({ texto: kb[indice].respuesta });
    },

    /* ====================================================================
       RESPUESTAS CON DATOS DEL SITIO
       ==================================================================== */
    /** La materia del plan que aparece en la pregunta (la más larga gana). */
    materiaDelPlan: function (textoNormal) {
      var materias = global.OdontoCalculator ? global.OdontoCalculator.getTodasLasMaterias() : [];
      var encontrada = null;
      materias.forEach(function (m) {
        var nombre = UI.normalizar(m.nombre);
        if (textoNormal.indexOf(nombre) === -1) return;
        if (!encontrada || nombre.length > UI.normalizar(encontrada.nombre).length) encontrada = m;
      });
      return encontrada;
    },

    /** Llamados de la planilla que coinciden con lo que se preguntó. */
    llamadosDe: function (textoNormal, tokens, incluirPasados) {
      var sheets = global.OdontoLiveSheets;
      var items = sheets && sheets.cachedItems ? sheets.cachedItems : [];

      return items.filter(function (item) {
        var nombre = UI.normalizar(item.materiaOriginal || item.materia);
        if (!nombre) return false;
        if (textoNormal.indexOf(nombre) !== -1) return true;
        var partes = palabras(nombre);
        if (!partes.length) return false;
        // Alcanza con que coincida la primera palabra larga del nombre
        // ("protesis" encuentra "Prótesis B III").
        return partes.some(function (parte) {
          return parte.length >= 5 && tokens.some(function (t) { return coincide(t, parte); });
        });
      }).map(function (item) {
        return { item: item, fecha: UI.parseFechaTexto(item.dia) };
      }).filter(function (e) {
        if (!e.fecha) return false;
        return incluirPasados || UI.diasHasta(e.fecha) >= 0;
      }).sort(function (a, b) { return a.fecha - b.fecha; });
    },

    respuestaDeFechas: function (textoNormal, tokens) {
      var todos = this.llamadosDe(textoNormal, tokens, true);
      var proximos = todos.filter(function (e) {
        var d = UI.diasHasta(e.fecha);
        return d !== null && d >= 0;
      }).slice(0, 4);

      /* La planilla tiene el turno pasado: decirlo es mucho mejor que "no sé
         nada de eso", que es lo que contestaba antes de cada turno nuevo. */
      if (!proximos.length) {
        if (!todos.length) return null;
        var ultimo = todos[todos.length - 1].item;
        return {
          texto: "Encontré **" + ultimo.materiaOriginal + "** en la planilla, pero las fechas cargadas " +
                 "ya pasaron (la última fue el " + ultimo.dia + ").\n\n" +
                 "Cuando la cátedra publique el turno nuevo aparece acá y en Mesas y reválidas.",
          acciones: [{ texto: "Ver la planilla", destino: "fechas/mesas" }]
        };
      }

      var hayRevalida = proximos.some(function (e) {
        return e.item.tipo === "revalida" || e.item.tipo === "actualizacion";
      });

      var lineas = proximos.map(function (e) {
        var it = e.item;
        var cuando = UI.cuandoTexto(e.fecha);
        var modalidad = it.modalidad || "Presencial";
        return "• **" + it.materiaOriginal + "** — " + it.dia + ", " + (it.hora || "horario a confirmar") +
               " (" + modalidad + ", " + cuando + ")";
      });

      return {
        texto: "Según la planilla oficial:\n\n" + lineas.join("\n") +
               "\n\n*Inscribite en el SIU: la inscripción cierra 48 horas hábiles antes.*",
        acciones: [{ texto: hayRevalida ? "Ver reválidas" : "Ver todas las mesas",
                     destino: hayRevalida ? "fechas/revalidas" : "fechas/mesas" }]
      };
    },

    respuestaDeCorrelativas: function (materia) {
      var nombres = {};
      (global.OdontoCalculator ? global.OdontoCalculator.getTodasLasMaterias() : [])
        .forEach(function (m) { nombres[m.codigo] = m.nombre; });

      var requisitos = (materia.correlativas || []).map(function (c) { return nombres[c] || c; });
      if (materia.condicion) requisitos.push(materia.condicion);

      var periodo = { anual: "anual", "1c": "1.° cuatrimestre", "2c": "2.° cuatrimestre", bimestral: "bimestral" };

      return {
        texto: "**" + materia.nombre + "** es de **" + materia.anio +
               ".° año**, " + (periodo[materia.periodo] || materia.periodo) + ".\n\n" +
               (requisitos.length
                 ? "Correlativas:\n" + requisitos.map(function (r) { return "• " + r; }).join("\n")
                 : "No tiene correlativas.") +
               "\n\n*El plan no aclara si hace falta tenerlas aprobadas o alcanza con la cursada: confirmalo en tu cátedra.*",
        acciones: [{ texto: "Ver el plan completo", destino: "carrera/plan" }]
      };
    },

    respuestaDeAgenda: function () {
      var agenda = global.OdontoAgenda;
      var Api = global.OdontoApi;
      if (!agenda || !Api || !Api.usuario()) {
        return {
          texto: "Para ver tu agenda necesito que inicies sesión. Es gratis y sirve también para " +
                 "guardar tus materias y tu promedio.",
          acciones: [{ texto: "Ir a Mi carrera", destino: "carrera/agenda" }]
        };
      }
      if (!agenda.cargado) {
        return {
          texto: "Abrí tu agenda y te muestro lo que viene: todavía no la traje desde tu cuenta.",
          acciones: [{ texto: "Abrir mi agenda", destino: "carrera/agenda" }]
        };
      }

      var propios = agenda.recordatorios.filter(function (r) { return !r.hecho; });
      if (!propios.length) {
        return {
          texto: "No tenés nada anotado por delante. Podés agregar entregas y finales desde tu agenda.",
          acciones: [{ texto: "Abrir mi agenda", destino: "carrera/agenda" }]
        };
      }

      var hoy = new Date().toISOString().slice(0, 10);
      var proximos = propios.filter(function (r) { return r.fecha >= hoy; })
        .sort(function (a, b) { return a.fecha.localeCompare(b.fecha); }).slice(0, 5);

      if (!proximos.length) {
        return {
          texto: "Todo lo que tenés anotado ya pasó. Revisalo por las dudas en tu agenda.",
          acciones: [{ texto: "Abrir mi agenda", destino: "carrera/agenda" }]
        };
      }

      var lineas = proximos.map(function (r) {
        var dias = UI.diasHasta(new Date(r.fecha + "T12:00:00"));
        var cuando = dias === 0 ? "hoy" : (dias === 1 ? "mañana" : "en " + dias + " días");
        return "• **" + r.titulo + "** — " + cuando + (r.hora ? ", " + r.hora : "");
      });

      return {
        texto: "Esto es lo que tenés anotado:\n\n" + lineas.join("\n"),
        acciones: [{ texto: "Abrir mi agenda", destino: "carrera/agenda" }]
      };
    },

    respuestaDePromedio: function () {
      var Api = global.OdontoApi;
      var calc = global.OdontoCalculator;
      if (!calc || !Api || !Api.usuario()) {
        return {
          texto: "Tu promedio se calcula con las materias que cargás en tu cuenta. Iniciá sesión y " +
                 "te lo muestro acá mismo.",
          acciones: [{ texto: "Ir a Mi carrera", destino: "carrera/plan" }]
        };
      }

      var m = calc.calcularMetricas();
      if (!m.aprobadasCount) {
        return {
          texto: "Todavía no tenés materias aprobadas cargadas. Cargalas una vez y el promedio se " +
                 "actualiza solo.",
          acciones: [{ texto: "Cargar mis materias", destino: "carrera/plan" }]
        };
      }

      return {
        texto: "Tu promedio **sin aplazos es " + m.promedioSinAplazos.replace(".", ",") + "** y " +
               "**con aplazos " + m.promedioConAplazos.replace(".", ",") + "**.\n\n" +
               "Llevás " + m.aprobadasCount + " de " + m.totalMaterias + " materias aprobadas (" +
               m.porcentajeAvance + "% de la carrera) y " + m.horasComplementarias + " de " +
               m.horasRequeridas + " horas de formación complementaria.",
        acciones: [{ texto: "Ver el detalle", destino: "carrera/plan" }]
      };
    },

    /* ====================================================================
       QUÉ CONTESTA A QUÉ
       ==================================================================== */
    generarRespuesta: function (consulta) {
      var textoNormal = UI.normalizar(consulta);
      var tokens = palabras(consulta);

      // 1. Saludos y cortesías, antes que nada.
      if (/^(hola|buenas|buen dia|buenas tardes|buenas noches|que tal)\b/.test(textoNormal)) {
        return "¡Hola! Contame qué materia o tema estás viendo y busco lo que tengamos cargado.";
      }
      if (/^(gracias|muchas gracias|joya|genial|barbaro|perfecto)\b/.test(textoNormal)) {
        return "¡De nada! Cualquier otra duda, acá estoy. Éxitos en la clínica y en los finales.";
      }

      // 2. Lo propio de quien pregunta.
      if (/\b(mi agenda|mis entregas|que tengo|tengo esta semana|proximas entregas|mis finales)\b/.test(textoNormal) ||
          (tieneAlguna(tokens, /^(agenda|entrega|entregas|recordatorio|recordatorios)$/) &&
           /\b(mi|mis|tengo)\b/.test(textoNormal))) {
        return this.respuestaDeAgenda();
      }
      if (/\b(mi promedio|promedio|avance|cuanto me falta|cuantas materias me faltan)\b/.test(textoNormal)) {
        return this.respuestaDePromedio();
      }

      // 3. Correlativas y datos del plan.
      var materia = this.materiaDelPlan(textoNormal);
      if (materia && /correlativ|puedo cursar|habilita|previa|previas|de que año|de que anio/.test(textoNormal)) {
        return this.respuestaDeCorrelativas(materia);
      }

      // 4. Fechas: lo que más se pregunta en época de finales.
      if (/cuando|fecha|mesa|mesas|rindo|rinde|revalida|examen|turno/.test(textoNormal)) {
        var fechas = this.respuestaDeFechas(textoNormal, tokens);
        if (fechas) return fechas;
      }

      // 5. Las respuestas escritas por FOE.
      var candidatas = this.candidatas(consulta);
      if (candidatas.length) {
        var mejor = candidatas[0];
        var segunda = candidatas[1];
        // Empate de verdad: preguntar en vez de elegir por azar.
        if (segunda && mejor.puntaje === segunda.puntaje) {
          return {
            texto: "Puedo contarte sobre dos cosas distintas. ¿Cuál te interesa?",
            acciones: [
              { texto: this.etiquetaDe(mejor), indice: mejor.indice },
              { texto: this.etiquetaDe(segunda), indice: segunda.indice }
            ]
          };
        }
        return { texto: mejor.entrada.respuesta };
      }

      // 6. Nada. Se avisa y se anota para que FOE lo escriba.
      this.anotarSinRespuesta(consulta);

      if (materia) {
        return {
          texto: "De **" + materia.nombre + "** tengo el plan (año, período y correlativas), pero no " +
                 "una respuesta sobre eso puntual. Probá preguntándome por sus correlativas o cuándo se rinde.",
          acciones: [{ texto: "Ver el plan", destino: "carrera/plan" }]
        };
      }

      return {
        texto: "No encontré nada sobre eso en lo que tengo cargado. Ya quedó anotado para que FOE " +
               "escriba la respuesta.\n\n" +
               "Mientras tanto, probá con una palabra más específica: *lidocaína*, *amoxicilina*, " +
               "*Black*, *conductometría* o *SIU Guaraní*. Si es una consulta de gestión, escribinos " +
               "por Instagram o pasá por la mesa de FOE en el hall.",
        acciones: [{ texto: "Buscar en todo el sitio", accion: "abrirBusqueda" }]
      };
    },

    /** Un nombre corto para el botón de desambiguación. */
    etiquetaDe: function (candidata) {
      var tema = candidata.tema || candidata.entrada.temas[0] || "";
      return tema.charAt(0).toUpperCase() + tema.slice(1);
    },

    /**
     * Anota la consulta sin respuesta. No viaja quién preguntó: la función de
     * la base tampoco lo guarda, y además borra correos y números largos.
     */
    anotarSinRespuesta: function (consulta) {
      var Api = global.OdontoApi;
      if (!Api || !Api.hayBackend()) return;
      var texto = String(consulta || "").trim().slice(0, 200);
      if (texto.length < 3) return;
      Api.rpc("anotar_consulta_bot", { p_texto: texto }).catch(function () {
        // Que no se pueda anotar no es problema de quien pregunta.
      });
    },

    /* ====================================================================
       PANTALLA
       ==================================================================== */
    mostrarEscribiendo: function () {
      var cont = document.getElementById("odontobot-messages");
      if (!cont) return;

      var el = document.createElement("div");
      el.id = "odontobot-typing";
      el.className = "chat-bubble bot-bubble";
      el.innerHTML =
        '<span class="bubble-avatar" aria-hidden="true">' + UI.icono("diente") + "</span>" +
        '<span class="bubble-content typing-indicator" aria-label="Buscando una respuesta">' +
          "<span></span><span></span><span></span>" +
        "</span>";
      cont.appendChild(el);
      cont.scrollTop = cont.scrollHeight;
    },

    quitarEscribiendo: function () {
      var el = document.getElementById("odontobot-typing");
      if (el) el.remove();
    },

    /**
     * Escapa primero, formatea después. El orden importa: si se formateara
     * antes, un mensaje con etiquetas HTML se ejecutaría en la página.
     */
    formatear: function (texto) {
      return esc(texto)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br>");
    },

    botonesDe: function (acciones) {
      if (!acciones || !acciones.length) return "";
      return '<span class="chat-acciones">' + acciones.map(function (a) {
        if (a.destino) {
          return '<button type="button" class="sugg-chip" data-action="ir" data-destino="' +
                 escAttr(a.destino) + '">' + esc(a.texto) + "</button>";
        }
        if (a.accion) {
          return '<button type="button" class="sugg-chip" data-action="' + escAttr(a.accion) + '">' +
                 esc(a.texto) + "</button>";
        }
        return '<button type="button" class="sugg-chip" data-action="botDesambiguar" data-indice="' +
               escAttr(a.indice) + '">' + esc(a.texto) + "</button>";
      }).join("") + "</span>";
    },

    renderMensajes: function () {
      var cont = document.getElementById("odontobot-messages");
      if (!cont) return;
      var self = this;

      var burbujas = this.mensajes.map(function (m) {
        var esUsuario = m.remitente === "user";
        return (
          '<div class="chat-bubble ' + (esUsuario ? "user-bubble" : "bot-bubble") + '">' +
            '<span class="bubble-avatar" aria-hidden="true">' +
              UI.icono(esUsuario ? "persona" : "diente") +
            "</span>" +
            '<span class="bubble-content">' +
              "<span>" + self.formatear(m.texto) + "</span>" +
              self.botonesDe(m.acciones) +
              '<span class="bubble-time">' +
                '<span class="visually-hidden">' + (esUsuario ? "Vos, " : "OdontoBot, ") + "</span>" +
                esc(m.hora) +
              "</span>" +
            "</span>" +
          "</div>"
        );
      }).join("");

      var descargo =
        '<p class="filter-note" style="padding:0 var(--sp-2)">' +
          '<svg class="ic" aria-hidden="true"><use href="#ic-alerta"></use></svg>' +
          "<span>Material de estudio. No reemplaza la indicación de tu docente ni el prospecto. " +
          "Lo que no sé contestar queda anotado, sin tu nombre, para que FOE lo escriba.</span>" +
        "</p>";

      cont.innerHTML = burbujas + descargo;
      cont.scrollTop = cont.scrollHeight;
    }
  };

  global.OdontoBot = OdontoBot;
})(window);
