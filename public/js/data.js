// Base de Datos Estructurada de OdontoCampus - FOE Odontología UNLP

const ODONTO_DATA = {
  // Configuración de la Agrupación
  info: {
    nombre: "FOE Odontología",
    facultad: "Facultad de Odontología - UNLP",
    siglas: "FOE",
    plataforma: "OdontoCampus",
    lema: "Compromiso, gestión y acompañamiento estudiantil en cada paso de tu carrera.",
    contacto: {
      // Sin WhatsApp ni correo hasta tener los reales: los de antes eran de
      // ejemplo. El Linktree de FOE indica consultar por Instagram.
      whatsapp: "",
      instagram: "@foe.odontologia",
      email: "",
      sede: "Mesa de FOE - Hall Central de la Facultad (50 entre 1 y 115)"
    }
  },

  // Noticias y Avisos de la Agrupación
  noticias: [
    {
      id: 1,
      titulo: "Fechas confirmadas para la Mesa de Finales de Febrero/Marzo",
      categoria: "Académico",
      tag: "Importante",
      fecha: "Hace 2 días",
      resumen: "Se publicaron los cronogramas oficiales de llamados a exámenes finales en el SIU Guaraní. Recordá inscribirte 48hs hábiles antes de cada mesa.",
      autor: "Secretaría de Asuntos Académicos FOE",
      imagen: "examenes",
      icono: "calendar-check",
      destacado: true
    },
    {
      id: 3,
      titulo: "Guía paso a paso: Llenado de Historias Clínicas en Clínica Integral",
      categoria: "Clínicas",
      tag: "Guía Útil",
      fecha: "Hace 1 semana",
      resumen: "Actualizamos la guía descargable con el odontograma digital, consentimiento informado y normas de bioseguridad exigidas por las cátedras de 3°, 4° y 5° año.",
      autor: "Comisión de Apuntes FOE",
      imagen: "clinica",
      icono: "file-text",
      destacado: false
    },
    {
      id: 4,
      titulo: "Taller práctico gratuito: Aislamiento Absoluto del Campo Operatorio",
      categoria: "Talleres",
      tag: "Capacitación",
      fecha: "Hace 1 semana",
      resumen: "Dictado por docentes y ayudantes graduados de la agrupación. Cupos limitados. Inscripción previa desde la mesa de la agrupación o por la web.",
      autor: "Formación Académica FOE",
      imagen: "taller",
      icono: "award",
      destacado: false
    }
  ],

  // El plan de estudios ya no está acá: vive en js/planes.js, que se genera
  // desde infra/planes/*.json (el mismo origen que la tabla de la base).

  // Historias clínicas: los PDF oficiales de la FOLP, tal como están en
  // https://www.folp.unlp.edu.ar/hclinica/ (octubre de 2026). Si la
  // facultad cambia un archivo, se cambia el enlace acá.
  historiasClinicas: [
    {
      grupo: "Historia Clínica Única",
      detalle: "La misma en todas las materias clínicas. Elegí la versión que te convenga imprimir.",
      documentos: [
        { titulo: "Historia Clínica Única (blanco y negro)", url: "https://www.folp.unlp.edu.ar/documents/15/Historia_Cl%C3%ADnica_%C3%9Anica_Blanco_y_Negro.pdf" },
        { titulo: "Historia Clínica Única (color)", url: "https://www.folp.unlp.edu.ar/documents/14/Historia_Cl%C3%ADnica_%C3%9Anica_Color.pdf" }
      ]
    },
    {
      grupo: "Anexos por especialidad",
      detalle: "Se suman a la historia única según la materia que cursás.",
      documentos: [
        { titulo: "Patología y Clínica Estomatológica", url: "https://www.folp.unlp.edu.ar/documents/16/PATOLOG%C3%8DA_Y_CL%C3%8DNICA_ESTOMATOL%C3%93GICA.pdf" },
        { titulo: "Periodoncia A y B", url: "https://www.folp.unlp.edu.ar/documents/18/PERIODONCIA_22A22_Y_22B22.pdf" },
        { titulo: "Endodoncia A", url: "https://www.folp.unlp.edu.ar/documents/20/ENDODONCIA_22A22.pdf" },
        { titulo: "Endodoncia B", url: "https://www.folp.unlp.edu.ar/documents/19/ENDODONCIA_B.pdf" },
        { titulo: "Odontología Integral Niños A y B", url: "https://www.folp.unlp.edu.ar/documents/21/ODONTOLOG%C3%8DA_INTEGRAL_NI%C3%91OS_22A22_Y_22B22.pdf" },
        { titulo: "Cirugía B", url: "https://www.folp.unlp.edu.ar/documents/22/CIRUGIA_B.pdf" },
        { titulo: "Prótesis A", url: "https://www.folp.unlp.edu.ar/documents/23/PROTESIS_A.pdf" },
        { titulo: "Prótesis B", url: "https://www.folp.unlp.edu.ar/documents/24/PROTESIS_B.pdf" }
      ]
    },
    {
      grupo: "Referencias",
      detalle: "Cómo completar el periodontograma y el anexo de Patología.",
      documentos: [
        { titulo: "Periodontograma: referencias", url: "https://www.folp.unlp.edu.ar/documents/25/PERIODONTOGRAMA_referencias.pdf" },
        { titulo: "Patología y Clínica Estomatológica: referencias", url: "https://www.folp.unlp.edu.ar/documents/17/PATOLOG%C3%8DA_Y_CL%C3%8DNICA_ESTOMATOL%C3%93GICA_referencias.pdf" }
      ]
    },
    {
      grupo: "Códigos y unificación de criterios",
      detalle: "Los códigos de prestaciones que se usan en todas las clínicas.",
      documentos: [
        { titulo: "Códigos y Unificación de Criterios", url: "https://www.folp.unlp.edu.ar/documents/26/C%C3%B3digos_y_Unificaci%C3%B3n_de_Criterios.pdf" }
      ]
    },
    {
      grupo: "Material para descargar de las asignaturas",
      detalle: "Planillas y formularios que piden algunas cátedras.",
      documentos: [
        { titulo: "Fajas de esterilización", url: "https://www.folp.unlp.edu.ar/documents/27/Fajas_de_Esterilizaci%C3%B3n.pdf" },
        { titulo: "Consentimiento informado bilateral", url: "https://www.folp.unlp.edu.ar/documents/28/Consentimiento_Informado_Bilateral.pdf" },
        { titulo: "Encuesta (OPS)", url: "https://www.folp.unlp.edu.ar/documents/29/Encuesta_-_OPS.pdf" },
        { titulo: "Plan de tratamiento (OPS)", url: "https://www.folp.unlp.edu.ar/documents/30/Plan_de_Tratamiento_-_OPS.pdf" },
        { titulo: "Registro de exposiciones y punciones accidentales", url: "https://www.folp.unlp.edu.ar/documents/31/Registro_de_Exposiciones_y_Punciones_Accidentales.pdf" },
        { titulo: "Indicaciones posoperatorias (Cirugía B)", url: "https://www.folp.unlp.edu.ar/documents/32/Indicaciones_Posoperatorias_-_CIRUGIA_B.pdf" },
        { titulo: "Desempeño del alumno en clínica (Odontología Integral Niños)", url: "https://www.folp.unlp.edu.ar/documents/33/Desempe%C3%B1o_del_alumno_en_cl%C3%ADnica_-_ODONTOLOG%C3%8DA_INTEGRAL_NI%C3%91OS.pdf" }
      ]
    }
  ],


  // Biblioteca de Apuntes y Recursos por Materia
  biblioteca: [
    {
      id: "ap-1",
      titulo: "Resumen Completo: Huesos del Cráneo, Macizo Facial e Inserciones Musculares",
      materia: "Anatomía General e Histología",
      anio: "1° Año",
      tipo: "Resumen",
      autor: "Comisión Apuntes FOE (Revisión Docente)",
      paginas: 48,
      descargas: 1420,
      valoracion: 4.9,
      tags: ["Anatomía", "Huesos", "Músculos Masticadores", "Pares Craneales"]
    },
    {
      id: "ap-2",
      titulo: "Guía de Estudio: Microbiología Bucal y Biopelícula (Biofilm Cariogénico)",
      materia: "Microbiología e Inmunología",
      anio: "2° Año",
      tipo: "Guía de TP",
      autor: "Equipo Académico FOE",
      paginas: 32,
      descargas: 980,
      valoracion: 4.8,
      tags: ["Streptococcus Mutans", "Lactobacillus", "Placa", "Inmunología"]
    },
    {
      id: "ap-3",
      titulo: "Compendio de Resinas Compuestas, Sistemas Adhesivos y Lámparas de Fotocurado",
      materia: "Materiales Dentales",
      anio: "2° Año",
      tipo: "Resumen",
      autor: "Ayudantes FOE Materiales",
      paginas: 40,
      descargas: 1150,
      valoracion: 4.9,
      tags: ["Composites", "Adhesión 7ma Gen", "Monomeros", "C-Factor"]
    },
    {
      id: "ap-4",
      titulo: "Preguntero Exámenes Finales: Farmacología Odontológica (Antibióticos, AINEs y Anestésicos)",
      materia: "Farmacología y Terapéutica",
      anio: "3° Año",
      tipo: "Preguntero",
      autor: "Estudiantes FOE 2025",
      paginas: 28,
      descargas: 1850,
      valoracion: 5.0,
      tags: ["Amoxicilina", "Ibuprofeno", "Lidocaína", "Mepivacaína", "Interacciones"]
    },
    {
      id: "ap-5",
      titulo: "Atlas de Lesiones Estomatológicas y Patología Bucal Frecuente",
      materia: "Patología Bucal y Clínica Estomatológica",
      anio: "3° Año",
      tipo: "Atlas / Libro",
      autor: "Compilación FOE",
      paginas: 64,
      descargas: 1320,
      valoracion: 4.9,
      tags: ["Leucoplasia", "Liquen Plano", "Aftas", "Cáncer Bucal"]
    },
    {
      id: "ap-6",
      titulo: "Manual de Instrumental Quirúrgico: Fórceps, Elevadores y Suturas",
      materia: "Cirugía Bucomaxilofacial I",
      anio: "4° Año",
      tipo: "Manual Práctico",
      autor: "Comisión Clínica FOE",
      paginas: 36,
      descargas: 1640,
      valoracion: 5.0,
      tags: ["Fórceps 150/151", "Elevador Recto/Winter", "Sutura 3-0 Seda"]
    }
  ],

  // Guía de Instrumental Básico Requerido
  instrumentalGuia: [
    {
      nombre: "Kit de Exploración Básica",
      materias: ["Todas las Clínicas (3°, 4° y 5° año)"],
      elementos: [
        "Espejo bucal N° 5 plano con mango de acero inoxidable",
        "Sonda de exploración curva / doble extremo",
        "Pinza para algodón",
        "Sonda periodontal milimetrada de Carolina del Norte (UNC-15)",
        "Bandeja metálica perforada o lisa"
      ],
      consejoFOE: "Esterilizar siempre en bolsa con testigo químico y rotular con nombre completo."
    },
    {
      nombre: "Caja de Operatoria Dental (Aislamiento y Cavidades)",
      materias: ["Operatoria Dental I y II"],
      elementos: [
        "Pinza perforadora de dique de goma (Ainsworth)",
        "Pinza portaclamps (Brewer)",
        "Arco de Young metálico o plástico radiolúcido",
        "Juego de Clamps básicos (N° 200 a 209 para molares y premolares, W8A, 212 para anteriores)",
        "Espátula para resina con recubrimiento de titanio",
        "Goma dique",
        "Hilo dental",
        "Piedra diamantada redonda (color azul-verde)",
        "Piedra diamantada llama (color amarillo-rojo)",
        "Piedra diamantada tronco cónica de punta redondeada"
      ],
      consejoFOE: "Conseguí el kit de aislamiento con descuento presentando carnet de socio FOE."
    },
    {
      nombre: "Caja Quirúrgica de Exodoncia Simple",
      materias: ["Cirugía Bucomaxilofacial I y II"],
      elementos: [
        "Jeringa tipo Cárpule con aspiración",
        "Sindesmótomo",
        "Juego de elevadores rectos (fino, mediano y ancho)",
        "Elevadores de Winter o angulados de Pott (derecho e izquierdo)",
        "Fórceps superiores (N° 150 universal, N° 1 recto, N° 18R y 18L molares)",
        "Fórceps inferiores (N° 151 universal, N° 222 molares o cuerno de buey N° 16)",
        "Portaagujas tipo Mayo-Hegar de 14cm",
        "Tijera quirúrgica para sutura (Spencer / Goldman-Fox)"
      ],
      consejoFOE: "Revisá el filo de los elevadores antes de iniciar el turno clínico para evitar deslizamientos."
    },
    {
      nombre: "Prótesis A",
      materias: ["Prótesis (Cátedra A)"],
      elementos: [
        "Articulador semiajustable",
        "Articulador con arco facial",
        "Jabón, toalla, barbijo, botas, anteojos, babero, compresas y guantes descartables",
        "Caja esterilizada con juego clínico y cubetas Rim Lock lisas",
        "Solución de hipoclorito de sodio al 10 %",
        "Spray de alcohol al 70 %",
        "Cubetas tipo Rim Lock lisas, alginato y dosificador polvo/líquido",
        "Yeso de impresión, yeso piedra y yeso densita",
        "Taza de goma, espátula para yeso y espátula para alginato",
        "Cera utility, cera rosa, cera amarilla, cera Beauty Pink y estañolas de radiografías",
        "Separador para yeso",
        "4 dowel pins y clips para retención (clips de oficina)",
        "Laminillas de Long",
        "Flameador, lecrón y bisturí",
        "Alicate universal",
        "Espátula para cera",
        "Papel de articular"
      ]
    }
  ],

  /* Preguntas frecuentes (sección Trámites). Las responde FOE en su documento
     de preguntas frecuentes; cuando cambie algo, se cambia acá.
     Cada respuesta es una lista de párrafos; un arreglo adentro es una lista
     con viñetas. */
  preguntasFrecuentes: [
    {
      tema: "Readmisión",
      preguntas: [
        { p: "¿Quién tiene que pedir la readmisión?",
          r: ["Quienes durante el ciclo lectivo no cumplieron con los requisitos para mantener la regularidad."] },
        { p: "¿Cómo y dónde la presento?",
          r: ["Descargá la planilla de solicitud de la página de la FOLP (está en la pestaña Readmisión). Imprimila, completala y firmala a mano.",
              "Escaneala en PDF, tamaño A4, y mandala junto con una copia digital de tu DNI (de los dos lados) a direadmisiones@folp.unlp.edu.ar.",
              "En el asunto poné: «Readmisión para el Ciclo Lectivo», el año, y tus apellidos y nombres."] },
        { p: "¿Qué plazo tengo?",
          r: ["El que disponga la facultad. Lo publicamos apenas salga.",
              "Si no presentás la documentación en el formato y el plazo pedidos, el trámite se rechaza sin excepción."] },
        { p: "¿Cuál es el mail de readmisiones?",
          r: ["direadmisiones@folp.unlp.edu.ar"] }
      ]
    },
    {
      tema: "Regularidad y vencimientos",
      preguntas: [
        { p: "¿Cómo quedo regular?",
          r: ["Con cualquiera de estas opciones:",
              ["2 finales aprobados.", "2 promociones.", "2 cursadas aprobadas (materias optativas o electivas).",
               "Una combinación de las anteriores: por ejemplo, 1 final y 1 promoción, o 1 final y 1 cursada complementaria."]] },
        { p: "¿Qué hago si se me vence una materia?",
          r: ["Tenés que rendir el examen de reválida en las mesas correspondientes. Hay mesas todos los meses: son 5 oportunidades en un plazo de un año."] },
        { p: "¿Cuándo tengo que actualizar una asignatura?",
          r: ["Cuando perdiste la regularidad del ciclo lectivo y pasaron 5 años o más desde que diste el final: ese examen se actualiza con un examen nuevo."] }
      ]
    },
    {
      tema: "Clínica",
      preguntas: [
        { p: "¿Qué historia clínica uso en SEPOI y POI?",
          r: ["La historia clínica unificada, la misma de todas las materias. Además completás una planilla de la materia (se imprime en la fotocopiadora) donde anotás las prácticas del día con sus códigos.",
              "Tu docente a cargo la controla y la firma al terminar: es el registro de tu trabajo en clínica."] },
        { p: "¿Cuántas prestaciones necesito en SEPOI y POI?",
          r: ["Para aprobar ambas materias hay un mínimo de prestaciones que asigna tu docente a cargo. Se cuenta la cantidad, no el tipo.",
              "Las prestaciones de POI suman al total de SEPOI. Por ejemplo: si hiciste 50 en POI y para aprobar SEPOI te piden 120, te faltan 70."] },
        { p: "¿Cuáles son los horarios de esterilización?",
          r: ["De lunes a viernes: entrega de 8 a 20 h y retiro de 8 a 21 h.",
              "Sábados: entrega de 8 a 14 h y retiro de 8 a 17 h.",
              "La caja o el tambor tiene que tener:",
              ["Nombre y apellido", "Legajo", "Horario", "Materia", "Día de cursada"]] },
        { p: "¿Cómo tramito el QR para esterilizar?",
          r: ["Cada vez que quieras esterilizar o retirar instrumental del área de esterilización tenés que presentar tu QR.",
              "Cómo sacarlo, en este video: https://youtu.be/NL1ITJ9-rqk"] }
      ]
    },
    {
      tema: "Alumnado y libreta",
      preguntas: [
        { p: "¿Cuál es el horario de alumnado?",
          r: ["De lunes a viernes, de 8 a 13 h."] },
        { p: "¿Dónde pido la libreta universitaria?",
          r: ["En alumnado, de 8 a 12 h. Llevá toda tu documentación presentada de antes y una foto tipo carnet."] },
        { p: "¿Para qué sirve la libreta universitaria?",
          r: ["Para volcar las notas de los finales y tu información académica, y para votar en las elecciones estudiantiles."] }
      ]
    }
  ],

  // Base de Conocimiento Rápida para el Asistente OdontoBot
  knowledgeBase: [
    {
      temas: ["anestesico", "anestesia", "lidocaina", "mepivacaina", "dosis", "dosis maxima", "articaina"],
      respuesta: `🦷 **Cálculo Rápido de Anestésicos Locales en Odontología**:
- **Lidocaína 2% con Epinefrina 1:100.000**:
  • Dosis máxima en adultos: **4.4 mg/kg** (hasta un tope máximo absoluto de **300 mg**, aprox. 8 cartuchos de 1.8ml en paciente de 70kg sano).
- **Mepivacaína 3% (Sin vasoconstrictor)**:
  • Recomendada en pacientes hipertensos no controlados o cardiópatas severos. Dosis máx: **4.4 mg/kg** (hasta 300 mg).
- **Articaína 4% con Epinefrina 1:100.000 o 1:200.000**:
  • Excelente difusión ósea (ideal para infiltrativa en sector posterior mandibular). Dosis máx: **7.0 mg/kg** (hasta 500 mg).
⚠️ *Siempre realizar aspiración previa antes de inyectar.*`
    },
    {
      temas: ["antibiotico", "amoxicilina", "alergia", "penicilina", "profilaxis", "infeccion", "medicacion"],
      respuesta: `💊 **Pautas de Prescripción Antibiótica en Odontología UNLP**:
- **Primera elección (Infecciones odontogénicas agudas)**:
  • **Amoxicilina 500 mg u 875 mg**: 1 comprimido cada 8hs o cada 12hs por 7 días.
  • Si se sospechan anaerobios resistentes: *Amoxicilina 875 mg + Ácido Clavulánico 125 mg* cada 12hs.
- **En pacientes alérgicos a Penicilinas / Betalactámicos**:
  • **Azitromicina 500 mg**: 1 toma diaria por 3 a 5 días (lejos de las comidas).
  • **Claritromicina 500 mg**: 1 comp cada 12hs por 7 días.
  • **Clindamicina 300 mg**: 1 cápsula cada 8hs por 7 días.
- **Profilaxis de Endocarditis Infecciosa (Pacientes de alto riesgo)**:
  • *Amoxicilina 2 g* vía oral 30 a 60 minutos antes del procedimiento quirúrgico (en alérgicos: *Clindamicina 600 mg* o *Azitromicina 500 mg*).`
    },
    {
      temas: ["black", "clasificacion de black", "cavidades", "clase i", "clase ii", "clase iii", "clase iv", "clase v", "clase 1", "clase 2", "clase 3", "clase 4", "clase 5"],
      respuesta: `📋 **Clasificación de Cavidades de Black**:
- **Clase I**: Fosas, puntos, surcos y fisuras oclusales de molares y premolares; caras linguales/palatinas de incisivos y caninos.
- **Clase II**: Caras proximales (mesial / distal) de molares y premolares.
- **Clase III**: Caras proximales de dientes anteriores (incisivos y caninos) **sin** compromiso del ángulo incisal.
- **Clase IV**: Caras proximales de dientes anteriores **con** compromiso o fractura del ángulo incisal.
- **Clase V**: Tercio gingival de las caras vestibulares o linguales/palatinas de todos los dientes.
- *(Clase VI de Simon)*: Cúspides de dientes posteriores o bordes incisivos por atrición/desgaste.`
    },
    {
      temas: ["conductometria", "endodoncia", "lrt", "lima", "irrigacion", "edta", "hipoclorito"],
      respuesta: `🔬 **Tips Clave para la Práctica de Endodoncia**:
1. **Aislamiento Absoluto Obligatorio**: Nunca iniciar apertura cameral sin dique de goma bien ajustado.
2. **Localización de Conductos**: Emplear explorador endodóntico DG-16 e irrigación abundante con Hipoclorito de Sodio (NaOCl al 2.5% o 5.25%).
3. **Conductometría**:
   • Medir longitud aparente del diente (LAD) en la radiografía diagnóstica.
   • Restar 1 mm para obtener la Longitud Tentativa de Trabajo (LTT).
   • Colocar lima N° 10 o 15 con tope de goma, verificar con radiografía periapical o localizador apical electrónico.
   • Fijar **LRT (Longitud Real de Trabajo)** a 0.5 mm - 1.0 mm del vértice radiográfico (constricción apical).
4. **Lavado final**: EDTA al 17% durante 1 minuto para remover el barro dentinario (*smear layer*) antes de obturar.`
    },
    {
      temas: ["siu", "guarani", "inscripcion", "final", "certificado", "readmision", "tramites"],
      respuesta: `🏛️ **Trámites Frecuentes SIU Guaraní Odontología UNLP**:
- **Inscripción a Finales**: Abre 7 días antes de la mesa y cierra estrictamente **48 horas hábiles antes** a las 23:59hs.
- **Baja de Examen**: Si no vas a presentarte, date de baja en el SIU para no computar inasistencia y permitir cupo a otros compañeros.
- **Certificado de Alumno Regular**: Se descarga directamente desde el menú *Trámites > Solicitar Constancias y Certificados* con código de validación QR.
- **Readmisión / Reinscripción Anual**: Recordá que a principio de cada ciclo lectivo es obligatorio realizar la reinscripción en el SIU para figurar en las actas de cursada.`
    },
    {
      temas: ["foe", "agrupacion", "mesa", "contacto", "beneficios", "quienes somos", "ayuda"],
      respuesta: `🌟 **Agrupación Estudiantil FOE - Odontología UNLP**:
Somos la agrupación gremial y académica de los estudiantes de Odontología de la UNLP.
- **Servicios para vos**:
  • Biblioteca virtual de resúmenes y modelos de examen.
  • Calculadora de promedios y modelos de historias clínicas.
  • Asesoría académica y defensa de los derechos estudiantiles en el Consejo Directivo.
- **Encontranos en**: Hall Central de la Facultad (calle 50 entre 1 y 115) o por Instagram **@foe.odontologia**.`
    }
  ]
};

// Exportar al objeto global del navegador
window.ODONTO_DATA = ODONTO_DATA;
