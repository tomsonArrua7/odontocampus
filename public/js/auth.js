/* ==========================================================================
   ODONTOCAMPUS — CUENTAS
   Registro, ingreso con contraseña, confirmación y recuperación por correo,
   y el panel de Mi cuenta.

   --------------------------------------------------------------------------
   EL CORREO SE USA DOS VECES, NO CADA VEZ QUE SE ENTRA

   1. Al crear la cuenta, para confirmar que la dirección es de quien la
      escribe. Una sola vez.
   2. Si alguien olvida la contraseña, para elegir una nueva.

   Los dos correos traen un botón que abre el sitio con un token en la
   dirección: https://odontocampus.com.ar/?cuenta=confirmar&token=...
   El sitio lo lee, lo borra de la barra de direcciones y lo canjea.

   --------------------------------------------------------------------------
   POR QUÉ EL TOKEN LO CANJEA EL SITIO Y NO EL ENLACE DE SUPABASE

   Los antivirus de correo (Outlook, Gmail corporativo, los de algunos
   celulares) abren cada enlace antes que la persona, para revisarlo. Si el
   botón apuntara al enlace de Supabase, ese primer vistazo gastaría el token
   y a la persona le llegaría un "enlace vencido" que nunca usó.

   · Confirmar: se canjea al cargar la página. Si un antivirus llega a
     ejecutar el sitio y lo gasta, la cuenta igual queda confirmada, y la
     pantalla le dice a la persona que ingrese con su contraseña.
   · Recuperar: se canjea recién cuando la persona escribe la contraseña
     nueva y toca Guardar. Un antivirus no completa formularios.

   --------------------------------------------------------------------------
   EL LOGIN SUMA, NO TAPA

   Mesas, reválidas, historias clínicas, instrumental y biblioteca siguen
   abiertas sin cuenta. Lo único que la pide es Mi promedio, porque guarda
   datos de la persona (ver js/carrera.js).
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var Api = global.OdontoApi;
  var CONFIG = global.ODONTO_CONFIG;
  var esc = UI.esc;

  var EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var TOKEN_VALIDO = /^[A-Za-z0-9_-]{16,256}$/;

  /* El reenvío se habilita a los 60 segundos, que es exactamente lo que exige
     el servidor (GOTRUE_SMTP_MAX_FREQUENCY en el override de Supabase). Si
     fueran distintos, la persona tocaría "Reenviar" y recibiría un error.
     Cambiar uno obliga a cambiar el otro. */
  var SEGUNDOS_REENVIO = 60;

  var TITULOS = {
    ingresar: "Ingresar a OdontoCampus",
    registro: "Crear mi cuenta",
    olvide: "Recuperar mi contraseña",
    correo: "Revisá tu correo"
  };

  function campo(id) { return document.getElementById(id); }
  function valor(id) { var el = campo(id); return el ? el.value : ""; }

  function nombreDe(usuario) {
    if (!usuario) return "";
    return (usuario.user_metadata && usuario.user_metadata.nombre_visible) ||
           (usuario.email || "").split("@")[0];
  }

  /** Pone un botón en espera y devuelve la función que lo restituye. */
  function ocupar(boton, texto) {
    if (!boton) return function () {};
    var original = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> ' + esc(texto);
    return function () {
      boton.disabled = false;
      boton.innerHTML = original;
    };
  }

  /**
   * Cuán adivinable es una contraseña.
   *
   * Informa, no bloquea (salvo el largo mínimo, que exige el servidor):
   * bloquear contraseñas "débiles" frustra y empuja a la gente a anotarlas en
   * cualquier lado. Las realmente malas las frena el servidor, que las
   * compara contra filtraciones conocidas.
   */
  function evaluarClave(texto) {
    var minimo = CONFIG.minLargoClave;
    if (texto.length < minimo) {
      var faltan = minimo - texto.length;
      return { nivel: "corta", texto: "Te faltan " + faltan + (faltan === 1 ? " carácter" : " caracteres") };
    }

    var tipos = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(function (r) {
      return r.test(texto);
    }).length;
    var obvia = /^(.)\1+$/.test(texto) ||
                /^(?:0123|1234|abcd|qwer|asdf|pass|contra|odonto|unlp|foe)/i.test(texto);

    if (obvia || (tipos === 1 && texto.length < 12)) {
      return { nivel: "debil", texto: "Fácil de adivinar. Probá con una frase de varias palabras." };
    }
    if (texto.length >= 14 || (texto.length >= 10 && tipos >= 3)) {
      return { nivel: "fuerte", texto: "Buena contraseña" };
    }
    return { nivel: "media", texto: "Aceptable. Cuanto más larga, más segura." };
  }

  var OdontoAuth = {
    vista: "ingresar",
    correo: { tipo: null, email: "" },
    reenvioHasta: 0,
    temporizador: null,
    tokenRecuperacion: null,
    recuperacionCanjeada: false,
    modoClaveNueva: "cambiar",

    /* ====================================================================
       ARRANQUE
       ==================================================================== */
    init: function () {
      var self = this;

      UI.registerActions({
        abrirAcceso: function (data) { self.abrir(data.vista || "ingresar"); },
        cerrarAcceso: function () { UI.closeModal("modal-acceso"); },
        irAVista: function (data) { self.mostrarVista(data.vista); },
        reenviarCorreo: function () { self.reenviar(); },
        alternarClave: function (data, el) { self.alternarVisibilidad(el); },
        abrirCuenta: function () { self.abrirPanelCuenta(); },
        cerrarCuenta: function () { UI.closeModal("modal-cuenta"); },
        abrirCambioClave: function () { self.abrirClaveNueva("cambiar"); },
        cerrarClaveNueva: function () { UI.closeModal("modal-clave-nueva"); },
        cerrarSesion: function () { self.salir(); },
        exportarDatos: function () { self.exportar(); },
        eliminarCuenta: function () { self.eliminar(); },
        confirmarEliminarCuenta: function () { self.confirmarEliminacion(); }
      });

      this.alEnviar("form-ingresar", function () { self.ingresar(); });
      this.alEnviar("form-registro", function () { self.registrar(); });
      this.alEnviar("form-olvide", function () { self.pedirRecuperacion(); });
      this.alEnviar("form-clave-nueva", function () { self.guardarClaveNueva(); });

      this.medirClave("registro-clave", "registro-clave-fuerza");
      this.medirClave("clave-nueva", "clave-nueva-fuerza");

      // El texto de qué se guarda es uno solo, y lo tiene js/carrera.js.
      var terminos = campo("registro-terminos");
      if (terminos && global.OdontoCarrera) terminos.innerHTML = global.OdontoCarrera.htmlTerminos();

      Api.alCambiarSesion(function () { self.pintarEncabezado(); });
      this.pintarEncabezado();
    },

    alEnviar: function (idForm, fn) {
      var form = campo(idForm);
      if (!form) return;
      UI.on(form, "submit", function (ev) {
        ev.preventDefault();
        fn();
      });
    },

    medirClave: function (idCampo, idSalida) {
      var entrada = campo(idCampo);
      var salida = campo(idSalida);
      if (!entrada || !salida) return;
      UI.on(entrada, "input", function () {
        if (!entrada.value) { salida.hidden = true; return; }
        var evaluacion = evaluarClave(entrada.value);
        salida.hidden = false;
        salida.className = "clave-fuerza clave-" + evaluacion.nivel;
        salida.textContent = evaluacion.texto;
      });
    },

    /* ====================================================================
       ENCABEZADO
       ==================================================================== */
    pintarEncabezado: function () {
      var contenedor = campo("zona-cuenta");
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

      var nombre = nombreDe(usuario);
      var inicial = nombre.charAt(0).toUpperCase();

      contenedor.innerHTML =
        '<button type="button" class="btn-cuenta btn-cuenta-activa" data-action="abrirCuenta" ' +
                'aria-label="Mi cuenta: ' + esc(nombre) + '">' +
          '<span class="avatar-inicial" aria-hidden="true">' + esc(inicial) + "</span>" +
          "<span>" + esc(nombre) + "</span>" +
        "</button>";
    },

    /* ====================================================================
       MODAL DE ACCESO: cuatro vistas en un solo diálogo
       ==================================================================== */
    abrir: function (vista) {
      this.mostrarVista(vista || "ingresar");
      UI.openModal("modal-acceso", this.focoDeVista(vista || "ingresar"));
    },

    focoDeVista: function (vista) {
      return {
        ingresar: "#ingresar-email",
        registro: "#registro-nombre",
        olvide: "#olvide-email",
        // No el de reenviar: arranca deshabilitado y no puede recibir el foco.
        correo: "#btn-correo-volver"
      }[vista];
    },

    mostrarVista: function (vista, opciones) {
      opciones = opciones || {};
      if (!TITULOS[vista]) vista = "ingresar";

      // Lo que se escribió en una vista se lleva a la otra: nadie quiere
      // tipear su correo tres veces.
      var emailActual = valor("ingresar-email") || valor("registro-email") || valor("olvide-email");
      ["ingresar-email", "registro-email", "olvide-email"].forEach(function (id) {
        var el = campo(id);
        if (el && !el.value && emailActual) el.value = emailActual;
      });

      Object.keys(TITULOS).forEach(function (nombre) {
        var bloque = campo("vista-" + nombre);
        if (bloque) bloque.hidden = nombre !== vista;
      });

      var titulo = campo("acceso-titulo");
      if (titulo) titulo.textContent = TITULOS[vista];

      if (!opciones.conservarAviso) this.ocultarAviso();
      this.reiniciarClaves(campo("modal-acceso"));
      this.vista = vista;

      // Mover el foco sólo si el diálogo ya está abierto; al abrirlo lo
      // resuelve openModal.
      var modal = campo("modal-acceso");
      if (modal && modal.classList.contains("active")) {
        var foco = document.querySelector(this.focoDeVista(vista));
        if (foco) global.setTimeout(function () { foco.focus(); }, 60);
      }
    },

    mostrarAviso: function (texto, tipo) {
      var aviso = campo("acceso-aviso");
      var parrafo = campo("acceso-aviso-texto");
      if (!aviso || !parrafo) { UI.toast(texto, "warning"); return; }
      aviso.className = "callout callout-" + (tipo === "info" ? "info" : "warning") + " aviso-acceso";
      parrafo.textContent = texto;
      aviso.hidden = false;
      UI.announce(texto);
    },

    ocultarAviso: function () {
      var aviso = campo("acceso-aviso");
      if (aviso) aviso.hidden = true;
    },

    alternarVisibilidad: function (boton) {
      var entrada = campo(boton.getAttribute("data-campo"));
      if (!entrada) return;
      var mostrar = entrada.type === "password";
      entrada.type = mostrar ? "text" : "password";
      boton.setAttribute("aria-pressed", mostrar ? "true" : "false");
      boton.setAttribute("aria-label", mostrar ? "Ocultar la contraseña" : "Mostrar la contraseña");
      boton.innerHTML = '<i class="fa-regular ' + (mostrar ? "fa-eye-slash" : "fa-eye") + '" aria-hidden="true"></i>';
    },

    /** Al cambiar de vista o cerrar, toda contraseña vuelve a quedar tapada. */
    reiniciarClaves: function (contenedor) {
      if (!contenedor) return;
      UI.$$('[data-action="alternarClave"]', contenedor).forEach(function (boton) {
        var entrada = campo(boton.getAttribute("data-campo"));
        if (entrada) entrada.type = "password";
        boton.setAttribute("aria-pressed", "false");
        boton.setAttribute("aria-label", "Mostrar la contraseña");
        boton.innerHTML = '<i class="fa-regular fa-eye" aria-hidden="true"></i>';
      });
    },

    /* ====================================================================
       INGRESAR
       ==================================================================== */
    ingresar: function () {
      var self = this;
      var email = valor("ingresar-email").trim().toLowerCase();
      var clave = campo("ingresar-clave");

      if (!EMAIL_VALIDO.test(email)) {
        this.mostrarAviso("Revisá la dirección de correo.");
        campo("ingresar-email").focus();
        return;
      }
      if (!clave.value) {
        this.mostrarAviso("Escribí tu contraseña.");
        clave.focus();
        return;
      }

      var liberar = ocupar(campo("btn-ingresar"), "Ingresando…");

      Api.ingresar(email, clave.value)
        .then(function (usuario) {
          clave.value = "";
          UI.closeModal("modal-acceso");
          UI.toast("¡Hola, " + nombreDe(usuario) + "!", "success");
        })
        .catch(function (error) {
          if (error.codigo === "email_not_confirmed") {
            clave.value = "";
            self.mostrarCorreoEnviado("confirmacion", email, {
              sinEspera: true,
              aviso: "Todavía no confirmaste tu correo. Buscá el correo que te mandamos " +
                     "al crear la cuenta, o pedí uno nuevo con el botón de abajo."
            });
            return;
          }
          self.mostrarAviso(error.message);
          if (error.codigo === "invalid_credentials") {
            clave.value = "";
            clave.focus();
          }
        })
        .then(liberar);
    },

    /* ====================================================================
       CREAR CUENTA
       ==================================================================== */
    registrar: function () {
      var self = this;
      var nombre = valor("registro-nombre").trim();
      var email = valor("registro-email").trim().toLowerCase();
      var clave = campo("registro-clave");
      var acepta = campo("registro-acepto");

      if (nombre.length < 2 || nombre.length > 60) {
        this.mostrarAviso("Contanos cómo querés que te llamemos (entre 2 y 60 letras).");
        campo("registro-nombre").focus();
        return;
      }
      if (!EMAIL_VALIDO.test(email)) {
        this.mostrarAviso("Revisá la dirección de correo.");
        campo("registro-email").focus();
        return;
      }
      if (clave.value.length < CONFIG.minLargoClave) {
        this.mostrarAviso("La contraseña necesita al menos " + CONFIG.minLargoClave + " caracteres.");
        clave.focus();
        return;
      }
      if (!acepta.checked) {
        this.mostrarAviso("Para crear la cuenta, leé qué se guarda y marcá la casilla.");
        acepta.focus();
        return;
      }

      var liberar = ocupar(campo("btn-registro"), "Creando tu cuenta…");

      Api.registrarse({ nombre: nombre, email: email, clave: clave.value })
        .then(function (resultado) {
          clave.value = "";
          acepta.checked = false;
          var fuerza = campo("registro-clave-fuerza");
          if (fuerza) fuerza.hidden = true;

          if (resultado.conSesion) {
            UI.closeModal("modal-acceso");
            UI.toast("¡Bienvenida/o, " + nombre + "!", "success");
            return;
          }
          self.mostrarCorreoEnviado("confirmacion", email);
        })
        .catch(function (error) {
          self.mostrarAviso(error.message);
          if (error.codigo === "weak_password") clave.focus();
        })
        .then(liberar);
    },

    /* ====================================================================
       OLVIDÉ MI CONTRASEÑA
       ==================================================================== */
    pedirRecuperacion: function () {
      var self = this;
      var email = valor("olvide-email").trim().toLowerCase();

      if (!EMAIL_VALIDO.test(email)) {
        this.mostrarAviso("Revisá la dirección de correo.");
        campo("olvide-email").focus();
        return;
      }

      var liberar = ocupar(campo("btn-olvide"), "Enviando…");

      Api.pedirRecuperacion(email)
        .then(function () { self.mostrarCorreoEnviado("recuperacion", email); })
        .catch(function (error) { self.mostrarAviso(error.message); })
        .then(liberar);
    },

    /* ====================================================================
       "REVISÁ TU CORREO"
       ==================================================================== */
    mostrarCorreoEnviado: function (tipo, email, opciones) {
      opciones = opciones || {};
      this.correo = { tipo: tipo, email: email };

      var destino = campo("correo-destino");
      if (destino) destino.textContent = email;

      var explicacion = campo("correo-explicacion");
      var nota = campo("correo-nota");
      var volver = campo("btn-correo-volver");

      if (tipo === "confirmacion") {
        if (explicacion) {
          explicacion.innerHTML = "Tocá el botón <strong>Confirmar mi cuenta</strong> del correo " +
            "y listo: entrás directo. Es la única vez que te lo pedimos.";
        }
        /* Supabase no avisa si el correo ya tenía cuenta (así nadie puede
           averiguar qué direcciones están registradas). Lo decimos acá para
           que nadie espere un correo que no va a llegar. */
        if (nota) {
          nota.textContent = "¿Ya tenías una cuenta con este correo? Entonces no te llega " +
            "nada: ingresá con tu contraseña, o recuperala si no te la acordás.";
        }
        if (volver) volver.textContent = "Ya confirmé: ingresar";
      } else {
        if (explicacion) {
          explicacion.innerHTML = "Tocá el botón <strong>Elegir contraseña nueva</strong> del " +
            "correo. Sirve una sola vez y vence en una hora.";
        }
        if (nota) {
          nota.textContent = "Si no hay ninguna cuenta con este correo, no te va a llegar nada.";
        }
        if (volver) volver.textContent = "Volver a ingresar";
      }

      if (opciones.sinEspera) {
        this.reenvioHasta = 0;
        global.clearInterval(this.temporizador);
        this.pintarReenvio();
      } else {
        this.arrancarCuentaRegresiva();
      }

      this.mostrarVista("correo", { conservarAviso: !!opciones.aviso });
      if (opciones.aviso) this.mostrarAviso(opciones.aviso, "info");
    },

    reenviar: function () {
      var self = this;
      if (!this.correo.email || Date.now() < this.reenvioHasta) return;

      var pedido = this.correo.tipo === "confirmacion"
        ? Api.reenviarConfirmacion(this.correo.email)
        : Api.pedirRecuperacion(this.correo.email);

      var liberar = ocupar(campo("btn-reenviar"), "Enviando…");

      pedido
        .then(function () {
          liberar();
          self.ocultarAviso();
          UI.toast("Te mandamos otro correo", "success");
          self.arrancarCuentaRegresiva();
        })
        .catch(function (error) {
          liberar();
          self.mostrarAviso(error.message);
          self.pintarReenvio();
        });
    },

    arrancarCuentaRegresiva: function () {
      var self = this;
      this.reenvioHasta = Date.now() + SEGUNDOS_REENVIO * 1000;
      global.clearInterval(this.temporizador);
      this.pintarReenvio();
      this.temporizador = global.setInterval(function () {
        if (!self.pintarReenvio()) global.clearInterval(self.temporizador);
      }, 1000);
    },

    /** Devuelve true mientras siga la cuenta regresiva. */
    pintarReenvio: function () {
      var boton = campo("btn-reenviar");
      if (!boton) return false;
      var faltan = Math.ceil((this.reenvioHasta - Date.now()) / 1000);
      if (faltan > 0) {
        boton.disabled = true;
        boton.textContent = "Reenviar en " + faltan + " s";
        return true;
      }
      boton.disabled = false;
      boton.textContent = "Reenviar el correo";
      return false;
    },

    /* ====================================================================
       LLEGADA DESDE UN CORREO
       Lo llama app.js al arrancar, antes de aplicar la ruta.
       ==================================================================== */
    procesarEnlaceDeCorreo: function () {
      var busqueda;
      try { busqueda = new URLSearchParams(global.location.search); } catch (e) { return; }

      var accion = busqueda.get("cuenta");
      var token = busqueda.get("token");
      if (!accion) return;

      /* El token se saca de la barra de direcciones antes que nada: así no
         queda en el historial, ni en un favorito, ni en una captura de
         pantalla que alguien comparta pidiendo ayuda. */
      global.history.replaceState(null, "", global.location.pathname + global.location.hash);

      if (!token || !TOKEN_VALIDO.test(token) || !Api.hayBackend()) return;

      if (accion === "confirmar") {
        this.confirmarCuenta(token);
      } else if (accion === "recuperar") {
        this.tokenRecuperacion = token;
        this.recuperacionCanjeada = false;
        this.abrirClaveNueva("recuperar");
      }
    },

    confirmarCuenta: function (token) {
      var self = this;
      UI.toast("Confirmando tu cuenta…", "info");

      Api.verificarEnlace("signup", token)
        .then(function (usuario) {
          UI.toast("¡Listo, " + nombreDe(usuario) + "! Tu cuenta quedó confirmada.", "success");
          if (global.OdontoApp) global.OdontoApp.navegarA("carrera");
        })
        .catch(function (error) {
          if (!error.estado) {
            UI.toast(error.message + " Después volvé a tocar el botón del correo.", "danger");
            return;
          }
          self.abrir("ingresar");
          self.mostrarAviso(
            "Ese botón ya se usó o venció. Si ya confirmaste tu cuenta, ingresá con tu " +
            "correo y tu contraseña. Si no, ingresá igual y te ofrecemos mandarte otro.",
            "info"
          );
        });
    },

    /* ====================================================================
       CONTRASEÑA NUEVA (desde el correo de recuperación, o desde Mi cuenta)
       ==================================================================== */
    abrirClaveNueva: function (modo) {
      this.modoClaveNueva = modo;
      var cambiar = modo === "cambiar";
      var usuario = Api.usuario();

      var titulo = campo("clave-nueva-titulo");
      if (titulo) titulo.textContent = cambiar ? "Cambiar mi contraseña" : "Elegí tu contraseña nueva";

      var ayuda = campo("clave-nueva-ayuda");
      if (ayuda) {
        ayuda.textContent = cambiar
          ? "Por seguridad, primero escribí la que usás ahora."
          : "Escribila y tocá Guardar. Con eso ya quedás adentro de tu cuenta.";
      }

      var bloqueActual = campo("bloque-clave-actual");
      var actual = campo("clave-actual");
      if (bloqueActual) bloqueActual.hidden = !cambiar;
      if (actual) { actual.value = ""; actual.required = cambiar; }

      // Para que el gestor de contraseñas sepa de qué cuenta es la clave nueva.
      var usuarioOculto = campo("clave-nueva-usuario");
      if (usuarioOculto) usuarioOculto.value = usuario && usuario.email ? usuario.email : "";

      var nueva = campo("clave-nueva");
      if (nueva) nueva.value = "";
      var fuerza = campo("clave-nueva-fuerza");
      if (fuerza) fuerza.hidden = true;
      this.avisoClaveNueva("");
      this.reiniciarClaves(campo("modal-clave-nueva"));

      UI.openModal("modal-clave-nueva", cambiar ? "#clave-actual" : "#clave-nueva");
    },

    avisoClaveNueva: function (texto) {
      var aviso = campo("clave-nueva-aviso");
      var parrafo = campo("clave-nueva-aviso-texto");
      if (!aviso || !parrafo) { if (texto) UI.toast(texto, "warning"); return; }
      parrafo.textContent = texto;
      aviso.hidden = !texto;
      if (texto) UI.announce(texto);
    },

    guardarClaveNueva: function () {
      var self = this;
      var modo = this.modoClaveNueva;
      var nueva = valor("clave-nueva");

      if (nueva.length < CONFIG.minLargoClave) {
        this.avisoClaveNueva("La contraseña necesita al menos " + CONFIG.minLargoClave + " caracteres.");
        campo("clave-nueva").focus();
        return;
      }

      var paso;
      if (modo === "recuperar") {
        if (!this.tokenRecuperacion) return;
        /* Si el canje ya salió bien y lo que falló fue guardar (por ejemplo,
           una contraseña filtrada), no se vuelve a canjear: el token sirve
           una sola vez, y la sesión ya está abierta. */
        paso = this.recuperacionCanjeada
          ? Promise.resolve()
          : Api.verificarEnlace("recovery", this.tokenRecuperacion).then(function () {
              self.recuperacionCanjeada = true;
            });
      } else {
        var usuario = Api.usuario();
        var actual = valor("clave-actual");
        if (!usuario) return;
        if (!actual) {
          this.avisoClaveNueva("Escribí tu contraseña actual.");
          campo("clave-actual").focus();
          return;
        }
        paso = Api.ingresar(usuario.email, actual).catch(function (error) {
          if (error.codigo === "invalid_credentials") {
            error.message = "La contraseña actual no es correcta.";
          }
          throw error;
        });
      }

      var liberar = ocupar(campo("btn-clave-nueva"), "Guardando…");

      paso
        .then(function () { return Api.cambiarClave(nueva); })
        .then(function () {
          liberar();
          UI.closeModal("modal-clave-nueva");
          self.tokenRecuperacion = null;
          self.recuperacionCanjeada = false;
          UI.toast(modo === "recuperar"
            ? "Listo: ya tenés contraseña nueva y estás adentro."
            : "Listo: cambiaste tu contraseña.", "success");
        })
        .catch(function (error) {
          liberar();
          if (modo === "recuperar" && !self.recuperacionCanjeada && error.estado) {
            UI.closeModal("modal-clave-nueva");
            self.tokenRecuperacion = null;
            self.abrir("olvide");
            self.mostrarAviso("Ese botón ya se usó o venció. Pedí un correo nuevo acá abajo.", "info");
            return;
          }
          self.avisoClaveNueva(error.message);
        });
    },

    /* ====================================================================
       MI CUENTA
       ==================================================================== */
    abrirPanelCuenta: function () {
      var usuario = Api.usuario();
      if (!usuario) return;

      var nombre = campo("cuenta-nombre");
      if (nombre) nombre.textContent = nombreDe(usuario);
      var correo = campo("cuenta-email");
      if (correo) correo.textContent = usuario.email || "";

      UI.openModal("modal-cuenta");
    },

    salir: function () {
      var usuario = Api.usuario();
      var carrera = global.OdontoCarrera;
      var antes = carrera ? carrera.antesDeSalir() : Promise.resolve(true);

      antes.then(function (seguir) {
        if (!seguir) return;
        return Api.cerrarSesion().then(function () {
          /* Las materias guardadas en este navegador se borran al salir: en
             una computadora compartida (la de la biblioteca, la de un
             compañero) no tienen por qué quedar. Siguen en la cuenta. */
          if (usuario && carrera) carrera.limpiarLocal(usuario.id);
          UI.closeModal("modal-cuenta");
          UI.toast("Cerraste sesión", "info");
        });
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
        Api.rpc("mi_perfil"),
        Api.seleccionar("consentimientos", "select=*"),
        Api.seleccionar("materias_cursadas", "select=*")
      ]).then(function (partes) {
        var paquete = {
          exportado_el: new Date().toISOString(),
          cuenta: { id: usuario.id, email: usuario.email, creada: usuario.created_at },
          perfil: partes[0],
          consentimientos: partes[1],
          materias: partes[2]
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
        // Un paquete a medias no es "todos tus datos": si algo falla, no se descarga nada.
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
        "materias y notas, consentimientos y publicaciones. " +
        "<strong>No se puede deshacer.</strong></p>" +
        '<div class="callout callout-info" style="margin-top:1.25rem">' +
          '<i class="fa-solid fa-download" aria-hidden="true"></i>' +
          "<div><h3>¿Querés guardarte una copia antes?</h3>" +
          "<p>Cerrá esto y usá <strong>Descargar mis datos</strong> en Mi cuenta.</p></div>" +
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
      var entrada = campo("confirmar-eliminacion");
      if (!entrada || entrada.value.trim().toUpperCase() !== "ELIMINAR") {
        UI.toast("Escribí ELIMINAR para confirmar", "warning");
        if (entrada) entrada.focus();
        return;
      }

      var usuario = Api.usuario();
      var liberar = ocupar(campo("btn-confirmar-eliminacion"), "Eliminando…");

      Api.rpc("eliminar_mi_cuenta")
        .then(function () {
          if (usuario && global.OdontoCarrera) global.OdontoCarrera.limpiarLocal(usuario.id);
          // La cuenta ya no existe; cerrarSesion limpia lo local y tolera
          // que el servidor rechace el aviso de salida.
          return Api.cerrarSesion();
        })
        .then(function () {
          UI.closeModal("modal-generico");
          UI.closeModal("modal-cuenta");
          UI.toast("Tu cuenta y sus datos fueron eliminados", "success");
        })
        .catch(function (error) {
          liberar();
          UI.toast(error.message, "danger");
        });
    }
  };

  global.OdontoAuth = OdontoAuth;
})(window);
