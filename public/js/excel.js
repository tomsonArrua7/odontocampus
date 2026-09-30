/* ==========================================================================
   ODONTOCAMPUS — EXCEL (.xlsx) SIN LIBRERÍAS
   Arma un libro de una hoja y lo descarga. Lo usa el panel para exportar
   las cuentas.

   --------------------------------------------------------------------------
   POR QUÉ NO UN CSV
   Excel abre un CSV adivinando: el legajo 26778/6 lo convierte en fecha, un
   teléfono largo en notación científica, y en Argentina espera ";" en vez de
   ",". En un .xlsx cada celda va marcada como texto y se ve tal cual.

   CÓMO
   Un .xlsx es un ZIP con unos XML adentro. El ZIP se arma "guardado" (sin
   comprimir), que es parte del formato y alcanza para unos cientos de
   filas. Todo pasa en el navegador: los datos no van a ningún servicio.
   ========================================================================== */
(function (global) {
  "use strict";

  /* --- CRC-32, lo pide el formato ZIP para cada archivo ------------------ */
  var TABLA_CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** ZIP sin compresión. archivos: [{ nombre, texto }] */
  function zip(archivos) {
    var utf8 = new TextEncoder();
    var partes = [];
    var central = [];
    var desplazamiento = 0;

    archivos.forEach(function (a) {
      var nombre = utf8.encode(a.nombre);
      var datos = utf8.encode(a.texto);
      var crc = crc32(datos);

      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);   // firma
      local.setUint16(4, 20, true);           // versión necesaria
      local.setUint16(6, 0x0800, true);       // nombres en UTF-8
      local.setUint16(8, 0, true);            // sin comprimir
      local.setUint16(10, 0, true);           // hora
      local.setUint16(12, 0x21, true);        // fecha (1980-01-01)
      local.setUint32(14, crc, true);
      local.setUint32(18, datos.length, true);
      local.setUint32(22, datos.length, true);
      local.setUint16(26, nombre.length, true);
      local.setUint16(28, 0, true);
      partes.push(new Uint8Array(local.buffer), nombre, datos);

      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, 0, true);
      cd.setUint16(14, 0x21, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, datos.length, true);
      cd.setUint32(24, datos.length, true);
      cd.setUint16(28, nombre.length, true);
      cd.setUint32(42, desplazamiento, true);
      central.push(new Uint8Array(cd.buffer), nombre);

      desplazamiento += 30 + nombre.length + datos.length;
    });

    var largoCentral = central.reduce(function (s, p) { return s + p.length; }, 0);
    var fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, archivos.length, true);
    fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, largoCentral, true);
    fin.setUint32(16, desplazamiento, true);

    return new Blob(partes.concat(central, [new Uint8Array(fin.buffer)]),
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* --- XML de la planilla ------------------------------------------------ */
  function xml(texto) {
    return String(texto)
      // Caracteres de control que el XML no admite (vienen de copiar y pegar).
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /** A, B, … Z, AA, AB… */
  function columna(i) {
    var s = "";
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  function hoja(encabezados, filas, anchos) {
    var todas = [encabezados].concat(filas);
    var cuerpo = todas.map(function (fila, f) {
      return '<row r="' + (f + 1) + '">' + fila.map(function (valor, c) {
        if (valor === null || valor === undefined || valor === "") return "";
        return '<c r="' + columna(c) + (f + 1) + '" t="inlineStr"' + (f === 0 ? ' s="1"' : "") +
               '><is><t xml:space="preserve">' + xml(valor) + "</t></is></c>";
      }).join("") + "</row>";
    }).join("");

    var cols = anchos ? "<cols>" + anchos.map(function (a, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + a + '" customWidth="1"/>';
    }).join("") + "</cols>" : "";

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      // La primera fila queda fija al bajar.
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      cols + "<sheetData>" + cuerpo + "</sheetData>" +
      (filas.length ? '<autoFilter ref="A1:' + columna(encabezados.length - 1) + (filas.length + 1) + '"/>' : "") +
      "</worksheet>";
  }

  var ESTILOS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  /**
   * Descarga un .xlsx de una hoja.
   * @param {string}   archivo     nombre, con .xlsx
   * @param {string}   nombreHoja  máx. 31 caracteres
   * @param {string[]} encabezados
   * @param {Array[]}  filas       todo se escribe como texto
   * @param {number[]} [anchos]    ancho de cada columna, en caracteres
   */
  function descargar(archivo, nombreHoja, encabezados, filas, anchos) {
    // Excel no admite estos caracteres en el nombre de una hoja, ni más de 31.
    var nombreSeguro = String(nombreHoja).replace(/[\\\/?*\[\]:']/g, " ").slice(0, 31);
    var libro = zip([
      { nombre: "[Content_Types].xml", texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>" },
      { nombre: "_rels/.rels", texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>" },
      { nombre: "xl/workbook.xml", texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + xml(nombreSeguro) + '" sheetId="1" r:id="rId1"/></sheets>' +
        (filas.length ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
          "'" + xml(nombreSeguro) + "'!$A$1:$" + columna(encabezados.length - 1) + "$" + (filas.length + 1) +
          "</definedName></definedNames>" : "") +
        "</workbook>" },
      { nombre: "xl/_rels/workbook.xml.rels", texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>" },
      { nombre: "xl/styles.xml", texto: ESTILOS },
      { nombre: "xl/worksheets/sheet1.xml", texto: hoja(encabezados, filas, anchos) }
    ]);

    var url = URL.createObjectURL(libro);
    var enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = archivo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    global.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  global.OdontoExcel = { descargar: descargar, _zip: zip };
})(window);
