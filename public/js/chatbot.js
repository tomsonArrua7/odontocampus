/* ==========================================================================
   ODONTOCAMPUS — ODONTOBOT
   Buscador de respuestas frecuentes sobre la base de conocimiento de FOE.

   Dos decisiones deliberadas de esta versión:

   1. Ya no se anuncia como "IA". No lo es: busca coincidencias de palabras
      clave en una lista escrita a mano. Llamarlo inteligencia artificial hacía
      que la gente le preguntara cosas que no puede responder y desconfiara del
      resto del sitio cuando fallaba. Prometer menos y cumplir vale más.

   2. Muestra un descargo permanente. Devuelve dosis de anestésicos y pautas de
      antibióticos a estudiantes que atienden pacientes reales: el material es
      de estudio y no reemplaza la indicación del docente ni el prospecto.

   Además, todo texto que escribe la persona se escapa antes de mostrarse. El
   formato (negrita, cursiva, viñetas) se aplica después, solo sobre la
   respuesta que el propio sitio controla.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var esc = UI.esc;

  function ahora() {
    return new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  }

  var BIENVENIDA =
    "¡Hola! Soy **OdontoBot**. Busco entre las preguntas frecuentes de FOE.\n\n" +
    "Puedo ayudarte con:\n" +
    "• Dosis máximas de anestésicos locales\n" +
    "• Antibióticos y analgésicos de uso odontológico\n" +
    "• Clasificación de cavidades de Black\n" +
    "• Conductometría y protocolo de endodoncia\n" +
    "• Trámites en SIU Guaraní\n\n" +
    "¿Con qué arrancamos?";

  var OdontoBot = {
    mensajes: [],
    isOpen: false,

    init: function () {
      var self = this;

      this.mensajes = [{ remitente: "bot", texto: BIENVENIDA, hora: ahora() }];

      UI.registerActions({
        alternarChat: function () { self.toggleChat(); },
        sugerencia: function (data) { self.consultarPreguntaSugerida(data.texto); }
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
        // Devolvemos el foco al botón que abrió el panel
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
        self.mensajes.push({ remitente: "bot", texto: self.generarRespuesta(consulta), hora: ahora() });
        self.renderMensajes();
      }, 600);
    },

    consultarPreguntaSugerida: function (pregunta) {
      var input = document.getElementById("odontobot-input");
      if (!input) return;
      input.value = pregunta;
      this.enviarMensaje();
    },

    generarRespuesta: function (consulta) {
      var q = UI.normalizar(consulta);
      var kb = (global.ODONTO_DATA && global.ODONTO_DATA.knowledgeBase) || [];

      for (var i = 0; i < kb.length; i++) {
        var coincide = kb[i].temas.some(function (tema) {
          return q.indexOf(UI.normalizar(tema)) !== -1;
        });
        if (coincide) return kb[i].respuesta;
      }

      if (/(hola|buenas|que tal|buen dia)/.test(q)) {
        return "¡Hola! Contame qué materia o tema estás viendo y busco lo que tengamos cargado.";
      }
      if (/(gracias|joya|genial|barbaro)/.test(q)) {
        return "¡De nada! Cualquier otra duda, acá estoy. Éxitos en la clínica y en los finales.";
      }
      if (/(mesa|final|revalida|cuando rindo|fecha)/.test(q)) {
        return "Las fechas están en la sección **Cuándo rindo**, sincronizadas con la planilla oficial. " +
               "Ahí podés filtrar por día y por modalidad, y copiar los datos de Zoom.";
      }

      return "No encontré nada sobre eso en lo que tengo cargado.\n\n" +
             "Probá con una palabra más específica: *lidocaína*, *amoxicilina*, *Black*, " +
             "*conductometría* o *SIU Guaraní*.\n\n" +
             "Si es una consulta de gestión, escribinos por Instagram o pasá por la mesa de FOE en el hall.";
    },

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
          "<span>Material de estudio. No reemplaza la indicación de tu docente ni el prospecto del medicamento.</span>" +
        "</p>";

      cont.innerHTML = burbujas + descargo;
      cont.scrollTop = cont.scrollHeight;
    }
  };

  global.OdontoBot = OdontoBot;
})(window);
