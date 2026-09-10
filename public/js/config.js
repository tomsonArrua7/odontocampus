/* ==========================================================================
   ODONTOCAMPUS — CONFIGURACIÓN
   Único archivo que cambia entre desarrollo y producción.
   --------------------------------------------------------------------------
   Sobre la ANON_KEY: es pública por diseño y va en el repositorio. Viaja
   dentro de este JavaScript y cualquiera puede leerla con Ctrl+U. Eso está
   bien y es como Supabase está pensado.

   Lo que impide que esa clave lea la base entera son las políticas RLS de
   infra/supabase/sql/001_esquema.sql. NO es un secreto lo que protege los
   datos: son las políticas.

   La que NUNCA va acá —ni en ningún archivo del repositorio— es la
   SERVICE_ROLE_KEY. Saltea todas las políticas. Vive solo en el .env del
   servidor.
   ========================================================================== */
(function (global) {
  "use strict";

  var CONFIG = {
    /* URL del gateway de Supabase (Kong), detrás del proxy de CloudPanel. */
    apiUrl: "https://api.odontocampus.com.ar",

    /* Generada a partir del JWT_SECRET del servidor.
       Mientras diga PENDIENTE, todo lo que necesita cuenta queda desactivado
       y el sitio funciona exactamente como hoy: sin login, sin errores. */
    anonKey: "PENDIENTE",

    /* Versión del texto de consentimiento. Si cambia el texto, se sube este
       número y se vuelve a pedir. Queda registrado en la tabla
       `consentimientos` junto con la versión aceptada. */
    versionConsentimiento: "2026-09-1",

    /* Mínimo para la clave de notas. Ver js/cripto.js. */
    minLargoClaveNotas: 8
  };

  /**
   * ¿Están las cuentas configuradas?
   *
   * Regla del proyecto: el sitio tiene que funcionar completo sin backend.
   * Mesas, reválidas, historias clínicas, instrumental y biblioteca son
   * públicas y no dependen de esto. Si la configuración falta o está mal,
   * lo que se apaga es la cuenta, no el sitio.
   */
  CONFIG.hayBackend = function () {
    return typeof CONFIG.anonKey === "string" &&
           CONFIG.anonKey.length > 40 &&
           CONFIG.anonKey !== "PENDIENTE" &&
           /^https:\/\//.test(CONFIG.apiUrl);
  };

  global.ODONTO_CONFIG = CONFIG;
})(window);
