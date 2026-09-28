/* ==========================================================================
   ODONTOCAMPUS — AGENDA
   Las entregas y los finales de cada quien, en un calendario, junto a las
   mesas de la planilla oficial.

   --------------------------------------------------------------------------
   DOS ORÍGENES, UNA SOLA VISTA

   · Lo propio (tabla `recordatorios`): se anota, se corrige, se tacha y se
     borra. Es privado: nadie más lo ve.
   · Las mesas y reválidas (planilla de cátedra): aparecen en el mismo
     calendario pero no se pueden editar. No son de una persona.

   --------------------------------------------------------------------------
   POR QUÉ ACÁ NO HAY GUARDADO SIN CONEXIÓN

   Mi carrera guarda materias con copia local y reintentos porque se cargan de
   a veinte y en el pasillo. Un recordatorio se anota de a uno y se espera la
   confirmación: si no hay señal, se avisa y no se pierde nada, porque el
   formulario queda como estaba.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var Api = global.OdontoApi;
  var esc = UI.esc, escAttr = UI.escAttr;

  var DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  var DIAS_CORTOS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
               "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  var TIPOS = {
    entrega: { nombre: "Entrega", icono: "documento" },
    final:   { nombre: "Final",   icono: "certificado" },
    otro:    { nombre: "Otro",    icono: "marcador" },
    mesa:    { nombre: "Mesa de la planilla", icono: "calendario" }
  };

  /** "2026-10-03" sin pasar por UTC (new Date("...") corre un día en Argentina). */
  function aISO(fecha) {
    var mes = String(fecha.getMonth() + 1);
    var dia = String(fecha.getDate());
    return fecha.getFullYear() + "-" + (mes.length < 2 ? "0" + mes : mes) +
           "-" + (dia.length < 2 ? "0" + dia : dia);
  }

  function desdeISO(iso) {
    var p = String(iso || "").split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function hoyISO() {
    return aISO(new Date());
  }

  function textoFecha(iso) {
    var d = desdeISO(iso);
    return DIAS[(d.getDay() + 6) % 7] + " " + d.getDate() + " de " + MESES[d.getMonth()];
  }

  /** "14:30:00" → "14:30". Sin hora, cadena vacía. */
  function textoHora(hora) {
    if (!hora) return "";
    return String(hora).slice(0, 5);
  }

  function nuevoId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    var b = new Uint8Array(16);
    global.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  var OdontoAgenda = {
    usuarioId: null,
    cargado: false,
    cargando: false,
    recordatorios: [],
    mes: null,          // primer día del mes que se muestra
    diaElegido: null,   // ISO
    editando: null,     // id del recordatorio en edición

    init: function () {
      var self = this;

      UI.registerActions({
        agendaMes: function (data) { self.cambiarMes(Number(data.paso)); },
        agendaHoy: function () { self.irAHoy(); },
        agendaDia: function (data) { self.elegirDia(data.fecha); },
        agendaEditar: function (data) { self.editar(data.id); },
        agendaCancelar: function () { self.cancelarEdicion(); },
        agendaHecho: function (data) { self.marcarHecho(data.id); },
        agendaBorrar: function (data) { self.borrar(data.id); },
        agendaReintentar: function () { self.cargado = false; self.mostrar(); }
      });

      var form = document.getElementById("form-recordatorio");
      if (form) {
        UI.on(form, "submit", function (ev) {
          ev.preventDefault();
          self.guardar(form);
        });
      }

      Api.alCambiarSesion(function () {
        var usuario = Api.usuario();
        var id = usuario ? usuario.id : null;
        if (id === self.usuarioId) return;
        self.usuarioId = id;
        self.cargado = false;
        self.recordatorios = [];
        if (self.visible()) self.mostrar();
      });

      var usuario = Api.usuario();
      this.usuarioId = usuario ? usuario.id : null;
      this.mes = this.primerDiaDelMes(new Date());
      this.diaElegido = hoyISO();
    },

    visible: function () {
      var panel = document.getElementById("panel-agenda");
      return !!panel && !panel.hidden;
    },

    primerDiaDelMes: function (fecha) {
      return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    },

    /* ====================================================================
       ENTRAR
       ==================================================================== */
    mostrar: function () {
      var acceso = document.getElementById("agenda-acceso");
      var panel = document.getElementById("agenda-panel");
      if (!acceso || !panel) return;

      if (!Api.hayBackend()) { this.pintarAcceso("sin-backend"); return; }
      if (!Api.usuario()) { this.pintarAcceso("sin-sesion"); return; }
      if (this.cargado) { this.abrir(); return; }
      if (!this.cargando) this.traer();
    },

    traer: function () {
      var self = this;
      var uid = this.usuarioId = Api.usuario().id;

      this.cargando = true;
      this.pintarAcceso("cargando");

      Api.seleccionar("recordatorios", "select=id,titulo,tipo,fecha,hora,materia,nota,hecho&order=fecha.asc")
        .then(function (filas) {
          if (!Api.usuario() || Api.usuario().id !== uid) return;
          self.recordatorios = (filas || []).map(function (f) {
            return {
              id: f.id, titulo: f.titulo, tipo: f.tipo, fecha: f.fecha,
              hora: textoHora(f.hora), materia: f.materia || "", nota: f.nota || "",
              hecho: !!f.hecho
            };
          });
          self.cargando = false;
          self.cargado = true;
          self.abrir();
        }, function (error) {
          self.cargando = false;
          self.pintarAcceso("error", error.message);
        });
    },

    abrir: function () {
      var acceso = document.getElementById("agenda-acceso");
      var panel = document.getElementById("agenda-panel");
      if (acceso) { acceso.hidden = true; acceso.innerHTML = ""; acceso.removeAttribute("aria-busy"); }
      if (panel) panel.hidden = false;
      this.llenarMaterias();
      this.pintar();
    },

    pintarAcceso: function (estado, detalle) {
      var acceso = document.getElementById("agenda-acceso");
      var panel = document.getElementById("agenda-panel");
      if (!acceso) return;
      if (panel) panel.hidden = true;
      acceso.hidden = false;
      if (estado === "cargando") acceso.setAttribute("aria-busy", "true");
      else acceso.removeAttribute("aria-busy");

      if (estado === "cargando") {
        acceso.innerHTML = '<div class="puerta-carrera puerta-cargando">' +
          UI.icono("cargando", "ic-gira") + "<p>Trayendo tu agenda…</p></div>";
        return;
      }

      if (estado === "sin-backend") {
        acceso.innerHTML = this.puerta("herramientas", "La agenda todavía no está disponible",
          "<p class=\"puerta-lead\">Estamos terminando de preparar las cuentas. Las mesas de finales " +
          "siguen publicadas en <strong>Cuándo rindo</strong>.</p>");
        return;
      }

      if (estado === "sin-sesion") {
        acceso.innerHTML = this.puerta("calendario", "Tu agenda, en tu cuenta",
          '<p class="puerta-lead">Anotá tus entregas y tus finales. Aparecen en un calendario junto ' +
          "a las mesas de la planilla oficial, y te siguen a cualquier dispositivo.</p>" +
          '<ul class="check-list">' +
            '<li>' + UI.icono("candado") + "<span>Son privados: nadie más los ve</span></li>" +
            '<li>' + UI.icono("calendario") + "<span>Las mesas oficiales se agregan solas</span></li>" +
          "</ul>" +
          '<div class="puerta-acciones">' +
            '<button type="button" class="btn btn-magenta btn-lg" data-action="abrirAcceso" data-vista="registro">' +
              "Crear mi cuenta</button>" +
            '<button type="button" class="btn btn-secondary btn-lg" data-action="abrirAcceso" data-vista="ingresar">' +
              "Ya tengo cuenta</button>" +
          "</div>");
        return;
      }

      acceso.innerHTML = this.puerta("enchufe", "No pudimos traer tu agenda",
        '<p class="puerta-lead">' + esc(detalle || "Algo salió mal.") + "</p>" +
        '<div class="puerta-acciones"><button type="button" class="btn btn-magenta" data-action="agendaReintentar">' +
        UI.icono("rotar") + " Probar de nuevo</button></div>");
    },

    puerta: function (icono, titulo, cuerpo) {
      return '<div class="puerta-carrera">' +
        '<span class="puerta-icono" aria-hidden="true">' + UI.icono(icono) + "</span>" +
        "<h3>" + esc(titulo) + "</h3>" + cuerpo + "</div>";
    },

    /* ====================================================================
       LO QUE VA EN EL CALENDARIO
       ==================================================================== */
    /** Mesas y reválidas de la planilla, con fecha reconocida. */
    llamadosOficiales: function () {
      var sheets = global.OdontoLiveSheets;
      var items = sheets && sheets.cachedItems ? sheets.cachedItems : [];
      var salida = [];
      items.forEach(function (item) {
        var fecha = UI.parseFechaTexto(item.dia);
        if (!fecha) return;
        salida.push({
          id: "oficial-" + item.id,
          titulo: item.materiaOriginal || item.materia,
          tipo: "mesa",
          esOficial: true,
          fecha: aISO(fecha),
          hora: /^\d/.test(item.hora || "") ? item.hora : "",
          materia: "",
          nota: item.modalidad || "",
          hecho: false
        });
      });
      return salida;
    },

    todos: function () {
      return this.recordatorios.concat(this.llamadosOficiales());
    },

    porDia: function () {
      var mapa = {};
      this.todos().forEach(function (item) {
        (mapa[item.fecha] = mapa[item.fecha] || []).push(item);
      });
      Object.keys(mapa).forEach(function (dia) {
        mapa[dia].sort(function (a, b) {
          return (a.hora || "99").localeCompare(b.hora || "99");
        });
      });
      return mapa;
    },

    /* ====================================================================
       CALENDARIO
       ==================================================================== */
    cambiarMes: function (paso) {
      this.mes = new Date(this.mes.getFullYear(), this.mes.getMonth() + paso, 1);
      this.pintar();
      var titulo = document.getElementById("agenda-mes");
      if (titulo) UI.announce(titulo.textContent);
    },

    irAHoy: function () {
      this.mes = this.primerDiaDelMes(new Date());
      this.diaElegido = hoyISO();
      this.pintar();
    },

    elegirDia: function (fecha) {
      this.diaElegido = fecha;
      this.pintar();
      var lista = document.getElementById("agenda-dia");
      if (lista) UI.announce(textoFecha(fecha));
    },

    pintar: function () {
      this.pintarCalendario();
      this.pintarDia();
      this.pintarProximos();
    },

    pintarCalendario: function () {
      var cont = document.getElementById("agenda-calendario");
      var titulo = document.getElementById("agenda-mes");
      if (!cont) return;

      var porDia = this.porDia();
      var anio = this.mes.getFullYear(), mes = this.mes.getMonth();
      if (titulo) {
        titulo.textContent = MESES[mes].charAt(0).toUpperCase() + MESES[mes].slice(1) + " de " + anio;
      }

      // La semana arranca el lunes, como los cronogramas de la facultad.
      var primero = new Date(anio, mes, 1);
      var desplazamiento = (primero.getDay() + 6) % 7;
      var diasDelMes = new Date(anio, mes + 1, 0).getDate();
      var hoy = hoyISO();

      var celdas = "";
      for (var i = 0; i < desplazamiento; i++) celdas += '<td class="dia-vacio"></td>';

      for (var dia = 1; dia <= diasDelMes; dia++) {
        var iso = aISO(new Date(anio, mes, dia));
        var items = porDia[iso] || [];
        var propios = items.filter(function (x) { return !x.esOficial; });
        var oficiales = items.length - propios.length;
        var pendientes = propios.filter(function (x) { return !x.hecho; }).length;

        var clases = ["dia"];
        if (iso === hoy) clases.push("es-hoy");
        if (iso === this.diaElegido) clases.push("es-elegido");
        if (items.length) clases.push("con-cosas");

        var etiqueta = textoFecha(iso) + (items.length
          ? ": " + UI.plural(items.length, "cosa") + " anotada" + (items.length === 1 ? "" : "s")
          : ": sin nada anotado");

        celdas +=
          "<td>" +
            '<button type="button" class="' + clases.join(" ") + '" data-action="agendaDia" ' +
                    'data-fecha="' + escAttr(iso) + '" aria-label="' + escAttr(etiqueta) + '"' +
                    (iso === this.diaElegido ? ' aria-current="date"' : "") + ">" +
              '<span class="dia-numero">' + dia + "</span>" +
              '<span class="dia-marcas" aria-hidden="true">' +
                (pendientes ? '<span class="marca es-propio"></span>' : "") +
                (propios.length > pendientes ? '<span class="marca es-hecho"></span>' : "") +
                (oficiales ? '<span class="marca es-oficial"></span>' : "") +
              "</span>" +
            "</button>" +
          "</td>";

        if ((desplazamiento + dia) % 7 === 0) celdas += "</tr><tr>";
      }

      cont.innerHTML =
        '<table class="calendario">' +
          '<caption class="visually-hidden">Calendario de ' + esc(titulo ? titulo.textContent : "") + "</caption>" +
          "<thead><tr>" + DIAS_CORTOS.map(function (d, i) {
            return '<th scope="col"><abbr title="' + escAttr(DIAS[i]) + '">' + esc(d) + "</abbr></th>";
          }).join("") + "</tr></thead>" +
          "<tbody><tr>" + celdas + "</tr></tbody>" +
        "</table>";
    },

    pintarDia: function () {
      var cont = document.getElementById("agenda-dia");
      if (!cont) return;

      var items = (this.porDia()[this.diaElegido] || []);
      var titulo = '<h3 class="agenda-dia-titulo">' + esc(textoFecha(this.diaElegido)) +
        (this.diaElegido === hoyISO() ? ' <span class="agenda-hoy">hoy</span>' : "") + "</h3>";

      if (!items.length) {
        cont.innerHTML = titulo + '<p class="agenda-vacio">Nada anotado este día. ' +
          "Podés agregar una entrega o un final con el formulario de abajo.</p>";
        return;
      }

      cont.innerHTML = titulo + '<ul class="agenda-lista">' + items.map(function (item) {
        var tipo = TIPOS[item.tipo] || TIPOS.otro;
        var detalle = [item.hora, item.materia, item.nota].filter(Boolean).join(" · ");

        return (
          '<li class="agenda-item es-' + item.tipo + (item.hecho ? " es-hecho" : "") + '">' +
            '<span class="agenda-item-icono" aria-hidden="true">' + UI.icono(tipo.icono) + "</span>" +
            '<span class="agenda-item-texto">' +
              "<strong>" + esc(item.titulo) + "</strong>" +
              '<small>' + esc(tipo.nombre + (detalle ? " · " + detalle : "")) + "</small>" +
            "</span>" +
            (item.esOficial
              ? '<a class="btn btn-secondary btn-sm" href="#fechas/mesas" data-nav="fechas/mesas">Ver mesas</a>'
              : '<span class="agenda-item-acciones">' +
                  '<button type="button" class="btn btn-secondary btn-sm" data-action="agendaHecho" data-id="' + escAttr(item.id) + '">' +
                    (item.hecho ? "Marcar pendiente" : "Ya está") + "</button>" +
                  '<button type="button" class="btn btn-secondary btn-sm" data-action="agendaEditar" data-id="' + escAttr(item.id) + '">Editar</button>' +
                  '<button type="button" class="btn-icono-quitar" data-action="agendaBorrar" data-id="' + escAttr(item.id) + '" ' +
                          'aria-label="Borrar ' + escAttr(item.titulo) + '">' + UI.icono("tacho") + "</button>" +
                "</span>") +
          "</li>"
        );
      }).join("") + "</ul>";
    },

    /** Lo que viene, sin depender de qué mes se esté mirando. */
    pintarProximos: function () {
      var cont = document.getElementById("agenda-proximos");
      if (!cont) return;

      var hoy = hoyISO();
      var proximos = this.todos()
        .filter(function (i) { return i.fecha >= hoy && !i.hecho; })
        .sort(function (a, b) {
          if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
          return (a.hora || "99").localeCompare(b.hora || "99");
        })
        .slice(0, 5);

      if (!proximos.length) {
        cont.innerHTML = '<p class="agenda-vacio">No tenés nada por delante. Cuando anotes algo, aparece acá.</p>';
        return;
      }

      cont.innerHTML = '<ul class="agenda-proximos-lista">' + proximos.map(function (item) {
        var dias = UI.diasHasta(desdeISO(item.fecha));
        var cuando = dias === 0 ? "hoy" : (dias === 1 ? "mañana" : "en " + dias + " días");
        var tipo = TIPOS[item.tipo] || TIPOS.otro;
        return (
          "<li>" +
            '<span class="agenda-cuando">' + esc(cuando) + "</span>" +
            "<span><strong>" + esc(item.titulo) + "</strong>" +
              "<small>" + esc(tipo.nombre + " · " + textoFecha(item.fecha) + (item.hora ? " · " + item.hora : "")) + "</small>" +
            "</span>" +
          "</li>"
        );
      }).join("") + "</ul>";
    },

    /** El desplegable de materias se arma con el plan de estudios. */
    llenarMaterias: function () {
      var lista = document.getElementById("materias-sugeridas");
      if (!lista || lista.children.length) return;
      var materias = global.OdontoCalculator ? global.OdontoCalculator.getTodasLasMaterias() : [];
      lista.innerHTML = materias.map(function (m) {
        return '<option value="' + escAttr(m.nombre) + '"></option>';
      }).join("");
    },

    /* ====================================================================
       GUARDAR, CORREGIR, BORRAR
       ==================================================================== */
    datosDelFormulario: function (form) {
      var v = function (nombre) { return String(form.elements[nombre].value || "").trim(); };
      var titulo = v("rec-titulo").replace(/\s+/g, " ").slice(0, 120);
      var fecha = v("rec-fecha");

      if (titulo.length < 2) return { error: "Escribí qué tenés que hacer", campo: "rec-titulo" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: "Elegí la fecha", campo: "rec-fecha" };

      var materia = v("rec-materia").slice(0, 120);
      var nota = v("rec-nota").slice(0, 300);

      return {
        datos: {
          titulo: titulo,
          tipo: v("rec-tipo") || "entrega",
          fecha: fecha,
          hora: v("rec-hora") || null,
          materia: materia.length >= 2 ? materia : null,
          nota: nota || null
        }
      };
    },

    guardar: function (form) {
      var self = this;
      var usuario = Api.usuario();
      if (!usuario) return;

      var r = this.datosDelFormulario(form);
      if (r.error) {
        UI.toast(r.error, "warning");
        form.elements[r.campo].focus();
        return;
      }

      var editando = this.editando;
      var existente = editando && this.recordatorios.filter(function (x) { return x.id === editando; })[0];
      var fila = {
        id: editando || nuevoId(),
        usuario_id: usuario.id,
        titulo: r.datos.titulo,
        tipo: r.datos.tipo,
        fecha: r.datos.fecha,
        hora: r.datos.hora,
        materia: r.datos.materia,
        nota: r.datos.nota,
        hecho: existente ? existente.hecho : false
      };

      var boton = document.getElementById("rec-guardar");
      if (boton) boton.disabled = true;

      Api.guardar("recordatorios", fila, { onConflict: "id", devolver: false }).then(function () {
        if (boton) boton.disabled = false;

        var item = {
          id: fila.id, titulo: fila.titulo, tipo: fila.tipo, fecha: fila.fecha,
          hora: textoHora(fila.hora), materia: fila.materia || "", nota: fila.nota || "",
          hecho: fila.hecho
        };
        self.recordatorios = self.recordatorios.filter(function (x) { return x.id !== fila.id; });
        self.recordatorios.push(item);

        self.cancelarEdicion();
        form.reset();
        self.mes = self.primerDiaDelMes(desdeISO(item.fecha));
        self.diaElegido = item.fecha;
        self.pintar();

        UI.toast(editando ? "Recordatorio actualizado" : "Anotado para el " + textoFecha(item.fecha), "success");
        form.elements["rec-titulo"].focus();
      }, function (error) {
        if (boton) boton.disabled = false;
        UI.toast(error.message, "danger");
      });
    },

    editar: function (id) {
      var item = this.recordatorios.filter(function (x) { return x.id === id; })[0];
      var form = document.getElementById("form-recordatorio");
      if (!item || !form) return;

      this.editando = id;
      form.elements["rec-titulo"].value = item.titulo;
      form.elements["rec-tipo"].value = item.tipo;
      form.elements["rec-fecha"].value = item.fecha;
      form.elements["rec-hora"].value = item.hora;
      form.elements["rec-materia"].value = item.materia;
      form.elements["rec-nota"].value = item.nota;

      var titulo = document.getElementById("form-recordatorio-titulo");
      if (titulo) titulo.textContent = "Editar recordatorio";
      var cancelar = document.getElementById("rec-cancelar");
      if (cancelar) cancelar.hidden = false;
      var guardar = document.getElementById("rec-guardar");
      if (guardar) guardar.textContent = "Guardar cambios";

      form.elements["rec-titulo"].focus();
      form.scrollIntoView({ block: "nearest" });
    },

    cancelarEdicion: function () {
      var form = document.getElementById("form-recordatorio");
      this.editando = null;
      if (form) form.reset();

      var titulo = document.getElementById("form-recordatorio-titulo");
      if (titulo) titulo.textContent = "Anotar algo nuevo";
      var cancelar = document.getElementById("rec-cancelar");
      if (cancelar) cancelar.hidden = true;
      var guardar = document.getElementById("rec-guardar");
      if (guardar) guardar.textContent = "Anotar";
    },

    marcarHecho: function (id) {
      var self = this;
      var item = this.recordatorios.filter(function (x) { return x.id === id; })[0];
      var usuario = Api.usuario();
      if (!item || !usuario) return;

      var nuevo = !item.hecho;
      Api.guardar("recordatorios", {
        id: item.id, usuario_id: usuario.id, titulo: item.titulo, tipo: item.tipo,
        fecha: item.fecha, hora: item.hora || null, materia: item.materia || null,
        nota: item.nota || null, hecho: nuevo
      }, { onConflict: "id", devolver: false }).then(function () {
        item.hecho = nuevo;
        self.pintar();
      }, function (error) { UI.toast(error.message, "danger"); });
    },

    borrar: function (id) {
      var self = this;
      var item = this.recordatorios.filter(function (x) { return x.id === id; })[0];
      if (!item) return;
      if (!global.confirm("¿Borrar «" + item.titulo + "»?")) return;

      Api.borrar("recordatorios", "id=eq." + encodeURIComponent(id)).then(function () {
        self.recordatorios = self.recordatorios.filter(function (x) { return x.id !== id; });
        if (self.editando === id) self.cancelarEdicion();
        self.pintar();
        UI.toast("Se borró el recordatorio", "info");
      }, function (error) { UI.toast(error.message, "danger"); });
    }
  };

  global.OdontoAgenda = OdontoAgenda;
})(window);
