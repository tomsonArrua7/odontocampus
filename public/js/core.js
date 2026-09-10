/* ==========================================================================
   ODONTOCAMPUS — NÚCLEO
   Utilidades compartidas: escapado seguro, selección de nodos, delegación de
   eventos, avisos, modales accesibles, pestañas ARIA, tema y formato de fechas.
   Este archivo se carga primero: todo lo demás depende de él.
   ========================================================================== */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------------
     1. ESCAPADO
     Los datos de mesas y reválidas vienen de una planilla de Google editada
     por terceros, y los avisos de la bolsa los escribe cualquier estudiante.
     Todo eso se inyecta con innerHTML: sin escapar, una celda con <script> o
     con un onerror se ejecuta en el navegador de quien mira la página.
     Regla: ningún dato externo entra a una plantilla sin pasar por esc().
     --------------------------------------------------------------------- */
  var ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, function (ch) { return ESCAPE_MAP[ch]; });
  }

  /** Escapa para usarlo dentro de un atributo entre comillas simples. */
  function escAttr(value) {
    return esc(value).replace(/\n/g, " ");
  }

  /** Deja sólo URLs http(s) o mailto/tel: evita javascript: en href. */
  function safeUrl(value) {
    var url = String(value || "").trim();
    if (/^(https?:|mailto:|tel:)/i.test(url)) return esc(url);
    return "#";
  }

  /* ------------------------------------------------------------------------
     2. DOM
     --------------------------------------------------------------------- */
  function $(selector, scope) { return (scope || document).querySelector(selector); }
  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function on(target, type, handler, options) {
    if (target) target.addEventListener(type, handler, options);
  }

  /**
   * Delegación de eventos por atributo data-action.
   * Reemplaza a los onclick="..." incrustados en el HTML: permite activar una
   * Content-Security-Policy estricta y mantiene la lógica fuera del marcado.
   */
  var actionHandlers = Object.create(null);

  function registerActions(map) {
    Object.keys(map).forEach(function (name) { actionHandlers[name] = map[name]; });
  }

  function runAction(name, el, event) {
    var fn = actionHandlers[name];
    if (typeof fn === "function") fn(el.dataset, el, event);
    else console.warn("[OdontoCampus] Acción no registrada:", name);
  }

  function initActionDelegation() {
    document.addEventListener("click", function (event) {
      var el = event.target.closest("[data-action]");
      if (!el) return;
      // Permitimos que un enlace real con href externo siga su camino
      if (el.tagName === "A" && el.dataset.actionAllowDefault === "true") {
        runAction(el.dataset.action, el, event);
        return;
      }
      event.preventDefault();
      runAction(el.dataset.action, el, event);
    });

    // Enter / Espacio sobre elementos accionables que no son <button>
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      var el = event.target.closest("[data-action][role='button']");
      if (!el) return;
      event.preventDefault();
      runAction(el.dataset.action, el, event);
    });
  }

  /* ------------------------------------------------------------------------
     3. ANUNCIOS PARA LECTORES DE PANTALLA
     Cada vez que un filtro cambia la cantidad de resultados, quien no ve la
     pantalla necesita enterarse. Sin esto, filtrar es una acción silenciosa.
     --------------------------------------------------------------------- */
  var liveRegion = null;

  function announce(message) {
    if (!liveRegion) {
      liveRegion = document.createElement("div");
      liveRegion.className = "visually-hidden";
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.setAttribute("aria-atomic", "true");
      document.body.appendChild(liveRegion);
    }
    // Vaciar y reescribir fuerza el anuncio aunque el texto se repita
    liveRegion.textContent = "";
    global.setTimeout(function () { liveRegion.textContent = message; }, 60);
  }

  /* ------------------------------------------------------------------------
     4. AVISOS FLOTANTES
     --------------------------------------------------------------------- */
  var TOAST_ICONS = {
    info: "fa-circle-info",
    success: "fa-circle-check",
    warning: "fa-triangle-exclamation",
    danger: "fa-circle-exclamation"
  };

  function toast(message, type) {
    type = type || "info";
    var container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "toast-container";
      container.setAttribute("role", "status");
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }

    var el = document.createElement("div");
    el.className = "toast-message toast-" + type + " animate-slide-up";
    el.innerHTML =
      '<i class="fa-solid ' + (TOAST_ICONS[type] || TOAST_ICONS.info) + '" aria-hidden="true"></i>' +
      "<span>" + esc(message) + "</span>";
    container.appendChild(el);

    global.setTimeout(function () {
      el.classList.add("fade-out");
      global.setTimeout(function () { el.remove(); }, 400);
    }, 4000);
  }

  /* ------------------------------------------------------------------------
     5. MODALES ACCESIBLES
     Antes: el foco quedaba detrás del modal y con Tab se recorría la página
     de fondo. Ahora el foco entra, queda atrapado y vuelve al botón de origen.
     --------------------------------------------------------------------- */
  var FOCUSABLE = [
    "a[href]", "button:not([disabled])", "input:not([disabled])",
    "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  var modalStack = [];

  function focusableIn(container) {
    return $$(FOCUSABLE, container).filter(function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function trapTab(event) {
    if (event.key !== "Tab" || !modalStack.length) return;
    var current = modalStack[modalStack.length - 1];
    var items = focusableIn(current.el);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openModal(id, focusSelector) {
    var el = document.getElementById(id);
    if (!el || el.classList.contains("active")) return;

    modalStack.push({ el: el, opener: document.activeElement });
    el.classList.add("active");
    el.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    global.setTimeout(function () {
      var target = focusSelector ? $(focusSelector, el) : null;
      (target || focusableIn(el)[0] || el).focus();
    }, 60);
  }

  function closeModal(id) {
    var el = id ? document.getElementById(id) : null;
    var index = -1;
    for (var i = modalStack.length - 1; i >= 0; i--) {
      if (!el || modalStack[i].el === el) { index = i; break; }
    }
    if (index === -1) return;

    var entry = modalStack.splice(index, 1)[0];
    entry.el.classList.remove("active");
    entry.el.setAttribute("aria-hidden", "true");
    if (!modalStack.length) document.body.style.overflow = "";
    if (entry.opener && typeof entry.opener.focus === "function") entry.opener.focus();
  }

  function closeTopModal() {
    if (modalStack.length) closeModal(modalStack[modalStack.length - 1].el.id);
  }

  function anyModalOpen() { return modalStack.length > 0; }

  function initModals() {
    document.addEventListener("keydown", trapTab);
    // Clic fuera de la tarjeta cierra el modal
    $$(".modal-overlay").forEach(function (overlay) {
      overlay.setAttribute("aria-hidden", "true");
      on(overlay, "mousedown", function (event) {
        if (event.target === overlay) closeModal(overlay.id);
      });
    });
  }

  /* ------------------------------------------------------------------------
     6. PESTAÑAS ARIA
     Patrón completo: roles, aria-selected, aria-controls y flechas.
     --------------------------------------------------------------------- */
  function initTabs(root, onChange) {
    var list = $(".tabs", root);
    if (!list) return null;
    var tabs = $$(".tab", list);

    function select(id, moveFocus) {
      tabs.forEach(function (tab) {
        var active = tab.dataset.tab === id;
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.tabIndex = active ? 0 : -1;
        var panel = document.getElementById(tab.getAttribute("aria-controls"));
        if (panel) panel.hidden = !active;
        if (active && moveFocus) tab.focus();
      });
      if (typeof onChange === "function") onChange(id);
    }

    tabs.forEach(function (tab, index) {
      on(tab, "click", function () { select(tab.dataset.tab, false); });
      on(tab, "keydown", function (event) {
        var next = null;
        if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
        else if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
        else if (event.key === "Home") next = tabs[0];
        else if (event.key === "End") next = tabs[tabs.length - 1];
        if (!next) return;
        event.preventDefault();
        select(next.dataset.tab, true);
      });
    });

    return { select: select, ids: tabs.map(function (t) { return t.dataset.tab; }) };
  }

  /* ------------------------------------------------------------------------
     7. TEMA CLARO / OSCURO
     --------------------------------------------------------------------- */
  var THEME_KEY = "odontocampus_tema";

  var theme = {
    get: function () {
      try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
    },
    set: function (value) {
      try { localStorage.setItem(THEME_KEY, value); } catch (e) { /* modo privado */ }
      document.documentElement.setAttribute("data-theme", value);
      var btn = document.getElementById("theme-toggle");
      if (btn) {
        btn.setAttribute("aria-pressed", value === "dark" ? "true" : "false");
        btn.setAttribute("aria-label", value === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
      }
    },
    current: function () {
      var stored = theme.get();
      if (stored) return stored;
      return global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    },
    toggle: function () {
      theme.set(theme.current() === "dark" ? "light" : "dark");
    },
    init: function () {
      var stored = theme.get();
      if (stored) theme.set(stored);
      else {
        var btn = document.getElementById("theme-toggle");
        if (btn) btn.setAttribute("aria-pressed", theme.current() === "dark" ? "true" : "false");
      }
    }
  };

  /* ------------------------------------------------------------------------
     8. FECHAS
     Se interpreta el texto libre de la planilla ("Jueves 27 de Agosto") para
     poder ordenar por proximidad y decir "faltan 3 días", que es la
     información que la persona realmente busca.
     --------------------------------------------------------------------- */
  var MESES = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
    noviembre: 10, diciembre: 11
  };
  var DIAS_ABREV = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  var MESES_ABREV = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  function normalizar(texto) {
    return String(texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  /** Devuelve un Date o null a partir de textos como "Jueves 27 de Agosto" o "27/8/2026". */
  function parseFechaTexto(texto, anioPorDefecto) {
    var s = normalizar(texto);
    var anio = anioPorDefecto || new Date().getFullYear();

    var barras = s.match(/(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?:\s*[\/\-]\s*(\d{2,4}))?/);
    if (barras) {
      var a = barras[3] ? parseInt(barras[3], 10) : anio;
      if (a < 100) a += 2000;
      return new Date(a, parseInt(barras[2], 10) - 1, parseInt(barras[1], 10));
    }

    var conMes = s.match(/(\d{1,2})\s*(?:de\s+)?([a-z]+)/);
    if (conMes && MESES[conMes[2]] !== undefined) {
      var anioMatch = s.match(/(20\d{2})/);
      return new Date(anioMatch ? parseInt(anioMatch[1], 10) : anio, MESES[conMes[2]], parseInt(conMes[1], 10));
    }
    return null;
  }

  function soloFecha(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /** Días entre hoy y la fecha dada (negativo = ya pasó). */
  function diasHasta(date) {
    if (!date) return null;
    var hoy = soloFecha(new Date());
    return Math.round((soloFecha(date) - hoy) / 86400000);
  }

  /** "Hoy" / "Mañana" / "En 4 días" / "Ya pasó" — lenguaje humano, no fechas crudas. */
  function cuandoTexto(date) {
    var d = diasHasta(date);
    if (d === null) return "";
    if (d < 0) return "Ya pasó";
    if (d === 0) return "Hoy";
    if (d === 1) return "Mañana";
    if (d < 7) return "En " + d + " días";
    if (d < 14) return "La semana que viene";
    return "En " + Math.round(d / 7) + " semanas";
  }

  function fechaCorta(date) {
    if (!date) return { dia: "--", mes: "" };
    return { dia: String(date.getDate()), mes: MESES_ABREV[date.getMonth()], diaSemana: DIAS_ABREV[date.getDay()] };
  }

  /* ------------------------------------------------------------------------
     9. ESQUELETOS DE CARGA
     --------------------------------------------------------------------- */
  function skeletonGrid(count) {
    var card =
      '<div class="skeleton-card">' +
        '<div class="skeleton-line w-40"></div>' +
        '<div class="skeleton-line tall w-80"></div>' +
        '<div class="skeleton-line w-60"></div>' +
        '<div class="skeleton-line w-80"></div>' +
      "</div>";
    return '<div class="skeleton-grid" aria-hidden="true">' + new Array(count || 6).fill(card).join("") + "</div>";
  }

  /** Estado vacío con salida: siempre ofrece qué hacer a continuación. */
  function emptyState(opts) {
    return (
      '<div class="empty-state">' +
        '<div class="empty-icon" aria-hidden="true"><i class="fa-solid ' + esc(opts.icon || "fa-circle-question") + '"></i></div>' +
        "<h3>" + esc(opts.title) + "</h3>" +
        "<p>" + esc(opts.text || "") + "</p>" +
        (opts.actionLabel
          ? '<button type="button" class="btn btn-outline-magenta" data-action="' + escAttr(opts.action) + '">' +
              esc(opts.actionLabel) +
            "</button>"
          : "") +
      "</div>"
    );
  }

  /* ------------------------------------------------------------------------
     10. VARIOS
     --------------------------------------------------------------------- */
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, ctx = this;
      global.clearTimeout(timer);
      timer = global.setTimeout(function () { fn.apply(ctx, args); }, wait || 180);
    };
  }

  function copiar(texto, etiqueta) {
    var valor = String(texto || "").trim();
    if (!valor) return;
    var ok = function () { toast((etiqueta || "Texto") + " copiado al portapapeles", "success"); };
    var fallo = function () { toast("No pudimos copiar. Seleccioná el texto y usá Ctrl+C.", "warning"); };

    if (global.navigator.clipboard && global.isSecureContext) {
      global.navigator.clipboard.writeText(valor).then(ok).catch(fallo);
      return;
    }
    var area = document.createElement("textarea");
    area.value = valor;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); ok(); } catch (e) { fallo(); }
    area.remove();
  }

  function plural(n, singular, pluralForma) {
    return n === 1 ? "1 " + singular : n + " " + (pluralForma || singular + "s");
  }

  global.OdontoUI = {
    esc: esc,
    escAttr: escAttr,
    safeUrl: safeUrl,
    $: $, $$: $$, on: on,
    registerActions: registerActions,
    initActionDelegation: initActionDelegation,
    announce: announce,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    closeTopModal: closeTopModal,
    anyModalOpen: anyModalOpen,
    initModals: initModals,
    initTabs: initTabs,
    theme: theme,
    normalizar: normalizar,
    parseFechaTexto: parseFechaTexto,
    diasHasta: diasHasta,
    cuandoTexto: cuandoTexto,
    fechaCorta: fechaCorta,
    skeletonGrid: skeletonGrid,
    emptyState: emptyState,
    debounce: debounce,
    copiar: copiar,
    plural: plural
  };
})(window);
