/* ==========================================================================
   ODONTOCAMPUS — MI CARRERA CON CUENTA
   Quién puede entrar a la sección, y cómo viajan las materias entre este
   navegador y la cuenta.

   --------------------------------------------------------------------------
   POR QUÉ PIDE CUENTA

   Guarda datos de la persona: qué materias aprobó, con qué nota, cuántos
   aplazos. Con cuenta, esos datos la siguen al celular y a la compu, y no
   quedan tirados en una computadora compartida. El resto del sitio sigue
   abierto sin cuenta.

   --------------------------------------------------------------------------
   LA CUENTA MANDA, PERO EL PASILLO NO TIENE SEÑAL

   · La fuente de verdad es la tabla `materias_cursadas`, una fila por materia,
     atada al plan que la persona cursa (`planes_usuario`). El plan en sí está
     en js/planes.js y, con los mismos datos, en la base.
   · Este navegador guarda una copia por usuario, para mostrar el promedio sin
     conexión y para no perder un cambio si se corta el wifi.
   · Cada cambio queda marcado como pendiente hasta que el servidor confirma
     que lo guardó. Si no hay conexión, se reintenta solo, y al volver a
     abrir el sitio lo pendiente se sube antes de traer lo del servidor.
   · Si dos dispositivos cambian la misma materia sin conexión, gana el que
     se conecta último. Pasa poco, y en ese caso se pierde una edición de una
     materia, no el promedio entero.

   --------------------------------------------------------------------------
   LO QUE SE LE DICE A CADA PERSONA

   Está en htmlTerminos(), que es el único lugar con ese texto: lo muestran
   el formulario de registro y el aviso previo a la primera carga. Si se
   cambia, se sube `versionTerminos` en js/config.js y se vuelve a pedir.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.OdontoUI;
  var Api = global.OdontoApi;
  var CONFIG = global.ODONTO_CONFIG;
  var esc = UI.esc;

  var PREFIJO_COPIA = "odontocampus_carrera_v2_";
  var PREFIJO_PENDIENTES = "odontocampus_carrera_pendientes_v2_";
  var PREFIJO_PLAN = "odontocampus_carrera_plan_";
  var PREFIJO_CURSOS = "odontocampus_carrera_cursos_v1_";
  /* Los cursos comparten la lista de pendientes con las materias. Una materia
     es un código de cinco caracteres; un curso se anota con este prefijo y su
     id, así no hay forma de confundirlos. */
  var CLAVE_CURSO = "curso:";
  var UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // Donde la calculadora guardaba las notas antes de que existieran las cuentas.
  var CLAVE_ANTERIOR = "odontocampus_calificaciones_v1";

  var ESTADOS_VALIDOS = { cursando: true, regular: true, aprobada: true };
  var ID_VALIDO = /^[A-Za-z0-9_-]{1,40}$/;
  var RETARDO_GUARDADO = 1200;
  var RETARDO_REINTENTO = 20000;

  function nada() {}

  var PLANES = global.ODONTO_PLANES || { porDefecto: null, planes: {} };

  /** Códigos de materia de un plan, como conjunto. */
  function codigosDe(planId) {
    var plan = PLANES.planes[planId];
    var codigos = {};
    if (plan) plan.materias.forEach(function (m) { codigos[m.codigo] = true; });
    return codigos;
  }

  /**
   * Se queda sólo con lo que existe en el plan.
   *
   * Las copias locales de antes del plan real tienen códigos del plan
   * inventado ("101", "203"). Subirlas fallaría para siempre (la base ya no
   * las acepta) y dejaría el aviso de "No se pudo guardar" clavado.
   */
  function soloDelPlan(mapa, planId) {
    var codigos = codigosDe(planId);
    var limpio = {};
    Object.keys(mapa || {}).forEach(function (id) {
      if (codigos[id] || id.indexOf(CLAVE_CURSO) === 0) limpio[id] = mapa[id];
    });
    return limpio;
  }

  /** Un id nuevo para un curso. Lo genera el navegador: así se puede cargar
      sin conexión y subir después sin que se duplique. */
  function nuevoId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    var b = new Uint8Array(16);
    global.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  /**
   * Deja un curso con la forma que acepta la base, o null si no sirve.
   * Las mismas reglas que complementarias_cursadas (004): nombre de 2 a 160
   * caracteres, de 1 a 400 horas, nota opcional, fecha opcional.
   */
  function normalizarCurso(curso) {
    if (!curso) return null;
    var nombre = String(curso.nombre || "").replace(/\s+/g, " ").trim().slice(0, 160);
    var horas = parseInt(curso.horas, 10);
    var nota = curso.nota === null || curso.nota === "" || curso.nota === undefined ? null : parseFloat(curso.nota);
    var fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(curso.fecha || "")) ? curso.fecha : null;

    if (nombre.length < 2 || !(horas >= 1 && horas <= 400)) return null;
    if (nota !== null && !(nota >= 4 && nota <= 10)) nota = null;
    if (fecha && (fecha < "1950-01-01" || fecha > "2100-01-01")) fecha = null;
    return { nombre: nombre, horas: horas, nota: nota, fecha: fecha };
  }

  function soloCursosValidos(mapa) {
    var limpio = {};
    Object.keys(mapa || {}).forEach(function (id) {
      var curso = normalizarCurso(mapa[id]);
      if (curso && UUID_VALIDO.test(id)) limpio[id] = curso;
    });
    return limpio;
  }

  function leerJSON(clave) {
    try {
      var crudo = localStorage.getItem(clave);
      var datos = crudo ? JSON.parse(crudo) : null;
      return datos && typeof datos === "object" ? datos : {};
    } catch (e) {
      return {};
    }
  }

  function escribirJSON(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
  }

  function quitar(clave) {
    try { localStorage.removeItem(clave); } catch (e) { /* nada que hacer */ }
  }

  /** Deja un registro con la forma que acepta la base, o null si no sirve. */
  function normalizar(registro) {
    if (!registro || !ESTADOS_VALIDOS[registro.estado]) return null;
    var nota = registro.estado === "aprobada" ? parseFloat(registro.nota) : NaN;
    return {
      estado: registro.estado,
      nota: nota >= 4 && nota <= 10 ? nota : null,
      aplazos: Math.min(30, Math.max(0, parseInt(registro.aplazos, 10) || 0)),
      fechaActualizacion: registro.fechaActualizacion || new Date().toISOString()
    };
  }

  function ocupar(boton, texto) {
    if (!boton) return nada;
    var original = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = UI.icono("cargando", "ic-gira") + " " + esc(texto);
    return function () {
      boton.disabled = false;
      boton.innerHTML = original;
    };
  }

  function puerta(icono, titulo, cuerpo) {
    return (
      '<div class="puerta-carrera">' +
        '<span class="puerta-icono" aria-hidden="true">' + UI.icono(icono) + "</span>" +
        "<h3>" + esc(titulo) + "</h3>" +
        cuerpo +
      "</div>"
    );
  }

  var OdontoCarrera = {
    usuarioId: null,
    planId: PLANES.porDefecto,
    cursos: {},
    // Promesa de "el plan ya está anotado en la cuenta", y de quién.
    planAsegurado: null,
    planListo: null,
    notas: {},
    pendientes: {},
    preparado: false,
    cargando: false,
    enVuelo: null,
    otraVuelta: false,
    temporizador: null,
    reintento: null,

    /* ====================================================================
       ARRANQUE Y SESIÓN
       ==================================================================== */
    init: function () {
      var self = this;

      UI.registerActions({
        aceptarTerminos: function (data, el) { self.aceptarTerminos(el); },
        reintentarCarrera: function () { self.preparado = false; self.mostrar(); },
        importarNotasAnteriores: function () { self.importarAnteriores(); },
        descartarNotasAnteriores: function () { self.descartarAnteriores(); }
      });

      var usuario = Api.usuario();
      this.cambiarUsuario(usuario ? usuario.id : null);

      Api.alCambiarSesion(function (sesion) {
        var id = sesion && sesion.usuario ? sesion.usuario.id : null;
        // La sesión también se reescribe al renovar el token: sólo interesa
        // cuando cambia la persona.
        if (id === self.usuarioId) return;
        self.cambiarUsuario(id);
        if (self.visible()) self.mostrar();
      });

      UI.on(global, "online", function () { self.subirPendientes().catch(nada); });

      // Cambios de una visita anterior que no llegaron a subirse.
      if (this.usuarioId && Object.keys(this.pendientes).length) this.programarGuardado(0);
    },

    cambiarUsuario: function (id) {
      this.cancelarTemporizadores();
      this.usuarioId = id;
      this.preparado = false;
      this.cargando = false;
      this.planAsegurado = null;
      this.planListo = null;

      var guardado = null;
      try { guardado = id ? localStorage.getItem(PREFIJO_PLAN + id) : null; } catch (e) { /* modo privado */ }
      this.planId = guardado && PLANES.planes[guardado] ? guardado : PLANES.porDefecto;

      this.notas = id ? soloDelPlan(leerJSON(PREFIJO_COPIA + id), this.planId) : {};
      this.pendientes = id ? soloDelPlan(leerJSON(PREFIJO_PENDIENTES + id), this.planId) : {};
      this.cursos = id ? soloCursosValidos(leerJSON(PREFIJO_CURSOS + id)) : {};
    },

    /** El plan que cursa la persona, con sus materias. */
    plan: function () {
      return PLANES.planes[this.planId] || PLANES.planes[PLANES.porDefecto] || null;
    },

    /**
     * Deja anotado en la cuenta qué plan cursa la persona.
     *
     * Hace falta antes de guardar la primera materia: la base sólo acepta
     * materias de un plan que la cuenta eligió. Si la cuenta ya tiene uno,
     * se usa ese.
     */
    asegurarPlan: function () {
      var self = this;
      var uid = this.usuarioId;
      if (!uid) return Promise.reject(new Error("Sin sesión"));
      if (this.planAsegurado) return this.planAsegurado;

      this.planAsegurado = Api.seleccionar("planes_usuario", "select=plan_id,principal&order=principal.desc")
        .then(function (filas) {
          var elegido = (filas || []).filter(function (f) { return PLANES.planes[f.plan_id]; })[0];
          if (elegido) return elegido.plan_id;
          return Api.guardar("planes_usuario",
            { usuario_id: uid, plan_id: PLANES.porDefecto, principal: true },
            { onConflict: "usuario_id,plan_id", devolver: false }
          ).then(function () { return PLANES.porDefecto; });
        })
        .then(function (planId) {
          if (uid !== self.usuarioId) return planId;
          if (planId !== self.planId) {
            self.planId = planId;
            self.notas = soloDelPlan(self.notas, planId);
            self.pendientes = soloDelPlan(self.pendientes, planId);
          }
          try { localStorage.setItem(PREFIJO_PLAN + uid, planId); } catch (e) { /* modo privado */ }
          self.planListo = uid;
          return planId;
        }, function (error) {
          // Que el próximo intento vuelva a preguntar.
          if (uid === self.usuarioId) self.planAsegurado = null;
          throw error;
        });

      return this.planAsegurado;
    },

    visible: function () {
      var seccion = document.getElementById("seccion-carrera");
      return !!seccion && seccion.classList.contains("active");
    },

    cancelarTemporizadores: function () {
      global.clearTimeout(this.temporizador);
      global.clearTimeout(this.reintento);
    },

    /* ====================================================================
       COPIA LOCAL (la usa js/calculator.js)
       ==================================================================== */
    leerCopia: function () {
      // Copia: la calculadora modifica el objeto que recibe.
      return JSON.parse(JSON.stringify(this.notas));
    },

    escribirCopia: function (notas) {
      if (!this.usuarioId) return;
      this.notas = notas;
      this.persistir();
    },

    persistir: function () {
      if (!this.usuarioId) return;
      escribirJSON(PREFIJO_COPIA + this.usuarioId, this.notas);
      escribirJSON(PREFIJO_PENDIENTES + this.usuarioId, this.pendientes);
      escribirJSON(PREFIJO_CURSOS + this.usuarioId, this.cursos);
    },

    /* ====================================================================
       FORMACIÓN COMPLEMENTARIA (la usa js/calculator.js)
       ==================================================================== */
    leerCursos: function () {
      return JSON.parse(JSON.stringify(this.cursos));
    },

    /**
     * Agrega o corrige un curso. Devuelve el id, o null si los datos no
     * sirven (la calculadora valida antes y explica qué falta).
     */
    guardarCurso: function (id, datos) {
      if (!this.usuarioId) return null;
      var curso = normalizarCurso(datos);
      if (!curso) return null;
      id = id && UUID_VALIDO.test(id) ? id : nuevoId();
      this.cursos[id] = curso;
      this.marcarCursoCambiado(id);
      return id;
    },

    quitarCurso: function (id) {
      if (!this.usuarioId || !this.cursos[id]) return;
      delete this.cursos[id];
      this.marcarCursoCambiado(id);
    },

    marcarCursoCambiado: function (id) {
      this.pendientes[CLAVE_CURSO + id] = true;
      this.persistir();
      this.pintarEstado("pendiente");
      this.programarGuardado(RETARDO_GUARDADO);
    },

    /**
     * Se llama al cerrar sesión o eliminar la cuenta. No cambia de usuario:
     * eso lo hace el aviso de sesión cuando la sesión se cierra de verdad.
     */
    limpiarLocal: function (id) {
      quitar(PREFIJO_COPIA + id);
      quitar(PREFIJO_PENDIENTES + id);
      quitar(PREFIJO_PLAN + id);
      quitar(PREFIJO_CURSOS + id);
      if (this.usuarioId === id) {
        this.cancelarTemporizadores();
        this.notas = {};
        this.cursos = {};
        this.pendientes = {};
        this.preparado = false;
      }
    },

    /* ====================================================================
       QUÉ SE VE EN LA SECCIÓN
       ==================================================================== */
    mostrar: function () {
      if (!document.getElementById("carrera-acceso")) return;

      if (!Api.hayBackend()) { this.pintarAcceso("sin-backend"); return; }
      if (!this.usuarioId) { this.pintarAcceso("sin-sesion"); return; }
      if (this.preparado) { this.abrirPanel(); return; }
      if (!this.cargando) this.preparar();
    },

    preparar: function () {
      var self = this;
      var uid = this.usuarioId;

      this.cargando = true;
      this.pintarAcceso("cargando");

      var consulta = "select=id&tipo=eq.terminos&revocado_at=is.null&limit=1" +
                     "&version_texto=eq." + encodeURIComponent(CONFIG.versionTerminos);

      Api.seleccionar("consentimientos", consulta)
        .then(function (filas) {
          if (uid !== self.usuarioId) return;
          if (!filas || !filas.length) {
            // Cuentas creadas antes de este texto, o si el texto cambió.
            self.cargando = false;
            self.pintarAcceso("terminos");
            return;
          }
          return self.traer(uid);
        })
        .catch(function (error) {
          if (uid !== self.usuarioId) return;
          self.cargando = false;

          // Sin conexión pero con la copia de la última visita: se muestra igual.
          if (!error.estado && Object.keys(self.notas).length) {
            self.preparado = true;
            self.abrirPanel();
            self.pintarEstado("sin-conexion");
            return;
          }
          self.pintarAcceso("error", error.message);
        });
    },

    traer: function (uid) {
      var self = this;

      return this.asegurarPlan()
        .then(function () {
          // Primero se sube lo pendiente: si no, lo del servidor lo taparía.
          return self.subirPendientes().catch(nada);
        })
        .then(function () {
          var plan = "&plan_id=eq." + encodeURIComponent(self.planId);
          return Promise.all([
            Api.seleccionar("materias_cursadas", "select=materia_id,estado,nota,aplazos,actualizado_at" + plan),
            Api.seleccionar("complementarias_cursadas", "select=id,nombre,horas,nota,fecha" + plan)
          ]);
        })
        .then(function (respuestas) {
          if (uid !== self.usuarioId) return;
          var filas = respuestas[0];

          var cursos = {};
          (respuestas[1] || []).forEach(function (fila) {
            var curso = normalizarCurso({
              nombre: fila.nombre, horas: fila.horas,
              nota: fila.nota === null ? null : Number(fila.nota), fecha: fila.fecha
            });
            if (curso) cursos[fila.id] = curso;
          });

          var notas = {};
          (filas || []).forEach(function (fila) {
            notas[fila.materia_id] = {
              estado: fila.estado,
              nota: fila.nota === null ? null : Number(fila.nota),
              aplazos: fila.aplazos || 0,
              fechaActualizacion: fila.actualizado_at
            };
          });

          // Lo que no se pudo subir es lo último que tocó la persona: manda.
          Object.keys(self.pendientes).forEach(function (id) {
            if (id.indexOf(CLAVE_CURSO) === 0) {
              var cursoId = id.slice(CLAVE_CURSO.length);
              if (self.cursos[cursoId]) cursos[cursoId] = self.cursos[cursoId];
              else delete cursos[cursoId];
              return;
            }
            if (self.notas[id]) notas[id] = self.notas[id];
            else delete notas[id];
          });

          self.notas = notas;
          self.cursos = cursos;
          self.persistir();
          self.cargando = false;
          self.preparado = true;
          if (self.visible()) self.abrirPanel();
        });
    },

    abrirPanel: function () {
      var acceso = document.getElementById("carrera-acceso");
      var panel = document.getElementById("panel-promedio");
      if (acceso) { acceso.hidden = true; acceso.innerHTML = ""; acceso.removeAttribute("aria-busy"); }
      if (panel) panel.hidden = false;

      if (global.OdontoCalculator) global.OdontoCalculator.renderTabla();
      this.pintarAnteriores();
      this.pintarEstado(Object.keys(this.pendientes).length ? "pendiente" : "guardado");
    },

    /* ====================================================================
       CONSENTIMIENTO
       ==================================================================== */
    htmlTerminos: function () {
      return (
        '<ul class="check-list lista-terminos">' +
          '<li><svg class="ic" aria-hidden="true"><use href="#ic-base-datos"></use></svg><span>' +
            "<strong>Qué se guarda:</strong> tu nombre, tu correo y las materias, notas y " +
            "aplazos que cargues.</span></li>" +
          '<li><svg class="ic" aria-hidden="true"><use href="#ic-diana"></use></svg><span>' +
            "<strong>Para qué:</strong> sólo para mostrarte tu promedio y tu avance. No se usa " +
            "para estadísticas, rankings ni nada más.</span></li>" +
          '<li><svg class="ic" aria-hidden="true"><use href="#ic-ojo-tachado"></use></svg><span>' +
            "<strong>Quién lo ve:</strong> vos. Otros estudiantes no pueden verlo. Quien administra " +
            "el servidor técnicamente puede acceder a la base, como en cualquier sitio.</span></li>" +
          '<li><svg class="ic" aria-hidden="true"><use href="#ic-descargar"></use></svg><span>' +
            "<strong>Es tuyo:</strong> desde Mi cuenta podés descargar todo o eliminar la cuenta " +
            "cuando quieras (Ley 25.326).</span></li>" +
        "</ul>"
      );
    },

    aceptarTerminos: function (boton) {
      var self = this;
      var uid = this.usuarioId;
      if (!uid) return;

      var liberar = ocupar(boton, "Guardando…");

      Api.insertar("consentimientos", {
        usuario_id: uid,
        tipo: "terminos",
        version_texto: CONFIG.versionTerminos
      }).then(function () {
        if (uid === self.usuarioId) self.preparar();
      }, function (error) {
        liberar();
        UI.toast(error.message, "danger");
      });
    },

    /* ====================================================================
       GUARDAR EN LA CUENTA
       ==================================================================== */
    /** La calculadora avisa acá cada vez que cambia una materia. */
    marcarCambio: function (materiaId) {
      if (!this.usuarioId || !ID_VALIDO.test(materiaId)) return;
      this.pendientes[materiaId] = true;
      this.persistir();
      this.pintarEstado("pendiente");
      // Se agrupa: cargar veinte materias seguidas no son veinte pedidos.
      this.programarGuardado(RETARDO_GUARDADO);
    },

    programarGuardado: function (retardo) {
      var self = this;
      global.clearTimeout(this.temporizador);
      this.temporizador = global.setTimeout(function () {
        self.subirPendientes().catch(nada);
      }, retardo);
    },

    subirPendientes: function () {
      var self = this;
      var uid = this.usuarioId;

      if (!uid || !Api.haySesion()) return Promise.resolve();
      if (this.enVuelo) { this.otraVuelta = true; return this.enVuelo; }
      if (!Object.keys(this.pendientes).length) return Promise.resolve();

      // Antes de la primera materia, el plan tiene que estar en la cuenta.
      if (this.planListo !== uid) {
        return this.asegurarPlan().then(function () {
          return self.subirPendientes();
        }, function (error) {
          self.pintarEstado(error.estado ? "error" : "sin-conexion", error.message);
          throw error;
        });
      }

      var planId = this.planId;
      var ids = Object.keys(this.pendientes);

      var foto = {};
      var filas = [];
      var bajas = [];
      var filasCursos = [];
      var bajasCursos = [];

      /* Lo que se guarda de cada clave pendiente, para comparar después: una
         materia o un curso. */
      function valorDe(clave) {
        return clave.indexOf(CLAVE_CURSO) === 0
          ? self.cursos[clave.slice(CLAVE_CURSO.length)] || null
          : self.notas[clave] || null;
      }

      ids.forEach(function (id) {
        foto[id] = JSON.stringify(valorDe(id));

        if (id.indexOf(CLAVE_CURSO) === 0) {
          var cursoId = id.slice(CLAVE_CURSO.length);
          if (!UUID_VALIDO.test(cursoId)) { delete self.pendientes[id]; return; }
          var curso = normalizarCurso(self.cursos[cursoId]);
          if (curso) {
            filasCursos.push({
              id: cursoId, usuario_id: uid, plan_id: planId,
              nombre: curso.nombre, horas: curso.horas, nota: curso.nota, fecha: curso.fecha
            });
          } else {
            bajasCursos.push(cursoId);
          }
          return;
        }

        var registro = normalizar(self.notas[id]);
        if (registro) {
          filas.push({
            usuario_id: uid,
            plan_id: planId,
            materia_id: id,
            estado: registro.estado,
            nota: registro.nota,
            aplazos: registro.aplazos
          });
        } else {
          // Pendiente, o sin datos válidos: en la base es no tener fila.
          bajas.push(id);
        }
      });

      var pasos = [];
      if (filas.length) {
        pasos.push(Api.guardar("materias_cursadas", filas, {
          onConflict: "usuario_id,plan_id,materia_id",
          devolver: false
        }));
      }
      if (bajas.length) {
        pasos.push(Api.borrar("materias_cursadas",
          "usuario_id=eq." + encodeURIComponent(uid) +
          "&plan_id=eq." + encodeURIComponent(planId) +
          "&materia_id=in.(" + bajas.map(function (id) { return encodeURIComponent('"' + id + '"'); }).join(",") + ")"));
      }
      if (filasCursos.length) {
        pasos.push(Api.guardar("complementarias_cursadas", filasCursos, {
          onConflict: "id",
          devolver: false
        }));
      }
      if (bajasCursos.length) {
        pasos.push(Api.borrar("complementarias_cursadas",
          "usuario_id=eq." + encodeURIComponent(uid) +
          "&id=in.(" + bajasCursos.join(",") + ")"));
      }

      this.pintarEstado("guardando");

      this.enVuelo = Promise.all(pasos).then(function () {
        self.enVuelo = null;
        if (uid !== self.usuarioId) return;

        /* Sólo deja de estar pendiente lo que no cambió mientras viajaba. Si
           la persona tocó otra vez la misma materia, se vuelve a subir. */
        Object.keys(foto).forEach(function (id) {
          if (JSON.stringify(valorDe(id)) === foto[id]) delete self.pendientes[id];
        });
        self.persistir();
        global.clearTimeout(self.reintento);

        if (self.otraVuelta || Object.keys(self.pendientes).length) {
          self.otraVuelta = false;
          self.pintarEstado("pendiente");
          self.programarGuardado(RETARDO_GUARDADO);
        } else {
          self.pintarEstado("guardado");
        }
      }, function (error) {
        self.enVuelo = null;
        self.otraVuelta = false;
        if (uid !== self.usuarioId) throw error;

        global.clearTimeout(self.reintento);
        var sinConexion = !error.estado;
        // Un rechazo de la base (un tope, un dato inválido) no se arregla
        // reintentando. La falta de conexión o un servidor caído, sí.
        var reintentable = sinConexion || error.estado >= 500 || error.estado === 429 || error.estado === 401;

        self.pintarEstado(sinConexion ? "sin-conexion" : "error", error.message);
        if (reintentable) {
          self.reintento = global.setTimeout(function () {
            self.subirPendientes().catch(nada);
          }, RETARDO_REINTENTO);
        }
        throw error;
      });

      return this.enVuelo;
    },

    /** "Borrar mis notas": en la cuenta y en este navegador. */
    borrarTodo: function () {
      var self = this;
      var uid = this.usuarioId;
      if (!uid) return Promise.resolve();

      this.cancelarTemporizadores();

      return (this.enVuelo || Promise.resolve())
        .catch(nada)
        .then(function () {
          var filtro = "usuario_id=eq." + encodeURIComponent(uid) +
                       "&plan_id=eq." + encodeURIComponent(self.planId);
          return Promise.all([
            Api.borrar("materias_cursadas", filtro),
            Api.borrar("complementarias_cursadas", filtro)
          ]);
        })
        .then(function () {
          if (uid !== self.usuarioId) return;
          self.notas = {};
          self.cursos = {};
          self.pendientes = {};
          self.persistir();
          if (global.OdontoCalculator) global.OdontoCalculator.renderTabla();
          self.pintarEstado("guardado");
          UI.toast("Listo: se borraron tus materias y tus cursos", "success");
        }, function (error) {
          UI.toast(error.message, "danger");
          if (Object.keys(self.pendientes).length) self.programarGuardado(RETARDO_GUARDADO);
        });
    },

    /**
     * Antes de cerrar sesión: intenta subir lo pendiente. Si no puede,
     * pregunta, porque al salir la copia local se borra.
     * @returns {Promise<boolean>} true si se puede salir
     */
    antesDeSalir: function () {
      var self = this;
      this.cancelarTemporizadores();
      if (!Object.keys(this.pendientes).length) return Promise.resolve(true);

      function preguntar() {
        return global.confirm(
          "Hay cambios en tu carrera que todavía no se guardaron en tu cuenta " +
          "(parece que no hay conexión).\n\n" +
          "Si cerrás sesión ahora, esos cambios se pierden. ¿Cerrar sesión igual?"
        );
      }

      return this.subirPendientes().then(function () {
        return !Object.keys(self.pendientes).length || preguntar();
      }, preguntar);
    },

    pintarEstado: function (estado, detalle) {
      var el = document.getElementById("estado-guardado");
      if (!el) return;

      var textos = {
        guardado: ["tilde-circulo", "Guardado en tu cuenta"],
        pendiente: ["lapiz", "Cambios sin guardar"],
        guardando: ["cargando", "Guardando…"],
        "sin-conexion": ["wifi", "Sin conexión · se guarda cuando vuelva"],
        error: ["alerta", "No se pudo guardar"]
      };
      var t = textos[estado] || textos.guardado;
      var texto = t[1] + (estado === "error" && detalle ? ": " + detalle : "");

      // Prefijo "es-": con "estado-" el estado "guardado" repetiría la clase base.
      el.className = "estado-guardado es-" + estado;
      el.innerHTML = UI.icono(t[0], estado === "guardando" ? "ic-gira" : "") +
                     "<span>" + esc(texto) + "</span>";

      // Sólo se anuncia lo que pide atención; "Guardando…" en cada cambio sería ruido.
      if (estado === "error" || estado === "sin-conexion") UI.announce(texto);
    },

    /* ====================================================================
       NOTAS DE ANTES DE LAS CUENTAS
       La calculadora guardaba todo en este navegador, sin cuenta. Quien la
       usó no tiene por qué volver a cargar veinte materias.
       ==================================================================== */
    notasAnteriores: function () {
      var crudo = leerJSON(CLAVE_ANTERIOR);
      var validas = {};
      Object.keys(crudo).forEach(function (id) {
        var registro = normalizar(crudo[id]);
        if (registro && ID_VALIDO.test(id)) validas[id] = registro;
      });
      // Las de antes de las cuentas son del plan inventado: no queda ninguna
      // que coincida, y el aviso desaparece solo.
      return soloDelPlan(validas, this.planId);
    },

    pintarAnteriores: function () {
      var cont = document.getElementById("carrera-anteriores");
      if (!cont) return;

      var cantidad = Object.keys(this.notasAnteriores()).length;
      if (!cantidad) {
        quitar(CLAVE_ANTERIOR);
        cont.hidden = true;
        cont.innerHTML = "";
        return;
      }

      cont.hidden = false;
      cont.innerHTML =
        '<div class="callout callout-info">' +
          '<svg class="ic" aria-hidden="true"><use href="#ic-archivo"></use></svg>' +
          "<div>" +
            "<h3>Encontramos " + esc(UI.plural(cantidad, "materia")) +
              (cantidad === 1 ? " cargada" : " cargadas") + " en este navegador</h3>" +
            "<p>Son de antes de que Mi carrera usara cuentas. ¿Las pasamos a la tuya? " +
            "Si una materia ya está en tu cuenta, queda la de tu cuenta.</p>" +
            '<div class="acciones-inline">' +
              '<button type="button" class="btn btn-magenta btn-sm" data-action="importarNotasAnteriores">' +
                '<svg class="ic" aria-hidden="true"><use href="#ic-subir"></use></svg> Pasarlas a mi cuenta' +
              "</button>" +
              '<button type="button" class="btn btn-secondary btn-sm" data-action="descartarNotasAnteriores">' +
                "Descartarlas" +
              "</button>" +
            "</div>" +
          "</div>" +
        "</div>";
    },

    importarAnteriores: function () {
      var self = this;
      if (!this.usuarioId) return;

      var anteriores = this.notasAnteriores();
      var sumadas = 0;
      Object.keys(anteriores).forEach(function (id) {
        if (self.notas[id]) return;
        self.notas[id] = anteriores[id];
        self.pendientes[id] = true;
        sumadas++;
      });

      quitar(CLAVE_ANTERIOR);
      this.persistir();
      this.pintarAnteriores();
      if (global.OdontoCalculator) global.OdontoCalculator.renderTabla();

      if (sumadas) {
        UI.toast("Pasamos " + UI.plural(sumadas, "materia") + " a tu cuenta", "success");
        this.subirPendientes().catch(nada);
      } else {
        UI.toast("Esas materias ya estaban en tu cuenta", "info");
      }
    },

    descartarAnteriores: function () {
      if (!global.confirm(
        "Se borran de este navegador las materias de antes.\n\n" +
        "Las de tu cuenta no se tocan. ¿Seguimos?"
      )) return;

      quitar(CLAVE_ANTERIOR);
      this.pintarAnteriores();
      UI.toast("Listo, se descartaron", "info");
    },

    /* ====================================================================
       PANTALLAS PREVIAS AL PROMEDIO
       ==================================================================== */
    pintarAcceso: function (estado, detalle) {
      var acceso = document.getElementById("carrera-acceso");
      var panel = document.getElementById("panel-promedio");
      if (!acceso) return;

      if (panel) panel.hidden = true;
      acceso.hidden = false;
      if (estado === "cargando") acceso.setAttribute("aria-busy", "true");
      else acceso.removeAttribute("aria-busy");

      var html = "";

      if (estado === "sin-backend") {
        html = puerta("herramientas", "Mi carrera todavía no está disponible",
          '<p class="puerta-lead">Estamos terminando de preparar las cuentas. Mientras tanto, ' +
          "mesas, reválidas y el resto del sitio funcionan como siempre.</p>");
      } else if (estado === "sin-sesion") {
        html = puerta("birrete", "Tu carrera, guardada en tu cuenta",
          '<p class="puerta-lead">Cargá tus materias una sola vez y mirá tu promedio desde el ' +
          "celular o la compu, cuando quieras.</p>" +
          '<ul class="check-list">' +
            '<li><svg class="ic" aria-hidden="true"><use href="#ic-calculadora"></use></svg>' +
              "<span>Promedio con y sin aplazos, calculado como lo hace la UNLP</span></li>" +
            '<li><svg class="ic" aria-hidden="true"><use href="#ic-celular"></use></svg>' +
              "<span>Tus materias te siguen a cualquier dispositivo</span></li>" +
            '<li><svg class="ic" aria-hidden="true"><use href="#ic-candado"></use></svg>' +
              "<span>Otros estudiantes no pueden ver tus notas</span></li>" +
          "</ul>" +
          '<div class="puerta-acciones">' +
            '<button type="button" class="btn btn-magenta btn-lg" data-action="abrirAcceso" data-vista="registro">' +
              '<svg class="ic" aria-hidden="true"><use href="#ic-persona-mas"></use></svg> Crear mi cuenta' +
            "</button>" +
            '<button type="button" class="btn btn-secondary btn-lg" data-action="abrirAcceso" data-vista="ingresar">' +
              "Ya tengo cuenta" +
            "</button>" +
          "</div>" +
          '<p class="puerta-nota">Mesas, reválidas, historias clínicas y biblioteca siguen ' +
          "abiertas sin cuenta.</p>");
      } else if (estado === "cargando") {
        html =
          '<div class="puerta-carrera puerta-cargando">' +
            UI.icono("cargando", "ic-gira") +
            "<p>Trayendo tus materias…</p>" +
          "</div>";
      } else if (estado === "terminos") {
        html = puerta("escudo", "Antes de cargar tus materias",
          '<p class="puerta-lead">Queremos que sepas exactamente qué pasa con lo que cargás.</p>' +
          this.htmlTerminos() +
          '<div class="puerta-acciones">' +
            '<button type="button" class="btn btn-magenta btn-lg" data-action="aceptarTerminos">' +
              "Entendido, empezar" +
            "</button>" +
          "</div>" +
          '<p class="puerta-nota">Si no estás de acuerdo, no pasa nada: el resto del sitio sigue ' +
          "abierto, y podés eliminar tu cuenta desde <strong>Mi cuenta</strong>.</p>");
      } else {
        html = puerta("enchufe", "No pudimos traer tus materias",
          '<p class="puerta-lead">' + esc(detalle || "Algo salió mal.") + "</p>" +
          '<div class="puerta-acciones">' +
            '<button type="button" class="btn btn-magenta" data-action="reintentarCarrera">' +
              '<svg class="ic" aria-hidden="true"><use href="#ic-rotar"></use></svg> Probar de nuevo' +
            "</button>" +
          "</div>");
      }

      acceso.innerHTML = html;
    }
  };

  global.OdontoCarrera = OdontoCarrera;
})(window);
