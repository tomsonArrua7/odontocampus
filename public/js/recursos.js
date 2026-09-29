/* ==========================================================================
   ODONTOCAMPUS — RECURSOS
   Lo que hoy vive disperso en el Linktree de FOE y en sus páginas por año:
   redes, trámites, la facultad, clases grabadas y cuentas de cada cátedra.

   Los enlaces están acá mismo, en RECURSOS: cambian poco. Todo sale del
   Linktree oficial (linktr.ee/foe.odontologia) y de sus páginas por año,
   revisado en septiembre de 2026. Lo vencido (calendarios y cursos de 2024
   y 2025) no se copió: mejor ningún enlace que uno con fechas viejas.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var esc = UI.esc, escAttr = UI.escAttr;

  var YT = "https://www.youtube.com/playlist?list=";
  var IG = "https://www.instagram.com/";

  var RECURSOS = {
    grupos: [
      { id: "foe", titulo: "FOE", bajada: "Las redes de la agrupación. Para dudas, lo más rápido es Instagram.", enlaces: [
        { titulo: "Instagram", detalle: "@foe.odontologia", url: IG + "foe.odontologia/", icono: "instagram" },
        { titulo: "YouTube", detalle: "Clases grabadas y repasos", url: "https://www.youtube.com/@Foe.odontologia", icono: "video" },
        { titulo: "TikTok", detalle: "@foe.odontologia", url: "https://tiktok.com/@foe.odontologia", icono: "celular" },
        { titulo: "Discord", detalle: "Comunidad de estudio de FOE", url: "https://discord.gg/DgSTtznPX7", icono: "chat" }
      ] },
      { id: "tramites", titulo: "Trámites y sistemas", bajada: "Los accesos oficiales de la UNLP y de la facultad.", enlaces: [
        { titulo: "SIU Guaraní", detalle: "Inscripciones, notas y certificados", url: "https://autogestion.guarani.unlp.edu.ar/", icono: "certificado" },
        { titulo: "Aulas virtuales FOLP", detalle: "Campus de grado de cada cátedra", url: "https://grado.folp.unlp.edu.ar/login/index.php", icono: "monitor" },
        { titulo: "Sistemas FOLP", detalle: "Trámites internos de la facultad", url: "https://sistemas.folp.unlp.edu.ar/", icono: "base-datos" },
        { titulo: "Sitio de la facultad", detalle: "folp.unlp.edu.ar", url: "https://www.folp.unlp.edu.ar/", icono: "columnas" }
      ] },
      { id: "facultad", titulo: "La facultad", bajada: "Para ubicarte y para estudiar.", enlaces: [
        { titulo: "Mapa de la facultad", detalle: "Aulas, clínicas y cátedras (PDF)", url: "https://drive.google.com/file/d/1MOM-NBlBTNxcUoV32FfGoUamZmXaKiVs/view", icono: "pin" },
        { titulo: "Biblioteca virtual", detalle: "Carpeta de Drive con material de estudio", url: "https://drive.google.com/drive/folders/1OiXCvHi_7cALIDY8KaUZHKc3qBRc76Fv", icono: "libro" }
      ] },
      { id: "comunidad", titulo: "Comunidad", bajada: "Grupos de estudiantes. No los administra FOE.", enlaces: [
        { titulo: "Preguntas FOLP", detalle: "Grupo de Facebook para consultas", url: "https://www.facebook.com/groups/662292780461407/", icono: "pregunta" },
        { titulo: "Banco de pacientes", detalle: "Grupo de Facebook para conseguir pacientes", url: "https://www.facebook.com/groups/149266853849414", icono: "persona-mas" }
      ] },
      { id: "vida", titulo: "Vida universitaria", bajada: "Becas, comedor y actividades de la UNLP.", enlaces: [
        { titulo: "Bienestar Universitario", detalle: "Becas y ayudas de la UNLP", url: IG + "bienestaruniversitario.unlp/", icono: "escudo" },
        { titulo: "Comedor Universitario", detalle: "Menú y horarios", url: IG + "comedoruniversitario.unlp/", icono: "casa" },
        { titulo: "Vení a la UNLP", detalle: "Actividades para ingresantes", url: IG + "venialaunlp/", icono: "birrete" },
        { titulo: "FULP", detalle: "Federación Universitaria de La Plata", url: IG + "fulp.ok/", icono: "megafono" }
      ] }
    ],

    /* Por año: las clases grabadas de FOE (listas de YouTube, con el nombre
       de la materia del plan) y las cuentas de cada cátedra. De 2.°, 4.° y
       5.° faltan las cátedras: las páginas de 4.° y 5.° estaban en Bento, que
       cerró, y la de 2.° no las tenía. */
    anios: {
      1: {
        clases: [
          ["Anatomía I", "PL8GG41AwWS6faUuiUeQQyb3QEbqs1A6dt"],
          ["Anatomía II", "PL8GG41AwWS6eMqinCNDoTKg2T5yKeOLWR"],
          ["Histología y Embriología I", "PL8GG41AwWS6eFZLmhWbVHBgDMpBgykjaE"],
          ["Biofísica I", "PL8GG41AwWS6f92kSMpPGDsNU1cwIwBw8X"],
          ["Biofísica II", "PL8GG41AwWS6fvhjhANNEZ3JKkaautv0tO"],
          ["Bioquímica Estomatológica I", "PL8GG41AwWS6fmRUky1oCzIqQqlILT5_hS"]
        ],
        catedras: [
          { titulo: "Anatomía", detalle: "@folp.anatomia", url: IG + "folp.anatomia/", icono: "instagram" },
          { titulo: "Biología General", detalle: "Sitio de la cátedra", url: "https://biologiafolp1.wixsite.com/unlp", icono: "externo" },
          { titulo: "Histología y Embriología", detalle: "@histo.folp", url: IG + "histo.folp/", icono: "instagram" },
          { titulo: "Odontología Preventiva y Social", detalle: "@ops.folp.ok", url: IG + "ops.folp.ok/", icono: "instagram" }
        ]
      },
      2: {
        clases: [
          ["Fisiología I", "PL8GG41AwWS6dg1pcFy_eJiaj1k9tpz6RY"],
          ["Fisiología II", "PL8GG41AwWS6eflM53S4o8ef5xACC9tDni"],
          ["Histología y Embriología II", "PL8GG41AwWS6dIvj4_BtQxacqOSXLwSO8V"],
          ["Microbiología y Parasitología I", "PL8GG41AwWS6cxG5WcmrRD9EF0zBmg_ZpD"],
          ["Microbiología y Parasitología II", "PL8GG41AwWS6dmdLCfq9QsNqUbGIT2ir7X"],
          ["Biomateriales I", "PL8GG41AwWS6dFMCXzabar6HqOC58WGcvL"],
          ["Biomateriales II", "PL8GG41AwWS6danTWl7ChYxfw4-WzFH1Ae"],
          ["Bioquímica Estomatológica II", "PL8GG41AwWS6dISmgA9Z01auYY5jkaR7Bu"],
          ["Patología y Clínica Estomatológica I", "PL8GG41AwWS6fVmXBjmSz_hAJhfCZh63SS"]
        ],
        catedras: []
      },
      3: {
        clases: [
          ["Farmacología y Terapéutica I", "PL8GG41AwWS6dW73TjqNVkytWdkAuRK08r"],
          ["Farmacología y Terapéutica II", "PL8GG41AwWS6cwlTBqbXE3A3X2_qMYz0D3"],
          ["Patología y Clínica Estomatológica II", "PL8GG41AwWS6d_wGzVd7Nr4_Pt5_bsIvcu"],
          ["Cirugía I (Cátedra A)", "PL8GG41AwWS6fFLSUfRJ7cogSIbI62xKCN"],
          ["Cirugía II (Cátedra A)", "PL8GG41AwWS6cg9xMVZsShJ0oujRoddys8"]
        ],
        catedras: [
          { titulo: "Cirugía A", detalle: "@asignaturacirugiaafolp", url: IG + "asignaturacirugiaafolp/", icono: "instagram" },
          { titulo: "Cirugía B", detalle: "@cirugia_b_folp_unlp", url: IG + "cirugia_b_folp_unlp/", icono: "instagram" },
          { titulo: "Farmacología", detalle: "@farmacologiafolp", url: IG + "farmacologiafolp/", icono: "instagram" },
          { titulo: "Operatoria A", detalle: "@operatoriaa", url: IG + "operatoriaa/", icono: "instagram" },
          { titulo: "Operatoria B", detalle: "@operatoria.b", url: IG + "operatoria.b/", icono: "instagram" },
          { titulo: "Patología", detalle: "@patologia.folp", url: IG + "patologia.folp/", icono: "instagram" }
        ]
      },
      4: { clases: [], catedras: [] },
      5: { clases: [], catedras: [] }
    }
  };

  var CLAVE_ANIO = "odontocampus_recursos_anio";

  function enlace(item) {
    return (
      '<a class="recurso" href="' + escAttr(item.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="recurso-icono" aria-hidden="true">' + UI.icono(item.icono || "externo") + "</span>" +
        '<span class="recurso-texto"><strong>' + esc(item.titulo) + "</strong>" +
          (item.detalle ? "<small>" + esc(item.detalle) + "</small>" : "") + "</span>" +
        UI.icono("externo", "recurso-flecha") +
        '<span class="visually-hidden"> (se abre en una pestaña nueva)</span>' +
      "</a>"
    );
  }

  var OdontoRecursos = {
    datos: RECURSOS,
    anio: 1,
    busqueda: "",

    init: function () {
      var self = this;
      var guardado = null;
      try { guardado = Number(localStorage.getItem(CLAVE_ANIO)); } catch (e) { guardado = null; }
      if (guardado >= 1 && guardado <= 5) this.anio = guardado;

      UI.registerActions({
        recursosAnio: function (data) { self.elegirAnio(Number(data.anio)); }
      });

      var buscar = document.getElementById("recursos-buscar");
      if (buscar) {
        UI.on(buscar, "input", UI.debounce(function () {
          self.busqueda = buscar.value;
          self.pintar();
        }, 180));
      }
      this.pintar();
    },

    elegirAnio: function (anio) {
      if (!(anio >= 1 && anio <= 5)) return;
      this.anio = anio;
      try { localStorage.setItem(CLAVE_ANIO, String(anio)); } catch (e) { /* modo privado */ }
      this.pintar();
    },

    /** Las clases grabadas de una materia del plan, si hay (las usa Mi carrera). */
    clasesDe: function (nombreMateria) {
      var buscado = UI.normalizar(nombreMateria);
      var hallada = null;
      Object.keys(RECURSOS.anios).forEach(function (a) {
        RECURSOS.anios[a].clases.forEach(function (c) {
          var nombre = UI.normalizar(c[0]).replace(/ \(catedra a\)$/, "");
          if (nombre === buscado) hallada = { titulo: c[0], url: YT + c[1] };
        });
      });
      return hallada;
    },

    coincide: function (item) {
      var q = UI.normalizar(this.busqueda).trim();
      if (!q) return true;
      return UI.normalizar(item.titulo + " " + (item.detalle || "")).indexOf(q) !== -1;
    },

    pintar: function () {
      var self = this;
      var cont = document.getElementById("recursos-grupos");
      var porAnio = document.getElementById("recursos-anio");
      if (!cont || !porAnio) return;

      var buscando = !!UI.normalizar(this.busqueda).trim();
      var delAnio = RECURSOS.anios[this.anio];

      var clases = delAnio.clases.map(function (c) {
        return { titulo: c[0], detalle: "Clases grabadas por FOE", url: YT + c[1], icono: "video" };
      }).filter(function (c) { return self.coincide(c); });
      var catedras = delAnio.catedras.filter(function (c) { return self.coincide(c); });

      var botones = [1, 2, 3, 4, 5].map(function (a) {
        return '<button type="button" class="chip-anio' + (a === self.anio ? " es-activo" : "") + '" ' +
               'data-action="recursosAnio" data-anio="' + a + '" aria-pressed="' + (a === self.anio) + '">' +
               a + ".° año</button>";
      }).join("");

      function bloque(lista, vacio) {
        return lista.length
          ? '<div class="recursos-lista">' + lista.map(enlace).join("") + "</div>"
          : '<p class="recursos-vacio">' + esc(vacio) + "</p>";
      }

      porAnio.innerHTML =
        '<div class="recursos-anio-cabecera">' +
          '<h3 id="recursos-anio-titulo">Por año</h3>' +
          '<div class="chips-anio" role="group" aria-labelledby="recursos-anio-titulo">' + botones + "</div>" +
        "</div>" +
        '<div class="recursos-anio-cuerpo">' +
          "<section><h4>" + UI.icono("video") + " Clases grabadas</h4>" +
            bloque(clases, buscando ? "Nada de este año coincide con la búsqueda."
              : "Todavía no hay clases grabadas de " + this.anio + ".° año en el canal de FOE.") + "</section>" +
          "<section><h4>" + UI.icono("columnas") + " Cátedras</h4>" +
            bloque(catedras, buscando ? "Ninguna cátedra de este año coincide con la búsqueda."
              : "Todavía no tenemos las cuentas de las cátedras de " + this.anio + ".° año. " +
                "Si conocés la de alguna, escribinos por Instagram y la sumamos.") + "</section>" +
        "</div>";

      var total = 0;
      cont.innerHTML = RECURSOS.grupos.map(function (grupo) {
        var enlaces = grupo.enlaces.filter(function (e) { return self.coincide(e); });
        total += enlaces.length;
        if (!enlaces.length) return "";
        return (
          '<section class="recursos-grupo" aria-labelledby="rg-' + grupo.id + '">' +
            '<h3 id="rg-' + grupo.id + '">' + esc(grupo.titulo) + "</h3>" +
            '<p class="recursos-bajada">' + esc(grupo.bajada) + "</p>" +
            '<div class="recursos-lista">' + enlaces.map(enlace).join("") + "</div>" +
          "</section>"
        );
      }).join("");

      if (buscando && !total) {
        cont.innerHTML = '<p class="recursos-vacio">Ningún enlace general coincide con «' + esc(this.busqueda) + "».</p>";
      }
    }
  };

  global.OdontoRecursos = OdontoRecursos;
})(window);
