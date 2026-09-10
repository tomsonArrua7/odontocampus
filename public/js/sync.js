/* ==========================================================================
   ODONTOCAMPUS — SINCRONIZACIÓN DE NOTAS
   Une la calculadora (local) con el servidor (cifrado).

   --------------------------------------------------------------------------
   LOCAL PRIMERO, SIEMPRE

   El uso real de este sitio es en el pasillo de la facultad, con mala señal.
   localStorage es la fuente de verdad para escribir; el servidor es un espejo
   que se pone al día cuando hay conexión.

   Si no hay internet, la calculadora anda. Si nunca se inicia sesión, anda.
   Si el servidor está caído, anda. Sincronizar es una mejora, nunca un
   requisito.

   --------------------------------------------------------------------------
   UNA PROMESA QUE YA HABÍAMOS HECHO

   La pantalla del promedio dice, desde la primera versión: "Tus notas quedan
   solo en este dispositivo. No se envían a ningún servidor."

   Mandarlas al servidor sin más rompe un compromiso ya asumido con quien está
   usando la herramienta. Por eso: consentimiento explícito, en contexto, con
   el texto a la vista y registrado en la base. Y si la persona dice que no,
   la calculadora sigue funcionando exactamente igual que antes.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var Api = global.OdontoApi;
  var Cripto = global.OdontoCripto;
  var CONFIG = global.ODONTO_CONFIG;

  var OdontoSync = {
    clave: null,        // CryptoKey en memoria
    sal: null,
    activo: false,
    guardadoPendiente: null,

    /* ====================================================================
       ESTADO
       ==================================================================== */
    disponible: function () {
      return Api.hayBackend() && Cripto.disponible() && Api.haySesion();
    },

    descripcionEstado: function () {
      if (!Api.hayBackend()) return "No disponible todavía";
      if (!Cripto.disponible()) return "No disponible en este navegador";
      if (!Api.haySesion()) return "Necesitás iniciar sesión";
      if (this.activo) return "Activa y cifrada";
      return "Desactivada · tus notas están sólo en este dispositivo";
    },

    init: function () {
      var self = this;

      UI.registerActions({
        activarSync: function () { self.pedirConsentimiento(); },
        confirmarConsentimiento: function () { self.pedirClaveNueva(); },
        cerrarConsentimiento: function () { UI.closeModal("modal-consentimiento"); },
        cerrarClaveNotas: function () { UI.closeModal("modal-clave-notas"); },
        desactivarSync: function () { self.desactivar(); }
      });

      var form = document.getElementById("form-clave-notas");
      if (form) {
        UI.on(form, "submit", function (ev) {
          ev.preventDefault();
          self.procesarClave();
        });
      }

      var campo = document.getElementById("clave-notas");
      if (campo) {
        UI.on(campo, "input", function () { self.pintarFuerza(campo.value); });
      }

      if (Api.haySesion()) this.alIniciarSesion();
      this.pintarPanel();
    },

    /* ====================================================================
       AL INICIAR SESIÓN
       ==================================================================== */
    alIniciarSesion: function () {
      var self = this;
      var usuario = Api.usuario();
      if (!usuario || !this.disponible()) return;

      Api.seleccionar("notas_academicas", "select=*&limit=1")
        .then(function (filas) {
          if (!filas || !filas.length) {
            // No hay nada en el servidor: puede que quiera empezar a sincronizar.
            self.pintarPanel();
            return;
          }

          var fila = filas[0];
          self.sal = fila.sal;

          // ¿Tenemos la clave guardada en este dispositivo?
          return Cripto.recuperarClave(usuario.id).then(function (guardada) {
            if (guardada) {
              self.clave = guardada;
              self.activo = true;
              return self.traer(fila);
            }
            // Hay notas en el servidor pero este dispositivo no tiene la clave.
            self.pedirClaveExistente();
          });
        })
        .catch(function (error) {
          console.warn("[OdontoCampus] No se pudo consultar la sincronización:", error);
        })
        .then(function () { self.pintarPanel(); });
    },

    /* ====================================================================
       CONSENTIMIENTO
       ==================================================================== */
    pedirConsentimiento: function () {
      if (!Api.haySesion()) {
        UI.toast("Primero ingresá a tu cuenta", "info");
        if (global.OdontoAuth) global.OdontoAuth.abrir();
        return;
      }
      if (!Cripto.disponible()) {
        UI.toast("Tu navegador no permite cifrar. Probá con uno más reciente.", "warning");
        return;
      }
      UI.openModal("modal-consentimiento");
    },

    registrarConsentimiento: function () {
      return Api.insertar("consentimientos", {
        usuario_id: Api.usuario().id,
        tipo: "sincronizar_notas",
        version_texto: CONFIG.versionConsentimiento
      }).catch(function (error) {
        // Que falle el registro no debe impedir el uso, pero sí queda anotado.
        console.warn("[OdontoCampus] No se registró el consentimiento:", error);
      });
    },

    /* ====================================================================
       CLAVE DE NOTAS
       ==================================================================== */
    pedirClaveNueva: function () {
      UI.closeModal("modal-consentimiento");
      this.prepararModalClave("nueva");
      UI.openModal("modal-clave-notas", "#clave-notas");
    },

    pedirClaveExistente: function () {
      this.prepararModalClave("existente");
      UI.openModal("modal-clave-notas", "#clave-notas");
    },

    prepararModalClave: function (modo) {
      this.modoClave = modo;

      var titulo = document.getElementById("clave-notas-titulo");
      var ayuda = document.getElementById("clave-notas-ayuda");
      var aviso = document.getElementById("clave-notas-aviso");
      var boton = document.getElementById("btn-clave-notas");
      var campo = document.getElementById("clave-notas");

      if (campo) campo.value = "";
      this.pintarFuerza("");

      if (modo === "nueva") {
        if (titulo) titulo.textContent = "Elegí una clave para tus notas";
        if (ayuda) {
          ayuda.textContent = "Es distinta de la de tu email y no se envía a " +
            "ningún lado. Sin ella, tus notas no se pueden descifrar: ni por " +
            "nosotros, ni por nadie de FOE.";
        }
        if (aviso) aviso.hidden = false;
        if (boton) boton.textContent = "Cifrar y sincronizar";
      } else {
        if (titulo) titulo.textContent = "Ingresá tu clave de notas";
        if (ayuda) {
          ayuda.textContent = "La que elegiste cuando activaste la " +
            "sincronización. Este dispositivo todavía no la tiene.";
        }
        if (aviso) aviso.hidden = true;
        if (boton) boton.textContent = "Descifrar mis notas";
      }
    },

    pintarFuerza: function (texto) {
      var barra = document.getElementById("clave-fuerza");
      if (!barra) return;

      if (!texto) { barra.hidden = true; return; }

      var evaluacion = Cripto.evaluarClave(texto);
      barra.hidden = false;
      barra.className = "clave-fuerza clave-" + evaluacion.nivel;
      barra.textContent = evaluacion.texto;
    },

    procesarClave: function () {
      var self = this;
      var campo = document.getElementById("clave-notas");
      var valor = campo ? campo.value : "";

      if (valor.length < CONFIG.minLargoClaveNotas) {
        UI.toast("La clave necesita al menos " + CONFIG.minLargoClaveNotas + " caracteres", "warning");
        return;
      }

      var boton = document.getElementById("btn-clave-notas");
      if (boton) {
        boton.disabled = true;
        // La derivación tarda uno o dos segundos a propósito: es lo que hace
        // cara la fuerza bruta. Sin este aviso parece que se colgó.
        boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Cifrando…';
      }

      var esNueva = this.modoClave === "nueva";
      var sal = esNueva ? Cripto.generarSal() : this.sal;

      Cripto.derivarClave(valor, sal)
        .then(function (clave) {
          self.clave = clave;
          self.sal = sal;

          if (esNueva) return self.activarConClave();
          return self.traer();
        })
        .then(function () {
          return Cripto.recordarClave(Api.usuario().id, self.clave);
        })
        .then(function () {
          UI.closeModal("modal-clave-notas");
          self.activo = true;
          self.pintarPanel();
          UI.toast(esNueva ? "Sincronización activada" : "Notas recuperadas", "success");
        })
        .catch(function (error) {
          if (error && error.message === "CLAVE_INCORRECTA") {
            UI.toast("Esa clave no abre tus notas. Probá de nuevo.", "danger");
            if (campo) { campo.value = ""; campo.focus(); }
          } else {
            UI.toast((error && error.message) || "No se pudo completar", "danger");
          }
          self.clave = null;
        })
        .then(function () {
          if (boton) {
            boton.disabled = false;
            boton.textContent = esNueva ? "Cifrar y sincronizar" : "Descifrar mis notas";
          }
        });
    },

    /* ====================================================================
       SUBIR Y BAJAR
       ==================================================================== */
    activarConClave: function () {
      var self = this;
      return this.registrarConsentimiento().then(function () {
        return self.subir();
      });
    },

    subir: function () {
      var self = this;
      if (!this.clave || !Api.haySesion()) return Promise.resolve();

      var notas = global.OdontoCalculator.getNotas();

      return Cripto.cifrar(notas, this.clave).then(function (paquete) {
        return Api.guardar("notas_academicas", {
          usuario_id: Api.usuario().id,
          payload_cifrado: paquete,
          sal: self.sal,
          actualizado_at: new Date().toISOString()
        }, { devolver: false });
      });
    },

    traer: function (filaConocida) {
      var self = this;

      var obtener = filaConocida
        ? Promise.resolve([filaConocida])
        : Api.seleccionar("notas_academicas", "select=*&limit=1");

      return obtener.then(function (filas) {
        if (!filas || !filas.length) return null;

        self.sal = filas[0].sal;
        return Cripto.descifrar(filas[0].payload_cifrado, self.clave)
          .then(function (remotas) {
            var combinadas = self.combinar(global.OdontoCalculator.getNotas(), remotas);
            global.OdontoCalculator.guardarNotas(combinadas, true);
            global.OdontoCalculator.renderTabla();
            return combinadas;
          });
      });
    },

    /**
     * Combina las notas locales con las del servidor.
     *
     * Gana la más reciente, materia por materia. Es suficiente para este
     * caso: una persona editando sus propias notas en dos dispositivos rara
     * vez toca la misma materia en simultáneo. Y si pasa, se pierde una
     * edición, no todo el conjunto.
     */
    combinar: function (locales, remotas) {
      var resultado = {};
      var claves = {};

      Object.keys(locales || {}).forEach(function (k) { claves[k] = true; });
      Object.keys(remotas || {}).forEach(function (k) { claves[k] = true; });

      Object.keys(claves).forEach(function (id) {
        var local = locales && locales[id];
        var remota = remotas && remotas[id];

        if (!local) { resultado[id] = remota; return; }
        if (!remota) { resultado[id] = local; return; }

        var tLocal = Date.parse(local.fechaActualizacion || 0) || 0;
        var tRemota = Date.parse(remota.fechaActualizacion || 0) || 0;
        resultado[id] = tRemota > tLocal ? remota : local;
      });

      return resultado;
    },

    /**
     * La calculadora avisa acá en cada cambio. Se agrupa con un retardo para
     * no mandar una petición por cada tecla al cargar veinte materias.
     */
    notificarCambio: function () {
      var self = this;
      if (!this.activo || !this.clave) return;

      global.clearTimeout(this.guardadoPendiente);
      this.guardadoPendiente = global.setTimeout(function () {
        self.subir()
          .then(function () { self.pintarPanel("guardado"); })
          .catch(function (error) {
            console.warn("[OdontoCampus] No se pudo sincronizar:", error);
            self.pintarPanel("error");
          });
      }, 1500);
    },

    desactivar: function () {
      var self = this;
      if (!global.confirm(
        "Vas a borrar tus notas del servidor.\n\n" +
        "Las que están en este dispositivo se conservan, pero dejás de verlas " +
        "desde otros equipos.\n\n¿Seguimos?"
      )) return;

      Api.borrar("notas_academicas", "usuario_id=eq." + Api.usuario().id)
        .then(function () {
          return Cripto.olvidarClave(Api.usuario().id);
        })
        .then(function () {
          self.activo = false;
          self.clave = null;
          self.pintarPanel();
          UI.toast("Sincronización desactivada. Tus notas quedaron sólo acá.", "success");
        })
        .catch(function (error) { UI.toast(error.message, "danger"); });
    },

    /* ====================================================================
       PANEL EN LA SECCIÓN DEL PROMEDIO
       ==================================================================== */
    pintarPanel: function (evento) {
      var panel = document.getElementById("panel-sync");
      if (!panel) return;

      /* Sin backend configurado, el panel no existe: la pantalla queda
         exactamente como en la primera versión, con la promesa original
         intacta. */
      if (!Api.hayBackend()) { panel.hidden = true; return; }
      panel.hidden = false;

      if (!Api.haySesion()) {
        panel.className = "sync-panel";
        panel.innerHTML =
          '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>' +
          "<div><strong>¿Querés ver tu promedio desde el celular y la notebook?</strong>" +
          "<p>Podés sincronizarlo con tu cuenta. Se guarda cifrado: nadie de FOE " +
          "puede leer tus notas.</p></div>" +
          '<button type="button" class="btn btn-outline-magenta btn-sm" data-action="abrirAcceso">' +
            "Ingresar</button>";
        return;
      }

      if (!this.activo) {
        panel.className = "sync-panel";
        panel.innerHTML =
          '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>' +
          "<div><strong>Sincronizar mis notas</strong>" +
          "<p>Se cifran en tu navegador antes de salir. Podés desactivarlo cuando quieras.</p></div>" +
          '<button type="button" class="btn btn-magenta btn-sm" data-action="activarSync">' +
            "Activar</button>";
        return;
      }

      var detalle = "Cifradas de punta a punta";
      if (evento === "guardado") detalle = "Guardado recién";
      if (evento === "error") detalle = "No se pudo guardar · se reintenta solo";

      panel.className = "sync-panel sync-activa" + (evento === "error" ? " sync-error" : "");
      panel.innerHTML =
        '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>' +
        "<div><strong>Sincronización activa</strong><p>" + UI.esc(detalle) + "</p></div>" +
        '<button type="button" class="btn btn-secondary btn-sm" data-action="desactivarSync">' +
          "Desactivar</button>";
    }
  };

  global.OdontoSync = OdontoSync;
})(window);
