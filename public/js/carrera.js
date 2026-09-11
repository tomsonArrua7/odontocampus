/* ==========================================================================
   ODONTOCAMPUS — MI PROMEDIO CON CUENTA
   Quién puede entrar a la sección, y cómo viajan las materias entre este
   navegador y la cuenta.

   --------------------------------------------------------------------------
   POR QUÉ PIDE CUENTA

   Guarda datos de la persona: qué materias aprobó, con qué nota, cuántos
   aplazos. Con cuenta, esos datos la siguen al celular y a la compu, y no
   quedan tirados en una computadora compartida. El resto del sitio sigue
   abierto sin cuenta.

   --------------------------------------------------------------------------
   LA CUENTA MANDA, PERO EL PASILLO NO TIENE SEÑAL

   · La fuente de verdad es la tabla `materias_cursadas`, una fila por materia.
   · Este navegador guarda una copia por usuario, para mostrar el promedio sin
     conexión y para no perder un cambio si se corta el wifi.
   · Cada cambio queda marcado como pendiente hasta que el servidor confirma
     que lo guardó. Si no hay conexión, se reintenta solo, y al volver a
     abrir el sitio lo pendiente se sube antes de traer lo del servidor.
   · Si dos dispositivos cambian la misma materia sin conexión, gana el que
     se conecta último. Pasa poco, y en ese caso se pierde una edición de una
     materia, no el promedio entero.

   --------------------------------------------------------------------------
   LO QUE SE LE DICE A CADA PERSONA

   Está en htmlTerminos(), que es el único lugar con ese texto: lo muestran
   el formulario de registro y el aviso previo a la primera carga. Si se
   cambia, se sube `versionTerminos` en js/config.js y se vuelve a pedir.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var Api = global.OdontoApi;
  var CONFIG = global.ODONTO_CONFIG;
  var esc = UI.esc;

  var PREFIJO_COPIA = "odontocampus_carrera_v2_";
  var PREFIJO_PENDIENTES = "odontocampus_carrera_pendientes_v2_";
  // Donde la calculadora guardaba las notas antes de que existieran las cuentas.
  var CLAVE_ANTERIOR = "odontocampus_calificaciones_v1";

  var ESTADOS_VALIDOS = { cursando: true, regular: true, aprobada: true };
  var ID_VALIDO = /^[A-Za-z0-9_-]{1,40}$/;
  var RETARDO_GUARDADO = 1200;
  var RETARDO_REINTENTO = 20000;

  function nada() {}

  function leerJSON(clave) {
    try {
      var crudo = localStorage.getItem(clave);
      var datos = crudo ? JSON.parse(crudo) : null;
      return datos && typeof datos === "object" ? datos : {};
    } catch (e) {
      return {};
    }
  }

  function escribirJSON(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
  }

  function quitar(clave) {
    try { localStorage.removeItem(clave); } catch (e) { /* nada que hacer */ }
  }

  /** Deja un registro con la forma que acepta la base, o null si no sirve. */
  function normalizar(registro) {
    if (!registro || !ESTADOS_VALIDOS[registro.estado]) return null;
    var nota = registro.estado === "aprobada" ? parseFloat(registro.nota) : NaN;
    return {
      estado: registro.estado,
      nota: nota >= 4 && nota <= 10 ? nota : null,
      aplazos: Math.min(30, Math.max(0, parseInt(registro.aplazos, 10) || 0)),
      fechaActualizacion: registro.fechaActualizacion || new Date().toISOString()
    };
  }

  function ocupar(boton, texto) {
    if (!boton) return nada;
    var original = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> ' + esc(texto);
    return function () {
      boton.disabled = false;
      boton.innerHTML = original;
    };
  }

  function puerta(icono, titulo, cuerpo) {
    return (
      '<div class="puerta-carrera">' +
        '<span class="puerta-icono" aria-hidden="true"><i class="fa-solid ' + icono + '"></i></span>' +
        "<h3>" + esc(titulo) + "</h3>" +
        cuerpo +
      "</div>"
    );
  }

  var OdontoCarrera = {
    usuarioId: null,
    notas: {},
    pendientes: {},
    preparado: false,
    cargando: false,
    enVuelo: null,
    otraVuelta: false,
    temporizador: null,
    reintento: null,

    /* ====================================================================
       ARRANQUE Y SESIÓN
       ==================================================================== */
    init: function () {
      var self = this;

      UI.registerActions({
        aceptarTerminos: function (data, el) { self.aceptarTerminos(el); },
        reintentarCarrera: function () { self.preparado = false; self.mostrar(); },
        importarNotasAnteriores: function () { self.importarAnteriores(); },
        descartarNotasAnteriores: function () { self.descartarAnteriores(); }
      });

      var usuario = Api.usuario();
      this.cambiarUsuario(usuario ? usuario.id : null);

      Api.alCambiarSesion(function (sesion) {
        var id = sesion && sesion.usuario ? sesion.usuario.id : null;
        // La sesión también se reescribe al renovar el token: sólo interesa
        // cuando cambia la persona.
        if (id === self.usuarioId) return;
        self.cambiarUsuario(id);
        if (self.visible()) self.mostrar();
      });

      UI.on(global, "online", function () { self.subirPendientes().catch(nada); });

      // Cambios de una visita anterior que no llegaron a subirse.
      if (this.usuarioId && Object.keys(this.pendientes).length) this.programarGuardado(0);
    },

    cambiarUsuario: function (id) {
      this.cancelarTemporizadores();
      this.usuarioId = id;
      this.preparado = false;
      this.cargando = false;
      this.notas = id ? leerJSON(PREFIJO_COPIA + id) : {};
      this.pendientes = id ? leerJSON(PREFIJO_PENDIENTES + id) : {};
    },

    visible: function () {
      var seccion = document.getElementById("seccion-carrera");
      return !!seccion && seccion.classList.contains("active");
    },

    cancelarTemporizadores: function () {
      global.clearTimeout(this.temporizador);
      global.clearTimeout(this.reintento);
    },

    /* ====================================================================
       COPIA LOCAL (la usa js/calculator.js)
       ==================================================================== */
    leerCopia: function () {
      // Copia: la calculadora modifica el objeto que recibe.
      return JSON.parse(JSON.stringify(this.notas));
    },

    escribirCopia: function (notas) {
      if (!this.usuarioId) return;
      this.notas = notas;
      this.persistir();
    },

    persistir: function () {
      if (!this.usuarioId) return;
      escribirJSON(PREFIJO_COPIA + this.usuarioId, this.notas);
      escribirJSON(PREFIJO_PENDIENTES + this.usuarioId, this.pendientes);
    },

    /**
     * Se llama al cerrar sesión o eliminar la cuenta. No cambia de usuario:
     * eso lo hace el aviso de sesión cuando la sesión se cierra de verdad.
     */
    limpiarLocal: function (id) {
      quitar(PREFIJO_COPIA + id);
      quitar(PREFIJO_PENDIENTES + id);
      if (this.usuarioId === id) {
        this.cancelarTemporizadores();
        this.notas = {};
        this.pendientes = {};
        this.preparado = false;
      }
    },

    /* ====================================================================
       QUÉ SE VE EN LA SECCIÓN
       ==================================================================== */
    mostrar: function () {
      if (!document.getElementById("carrera-acceso")) return;

      if (!Api.hayBackend()) { this.pintarAcceso("sin-backend"); return; }
      if (!this.usuarioId) { this.pintarAcceso("sin-sesion"); return; }
      if (this.preparado) { this.abrirPanel(); return; }
      if (!this.cargando) this.preparar();
    },

    preparar: function () {
      var self = this;
      var uid = this.usuarioId;

      this.cargando = true;
      this.pintarAcceso("cargando");

      var consulta = "select=id&tipo=eq.terminos&revocado_at=is.null&limit=1" +
                     "&version_texto=eq." + encodeURIComponent(CONFIG.versionTerminos);

      Api.seleccionar("consentimientos", consulta)
        .then(function (filas) {
          if (uid !== self.usuarioId) return;
          if (!filas || !filas.length) {
            // Cuentas creadas antes de este texto, o si el texto cambió.
            self.cargando = false;
            self.pintarAcceso("terminos");
            return;
          }
          return self.traer(uid);
        })
        .catch(function (error) {
          if (uid !== self.usuarioId) return;
          self.cargando = false;

          // Sin conexión pero con la copia de la última visita: se muestra igual.
          if (!error.estado && Object.keys(self.notas).length) {
            self.preparado = true;
            self.abrirPanel();
            self.pintarEstado("sin-conexion");
            return;
          }
          self.pintarAcceso("error", error.message);
        });
    },

    traer: function (uid) {
      var self = this;

      // Primero se sube lo pendiente: si no, lo del servidor lo taparía.
      return this.subirPendientes()
        .catch(nada)
        .then(function () {
          return Api.seleccionar("materias_cursadas", "select=materia_id,estado,nota,aplazos,actualizado_at");
        })
        .then(function (filas) {
          if (uid !== self.usuarioId) return;

          var notas = {};
          (filas || []).forEach(function (fila) {
            notas[fila.materia_id] = {
              estado: fila.estado,
              nota: fila.nota === null ? null : Number(fila.nota),
              aplazos: fila.aplazos || 0,
              fechaActualizacion: fila.actualizado_at
            };
          });

          // Lo que no se pudo subir es lo último que tocó la persona: manda.
          Object.keys(self.pendientes).forEach(function (id) {
            if (self.notas[id]) notas[id] = self.notas[id];
            else delete notas[id];
          });

          self.notas = notas;
          self.persistir();
          self.cargando = false;
          self.preparado = true;
          if (self.visible()) self.abrirPanel();
        });
    },

    abrirPanel: function () {
      var acceso = document.getElementById("carrera-acceso");
      var panel = document.getElementById("panel-promedio");
      if (acceso) { acceso.hidden = true; acceso.innerHTML = ""; acceso.removeAttribute("aria-busy"); }
      if (panel) panel.hidden = false;

      if (global.OdontoCalculator) global.OdontoCalculator.renderTabla();
      this.pintarAnteriores();
      this.pintarEstado(Object.keys(this.pendientes).length ? "pendiente" : "guardado");
    },

    /* ====================================================================
       CONSENTIMIENTO
       ==================================================================== */
    htmlTerminos: function () {
      return (
        '<ul class="check-list lista-terminos">' +
          '<li><i class="fa-solid fa-database" aria-hidden="true"></i><span>' +
            "<strong>Qué se guarda:</strong> tu nombre, tu correo y las materias, notas y " +
            "aplazos que cargues.</span></li>" +
          '<li><i class="fa-solid fa-bullseye" aria-hidden="true"></i><span>' +
            "<strong>Para qué:</strong> sólo para mostrarte tu promedio y tu avance. No se usa " +
            "para estadísticas, rankings ni nada más.</span></li>" +
          '<li><i class="fa-solid fa-eye-slash" aria-hidden="true"></i><span>' +
            "<strong>Quién lo ve:</strong> vos. Otros estudiantes no pueden verlo. Quien administra " +
            "el servidor técnicamente puede acceder a la base, como en cualquier sitio.</span></li>" +
          '<li><i class="fa-solid fa-download" aria-hidden="true"></i><span>' +
            "<strong>Es tuyo:</strong> desde Mi cuenta podés descargar todo o eliminar la cuenta " +
            "cuando quieras (Ley 25.326).</span></li>" +
        "</ul>"
      );
    },

    aceptarTerminos: function (boton) {
      var self = this;
      var uid = this.usuarioId;
      if (!uid) return;

      var liberar = ocupar(boton, "Guardando…");

      Api.insertar("consentimientos", {
        usuario_id: uid,
        tipo: "terminos",
        version_texto: CONFIG.versionTerminos
      }).then(function () {
        if (uid === self.usuarioId) self.preparar();
      }, function (error) {
        liberar();
        UI.toast(error.message, "danger");
      });
    },

    /* ====================================================================
       GUARDAR EN LA CUENTA
       ==================================================================== */
    /** La calculadora avisa acá cada vez que cambia una materia. */
    marcarCambio: function (materiaId) {
      if (!this.usuarioId || !ID_VALIDO.test(materiaId)) return;
      this.pendientes[materiaId] = true;
      this.persistir();
      this.pintarEstado("pendiente");
      // Se agrupa: cargar veinte materias seguidas no son veinte pedidos.
      this.programarGuardado(RETARDO_GUARDADO);
    },

    programarGuardado: function (retardo) {
      var self = this;
      global.clearTimeout(this.temporizador);
      this.temporizador = global.setTimeout(function () {
        self.subirPendientes().catch(nada);
      }, retardo);
    },

    subirPendientes: function () {
      var self = this;
      var uid = this.usuarioId;

      if (!uid || !Api.haySesion()) return Promise.resolve();
      if (this.enVuelo) { this.otraVuelta = true; return this.enVuelo; }

      var ids = Object.keys(this.pendientes);
      if (!ids.length) return Promise.resolve();

      var foto = {};
      var filas = [];
      var bajas = [];

      ids.forEach(function (id) {
        foto[id] = JSON.stringify(self.notas[id] || null);
        var registro = normalizar(self.notas[id]);
        if (registro) {
          filas.push({
            usuario_id: uid,
            materia_id: id,
            estado: registro.estado,
            nota: registro.nota,
            aplazos: registro.aplazos
          });
        } else {
          // Pendiente, o sin datos válidos: en la base es no tener fila.
          bajas.push(id);
        }
      });

      var pasos = [];
      if (filas.length) {
        pasos.push(Api.guardar("materias_cursadas", filas, {
          onConflict: "usuario_id,materia_id",
          devolver: false
        }));
      }
      if (bajas.length) {
        pasos.push(Api.borrar("materias_cursadas",
          "usuario_id=eq." + encodeURIComponent(uid) +
          "&materia_id=in.(" + bajas.map(function (id) { return encodeURIComponent('"' + id + '"'); }).join(",") + ")"));
      }

      this.pintarEstado("guardando");

      this.enVuelo = Promise.all(pasos).then(function () {
        self.enVuelo = null;
        if (uid !== self.usuarioId) return;

        /* Sólo deja de estar pendiente lo que no cambió mientras viajaba. Si
           la persona tocó otra vez la misma materia, se vuelve a subir. */
        Object.keys(foto).forEach(function (id) {
          if (JSON.stringify(self.notas[id] || null) === foto[id]) delete self.pendientes[id];
        });
        self.persistir();
        global.clearTimeout(self.reintento);

        if (self.otraVuelta || Object.keys(self.pendientes).length) {
          self.otraVuelta = false;
          self.pintarEstado("pendiente");
          self.programarGuardado(RETARDO_GUARDADO);
        } else {
          self.pintarEstado("guardado");
        }
      }, function (error) {
        self.enVuelo = null;
        self.otraVuelta = false;
        if (uid !== self.usuarioId) throw error;

        global.clearTimeout(self.reintento);
        var sinConexion = !error.estado;
        // Un rechazo de la base (un tope, un dato inválido) no se arregla
        // reintentando. La falta de conexión o un servidor caído, sí.
        var reintentable = sinConexion || error.estado >= 500 || error.estado === 429 || error.estado === 401;

        self.pintarEstado(sinConexion ? "sin-conexion" : "error", error.message);
        if (reintentable) {
          self.reintento = global.setTimeout(function () {
            self.subirPendientes().catch(nada);
          }, RETARDO_REINTENTO);
        }
        throw error;
      });

      return this.enVuelo;
    },

    /** "Borrar mis notas": en la cuenta y en este navegador. */
    borrarTodo: function () {
      var self = this;
      var uid = this.usuarioId;
      if (!uid) return Promise.resolve();

      this.cancelarTemporizadores();

      return (this.enVuelo || Promise.resolve())
        .catch(nada)
        .then(function () {
          return Api.borrar("materias_cursadas", "usuario_id=eq." + encodeURIComponent(uid));
        })
        .then(function () {
          if (uid !== self.usuarioId) return;
          self.notas = {};
          self.pendientes = {};
          self.persistir();
          if (global.OdontoCalculator) global.OdontoCalculator.renderTabla();
          self.pintarEstado("guardado");
          UI.toast("Listo: se borraron todas tus materias", "success");
        }, function (error) {
          UI.toast(error.message, "danger");
          if (Object.keys(self.pendientes).length) self.programarGuardado(RETARDO_GUARDADO);
        });
    },

    /**
     * Antes de cerrar sesión: intenta subir lo pendiente. Si no puede,
     * pregunta, porque al salir la copia local se borra.
     * @returns {Promise<boolean>} true si se puede salir
     */
    antesDeSalir: function () {
      var self = this;
      this.cancelarTemporizadores();
      if (!Object.keys(this.pendientes).length) return Promise.resolve(true);

      function preguntar() {
        return global.confirm(
          "Hay cambios en tus materias que todavía no se guardaron en tu cuenta " +
          "(parece que no hay conexión).\n\n" +
          "Si cerrás sesión ahora, esos cambios se pierden. ¿Cerrar sesión igual?"
        );
      }

      return this.subirPendientes().then(function () {
        return !Object.keys(self.pendientes).length || preguntar();
      }, preguntar);
    },

    pintarEstado: function (estado, detalle) {
      var el = document.getElementById("estado-guardado");
      if (!el) return;

      var textos = {
        guardado: ["fa-circle-check", "Guardado en tu cuenta"],
        pendiente: ["fa-pen", "Cambios sin guardar"],
        guardando: ["fa-circle-notch fa-spin", "Guardando…"],
        "sin-conexion": ["fa-wifi", "Sin conexión · se guarda cuando vuelva"],
        error: ["fa-triangle-exclamation", "No se pudo guardar"]
      };
      var t = textos[estado] || textos.guardado;
      var texto = t[1] + (estado === "error" && detalle ? ": " + detalle : "");

      // Prefijo "es-": con "estado-" el estado "guardado" repetiría la clase base.
      el.className = "estado-guardado es-" + estado;
      el.innerHTML = '<i class="fa-solid ' + t[0] + '" aria-hidden="true"></i><span>' + esc(texto) + "</span>";

      // Sólo se anuncia lo que pide atención; "Guardando…" en cada cambio sería ruido.
      if (estado === "error" || estado === "sin-conexion") UI.announce(texto);
    },

    /* ====================================================================
       NOTAS DE ANTES DE LAS CUENTAS
       La calculadora guardaba todo en este navegador, sin cuenta. Quien la
       usó no tiene por qué volver a cargar veinte materias.
       ==================================================================== */
    notasAnteriores: function () {
      var crudo = leerJSON(CLAVE_ANTERIOR);
      var validas = {};
      Object.keys(crudo).forEach(function (id) {
        var registro = normalizar(crudo[id]);
        if (registro && ID_VALIDO.test(id)) validas[id] = registro;
      });
      return validas;
    },

    pintarAnteriores: function () {
      var cont = document.getElementById("carrera-anteriores");
      if (!cont) return;

      var cantidad = Object.keys(this.notasAnteriores()).length;
      if (!cantidad) {
        quitar(CLAVE_ANTERIOR);
        cont.hidden = true;
        cont.innerHTML = "";
        return;
      }

      cont.hidden = false;
      cont.innerHTML =
        '<div class="callout callout-info">' +
          '<i class="fa-solid fa-box-archive" aria-hidden="true"></i>' +
          "<div>" +
            "<h3>Encontramos " + esc(UI.plural(cantidad, "materia")) +
              (cantidad === 1 ? " cargada" : " cargadas") + " en este navegador</h3>" +
            "<p>Son de antes de que Mi promedio usara cuentas. ¿Las pasamos a la tuya? " +
            "Si una materia ya está en tu cuenta, queda la de tu cuenta.</p>" +
            '<div class="acciones-inline">' +
              '<button type="button" class="btn btn-magenta btn-sm" data-action="importarNotasAnteriores">' +
                '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Pasarlas a mi cuenta' +
              "</button>" +
              '<button type="button" class="btn btn-secondary btn-sm" data-action="descartarNotasAnteriores">' +
                "Descartarlas" +
              "</button>" +
            "</div>" +
          "</div>" +
        "</div>";
    },

    importarAnteriores: function () {
      var self = this;
      if (!this.usuarioId) return;

      var anteriores = this.notasAnteriores();
      var sumadas = 0;
      Object.keys(anteriores).forEach(function (id) {
        if (self.notas[id]) return;
        self.notas[id] = anteriores[id];
        self.pendientes[id] = true;
        sumadas++;
      });

      quitar(CLAVE_ANTERIOR);
      this.persistir();
      this.pintarAnteriores();
      if (global.OdontoCalculator) global.OdontoCalculator.renderTabla();

      if (sumadas) {
        UI.toast("Pasamos " + UI.plural(sumadas, "materia") + " a tu cuenta", "success");
        this.subirPendientes().catch(nada);
      } else {
        UI.toast("Esas materias ya estaban en tu cuenta", "info");
      }
    },

    descartarAnteriores: function () {
      if (!global.confirm(
        "Se borran de este navegador las materias de antes.\n\n" +
        "Las de tu cuenta no se tocan. ¿Seguimos?"
      )) return;

      quitar(CLAVE_ANTERIOR);
      this.pintarAnteriores();
      UI.toast("Listo, se descartaron", "info");
    },

    /* ====================================================================
       PANTALLAS PREVIAS AL PROMEDIO
       ==================================================================== */
    pintarAcceso: function (estado, detalle) {
      var acceso = document.getElementById("carrera-acceso");
      var panel = document.getElementById("panel-promedio");
      if (!acceso) return;

      if (panel) panel.hidden = true;
      acceso.hidden = false;
      if (estado === "cargando") acceso.setAttribute("aria-busy", "true");
      else acceso.removeAttribute("aria-busy");

      var html = "";

      if (estado === "sin-backend") {
        html = puerta("fa-screwdriver-wrench", "Mi promedio todavía no está disponible",
          '<p class="puerta-lead">Estamos terminando de preparar las cuentas. Mientras tanto, ' +
          "mesas, reválidas y el resto del sitio funcionan como siempre.</p>");
      } else if (estado === "sin-sesion") {
        html = puerta("fa-graduation-cap", "Tu carrera, guardada en tu cuenta",
          '<p class="puerta-lead">Cargá tus materias una sola vez y mirá tu promedio desde el ' +
          "celular o la compu, cuando quieras.</p>" +
          '<ul class="check-list">' +
            '<li><i class="fa-solid fa-calculator" aria-hidden="true"></i>' +
              "<span>Promedio con y sin aplazos, calculado como lo hace la UNLP</span></li>" +
            '<li><i class="fa-solid fa-mobile-screen" aria-hidden="true"></i>' +
              "<span>Tus materias te siguen a cualquier dispositivo</span></li>" +
            '<li><i class="fa-solid fa-lock" aria-hidden="true"></i>' +
              "<span>Otros estudiantes no pueden ver tus notas</span></li>" +
          "</ul>" +
          '<div class="puerta-acciones">' +
            '<button type="button" class="btn btn-magenta btn-lg" data-action="abrirAcceso" data-vista="registro">' +
              '<i class="fa-solid fa-user-plus" aria-hidden="true"></i> Crear mi cuenta' +
            "</button>" +
            '<button type="button" class="btn btn-secondary btn-lg" data-action="abrirAcceso" data-vista="ingresar">' +
              "Ya tengo cuenta" +
            "</button>" +
          "</div>" +
          '<p class="puerta-nota">Mesas, reválidas, historias clínicas y biblioteca siguen ' +
          "abiertas sin cuenta.</p>");
      } else if (estado === "cargando") {
        html =
          '<div class="puerta-carrera puerta-cargando">' +
            '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>' +
            "<p>Trayendo tus materias…</p>" +
          "</div>";
      } else if (estado === "terminos") {
        html = puerta("fa-shield-halved", "Antes de cargar tus materias",
          '<p class="puerta-lead">Queremos que sepas exactamente qué pasa con lo que cargás.</p>' +
          this.htmlTerminos() +
          '<div class="puerta-acciones">' +
            '<button type="button" class="btn btn-magenta btn-lg" data-action="aceptarTerminos">' +
              "Entendido, empezar" +
            "</button>" +
          "</div>" +
          '<p class="puerta-nota">Si no estás de acuerdo, no pasa nada: el resto del sitio sigue ' +
          "abierto, y podés eliminar tu cuenta desde <strong>Mi cuenta</strong>.</p>");
      } else {
        html = puerta("fa-plug-circle-exclamation", "No pudimos traer tus materias",
          '<p class="puerta-lead">' + esc(detalle || "Algo salió mal.") + "</p>" +
          '<div class="puerta-acciones">' +
            '<button type="button" class="btn btn-magenta" data-action="reintentarCarrera">' +
              '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Probar de nuevo' +
            "</button>" +
          "</div>");
      }

      acceso.innerHTML = html;
    }
  };

  global.OdontoCarrera = OdontoCarrera;
})(window);
