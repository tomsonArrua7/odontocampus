/* ==========================================================================
   ODONTOCAMPUS — CLIENTE DE LA API
   Transporte contra Supabase: sesión, renovación de token y llamadas REST.

   --------------------------------------------------------------------------
   POR QUÉ NO USAMOS supabase-js

   Sólo necesitamos unos pocos endpoints de autenticación y unas pocas
   consultas REST. La biblioteca oficial pesa más de 100 KB, obliga a depender
   de un CDN externo y agrega una capa que hay que aprender aparte.

   Escribirlo a mano son unas trescientas líneas legibles, sin dependencias,
   sin paso de compilación y sin nada que se rompa el día que un CDN cambie.
   Va en línea con el resto del proyecto: todo lo que hay acá se puede leer y
   entender de punta a punta.

   La contra honesta: la renovación de token la mantenemos nosotros. Está
   toda en ensureToken() y es la parte a mirar primero si alguien reporta
   que lo desloguea solo.

   --------------------------------------------------------------------------
   DÓNDE VIVE LA SESIÓN

   En localStorage. No es lo ideal —una cookie httpOnly sería más segura—
   pero eso requiere una capa de servidor que renderice, y el sitio es
   estático. Se compensa con el escapado estricto de todo el frontend, una
   CSP estricta y tokens de vida corta.
   ========================================================================== */
