/* ==========================================================================
   ODONTOCAMPUS — BOLSA DE COMPRA Y VENTA
   Entre estudiantes, con cuenta, y cada publicación revisada por FOE antes
   de aparecer.

   --------------------------------------------------------------------------
   DOS TIPOS
   · Vendo: alguien ofrece algo (instrumental, libros, materiales).
   · Busco: alguien pide algo, por si otro lo tiene para vender.
   Se filtran por separado.

   --------------------------------------------------------------------------
   LAS REGLAS LAS PONE LA BASE (009_bolsa_moderada.sql)
   · Para publicar hacen falta legajo y teléfono en el perfil.
   · Toda publicación entra "pendiente" y la aprueba alguien de FOE. Si su
     dueño cambia el contenido, vuelve a revisión.
   · El teléfono se pide recién al tocar "Contactar", y sólo existe para
     publicaciones aprobadas.
   · El legajo no lo ve nadie más que el equipo de administración.
   Este archivo dibuja y avisa; esconder un botón acá no protege nada.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var Api = global.OdontoApi;
  var esc = UI.esc, escAttr = UI.escAttr;

  var CATEGORIAS = ["Instrumental", "Libros y apuntes", "Materiales", "Equipamiento", "Ropa de clínica", "Otros"];
  var ESTADOS_USO = ["Nuevo", "Usado, como nuevo", "Usado"];
  var ESTADO = {
    pendiente: { texto: "En revisión", clase: "es-pendiente" },
    activa: { texto: "Publicada", clase: "es-activa" },
    pausada: { texto: "Pausada", clase: "es-pausada" },
    vendida: { texto: "Terminada", clase: "es-vendida" },
    rechazada: { texto: "No aprobada", clase: "es-rechazada" },
    oculta: { texto: "Oculta por moderación", clase: "es-rechazada" }
  };
  var COLUMNAS = "id,usuario_id,tipo,titulo,categoria,precio_texto,estado_uso,ubicacion,descripcion,estado,creado_at,expira_at,aprobada_at,motivo_rechazo";

  function haceCuanto(fecha) {
    var dias = Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000);
    if (dias <= 0) return "hoy";
    if (dias === 1) return "ayer";
    if (dias < 7) return "hace " + dias + " días";
    var semanas = Math.floor(dias / 7);
    return semanas === 1 ? "hace una semana" : "hace " + semanas + " semanas";
  }

  /** "Vendo: Turbina" / "Busco: articulador", sin repetir si ya lo dice. */
  function conTipo(p) {
    var prefijo = p.tipo === "venta" ? "Vendo" : "Busco";
    return new RegExp("^" + prefijo, "i").test(p.titulo) ? p.titulo : prefijo + ": " + p.titulo;
  }

  /** "2215551234" →"5492215551234" para wa.me (Argentina, celular). */
  function numeroWhatsApp(tel) {
    var n = String(tel || "").replace(/\D/g, "");
    if (n.indexOf("54") === 0) return n;
    if (n.indexOf("0") === 0) n = n.slice(1);
    return "549" + n;
  }

  var OdontoBolsa = {
    usuarioId: null,
    cargado: false,
    cargando: false,
    publicaciones: [],
    mias: [],
    nombres: {},
    perfil: null,
    filtroTipo: "todas",
    filtroCategoria: "",
    busqueda: "",
    editando: null,

    init: function () {
      var self = this;

      UI.registerActions({
        bolsaTipo: function (data) { self.filtroTipo = data.tipo; self.pintarLista(); },
        bolsaPublicar: function () { self.abrirFormulario(null); },
        bolsaCerrarFormulario: function () { UI.closeModal("modal-bolsa"); },
        bolsaTipoForm: function (data) { self.tipoFormulario(data.tipo); },
        bolsaContactar: function (data, boton) { self.contactar(data.id, boton); },
        bolsaEditar: function (data) { self.abrirFormulario(data.id); },
        bolsaEstado: function (data) { self.cambiarEstado(data.id, data.estado); },
        bolsaBorrar: function (data) { self.borrar(data.id); },
        bolsaReintentar: function () { self.cargado = false; self.mostrar(); }
      });

      var buscar = document.getElementById("bolsa-buscar");
      if (buscar) UI.on(buscar, "input", UI.debounce(function () { self.busqueda = buscar.value; self.pintarLista(); }, 200));
      var cat = document.getElementById("bolsa-categoria");
      if (cat) {
        cat.innerHTML = '<option value="">Todas las categorías</option>' +
          CATEGORIAS.map(function (c) { return '<option value="' + escAttr(c) + '">' + esc(c) + "</option>"; }).join("");
        UI.on(cat, "change", function () { self.filtroCategoria = cat.value; self.pintarLista(); });
      }

      var form = document.getElementById("form-bolsa");
      if (form) {
        form.elements["bolsa-categoria-form"].innerHTML = CATEGORIAS.map(function (c) {
          return '<option value="' + escAttr(c) + '">' + esc(c) + "</option>";
        }).join("");
        form.elements["bolsa-estado-uso"].innerHTML = ESTADOS_USO.map(function (c) {
          return '<option value="' + escAttr(c) + '">' + esc(c) + "</option>";
        }).join("");
        UI.on(form, "submit", function (ev) { ev.preventDefault(); self.publicar(form); });
      }

      Api.alCambiarSesion(function () {
        var u = Api.usuario();
        var id = u ? u.id : null;
        if (id === self.usuarioId) return;
        self.usuarioId = id;
        self.cargado = false;
        self.perfil = null;
        if (self.visible()) self.mostrar();
      });
      var u = Api.usuario();
      this.usuarioId = u ? u.id : null;
    },

    visible: function () {
      var panel = document.getElementById("panel-bolsa");
      return !!panel && !panel.hidden;
    },

    /* ====================================================================
       ENTRAR
       ==================================================================== */
    mostrar: function () {
      var acceso = document.getElementById("bolsa-acceso");
      var panel = document.getElementById("bolsa-panel");
      if (!acceso || !panel) return;

      if (!Api.hayBackend() || !Api.usuario()) {
        panel.hidden = true;
        acceso.hidden = false;
        acceso.innerHTML =
          '<div class="puerta-carrera">' +
            '<span class="puerta-icono" aria-hidden="true">' + UI.icono("etiqueta") + "</span>" +
            "<h3>La bolsa es entre estudiantes con cuenta</h3>" +
            '<p class="puerta-lead">Comprá y vendé instrumental, libros y materiales con otros estudiantes de la facultad. ' +
              "Para ver las publicaciones y publicar, ingresá a tu cuenta.</p>" +
            '<ul class="check-list">' +
              "<li>" + UI.icono("escudo") + "<span>Cada publicación la revisa FOE antes de aparecer</span></li>" +
              "<li>" + UI.icono("candado") + "<span>Tu legajo lo ve sólo el equipo de FOE, para verificar que seas estudiante</span></li>" +
            "</ul>" +
            (Api.hayBackend()
              ? '<div class="puerta-acciones">' +
                  '<button type="button" class="btn btn-magenta btn-lg" data-action="abrirAcceso" data-vista="registro">Crear mi cuenta</button>' +
                  '<button type="button" class="btn btn-secondary btn-lg" data-action="abrirAcceso" data-vista="ingresar">Ya tengo cuenta</button>' +
                "</div>"
              : "") +
          "</div>";
        return;
      }

      acceso.hidden = true;
      panel.hidden = false;
      if (!this.cargado && !this.cargando) this.traer();
      else this.pintar();
    },

    traer: function () {
      var self = this;
      var uid = Api.usuario().id;
      this.cargando = true;
      var lista = document.getElementById("bolsa-lista");
      if (lista) lista.innerHTML = '<p class="search-hint">' + UI.icono("cargando", "ic-gira") + " Trayendo las publicaciones…</p>";

      Promise.all([
        Api.seleccionar("publicaciones_bolsa", "select=" + COLUMNAS + "&estado=eq.activa&expira_at=gt." + encodeURIComponent(new Date().toISOString()) + "&order=aprobada_at.desc"),
        Api.seleccionar("publicaciones_bolsa", "select=" + COLUMNAS + "&usuario_id=eq." + encodeURIComponent(uid) + "&order=creado_at.desc"),
        Api.rpc("mi_perfil")
      ]).then(function (r) {
        if (!Api.usuario() || Api.usuario().id !== uid) return;
        self.publicaciones = r[0] || [];
        self.mias = r[1] || [];
        var perfil = Array.isArray(r[2]) ? r[2][0] : r[2];
        self.perfil = perfil || {};
        return self.traerNombres();
      }).then(function () {
        self.cargando = false;
        self.cargado = true;
        self.pintar();
      }, function (error) {
        self.cargando = false;
        if (lista) lista.innerHTML = '<div class="callout callout-warning">' + UI.icono("alerta") +
          "<div><h3>No pudimos traer la bolsa</h3><p>" + esc(error.message) + "</p>" +
          '<button type="button" class="btn btn-secondary btn-sm" data-action="bolsaReintentar">Probar de nuevo</button></div></div>';
      });
    },

    /** Los nombres de quienes publican (sólo el nombre: nada más es público). */
    traerNombres: function () {
      var self = this;
      var ids = [];
      this.publicaciones.forEach(function (p) { if (ids.indexOf(p.usuario_id) === -1) ids.push(p.usuario_id); });
      if (!ids.length) return Promise.resolve();
      return Api.seleccionar("perfiles", "select=id,nombre_visible&id=in.(" + ids.map(encodeURIComponent).join(",") + ")")
        .then(function (filas) {
          (filas || []).forEach(function (f) { self.nombres[f.id] = f.nombre_visible; });
        }, function () { /* sin nombres se muestra igual */ });
    },

    /* ====================================================================
       PANTALLA
       ==================================================================== */
    pintar: function () {
      this.pintarLista();
      this.pintarMias();
    },

    pintarLista: function () {
      var self = this;
      var cont = document.getElementById("bolsa-lista");
      if (!cont) return;

      Array.prototype.forEach.call(document.querySelectorAll("[data-action='bolsaTipo']"), function (b) {
        var activo = b.getAttribute("data-tipo") === self.filtroTipo;
        b.setAttribute("aria-pressed", activo ? "true" : "false");
        b.classList.toggle("es-activo", activo);
      });

      var q = UI.normalizar(this.busqueda).trim();
      var yo = this.usuarioId;
      var lista = this.publicaciones.filter(function (p) {
        if (self.filtroTipo !== "todas" && p.tipo !== self.filtroTipo) return false;
        if (self.filtroCategoria && p.categoria !== self.filtroCategoria) return false;
        if (q && UI.normalizar(p.titulo + " " + (p.descripcion || "") + " " + p.categoria).indexOf(q) === -1) return false;
        return true;
      });

      var resumen = document.getElementById("bolsa-resumen");
      if (resumen) {
        var ventas = lista.filter(function (p) { return p.tipo === "venta"; }).length;
        resumen.textContent = lista.length
          ? UI.plural(ventas, "venta") + " y " + UI.plural(lista.length - ventas, "pedido") + " de compra"
          : "";
      }

      if (!lista.length) {
        cont.innerHTML = '<p class="recursos-vacio">' + (this.publicaciones.length
          ? "Nada coincide con los filtros. Probá con otra categoría o sin buscar."
          : "Todavía no hay publicaciones aprobadas. ¡Podés ser la primera persona en publicar!") + "</p>";
        return;
      }

      cont.innerHTML = lista.map(function (p) {
        var esVenta = p.tipo === "venta";
        var propia = p.usuario_id === yo;
        return (
          '<article class="bolsa-item">' +
            '<div class="bolsa-item-cab">' +
              '<span class="bolsa-tipo ' + (esVenta ? "es-venta" : "es-compra") + '">' + (esVenta ? "Vendo" : "Busco") + "</span>" +
              '<span class="bolsa-cat">' + esc(p.categoria) + "</span>" +
            "</div>" +
            "<h3>" + esc(p.titulo) + "</h3>" +
            '<p class="bolsa-precio">' + esc(p.precio_texto) + "</p>" +
            (p.descripcion ? '<p class="bolsa-desc">' + esc(p.descripcion) + "</p>" : "") +
            '<p class="bolsa-meta">' +
              (esVenta && p.estado_uso ? "<span>" + esc(p.estado_uso) + "</span>" : "") +
              "<span>" + UI.icono("pin") + " " + esc(p.ubicacion) + "</span>" +
              "<span>" + esc((self.nombres[p.usuario_id] || "Estudiante") + " · " + haceCuanto(p.aprobada_at || p.creado_at)) + "</span>" +
            "</p>" +
            (propia
              ? '<p class="bolsa-propia">Es tu publicación</p>'
              : '<button type="button" class="btn btn-magenta btn-sm" data-action="bolsaContactar" data-id="' + escAttr(p.id) + '">' +
                  UI.icono("chat") + (esVenta ? " Consultar por WhatsApp" : " Ofrecer por WhatsApp") + "</button>") +
          "</article>"
        );
      }).join("");
    },

    pintarMias: function () {
      var cont = document.getElementById("bolsa-mias");
      if (!cont) return;
      if (!this.mias.length) {
        cont.innerHTML = '<p class="hoy-vacio">Todavía no publicaste nada.</p>';
        return;
      }
      cont.innerHTML = '<ul class="bolsa-mias-lista">' + this.mias.map(function (p) {
        var e = ESTADO[p.estado] || ESTADO.pendiente;
        var acciones = [];
        if (p.estado === "activa") {
          acciones.push('<button type="button" class="btn btn-secondary btn-sm" data-action="bolsaEstado" data-id="' + escAttr(p.id) + '" data-estado="vendida">' +
            (p.tipo === "venta" ? "Ya lo vendí" : "Ya lo conseguí") + "</button>");
          acciones.push('<button type="button" class="btn btn-secondary btn-sm" data-action="bolsaEstado" data-id="' + escAttr(p.id) + '" data-estado="pausada">Pausar</button>');
        } else if (p.estado === "pausada" && p.aprobada_at) {
          acciones.push('<button type="button" class="btn btn-secondary btn-sm" data-action="bolsaEstado" data-id="' + escAttr(p.id) + '" data-estado="activa">Reactivar</button>');
        }
        if (p.estado !== "oculta") {
          acciones.push('<button type="button" class="btn btn-secondary btn-sm" data-action="bolsaEditar" data-id="' + escAttr(p.id) + '">Editar</button>');
          acciones.push('<button type="button" class="btn-icono-quitar" data-action="bolsaBorrar" data-id="' + escAttr(p.id) + '" aria-label="Borrar ' + escAttr(p.titulo) + '">' + UI.icono("tacho") + "</button>");
        }
        return (
          "<li>" +
            '<div class="bolsa-mia-texto">' +
              '<span class="bolsa-estado ' + e.clase + '">' + e.texto + "</span>" +
              "<strong>" + esc(conTipo(p)) + "</strong>" +
              (p.estado === "pendiente" ? "<small>La revisa alguien de FOE. Cuando la aprueben, aparece en la bolsa y lo ves acá.</small>" : "") +
              (p.estado === "rechazada" && p.motivo_rechazo ? "<small>Motivo: " + esc(p.motivo_rechazo) + ". Podés editarla y volver a enviarla.</small>" : "") +
            "</div>" +
            '<div class="bolsa-mia-acciones">' + acciones.join("") + "</div>" +
          "</li>"
        );
      }).join("") + "</ul>";
    },

    /* ====================================================================
       PUBLICAR Y EDITAR
       ==================================================================== */
    abrirFormulario: function (id) {
      var form = document.getElementById("form-bolsa");
      if (!form) return;
      if (!Api.usuario()) { if (global.OdontoAuth) global.OdontoAuth.abrir("ingresar"); return; }

      var p = id ? this.mias.filter(function (x) { return x.id === id; })[0] : null;
      this.editando = p ? p.id : null;
      form.reset();

      var titulo = document.getElementById("bolsa-form-titulo");
      if (titulo) titulo.textContent = p ? "Editar publicación" : "Nueva publicación";
      var aviso = document.getElementById("bolsa-form-aviso");
      if (aviso) aviso.textContent = p && p.estado === "activa"
        ? "Si cambiás algo, la publicación vuelve a revisión antes de aparecer de nuevo."
        : "FOE revisa cada publicación antes de que aparezca.";

      this.tipoFormulario(p ? p.tipo : "venta");
      if (p) {
        form.elements["bolsa-titulo"].value = p.titulo;
        form.elements["bolsa-categoria-form"].value = p.categoria;
        form.elements["bolsa-precio"].value = p.precio_texto;
        if (p.estado_uso) form.elements["bolsa-estado-uso"].value = p.estado_uso;
        form.elements["bolsa-ubicacion"].value = p.ubicacion;
        form.elements["bolsa-descripcion"].value = p.descripcion || "";
      } else {
        form.elements["bolsa-ubicacion"].value = "Facultad";
      }

      // Legajo y teléfono: sólo se piden si faltan.
      var perfil = this.perfil || {};
      var datos = document.getElementById("bolsa-datos");
      var faltan = !perfil.legajo || !perfil.whatsapp;
      if (datos) datos.hidden = !faltan;
      form.elements["bolsa-legajo"].value = perfil.legajo || "";
      form.elements["bolsa-telefono"].value = perfil.whatsapp || "";

      UI.openModal("modal-bolsa", "#bolsa-titulo");
    },

    tipoFormulario: function (tipo) {
      var form = document.getElementById("form-bolsa");
      if (!form) return;
      form.setAttribute("data-tipo", tipo);
      Array.prototype.forEach.call(form.querySelectorAll("[data-action='bolsaTipoForm']"), function (b) {
        var activo = b.getAttribute("data-tipo") === tipo;
        b.classList.toggle("es-activo", activo);
        b.setAttribute("aria-pressed", activo ? "true" : "false");
      });
      var etiquetaPrecio = document.getElementById("bolsa-precio-etiqueta");
      if (etiquetaPrecio) etiquetaPrecio.textContent = tipo === "venta" ? "Precio" : "Hasta cuánto pagarías";
      form.elements["bolsa-precio"].placeholder = tipo === "venta" ? "$25.000 o «a convenir»" : "Hasta $20.000";
      form.elements["bolsa-titulo"].placeholder = tipo === "venta" ? "Turbina NSK, casi nueva" : "Busco articulador semiajustable";
      var uso = document.getElementById("bolsa-uso-campo");
      if (uso) uso.hidden = tipo !== "venta";
    },

    publicar: function (form) {
      var self = this;
      var usuario = Api.usuario();
      if (!usuario) return;

      var v = function (n) { return String(form.elements[n].value || "").replace(/\s+/g, " ").trim(); };
      var tipo = form.getAttribute("data-tipo") === "compra" ? "compra" : "venta";
      var fila = {
        tipo: tipo,
        titulo: v("bolsa-titulo").slice(0, 120),
        categoria: v("bolsa-categoria-form"),
        precio_texto: v("bolsa-precio").slice(0, 40),
        estado_uso: tipo === "venta" ? v("bolsa-estado-uso") : null,
        ubicacion: v("bolsa-ubicacion").slice(0, 120),
        descripcion: String(form.elements["bolsa-descripcion"].value || "").trim().slice(0, 600) || null
      };

      if (fila.titulo.length < 3) return this.avisar(form, "bolsa-titulo", "Escribí qué " + (tipo === "venta" ? "vendés" : "buscás"));
      if (!fila.precio_texto) return this.avisar(form, "bolsa-precio", tipo === "venta" ? "Poné un precio, o «a convenir»" : "Poné hasta cuánto pagarías, o «a convenir»");
      if (fila.ubicacion.length < 2) return this.avisar(form, "bolsa-ubicacion", "Decí dónde se entrega");

      // Primero los datos de contacto, si faltaban.
      var perfil = this.perfil || {};
      var legajo = v("bolsa-legajo");
      var telefono = v("bolsa-telefono").replace(/\D/g, "");
      var guardarPerfil = Promise.resolve();
      if (!perfil.legajo || !perfil.whatsapp || legajo !== (perfil.legajo || "") || telefono !== (perfil.whatsapp || "")) {
        if (!/^[0-9]{3,7}\/[0-9]{1,2}$/.test(legajo)) return this.avisar(form, "bolsa-legajo", "El legajo va como figura en el SIU, con la barra: 26778/6");
        if (!/^[0-9]{8,15}$/.test(telefono)) return this.avisar(form, "bolsa-telefono", "El teléfono va con característica y sin 0 ni 15: 2215551234");
        guardarPerfil = Api.actualizar("perfiles", "id=eq." + encodeURIComponent(usuario.id), { legajo: legajo, whatsapp: telefono })
          .then(function () { self.perfil.legajo = legajo; self.perfil.whatsapp = telefono; });
      }

      var boton = document.getElementById("bolsa-enviar");
      if (boton) boton.disabled = true;

      guardarPerfil.then(function () {
        if (self.editando) {
          return Api.actualizar("publicaciones_bolsa", "id=eq." + encodeURIComponent(self.editando), fila);
        }
        fila.usuario_id = usuario.id;
        return Api.insertar("publicaciones_bolsa", fila);
      }).then(function () {
        if (boton) boton.disabled = false;
        UI.closeModal("modal-bolsa");
        UI.toast(self.editando ? "Cambios enviados: la publicación vuelve a revisión" : "Enviada: FOE la revisa y aparece cuando la aprueben", "success");
        UI.vibrar(10);
        self.editando = null;
        self.cargado = false;
        self.traer();
      }, function (error) {
        if (boton) boton.disabled = false;
        var mensaje = error.message || "";
        if (/row-level security|violates/i.test(mensaje)) {
          mensaje = self.editando
            ? "Para volver a enviarla, cambiá lo que te marcaron."
            : "Todavía no podés publicar: las cuentas nuevas esperan 24 horas, y hacen falta legajo y teléfono.";
        }
        UI.toast(mensaje, "danger");
      });
    },

    avisar: function (form, campo, texto) {
      UI.toast(texto, "warning");
      if (form.elements[campo]) form.elements[campo].focus();
    },

    cambiarEstado: function (id, estado) {
      var self = this;
      Api.actualizar("publicaciones_bolsa", "id=eq." + encodeURIComponent(id), { estado: estado }).then(function () {
        UI.toast(estado === "vendida" ? "Listo, la sacamos de la bolsa" : estado === "pausada" ? "Pausada: no se muestra hasta que la reactives" : "Reactivada", "success");
        self.cargado = false;
        self.traer();
      }, function (error) { UI.toast(error.message, "danger"); });
    },

    borrar: function (id) {
      var self = this;
      var p = this.mias.filter(function (x) { return x.id === id; })[0];
      if (!p || !global.confirm("¿Borrar «" + p.titulo + "»?")) return;
      Api.borrar("publicaciones_bolsa", "id=eq." + encodeURIComponent(id)).then(function () {
        UI.toast("Se borró la publicación", "info");
        self.cargado = false;
        self.traer();
      }, function (error) { UI.toast(error.message, "danger"); });
    },

    /* ====================================================================
       CONTACTO
       ==================================================================== */
    contactar: function (id, boton) {
      var p = this.publicaciones.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      if (boton) boton.disabled = true;
      // La ventana se abre ya, en el toque: si se abre después de la
      // respuesta, el navegador la bloquea como emergente.
      var ventana = global.open("", "_blank");
      Api.rpc("contacto_bolsa", { p_publicacion: id }).then(function (telefono) {
        if (boton) boton.disabled = false;
        var texto = "Hola, vi tu publicación «" + p.titulo + "» en OdontoCampus.";
        var url = "https://wa.me/" + numeroWhatsApp(telefono) + "?text=" + encodeURIComponent(texto);
        if (ventana) { ventana.opener = null; ventana.location.href = url; }
        else global.location.href = url;
      }, function (error) {
        if (boton) boton.disabled = false;
        if (ventana) ventana.close();
        UI.toast(error.message, "danger");
      });
    }
  };

  global.OdontoBolsa = OdontoBolsa;
})(window);
