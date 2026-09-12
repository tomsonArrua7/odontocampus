/* ==========================================================================
   ODONTOCAMPUS — SINCRONIZACIÓN EN VIVO
   Lee las planillas oficiales de mesas de finales y de reválidas publicadas
   por las cátedras y las presenta agrupadas por día.

   Decisiones de esta versión:
   · Todo dato de la planilla se escapa antes de insertarse en el DOM. Las
     celdas las edita gente ajena a este código: son entrada no confiable.
   · Las tarjetas se agrupan por jornada. Ochenta y tres tarjetas en una sola
     lista son una pared; agrupadas se recorren o se saltean.
   · El filtro de días se arma con los días que la planilla realmente trae.
     Antes estaba escrito a mano en el HTML y quedaba desactualizado en cada
     turno de exámenes.
   · Si falla la conexión se avisa explícitamente que se están mostrando datos
     guardados, con la hora de la última sincronización.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var esc = UI.esc, escAttr = UI.escAttr;

  var OdontoLiveSheets = {
    sheetIdMesas: "1NC_lABOKN0w-RaxiAXVQwBvdJqGw4F6dAXHWSK2fi6I",
    sheetIdRevalidas: "1KWy04FseDtScAqYQ3kFopI_0jnfbmzd0gxl53tevD9M",
    gid: "0",

    lastUpdatedMesas: null,
    lastUpdatedRevalidas: null,
    offlineMesas: false,
    offlineRevalidas: false,
    cachedMesas: [],
    cachedRevalidas: [],
    cachedItems: [],
    isLoadingMesas: false,
    isLoadingRevalidas: false,

    /* ====================================================================
       CARGA
       ==================================================================== */
    endpoint: function (sheetId) {
      return "https://docs.google.com/spreadsheets/d/" + sheetId +
             "/gviz/tq?tqx=out:csv&gid=" + this.gid + "&t=" + Date.now();
    },

    init: function () {
      this.pintarEsqueleto("mesas-grid");
      this.pintarEsqueleto("revalidas-grid");
      this.initEventListeners();
      this.cargarMesas(true);
      this.cargarRevalidas(true);
    },

    pintarEsqueleto: function (id) {
      var cont = document.getElementById(id);
      if (cont && !cont.children.length) cont.innerHTML = UI.skeletonGrid(6);
    },

    cargarMesas: function (silent) {
      return this.cargar({
        clave: "mesas",
        sheetId: this.sheetIdMesas,
        parser: this.parseCSVMesas,
        respaldo: this.getRespaldoMesas,
        storage: "odontocampus_cached_mesas_v2",
        storageTime: "odontocampus_mesas_timestamp_v2",
        etiqueta: "Mesas de finales",
        silent: silent
      });
    },

    cargarRevalidas: function (silent) {
      return this.cargar({
        clave: "revalidas",
        sheetId: this.sheetIdRevalidas,
        parser: this.parseCSVRevalidas,
        respaldo: this.getRespaldoRevalidas,
        storage: "odontocampus_cached_revalidas_v2",
        storageTime: "odontocampus_revalidas_timestamp_v2",
        etiqueta: "Reválidas",
        silent: silent
      });
    },

    cargar: function (cfg) {
      var self = this;
      var flag = cfg.clave === "mesas" ? "isLoadingMesas" : "isLoadingRevalidas";
      if (this[flag]) return Promise.resolve();

      this[flag] = true;
      this.estadoCarga(cfg.clave, true);

      return fetch(this.endpoint(cfg.sheetId), {
        method: "GET",
        headers: { "Cache-Control": "no-cache" }
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.text();
        })
        .then(function (csv) {
          var items = cfg.parser.call(self, csv);
          if (!items || !items.length) throw new Error("La planilla no devolvió filas");

          self.guardar(cfg, items, new Date(), false);
          if (!cfg.silent) UI.toast(cfg.etiqueta + ": datos actualizados", "success");
        })
        .catch(function (error) {
          console.warn("[OdontoCampus] No se pudo sincronizar " + cfg.etiqueta + ":", error);
          self.recuperarDeCache(cfg);
          if (!cfg.silent) {
            UI.toast("No pudimos conectarnos. Estás viendo la última copia guardada.", "warning");
          }
        })
        .then(function () {
          self[flag] = false;
          self.estadoCarga(cfg.clave, false);
          self.poblarFiltroDias(cfg.clave);
          if (cfg.clave === "mesas") self.renderMesasExamen();
          else self.renderRevalidas();
          if (global.OdontoApp && global.OdontoApp.renderProximasFechas) {
            global.OdontoApp.renderProximasFechas();
          }
        });
    },

    guardar: function (cfg, items, fecha, offline) {
      if (cfg.clave === "mesas") {
        this.cachedMesas = items;
        this.lastUpdatedMesas = fecha;
        this.offlineMesas = !!offline;
      } else {
        this.cachedRevalidas = items;
        this.lastUpdatedRevalidas = fecha;
        this.offlineRevalidas = !!offline;
      }
      this.cachedItems = this.cachedMesas.concat(this.cachedRevalidas);

      if (!offline) {
        try {
          localStorage.setItem(cfg.storage, JSON.stringify(items));
          localStorage.setItem(cfg.storageTime, fecha.toISOString());
        } catch (e) { /* navegación privada o almacenamiento lleno */ }
      }
    },

    recuperarDeCache: function (cfg) {
      var items = null, fecha = null;
      try {
        var crudo = localStorage.getItem(cfg.storage);
        if (crudo) {
          items = JSON.parse(crudo);
          var t = localStorage.getItem(cfg.storageTime);
          if (t) fecha = new Date(t);
        }
      } catch (e) { items = null; }

      if (!items || !items.length) {
        items = cfg.respaldo.call(this);
        fecha = null;
      }
      this.guardar(cfg, items, fecha, true);
    },

    /* ====================================================================
       INTERPRETACIÓN DEL CSV
       ==================================================================== */
    /** Reconoce una fila que en realidad es un encabezado de jornada. */
    esEncabezadoDeDia: function (texto) {
      var t = UI.normalizar(texto);
      var diasSemana = /(lunes|martes|miercoles|jueves|viernes|sabado|domingo)/;
      var fechaNumerica = /^\s*\d{1,2}\s*[\/\-]\s*\d{1,2}([\/\-]\s*\d{2,4})?\s*$/;
      var diaYMes = /^\s*\d{1,2}\s+de\s+[a-z]+/;
      return diasSemana.test(t) || fechaNumerica.test(t) || diaYMes.test(t);
    },

    esFilaDeRuido: function (texto) {
      var t = UI.normalizar(texto);
      return t.indexOf("materia") === 0 ||
             t.indexOf("mesa finales") !== -1 ||
             t.indexOf("revalidas y") !== -1 ||
             t.indexOf("ante cualquier") !== -1 ||
             t.indexOf("horarios sujetos") !== -1;
    },

    /**
     * Normaliza una fila del CSV conservando la posición de cada columna.
     *
     * La versión anterior descartaba las celdas vacías antes de leerlas. Eso
     * corría todo hacia la izquierda: en un llamado sin modalidad cargada, el
     * ID de Zoom terminaba en la columna del horario y la tarjeta decía
     * "Horario: Zoom". Las columnas ahora se respetan; sólo se descarta la
     * fila cuando está enteramente vacía.
     */
    normalizarFila: function (fila) {
      var celdas = fila.map(function (c) { return (c || "").replace(/\s+/g, " ").trim(); });
      var primerTexto = "";
      for (var i = 0; i < celdas.length; i++) {
        if (celdas[i]) { primerTexto = celdas[i]; break; }
      }
      return { celdas: celdas, vacia: primerTexto === "", primerTexto: primerTexto };
    },

    /**
     * En la planilla hay filas donde la columna del horario trae en realidad
     * la modalidad ("Presencial", "Cátedra", "Zoom"). Mostrarlas tal cual
     * producía tarjetas que decían "Horario: Presencial", que no le sirven a
     * nadie. Cuando la celda no contiene ningún número y sí una palabra de
     * modalidad, la interpretamos como tal y avisamos que el horario falta.
     */
    interpretarHora: function (celdaHora, modalidadActual) {
      var texto = String(celdaHora || "").trim();
      if (!texto) return { hora: "Horario a confirmar", modalidadExtra: "" };

      var tieneNumero = /\d/.test(texto);
      var pareceModalidad = /(presencial|zoom|catedra|virtual|oral|escrito|mixto)/.test(UI.normalizar(texto));

      if (!tieneNumero && pareceModalidad) {
        return { hora: "Horario a confirmar", modalidadExtra: texto };
      }
      return { hora: texto, modalidadExtra: "" };
    },

    parseCSVMesas: function (csvText) {
      var self = this;
      var items = [];
      var diaActual = "Fecha por confirmar";

      this.splitCSV(csvText).forEach(function (fila) {
        var info = self.normalizarFila(fila);
        if (info.vacia) return;

        if (self.esEncabezadoDeDia(info.primerTexto)) {
          diaActual = self.formatearDia(info.primerTexto);
          return;
        }
        if (self.esFilaDeRuido(info.primerTexto)) return;

        var celdas = info.celdas;
        if (!celdas[0]) return; // fila de continuación sin materia

        var materia = celdas[0];
        var idZoom = celdas[3] || "";
        var acceso = celdas[4] || "";

        var lectura = self.interpretarHora(celdas[1]);
        var modalidadRaw = [celdas[2] || "", lectura.modalidadExtra]
          .filter(Boolean).join(" · ");

        var esZoom = UI.normalizar(modalidadRaw).indexOf("zoom") !== -1 ||
                     idZoom.replace(/\D/g, "").length > 6 ||
                     UI.normalizar(materia).indexOf("zoom") !== -1;

        var modalidad = "Presencial";
        if (esZoom) modalidad = "Zoom";
        else if (modalidadRaw) modalidad = modalidadRaw.charAt(0).toUpperCase() + modalidadRaw.slice(1);

        items.push({
          id: "mesa-" + items.length,
          dia: diaActual,
          materiaOriginal: materia,
          materia: materia,
          hora: lectura.hora,
          modalidad: modalidad,
          idZoom: idZoom,
          acceso: acceso,
          tipo: "final",
          modalidadRaw: modalidadRaw
        });
      });

      return items;
    },

    parseCSVRevalidas: function (csvText) {
      var self = this;
      var items = [];
      var diaActual = "Fecha por confirmar";

      this.splitCSV(csvText).forEach(function (fila) {
        var info = self.normalizarFila(fila);
        if (info.vacia) return;

        if (self.esEncabezadoDeDia(info.primerTexto)) {
          diaActual = self.formatearDia(info.primerTexto);
          return;
        }
        if (self.esFilaDeRuido(info.primerTexto)) return;

        var celdas = info.celdas;
        if (!celdas[0]) return;

        var materia = celdas[0];
        var idZoom = celdas[3] || "";
        var acceso = celdas[4] || "";

        var lectura = self.interpretarHora(celdas[1]);
        var plataformaRaw = [celdas[2] || "", lectura.modalidadExtra]
          .filter(Boolean).join(" · ");
        var plataforma = UI.normalizar(plataformaRaw);

        var tipo = UI.normalizar(materia).indexOf("actualizacion") !== -1 ? "actualizacion" : "revalida";

        var modalidad = "Presencial";
        if (plataforma.indexOf("zoom") !== -1 || idZoom.replace(/\D/g, "").length > 6) modalidad = "Zoom";
        else if (plataforma.indexOf("elecci") !== -1 || plataforma.indexOf("mixto") !== -1) modalidad = "Presencial o Zoom";
        else if (plataformaRaw) modalidad = plataformaRaw;

        items.push({
          id: "rev-" + items.length,
          dia: diaActual,
          materiaOriginal: materia,
          materia: materia,
          hora: lectura.hora,
          modalidad: modalidad,
          idZoom: idZoom,
          acceso: acceso,
          tipo: tipo,
          plataformaRaw: plataformaRaw
        });
      });

      return items;
    },

    splitCSV: function (csvText) {
      var lineas = [];
      var fila = [""];
      var entreComillas = false;

      for (var i = 0; i < csvText.length; i++) {
        var ch = csvText[i];
        var sig = csvText[i + 1];

        if (ch === '"') {
          if (entreComillas && sig === '"') { fila[fila.length - 1] += '"'; i++; }
          else entreComillas = !entreComillas;
        } else if (ch === "," && !entreComillas) {
          fila.push("");
        } else if ((ch === "\r" || ch === "\n") && !entreComillas) {
          if (ch === "\r" && sig === "\n") i++;
          lineas.push(fila);
          fila = [""];
        } else {
          fila[fila.length - 1] += ch;
        }
      }
      if (fila.length > 1 || fila[0] !== "") lineas.push(fila);
      return lineas;
    },

    formatearDia: function (texto) {
      var s = String(texto || "").trim().replace(/\s+/g, " ");
      var fecha = UI.parseFechaTexto(s);
      if (fecha && !/[a-zA-Z]/.test(s)) {
        // Sólo números: lo reescribimos como "Jueves 27 de agosto", más legible
        var dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
        var meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
                     "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
        var nombre = dias[fecha.getDay()];
        return nombre.charAt(0).toUpperCase() + nombre.slice(1) +
               " " + fecha.getDate() + " de " + meses[fecha.getMonth()];
      }
      return s.charAt(0).toUpperCase() + s.slice(1);
    },

    /* ====================================================================
       FILTROS
       ==================================================================== */
    diasDisponibles: function (lista) {
      var vistos = [];
      lista.forEach(function (item) {
        if (item.dia && vistos.indexOf(item.dia) === -1) vistos.push(item.dia);
      });
      return vistos.sort(function (a, b) {
        var fa = UI.parseFechaTexto(a), fb = UI.parseFechaTexto(b);
        if (fa && fb) return fa - fb;
        if (fa) return -1;
        if (fb) return 1;
        return a.localeCompare(b, "es");
      });
    },

    poblarFiltroDias: function (clave) {
      var select = document.getElementById(clave + "-filter-dia");
      if (!select) return;

      var lista = clave === "mesas" ? this.cachedMesas : this.cachedRevalidas;
      var previo = select.value;
      var dias = this.diasDisponibles(lista);

      select.innerHTML =
        '<option value="todos">Todos los días</option>' +
        dias.map(function (dia) {
          var fecha = UI.parseFechaTexto(dia);
          var cuando = fecha ? UI.cuandoTexto(fecha) : "";
          var sufijo = cuando && cuando !== "Ya pasó" ? " · " + cuando : "";
          return '<option value="' + escAttr(dia) + '">' + esc(dia + sufijo) + "</option>";
        }).join("");

      if (previo && Array.prototype.some.call(select.options, function (o) { return o.value === previo; })) {
        select.value = previo;
      }
    },

    filtrar: function (lista, opciones) {
      var q = UI.normalizar(opciones.texto || "").trim();

      return lista.filter(function (item) {
        if (opciones.tipo && opciones.tipo !== "todos" && item.tipo !== opciones.tipo) return false;
        if (opciones.dia && opciones.dia !== "todos" && item.dia !== opciones.dia) return false;

        if (opciones.modalidad && opciones.modalidad !== "todos") {
          var esZoom = UI.normalizar(item.modalidad).indexOf("zoom") !== -1;
          if (opciones.modalidad === "zoom" && !esZoom) return false;
          if (opciones.modalidad === "presencial" && esZoom) return false;
        }

        if (q) {
          var texto = UI.normalizar(item.materiaOriginal + " " + item.dia + " " + item.acceso);
          if (texto.indexOf(q) === -1) return false;
        }
        return true;
      });
    },

    /* ====================================================================
       RENDER
       ==================================================================== */
    valor: function (id) {
      var el = document.getElementById(id);
      return el ? el.value : "";
    },

    renderMesasExamen: function () {
      var cont = document.getElementById("mesas-grid");
      if (!cont) return;

      var lista = this.filtrar(this.cachedMesas, {
        texto: this.valor("mesas-search-input"),
        dia: this.valor("mesas-filter-dia"),
        modalidad: this.valor("mesas-filter-modalidad")
      });

      this.actualizarContador("mesas", this.cachedMesas.length, lista.length, "mesa", "mesas");

      if (!lista.length) {
        cont.innerHTML = this.sinResultados(
          "fa-calendar-xmark",
          this.cachedMesas.length ? "No hay mesas con esos filtros" : "Todavía no hay mesas cargadas",
          this.cachedMesas.length
            ? "Probá con otro día, cambiá la modalidad o borrá el texto de búsqueda."
            : "La planilla de cátedras aún no publicó el cronograma de este turno."
        );
        return;
      }

      cont.innerHTML = this.renderAgrupado(lista, this.tarjetaMesa, this);
    },

    renderRevalidas: function () {
      var cont = document.getElementById("revalidas-grid");
      if (!cont) return;

      var lista = this.filtrar(this.cachedRevalidas, {
        texto: this.valor("revalidas-search-input"),
        dia: this.valor("revalidas-filter-dia"),
        tipo: this.valor("revalidas-filter-tipo")
      });

      this.actualizarContador("revalidas", this.cachedRevalidas.length, lista.length, "fecha", "fechas");

      if (!lista.length) {
        cont.innerHTML = this.sinResultados(
          "fa-file-circle-xmark",
          this.cachedRevalidas.length ? "No hay fechas con esos filtros" : "Todavía no hay reválidas cargadas",
          this.cachedRevalidas.length
            ? "Probá cambiando el día o el tipo de evaluación."
            : "Cuando la facultad publique el cronograma, aparece acá automáticamente."
        );
        return;
      }

      cont.innerHTML = this.renderAgrupado(lista, this.tarjetaRevalida, this);
    },

    sinResultados: function (icono, titulo, texto) {
      return UI.emptyState({ icon: icono, title: titulo, text: texto });
    },

    /**
     * Agrupa por jornada.
     *
     * Orden: primero lo que todavía no pasó, de más cerca a más lejos; después
     * las jornadas ya cumplidas, de la más reciente hacia atrás. Ordenar por
     * fecha a secas dejaba arriba las mesas de agosto en pleno septiembre:
     * había que hacer scroll por todo lo que ya no sirve para llegar a lo que
     * importa. Lo pasado se conserva, pero atenuado y al final.
     */
    renderAgrupado: function (lista, plantilla, ctx) {
      var grupos = {};
      var orden = [];

      lista.forEach(function (item) {
        var dia = item.dia || "Fecha por confirmar";
        if (!grupos[dia]) { grupos[dia] = []; orden.push(dia); }
        grupos[dia].push(item);
      });

      var futuros = [], pasados = [], sinFecha = [];
      orden.forEach(function (dia) {
        var fecha = UI.parseFechaTexto(dia);
        if (!fecha) { sinFecha.push({ dia: dia, fecha: null }); return; }
        var entrada = { dia: dia, fecha: fecha };
        if (UI.diasHasta(fecha) < 0) pasados.push(entrada);
        else futuros.push(entrada);
      });

      futuros.sort(function (a, b) { return a.fecha - b.fecha; });
      pasados.sort(function (a, b) { return b.fecha - a.fecha; });

      var hayFuturos = futuros.length > 0;

      return futuros.concat(sinFecha, pasados).map(function (entrada) {
        var cuando = entrada.fecha ? UI.cuandoTexto(entrada.fecha) : "";
        var yaPaso = cuando === "Ya pasó";
        var items = grupos[entrada.dia];

        return (
          '<section class="day-group' + (yaPaso ? " day-group-pasado" : "") + '">' +
            '<div class="banda-dia">' +
              "<h3>" + esc(entrada.dia) + "</h3>" +
              (cuando
                ? '<span class="banda-cuando' + (yaPaso ? " es-pasado" : "") + '">' + esc(cuando) + "</span>"
                : "") +
              '<span class="banda-regla" aria-hidden="true"></span>' +
              '<span class="banda-cuenta">' + esc(UI.plural(items.length, "llamado")) + "</span>" +
            "</div>" +
            (yaPaso && hayFuturos && entrada === pasados[0]
              ? '<p class="filter-note" style="margin-bottom:var(--sp-4)">' +
                  '<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>' +
                  "<span>De acá para abajo son jornadas que ya pasaron. Quedan por si necesitás consultarlas.</span>" +
                "</p>"
              : "") +
            '<div class="lista-llamados">' +
              items.map(function (item) { return plantilla.call(ctx, item); }).join("") +
            "</div>" +
          "</section>"
        );
      }).join("");
    },

    /* La hora manda en la fila: es el dato que se busca cuando ya se sabe el
       día. Va en monoespaciada para que las columnas no bailen. */
    bloqueHora: function (hora) {
      var limpio = String(hora || "").trim();
      var tieneHora = /\d/.test(limpio);
      return '<p class="llamado-hora' + (tieneHora ? "" : " hora-incierta") + '">' +
        esc(tieneHora ? limpio : "A confirmar") + "</p>";
    },

    /* Modalidad y lugar en una sola línea. Antes el aula vivía en un recuadro
       aparte que repetía la palabra "Presencial", ya dicha en la etiqueta.

       Con Zoom se omite: la etiqueta de la derecha ya lo dice y los datos de
       la sala están abajo. Repetir "Zoom" tres veces en la misma fila es
       ruido, no información. */
    metaLlamado: function (item, esZoom) {
      var partes = [];
      var modalidad = String(item.modalidad || "").trim();
      var lugar = String(item.acceso || item.modalidadRaw || "").trim();
      var soloZoom = esZoom && UI.normalizar(modalidad) === "zoom";

      if (modalidad && !soloZoom) partes.push(modalidad);
      if (!esZoom && lugar && UI.normalizar(lugar) !== UI.normalizar(modalidad)) {
        partes.push(lugar);
      }
      if (!partes.length && !esZoom) partes.push("Presencial en la cátedra");
      return partes.join(" · ");
    },

    /* Una línea vacía no se dibuja: dejaría un hueco en la fila. */
    lineaMeta: function (item, esZoom) {
      var meta = this.metaLlamado(item, esZoom);
      return meta ? '<p class="llamado-meta">' + esc(meta) + "</p>" : "";
    },

    etiquetaModalidad: function (esZoom) {
      return '<span class="etiqueta-modalidad ' + (esZoom ? "es-zoom" : "es-aula") + '">' +
        (esZoom ? "Zoom" : "Presencial") + "</span>";
    },

    tarjetaMesa: function (mesa) {
      var esZoom = UI.normalizar(mesa.modalidad).indexOf("zoom") !== -1;

      return (
        '<article class="fila-llamado">' +
          this.bloqueHora(mesa.hora) +
          '<div class="llamado-que">' +
            '<h4 class="llamado-materia">' + esc(mesa.materiaOriginal) + "</h4>" +
            this.lineaMeta(mesa, esZoom) +
            (esZoom ? this.bloqueZoom(mesa, "Datos de acceso") : "") +
          "</div>" +
          this.etiquetaModalidad(esZoom) +
        "</article>"
      );
    },

    tarjetaRevalida: function (item) {
      var esZoom = UI.normalizar(item.modalidad).indexOf("zoom") !== -1;
      var esActualizacion = item.tipo === "actualizacion";

      return (
        '<article class="fila-llamado">' +
          this.bloqueHora(item.hora) +
          '<div class="llamado-que">' +
            '<p class="llamado-tipo' + (esActualizacion ? " es-actualizacion" : "") + '">' +
              (esActualizacion ? "Actualización" : "Reválida") +
            "</p>" +
            '<h4 class="llamado-materia">' + esc(item.materiaOriginal) + "</h4>" +
            this.lineaMeta(item, esZoom) +
            (esZoom ? this.bloqueZoom(item, "Sala de la evaluación") : "") +
          "</div>" +
          this.etiquetaModalidad(esZoom) +
        "</article>"
      );
    },

    bloqueZoom: function (item, titulo) {
      var idLimpio = String(item.idZoom || "").replace(/\s+/g, "");
      var url = idLimpio ? "https://zoom.us/j/" + encodeURIComponent(idLimpio) : "";

      function campo(etiqueta, valor, nombreCopia) {
        if (!valor) return "";
        return (
          '<div class="zoom-field-item">' +
            '<span class="zf-label">' + esc(etiqueta) + "</span>" +
            '<strong class="zf-val">' + esc(valor) + "</strong>" +
            '<button type="button" class="btn-copy-small" data-action="copiarDato" ' +
                    'data-valor="' + escAttr(valor) + '" data-etiqueta="' + escAttr(nombreCopia) + '" ' +
                    'aria-label="Copiar ' + escAttr(nombreCopia) + '">' +
              '<i class="fa-solid fa-copy" aria-hidden="true"></i>' +
            "</button>" +
          "</div>"
        );
      }

      return (
        '<div class="zoom-box">' +
          '<p class="zoom-box-header"><i class="fa-solid fa-video" aria-hidden="true"></i> ' + esc(titulo) + "</p>" +
          '<div class="zoom-fields">' +
            campo("ID de reunión", item.idZoom, "ID de Zoom") +
            campo("Código de acceso", item.acceso, "Código de acceso") +
          "</div>" +
          (url
            ? '<a href="' + UI.safeUrl(url) + '" target="_blank" rel="noopener noreferrer" class="btn-zoom-join">' +
                '<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Entrar a la sala' +
              "</a>"
            : "") +
        "</div>"
      );
    },

    /* ====================================================================
       ESTADO DE LA INTERFAZ
       ==================================================================== */
    actualizarContador: function (clave, total, visibles, singular, plural) {
      var badge = document.getElementById(clave + "-count-badge");
      if (badge) badge.textContent = total ? String(total) : "—";

      var resumen = document.getElementById(clave + "-summary");
      if (!resumen) return;

      var texto = visibles === total
        ? "Mostrando " + (visibles === 1 ? "1 " + singular : visibles + " " + plural)
        : "Mostrando " + visibles + " de " + total + " " + plural;

      resumen.innerHTML = "<b>" + esc(texto) + "</b>";
      UI.announce(texto);
    },

    estadoCarga: function (clave, cargando) {
      var btn = document.getElementById("btn-sync-" + clave);
      if (btn) {
        btn.classList.toggle("loading", !!cargando);
        btn.disabled = !!cargando;
        btn.innerHTML = cargando
          ? '<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Actualizando…'
          : '<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Actualizar ahora';
      }

      var estado = document.getElementById("sync-status-" + clave);
      var banner = document.getElementById("banner-" + clave);
      if (!estado) return;

      if (cargando) { estado.textContent = "Actualizando…"; return; }

      var fecha = clave === "mesas" ? this.lastUpdatedMesas : this.lastUpdatedRevalidas;
      var offline = clave === "mesas" ? this.offlineMesas : this.offlineRevalidas;

      if (offline) {
        estado.textContent = fecha
          ? "Sin conexión · copia guardada a las " + fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
          : "Sin conexión · mostrando datos de ejemplo";
      } else if (fecha) {
        estado.textContent = "Actualizado a las " +
          fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
      } else {
        estado.textContent = "";
      }

      if (banner) banner.classList.toggle("is-stale", !!offline);
    },

    initEventListeners: function () {
      var self = this;

      UI.registerActions({
        sincronizarMesas: function () { self.cargarMesas(false); },
        sincronizarRevalidas: function () { self.cargarRevalidas(false); },
        copiarDato: function (data) { UI.copiar(data.valor, data.etiqueta); }
      });

      [
        ["mesas-search-input", "input", "mesas"],
        ["mesas-filter-dia", "change", "mesas"],
        ["mesas-filter-modalidad", "change", "mesas"],
        ["revalidas-search-input", "input", "revalidas"],
        ["revalidas-filter-dia", "change", "revalidas"],
        ["revalidas-filter-tipo", "change", "revalidas"]
      ].forEach(function (cfg) {
        var el = document.getElementById(cfg[0]);
        if (!el) return;
        var render = cfg[2] === "mesas"
          ? function () { self.renderMesasExamen(); }
          : function () { self.renderRevalidas(); };
        UI.on(el, cfg[1], cfg[1] === "input" ? UI.debounce(render) : render);
      });
    },

    /* Compatibilidad con llamadas antiguas */
    copiarTexto: function (texto, etiqueta) { UI.copiar(texto, etiqueta); },

    /* ====================================================================
       RESPALDO
       Sólo se usa la primera vez que alguien entra sin conexión y sin copia
       guardada: es preferible mostrar una muestra que una pantalla vacía.
       ==================================================================== */
    getRespaldoMesas: function () {
      return [
        { id: "m-1", dia: "Lunes 24 de agosto", materiaOriginal: "Anatomía · Final 1", materia: "Anatomía", hora: "10 hs", modalidad: "Presencial", idZoom: "", acceso: "", tipo: "final" },
        { id: "m-2", dia: "Lunes 24 de agosto", materiaOriginal: "Prótesis B I", materia: "Prótesis B I", hora: "9 hs", modalidad: "Presencial", idZoom: "", acceso: "", tipo: "final" },
        { id: "m-3", dia: "Martes 25 de agosto", materiaOriginal: "Cirugía B 1", materia: "Cirugía B 1", hora: "9 hs", modalidad: "Presencial", idZoom: "", acceso: "Clínica", tipo: "final" },
        { id: "m-4", dia: "Miércoles 26 de agosto", materiaOriginal: "Bioquímica · Final 1", materia: "Bioquímica", hora: "9 hs", modalidad: "Presencial", idZoom: "", acceso: "Aula 9", tipo: "final" },
        { id: "m-5", dia: "Jueves 27 de agosto", materiaOriginal: "Operatoria A 1", materia: "Operatoria A 1", hora: "8 hs", modalidad: "Presencial", idZoom: "", acceso: "Aula 10", tipo: "final" },
        { id: "m-6", dia: "Viernes 28 de agosto", materiaOriginal: "Farmacología 1", materia: "Farmacología 1", hora: "9:30 hs", modalidad: "Presencial", idZoom: "", acceso: "Asistencia en cátedra", tipo: "final" },
        { id: "m-7", dia: "Sábado 29 de agosto", materiaOriginal: "Introducción a la Odontología", materia: "Introducción a la Odontología", hora: "8 hs", modalidad: "Zoom", idZoom: "521 207 1971", acceso: "1971", tipo: "final" }
      ];
    },

    getRespaldoRevalidas: function () {
      return [
        { id: "r-1", dia: "Jueves 6 de agosto", materiaOriginal: "Biología I · reválida", materia: "Biología I", hora: "8:30 hs", modalidad: "Presencial", idZoom: "", acceso: "", tipo: "revalida" },
        { id: "r-2", dia: "Jueves 6 de agosto", materiaOriginal: "Biología I y II · actualización", materia: "Biología I y II", hora: "8:30 hs", modalidad: "Zoom", idZoom: "9534 4051 462", acceso: "actual26", tipo: "actualizacion" },
        { id: "r-3", dia: "Viernes 7 de agosto", materiaOriginal: "Periodoncia B I", materia: "Periodoncia B I", hora: "8:30 hs", modalidad: "Zoom", idZoom: "374 829 4226", acceso: "602376", tipo: "revalida" }
      ];
    }
  };

  global.OdontoLiveSheets = OdontoLiveSheets;
})(window);
