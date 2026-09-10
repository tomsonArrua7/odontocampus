/* ==========================================================================
   ODONTOCAMPUS — CLIENTE DE LA API
   Transporte contra Supabase: sesión, renovación de token y llamadas REST.

   --------------------------------------------------------------------------
   POR QUÉ NO USAMOS supabase-js

   Sólo necesitamos cinco endpoints de autenticación y unas pocas consultas
   REST. La biblioteca oficial pesa más de 100 KB, obliga a depender de un
   CDN externo y agrega una capa que hay que aprender aparte.

   Escribirlo a mano son doscientas líneas legibles, sin dependencias, sin
   paso de compilación y sin nada que se rompa el día que un CDN cambie. Va
   en línea con el resto del proyecto: todo lo que hay acá se puede leer y
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
      cuerpo: { refresh_token: sesion.refresh_token },
      sinAuth: true
    })
      .then(function (datos) {
        var nueva = normalizarSesion(datos);
        guardarSesion(nueva);
        return nueva.access_token;
      })
      .catch(function (error) {
        /* El refresh token venció o fue revocado: no hay vuelta atrás,
           hay que volver a iniciar sesión. */
        console.warn("[OdontoCampus] No se pudo renovar la sesión:", error);
        guardarSesion(null);
        return null;
      })
      .then(function (token) {
        renovacionEnCurso = null;
        return token;
      });

    return renovacionEnCurso;
  }

  /* ------------------------------------------------------------------------
     PETICIONES
     --------------------------------------------------------------------- */
  function mensajeDeError(estado, cuerpo) {
    var texto = (cuerpo && (cuerpo.error_description || cuerpo.msg ||
                            cuerpo.message || cuerpo.error)) || "";

    // Traducimos lo que la gente puede llegar a ver.
    if (/rate limit|too many/i.test(texto) || estado === 429) {
      return "Demasiados intentos. Esperá unos minutos antes de volver a probar.";
    }
    if (/expired|invalid.*token|otp/i.test(texto)) {
      return "El código venció o no es correcto. Pedí uno nuevo.";
    }
    if (/email/i.test(texto) && /invalid/i.test(texto)) {
      return "Revisá la dirección de correo.";
    }
    if (estado === 401 || estado === 403) {
      return "No tenés permiso para esto. Probá iniciar sesión de nuevo.";
    }
    if (estado >= 500) {
      return "El servidor no está respondiendo. Probá en unos minutos.";
    }
    return texto || "Algo salió mal (" + estado + ").";
  }

  function pedir(ruta, opciones) {
    opciones = opciones || {};

    var cabeceras = {
      "apikey": CONFIG.anonKey,
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
          var error = new Error(mensajeDeError(respuesta.status, datos));
          error.estado = respuesta.status;
          error.cuerpo = datos;
          throw error;
        }
        return datos;
      });
    }, function () {
      throw new Error("Sin conexión con el servidor. Revisá tu internet.");
    });
  }

  /** Como pedir(), pero con el token puesto y reintento si venció. */
  function pedirAutenticado(ruta, opciones) {
    opciones = opciones || {};

    return ensureToken().then(function (token) {
      if (!token) throw new Error("Necesitás iniciar sesión.");

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
     --------------------------------------------------------------------- */
  function solicitarCodigo(email) {
    return pedir("/auth/v1/otp", {
      metodo: "POST",
      cuerpo: { email: String(email).trim().toLowerCase(), create_user: true }
    });
  }

  function verificarCodigo(email, codigo) {
    return pedir("/auth/v1/verify", {
      metodo: "POST",
      cuerpo: {
        email: String(email).trim().toLowerCase(),
        token: String(codigo).trim(),
        type: "email"
      }
    }).then(function (datos) {
      guardarSesion(normalizarSesion(datos));
      return datos.user;
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

  /** Inserta o actualiza según la clave primaria. */
  function guardar(tabla, fila, opciones) {
    opciones = opciones || {};
    return pedirAutenticado("/rest/v1/" + tabla, {
      metodo: "POST",
      cuerpo: fila,
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
      cabeceras: { "Prefer": "return=representation" }
    });
  }

  function actualizar(tabla, consulta, cambios) {
    return pedirAutenticado("/rest/v1/" + tabla + "?" + consulta, {
      metodo: "PATCH",
      cuerpo: cambios,
      cabeceras: { "Prefer": "return=representation" }
    });
  }

  function borrar(tabla, consulta) {
    return pedirAutenticado("/rest/v1/" + tabla + "?" + consulta, { metodo: "DELETE" });
  }

  global.OdontoApi = {
    hayBackend: function () { return CONFIG.hayBackend(); },
    haySesion: haySesion,
    usuario: usuario,
    alCambiarSesion: alCambiarSesion,
    avisarCambio: avisarCambio,

    solicitarCodigo: solicitarCodigo,
    verificarCodigo: verificarCodigo,
    cerrarSesion: cerrarSesion,

    seleccionar: seleccionar,
    guardar: guardar,
    insertar: insertar,
    actualizar: actualizar,
    borrar: borrar,
    pedirAutenticado: pedirAutenticado
  };
})(window);
