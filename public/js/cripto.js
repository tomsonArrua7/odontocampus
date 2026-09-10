/* ==========================================================================
   ODONTOCAMPUS — CIFRADO DE LAS NOTAS
   ==========================================================================

   POR QUÉ EXISTE ESTE ARCHIVO

   FOE es una agrupación política. Un estudiante puede razonablemente temer
   que sus notas —o el hecho de que va atrasado— queden visibles para la
   conducción. Si no resolvemos eso con una garantía verificable, y no solo
   con una promesa en el pie de página, la gente no va a cargar sus notas.
   Y tendría razón.

   Las políticas RLS impiden que un estudiante lea las notas de otro. Pero
   NO alcanzan: la SERVICE_ROLE_KEY y el acceso directo a Postgres saltean
   RLS por completo. Quien administre el servidor podría leer cualquier fila.

   Por eso las notas se cifran ACÁ, en el navegador, antes de salir. El
   servidor guarda un texto opaco.

   --------------------------------------------------------------------------
   EL PROBLEMA DE LA CLAVE, DICHO SIN VUELTAS

   El acceso al sitio es por código enviado al email. No hay contraseña. Y sin
   un secreto que el servidor nunca vea, no hay cifrado de punta a punta
   posible: cualquier clave que el servidor pueda derivar, el servidor la
   puede derivar.

   Así que hace falta una segunda clave, sólo para las notas, que nunca se
   envía a ningún lado.

   La consecuencia es real y hay que decirla de frente en la interfaz:
   SI SE OLVIDA ESA CLAVE, LAS NOTAS SINCRONIZADAS NO SE RECUPERAN. Nadie
   puede recuperarlas: ese es exactamente el punto.

   Por eso sincronizar es opcional. Quien no quiera una clave más, no
   sincroniza y la calculadora le sigue funcionando igual que siempre,
   guardando todo en su dispositivo. Las dos opciones son legítimas y la
   interfaz no empuja hacia ninguna.

   --------------------------------------------------------------------------
   CÓMO

   · Derivación: PBKDF2-HMAC-SHA256, 310.000 iteraciones (recomendación OWASP).
     Tarda entre uno y dos segundos en un celular de gama media. Es a
     propósito: eso mismo es lo que hace cara la fuerza bruta.
   · Cifrado: AES-GCM 256 bits, con vector de inicialización nuevo en cada
     guardado. AES-GCM además autentica: si el texto se alteró, falla al
     descifrar en lugar de devolver basura.
   · La sal es aleatoria por usuario y se guarda en el servidor. No es
     secreta; sirve para que dos personas con la misma clave no produzcan
     el mismo material.
   · La clave derivada se guarda en IndexedDB como CryptoKey NO EXTRAÍBLE:
     el navegador puede usarla para descifrar, pero ni nuestro propio código
     puede leer sus bytes. Así no hay que volver a pedirla en cada recarga.

   Todo con WebCrypto, que viene en el navegador. Sin dependencias.
   ========================================================================== */
