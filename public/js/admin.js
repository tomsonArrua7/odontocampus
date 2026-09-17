/* ==========================================================================
   ODONTOCAMPUS — PANEL DE ADMINISTRACIÓN
   Cuentas, planillas de mesas y reválidas, equipo de administración y el
   registro de todo lo que se hizo.

   --------------------------------------------------------------------------
   QUIÉN DECIDE QUÉ

   Este archivo sólo dibuja. Quién es admin y qué puede hacer lo decide la
   base (infra/supabase/sql/005_administracion.sql): cada acción es una
   función que primero verifica el rol y después deja constancia en el
   registro. Esconder el panel acá es comodidad, no seguridad.

   --------------------------------------------------------------------------
   LO QUE NO MUESTRA

   Materias, notas ni cursos de nadie. Al registrarse se promete que se usan
   sólo para mostrárselos a cada persona. El panel ve cuentas, no carreras.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var Api = global.OdontoApi;
  var esc = UI.esc, escAttr = UI.escAttr;

  var POR_PAGINA = 50;

  var NOMBRE_ACCION = {
    suspender: "Suspendió la cuenta",
    reactivar: "Reactivó la cuenta",
    confirmar_correo: "Confirmó el correo de",
    eliminar_cuenta: "Eliminó la cuenta",
    otorgar_admin: "Dio el rol de admin a",
    quitar_admin: "Quitó el rol de admin a",
    cambiar_planilla: "Cambió la planilla"
  };

  var NOMBRE_PLANILLA = {
    planilla_mesas: "Mesas de finales",
    planilla_revalidas: "Reválidas y actualizaciones"
  };

  function fecha(valor, conHora) {
    if (!valor) return "—";
    var d = new Date(valor);
    if (isNaN(d)) return "—";
    var opciones = { day: "2-digit", month: "2-digit", year: "numeric" };
    if (conHora) { opciones.hour = "2-digit"; opciones.minute = "2-digit"; }
    return d.toLocaleString("es-AR", opciones);
  }

  /**
   * Saca el id y la pestaña de cualquier enlace de Google Sheets:
   * .../spreadsheets/d/ID/edit?gid=0#gid=0, .../d/ID/htmlview, o el id solo.
   */
  function leerEnlacePlanilla(texto) {
    texto = String(texto || "").trim();
    var id = null;
    var m = texto.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/);
    if (m) id = m[1];
    else if (/^[A-Za-z0-9_-]{20,100}$/.test(texto)) id = texto;
    if (!id) return null;
    var g = texto.match(/[#?&]gid=(\d{1,12})/);
    return { sheetId: id, gid: g ? g[1] : "0" };
  }

  function enlaceDe(cfg) {
    return "https://docs.google.com/spreadsheets/d/" + cfg.sheetId + "/edit#gid=" + (cfg.gid || "0");
  }

  var OdontoAdmin = {
    esAdmin: null,        // null: todavía no se sabe
    usuarioVerificado: null,
    pestana: "cuentas",
    busqueda: "",
    cuentas: [],
    totalCuentas: 0,
    accionPendiente: null,

    init: function () {
      var self = this;

      UI.registerActions({
        adminMasCuentas: function () { self.cargarCuentas(true); },
        adminConfirmarCorreo: function (data) { self.confirmarCorreo(data.id, data.email); },
        adminSuspender: function (data) { self.pedirAccion("suspender", data.id, data.email); },
        adminReactivar: function (data) { self.reactivar(data.id, data.email); },
        adminEliminar: function (data) { self.pedirAccion("eliminar", data.id, data.email); },
        adminQuitarRol: function (data) { self.quitarRol(data.id, data.email); },
        adminProbarPlanilla: function (data) { self.probarPlanilla(data.clave, false); },
        adminGuardarPlanilla: function (data) { self.probarPlanilla(data.clave, true); },
        adminConfirmarAccion: function () { self.ejecutarAccion(); },
        adminCerrarAccion: function () { UI.closeModal("modal-admin-accion"); },
        irAlPanelAdmin: function () {
          UI.closeModal("modal-cuenta");
          if (global.OdontoApp) global.OdontoApp.navegarA("admin");
        }
      });

      var buscar = document.getElementById("admin-buscar");
      if (buscar) {
        UI.on(buscar, "input", UI.debounce(function () {
          self.busqueda = buscar.value;
          self.cargarCuentas(false);
        }, 350));
      }

      var formRol = document.getElementById("form-admin-otorgar");
      if (formRol) {
        UI.on(formRol, "submit", function (ev) {
          ev.preventDefault();
          self.otorgarRol(formRol);
        });
      }

      var formAccion = document.getElementById("form-admin-accion");
      if (formAccion) {
        UI.on(formAccion, "submit", function (ev) {
          ev.preventDefault();
          self.ejecutarAccion();
        });
      }

      Api.alCambiarSesion(function () {
        var usuario = Api.usuario();
        var id = usuario ? usuario.id : null;
        if (id === self.usuarioVerificado) return;
        self.esAdmin = null;
        self.usuarioVerificado = null;
        self.verificar();
      });
      this.verificar();
    },

    /* ====================================================================
       ¿ES ADMIN?
       ==================================================================== */
    verificar: function () {
      var self = this;
      var usuario = Api.hayBackend() ? Api.usuario() : null;

      if (!usuario) {
        this.esAdmin = false;
        this.pintarBotonCuenta();
        return Promise.resolve(false);
      }

      var uid = usuario.id;
      return Api.rpc("es_admin").then(function (resultado) {
        var actual = Api.usuario();
        if (!actual || actual.id !== uid) return false;
        self.esAdmin = resultado === true;
        self.usuarioVerificado = uid;
        self.pintarBotonCuenta();
        if (self.visible()) self.mostrar(self.pestana);
        return self.esAdmin;
      }, function () {
        // Sin conexión o base sin la migración 005: el panel simplemente no aparece.
        self.esAdmin = false;
        self.pintarBotonCuenta();
        return false;
      });
    },

    pintarBotonCuenta: function () {
      var boton = document.getElementById("cuenta-admin");
      if (boton) boton.hidden = !this.esAdmin;
    },

    visible: function () {
      var seccion = document.getElementById("seccion-admin");
      return !!seccion && seccion.classList.contains("active");
    },

    /* ====================================================================
       QUÉ SE VE
       ==================================================================== */
    mostrar: function (pestana) {
      var acceso = document.getElementById("admin-acceso");
      var panel = document.getElementById("admin-panel");
      if (!acceso || !panel) return;
      if (pestana) this.pestana = pestana;

      if (this.esAdmin === null) {
        panel.hidden = true;
        acceso.hidden = false;
        acceso.innerHTML = '<div class="puerta-carrera puerta-cargando">' +
          UI.icono("cargando", "ic-gira") + "<p>Verificando permisos…</p></div>";
        if (Api.usuario()) this.verificar();
        else { this.esAdmin = false; this.mostrar(); }
        return;
      }

      if (!this.esAdmin) {
        panel.hidden = true;
        acceso.hidden = false;
        acceso.innerHTML =
          '<div class="puerta-carrera">' +
            '<span class="puerta-icono" aria-hidden="true">' + UI.icono("candado") + "</span>" +
            "<h3>Esta sección es para el equipo de administración</h3>" +
            '<p class="puerta-lead">' + (Api.usuario()
              ? "Tu cuenta no tiene ese permiso. Si creés que debería tenerlo, pedíselo a alguien del equipo."
              : "Ingresá con una cuenta de administración para verla.") + "</p>" +
            (Api.usuario() ? "" :
              '<div class="puerta-acciones"><button type="button" class="btn btn-magenta" ' +
              'data-action="abrirAcceso" data-vista="ingresar">Ingresar</button></div>') +
          "</div>";
        return;
      }

      acceso.hidden = true;
      acceso.innerHTML = "";
      panel.hidden = false;

      this.cargarResumen();
      if (this.pestana === "cuentas") this.cargarCuentas(false);
      else if (this.pestana === "planillas") this.pintarPlanillas();
      else if (this.pestana === "equipo") this.cargarEquipo();
      else if (this.pestana === "registro") this.cargarRegistro();
    },

    errorEn: function (idContenedor, error) {
      var cont = document.getElementById(idContenedor);
      if (!cont) return;
      cont.innerHTML = '<div class="callout callout-warning">' + UI.icono("alerta") +
        "<div><h3>No se pudo cargar</h3><p>" + esc(error.message) + "</p></div></div>";
    },

    /* ====================================================================
       RESUMEN
       ==================================================================== */
    cargarResumen: function () {
      var cont = document.getElementById("admin-resumen");
      if (!cont) return;
      Api.rpc("admin_resumen").then(function (r) {
        r = r || {};
        var datos = [
          ["Cuentas", r.cuentas],
          ["Confirmadas", r.confirmadas],
          ["Sin confirmar", r.sin_confirmar],
          ["Nuevas en 7 días", r.nuevas_7_dias],
          ["Suspendidas", r.suspendidas],
          ["Admins", r.admins]
        ];
        cont.innerHTML = datos.map(function (d) {
          return "<div><dt>" + esc(d[0]) + "</dt><dd>" + esc(d[1] === undefined ? "—" : d[1]) + "</dd></div>";
        }).join("");
      }, function () { cont.innerHTML = ""; });
    },

    /* ====================================================================
       CUENTAS
       ==================================================================== */
    cargarCuentas: function (masAdelante) {
      var self = this;
      var cont = document.getElementById("admin-cuentas");
      if (!cont) return;

      var desde = masAdelante ? this.cuentas.length : 0;
      var busquedaPedida = this.busqueda;
      if (!masAdelante) cont.innerHTML = '<p class="search-hint">Cargando cuentas…</p>';

      Api.rpc("admin_listar_usuarios", {
        p_busqueda: busquedaPedida || null,
        p_limite: POR_PAGINA,
        p_desde: desde
      }).then(function (filas) {
        if (busquedaPedida !== self.busqueda) return; // llegó tarde una búsqueda vieja
        filas = filas || [];
        self.cuentas = masAdelante ? self.cuentas.concat(filas) : filas;
        self.totalCuentas = filas.length ? Number(filas[0].total) : (masAdelante ? self.totalCuentas : 0);
        self.pintarCuentas();
      }, function (error) { self.errorEn("admin-cuentas", error); });
    },

    pintarCuentas: function () {
      var cont = document.getElementById("admin-cuentas");
      if (!cont) return;

      if (!this.cuentas.length) {
        cont.innerHTML = '<p class="search-hint">' + (this.busqueda
          ? "Ninguna cuenta coincide con «" + esc(this.busqueda) + "»."
          : "Todavía no hay cuentas.") + "</p>";
        return;
      }

      var filas = this.cuentas.map(function (c) {
        var suspendida = c.estado === "suspendido";
        var confirmada = !!c.confirmado_at;
        var datos = ' data-id="' + escAttr(c.id) + '" data-email="' + escAttr(c.email) + '"';

        var estado = c.es_admin
          ? '<span class="admin-estado es-admin">Admin</span>'
          : suspendida
            ? '<span class="admin-estado es-suspendida">Suspendida</span>'
            : confirmada
              ? '<span class="admin-estado es-activa">Activa</span>'
              : '<span class="admin-estado es-pendiente">Sin confirmar</span>';

        var acciones = "";
        if (!c.es_admin) {
          if (!confirmada) {
            acciones += '<button type="button" class="btn btn-secondary btn-sm" data-action="adminConfirmarCorreo"' + datos + ">Confirmar correo</button>";
          }
          acciones += suspendida
            ? '<button type="button" class="btn btn-secondary btn-sm" data-action="adminReactivar"' + datos + ">Reactivar</button>"
            : '<button type="button" class="btn btn-secondary btn-sm" data-action="adminSuspender"' + datos + ">Suspender</button>";
          acciones += '<button type="button" class="btn btn-danger-soft btn-sm" data-action="adminEliminar"' + datos + ">Eliminar</button>";
        } else {
          acciones = '<span class="admin-nota">Se gestiona desde Equipo</span>';
        }

        return (
          "<tr>" +
            '<td data-rotulo="Cuenta"><strong>' + esc(c.nombre || "Sin nombre") + "</strong>" +
              '<span class="admin-correo">' + esc(c.email) + "</span></td>" +
            '<td data-rotulo="Alta">' + esc(fecha(c.creado_at)) + "</td>" +
            '<td data-rotulo="Último ingreso">' + esc(fecha(c.ultimo_ingreso, true)) + "</td>" +
            '<td data-rotulo="Estado">' + estado + "</td>" +
            '<td class="admin-acciones">' + acciones + "</td>" +
          "</tr>"
        );
      }).join("");

      var faltan = this.totalCuentas - this.cuentas.length;

      cont.innerHTML =
        '<p class="admin-conteo" role="status">' +
          esc(UI.plural(this.totalCuentas, "cuenta")) + (this.busqueda ? " encontradas" : " en total") +
          (faltan > 0 ? " · mostrando " + this.cuentas.length : "") +
        "</p>" +
        '<div class="table-responsive">' +
          '<table class="odonto-table tabla-admin">' +
            '<caption class="visually-hidden">Cuentas registradas</caption>' +
            "<thead><tr><th>Cuenta</th><th>Alta</th><th>Último ingreso</th><th>Estado</th>" +
            '<th><span class="visually-hidden">Acciones</span></th></tr></thead>' +
            "<tbody>" + filas + "</tbody>" +
          "</table>" +
        "</div>" +
        (faltan > 0
          ? '<div class="admin-mas"><button type="button" class="btn btn-secondary" data-action="adminMasCuentas">' +
            "Ver " + Math.min(faltan, POR_PAGINA) + " más</button></div>"
          : "");
    },

    /** Después de cualquier acción: el listado y el resumen se actualizan. */
    refrescar: function () {
      this.cargarResumen();
      this.cargarCuentas(false);
    },

    confirmarCorreo: function (id, email) {
      var self = this;
      Api.rpc("admin_confirmar_correo", { p_usuario: id }).then(function () {
        UI.toast("Listo: " + email + " ya puede ingresar", "success");
        self.refrescar();
      }, function (error) { UI.toast(error.message, "danger"); });
    },

    reactivar: function (id, email) {
      var self = this;
      Api.rpc("admin_reactivar", { p_usuario: id }).then(function () {
        UI.toast("Se reactivó " + email, "success");
        self.refrescar();
      }, function (error) { UI.toast(error.message, "danger"); });
    },

    /* --------------------------------------------------------------------
       Acciones que piden algo escrito: el motivo de una suspensión, o el
       correo para confirmar una eliminación. Un clic suelto no alcanza para
       dejar a alguien afuera.
       -------------------------------------------------------------------- */
    pedirAccion: function (tipo, id, email) {
      var titulo = document.getElementById("admin-accion-titulo");
      var texto = document.getElementById("admin-accion-texto");
      var etiqueta = document.getElementById("admin-accion-etiqueta");
      var campo = document.getElementById("admin-accion-campo");
      var boton = document.getElementById("admin-accion-boton");
      if (!titulo || !campo) return;

      this.accionPendiente = { tipo: tipo, id: id, email: email };
      campo.value = "";

      if (tipo === "suspender") {
        titulo.textContent = "Suspender " + email;
        texto.textContent = "La cuenta no va a poder ingresar y se cierran sus sesiones abiertas. " +
          "Sus datos no se borran, y se puede reactivar en cualquier momento.";
        etiqueta.textContent = "Motivo (queda en el registro)";
        campo.type = "text";
        campo.setAttribute("autocomplete", "off");
        boton.textContent = "Suspender cuenta";
      } else {
        titulo.textContent = "Eliminar " + email;
        texto.textContent = "Se borran la cuenta y todo lo suyo: perfil, materias, cursos y publicaciones. " +
          "No se puede deshacer.";
        etiqueta.textContent = "Para confirmar, escribí el correo de la cuenta";
        campo.type = "email";
        campo.setAttribute("autocomplete", "off");
        boton.textContent = "Eliminar para siempre";
      }

      UI.openModal("modal-admin-accion", "#admin-accion-campo");
    },

    ejecutarAccion: function () {
      var self = this;
      var accion = this.accionPendiente;
      var campo = document.getElementById("admin-accion-campo");
      var boton = document.getElementById("admin-accion-boton");
      if (!accion || !campo) return;

      var valor = campo.value.trim();
      var llamada;
      if (accion.tipo === "suspender") {
        if (valor.length < 5) {
          UI.toast("Escribí el motivo: queda en el registro", "warning");
          campo.focus();
          return;
        }
        llamada = Api.rpc("admin_suspender", { p_usuario: accion.id, p_motivo: valor });
      } else {
        if (valor.toLowerCase() !== String(accion.email).toLowerCase()) {
          UI.toast("El correo no coincide", "warning");
          campo.focus();
          return;
        }
        llamada = Api.rpc("admin_eliminar_usuario", { p_usuario: accion.id, p_confirmacion: valor });
      }

      boton.disabled = true;
      llamada.then(function () {
        boton.disabled = false;
        self.accionPendiente = null;
        UI.closeModal("modal-admin-accion");
        UI.toast(accion.tipo === "suspender"
          ? "Se suspendió " + accion.email
          : "Se eliminó " + accion.email, "success");
        self.refrescar();
      }, function (error) {
        boton.disabled = false;
        UI.toast(error.message, "danger");
      });
    },

    /* ====================================================================
       PLANILLAS
       ==================================================================== */
    pintarPlanillas: function () {
      var sheets = global.OdontoLiveSheets;
      if (!sheets) return;
      ["planilla_mesas", "planilla_revalidas"].forEach(function (clave) {
        var cfg = sheets.planilla(clave);
        var actual = document.getElementById("admin-" + clave + "-actual");
        var campo = document.getElementById("admin-" + clave + "-enlace");
        if (actual) {
          actual.innerHTML = '<a href="' + escAttr(enlaceDe(cfg)) + '" target="_blank" rel="noopener noreferrer">' +
            "Abrir la planilla actual " + UI.icono("externo") + "</a>";
        }
        if (campo && !campo.value) campo.placeholder = enlaceDe(cfg);
      });
    },

    /**
     * Prueba un enlace: lo descarga y lo lee con el mismo lector del sitio.
     * Guardar siempre prueba antes: una planilla que no se puede leer deja a
     * todo el mundo sin fechas.
     */
    probarPlanilla: function (clave, guardar) {
      var self = this;
      var campo = document.getElementById("admin-" + clave + "-enlace");
      var salida = document.getElementById("admin-" + clave + "-resultado");
      var sheets = global.OdontoLiveSheets;
      if (!campo || !salida || !sheets) return;

      var cfg = leerEnlacePlanilla(campo.value);
      if (!cfg) {
        salida.className = "admin-resultado es-error";
        salida.textContent = "Pegá el enlace completo de la planilla de Google (el que empieza con https://docs.google.com/spreadsheets/d/…).";
        campo.focus();
        return;
      }

      salida.className = "admin-resultado";
      salida.innerHTML = UI.icono("cargando", "ic-gira") + " Leyendo la planilla…";

      sheets.probar(clave, cfg.sheetId, cfg.gid).then(function (items) {
        var dias = {};
        items.forEach(function (it) { dias[it.dia] = true; });
        var cantidadDias = Object.keys(dias).length;

        if (!items.length) {
          salida.className = "admin-resultado es-error";
          salida.textContent = "Se pudo abrir, pero no encontré ningún llamado. Revisá que sea la pestaña correcta " +
            "y que tenga la fila de encabezado (Materia, Hora…).";
          return;
        }

        var resumen = "Encontré " + UI.plural(items.length, "llamado") + " en " + UI.plural(cantidadDias, "día") +
          " (primero: " + items[0].dia + ", " + items[0].materia + ").";

        if (!guardar) {
          salida.className = "admin-resultado es-ok";
          salida.textContent = resumen + " Si está bien, guardala.";
          return;
        }

        return Api.rpc("admin_guardar_planilla", {
          p_clave: clave, p_sheet_id: cfg.sheetId, p_gid: cfg.gid
        }).then(function () {
          sheets.aplicarPlanilla(clave, cfg, true);
          campo.value = "";
          salida.className = "admin-resultado es-ok";
          salida.textContent = resumen + " Guardada: el sitio ya usa esta planilla.";
          self.pintarPlanillas();
          UI.toast(NOMBRE_PLANILLA[clave] + ": planilla actualizada", "success");
        });
      }).catch(function (error) {
        salida.className = "admin-resultado es-error";
        salida.textContent = /HTTP|Failed|fetch|NetworkError/i.test(error.message)
          ? "No se pudo abrir la planilla. Tiene que estar compartida como «Cualquier persona con el enlace puede ver»."
          : error.message;
      });
    },

    /* ====================================================================
       EQUIPO
       ==================================================================== */
    cargarEquipo: function () {
      var self = this;
      var cont = document.getElementById("admin-equipo");
      if (!cont) return;
      cont.innerHTML = '<p class="search-hint">Cargando…</p>';

      Api.rpc("admin_listar_admins").then(function (filas) {
        var yo = Api.usuario() ? Api.usuario().id : null;
        cont.innerHTML = '<ul class="admin-equipo-lista">' + (filas || []).map(function (a) {
          return (
            "<li>" +
              "<div><strong>" + esc(a.nombre || a.email) + "</strong>" +
                '<span class="admin-correo">' + esc(a.email) + " · desde el " + esc(fecha(a.otorgado_at)) +
                (a.otorgado_por_email ? " · lo dio " + esc(a.otorgado_por_email) : " · desde el servidor") + "</span></div>" +
              (a.id === yo
                ? '<span class="admin-nota">Sos vos</span>'
                : '<button type="button" class="btn btn-secondary btn-sm" data-action="adminQuitarRol" ' +
                  'data-id="' + escAttr(a.id) + '" data-email="' + escAttr(a.email) + '">Quitar rol</button>') +
            "</li>"
          );
        }).join("") + "</ul>";
      }, function (error) { self.errorEn("admin-equipo", error); });
    },

    otorgarRol: function (form) {
      var self = this;
      var campo = form.elements["admin-otorgar-email"];
      var email = campo.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        UI.toast("Escribí el correo de una cuenta existente", "warning");
        campo.focus();
        return;
      }
      if (!global.confirm("¿Dar el rol de administración a " + email + "?\n\n" +
          "Va a poder ver el listado de cuentas, suspender, eliminar y cambiar las planillas.")) return;

      Api.rpc("admin_otorgar", { p_email: email }).then(function () {
        campo.value = "";
        UI.toast(email + " ya es parte del equipo", "success");
        self.cargarEquipo();
        self.cargarResumen();
      }, function (error) { UI.toast(error.message, "danger"); });
    },

    quitarRol: function (id, email) {
      var self = this;
      if (!global.confirm("¿Quitarle el rol de administración a " + email + "?\n\nLa cuenta sigue existiendo.")) return;
      Api.rpc("admin_quitar", { p_usuario: id }).then(function () {
        UI.toast("Se quitó el rol a " + email, "success");
        self.cargarEquipo();
        self.cargarResumen();
      }, function (error) { UI.toast(error.message, "danger"); });
    },

    /* ====================================================================
       REGISTRO
       ==================================================================== */
    cargarRegistro: function () {
      var self = this;
      var cont = document.getElementById("admin-registro");
      if (!cont) return;
      cont.innerHTML = '<p class="search-hint">Cargando…</p>';

      Api.rpc("admin_registro", { p_limite: 200 }).then(function (filas) {
        filas = filas || [];
        if (!filas.length) {
          cont.innerHTML = '<p class="search-hint">Todavía no se hizo nada desde el panel.</p>';
          return;
        }
        cont.innerHTML = '<ol class="admin-registro-lista">' + filas.map(function (r) {
          var objetivo = r.accion === "cambiar_planilla"
            ? NOMBRE_PLANILLA[r.objetivo] || r.objetivo
            : r.objetivo;
          var detalle = r.detalle && r.detalle.motivo ? " — «" + r.detalle.motivo + "»" : "";
          return (
            "<li>" +
              '<time datetime="' + escAttr(r.creado_at) + '">' + esc(fecha(r.creado_at, true)) + "</time>" +
              "<span><strong>" + esc(r.admin_email || "Cuenta eliminada") + "</strong> " +
                esc((NOMBRE_ACCION[r.accion] || r.accion) + " " + (objetivo || "") + detalle) + "</span>" +
            "</li>"
          );
        }).join("") + "</ol>";
      }, function (error) { self.errorEn("admin-registro", error); });
    }
  };

  global.OdontoAdmin = OdontoAdmin;
})(window);
