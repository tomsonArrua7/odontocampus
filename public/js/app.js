/* ==========================================================================
   ODONTOCAMPUS — CONTROLADOR GENERAL
   Router de secciones y pestañas, panel de inicio, historias clínicas,
   biblioteca, bolsa, guía de instrumental y buscador global.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var esc = UI.esc, escAttr = UI.escAttr, $ = UI.$, $$ = UI.$$, on = UI.on;

  /* ------------------------------------------------------------------------
     MAPA DE NAVEGACIÓN
     Cinco destinos agrupados por momento de uso en lugar de siete destinos
     planos. Cada uno declara sus pestañas internas.
     --------------------------------------------------------------------- */
  var RUTAS = {
    inicio:     { titulo: "Inicio", tabs: null },
    fechas:     { titulo: "Cuándo rindo", tabs: ["mesas", "revalidas"] },
    cursada:    { titulo: "Cursada y clínica", tabs: ["historias", "instrumental", "bolsa"] },
    biblioteca: { titulo: "Biblioteca de apuntes", tabs: null },
    carrera:    { titulo: "Mi carrera", tabs: ["promedio", "permutas"] }
  };

  /* Enlaces viejos que la gente pudo haber guardado o compartido por WhatsApp.
     Romperlos sería tirar a la basura los favoritos de todo el mundo. */
  var ALIAS = {
    mesas: "fechas/mesas",
    revalidas: "fechas/revalidas",
    historias: "cursada/historias",
    instrumental: "cursada/instrumental",
    bolsa: "cursada/bolsa",
    calculadora: "carrera/promedio",
    promedio: "carrera/promedio",
    permutas: "carrera/permutas"
  };

  var OdontoApp = {
    seccionActual: "inicio",
    tabsPorSeccion: {},
    ultimosResultadosSearch: [],

    /* ======================================================================
       ARRANQUE
       ====================================================================== */
    init: function () {
      UI.theme.init();
      UI.initActionDelegation();
      UI.initModals();
      this.registrarAcciones();

      this.initTabs();
      this.initNavegacion();
      this.initAtajosTeclado();

      this.initNoticias();
      this.initFechasClave();
      this.initHistoriasClinicas();
      this.initBiblioteca();
      this.initBolsaInstrumental();
      this.initGuiaInstrumental();
      this.initBuscadorGlobal();

      if (global.OdontoCalculator) global.OdontoCalculator.init();
      if (global.OdontoPermutas) global.OdontoPermutas.init();
      if (global.OdontoBot) global.OdontoBot.init();
      if (global.OdontoLiveSheets) global.OdontoLiveSheets.init();

      /* Cuentas. Se inicializan siempre, pero se apagan solas si el backend
         todavía no está configurado: el sitio funciona completo sin ellas. */
      if (global.OdontoAuth) global.OdontoAuth.init();
      if (global.OdontoSync) global.OdontoSync.init();

      this.aplicarRutaDeUrl();
      on(global, "hashchange", this.aplicarRutaDeUrl.bind(this));
    },

    /* ======================================================================
       ACCIONES (reemplazan a los onclick del HTML)
       ====================================================================== */
    registrarAcciones: function () {
      var app = this;
      UI.registerActions({
        ir: function (data) { app.navegarA(data.destino); },
        cambiarTema: function () { UI.theme.toggle(); },
        abrirBusqueda: function () { app.abrirModalSearch(); },
        cerrarBusqueda: function () { UI.closeModal("modal-search-global"); },
        cerrarModal: function () { UI.closeModal("modal-generico"); },
        verNoticia: function (data) { app.verDetalleNoticia(Number(data.id)); },
        verHC: function (data) { app.verVistaPreviaHC(data.id); },
        imprimirHC: function (data) { app.imprimirHC(data.id); },
        descargarApunte: function (data) { app.descargarApunte(data.titulo); },
        resultadoBusqueda: function (data) { app.ejecutarResultado(Number(data.idx)); },
        limpiarFiltro: function (data) { app.limpiarFiltro(data.campo, data.selects); }
      });
    },

    /* ======================================================================
       NAVEGACIÓN
       ====================================================================== */
    initTabs: function () {
      var app = this;
      Object.keys(RUTAS).forEach(function (seccion) {
        if (!RUTAS[seccion].tabs) return;
        var root = document.getElementById("seccion-" + seccion);
        if (!root) return;
        app.tabsPorSeccion[seccion] = UI.initTabs(root, function (tabId) {
          app.alCambiarTab(seccion, tabId);
          // La URL refleja la pestaña: así un enlace a "reválidas" abre reválidas
          var nuevo = "#" + seccion + "/" + tabId;
          if (global.location.hash !== nuevo) {
            global.history.replaceState(null, "", nuevo);
          }
          app.marcarEnlacesActivos(seccion, tabId);
        });
      });
    },

    initNavegacion: function () {
      var app = this;

      document.addEventListener("click", function (event) {
        var link = event.target.closest("[data-nav]");
        if (!link) return;
        event.preventDefault();
        app.navegarA(link.getAttribute("data-nav"));
      });

      var btn = document.getElementById("mobile-menu-btn");
      var menu = document.getElementById("mobile-nav-menu");
      if (btn && menu) {
        on(btn, "click", function () {
          var abierto = menu.classList.toggle("active");
          btn.setAttribute("aria-expanded", abierto ? "true" : "false");
          btn.setAttribute("aria-label", abierto ? "Cerrar menú" : "Abrir menú");
          btn.innerHTML = abierto
            ? '<i class="fa-solid fa-xmark" aria-hidden="true"></i>'
            : '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
        });
      }
    },

    cerrarMenuMovil: function () {
      var btn = document.getElementById("mobile-menu-btn");
      var menu = document.getElementById("mobile-nav-menu");
      if (!menu || !menu.classList.contains("active")) return;
      menu.classList.remove("active");
      if (btn) {
        btn.setAttribute("aria-expanded", "false");
        btn.setAttribute("aria-label", "Abrir menú");
        btn.innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
      }
    },

    /** Acepta "fechas", "fechas/revalidas" y los alias viejos ("mesas"). */
    parsearRuta: function (ruta) {
      var limpio = String(ruta || "").replace(/^#/, "").trim();
      if (ALIAS[limpio]) limpio = ALIAS[limpio];

      var partes = limpio.split("/");
      var seccion = partes[0] || "inicio";
      var tab = partes[1] || null;

      if (!RUTAS[seccion]) {
        if (ALIAS[seccion]) return this.parsearRuta(ALIAS[seccion]);
        seccion = "inicio";
        tab = null;
      }
      var tabsDisponibles = RUTAS[seccion].tabs;
      if (tabsDisponibles) {
        if (!tab || tabsDisponibles.indexOf(tab) === -1) tab = tabsDisponibles[0];
      } else {
        tab = null;
      }
      return { seccion: seccion, tab: tab };
    },

    navegarA: function (ruta) {
      var destino = this.parsearRuta(ruta);
      var hash = "#" + destino.seccion + (destino.tab ? "/" + destino.tab : "");
      if (global.location.hash === hash) {
        this.mostrar(destino, true);
      } else {
        global.location.hash = hash; // dispara hashchange → aplicarRutaDeUrl
      }
    },

    aplicarRutaDeUrl: function () {
      this.mostrar(this.parsearRuta(global.location.hash), false);
    },

    mostrar: function (destino, forzarFoco) {
      var seccionEl = document.getElementById("seccion-" + destino.seccion);
      if (!seccionEl) return;

      var cambioDeSeccion = this.seccionActual !== destino.seccion;

      $$(".app-section").forEach(function (sec) { sec.classList.remove("active"); });
      seccionEl.classList.add("active");
      this.seccionActual = destino.seccion;

      if (destino.tab && this.tabsPorSeccion[destino.seccion]) {
        this.tabsPorSeccion[destino.seccion].select(destino.tab, false);
      } else {
        this.alCambiarTab(destino.seccion, null);
      }

      this.marcarEnlacesActivos(destino.seccion, destino.tab);
      this.cerrarMenuMovil();

      if (cambioDeSeccion || forzarFoco) {
        global.scrollTo({ top: 0, behavior: "smooth" });
        /* Mover el foco al inicio de la sección: sin esto, quien navega con
           teclado o lector de pantalla se queda en el enlace del menú y no
           percibe que la página cambió. */
        var main = document.getElementById("contenido-principal");
        if (main) main.focus({ preventScroll: true });
        UI.announce("Sección " + (RUTAS[destino.seccion] || {}).titulo);
      }
    },

    marcarEnlacesActivos: function (seccion, tab) {
      var rutaCompleta = seccion + (tab ? "/" + tab : "");
      $$("[data-nav]").forEach(function (link) {
        var valor = link.getAttribute("data-nav");
        var activo = valor === rutaCompleta || valor === seccion;
        link.classList.toggle("active", activo && link.classList.contains("nav-link"));
        if (activo && link.classList.contains("nav-link")) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    },

    /** Cada pestaña reclama su render al mostrarse (evita trabajo invisible). */
    alCambiarTab: function (seccion, tab) {
      if (seccion === "fechas" && global.OdontoLiveSheets) {
        if (tab === "revalidas") global.OdontoLiveSheets.renderRevalidas();
        else global.OdontoLiveSheets.renderMesasExamen();
      } else if (seccion === "carrera") {
        if (tab === "permutas" && global.OdontoPermutas) global.OdontoPermutas.render();
        else if (global.OdontoCalculator) global.OdontoCalculator.renderTabla();
      }
    },

    /* ======================================================================
       ATAJOS DE TECLADO
       ====================================================================== */
    initAtajosTeclado: function () {
      var app = this;
      on(global, "keydown", function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          app.abrirModalSearch();
          return;
        }
        if (event.key === "Escape") {
          if (UI.anyModalOpen()) { UI.closeTopModal(); return; }
          var chat = document.getElementById("odontobot-window");
          if (chat && chat.classList.contains("active") && global.OdontoBot) {
            global.OdontoBot.toggleChat();
            return;
          }
          app.cerrarMenuMovil();
        }
      });
    },

    /* ======================================================================
       INICIO · próximas fechas
       Es lo primero que se ve porque es lo primero que se necesita: no
       "explorar la plataforma", sino saber qué te toca esta semana.
       ====================================================================== */
    renderProximasFechas: function () {
      var cont = document.getElementById("proximas-fechas-lista");
      if (!cont) return;

      var sheets = global.OdontoLiveSheets;
      var items = sheets && sheets.cachedItems ? sheets.cachedItems : [];

      var proximos = items
        .map(function (item) {
          return { item: item, fecha: UI.parseFechaTexto(item.dia) };
        })
        .filter(function (entry) {
          var d = UI.diasHasta(entry.fecha);
          return d !== null && d >= 0;
        })
        .sort(function (a, b) { return a.fecha - b.fecha; })
        .slice(0, 4);

      if (!proximos.length) {
        cont.innerHTML =
          '<p class="search-hint">' +
          (items.length
            ? "No hay fechas próximas cargadas en la planilla. Mirá el listado completo por si hay llamados sin fecha confirmada."
            : "Todavía estamos trayendo las fechas desde la planilla oficial.") +
          "</p>";
        return;
      }

      cont.innerHTML = proximos.map(function (entry) {
        var it = entry.item;
        var corta = UI.fechaCorta(entry.fecha);
        var esRevalida = it.tipo === "revalida" || it.tipo === "actualizacion";
        var destino = esRevalida ? "fechas/revalidas" : "fechas/mesas";
        var esZoom = String(it.modalidad || "").toLowerCase().indexOf("zoom") !== -1;

        return (
          '<a class="next-item" href="#' + destino + '" data-nav="' + destino + '">' +
            '<span class="next-item-when">' +
              "<b>" + esc(corta.dia) + "</b><span>" + esc(corta.mes) + "</span>" +
            "</span>" +
            '<span class="next-item-what">' +
              "<strong>" + esc(it.materiaOriginal || it.materia) + "</strong>" +
              "<small>" +
                "<span>" + esc(UI.cuandoTexto(entry.fecha)) + "</span>" +
                "<span>" + esc(it.hora || "Horario a confirmar") + "</span>" +
                "<span>" + (esZoom ? "Por Zoom" : "Presencial") + "</span>" +
              "</small>" +
            "</span>" +
          "</a>"
        );
      }).join("");
    },

    /* ======================================================================
       INICIO · trámites y plazos
       ====================================================================== */
    initFechasClave: function () {
      var cont = document.getElementById("fechas-clave-lista");
      if (!cont || !global.ODONTO_DATA || !global.ODONTO_DATA.fechasClave) return;

      cont.innerHTML = global.ODONTO_DATA.fechasClave.map(function (f) {
        return (
          '<div class="fecha-item' + (f.urgente ? " fecha-urgente" : "") + '">' +
            '<div class="fecha-date-badge">' +
              '<i class="fa-solid fa-calendar-day" aria-hidden="true"></i>' +
              "<span>" + esc(f.fecha) + "</span>" +
            "</div>" +
            '<div class="fecha-info">' +
              "<h4>" + esc(f.evento) + "</h4>" +
              '<p class="fecha-meta">' +
                '<span><i class="fa-solid fa-tag" aria-hidden="true"></i> ' + esc(f.tipo) + "</span>" +
                '<span><i class="fa-solid fa-desktop" aria-hidden="true"></i> ' + esc(f.sistema) + "</span>" +
              "</p>" +
            "</div>" +
          "</div>"
        );
      }).join("");
    },

    /* ======================================================================
       NOTICIAS
       ====================================================================== */
    initNoticias: function () {
      var cont = document.getElementById("noticias-grid");
      if (!cont || !global.ODONTO_DATA) return;

      cont.innerHTML = global.ODONTO_DATA.noticias.map(function (n) {
        return (
          '<article class="news-card' + (n.destacado ? " news-destacada" : "") + '">' +
            '<div class="news-header">' +
              '<span class="news-tag">' + esc(n.tag) + "</span>" +
              '<span class="news-date">' + esc(n.fecha) + "</span>" +
            "</div>" +
            '<h3 class="news-title">' + esc(n.titulo) + "</h3>" +
            '<p class="news-summary">' + esc(n.resumen) + "</p>" +
            '<div class="news-footer">' +
              '<span class="author-badge"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> ' + esc(n.autor) + "</span>" +
              '<button type="button" class="btn btn-outline-magenta btn-sm" data-action="verNoticia" data-id="' + esc(n.id) + '">' +
                "Leer más" +
                '<span class="visually-hidden"> sobre ' + esc(n.titulo) + "</span>" +
                '<i class="fa-solid fa-arrow-right" aria-hidden="true"></i>' +
              "</button>" +
            "</div>" +
          "</article>"
        );
      }).join("");
    },

    verDetalleNoticia: function (id) {
      var n = (global.ODONTO_DATA.noticias || []).find(function (item) { return item.id === id; });
      if (!n) return;

      this.mostrarModalGenerico(
        '<div><span class="badge-materia-anio">' + esc(n.categoria) + "</span>" +
        "<h2>" + esc(n.titulo) + "</h2></div>",
        '<p class="modal-lead">' + esc(n.resumen) + "</p>" +
        '<div class="callout" style="margin-top:1.5rem">' +
          '<i class="fa-solid fa-bullhorn" aria-hidden="true"></i>' +
          "<div><h3>Comunicado de FOE</h3>" +
          "<p>Para más detalles o gestiones académicas, acercate a la mesa en el hall de la facultad o escribinos por nuestras redes.</p></div>" +
        "</div>" +
        '<div class="modal-card-footer" style="border:0;background:none;padding-inline:0">' +
          '<span class="filter-note"><i class="fa-solid fa-user-check" aria-hidden="true"></i> ' + esc(n.autor) + "</span>" +
          '<a href="https://instagram.com/foe_odontounlp" target="_blank" rel="noopener noreferrer" class="btn btn-magenta btn-sm">' +
            '<i class="fa-brands fa-instagram" aria-hidden="true"></i> Instagram de FOE' +
          "</a>" +
        "</div>"
      );
    },

    /* ======================================================================
       HISTORIAS CLÍNICAS
       ====================================================================== */
    initHistoriasClinicas: function () {
      var app = this;
      if (!document.getElementById("historias-grid") || !global.ODONTO_DATA) return;

      this.renderHistoriasClinicas(global.ODONTO_DATA.historiasClinicas);

      var input = document.getElementById("hc-search-input");
      if (input) {
        on(input, "input", UI.debounce(function () {
          var q = UI.normalizar(input.value);
          var lista = global.ODONTO_DATA.historiasClinicas.filter(function (hc) {
            return UI.normalizar(hc.titulo).indexOf(q) !== -1 ||
                   UI.normalizar(hc.catedra).indexOf(q) !== -1 ||
                   hc.tags.some(function (t) { return UI.normalizar(t).indexOf(q) !== -1; });
          });
          app.renderHistoriasClinicas(lista, input.value);
        }));
      }
    },

    renderHistoriasClinicas: function (lista, consulta) {
      var cont = document.getElementById("historias-grid");
      if (!cont) return;

      this.resumen("historias-summary", lista.length, "modelo", "modelos", consulta);

      if (!lista.length) {
        cont.innerHTML = UI.emptyState({
          icon: "fa-file-circle-question",
          title: "No encontramos ese modelo",
          text: 'Probá con el área de la cátedra: "Operatoria", "Cirugía", "Endodoncia" o "Periodoncia".',
          action: "limpiarFiltro",
          actionLabel: "Ver todos los modelos"
        }).replace('data-action="limpiarFiltro"', 'data-action="limpiarFiltro" data-campo="hc-search-input"');
        return;
      }

      cont.innerHTML = lista.map(function (hc) {
        return (
          '<article class="hc-card">' +
            '<div class="hc-header">' +
              '<span class="badge-materia-anio">' + esc(hc.anio) + "</span>" +
              '<span class="hc-pages"><i class="fa-regular fa-file-lines" aria-hidden="true"></i> ' + esc(hc.paginas) + " págs</span>" +
            "</div>" +
            '<h3 class="hc-title">' + esc(hc.titulo) + "</h3>" +
            '<p class="hc-catedra"><i class="fa-solid fa-building-columns" aria-hidden="true"></i> ' + esc(hc.catedra) + "</p>" +
            '<p class="hc-desc">' + esc(hc.descripcion) + "</p>" +
            '<div class="hc-tags-container">' +
              hc.tags.map(function (t) { return '<span class="hc-tag">' + esc(t) + "</span>"; }).join("") +
            "</div>" +
            '<div class="hc-actions">' +
              '<button type="button" class="btn btn-secondary btn-sm" data-action="verHC" data-id="' + escAttr(hc.id) + '">' +
                '<i class="fa-solid fa-eye" aria-hidden="true"></i> Ver qué incluye' +
              "</button>" +
              '<button type="button" class="btn btn-magenta btn-sm" data-action="imprimirHC" data-id="' + escAttr(hc.id) + '">' +
                '<i class="fa-solid fa-print" aria-hidden="true"></i> Imprimir' +
              "</button>" +
            "</div>" +
          "</article>"
        );
      }).join("");
    },

    verVistaPreviaHC: function (id) {
      var hc = (global.ODONTO_DATA.historiasClinicas || []).find(function (item) { return item.id === id; });
      if (!hc) return;

      this.mostrarModalGenerico(
        "<div><h2>" + esc(hc.titulo) + '</h2><span class="badge-materia-anio">' + esc(hc.catedra) + "</span></div>",
        "<p>Estructura que pide la cátedra. La versión imprimible trae todos estos campos en blanco, listos para completar a mano.</p>" +
        '<ul class="check-list" style="margin:1.25rem 0">' +
          hc.secciones.map(function (s) {
            return '<li><i class="fa-solid fa-check" aria-hidden="true"></i><span>' + esc(s) + "</span></li>";
          }).join("") +
        "</ul>" +
        '<div class="callout">' +
          '<i class="fa-solid fa-lightbulb" aria-hidden="true"></i>' +
          "<div><h3>Antes de anestesiar</h3>" +
          "<p>Presentá la historia firmada por el docente y guardá siempre el consentimiento informado original del paciente.</p></div>" +
        "</div>" +
        '<div class="modal-card-footer" style="border:0;background:none;padding-inline:0">' +
          '<button type="button" class="btn btn-secondary" data-action="cerrarModal">Cerrar</button>' +
          '<button type="button" class="btn btn-magenta" data-action="imprimirHC" data-id="' + escAttr(hc.id) + '">' +
            '<i class="fa-solid fa-print" aria-hidden="true"></i> Abrir versión imprimible' +
          "</button>" +
        "</div>"
      );
    },

    imprimirHC: function (id) {
      var hc = (global.ODONTO_DATA.historiasClinicas || []).find(function (item) { return item.id === id; });
      if (!hc) return;

      var ventana = global.open("", "_blank");
      if (!ventana) {
        UI.toast("Tu navegador bloqueó la ventana. Habilitá las ventanas emergentes para este sitio.", "warning");
        return;
      }

      var camposPaciente = [
        [["Paciente", 250], ["DNI", 130], ["Edad", 50]],
        [["Domicilio", 230], ["Teléfono", 130], ["Fecha", 80]],
        [["Estudiante / operador", 200], ["Comisión", 60], ["Docente a cargo", 160]]
      ];

      var html =
        "<!DOCTYPE html><html lang=\"es\"><head><meta charset=\"UTF-8\">" +
        "<title>" + esc(hc.titulo) + " — FOE OdontoCampus</title><style>" +
        "@page{margin:16mm}" +
        "body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#111;line-height:1.5;font-size:12pt}" +
        ".header{text-align:center;border-bottom:2px solid #0B192C;padding-bottom:12px;margin-bottom:18px}" +
        ".logo-text{font-size:15pt;font-weight:bold;color:#C4006B;letter-spacing:1px}" +
        ".sub{font-size:10pt;color:#444}" +
        ".hc-title{font-size:14pt;font-weight:bold;color:#0B192C;margin-top:8px}" +
        ".patient-box{border:1px solid #999;border-radius:4px;padding:10px;margin-bottom:18px}" +
        ".row{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;font-size:10.5pt}" +
        ".field{border-bottom:1px dotted #666;display:inline-block}" +
        ".section-title{background:#eef2f6;padding:5px 9px;font-size:11pt;font-weight:bold;" +
          "margin-top:16px;border-left:4px solid #C4006B;break-after:avoid}" +
        ".write-area{height:64px;border-bottom:1px dashed #aaa;margin-bottom:8px}" +
        ".signature-area{margin-top:36px;display:flex;justify-content:space-around;text-align:center;font-size:9.5pt}" +
        ".sig-line{border-top:1px solid #000;width:170px;margin-bottom:4px}" +
        ".toolbar{background:#eef6ff;padding:10px;text-align:center;margin-bottom:16px;border-radius:4px}" +
        ".toolbar button{background:#C4006B;color:#fff;border:0;padding:10px 18px;border-radius:4px;" +
          "font-weight:bold;font-size:11pt;cursor:pointer}" +
        "@media print{.toolbar{display:none}}" +
        "</style></head><body>" +
        '<div class="toolbar"><button type="button" onclick="window.print()">Imprimir o guardar como PDF</button></div>' +
        '<div class="header">' +
          '<div class="logo-text">ODONTOCAMPUS · FOE ODONTOLOGÍA UNLP</div>' +
          '<div class="sub">Facultad de Odontología — Universidad Nacional de La Plata</div>' +
          '<div class="hc-title">' + esc(hc.titulo.toUpperCase()) + "</div>" +
          '<div class="sub">Cátedra: ' + esc(hc.catedra) + "</div>" +
        "</div>" +
        '<div class="patient-box">' +
          camposPaciente.map(function (fila) {
            return '<div class="row">' + fila.map(function (campo) {
              return "<div><strong>" + esc(campo[0]) + ':</strong> <span class="field" style="width:' + campo[1] + 'px"></span></div>';
            }).join("") + "</div>";
          }).join("") +
        "</div>" +
        hc.secciones.map(function (sec) {
          return '<div class="section-title">' + esc(sec) + '</div><div class="write-area"></div>';
        }).join("") +
        '<div class="signature-area">' +
          '<div><div class="sig-line"></div>Firma del estudiante</div>' +
          '<div><div class="sig-line"></div>Firma del docente</div>' +
          '<div><div class="sig-line"></div>Firma y consentimiento del paciente</div>' +
        "</div></body></html>";

      ventana.document.write(html);
      ventana.document.close();
      UI.toast('Se abrió la plantilla de "' + hc.titulo + '" en una pestaña nueva', "success");
    },

    /* ======================================================================
       BIBLIOTECA
       ====================================================================== */
    initBiblioteca: function () {
      var app = this;
      if (!document.getElementById("biblioteca-grid") || !global.ODONTO_DATA) return;

      var selectAnio = document.getElementById("biblio-filter-anio");
      var inputSearch = document.getElementById("biblio-search-input");

      function aplicar() {
        var anio = selectAnio ? selectAnio.value : "todos";
        var q = UI.normalizar(inputSearch ? inputSearch.value : "");
        var lista = global.ODONTO_DATA.biblioteca;

        if (anio !== "todos") {
          lista = lista.filter(function (item) { return item.anio.indexOf(anio) !== -1; });
        }
        if (q) {
          lista = lista.filter(function (item) {
            return UI.normalizar(item.titulo).indexOf(q) !== -1 ||
                   UI.normalizar(item.materia).indexOf(q) !== -1 ||
                   item.tags.some(function (t) { return UI.normalizar(t).indexOf(q) !== -1; });
          });
        }
        app.renderBiblioteca(lista, (inputSearch && inputSearch.value) || (anio !== "todos" ? anio : ""));
      }

      this.renderBiblioteca(global.ODONTO_DATA.biblioteca);
      if (selectAnio) on(selectAnio, "change", aplicar);
      if (inputSearch) on(inputSearch, "input", UI.debounce(aplicar));
    },

    renderBiblioteca: function (lista, consulta) {
      var cont = document.getElementById("biblioteca-grid");
      if (!cont) return;

      this.resumen("biblioteca-summary", lista.length, "apunte", "apuntes", consulta);

      if (!lista.length) {
        cont.innerHTML = UI.emptyState({
          icon: "fa-book-bookmark",
          title: "Todavía no hay apuntes con esa búsqueda",
          text: "Probá con otra materia o quitá el filtro de año. Si tenés un resumen para compartir, acercalo por la mesa de FOE."
        });
        return;
      }

      cont.innerHTML = lista.map(function (ap) {
        return (
          '<article class="biblio-card">' +
            '<div class="biblio-header">' +
              '<span class="badge-materia-anio">' + esc(ap.anio) + "</span>" +
              '<span class="biblio-type"><i class="fa-solid fa-bookmark" aria-hidden="true"></i> ' + esc(ap.tipo) + "</span>" +
            "</div>" +
            '<h3 class="biblio-title">' + esc(ap.titulo) + "</h3>" +
            '<p class="biblio-materia"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i> ' + esc(ap.materia) + "</p>" +
            '<p class="biblio-meta">' +
              '<span><i class="fa-solid fa-user-pen" aria-hidden="true"></i> ' + esc(ap.autor) + "</span>" +
              '<span><i class="fa-solid fa-file" aria-hidden="true"></i> ' + esc(ap.paginas) + " págs</span>" +
              '<span><i class="fa-solid fa-star" aria-hidden="true"></i> ' + esc(ap.valoracion) + "</span>" +
            "</p>" +
            '<div class="hc-tags-container">' +
              ap.tags.map(function (t) { return '<span class="hc-tag">' + esc(t) + "</span>"; }).join("") +
            "</div>" +
            '<div class="biblio-actions">' +
              '<button type="button" class="btn btn-magenta btn-sm btn-block" data-action="descargarApunte" data-titulo="' + escAttr(ap.titulo) + '">' +
                '<i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i> Descargar' +
                '<span class="visually-hidden"> ' + esc(ap.titulo) + "</span>" +
              "</button>" +
            "</div>" +
          "</article>"
        );
      }).join("");
    },

    descargarApunte: function (titulo) {
      UI.toast('"' + titulo + '" todavía no está subido. Pedilo en la mesa de FOE y lo cargamos.', "info");
    },

    /* ======================================================================
       BOLSA DE INSTRUMENTAL
       ====================================================================== */
    initBolsaInstrumental: function () {
      var app = this;
      if (!document.getElementById("bolsa-grid") || !global.ODONTO_DATA) return;

      this.renderBolsa(global.ODONTO_DATA.bolsaInstrumental);

      var input = document.getElementById("bolsa-search-input");
      if (input) {
        on(input, "input", UI.debounce(function () {
          var q = UI.normalizar(input.value);
          var lista = global.ODONTO_DATA.bolsaInstrumental.filter(function (item) {
            return UI.normalizar(item.titulo).indexOf(q) !== -1 ||
                   UI.normalizar(item.categoria).indexOf(q) !== -1 ||
                   UI.normalizar(item.vendedor).indexOf(q) !== -1;
          });
          app.renderBolsa(lista, input.value);
        }));
      }
    },

    renderBolsa: function (lista, consulta) {
      var cont = document.getElementById("bolsa-grid");
      if (!cont) return;

      this.resumen("bolsa-summary", lista.length, "publicación", "publicaciones", consulta);

      if (!lista.length) {
        cont.innerHTML = UI.emptyState({
          icon: "fa-toolbox",
          title: "No hay artículos con ese criterio",
          text: "Probá con el nombre genérico del instrumento (turbina, fórceps, articulador) en vez de la marca."
        });
        return;
      }

      cont.innerHTML = lista.map(function (art) {
        var mensaje = encodeURIComponent(
          "Hola " + art.vendedor + "! Vi tu publicación en OdontoCampus (FOE) por \"" + art.titulo + "\". ¿Sigue disponible?"
        );
        var tel = String(art.contactoWhatsapp || "").replace(/\D/g, "");
        var enlace = tel ? "https://wa.me/549" + tel + "?text=" + mensaje : "";

        return (
          '<article class="bolsa-card">' +
            '<span class="bolsa-badge">' + esc(art.categoria) + "</span>" +
            '<h3 class="bolsa-title">' + esc(art.titulo) + "</h3>" +
            '<p class="bolsa-price">' + esc(art.precio) + "</p>" +
            '<div class="bolsa-details">' +
              '<span><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Estado: ' + esc(art.estadoUso) + "</span>" +
              '<span><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Entrega: ' + esc(art.ubicacion) + "</span>" +
              '<span><i class="fa-solid fa-user" aria-hidden="true"></i> ' + esc(art.vendedor) + " · " + esc(art.fecha) + "</span>" +
            "</div>" +
            (enlace
              ? '<a href="' + UI.safeUrl(enlace) + '" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-block">' +
                  '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Escribir a ' + esc(art.vendedor) +
                "</a>"
              : '<p class="filter-note">Sin contacto cargado</p>') +
          "</article>"
        );
      }).join("");
    },

    /* ======================================================================
       GUÍA DE INSTRUMENTAL
       ====================================================================== */
    initGuiaInstrumental: function () {
      var cont = document.getElementById("guia-instrumental-grid");
      if (!cont || !global.ODONTO_DATA) return;

      cont.innerHTML = global.ODONTO_DATA.instrumentalGuia.map(function (guia) {
        return (
          '<article class="guia-card">' +
            '<h3 class="guia-title"><i class="fa-solid fa-briefcase-medical" aria-hidden="true"></i> ' + esc(guia.nombre) + "</h3>" +
            '<p class="guia-mats">' + esc(guia.materias.join(" · ")) + "</p>" +
            '<ul class="guia-elements">' +
              guia.elementos.map(function (e) {
                return '<li><i class="fa-solid fa-tooth" aria-hidden="true"></i><span>' + esc(e) + "</span></li>";
              }).join("") +
            "</ul>" +
            '<p class="guia-tip"><strong>Tip de FOE:</strong> ' + esc(guia.consejoFOE) + "</p>" +
          "</article>"
        );
      }).join("");
    },

    /* ======================================================================
       BUSCADOR GLOBAL
       ====================================================================== */
    initBuscadorGlobal: function () {
      var app = this;
      var input = document.getElementById("global-search-input");
      var cont = document.getElementById("global-search-results");
      if (!input || !cont) return;

      on(input, "input", UI.debounce(function () {
        app.buscarGlobal(input.value);
      }, 140));

      // Enter abre el primer resultado: el atajo que todo el mundo intenta
      on(input, "keydown", function (event) {
        if (event.key === "Enter" && app.ultimosResultadosSearch.length) {
          event.preventDefault();
          app.ejecutarResultado(0);
        }
      });
    },

    buscarGlobal: function (consulta) {
      var cont = document.getElementById("global-search-results");
      var input = document.getElementById("global-search-input");
      var q = UI.normalizar(consulta).trim();

      if (!q) {
        this.ultimosResultadosSearch = [];
        if (input) input.setAttribute("aria-expanded", "false");
        cont.innerHTML = '<p class="search-hint">Escribí para buscar mesas de examen, reválidas, materias, historias clínicas o apuntes.</p>';
        return;
      }

      var app = this;
      var resultados = [];

      if (global.OdontoCalculator) {
        global.OdontoCalculator.getTodasLasMaterias().forEach(function (m) {
          if (UI.normalizar(m.nombre).indexOf(q) !== -1 || UI.normalizar(m.codigo).indexOf(q) !== -1) {
            resultados.push({
              tipo: m.anio + "° año · plan de estudios",
              titulo: m.nombre,
              icono: "fa-solid fa-graduation-cap",
              destino: "carrera/promedio"
            });
          }
        });
      }

      if (global.OdontoLiveSheets && global.OdontoLiveSheets.cachedItems) {
        global.OdontoLiveSheets.cachedItems.forEach(function (item) {
          var texto = UI.normalizar(item.materiaOriginal + " " + item.dia);
          if (texto.indexOf(q) === -1) return;
          var esRev = item.tipo === "revalida" || item.tipo === "actualizacion";
          resultados.push({
            tipo: (esRev ? "Reválida" : "Mesa de final") + " · " + item.dia + " · " + item.hora,
            titulo: item.materiaOriginal,
            icono: esRev ? "fa-solid fa-certificate" : "fa-solid fa-calendar-check",
            destino: esRev ? "fechas/revalidas" : "fechas/mesas"
          });
        });
      }

      if (global.ODONTO_DATA) {
        (global.ODONTO_DATA.historiasClinicas || []).forEach(function (hc) {
          if (UI.normalizar(hc.titulo + " " + hc.catedra).indexOf(q) === -1) return;
          resultados.push({
            tipo: "Historia clínica · " + hc.catedra,
            titulo: hc.titulo,
            icono: "fa-solid fa-file-medical",
            destino: "cursada/historias",
            despues: function () { app.verVistaPreviaHC(hc.id); }
          });
        });

        (global.ODONTO_DATA.biblioteca || []).forEach(function (ap) {
          if (UI.normalizar(ap.titulo + " " + ap.materia).indexOf(q) === -1) return;
          resultados.push({
            tipo: "Apunte · " + ap.materia,
            titulo: ap.titulo,
            icono: "fa-solid fa-book",
            destino: "biblioteca"
          });
        });
      }

      this.ultimosResultadosSearch = resultados.slice(0, 12);
      if (input) input.setAttribute("aria-expanded", resultados.length ? "true" : "false");

      if (!resultados.length) {
        cont.innerHTML =
          '<p class="search-hint">Sin resultados para “' + esc(consulta) + '”.<br>' +
          "Probá con el nombre de la materia tal como figura en el plan, o con una sola palabra.</p>";
        UI.announce("Sin resultados");
        return;
      }

      cont.innerHTML = this.ultimosResultadosSearch.map(function (r, idx) {
        return (
          '<button type="button" class="search-result-item" role="option" aria-selected="false" ' +
                  'data-action="resultadoBusqueda" data-idx="' + idx + '">' +
            '<i class="' + esc(r.icono) + '" aria-hidden="true"></i>' +
            "<span><strong>" + esc(r.titulo) + "</strong><small>" + esc(r.tipo) + "</small></span>" +
          "</button>"
        );
      }).join("");

      UI.announce(UI.plural(resultados.length, "resultado") + " para " + consulta);
    },

    ejecutarResultado: function (idx) {
      var r = this.ultimosResultadosSearch[idx];
      if (!r) return;
      UI.closeModal("modal-search-global");
      this.navegarA(r.destino);
      if (r.despues) global.setTimeout(r.despues, 260);
    },

    abrirModalSearch: function () {
      var input = document.getElementById("global-search-input");
      if (input) input.value = "";
      this.buscarGlobal("");
      UI.openModal("modal-search-global", "#global-search-input");
    },

    /* ======================================================================
       AUXILIARES
       ====================================================================== */
    /** Texto de resultados; también lo anuncia a los lectores de pantalla. */
    resumen: function (elId, cantidad, singular, plural, consulta) {
      var el = document.getElementById(elId);
      if (!el) return;
      var texto = cantidad === 1 ? "1 " + singular : cantidad + " " + plural;
      el.innerHTML = "<b>" + esc(texto) + "</b>" +
        (consulta ? " para “" + esc(consulta) + "”" : "");
    },

    limpiarFiltro: function (campo) {
      var el = campo ? document.getElementById(campo) : null;
      if (el) {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus();
      }
    },

    mostrarModalGenerico: function (tituloHtml, contenidoHtml) {
      var header = document.getElementById("modal-generico-header");
      var body = document.getElementById("modal-generico-body");
      if (!header || !body) return;
      header.innerHTML = tituloHtml;
      body.innerHTML = contenidoHtml;
      UI.openModal("modal-generico");
    },

    cerrarModalGenerico: function () { UI.closeModal("modal-generico"); },
    cerrarModalSearch: function () { UI.closeModal("modal-search-global"); },
    showToast: function (mensaje, tipo) { UI.toast(mensaje, tipo); }
  };

  global.OdontoApp = OdontoApp;

  document.addEventListener("DOMContentLoaded", function () { OdontoApp.init(); });
})(window);
