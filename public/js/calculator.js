/* ==========================================================================
   ODONTOCAMPUS — PROMEDIO Y AVANCE DE CARRERA
   Las notas viven únicamente en el navegador de quien las carga. No hay
   servidor, no hay cuenta y no se comparten: es información sensible y
   emocionalmente cargada, y esa promesa está escrita en la propia pantalla.

   Cambios respecto de la primera versión:
   · Cambiar el estado de una materia ya no vuelve a dibujar toda la tabla.
     Antes el foco saltaba al principio y el filtro por año se reseteaba solo:
     cargar veinte materias seguidas era una pelea.
   · Los controles se manejan por delegación, sin onchange en el HTML.
   · Cada campo tiene etiqueta accesible propia (hay una fila por materia; sin
     etiquetas, un lector de pantalla anuncia veintinueve "combo box" iguales).
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var esc = UI.esc, escAttr = UI.escAttr;

  var ESTADOS = [
    { valor: "pendiente", texto: "Pendiente" },
    { valor: "cursando", texto: "Cursando" },
    { valor: "regular", texto: "Regular (puedo rendir el final)" },
    { valor: "aprobada", texto: "Aprobada" }
  ];

  var OdontoCalculator = {
    storageKey: "odontocampus_calificaciones_v1",
    filtroAnio: "todos",

    /* ====================================================================
       ALMACENAMIENTO
       ==================================================================== */
    getNotas: function () {
      try {
        var data = localStorage.getItem(this.storageKey);
        return data ? JSON.parse(data) : {};
      } catch (e) {
        console.error("[OdontoCampus] No se pudieron leer las notas guardadas:", e);
        return {};
      }
    },

    /**
     * @param {object}  notas
     * @param {boolean} vieneDelServidor  true cuando la escritura la origina
     *        la sincronización al bajar datos. Evita el rebote de volver a
     *        subir lo que se acaba de recibir.
     */
    guardarNotas: function (notas, vieneDelServidor) {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(notas));
      } catch (e) {
        UI.toast("No pudimos guardar la nota. Si navegás en modo privado, los datos no persisten.", "warning");
      }

      // localStorage es la fuente de verdad; el servidor es un espejo.
      if (!vieneDelServidor && global.OdontoSync) {
        global.OdontoSync.notificarCambio();
      }
    },

    getTodasLasMaterias: function () {
      var materias = [];
      if (!global.ODONTO_DATA || !global.ODONTO_DATA.planEstudios) return materias;

      global.ODONTO_DATA.planEstudios.forEach(function (nivel) {
        nivel.materias.forEach(function (mat) {
          materias.push({
            id: mat.id, codigo: mat.codigo, nombre: mat.nombre,
            regimen: mat.regimen, correlativas: mat.correlativas,
            anio: nivel.anio, anioTitulo: nivel.titulo
          });
        });
      });
      return materias;
    },

    actualizarNota: function (materiaId, estado, notaFinal, aplazos) {
      var notas = this.getNotas();

      if (!estado || estado === "pendiente") {
        delete notas[materiaId];
      } else {
        notas[materiaId] = {
          estado: estado,
          nota: estado === "aprobada" ? (parseFloat(notaFinal) || null) : null,
          aplazos: parseInt(aplazos, 10) || 0,
          fechaActualizacion: new Date().toISOString()
        };
      }

      this.guardarNotas(notas);
      this.renderResumen();
      return notas[materiaId];
    },

    /* ====================================================================
       CÁLCULO
       ==================================================================== */
    calcularMetricas: function () {
      var notas = this.getNotas();
      var todas = this.getTodasLasMaterias();

      var aprobadas = 0, regulares = 0, cursando = 0;
      var sumaNotas = 0, sumaAplazos = 0, cantidadAplazos = 0;

      todas.forEach(function (mat) {
        var r = notas[mat.id];
        if (!r) return;

        if (r.estado === "aprobada" && r.nota && r.nota >= 4) {
          aprobadas++;
          sumaNotas += r.nota;
        } else if (r.estado === "regular") {
          regulares++;
        } else if (r.estado === "cursando") {
          cursando++;
        }

        if (r.aplazos > 0) {
          cantidadAplazos += r.aplazos;
          // Criterio UNLP: cada aplazo entra al promedio histórico como un 2.
          sumaAplazos += r.aplazos * 2;
        }
      });

      var rendidos = aprobadas + cantidadAplazos;

      return {
        totalMaterias: todas.length,
        aprobadasCount: aprobadas,
        regularesCount: regulares,
        cursandoCount: cursando,
        pendientesCount: todas.length - (aprobadas + regulares + cursando),
        totalAplazosCount: cantidadAplazos,
        promedioSinAplazos: aprobadas > 0 ? (sumaNotas / aprobadas).toFixed(2) : "0.00",
        promedioConAplazos: rendidos > 0 ? ((sumaNotas + sumaAplazos) / rendidos).toFixed(2) : "0.00",
        porcentajeAvance: todas.length > 0 ? Math.round((aprobadas / todas.length) * 100) : 0
      };
    },

    /* ====================================================================
       RENDER
       ==================================================================== */
    init: function () {
      var self = this;

      UI.registerActions({
        reiniciarNotas: function () { self.reiniciar(); }
      });

      var filtro = document.getElementById("calc-filter-anio");
      if (filtro) {
        UI.on(filtro, "change", function () {
          self.filtroAnio = filtro.value;
          self.renderTabla();
        });
      }

      var cont = document.getElementById("calculadora-materias-lista");
      if (cont) {
        UI.on(cont, "change", function (event) {
          var el = event.target;
          var fila = el.closest("[data-materia-id]");
          if (!fila) return;
          var id = fila.getAttribute("data-materia-id");

          if (el.classList.contains("status-select")) self.alCambiarEstado(id, el.value, fila);
          else if (el.classList.contains("nota-input")) self.alCambiarNota(id, el.value, fila);
          else if (el.classList.contains("aplazos-input")) self.alCambiarAplazos(id, el.value);
        });
      }

      this.renderTabla();
    },

    renderTabla: function (filtroAnio) {
      var cont = document.getElementById("calculadora-materias-lista");
      if (!cont || !global.ODONTO_DATA) return;

      if (filtroAnio !== undefined) this.filtroAnio = String(filtroAnio);
      var filtro = this.filtroAnio;
      var notas = this.getNotas();
      var self = this;

      var niveles = global.ODONTO_DATA.planEstudios.filter(function (nivel) {
        return filtro === "todos" || String(filtro) === String(nivel.anio);
      });

      cont.innerHTML = niveles.map(function (nivel) {
        var aprobadasEnNivel = nivel.materias.filter(function (m) {
          var r = notas[m.id];
          return r && r.estado === "aprobada";
        }).length;

        return (
          '<section class="calculator-year-card">' +
            '<div class="calculator-year-header">' +
              "<div>" +
                '<span class="year-badge">' + esc(nivel.titulo) + "</span>" +
                '<span class="year-subtitle">' + esc(UI.plural(nivel.materias.length, "materia")) + "</span>" +
              "</div>" +
              '<span class="badge-materia-anio">' + aprobadasEnNivel + " de " + nivel.materias.length + " aprobadas</span>" +
            "</div>" +
            '<div class="table-responsive">' +
              '<table class="odonto-table">' +
                "<caption>" + esc(nivel.titulo) + ": marcá el estado de cada materia y, si la aprobaste, su nota.</caption>" +
                "<thead><tr>" +
                  "<th>Código</th><th>Materia</th><th>Régimen</th>" +
                  "<th>Estado</th><th>Nota final</th><th>Aplazos</th>" +
                "</tr></thead>" +
                "<tbody>" +
                  nivel.materias.map(function (mat) { return self.filaMateria(mat, notas[mat.id]); }).join("") +
                "</tbody>" +
              "</table>" +
            "</div>" +
          "</section>"
        );
      }).join("");

      this.renderResumen();
    },

    filaMateria: function (mat, registro) {
      registro = registro || { estado: "pendiente", nota: "", aplazos: 0 };
      var aprobada = registro.estado === "aprobada";
      var nombreSeguro = escAttr(mat.nombre);

      return (
        '<tr class="materia-row' + (aprobada ? " row-aprobada" : "") + '" data-materia-id="' + escAttr(mat.id) + '">' +
          '<td><span class="code-tag">' + esc(mat.codigo) + "</span></td>" +
          "<td>" +
            '<span class="materia-title">' + esc(mat.nombre) + "</span>" +
            '<small class="correlativa-info">Correlativas: ' + esc(mat.correlativas) + "</small>" +
          "</td>" +
          '<td><span class="regimen-tag">' + esc(mat.regimen) + "</span></td>" +
          "<td>" +
            '<label class="visually-hidden" for="estado-' + escAttr(mat.id) + '">Estado de ' + nombreSeguro + "</label>" +
            '<select class="form-select status-select" id="estado-' + escAttr(mat.id) + '">' +
              ESTADOS.map(function (op) {
                return '<option value="' + op.valor + '"' +
                       (registro.estado === op.valor ? " selected" : "") + ">" + esc(op.texto) + "</option>";
              }).join("") +
            "</select>" +
          "</td>" +
          "<td>" +
            '<label class="visually-hidden" for="nota-' + escAttr(mat.id) + '">Nota final de ' + nombreSeguro + "</label>" +
            '<input type="number" inputmode="decimal" min="4" max="10" step="0.5" ' +
                   'class="form-control nota-input' + (aprobada ? " active" : "") + '" ' +
                   'id="nota-' + escAttr(mat.id) + '" placeholder="4 a 10" ' +
                   'value="' + escAttr(registro.nota || "") + '"' + (aprobada ? "" : " disabled") + ">" +
          "</td>" +
          "<td>" +
            '<label class="visually-hidden" for="aplazos-' + escAttr(mat.id) + '">Aplazos en ' + nombreSeguro + "</label>" +
            '<input type="number" inputmode="numeric" min="0" max="10" ' +
                   'class="form-control aplazos-input" id="aplazos-' + escAttr(mat.id) + '" ' +
                   'value="' + escAttr(registro.aplazos || 0) + '">' +
          "</td>" +
        "</tr>"
      );
    },

    /* ====================================================================
       INTERACCIÓN
       Se actualiza sólo la fila tocada: el foco no se pierde y el filtro por
       año se mantiene.
       ==================================================================== */
    alCambiarEstado: function (id, estado, fila) {
      var notas = this.getNotas();
      var actual = notas[id] || {};
      var nota = estado === "aprobada" ? (actual.nota || "") : null;

      this.actualizarNota(id, estado, nota, actual.aplazos || 0);

      var inputNota = fila.querySelector(".nota-input");
      if (inputNota) {
        var aprobada = estado === "aprobada";
        inputNota.disabled = !aprobada;
        inputNota.classList.toggle("active", aprobada && !!nota);
        if (!aprobada) inputNota.value = "";
        else if (!inputNota.value) {
          // No inventamos una nota: se la pedimos a quien sabe cuál fue.
          inputNota.focus();
          UI.toast("Cargá la nota con la que aprobaste", "info");
        }
      }
      fila.classList.toggle("row-aprobada", estado === "aprobada");
    },

    alCambiarNota: function (id, valor, fila) {
      var notas = this.getNotas();
      var actual = notas[id] || { aplazos: 0 };
      var input = fila.querySelector(".nota-input");

      if (valor === "") {
        this.actualizarNota(id, "aprobada", null, actual.aplazos || 0);
        if (input) input.classList.remove("active");
        return;
      }

      var num = parseFloat(valor);
      if (isNaN(num) || num < 4 || num > 10) {
        UI.toast("La nota de una materia aprobada va de 4 a 10", "warning");
        if (input) { input.value = actual.nota || ""; input.focus(); }
        return;
      }

      this.actualizarNota(id, "aprobada", num, actual.aplazos || 0);
      if (input) input.classList.add("active");
    },

    alCambiarAplazos: function (id, valor) {
      var notas = this.getNotas();
      var actual = notas[id] || { estado: "pendiente", nota: null };
      var aplazos = Math.max(0, parseInt(valor, 10) || 0);

      /* Un aplazo cuenta aunque la materia siga pendiente: es justamente el
         caso de quien rindió, no aprobó y todavía la debe. */
      var estado = actual.estado && actual.estado !== "pendiente" ? actual.estado
                 : (aplazos > 0 ? "cursando" : "pendiente");

      this.actualizarNota(id, estado, actual.nota, aplazos);
    },

    reiniciar: function () {
      var metricas = this.calcularMetricas();
      var cargadas = metricas.aprobadasCount + metricas.regularesCount + metricas.cursandoCount;

      if (cargadas === 0) {
        UI.toast("Todavía no cargaste ninguna nota", "info");
        return;
      }
      var mensaje = "Vas a borrar " + UI.plural(cargadas, "materia") +
                    " cargada" + (cargadas === 1 ? "" : "s") +
                    ". Esta acción no se puede deshacer.\n\n¿Seguís adelante?";
      if (!global.confirm(mensaje)) return;

      try { localStorage.removeItem(this.storageKey); } catch (e) { /* nada que hacer */ }
      this.renderTabla();
      UI.toast("Listo: se borraron todas tus notas", "success");
    },

    renderResumen: function () {
      var m = this.calcularMetricas();

      function set(id, texto) {
        var el = document.getElementById(id);
        if (el) el.textContent = texto;
      }

      set("calc-promedio-sin-aplazos", m.promedioSinAplazos);
      set("calc-promedio-con-aplazos", m.promedioConAplazos);
      set("calc-materias-aprobadas", m.aprobadasCount + " / " + m.totalMaterias);
      set("calc-materias-regulares", String(m.regularesCount));
      set("calc-avance-porcentaje", m.porcentajeAvance + "%");

      var barra = document.getElementById("calc-barra-progreso");
      if (barra) barra.style.width = m.porcentajeAvance + "%";

      var wrap = document.getElementById("calc-barra-progreso-wrap");
      if (wrap) {
        wrap.setAttribute("aria-valuenow", String(m.porcentajeAvance));
        wrap.setAttribute("aria-valuetext", m.porcentajeAvance + " por ciento de la carrera");
      }
    },

    /* Compatibilidad con la versión anterior */
    renderProgreso: function () { this.renderResumen(); }
  };

  global.OdontoCalculator = OdontoCalculator;
})(window);