(function (global) {
  "use strict";

  var ITERACIONES = 310000;
  var LARGO_SAL = 16;
  var LARGO_IV = 12;      // recomendado para AES-GCM
  var PREFIJO = "v1.";

  var subtle = global.crypto && global.crypto.subtle;

  /* ------------------------------------------------------------------------
     Conversiones
     --------------------------------------------------------------------- */
  function aBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binario = "";
    for (var i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
    return global.btoa(binario);
  }

  function desdeBase64(texto) {
    var binario = global.atob(texto);
    var bytes = new Uint8Array(binario.length);
    for (var i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  }

  /* ------------------------------------------------------------------------
     Derivación
     --------------------------------------------------------------------- */
  function generarSal() {
    return aBase64(global.crypto.getRandomValues(new Uint8Array(LARGO_SAL)));
  }

  /**
   * Convierte la clave escrita por la persona en una clave AES de 256 bits.
   * `extraible: false` hace que ni nuestro código pueda leer sus bytes.
   */
  function derivarClave(fraseSecreta, salBase64) {
    var material = new TextEncoder().encode(fraseSecreta);

    return subtle.importKey("raw", material, { name: "PBKDF2" }, false, ["deriveKey"])
      .then(function (base) {
        return subtle.deriveKey(
          {
            name: "PBKDF2",
            salt: desdeBase64(salBase64),
            iterations: ITERACIONES,
            hash: "SHA-256"
          },
          base,
          { name: "AES-GCM", length: 256 },
          false,                       // no extraíble
          ["encrypt", "decrypt"]
        );
      });
  }

  /* ------------------------------------------------------------------------
     Cifrar y descifrar
     --------------------------------------------------------------------- */
  function cifrar(valor, clave) {
    var iv = global.crypto.getRandomValues(new Uint8Array(LARGO_IV));
    var texto = new TextEncoder().encode(JSON.stringify(valor));

    return subtle.encrypt({ name: "AES-GCM", iv: iv }, clave, texto)
      .then(function (cifrado) {
        // Formato: v1.<base64(iv || textoCifrado)>
        var salida = new Uint8Array(iv.length + cifrado.byteLength);
        salida.set(iv, 0);
        salida.set(new Uint8Array(cifrado), iv.length);
        return PREFIJO + aBase64(salida);
      });
  }

  function descifrar(paquete, clave) {
    if (typeof paquete !== "string" || paquete.indexOf(PREFIJO) !== 0) {
      return Promise.reject(new Error("Formato desconocido"));
    }

    var datos = desdeBase64(paquete.slice(PREFIJO.length));
    var iv = datos.slice(0, LARGO_IV);
    var cuerpo = datos.slice(LARGO_IV);

    return subtle.decrypt({ name: "AES-GCM", iv: iv }, clave, cuerpo)
      .then(function (plano) {
        return JSON.parse(new TextDecoder().decode(plano));
      })
      .catch(function () {
        /* AES-GCM autentica: si falla, o la clave es incorrecta o alguien
           alteró el texto. Desde el navegador no se distinguen los dos
           casos, y el mensaje útil es el mismo. */
        throw new Error("CLAVE_INCORRECTA");
      });
  }

  /* ------------------------------------------------------------------------
     Guardar la clave derivada en el dispositivo
     Evita tener que pedirla en cada recarga. Como es no extraíble, aunque
     alguien logre ejecutar código en la página no puede llevarse la clave:
     puede usarla mientras esté en el sitio, nada más.
     --------------------------------------------------------------------- */
  var BD = "odontocampus-claves";
  var ALMACEN = "claves";

  function abrirBD() {
    return new Promise(function (resolver, rechazar) {
      if (!global.indexedDB) return rechazar(new Error("Sin IndexedDB"));

      var pedido = global.indexedDB.open(BD, 1);
      pedido.onupgradeneeded = function () {
        var db = pedido.result;
        if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN);
      };
      pedido.onsuccess = function () { resolver(pedido.result); };
      pedido.onerror = function () { rechazar(pedido.error); };
    });
  }

  function operar(modo, accion) {
    return abrirBD().then(function (db) {
      return new Promise(function (resolver, rechazar) {
        var tx = db.transaction(ALMACEN, modo);
        var pedido = accion(tx.objectStore(ALMACEN));
        pedido.onsuccess = function () { resolver(pedido.result); };
        pedido.onerror = function () { rechazar(pedido.error); };
        tx.oncomplete = function () { db.close(); };
      });
    });
  }

  function recordarClave(usuarioId, clave) {
    return operar("readwrite", function (almacen) {
      return almacen.put(clave, usuarioId);
    }).catch(function () {
      /* Navegación privada o almacenamiento bloqueado. No es un error:
         simplemente se va a volver a pedir la clave en la próxima visita. */
      return null;
    });
  }

  function recuperarClave(usuarioId) {
    return operar("readonly", function (almacen) {
      return almacen.get(usuarioId);
    }).catch(function () { return null; });
  }

  function olvidarClave(usuarioId) {
    return operar("readwrite", function (almacen) {
      return almacen.delete(usuarioId);
    }).catch(function () { return null; });
  }

  /* ------------------------------------------------------------------------
     Calidad de la clave
     No bloqueamos claves débiles: bloquear frustra y empuja a la gente a
     anotarla en cualquier lado. Mostramos qué tan fuerte es y dejamos decidir.
     --------------------------------------------------------------------- */
  function evaluarClave(texto) {
    var valor = String(texto || "");
    var puntos = 0;

    if (valor.length >= 8) puntos++;
    if (valor.length >= 12) puntos++;
    if (valor.length >= 16) puntos++;
    if (/[a-z]/.test(valor) && /[A-Z]/.test(valor)) puntos++;
    if (/\d/.test(valor)) puntos++;
    if (/[^\w\s]/.test(valor)) puntos++;

    if (valor.length < 8) return { nivel: "corta", texto: "Muy corta", puntos: 0 };
    if (puntos <= 2) return { nivel: "debil", texto: "Débil", puntos: puntos };
    if (puntos <= 4) return { nivel: "media", texto: "Aceptable", puntos: puntos };
    return { nivel: "fuerte", texto: "Fuerte", puntos: puntos };
  }

  global.OdontoCripto = {
    disponible: function () {
      // WebCrypto sólo existe en contextos seguros: HTTPS o localhost.
      return !!(subtle && global.isSecureContext);
    },
    generarSal: generarSal,
    derivarClave: derivarClave,
    cifrar: cifrar,
    descifrar: descifrar,
    recordarClave: recordarClave,
    recuperarClave: recuperarClave,
    olvidarClave: olvidarClave,
    evaluarClave: evaluarClave,
    ITERACIONES: ITERACIONES
  };
})(window);
