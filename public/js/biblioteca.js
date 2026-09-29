/* ==========================================================================
   ODONTOCAMPUS — BIBLIOTECA
   Los apuntes y la bibliografía de cada materia, ordenados por año.

   --------------------------------------------------------------------------
   DE DÓNDE SALEN

   De un índice que mantienen los militantes de FOE en una planilla de Google
   (una fila por material), configurada desde el panel de administración:

     Materia | Tipo | Título | Enlace | Autor o cátedra | Revisado

   · "Materia" se escribe como en el plan ("Anatomía I") o como asignatura
     ("Anatomía"): en ese caso vale para todas sus materias (I, II...).
   · "Tipo": Apuntes, Cátedra, Material, Bibliografía o Carpeta.
   · Sólo se muestra lo que dice "sí" en Revisado.

   Mientras no haya planilla, se usa la copia generada del Drive
   (js/biblioteca-datos.js, que arma infra/biblioteca/generar.py).

   --------------------------------------------------------------------------
   BIBLIOGRAFÍA RECOMENDADA

   Los libros van plegados en "Accedé a más bibliografía recomendada": la
   lista de títulos y un botón a la CARPETA de la materia en el Drive de FOE.
   Nunca se enlaza un PDF suelto. Abajo de todo hay un aviso para pedir que
   se retire un material.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var esc = UI.esc, escAttr = UI.escAttr;

  var CLAVE_ANIO = "odontocampus_recursos_anio"; // el mismo año que Hoy y Recursos
  var CARPETA_GENERAL = "https://drive.google.com/drive/folders/1OiXCvHi_7cALIDY8KaUZHKc3qBRc76Fv";
  var ICONO_TIPO = { apuntes: "documento", catedra: "columnas", material: "archivo", carpeta: "libro" };
  var ORDEN_TIPO = { apuntes: 1, catedra: 2, material: 3, carpeta: 4 };

  function tipoDe(texto) {
    var t = UI.normalizar(texto);
    if (t.indexOf("biblio") === 0 || t === "libro" || t === "libros") return "bibliografia";
    if (t.indexOf("apunte") === 0 || t === "resumen" || t === "resumenes") return "apuntes";
    if (t.indexOf("catedra") === 0) return "catedra";
    if (t.indexOf("carpeta") === 0) return "carpeta";
    return "material";
  }

  function enlaceSeguro(url) {
    return /^https:\/\//i.test(String(url || "").trim()) ? String(url).trim() : "";
  }

  var OdontoBiblioteca = {
    filas: [],
    origen: "copia",
    cargando: false,
    anio: 1,
    busqueda: "",

    init: function () {
      var self = this;
      var guardado = null;
      try { guardado = Number(localStorage.getItem(CLAVE_ANIO)); } catch (e) { guardado = null; }
      if (guardado >= 1 && guardado <= 5) this.anio = guardado;

      this.filas = this.normalizarFilas(global.ODONTO_BIBLIOTECA || []);

      UI.registerActions({
        bibliotecaAnio: function (data) { self.elegirAnio(Number(data.anio)); }
      });

      var buscar = document.getElementById("biblio-buscar");
      if (buscar) {
        UI.on(buscar, "input", UI.debounce(function () {
          self.busqueda = buscar.value;
          self.pintar();
        }, 180));
      }

      this.pintar();
      this.leerPlanilla();
    },

    /* ====================================================================
       DATOS
       ==================================================================== */
    normalizarFilas: function (lista) {
      return lista.map(function (f) {
        return {
          materia: String(f.materia || "").trim(),
          tipo: tipoDe(f.tipo),
          titulo: String(f.titulo || "").trim(),
          enlace: enlaceSeguro(f.enlace),
          autor: String(f.autor || "").trim()
        };
      }).filter(function (f) { return f.materia && f.titulo && f.enlace; });
    },

    /** Si hay planilla configurada, manda sobre la copia. */
    leerPlanilla: function () {
      var self = this;
      var sheets = global.OdontoLiveSheets;
      if (!sheets) return;
      var cfg = sheets.planilla("planilla_biblioteca");
      if (!cfg || !cfg.sheetId) return;

      this.cargando = true;
      fetch(sheets.endpoint(cfg.sheetId, cfg.gid))
        .then(function (res) {
          if (!res.ok || (res.headers.get("content-type") || "").indexOf("text/csv") === -1) throw new Error("planilla");
          return res.text();
        })
        .then(function (csv) {
          var filas = self.parsear(csv);
          if (filas.length) { self.filas = filas; self.origen = "planilla"; }
        })
        .catch(function () { /* se queda con la copia del Drive */ })
        .then(function () { self.cargando = false; self.pintar(); });
    },

    /** Lee la planilla ubicando las columnas por su título. */
    parsear: function (csv) {
      var sheets = global.OdontoLiveSheets;
      var cols = null;
      var filas = [];

      sheets.splitCSV(csv).forEach(function (fila) {
        var celdas = fila.map(function (c) { return (c || "").replace(/\s+/g, " ").trim(); });
        if (!celdas.some(Boolean)) return;
        var normal = celdas.map(function (c) { return UI.normalizar(c); });

        if (!cols) {
          var iMateria = normal.indexOf("materia");
          if (iMateria === -1) return;
          cols = { materia: iMateria, tipo: -1, titulo: -1, enlace: -1, autor: -1, revisado: -1 };
          normal.forEach(function (t, i) {
            if (t === "tipo") cols.tipo = i;
            else if (t === "titulo" || t === "nombre") cols.titulo = i;
            else if (t === "enlace" || t === "link" || t === "url") cols.enlace = i;
            else if (t.indexOf("autor") === 0 || t === "catedra") cols.autor = i;
            else if (t === "revisado" || t === "publicar") cols.revisado = i;
          });
          return;
        }

        if (cols.revisado !== -1 && !/^(si|sí|x|ok|yes)$/i.test(celdas[cols.revisado] || "")) return;
        filas.push({
          materia: celdas[cols.materia],
          tipo: cols.tipo !== -1 ? celdas[cols.tipo] : "",
          titulo: cols.titulo !== -1 ? celdas[cols.titulo] : "",
          enlace: cols.enlace !== -1 ? celdas[cols.enlace] : "",
          autor: cols.autor !== -1 ? celdas[cols.autor] : ""
        });
      });

      return this.normalizarFilas(filas);
    },

    /** Las filas que corresponden a una materia del plan (exactas o de su asignatura). */
    filasDe: function (nombreMateria) {
      var buscado = UI.normalizar(nombreMateria);
      return this.filas.filter(function (f) {
        var m = UI.normalizar(f.materia);
        return m === buscado || buscado.indexOf(m + " ") === 0;
      });
    },

    /** La carpeta de apuntes de una materia, si hay (la usa Mi carrera). */
    apuntesDe: function (nombreMateria) {
      var buscado = UI.normalizar(nombreMateria);
      return this.filas.filter(function (f) {
        return f.tipo === "apuntes" && UI.normalizar(f.materia) === buscado;
      })[0] || null;
    },

    elegirAnio: function (anio) {
      if (!(anio >= 1 && anio <= 5)) return;
      this.anio = anio;
      try { localStorage.setItem(CLAVE_ANIO, String(anio)); } catch (e) { /* modo privado */ }
      this.pintar();
    },

    /* ====================================================================
       PANTALLA
       ==================================================================== */
    pintar: function () {
      var self = this;
      var cont = document.getElementById("biblio-materias");
      var chips = document.getElementById("biblio-anio");
      if (!cont || !chips) return;

      chips.innerHTML = [1, 2, 3, 4, 5].map(function (a) {
        return '<button type="button" class="chip-anio' + (a === self.anio ? " es-activo" : "") + '" ' +
               'data-action="bibliotecaAnio" data-anio="' + a + '" aria-pressed="' + (a === self.anio) + '">' + a + ".º año</button>";
      }).join("");

      var q = UI.normalizar(this.busqueda).trim();
      var calc = global.OdontoCalculator;
      var materias = calc ? calc.getTodasLasMaterias() : [];
      // Buscando, se busca en toda la carrera; si no, se muestra el año elegido.
      if (!q) materias = materias.filter(function (m) { return m.anio === self.anio; });

      var tarjetas = materias.map(function (m) {
        var filas = self.filasDe(m.nombre);
        if (q) {
          var coincideNombre = UI.normalizar(m.nombre).indexOf(q) !== -1;
          filas = coincideNombre ? filas : filas.filter(function (f) {
            return UI.normalizar(f.titulo + " " + f.autor).indexOf(q) !== -1;
          });
          if (!coincideNombre && !filas.length) return "";
        }
        return self.tarjeta(m, filas);
      }).filter(Boolean);

      var resumen = document.getElementById("biblio-resumen");
      if (resumen) {
        resumen.textContent = q
          ? (tarjetas.length ? UI.plural(tarjetas.length, "materia") + " con «" + this.busqueda + "»" : "")
          : "";
      }

      cont.innerHTML = tarjetas.length ? tarjetas.join("")
        : '<p class="recursos-vacio">Nada coincide con «' + esc(this.busqueda) + "». Probá con el nombre de la materia o de un autor.</p>";

      this.pintarGeneral();
    },

    tarjeta: function (materia, filas) {
      var enlaces = filas.filter(function (f) { return f.tipo !== "bibliografia"; })
        .sort(function (a, b) { return (ORDEN_TIPO[a.tipo] || 9) - (ORDEN_TIPO[b.tipo] || 9); });
      var libros = filas.filter(function (f) { return f.tipo === "bibliografia"; });

      var lista = enlaces.length
        ? '<div class="recursos-lista">' + enlaces.map(function (f) {
            return (
              '<a class="recurso" href="' + escAttr(f.enlace) + '" target="_blank" rel="noopener noreferrer">' +
                '<span class="recurso-icono" aria-hidden="true">' + UI.icono(ICONO_TIPO[f.tipo] || "documento") + "</span>" +
                '<span class="recurso-texto"><strong>' + esc(f.titulo) + "</strong>" +
                  (f.autor ? "<small>" + esc(f.autor) + "</small>" : "") + "</span>" +
                UI.icono("externo", "recurso-flecha") +
                '<span class="visually-hidden"> (se abre en una pestaña nueva)</span>' +
              "</a>"
            );
          }).join("") + "</div>"
        : '<p class="biblio-sin">Todavía no hay apuntes cargados para esta materia.</p>';

      var extra = "";
      if (libros.length) {
        // Un botón por carpeta distinta (casi siempre es una sola).
        var carpetas = [];
        libros.forEach(function (l) { if (carpetas.indexOf(l.enlace) === -1) carpetas.push(l.enlace); });
        extra =
          '<details class="biblio-extra">' +
            "<summary>" + UI.icono("libro") + " Accedé a más bibliografía recomendada (" + libros.length + ")</summary>" +
            '<ul class="biblio-libros">' + libros.map(function (l) {
              return "<li>" + esc(l.titulo) + (l.autor ? " <small>" + esc(l.autor) + "</small>" : "") + "</li>";
            }).join("") + "</ul>" +
            carpetas.map(function (url) {
              return '<a class="btn btn-secondary btn-sm" href="' + escAttr(url) + '" target="_blank" rel="noopener noreferrer">' +
                "Abrir en la biblioteca virtual de FOE " + UI.icono("externo") +
                '<span class="visually-hidden"> (se abre en una pestaña nueva)</span></a>';
            }).join("") +
          "</details>";
      }

      return (
        '<article class="biblio-materia">' +
          "<h3>" + esc(materia.nombre) + "</h3>" +
          lista + extra +
        "</article>"
      );
    },

    pintarGeneral: function () {
      var cont = document.getElementById("biblio-general");
      if (!cont) return;
      var generales = this.filas.filter(function (f) { return UI.normalizar(f.materia) === "general"; });

      cont.innerHTML =
        (generales.length
          ? '<details class="biblio-extra"><summary>' + UI.icono("libro") + " Obras generales (" + generales.length + ")</summary>" +
              '<ul class="biblio-libros">' + generales.map(function (g) { return "<li>" + esc(g.titulo) + "</li>"; }).join("") + "</ul>" +
            "</details>"
          : "") +
        '<a class="recurso" href="' + CARPETA_GENERAL + '" target="_blank" rel="noopener noreferrer">' +
          '<span class="recurso-icono" aria-hidden="true">' + UI.icono("libro") + "</span>" +
          '<span class="recurso-texto"><strong>Toda la biblioteca virtual de FOE</strong>' +
            "<small>La carpeta completa en Google Drive, con todas las materias</small></span>" +
          UI.icono("externo", "recurso-flecha") +
          '<span class="visually-hidden"> (se abre en una pestaña nueva)</span>' +
        "</a>";
    }
  };

  global.OdontoBiblioteca = OdontoBiblioteca;
})(window);
