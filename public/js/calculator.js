/* ==========================================================================
   ODONTOCAMPUS — PROMEDIO Y AVANCE DE CARRERA
   Calcula y dibuja. Las materias viven en la cuenta de cada estudiante:
   quién entra a la sección y cómo viajan los datos lo resuelve js/carrera.js.
   Este archivo no sabe nada de servidores ni de sesiones.

   Cambios respecto de la primera versión:
   · Cambiar el estado de una materia ya no vuelve a dibujar toda la tabla.
     Antes el foco saltaba al principio y el filtro por año se reseteaba solo:
     cargar veinte materias seguidas era una pelea.
   · Los controles se manejan por delegación, sin onchange en el HTML.
   · Cada campo tiene etiqueta accesible propia (hay una fila por materia; sin
     etiquetas, un lector de pantalla anuncia sesenta "combo box" iguales).
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

  // El mismo tope que acepta la base (003_cuentas_con_contrasena.sql).
  var MAX_APLAZOS = 30;

  /* Cómo se nombra cada estado en el detalle del odontograma. También sirve
     para validar: lo que no esté acá se dibuja como pendiente. */
  var NOMBRE_ESTADO = {
    aprobada: "aprobada",
    regular: "regular, lista para el final",
    cursando: "cursando",
    pendiente: "pendiente"
  };

  var PERIODOS = {
    anual: "Anual",
    "1c": "1.° cuatrimestre",
    "2c": "2.° cuatrimestre",
    bimestral: "Bimestral"
  };

  var TITULOS_ANIO = ["", "Primer año", "Segundo año", "Tercer año", "Cuarto año", "Quinto año", "Sexto año"];

  function limitarAplazos(valor) {
    return Math.min(MAX_APLAZOS, Math.max(0, parseInt(valor, 10) || 0));
  }

  /* En castellano el separador decimal es la coma. Un promedio "7.84" delata
     que el número salió de un programa y no de una libreta. */
  function formatear(numero, decimales) {
    return numero.toFixed(decimales).replace(".", ",");
  }

  /**
   * Los números del promedio no saltan: cuentan hasta el valor nuevo.
   *
   * Es el detalle que convierte "cargué una nota" en "pasó algo". Dura menos
   * de medio segundo y se apaga por completo si el sistema pide menos
   * movimiento, donde el número se escribe directo.
   */
  var animaciones = {};

  function animarNumero(id, valor, decimales, sufijo) {
    var el = document.getElementById(id);
    if (!el) return;
    sufijo = sufijo || "";

    var destino = parseFloat(valor) || 0;
    var desde = parseFloat(String(el.textContent).replace("%", "").replace(",", ".")) || 0;
    var quieto = global.matchMedia &&
                 global.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Si la pestaña no se está pintando, requestAnimationFrame no corre y el
       número se quedaría en el valor viejo hasta que alguien la vuelva a
       mirar. En ese caso se escribe directo: el dato correcto primero, la
       animación sólo si hay alguien viendo. */
    if (quieto || document.hidden || desde === destino) {
      el.textContent = formatear(destino, decimales) + sufijo;
      return;
    }

    global.cancelAnimationFrame(animaciones[id]);
    var inicio = null;
    var duracion = 420;

    function paso(ahora) {
      if (inicio === null) inicio = ahora;
      var avance = Math.min(1, (ahora - inicio) / duracion);
      var suave = 1 - Math.pow(1 - avance, 3);
      el.textContent = formatear(desde + (destino - desde) * suave, decimales) + sufijo;
      if (avance < 1) animaciones[id] = global.requestAnimationFrame(paso);
    }

    animaciones[id] = global.requestAnimationFrame(paso);
  }

  var OdontoCalculator = {
    filtroAnio: "todos",

    /* ====================================================================
       ALMACENAMIENTO (delegado en js/carrera.js)
       ==================================================================== */
    getNotas: function () {
      return global.OdontoCarrera ? global.OdontoCarrera.leerCopia() : {};
    },

    getCursos: function () {
      return global.OdontoCarrera ? global.OdontoCarrera.leerCursos() : {};
    },

    guardarNotas: function (notas) {
      if (global.OdontoCarrera) global.OdontoCarrera.escribirCopia(notas);
    },

    /** El plan que cursa la persona (lo decide su cuenta; si no, el vigente). */
    getPlan: function () {
      if (global.OdontoCarrera) return global.OdontoCarrera.plan();
      var planes = global.ODONTO_PLANES;
      return planes ? planes.planes[planes.porDefecto] : null;
    },

    /**
     * Materias del plan, en el orden de la facultad. El `id` es el código del
     * SIU Guaraní: es lo que se guarda en la cuenta.
     */
    getTodasLasMaterias: function () {
      var plan = this.getPlan();
      if (!plan) return [];
      return plan.materias.map(function (mat) {
        return {
          id: mat.codigo, codigo: mat.codigo, nombre: mat.nombre,
          periodo: mat.periodo, correlativas: mat.correlativas || [],
          condicion: mat.condicion || "",
          anio: mat.anio, anioTitulo: TITULOS_ANIO[mat.anio] || (mat.anio + ".° año")
        };
      });
    },

    /** Las materias agrupadas por año, para la tabla. */
    getNiveles: function () {
      var niveles = [];
      this.getTodasLasMaterias().forEach(function (mat) {
        var nivel = niveles[niveles.length - 1];
        if (!nivel || nivel.anio !== mat.anio) {
          nivel = { anio: mat.anio, titulo: mat.anioTitulo, materias: [] };
          niveles.push(nivel);
        }
        nivel.materias.push(mat);
      });
      return niveles;
    },

    actualizarNota: function (materiaId, estado, notaFinal, aplazos) {
      var notas = this.getNotas();

      if (!estado || estado === "pendiente") {
        delete notas[materiaId];
      } else {
        notas[materiaId] = {
          estado: estado,
          nota: estado === "aprobada" ? (parseFloat(notaFinal) || null) : null,
          aplazos: limitarAplazos(aplazos),
          fechaActualizacion: new Date().toISOString()
        };
      }

      this.guardarNotas(notas);
      // Queda pendiente hasta que la cuenta confirme que lo guardó.
      if (global.OdontoCarrera) global.OdontoCarrera.marcarCambio(materiaId);
      this.renderResumen();
      return notas[materiaId];
    },

    /* ====================================================================
       CÁLCULO
       ==================================================================== */
    calcularMetricas: function () {
      var notas = this.getNotas();
      var todas = this.getTodasLasMaterias();
      var cursos = this.getCursos();
      var plan = this.getPlan();

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

      /* Los cursos complementarios con nota entran al promedio igual que una
         materia: así lo calcula el SIU Guaraní. Con el reporte de materias de
         una estudiante real, sin contarlos el promedio daba 7,08 y 6,37; con
         ellos, 6,93 y 6,31, exactamente lo que dice el SIU. */
      var horas = 0, cursosConNota = 0, sumaCursos = 0;
      Object.keys(cursos).forEach(function (id) {
        var c = cursos[id];
        horas += c.horas || 0;
        if (c.nota >= 4) { cursosConNota++; sumaCursos += c.nota; }
      });
      sumaNotas += sumaCursos;

      var promediables = aprobadas + cursosConNota;
      var rendidos = promediables + cantidadAplazos;
      var horasRequeridas = plan ? plan.horasComplementarias || 0 : 0;

      return {
        totalMaterias: todas.length,
        aprobadasCount: aprobadas,
        regularesCount: regulares,
        cursandoCount: cursando,
        pendientesCount: todas.length - (aprobadas + regulares + cursando),
        totalAplazosCount: cantidadAplazos,
        horasComplementarias: horas,
        horasRequeridas: horasRequeridas,
        cursosCount: Object.keys(cursos).length,
        promedioSinAplazos: promediables > 0 ? (sumaNotas / promediables).toFixed(2) : "0.00",
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

      UI.registerActions({
        quitarCurso: function (data) { self.quitarCurso(data.id); }
      });

      var form = document.getElementById("form-curso");
      if (form) {
        UI.on(form, "submit", function (event) {
          event.preventDefault();
          self.agregarCurso(form);
        });
      }

      var lista = document.getElementById("cursos-lista");
      if (lista) {
        UI.on(lista, "change", function (event) {
          var fila = event.target.closest("[data-curso-id]");
          if (fila) self.alCambiarCurso(fila, event.target);
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
          else if (el.classList.contains("aplazos-input")) self.alCambiarAplazos(id, el.value, el);
        });
      }
    },

    renderTabla: function (filtroAnio) {
      var cont = document.getElementById("calculadora-materias-lista");
      if (!cont) return;

      if (filtroAnio !== undefined) this.filtroAnio = String(filtroAnio);
      var filtro = this.filtroAnio;
      var notas = this.getNotas();
      var self = this;

      // Nombre de cada materia por código, para escribir las correlativas.
      var nombres = {};
      this.getTodasLasMaterias().forEach(function (m) { nombres[m.codigo] = m.nombre; });
      this.nombresPorCodigo = nombres;

      var plan = this.getPlan();
      var rotulo = document.getElementById("calc-plan-nombre");
      if (rotulo && plan) rotulo.textContent = "Plan " + plan.id + " · " + plan.nombre;

      var niveles = this.getNiveles().filter(function (nivel) {
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
                  "<th>Código</th><th>Materia</th><th>Período</th>" +
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

      this.renderCursos();
      this.renderResumen();
    },

    filaMateria: function (mat, registro) {
      registro = registro || { estado: "pendiente", nota: "", aplazos: 0 };
      var aprobada = registro.estado === "aprobada";
      var nombreSeguro = escAttr(mat.nombre);
      var nombres = this.nombresPorCodigo || {};

      /* Correlativas con nombre, no con código: "0003C" no le dice nada a
         nadie. Lo que no es una materia (secundario completo, la PPS) se
         escribe tal cual lo dice el plan. */
      var requisitos = mat.correlativas.map(function (c) { return nombres[c] || c; });
      if (mat.condicion) requisitos.push(mat.condicion);
      var textoCorrelativas = requisitos.length ? requisitos.join(" · ") : "Sin correlativas";

      return (
        '<tr class="materia-row' + (aprobada ? " row-aprobada" : "") + '" data-materia-id="' + escAttr(mat.id) + '">' +
          '<td><span class="code-tag">' + esc(mat.codigo) + "</span></td>" +
          "<td>" +
            '<span class="materia-title">' + esc(mat.nombre) + "</span>" +
            '<small class="correlativa-info">Correlativas: ' + esc(textoCorrelativas) + "</small>" +
          "</td>" +
          '<td><span class="regimen-tag">' + esc(PERIODOS[mat.periodo] || mat.periodo) + "</span></td>" +
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
            '<input type="number" inputmode="numeric" min="0" max="' + MAX_APLAZOS + '" ' +
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

    alCambiarAplazos: function (id, valor, input) {
      var notas = this.getNotas();
      var actual = notas[id] || { estado: "pendiente", nota: null };
      var aplazos = limitarAplazos(valor);
      if (input && String(aplazos) !== String(valor)) input.value = aplazos;

      /* Un aplazo cuenta aunque la materia siga pendiente: es justamente el
         caso de quien rindió, no aprobó y todavía la debe. */
      var estado = actual.estado && actual.estado !== "pendiente" ? actual.estado
                 : (aplazos > 0 ? "cursando" : "pendiente");

      this.actualizarNota(id, estado, actual.nota, aplazos);
    },

    reiniciar: function () {
      var metricas = this.calcularMetricas();
      var cargadas = metricas.aprobadasCount + metricas.regularesCount + metricas.cursandoCount;

      if (cargadas === 0 && !Object.keys(this.getNotas()).length && !Object.keys(this.getCursos()).length) {
        UI.toast("Todavía no cargaste ninguna materia", "info");
        return;
      }
      var mensaje = "Vas a borrar todas las materias y los cursos complementarios de tu cuenta, " +
                    "en todos tus dispositivos. " +
                    "No se puede deshacer.\n\n¿Seguís adelante?";
      if (!global.confirm(mensaje)) return;

      if (global.OdontoCarrera) global.OdontoCarrera.borrarTodo();
    },

    /**
     * Odontograma: una pieza por materia del plan, numerada con su código.
     *
     * Reemplaza la barra de progreso. Una barra dice cuánto falta; esto dice
     * QUÉ falta, que es la pregunta real cuando alguien se pregunta cómo
     * viene. La grilla está oculta para lectores de pantalla (es un resumen
     * visual); el equivalente accesible es la línea de resumen y la tabla.
     */
    renderOdontograma: function () {
      var cont = document.getElementById("odonto-piezas");
      var resumen = document.getElementById("odonto-resumen");
      if (!cont) return;

      var notas = this.getNotas();
      var conteo = { aprobada: 0, regular: 0, cursando: 0, pendiente: 0 };

      cont.innerHTML = this.getTodasLasMaterias().map(function (mat) {
        var registro = notas[mat.id] || {};
        var estado = NOMBRE_ESTADO[registro.estado] ? registro.estado : "pendiente";
        conteo[estado]++;

        // "00011" se muestra como "11" y "0002A" como "2A": los ceros de
        // adelante son iguales en las sesenta y sólo ocupan lugar.
        var numero = String(mat.codigo || mat.id).replace(/^0+(?=.)/, "");
        var conAplazo = registro.aplazos > 0;

        var detalle = mat.nombre + " — " + NOMBRE_ESTADO[estado];
        if (estado === "aprobada" && registro.nota) {
          detalle += " con " + formatear(registro.nota, 2);
        }
        if (conAplazo) detalle += " · " + UI.plural(registro.aplazos, "aplazo");

        return '<li class="pieza es-' + estado + (conAplazo ? " con-aplazo" : "") + '" ' +
               'title="' + escAttr(detalle) + '">' + esc(numero) + "</li>";
      }).join("");

      if (resumen) {
        var partes = [];
        if (conteo.aprobada) partes.push(conteo.aprobada + " aprobadas");
        if (conteo.regular) partes.push(conteo.regular + " regulares");
        if (conteo.cursando) partes.push(conteo.cursando + " cursando");
        partes.push(conteo.pendiente + " pendientes");
        resumen.textContent = partes.join(" · ");
      }
    },

    renderResumen: function () {
      var m = this.calcularMetricas();

      function set(id, texto) {
        var el = document.getElementById(id);
        if (el) el.textContent = texto;
      }

      animarNumero("calc-promedio-sin-aplazos", m.promedioSinAplazos, 2);
      animarNumero("calc-promedio-con-aplazos", m.promedioConAplazos, 2);
      animarNumero("calc-avance-porcentaje", m.porcentajeAvance, 0, "%");
      set("calc-materias-aprobadas", m.aprobadasCount + " / " + m.totalMaterias);
      set("calc-materias-regulares", String(m.regularesCount));
      set("calc-horas-complementarias", m.horasComplementarias + " / " + m.horasRequeridas + " h");
      this.renderHorasCursos(m);

      var barra = document.getElementById("calc-barra-progreso");
      if (barra) barra.style.width = m.porcentajeAvance + "%";

      var wrap = document.getElementById("calc-barra-progreso-wrap");
      if (wrap) {
        wrap.setAttribute("aria-valuenow", String(m.porcentajeAvance));
        wrap.setAttribute("aria-valuetext", m.porcentajeAvance + " por ciento de la carrera");
      }

      this.renderOdontograma();
    },

    /* ====================================================================
       FORMACIÓN COMPLEMENTARIA
       Optativas y electivas. No son un casillero fijo del plan: cada quien
       elige sus cursos, y el plan pide un total de horas.
       ==================================================================== */

    /** Los cursos en orden: primero los que tienen fecha, del más nuevo. */
    cursosOrdenados: function () {
      var cursos = this.getCursos();
      return Object.keys(cursos).map(function (id) {
        var c = cursos[id];
        c.id = id;
        return c;
      }).sort(function (a, b) {
        if ((a.fecha || "") !== (b.fecha || "")) return (b.fecha || "").localeCompare(a.fecha || "");
        return a.nombre.localeCompare(b.nombre, "es");
      });
    },

    /**
     * Revisa los datos de un curso y dice qué está mal, en castellano.
     * @returns {{datos: object}|{error: string, campo: string}}
     */
    validarCurso: function (nombre, horas, nota, fecha) {
      nombre = String(nombre || "").replace(/\s+/g, " ").trim();
      if (nombre.length < 2) return { error: "Escribí el nombre del curso", campo: "nombre" };
      if (nombre.length > 160) return { error: "El nombre puede tener hasta 160 caracteres", campo: "nombre" };

      var h = Number(horas);
      if (!horas || !Number.isInteger(h) || h < 1 || h > 400) {
        return { error: "Las horas van de 1 a 400, sin decimales", campo: "horas" };
      }

      var n = null;
      if (nota !== "" && nota !== null && nota !== undefined) {
        n = parseFloat(String(nota).replace(",", "."));
        if (isNaN(n) || n < 4 || n > 10) {
          return { error: "La nota va de 4 a 10. Si no tuvo nota, dejala vacía", campo: "nota" };
        }
      }

      if (fecha && (fecha < "1950-01-01" || fecha > "2100-01-01")) {
        return { error: "Revisá la fecha", campo: "fecha" };
      }

      return { datos: { nombre: nombre, horas: h, nota: n, fecha: fecha || null } };
    },

    agregarCurso: function (form) {
      if (!global.OdontoCarrera) return;
      var campo = function (nombre) { return form.elements["curso-" + nombre]; };

      var r = this.validarCurso(campo("nombre").value, campo("horas").value,
                                campo("nota").value, campo("fecha").value);
      if (r.error) {
        UI.toast(r.error, "warning");
        campo(r.campo).focus();
        return;
      }

      if (Object.keys(this.getCursos()).length >= 40) {
        UI.toast("Llegaste al máximo de 40 cursos", "warning");
        return;
      }

      global.OdontoCarrera.guardarCurso(null, r.datos);
      form.reset();
      campo("nombre").focus();

      this.renderCursos();
      this.renderResumen();
      UI.announce("Se agregó " + r.datos.nombre + ", " + UI.plural(r.datos.horas, "hora"));
    },

    alCambiarCurso: function (fila, input) {
      if (!global.OdontoCarrera) return;
      var id = fila.getAttribute("data-curso-id");
      var actual = this.getCursos()[id];
      if (!actual) return;

      var valor = function (clase) { return fila.querySelector("." + clase).value; };
      var r = this.validarCurso(valor("curso-nombre"), valor("curso-horas"),
                                valor("curso-nota"), valor("curso-fecha"));
      if (r.error) {
        UI.toast(r.error, "warning");
        // Vuelve al último valor bueno: un curso a medio escribir no se guarda.
        fila.querySelector(".curso-nombre").value = actual.nombre;
        fila.querySelector(".curso-horas").value = actual.horas;
        fila.querySelector(".curso-nota").value = actual.nota === null ? "" : actual.nota;
        fila.querySelector(".curso-fecha").value = actual.fecha || "";
        input.focus();
        return;
      }

      global.OdontoCarrera.guardarCurso(id, r.datos);
      this.renderResumen();
    },

    quitarCurso: function (id) {
      if (!global.OdontoCarrera) return;
      var curso = this.getCursos()[id];
      if (!curso) return;

      global.OdontoCarrera.quitarCurso(id);
      this.renderCursos();
      this.renderResumen();
      UI.toast("Se quitó «" + curso.nombre + "»", "info");

      var nombre = document.getElementById("curso-nombre");
      if (nombre) nombre.focus();
    },

    renderCursos: function () {
      var cont = document.getElementById("cursos-lista");
      if (!cont) return;

      var cursos = this.cursosOrdenados();

      if (!cursos.length) {
        cont.innerHTML =
          '<p class="cursos-vacio">Todavía no cargaste cursos. Sumá los que ya aprobaste ' +
          "con el formulario de abajo: las horas cuentan para las que pide el plan y la nota " +
          "entra en tu promedio, como en el SIU Guaraní.</p>";
        return;
      }

      cont.innerHTML =
        '<div class="table-responsive">' +
          '<table class="odonto-table tabla-cursos">' +
            "<caption>Tus cursos. Podés corregir cualquier dato directamente en la tabla.</caption>" +
            "<thead><tr>" +
              "<th>Curso</th><th>Horas</th><th>Nota</th><th>Fecha</th>" +
              '<th><span class="visually-hidden">Quitar</span></th>' +
            "</tr></thead>" +
            "<tbody>" +
              cursos.map(function (c) {
                var id = escAttr(c.id);
                var nombre = escAttr(c.nombre);
                return (
                  '<tr class="curso-row" data-curso-id="' + id + '">' +
                    '<td data-rotulo="Curso">' +
                      '<label class="visually-hidden" for="cn-' + id + '">Nombre del curso</label>' +
                      '<input type="text" class="form-control curso-nombre" id="cn-' + id + '" ' +
                             'maxlength="160" value="' + nombre + '">' +
                    "</td>" +
                    '<td data-rotulo="Horas">' +
                      '<label class="visually-hidden" for="ch-' + id + '">Horas de ' + nombre + "</label>" +
                      '<input type="number" inputmode="numeric" min="1" max="400" step="1" ' +
                             'class="form-control curso-horas" id="ch-' + id + '" value="' + escAttr(c.horas) + '">' +
                    "</td>" +
                    '<td data-rotulo="Nota">' +
                      '<label class="visually-hidden" for="cq-' + id + '">Nota de ' + nombre + "</label>" +
                      '<input type="number" inputmode="decimal" min="4" max="10" step="0.5" placeholder="—" ' +
                             'class="form-control curso-nota" id="cq-' + id + '" value="' + escAttr(c.nota === null ? "" : c.nota) + '">' +
                    "</td>" +
                    '<td data-rotulo="Fecha">' +
                      '<label class="visually-hidden" for="cf-' + id + '">Fecha de ' + nombre + "</label>" +
                      '<input type="date" min="1950-01-01" max="2100-01-01" ' +
                             'class="form-control curso-fecha" id="cf-' + id + '" value="' + escAttr(c.fecha || "") + '">' +
                    "</td>" +
                    '<td class="curso-quitar">' +
                      '<button type="button" class="btn-icono-quitar" data-action="quitarCurso" data-id="' + id + '" ' +
                              'aria-label="Quitar ' + nombre + '">' + UI.icono("tacho") + "</button>" +
                    "</td>" +
                  "</tr>"
                );
              }).join("") +
            "</tbody>" +
          "</table>" +
        "</div>";
    },

    /** Las horas contra las que pide el plan, en la cabecera de la tarjeta. */
    renderHorasCursos: function (m) {
      var requeridas = m.horasRequeridas;
      var hechas = m.horasComplementarias;
      var porcentaje = requeridas ? Math.min(100, Math.round((hechas / requeridas) * 100)) : 0;
      var completa = requeridas > 0 && hechas >= requeridas;

      var badge = document.getElementById("cursos-horas-badge");
      if (badge) {
        badge.textContent = completa
          ? "Completa · " + hechas + " h"
          : hechas + " de " + requeridas + " h";
        badge.classList.toggle("es-completa", completa);
      }

      var requeridasEl = document.getElementById("cursos-horas-requeridas");
      if (requeridasEl) requeridasEl.textContent = String(requeridas);

      var barra = document.getElementById("cursos-barra");
      if (barra) {
        barra.style.width = porcentaje + "%";
        var wrap = barra.parentNode;
        wrap.setAttribute("aria-valuenow", String(Math.min(hechas, requeridas)));
        wrap.setAttribute("aria-valuemax", String(requeridas));
        wrap.setAttribute("aria-valuetext", completa
          ? "Completaste las " + requeridas + " horas"
          : hechas + " de " + requeridas + " horas");
      }
    },

    /* Compatibilidad con la versión anterior */
    renderProgreso: function () { this.renderResumen(); }
  };

  global.OdontoCalculator = OdontoCalculator;
})(window);
