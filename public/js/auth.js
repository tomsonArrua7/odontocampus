/* ==========================================================================
   ODONTOCAMPUS — ACCESO
   Ingreso por código enviado al email y estado de sesión en el encabezado.

   --------------------------------------------------------------------------
   DOS PRINCIPIOS QUE NO SE NEGOCIAN

   1. El login suma, no tapa. Mesas, reválidas, historias clínicas,
      instrumental y biblioteca siguen abiertas sin cuenta. Si alguien no
      inicia sesión nunca, el sitio le funciona igual que hoy.

   2. Sin contraseña. Esta población va a reutilizar la de Instagram; si nos
      filtran la base, les comprometemos otras cuentas. Sin contraseñas
      guardadas ese riesgo no existe, y de paso desaparece el "olvidé mi
      contraseña", que es donde se pierde más gente.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var Api = global.OdontoApi;
  var esc = UI.esc;

  var OdontoAuth = {
    emailPendiente: "",
    reenvioHasta: 0,
    temporizador: null,

    /* ====================================================================
       ARRANQUE
       ==================================================================== */
    init: function () {
      var self = this;

      UI.registerActions({
        abrirAcceso: function () { self.abrir(); },
        cerrarAcceso: function () { UI.closeModal("modal-acceso"); },
        volverAEmail: function () { self.mostrarPaso("email"); },
        reenviarCodigo: function () { self.enviarCodigo(self.emailPendiente, true); },
        abrirCuenta: function () { self.abrirPanelCuenta(); },
        cerrarCuenta: function () { UI.closeModal("modal-cuenta"); },
        cerrarSesion: function () { self.salir(); },
        exportarDatos: function () { self.exportar(); },
        eliminarCuenta: function () { self.eliminar(); },
        confirmarEliminarCuenta: function () { self.confirmarEliminacion(); }
      });

      var formEmail = document.getElementById("form-acceso-email");
      if (formEmail) {
        UI.on(formEmail, "submit", function (ev) {
          ev.preventDefault();
          var campo = document.getElementById("acceso-email");
          self.enviarCodigo(campo ? campo.value : "", false);
        });
      }

      var formCodigo = document.getElementById("form-acceso-codigo");
      if (formCodigo) {
        UI.on(formCodigo, "submit", function (ev) {
          ev.preventDefault();
          var campo = document.getElementById("acceso-codigo");
          self.confirmarCodigo(campo ? campo.value : "");
        });
      }

      Api.alCambiarSesion(function () { self.pintarEncabezado(); });
      this.pintarEncabezado();
    },

    /* ====================================================================
       ENCABEZADO
       ==================================================================== */
    pintarEncabezado: function () {
      var contenedor = document.getElementById("zona-cuenta");
      if (!contenedor) return;

      /* Si el backend todavía no está configurado, el botón de cuenta ni
         siquiera aparece. Prometer algo que no funciona es peor que no
         ofrecerlo. */
      if (!Api.hayBackend()) {
        contenedor.innerHTML = "";
        contenedor.hidden = true;
        return;
      }
      contenedor.hidden = false;

      var usuario = Api.usuario();

      if (!usuario) {
        contenedor.innerHTML =
          '<button type="button" class="btn-cuenta" data-action="abrirAcceso">' +
            '<i class="fa-regular fa-user" aria-hidden="true"></i>' +
            "<span>Ingresar</span>" +
          "</button>";
        return;
      }

      var nombre = (usuario.user_metadata && usuario.user_metadata.nombre_visible) ||
                   (usuario.email || "").split("@")[0];
      var inicial = nombre.charAt(0).toUpperCase();

      contenedor.innerHTML =
        '<button type="button" class="btn-cuenta btn-cuenta-activa" data-action="abrirCuenta" ' +
                'aria-label="Mi cuenta: ' + esc(nombre) + '">' +
          '<span class="avatar-inicial" aria-hidden="true">' + esc(inicial) + "</span>" +
          "<span>" + esc(nombre) + "</span>" +
        "</button>";
    },

    /* ====================================================================
       INGRESO
       ==================================================================== */
    abrir: function () {
      this.mostrarPaso("email");
      UI.openModal("modal-acceso", "#acceso-email");
    },

    mostrarPaso: function (paso) {
      var pasoEmail = document.getElementById("paso-email");
      var pasoCodigo = document.getElementById("paso-codigo");
      if (!pasoEmail || !pasoCodigo) return;

      pasoEmail.hidden = paso !== "email";
      pasoCodigo.hidden = paso !== "codigo";

      var foco = document.getElementById(paso === "email" ? "acceso-email" : "acceso-codigo");
      if (foco) global.setTimeout(function () { foco.focus(); }, 80);
    },

    enviarCodigo: function (email, esReenvio) {
      var self = this;
      var valor = String(email || "").trim().toLowerCase();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor)) {
        UI.toast("Revisá la dirección de correo", "warning");
        var campo = document.getElementById("acceso-email");
        if (campo) campo.focus();
        return;
      }

      if (esReenvio && Date.now() < this.reenvioHasta) return;

      var boton = document.getElementById("btn-enviar-codigo");
      if (boton && !esReenvio) {
        boton.disabled = true;
        boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Enviando…';
      }

      Api.solicitarCodigo(valor)
        .then(function () {
          self.emailPendiente = valor;
          var destino = document.getElementById("acceso-email-destino");
          if (destino) destino.textContent = valor;

          self.mostrarPaso("codigo");
          self.arrancarCuentaRegresiva();
          UI.announce("Código enviado a " + valor);
        })
        .catch(function (error) {
          UI.toast(error.message, "danger");
        })
        .then(function () {
          if (boton) {
            boton.disabled = false;
            boton.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Enviarme el código';
          }
        });
    },

    /** El reenvío se habilita a los 60 segundos, que es exactamente lo que
        exige el servidor (GOTRUE_SMTP_MAX_FREQUENCY en el override de
        Supabase). Si fueran distintos, la persona tocaría "Reenviar" y
        recibiría un error. Cambiar uno obliga a cambiar el otro. */
    arrancarCuentaRegresiva: function () {
      var self = this;
      var boton = document.getElementById("btn-reenviar");
      if (!boton) return;

      this.reenvioHasta = Date.now() + 60000;
      global.clearInterval(this.temporizador);

      function pintar() {
        var faltan = Math.ceil((self.reenvioHasta - Date.now()) / 1000);
        if (faltan > 0) {
          boton.disabled = true;
          boton.textContent = "Reenviar en " + faltan + "s";
        } else {
          boton.disabled = false;
          boton.textContent = "Reenviar el código";
          global.clearInterval(self.temporizador);
        }
      }

      pintar();
      this.temporizador = global.setInterval(pintar, 1000);
    },

    confirmarCodigo: function (codigo) {
      var self = this;
      var valor = String(codigo || "").replace(/\D/g, "");

      if (valor.length < 6) {
        UI.toast("El código tiene 6 dígitos", "warning");
        return;
      }

      var boton = document.getElementById("btn-confirmar-codigo");
      if (boton) {
        boton.disabled = true;
        boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Verificando…';
      }

      Api.verificarCodigo(this.emailPendiente, valor)
        .then(function (usuario) {
          global.clearInterval(self.temporizador);
          UI.closeModal("modal-acceso");

          var nombre = (usuario && usuario.email || "").split("@")[0];
          UI.toast("¡Hola, " + nombre + "!", "success");

          // La calculadora decide si ofrecer sincronizar.
          if (global.OdontoSync) global.OdontoSync.alIniciarSesion();
        })
        .catch(function (error) {
          UI.toast(error.message, "danger");
          var campo = document.getElementById("acceso-codigo");
          if (campo) { campo.value = ""; campo.focus(); }
        })
        .then(function () {
          if (boton) {
            boton.disabled = false;
            boton.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket" aria-hidden="true"></i> Ingresar';
          }
        });
    },

    /* ====================================================================
       PANEL DE CUENTA
       ==================================================================== */
    abrirPanelCuenta: function () {
      var usuario = Api.usuario();
      if (!usuario) return;

      var correo = document.getElementById("cuenta-email");
      if (correo) correo.textContent = usuario.email || "";

      var estado = document.getElementById("cuenta-estado-sync");
      if (estado && global.OdontoSync) {
        estado.textContent = global.OdontoSync.descripcionEstado();
      }

      UI.openModal("modal-cuenta");
    },

    salir: function () {
      var usuario = Api.usuario();

      Api.cerrarSesion().then(function () {
        /* La clave de las notas se olvida al salir: si alguien más usa esta
           computadora, no debe poder descifrar nada. Las notas locales se
           conservan; son de quien las cargó. */
        if (usuario && global.OdontoCripto) {
          global.OdontoCripto.olvidarClave(usuario.id);
        }
        UI.closeModal("modal-cuenta");
        UI.toast("Cerraste sesión", "info");
      });
    },

    /* ====================================================================
       DERECHOS DE LA LEY 25.326
       ==================================================================== */
    exportar: function () {
      var usuario = Api.usuario();
      if (!usuario) return;

      UI.toast("Preparando tus datos…", "info");

      Promise.all([
        // El perfil propio completo sale de mi_perfil(): la tabla perfiles
        // sólo deja leer nombre y año, para que nadie junte los WhatsApp
        // del resto de los usuarios.
        Api.rpc("mi_perfil").catch(function () { return []; }),
        Api.seleccionar("consentimientos", "select=*").catch(function () { return []; }),
        Api.seleccionar("notas_academicas", "select=*").catch(function () { return []; })
      ]).then(function (partes) {
        var paquete = {
          exportado_el: new Date().toISOString(),
          cuenta: { id: usuario.id, email: usuario.email, creada: usuario.created_at },
          perfil: partes[0],
          consentimientos: partes[1],
          notas_academicas: partes[2],
          nota: "Las notas figuran cifradas: sólo se descifran en tu navegador " +
                "con tu clave de notas. Ni siquiera quien administra el servidor " +
                "puede leerlas."
        };

        var blob = new Blob([JSON.stringify(paquete, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var enlace = document.createElement("a");
        enlace.href = url;
        enlace.download = "odontocampus-mis-datos.json";
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        URL.revokeObjectURL(url);

        UI.toast("Descarga lista", "success");
      }).catch(function (error) {
        UI.toast(error.message, "danger");
      });
    },

    /**
     * Eliminar la cuenta.
     *
     * Es inmediato y no tiene vuelta atrás. Para que no pase por un toque
     * accidental, se pide escribir ELIMINAR: un botón de confirmación
     * común se aprieta sin leer.
     *
     * El borrado lo hace la función `eliminar_mi_cuenta` en la base: desde
     * el navegador no se puede tocar auth.users, y está bien que así sea.
     */
    eliminar: function () {
      if (!Api.usuario()) return;

      global.OdontoApp.mostrarModalGenerico(
        "<h2>Eliminar mi cuenta</h2>",
        '<p class="modal-lead">Se borran tu cuenta y todo lo asociado: perfil, ' +
        "notas sincronizadas, consentimientos y publicaciones. " +
        "<strong>No se puede deshacer.</strong></p>" +
        '<div class="callout callout-info" style="margin-top:1.25rem">' +
          '<i class="fa-solid fa-mobile-screen" aria-hidden="true"></i>' +
          "<div><h3>Lo que está en este dispositivo no se toca</h3>" +
          "<p>Las notas que cargaste en la calculadora de este navegador se " +
          "conservan. Si también querés borrarlas, usá <strong>Borrar mis " +
          "notas</strong> en Mi promedio.</p></div>" +
        "</div>" +
        '<div class="field" style="margin-top:1.25rem">' +
          '<label class="field-label" for="confirmar-eliminacion">' +
            "Para confirmar, escribí <strong>ELIMINAR</strong></label>" +
          '<input type="text" id="confirmar-eliminacion" class="form-control" ' +
                 'autocomplete="off" autocapitalize="characters" spellcheck="false">' +
        "</div>" +
        '<div class="modal-card-footer" style="border:0;background:none;padding-inline:0">' +
          '<button type="button" class="btn btn-secondary" data-action="cerrarModal">Cancelar</button>' +
          '<button type="button" class="btn btn-danger-soft" id="btn-confirmar-eliminacion" ' +
                  'data-action="confirmarEliminarCuenta">' +
            '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> Eliminar definitivamente' +
          "</button>" +
        "</div>"
      );
    },

    confirmarEliminacion: function () {
      var campo = document.getElementById("confirmar-eliminacion");
      if (!campo || campo.value.trim().toUpperCase() !== "ELIMINAR") {
        UI.toast("Escribí ELIMINAR para confirmar", "warning");
        if (campo) campo.focus();
        return;
      }

      var usuario = Api.usuario();
      var boton = document.getElementById("btn-confirmar-eliminacion");
      var textoBoton = boton ? boton.innerHTML : "";
      if (boton) {
        boton.disabled = true;
        boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Eliminando…';
      }

      Api.rpc("eliminar_mi_cuenta")
        .then(function () {
          // La clave de notas de este dispositivo ya no abre nada: se olvida.
          if (usuario && global.OdontoCripto) global.OdontoCripto.olvidarClave(usuario.id);
          if (global.OdontoSync) {
            global.OdontoSync.activo = false;
            global.OdontoSync.clave = null;
          }
          // La cuenta ya no existe; cerrarSesion limpia lo local y tolera
          // que el servidor rechace el aviso de salida.
          return Api.cerrarSesion();
        })
        .then(function () {
          UI.closeModal("modal-generico");
          UI.closeModal("modal-cuenta");
          if (global.OdontoSync) global.OdontoSync.pintarPanel();
          UI.toast("Tu cuenta y sus datos fueron eliminados", "success");
        })
        .catch(function (error) {
          UI.toast(error.message, "danger");
          if (boton) {
            boton.disabled = false;
            boton.innerHTML = textoBoton;
          }
        });
    }
  };

  global.OdontoAuth = OdontoAuth;
})(window);
