/* ==========================================================================
   ODONTOCAMPUS — HOY
   El inicio es un tablero, no una portada: al abrir la app se ve lo que le
   sirve a cada quien hoy.

   · La franja azul: el saludo y, con cuenta, el avance de la carrera.
   · La próxima mesa de la planilla, con cuánto falta.
   · Accesos a lo que más se abre: SIU, aulas virtuales, mapa, clases.
   · Esta semana: lo anotado en la agenda para los próximos siete días.
   · Tu año: las materias del año elegido, con sus clases grabadas y, con
     cuenta, en qué estado está cada una.

   Todo sale de lo que el sitio ya tiene cargado (planilla, plan, agenda,
   recursos). Este archivo sólo lo junta y lo dibuja.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var esc = UI.esc, escAttr = UI.escAttr;

  var CLAVE_ANIO = "odontocampus_recursos_anio"; // el mismo que usa Recursos
  var CLAVE_BIENVENIDA = "odontocampus_bienvenida_v1";
  var DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
               "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var ORDINAL = ["", "1.er", "2.º", "3.er", "4.º", "5.º", "6.º"];

  var AULAS = "https://grado.folp.unlp.edu.ar/login/index.php";

  /**
   * Odontopreguntados cierra cada lunes a las 23:59. Devuelve el próximo
   * cierre: si hoy es lunes y todavía no pasó, es hoy.
   */
  function proximoCierre(ahora) {
    ahora = ahora || new Date();
    var dias = (1 - ahora.getDay() + 7) % 7;
    var cierre = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + dias, 23, 59, 0);
    if (cierre <= ahora) cierre = new Date(cierre.getFullYear(), cierre.getMonth(), cierre.getDate() + 7, 23, 59, 0);
    return cierre;
  }

  /** "2 días y 5 horas", "5 horas y 20 minutos", "40 minutos". */
  function cuantoFalta(cierre) {
    var ms = cierre - Date.now();
    var dias = Math.floor(ms / 86400000);
    var horas = Math.floor((ms % 86400000) / 3600000);
    var minutos = Math.max(1, Math.floor((ms % 3600000) / 60000));
    function n(x, uno, varios) { return x + " " + (x === 1 ? uno : varios); }
    if (dias >= 1) return n(dias, "día", "días") + (horas ? " y " + n(horas, "hora", "horas") : "");
    if (horas >= 1) return n(horas, "hora", "horas") + " y " + n(minutos, "minuto", "minutos");
    return n(minutos, "minuto", "minutos");
  }

  var ESTADO = {
    aprobada: { texto: "Aprobada", clase: "es-aprobada" },
    regular: { texto: "Regular", clase: "es-regular" },
    cursando: { texto: "Cursando", clase: "es-cursando" }
  };

  function Api() { return global.OdontoApi; }

  function usuario() {
    var api = Api();
    return api && api.hayBackend() ? api.usuario() : null;
  }

  /** Cómo eligió que la saludemos (Mi perfil). */
  function nombreSaludo(u) {
    if (!u) return "";
    if (global.OdontoAuth) return global.OdontoAuth.nombreVisible();
    var meta = u.user_metadata || {};
    return String(meta.nombre_visible || "").trim();
  }

  /** Área de una materia, para su color: básicas, clínicas u OPS. */
  function area(materia) {
    var n = UI.normalizar(materia.nombre);
    if (n.indexOf("preventiva") !== -1) return "ops";
    if (/operatoria|protesis|cirugia|endodoncia|periodoncia|ninos|practicas|legal|bioetica|diagnostico/.test(n)) return "clinicas";
    return "basicas";
  }

  /** "13hs", "8:30 hs", "10.30" → [hora, minutos]. Sin hora, las 8. */
  function horaDe(texto) {
    var m = String(texto || "").match(/(\d{1,2})(?:[:.](\d{2}))?/);
    if (!m) return [8, 0];
    var h = Number(m[1]);
    return [h >= 0 && h <= 23 ? h : 8, Number(m[2] || 0)];
  }

  var OdontoHoy = {
    anio: 1,

    init: function () {
      var self = this;
      var guardado = null;
      try { guardado = Number(localStorage.getItem(CLAVE_ANIO)); } catch (e) { guardado = null; }
      if (guardado >= 1 && guardado <= 5) this.anio = guardado;

      UI.registerActions({
        hoyAnio: function (data) { self.elegirAnio(Number(data.anio)); },
        hoyVerMaterias: function () { self.verMaterias(); },
        bienvenidaAnio: function (data, el) { self.marcarAnioBienvenida(Number(data.anio), el); },
        bienvenidaEntrar: function () { self.cerrarBienvenida(); },
        bienvenidaIngresar: function () {
          self.cerrarBienvenida();
          if (global.OdontoAuth) global.OdontoAuth.abrir("ingresar");
        }
      });

      var api = Api();
      if (api) api.alCambiarSesion(function () { self.pintar(); });

      this.pintar();
      this.quizasBienvenida();
    },

    /* ====================================================================
       BIENVENIDA
       Sólo la primera vez. No aparece si:
       · ya la vio (queda anotado en este navegador);
       · tiene la sesión iniciada (ya conoce el sitio);
       · entró con un enlace a otra sección (el de las mesas que pasaron por
         WhatsApp): esa persona vino a buscar algo puntual.
       ==================================================================== */
    quizasBienvenida: function () {
      var vista = false;
      try { vista = localStorage.getItem(CLAVE_BIENVENIDA) === "1"; } catch (e) { vista = true; }
      var hash = String(global.location.hash || "").replace(/^#/, "");
      var alInicio = !hash || hash === "inicio";
      if (vista || usuario() || !alInicio) return;

      var capa = document.getElementById("bienvenida");
      if (!capa) return;
      capa.hidden = false;
      document.documentElement.classList.add("con-bienvenida");
      this.anioBienvenida = null;
      global.setTimeout(function () {
        var boton = capa.querySelector(".bienvenida-empezar");
        if (boton) boton.focus();
      }, 60);
    },

    marcarAnioBienvenida: function (anio, boton) {
      var capa = document.getElementById("bienvenida");
      if (!capa || !(anio >= 1 && anio <= 5)) return;
      // Tocar el año elegido otra vez lo desmarca: es opcional.
      this.anioBienvenida = this.anioBienvenida === anio ? null : anio;
      var elegido = this.anioBienvenida;
      Array.prototype.forEach.call(capa.querySelectorAll(".chip-anio"), function (b) {
        var activo = Number(b.getAttribute("data-anio")) === elegido;
        b.classList.toggle("es-activo", activo);
        b.setAttribute("aria-pressed", activo ? "true" : "false");
      });
      UI.vibrar(6);
    },

    cerrarBienvenida: function () {
      var capa = document.getElementById("bienvenida");
      try { localStorage.setItem(CLAVE_BIENVENIDA, "1"); } catch (e) { /* modo privado */ }
      if (this.anioBienvenida) this.elegirAnio(this.anioBienvenida);
      if (!capa || capa.hidden) return;

      function quitar() {
        capa.hidden = true;
        capa.classList.remove("saliendo");
        document.documentElement.classList.remove("con-bienvenida");
        var main = document.getElementById("contenido-principal");
        if (main) main.focus({ preventScroll: true });
      }

      var quieto = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (quieto) { quitar(); return; }
      capa.classList.add("saliendo");
      global.setTimeout(quitar, 380);
    },

    visible: function () {
      var s = document.getElementById("seccion-inicio");
      return !!s && s.classList.contains("active");
    },

    elegirAnio: function (anio) {
      if (!(anio >= 1 && anio <= 5)) return;
      this.anio = anio;
      try { localStorage.setItem(CLAVE_ANIO, String(anio)); } catch (e) { /* modo privado */ }
      // Recursos usa el mismo año: queda sincronizado.
      if (global.OdontoRecursos) { global.OdontoRecursos.anio = anio; global.OdontoRecursos.pintar(); }
      this.pintarAnio();
    },

    pintar: function () {
      this.pintarRecordatorioOdp();
      this.pintarBanda();
      this.pintarMesa();
      this.pintarSemana();
      this.pintarAnio();
    },

    /* ====================================================================
       LA FRANJA
       ==================================================================== */
    pintarBanda: function () {
      var fecha = document.getElementById("hoy-fecha");
      var saludo = document.getElementById("hoy-saludo");
      var progreso = document.getElementById("hoy-progreso");
      if (!saludo || !progreso) return;

      var hoy = new Date();
      var u = usuario();
      var nombre = nombreSaludo(u);

      if (fecha) {
        var d = DIAS[hoy.getDay()];
        fecha.textContent = d.charAt(0).toUpperCase() + d.slice(1) + " " + hoy.getDate() +
          " de " + MESES[hoy.getMonth()] + " · " + ORDINAL[this.anio] + " año";
      }
      saludo.textContent = nombre ? "Hola, " + nombre : "Hola";

      if (!u) {
        progreso.innerHTML =
          '<p class="hoy-bajada">Tus mesas, tu agenda y tu carrera, en un solo lugar.</p>' +
          '<div class="hoy-acciones">' +
            '<button type="button" class="btn btn-magenta" data-action="abrirAcceso" data-vista="registro">Crear mi cuenta</button>' +
            '<button type="button" class="btn btn-on-brand" data-action="abrirAcceso" data-vista="ingresar">Ya tengo cuenta</button>' +
          "</div>";
        return;
      }

      var auth = global.OdontoAuth;
      if (auth && auth.estadoPerfil === "incompleto") {
        progreso.innerHTML =
          '<p class="hoy-bajada">Completá tu perfil con tu nombre y apellido para usar tu carrera, tu agenda y la bolsa.</p>' +
          '<div class="hoy-acciones"><button type="button" class="btn btn-magenta" data-action="abrirPerfil">Completar mi perfil</button></div>';
        return;
      }

      var calc = global.OdontoCalculator;
      var m = calc ? calc.calcularMetricas() : null;
      if (!m || !m.aprobadasCount) {
        progreso.innerHTML =
          '<p class="hoy-bajada">Cargá tus materias una vez y acá vas a ver tu avance y tu promedio.</p>' +
          '<div class="hoy-acciones"><a class="btn btn-magenta" href="#carrera/plan" data-nav="carrera/plan">Cargar mis materias</a></div>';
        return;
      }

      progreso.innerHTML =
        '<div class="hoy-progreso-fila">' +
          "<span><b>" + m.porcentajeAvance + "%</b> de la carrera · " + m.aprobadasCount + " de " + m.totalMaterias + " aprobadas</span>" +
          "<span>Promedio <b>" + esc(m.promedioSinAplazos.replace(".", ",")) + "</b></span>" +
        "</div>" +
        '<div class="hoy-barra" role="progressbar" aria-label="Avance de la carrera" aria-valuemin="0" aria-valuemax="100" ' +
          'aria-valuenow="' + m.porcentajeAvance + '"><span style="width:' + m.porcentajeAvance + '%"></span></div>';
    },

    /* ====================================================================
       PRÓXIMA MESA
       ==================================================================== */
    proximaMesa: function () {
      var sheets = global.OdontoLiveSheets;
      var items = sheets && sheets.cachedItems ? sheets.cachedItems : [];
      var ahora = Date.now();

      return items.map(function (item) {
        var fecha = UI.parseFechaTexto(item.dia);
        if (!fecha) return null;
        var hm = horaDe(item.hora);
        var cuando = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), hm[0], hm[1]);
        return { item: item, cuando: cuando };
      }).filter(function (e) {
        return e && e.cuando.getTime() > ahora;
      }).sort(function (a, b) { return a.cuando - b.cuando; })[0] || null;
    },

    pintarMesa: function () {
      var cont = document.getElementById("hoy-mesa");
      if (!cont) return;

      var sheets = global.OdontoLiveSheets;
      var cargadas = sheets && sheets.cachedItems && sheets.cachedItems.length;
      var proxima = this.proximaMesa();

      if (!proxima) {
        cont.innerHTML =
          '<div class="hoy-mesa-cab"><span class="hoy-pastilla">Próxima mesa</span></div>' +
          '<p class="hoy-vacio">' + (cargadas
            ? "No hay mesas próximas en la planilla oficial. Cuando la cátedra publique el turno nuevo, aparece acá."
            : "Buscando las fechas en la planilla oficial…") + "</p>" +
          '<a class="hoy-enlace" href="#fechas/mesas" data-nav="fechas/mesas">Ver la planilla ' + UI.icono("flecha-der") + "</a>";
        return;
      }

      var it = proxima.item;
      var falta = proxima.cuando.getTime() - Date.now();
      var dias = Math.floor(falta / 86400000);
      var horas = Math.floor((falta % 86400000) / 3600000);
      var esRevalida = it.tipo === "revalida" || it.tipo === "actualizacion";
      var esZoom = /zoom/i.test(it.modalidad || "");
      var destino = esRevalida ? "fechas/revalidas" : "fechas/mesas";
      var d = proxima.cuando;

      cont.innerHTML =
        '<div class="hoy-mesa-cab">' +
          '<span class="hoy-pastilla">' + (esRevalida ? "Próxima reválida" : "Próxima mesa") + "</span>" +
          "<small>La inscripción cierra 48 h hábiles antes</small>" +
        "</div>" +
        '<h3 class="hoy-mesa-materia">' + esc(it.materiaOriginal || it.materia) + "</h3>" +
        '<p class="hoy-mesa-meta">' +
          "<span>" + esc(DIAS[d.getDay()].charAt(0).toUpperCase() + DIAS[d.getDay()].slice(1) + " " + d.getDate() + " de " + MESES[d.getMonth()]) + "</span>" +
          "<span>" + esc(it.hora || "Horario a confirmar") + "</span>" +
          (it.idZoom && !esZoom ? "<span>" + esc(it.idZoom) + "</span>" : "") +
        "</p>" +
        '<div class="hoy-cuenta">' +
          "<div><b>" + dias + "</b><small>" + (dias === 1 ? "día" : "días") + "</small></div>" +
          "<div><b>" + horas + "</b><small>" + (horas === 1 ? "hora" : "horas") + "</small></div>" +
          "<div><b>" + UI.icono(esZoom ? "video" : "pin") + "</b><small>" + (esZoom ? "Zoom" : "Presencial") + "</small></div>" +
        "</div>" +
        '<a class="hoy-enlace" href="#' + destino + '" data-nav="' + destino + '">Ver todas ' + UI.icono("flecha-der") + "</a>";
    },

    /* ====================================================================
       ESTA SEMANA
       ==================================================================== */
    pintarSemana: function () {
      var cont = document.getElementById("hoy-semana");
      if (!cont) return;

      var u = usuario();
      var agenda = global.OdontoAgenda;

      if (!u || !agenda) {
        cont.innerHTML = '<p class="hoy-vacio">Anotá tus entregas y tus finales en la agenda, y los ves acá cada vez que entrás.</p>' +
          '<a class="hoy-enlace" href="#carrera/agenda" data-nav="carrera/agenda">Ir a la agenda ' + UI.icono("flecha-der") + "</a>";
        return;
      }

      if (!agenda.cargado) {
        cont.innerHTML = '<p class="hoy-vacio">' + UI.icono("cargando", "ic-gira") + " Trayendo tu agenda…</p>";
        // La agenda avisa cuando termina (ver agenda.js: traer).
        if (!agenda.cargando) agenda.traer();
        return;
      }

      var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      var tope = new Date(hoy.getTime() + 7 * 86400000);

      var proximos = agenda.recordatorios.filter(function (r) {
        var p = String(r.fecha).split("-");
        var f = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
        r._f = f;
        return !r.hecho && f >= hoy && f < tope;
      }).sort(function (a, b) {
        return a._f - b._f || String(a.hora || "99").localeCompare(String(b.hora || "99"));
      });

      if (!proximos.length) {
        cont.innerHTML = '<p class="hoy-vacio">No tenés nada anotado para los próximos siete días.</p>' +
          '<a class="hoy-enlace" href="#carrera/agenda" data-nav="carrera/agenda">Anotar algo ' + UI.icono("flecha-der") + "</a>";
        return;
      }

      cont.innerHTML = '<ul class="hoy-lista">' + proximos.slice(0, 5).map(function (r) {
        var dia = DIAS[r._f.getDay()].slice(0, 3);
        var detalle = [r.materia, r.hora].filter(Boolean).join(" · ");
        return (
          "<li>" +
            '<span class="hoy-dia"><b>' + r._f.getDate() + "</b><small>" + esc(dia) + "</small></span>" +
            '<span class="hoy-lista-texto"><strong>' + esc(r.titulo) + "</strong>" +
              (detalle ? "<small>" + esc(detalle) + "</small>" : "") + "</span>" +
          "</li>"
        );
      }).join("") + "</ul>";
    },

    /* ====================================================================
       TU AÑO
       ==================================================================== */
    /**
     * Tu año, en una tarjeta chica: cuántas materias, cuántas tienen clases
     * grabadas y, con cuenta, cómo venís. Antes estaban las doce materias en
     * una grilla: era la mitad del inicio. El detalle está a un toque.
     */
    pintarAnio: function () {
      var chips = document.getElementById("hoy-anio-chips");
      var cont = document.getElementById("hoy-materias");
      var titulo = document.getElementById("hoy-anio-titulo");
      if (!chips || !cont) return;

      var self = this;
      if (titulo) titulo.textContent = "Tu " + ORDINAL[this.anio] + " año";

      chips.innerHTML = [1, 2, 3, 4, 5].map(function (a) {
        return '<button type="button" class="chip-anio' + (a === self.anio ? " es-activo" : "") + '" ' +
               'data-action="hoyAnio" data-anio="' + a + '" aria-pressed="' + (a === self.anio) + '">' + a + ".º</button>";
      }).join("");

      var calc = global.OdontoCalculator;
      var materias = calc ? calc.getTodasLasMaterias().filter(function (m) { return m.anio === self.anio; }) : [];
      var recursos = global.OdontoRecursos;
      var conClases = materias.filter(function (m) {
        return recursos && recursos.clasesDe && recursos.clasesDe(m.nombre);
      }).length;

      var avance = "";
      if (usuario() && calc) {
        var notas = calc.getNotas();
        var aprobadas = 0, regulares = 0;
        materias.forEach(function (m) {
          var r = notas[m.codigo];
          if (r && r.estado === "aprobada") aprobadas++;
          else if (r && r.estado === "regular") regulares++;
        });
        var pct = materias.length ? Math.round((aprobadas / materias.length) * 100) : 0;
        avance =
          '<div class="hoy-anio-avance">' +
            '<div class="hoy-barra hoy-barra-clara"><span style="width:' + pct + '%"></span></div>' +
            "<small>" + aprobadas + " de " + materias.length + " aprobadas" +
              (regulares ? " · " + regulares + " regular" + (regulares === 1 ? "" : "es") : "") + "</small>" +
          "</div>";
      }

      cont.innerHTML =
        '<p class="hoy-anio-resumen">' +
          "<b>" + materias.length + "</b> materias" +
          (conClases ? " · <b>" + conClases + "</b> con clases grabadas" : "") +
        "</p>" +
        avance +
        '<div class="hoy-anio-acciones">' +
          '<button type="button" class="btn btn-secondary btn-sm" data-action="hoyVerMaterias">' +
            UI.icono("birrete") + " Ver mis materias</button>" +
          '<a class="btn btn-secondary btn-sm" href="#recursos" data-nav="recursos">' +
            UI.icono("video") + " Clases y cátedras</a>" +
        "</div>";
    },

    /** Abre el plan de estudios ya filtrado por el año elegido. */
    verMaterias: function () {
      var calc = global.OdontoCalculator;
      if (calc) calc.filtroAnio = String(this.anio);
      var filtro = document.getElementById("calc-filter-anio");
      if (filtro) filtro.value = String(this.anio);
      if (global.OdontoApp) global.OdontoApp.navegarA("carrera/plan");
    },

    /* ====================================================================
       ODONTOPREGUNTADOS (de la facultad)
       ==================================================================== */
    pintarOdontopreguntados: function () {
      var cont = document.getElementById("odp-aviso");
      if (!cont) return;
      var cierre = proximoCierre();
      var d = cierre;
      var fecha = DIAS[d.getDay()] + " " + d.getDate() + " de " + MESES[d.getMonth()];
      var urgente = cierre - Date.now() < 36 * 3600000;

      cont.innerHTML =
        '<div class="odp-tarjeta' + (urgente ? " es-urgente" : "") + '">' +
          '<span class="odp-icono" aria-hidden="true">' + UI.icono("diente") + "</span>" +
          '<p class="odp-rotulo">Odontopreguntados · de la facultad</p>' +
          "<h3>Tenés tiempo hasta el " + esc(fecha) + " a las 23:59</h3>" +
          '<p class="odp-falta" role="status">Quedan <b>' + esc(cuantoFalta(cierre)) + "</b></p>" +
          '<p class="odp-texto">Se completa en las aulas virtuales de la FOLP, con tu usuario de la facultad. ' +
            "Cierra todos los lunes a las 23:59.</p>" +
          '<a class="btn btn-magenta btn-lg odp-boton" href="' + AULAS + '" target="_blank" rel="noopener noreferrer">' +
            "Completarlo en las aulas virtuales " + UI.icono("externo") +
            '<span class="visually-hidden"> (se abre en una pestaña nueva)</span></a>' +
        "</div>";
    },

    /** En "Hoy", desde el domingo hasta el cierre del lunes. */
    pintarRecordatorioOdp: function () {
      var cont = document.getElementById("hoy-odp");
      if (!cont) return;
      var hoy = new Date().getDay();
      if (hoy !== 0 && hoy !== 1) { cont.hidden = true; return; }

      var cierre = proximoCierre();
      var cuando = cierre.getDay() === new Date().getDay() ? "hoy" : "mañana";
      cont.hidden = false;
      cont.innerHTML =
        '<span class="odp-icono" aria-hidden="true">' + UI.icono("diente") + "</span>" +
        '<div class="hoy-odp-texto"><strong>Odontopreguntados cierra ' + cuando + " a las 23:59</strong>" +
          "<small>Quedan " + esc(cuantoFalta(cierre)) + "</small></div>" +
        '<a class="btn btn-magenta btn-sm" href="' + AULAS + '" target="_blank" rel="noopener noreferrer">' +
          "Completar" + '<span class="visually-hidden"> Odontopreguntados en las aulas virtuales (se abre en una pestaña nueva)</span></a>';
    }
  };

  global.OdontoHoy = OdontoHoy;
})(window);
