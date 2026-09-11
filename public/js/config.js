/* ==========================================================================
   ODONTOCAMPUS — CONFIGURACIÓN
   Único archivo que cambia entre desarrollo y producción.
   --------------------------------------------------------------------------
   Sobre la clave publicable: es pública por diseño y va en el repositorio. Viaja
   dentro de este JavaScript y cualquiera puede leerla con Ctrl+U. Eso está
   bien y es como Supabase está pensado.

   Lo que impide que esa clave lea la base entera son las políticas RLS de
   infra/supabase/sql/001_esquema.sql. NO es un secreto lo que protege los
   datos: son las políticas.

   Las que NUNCA van acá —ni en ningún archivo del repositorio— son la
   SUPABASE_SECRET_KEY y la SERVICE_ROLE_KEY. Saltean todas las políticas.
   Viven sólo en el .env del servidor, y hayBackend() se niega a encender
   las cuentas si detecta algo que no sea una clave publicable.
   ========================================================================== */
(function (global) {
  "use strict";

  var CONFIG = {
    /* URL del gateway de Supabase (Kong), detrás del proxy de CloudPanel. */
    apiUrl: "https://api.odontocampus.com.ar",

    /* SUPABASE_PUBLISHABLE_KEY del .env del servidor: empieza con
       "sb_publishable_". La imprime infra/supabase/generar-claves.sh.

       Se usa esta y no la ANON_KEY clásica por una razón operativa: es una
       clave opaca que el gateway traduce, así que se puede reemplazar sin
       tocar el JWT_SECRET. La ANON_KEY es un JWT firmado con ese secreto:
       cambiarla obliga a cambiarlo, y eso invalida todas las sesiones.

       Mientras diga PENDIENTE, todo lo que necesita cuenta queda desactivado
       y el sitio funciona exactamente como hoy: sin login, sin errores. */
    publishableKey: "sb_publishable_20rdIEuZkZDtbdEDvIvJ_B_7QH9AWs2",

    /* Versión del texto de "qué guardamos" que se acepta al crear la cuenta.
       Si cambia ese texto (en index.html y en js/carrera.js), se sube este
       número: a quien aceptó una versión anterior se le vuelve a pedir antes
       de entrar a Mi promedio. Queda en la tabla `consentimientos`.
       Máximo 20 caracteres: la base corta lo que sobre. */
    versionTerminos: "2026-09-2",

    /* Largo mínimo de la contraseña. TIENE que ser igual a
       GOTRUE_PASSWORD_MIN_LENGTH en infra/supabase/docker-compose.override.yml:
       si el sitio pide menos, deja pasar contraseñas que el servidor rechaza. */
    minLargoClave: 8
  };

  /**
   * ¿Están las cuentas configuradas?
   *
   * Regla del proyecto: el sitio tiene que funcionar completo sin backend.
   * Mesas, reválidas, historias clínicas, instrumental y biblioteca son
   * públicas y no dependen de esto. Si la configuración falta o está mal,
   * lo que se apaga es la cuenta, no el sitio.
   */
  var avisoClaveMostrado = false;

  CONFIG.hayBackend = function () {
    var clave = CONFIG.publishableKey;
    if (typeof clave !== "string" || clave === "" || clave === "PENDIENTE") return false;

    /* Freno de seguridad. Si alguien pega por error la SUPABASE_SECRET_KEY
       (sb_secret_...) o una SERVICE_ROLE_KEY, las cuentas no se encienden.
       Esas claves saltean todas las políticas de la base: publicadas en
       este archivo, cualquiera que abra el sitio podría leer y borrar todo. */
    if (clave.indexOf("sb_publishable_") !== 0) {
      if (!avisoClaveMostrado) {
        avisoClaveMostrado = true;
        console.error(
          "[OdontoCampus] config.js: la clave configurada no es una clave " +
          "publicable (sb_publishable_...). Las cuentas quedan desactivadas. " +
          "Si pegaste la clave secreta, rotala en el servidor: ya es pública."
        );
      }
      return false;
    }

    return /^https:\/\//.test(CONFIG.apiUrl);
  };

  global.ODONTO_CONFIG = CONFIG;
})(window);