(function (global) {
  "use strict";

  var CONFIG = global.ODONTO_CONFIG;
  var CLAVE_SESION = "odontocampus_sesion_v1";
  var MARGEN_RENOVACION = 60; // segundos antes del vencimiento

  var renovacionEnCurso = null;

  /* ------------------------------------------------------------------------
     SESIÓN
     --------------------------------------------------------------------- */
  function leerSesion() {
    try {
      var crudo = localStorage.getItem(CLAVE_SESION);
      return crudo ? JSON.parse(crudo) : null;
    } catch (e) {
      return null;
    }
  }

  function guardarSesion(datos) {
    try {
      if (!datos) localStorage.removeItem(CLAVE_SESION);
      else localStorage.setItem(CLAVE_SESION, JSON.stringify(datos));
    } catch (e) { /* modo privado */ }
    avisarCambio();
  }

  function normalizarSesion(respuesta) {
    return {
      access_token: respuesta.access_token,
      refresh_token: respuesta.refresh_token,
      // El servidor manda segundos de vigencia; guardamos el instante exacto.
      expira_en: Math.floor(Date.now() / 1000) + (respuesta.expires_in || 3600),
      usuario: respuesta.user || null
    };
  }

  var oyentes = [];
  function alCambiarSesion(fn) { oyentes.push(fn); }
  function avisarCambio() {
    var sesion = leerSesion();
    oyentes.forEach(function (fn) {
      try { fn(sesion); } catch (e) { console.error(e); }
    });
  }

  function usuario() {
    var s = leerSesion();
    return s ? s.usuario : null;
  }

  function haySesion() { return !!leerSesion(); }

  /* ------------------------------------------------------------------------
     TOKEN
     --------------------------------------------------------------------- */
  function ensureToken() {
    var sesion = leerSesion();
    if (!sesion) return Promise.resolve(null);

    var ahora = Math.floor(Date.now() / 1000);
    if (sesion.expira_en - ahora > MARGEN_RENOVACION) {
      return Promise.resolve(sesion.access_token);
    }

    // Una sola renovación en vuelo, aunque la pidan varias llamadas a la vez.
    if (renovacionEnCurso) return renovacionEnCurso;

    renovacionEnCurso = pedir("/auth/v1/token?grant_type=refresh_token", {
      metodo: "POST",
      cuerpo: { refresh_token: sesion.refresh_token }
    })
      .then(function (datos) {
        var nueva = normalizarSesion(datos);
        guardarSesion(nueva);
        return nueva.access_token;
      })
      .catch(function (error) {
        /* Sin conexión, la sesión sigue siendo válida: se reintenta la
           próxima vez. Sólo se cierra si el servidor RESPONDIÓ que el refresh
           token venció o fue revocado. Antes se cerraba ante cualquier falla,
           y quien abría el sitio en el pasillo sin señal quedaba afuera. */
        if (error.estado) {
          console.warn("[OdontoCampus] No se pudo renovar la sesión:", error);
          guardarSesion(null);
        }
        return null;
      })
      .then(function (token) {
        renovacionEnCurso = null;
        return token;
      });

    return renovacionEnCurso;
  }

  /* ------------------------------------------------------------------------
     MENSAJES DE ERROR
     GoTrue manda un `error_code` estable desde la versión 2.150. Se traduce
     por ese código, y por el texto sólo como respaldo. Todo lo que la
     persona puede llegar a leer va en castellano y dice qué hacer.
     --------------------------------------------------------------------- */
  var MENSAJES = {
    invalid_credentials: "El correo o la contraseña no coinciden.",
    email_not_confirmed: "Todavía no confirmaste tu correo.",
    user_already_exists: "Ya hay una cuenta con ese correo. Ingresá o recuperá tu contraseña.",
    email_exists: "Ya hay una cuenta con ese correo. Ingresá o recuperá tu contraseña.",
    same_password: "La contraseña nueva tiene que ser distinta de la anterior.",
    otp_expired: "El enlace venció o ya se usó. Pedí uno nuevo.",
    email_address_invalid: "Revisá la dirección de correo.",
    validation_failed: "Revisá los datos: hay algo que no está bien escrito.",
    signup_disabled: "Por el momento no se pueden crear cuentas nuevas.",
    over_email_send_rate_limit: "Ya te mandamos un correo hace instantes. Esperá un minuto antes de pedir otro.",
    over_request_rate_limit: "Demasiados intentos seguidos. Esperá unos minutos y volvé a probar.",
    session_not_found: "Se cerró tu sesión. Ingresá de nuevo.",
    refresh_token_not_found: "Se cerró tu sesión. Ingresá de nuevo.",
    user_not_found: "Se cerró tu sesión. Ingresá de nuevo."
  };

  function mensajeClaveDebil(cuerpo) {
    var motivos = (cuerpo && cuerpo.weak_password && cuerpo.weak_password.reasons) || [];
    if (motivos.indexOf("pwned") !== -1) {
      return "Esa contraseña aparece en filtraciones de otros sitios: es de las " +
             "primeras que se prueban para entrar a una cuenta. Elegí otra.";
    }
    if (motivos.indexOf("length") !== -1) {
      return "La contraseña necesita al menos " + CONFIG.minLargoClave + " caracteres.";
    }
    return "Esa contraseña es muy fácil de adivinar. Elegí otra.";
  }

  function codigoDeError(estado, cuerpo) {
    var codigo = cuerpo && (cuerpo.error_code || (typeof cuerpo.code === "string" ? cuerpo.code : ""));
    if (codigo) return codigo;

    // Respaldo por texto, para versiones de GoTrue sin error_code.
    var texto = (cuerpo && (cuerpo.error_description || cuerpo.msg ||
                            cuerpo.message || cuerpo.error)) || "";
    if (/invalid login credentials/i.test(texto)) return "invalid_credentials";
    if (/email not confirmed/i.test(texto)) return "email_not_confirmed";
    if (/already registered/i.test(texto)) return "user_already_exists";
    if (/expired|invalid.*(link|otp)/i.test(texto)) return "otp_expired";
    if (/security purposes|rate limit|too many/i.test(texto) || estado === 429) {
      return "over_request_rate_limit";
    }
    return "";
  }

  function mensajeDeError(estado, cuerpo, codigo) {
    if (codigo === "weak_password") return mensajeClaveDebil(cuerpo);
    if (MENSAJES[codigo]) return MENSAJES[codigo];

    // PostgREST: 42501 es un permiso rechazado por la base (RLS o un tope).
    if (codigo === "42501") {
      return (cuerpo && cuerpo.message) || "La base rechazó el cambio.";
    }
    if (estado === 401 || estado === 403) {
      return "No tenés permiso para esto. Probá ingresar de nuevo.";
    }
    if (estado >= 500) {
      return "El servidor no está respondiendo. Probá en unos minutos.";
    }
    var texto = (cuerpo && (cuerpo.error_description || cuerpo.msg ||
                            cuerpo.message || cuerpo.error)) || "";
    return texto || "Algo salió mal (" + estado + ").";
  }

  /* ------------------------------------------------------------------------
     PETICIONES
     --------------------------------------------------------------------- */
  function pedir(ruta, opciones) {
    opciones = opciones || {};

    var cabeceras = {
      "apikey": CONFIG.publishableKey,
      "Content-Type": "application/json"
    };
    Object.keys(opciones.cabeceras || {}).forEach(function (k) {
      cabeceras[k] = opciones.cabeceras[k];
    });

    var inicio = {
      method: opciones.metodo || "GET",
      headers: cabeceras
    };
    if (opciones.cuerpo !== undefined) inicio.body = JSON.stringify(opciones.cuerpo);

    return fetch(CONFIG.apiUrl + ruta, inicio).then(function (respuesta) {
      if (respuesta.status === 204) return null;

      return respuesta.text().then(function (texto) {
        var datos = null;
        if (texto) {
          try { datos = JSON.parse(texto); } catch (e) { datos = { message: texto }; }
        }
        if (!respuesta.ok) {
          var codigo = codigoDeError(respuesta.status, datos);
          var error = new Error(mensajeDeError(respuesta.status, datos, codigo));
          error.estado = respuesta.status;
          error.codigo = codigo;
          error.cuerpo = datos;
          throw error;
        }
        return datos;
      });
    }, function () {
      // Sin `estado`: así se distingue "no hay internet" de "el servidor dijo que no".
      throw new Error("Sin conexión con el servidor. Revisá tu internet.");
    });
  }

  /** Como pedir(), pero con el token puesto y reintento si venció. */
  function pedirAutenticado(ruta, opciones) {
    opciones = opciones || {};

    return ensureToken().then(function (token) {
      if (!token) {
        var sinSesion = new Error(haySesion()
          ? "Sin conexión con el servidor. Revisá tu internet."
          : "Necesitás ingresar a tu cuenta.");
        throw sinSesion;
      }

      var conAuth = Object.assign({}, opciones);
      conAuth.cabeceras = Object.assign({}, opciones.cabeceras, {
        "Authorization": "Bearer " + token
      });

      return pedir(ruta, conAuth).catch(function (error) {
        if (error.estado !== 401) throw error;

        /* Token rechazado pese a parecer vigente (por ejemplo, si el reloj
           del dispositivo está corrido). Forzamos una renovación y
           reintentamos una sola vez. */
        var sesion = leerSesion();
        if (sesion) { sesion.expira_en = 0; guardarSesion(sesion); }

        return ensureToken().then(function (nuevo) {
          if (!nuevo) throw new Error("Se cerró tu sesión. Ingresá de nuevo.");
          conAuth.cabeceras.Authorization = "Bearer " + nuevo;
          return pedir(ruta, conAuth);
        });
      });
    });
  }

  /* ------------------------------------------------------------------------
     AUTENTICACIÓN

     El sitio NUNCA usa /auth/v1/otp ni /auth/v1/magiclink: el ingreso es con
     contraseña, y esas dos rutas están cerradas en el Vhost de la API.
     --------------------------------------------------------------------- */
  function limpiarEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  /**
   * Crear una cuenta. El servidor manda el correo de confirmación.
   *
   * Si el correo ya tiene una cuenta confirmada, Supabase responde igual que
   * si la hubiera creado y no manda nada: así nadie puede averiguar qué
   * correos están registrados probando el formulario. La pantalla siguiente
   * lo tiene en cuenta.
   */
  function registrarse(datos) {
    return pedir("/auth/v1/signup", {
      metodo: "POST",
      cuerpo: {
        email: limpiarEmail(datos.email),
        password: datos.clave,
        data: {
          nombre_visible: String(datos.nombre || "").trim(),
          // La base registra el consentimiento con esta versión al crear la
          // cuenta (003_cuentas_con_contrasena.sql).
          version_terminos: CONFIG.versionTerminos
        }
      }
    }).then(function (respuesta) {
      // Sólo pasa si alguien activa la confirmación automática en el servidor.
      if (respuesta && respuesta.access_token) {
        guardarSesion(normalizarSesion(respuesta));
        return { conSesion: true };
      }
      return { conSesion: false };
    });
  }

  function ingresar(email, clave) {
    return pedir("/auth/v1/token?grant_type=password", {
      metodo: "POST",
      cuerpo: { email: limpiarEmail(email), password: clave }
    }).then(function (datos) {
      guardarSesion(normalizarSesion(datos));
      return datos.user;
    });
  }

  function reenviarConfirmacion(email) {
    return pedir("/auth/v1/resend", {
      metodo: "POST",
      cuerpo: { type: "signup", email: limpiarEmail(email) }
    });
  }

  /** Responde bien exista o no la cuenta: no revela qué correos están registrados. */
  function pedirRecuperacion(email) {
    return pedir("/auth/v1/recover", {
      metodo: "POST",
      cuerpo: { email: limpiarEmail(email) }
    });
  }

  /**
   * Canjea el token de un correo (confirmación o recuperación) por una sesión.
   * @param {"signup"|"recovery"} tipo
   */
  function verificarEnlace(tipo, tokenHash) {
    return pedir("/auth/v1/verify", {
      metodo: "POST",
      cuerpo: { type: tipo, token_hash: tokenHash }
    }).then(function (datos) {
      if (datos && datos.access_token) guardarSesion(normalizarSesion(datos));
      return datos && datos.user;
    });
  }

  function cambiarClave(nueva) {
    return pedirAutenticado("/auth/v1/user", {
      metodo: "PUT",
      cuerpo: { password: nueva }
    }).then(function (usuarioActualizado) {
      var sesion = leerSesion();
      if (sesion && usuarioActualizado) {
        sesion.usuario = usuarioActualizado;
        guardarSesion(sesion);
      }
      return usuarioActualizado;
    });
  }

  function cerrarSesion() {
    var sesion = leerSesion();
    guardarSesion(null);

    if (!sesion) return Promise.resolve();
    // Aviso al servidor para revocar el refresh token. Si falla, no importa:
    // localmente la sesión ya se borró.
    return pedir("/auth/v1/logout", {
      metodo: "POST",
      cabeceras: { "Authorization": "Bearer " + sesion.access_token }
    }).catch(function () { return null; });
  }

  /* ------------------------------------------------------------------------
     REST (PostgREST)
     --------------------------------------------------------------------- */
  function seleccionar(tabla, consulta) {
    return pedirAutenticado("/rest/v1/" + tabla + (consulta ? "?" + consulta : ""));
  }

  /**
   * Inserta o actualiza (una fila o un arreglo de filas).
   * @param {object} opciones  onConflict: columnas de la clave, separadas por coma
   *                           devolver: false para no pedir las filas de vuelta
   */
  function guardar(tabla, filas, opciones) {
    opciones = opciones || {};
    var consulta = opciones.onConflict ? "?on_conflict=" + encodeURIComponent(opciones.onConflict) : "";
    return pedirAutenticado("/rest/v1/" + tabla + consulta, {
      metodo: "POST",
      cuerpo: filas,
      cabeceras: {
        "Prefer": "resolution=merge-duplicates" +
                  (opciones.devolver === false ? ",return=minimal" : ",return=representation")
      }
    });
  }

  function insertar(tabla, fila) {
    return pedirAutenticado("/rest/v1/" + tabla, {
      metodo: "POST",
      cuerpo: fila,
      cabeceras: { "Prefer": "return=minimal" }
    });
  }

  function borrar(tabla, consulta) {
    return pedirAutenticado("/rest/v1/" + tabla + "?" + consulta, { metodo: "DELETE" });
  }

  /** Ejecuta una función de Postgres expuesta por PostgREST. */
  function rpc(nombre, argumentos) {
    return pedirAutenticado("/rest/v1/rpc/" + nombre, {
      metodo: "POST",
      cuerpo: argumentos || {}
    });
  }

  global.OdontoApi = {
    hayBackend: function () { return CONFIG.hayBackend(); },
    haySesion: haySesion,
    usuario: usuario,
    alCambiarSesion: alCambiarSesion,

    registrarse: registrarse,
    ingresar: ingresar,
    reenviarConfirmacion: reenviarConfirmacion,
    pedirRecuperacion: pedirRecuperacion,
    verificarEnlace: verificarEnlace,
    cambiarClave: cambiarClave,
    cerrarSesion: cerrarSesion,

    seleccionar: seleccionar,
    guardar: guardar,
    insertar: insertar,
    borrar: borrar,
    rpc: rpc
  };
})(window);
