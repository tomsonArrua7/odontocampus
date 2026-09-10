/* ==========================================================================
   ODONTOCAMPUS — PERMUTAS DE COMISIÓN
   Tablón para coordinar cambios de comisión entre estudiantes.

   Este módulo ya existía en el proyecto pero nunca se había enlazado: no había
   sección en la página ni etiqueta <script> que lo cargara. Acá queda
   conectado, con formulario propio y validación.

   Aviso importante para quien mantenga esto: las publicaciones se guardan en
   el navegador de cada persona (localStorage). Nadie más las ve. Es un
   borrador funcional; para que la permuta sirva de verdad hace falta un
   backend compartido. Mientras tanto, la interfaz lo dice explícitamente en
   vez de aparentar una red que no existe.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var esc = UI.esc, escAttr = UI.escAttr;

  var OdontoPermutas = {
    storageKey: "odontocampus_permutas_v1",

    /* ====================================================================
       DATOS
       ==================================================================== */
    getPermutas: function () {
      try {
        var data = localStorage.getItem(this.storageKey);
        if (data) return JSON.parse(data);
      } catch (e) {
        console.error("[OdontoCampus] No se pudieron leer las permutas:", e);
      }
      var iniciales = (global.ODONTO_DATA && global.ODONTO_DATA.permutasIniciales) || [];
      this.guardarPermutas(iniciales);
      return iniciales;
    },

    guardarPermutas: function (lista) {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(lista));
      } catch (e) {
        UI.toast("No pudimos guardar la publicación en este navegador.", "warning");
      }
    },

    crearPermuta: function (datos) {
      var permutas = this.getPermutas();

      permutas.unshift({
        id: "perm-" + Date.now(),
        estudiante: datos.estudiante,
        materia: datos.materia,
        anio: datos.anio,
        comisionActual: datos.comisionActual,
        comisionDeseada: datos.comisionDeseada,
        motivo: datos.motivo || "",
        contactoWhatsapp: String(datos.contactoWhatsapp || "").replace(/\D/g, ""),
        fechaPublicacion: "Recién publicada",
        estado: "Disponible",
        esPropia: true
      });

      this.guardarPermutas(permutas);
      this.render();
      UI.toast("Tu permuta quedó publicada en este dispositivo", "success");
    },

    eliminarPermuta: function (id) {
      if (!global.confirm("¿Querés borrar esta publicación? No se puede deshacer.")) return;

      var restantes = this.getPermutas().filter(function (p) { return p.id !== id; });
      this.guardarPermutas(restantes);
      this.render();
      UI.toast("Publicación eliminada", "info");
    },

    /* ====================================================================
       INTERFAZ
       ==================================================================== */
    init: function () {
      var self = this;

      UI.registerActions({
        abrirNuevaPermuta: function () { UI.openModal("modal-permuta", "#permuta-estudiante"); },
        cerrarPermuta: function () { UI.closeModal("modal-permuta"); },
        eliminarPermuta: function (data) { self.eliminarPermuta(data.id); }
      });

      var filtroAnio = document.getElementById("permutas-filter-anio");
      var busqueda = document.getElementById("permutas-search-input");

      if (filtroAnio) UI.on(filtroAnio, "change", function () { self.render(); });
      if (busqueda) UI.on(busqueda, "input", UI.debounce(function () { self.render(); }));

      var form = document.getElementById("form-permuta");
      if (form) UI.on(form, "submit", function (event) { self.alEnviarFormulario(event, form); });

      this.render();
    },

    alEnviarFormulario: function (event, form) {
      event.preventDefault();

      function valor(id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : "";
      }

      var datos = {
        estudiante: valor("permuta-estudiante"),
        materia: valor("permuta-materia"),
        anio: valor("permuta-anio"),
        comisionActual: valor("permuta-actual"),
        comisionDeseada: valor("permuta-deseada"),
        motivo: valor("permuta-motivo"),
        contactoWhatsapp: valor("permuta-contacto")
      };

      var faltantes = ["estudiante", "materia", "comisionActual", "comisionDeseada", "contactoWhatsapp"]
        .filter(function (campo) { return !datos[campo]; });

      if (faltantes.length) {
        UI.toast("Faltan datos para publicar la permuta", "warning");
        var primero = document.getElementById("permuta-" + (faltantes[0] === "contactoWhatsapp" ? "contacto" : "estudiante"));
        if (primero) primero.focus();
        return;
      }

      var telefono = datos.contactoWhatsapp.replace(/\D/g, "");
      if (telefono.length < 8) {
        UI.toast("Revisá el número de WhatsApp: parece incompleto", "warning");
        var tel = document.getElementById("permuta-contacto");
        if (tel) tel.focus();
        return;
      }

      this.crearPermuta(datos);
      form.reset();
      UI.closeModal("modal-permuta");
    },

    render: function () {
      var cont = document.getElementById("permutas-grid");
      if (!cont) return;

      var filtroAnio = document.getElementById("permutas-filter-anio");
      var busqueda = document.getElementById("permutas-search-input");
      var anio = filtroAnio ? filtroAnio.value : "todos";
      var q = UI.normalizar(busqueda ? busqueda.value : "");

      var lista = this.getPermutas().filter(function (p) {
        if (anio !== "todos" && String(p.anio).indexOf(anio) === -1) return false;
        if (q) {
          var texto = UI.normalizar(
            p.materia + " " + p.comisionActual + " " + p.comisionDeseada + " " + p.estudiante
          );
          if (texto.indexOf(q) === -1) return false;
        }
        return true;
      });

      var resumen = document.getElementById("permutas-summary");
      if (resumen) {
        resumen.innerHTML = "<b>" + esc(UI.plural(lista.length, "permuta")) + "</b>" +
          " · guardadas solo en este dispositivo";
      }

      if (!lista.length) {
        cont.innerHTML = UI.emptyState({
          icon: "fa-people-arrows",
          title: "Todavía no hay permutas con esos filtros",
          text: "Publicá la tuya: cuando alguien busque el cambio inverso, va a encontrarte.",
          action: "abrirNuevaPermuta",
          actionLabel: "Publicar una permuta"
        });
        return;
      }

      cont.innerHTML = lista.map(function (p) {
        var tel = String(p.contactoWhatsapp || "").replace(/\D/g, "");
        var numero = tel.indexOf("54") === 0 ? tel : "549" + tel;
        var mensaje = encodeURIComponent(
          "Hola " + p.estudiante + "! Vi tu permuta en OdontoCampus (FOE) para " + p.materia + ". ¿Sigue en pie?"
        );
        var enlace = tel ? "https://wa.me/" + numero + "?text=" + mensaje : "";

        return (
          '<article class="permuta-card">' +
            '<div class="permuta-card-header">' +
              '<span class="badge-materia-anio">' + esc(p.anio) + "</span>" +
              '<span class="badge-status status-disponible">' +
                '<span class="status-dot" aria-hidden="true"></span> ' + esc(p.estado || "Disponible") +
              "</span>" +
            "</div>" +

            '<h3 class="permuta-materia">' + esc(p.materia) + "</h3>" +

            '<div class="permuta-details">' +
              '<div class="permuta-box box-actual">' +
                '<p class="box-label"><i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i> Está en</p>' +
                '<p class="box-value">' + esc(p.comisionActual) + "</p>" +
              "</div>" +
              '<p class="permuta-icon-exchange" aria-hidden="true"><i class="fa-solid fa-arrow-down"></i></p>' +
              '<div class="permuta-box box-deseada">' +
                '<p class="box-label"><i class="fa-solid fa-bullseye" aria-hidden="true"></i> Necesita pasar a</p>' +
                '<p class="box-value">' + esc(p.comisionDeseada) + "</p>" +
              "</div>" +
            "</div>" +

            (p.motivo ? '<p class="permuta-motivo">“' + esc(p.motivo) + "”</p>" : "") +

            '<div class="permuta-footer">' +
              '<div class="permuta-author">' +
                '<span class="author-avatar" aria-hidden="true"><i class="fa-solid fa-user-graduate"></i></span>' +
                "<span><strong>" + esc(p.estudiante) + "</strong><small>" + esc(p.fechaPublicacion) + "</small></span>" +
              "</div>" +
              '<div class="permuta-actions">' +
                (enlace
                  ? '<a href="' + UI.safeUrl(enlace) + '" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm">' +
                      '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Escribirle' +
                      '<span class="visually-hidden"> a ' + esc(p.estudiante) + "</span>" +
                    "</a>"
                  : "") +
                (p.esPropia
                  ? '<button type="button" class="btn btn-icon btn-danger-soft" data-action="eliminarPermuta" ' +
                            'data-id="' + escAttr(p.id) + '" aria-label="Borrar mi publicación de ' + escAttr(p.materia) + '">' +
                      '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>' +
                    "</button>"
                  : "") +
              "</div>" +
            "</div>" +
          "</article>"
        );
      }).join("");
    }
  };

  global.OdontoPermutas = OdontoPermutas;
})(window);
