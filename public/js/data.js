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
      whatsapp: "2215550192",
      instagram: "@foe_odontounlp",
      email: "contacto@foe-unlp.org.ar",
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
      id: 2,
      titulo: "Banco de Instrumental Solidario FOE 2026",
      categoria: "Gremial / Beneficios",
      tag: "Beneficio",
      fecha: "Hace 4 días",
      resumen: "¿Necesitás instrumental para iniciar tus clínicas de Operatoria o Periodoncia? Ya abrimos la inscripción para el préstamo de cajas de instrumental y articuladores.",
      autor: "FOE Conducción",
      imagen: "instrumental",
      icono: "tool",
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

  // Modelos de Historias Clínicas para Visualización y Descarga
  historiasClinicas: [
    {
      id: "hc-operatoria",
      titulo: "Historia Clínica - Operatoria Dental I y II",
      catedra: "Cátedra de Operatoria Dental",
      anio: "3° y 4° Año",
      descripcion: "Incluye odontograma inicial y final, índice de placa bacteriana de O'Leary, diagnóstico de caries según ICDAS, plan de tratamiento restaurador y consentimiento.",
      paginas: 4,
      formato: "PDF Oficial Imprimible",
      tags: ["Operatoria", "Odontograma", "ICDAS", "Restauraciones"],
      secciones: [
        "1. Anamnesis y Antecedentes Médicos Relevantes",
        "2. Examen Estomatológico General y Tejidos Blandos",
        "3. Odontograma con Códigos de Color Normatizados",
        "4. Índice de Higiene Oral y Placa O'Leary",
        "5. Diagnóstico de Riesgo Cariogénico",
        "6. Consentimiento Informado para Tratamientos Restauradores"
      ]
    },
    {
      id: "hc-cirugia",
      titulo: "Historia Clínica y Ficha Quirúrgica - Cirugía BMF",
      catedra: "Cátedras de Cirugía Bucomaxilofacial I y II",
      anio: "4° y 5° Año",
      descripcion: "Ficha médica especializada con evaluación de riesgo ASA, estudio de hemostasia y coagulación, registro de anestésico administrado, técnica de exodoncia y control postoperatorio.",
      paginas: 5,
      formato: "PDF Oficial Imprimible",
      tags: ["Cirugía", "Exodoncia", "Evaluación ASA", "Anestésicos"],
      secciones: [
        "1. Historia Médica Detallada y Alergias a Medicamentos",
        "2. Evaluación Cardiovascular y Signos Vitales (Tensión/Pulso)",
        "3. Estudio Radiográfico de Piezas Dentarias y Estructuras Vecinas",
        "4. Protocolo Quirúrgico (Tipo de incisión, decolado, odontosección, sutura)",
        "5. Indicaciones y Prescripción Farmacológica Post-quirúrgica",
        "6. Consentimiento Informado Específico de Cirugía Bucal"
      ]
    },
    {
      id: "hc-periodoncia",
      titulo: "Periodontograma y Ficha Clínica Periodontal",
      catedra: "Cátedra de Periodoncia",
      anio: "3° y 4° Año",
      descripcion: "Plantilla con diagrama para registro de 6 puntos por pieza dentaria: profundidad de sondaje (PS), nivel de inserción clínica (NIC), sangrado al sondaje (SS), movilidad y compromiso de furcación.",
      paginas: 3,
      formato: "PDF Oficial Imprimible",
      tags: ["Periodoncia", "Periodontograma", "Sondaje", "Raspaje"],
      secciones: [
        "1. Registro de Profundidad de Sondaje (Mesio, Medio, Disto - V y P/L)",
        "2. Nivel de Inserción y Margen Gingival",
        "3. Registro de Movilidad Dentaria (Grados I, II y III)",
        "4. Diagnóstico Periodontal según Clasificación AAP/EFP",
        "5. Fase Inicial de Terapia (RAR / TBC / Motivación)",
        "6. Reevaluación Periodontal a las 4-6 semanas"
      ]
    },
    {
      id: "hc-endodoncia",
      titulo: "Ficha de Registro Endodóntico y Conductometría",
      catedra: "Cátedra de Endodoncia",
      anio: "4° Año",
      descripcion: "Ficha técnica para pruebas de vitalidad pulpar (frío, calor, percusión, palpación), conductometría electrónica/radiográfica, calibre de lima apical principal y técnica de obturación.",
      paginas: 3,
      formato: "PDF Oficial Imprimible",
      tags: ["Endodoncia", "Conductometría", "Vitalidad", "Obturación"],
      secciones: [
        "1. Diagnóstico Pulpar y Periapical",
        "2. Registro de Pruebas de Sensibilidad Térmica y Eléctrica",
        "3. Medición de Longitud Real de Trabajo (LRT) por conducto",
        "4. Referencias Anatómicas Dentarias (Cúspide / Borde Incisal)",
        "5. Protocolo de Irrigación (Hipoclorito de Sodio / EDTA)",
        "6. Técnica de Condensación Lateral / Termoplástica"
      ]
    },
    {
      id: "hc-odontopediatria",
      titulo: "Historia Clínica Odontopediátrica y Odontograma Infantil",
      catedra: "Cátedra de Odontopediatría",
      anio: "4° y 5° Año",
      descripcion: "Diseñada para la atención de niños y adolescentes: odontograma para dentición primaria y mixta, escala de comportamiento de Frankl, hábitos de succión/deglución y control de dieta.",
      paginas: 4,
      formato: "PDF Oficial Imprimible",
      tags: ["Odontopediatría", "Dentición Primaria", "Frankl", "Prevención"],
      secciones: [
        "1. Datos del Niño y del Tutor Legal Responsable",
        "2. Antecedentes Perinatales y de Desarrollo Psicomotriz",
        "3. Registro de Hábitos (Succión digital, mamadera nocturna, respiración bucal)",
        "4. Odontograma Temporal (Piezas 51 a 85)",
        "5. Escala de Conducta Frankl y Manejo Psicológico",
        "6. Consentimiento Informado Pediátrico Firmado por Padre/Tutor"
      ]
    },
    {
      id: "hc-protesis",
      titulo: "Ficha Clínica de Prótesis y Registro de Oclusión",
      catedra: "Cátedras de Prótesis I y II",
      anio: "4° y 5° Año",
      descripcion: "Ficha protésica para prótesis parcial removible (Clasificación de Kennedy), prótesis fija o prótesis completa. Registro de dimensión vertical (DVO / DVP) y montaje en articulador semiajustable.",
      paginas: 4,
      formato: "PDF Oficial Imprimible",
      tags: ["Prótesis", "Kennedy", "Oclusión", "Articulador"],
      secciones: [
        "1. Clasificación del Reborde Alveolar y Clase de Kennedy",
        "2. Determinación de Dimensión Vertical Oclusal y Postural",
        "3. Selección de Color, Forma y Tamaño de Dientes de Stock",
        "4. Diseño de Esquelético (Apoyos, retenedores, conectores mayores)",
        "5. Fases de Prueba (Enfilado, prueba de bizcocho, ajuste de oclusión)",
        "6. Ficha de Envío a Laboratorio Dental"
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
        "Pinza de algodón para curaciones",
        "Sonda periodontal milimetrada de Carolina del Norte (UNC-15)"
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
        "Bruñidores de bola y huevo",
        "Tallador de Hollemback y cleoide-discoide"
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
    }
  ],

  // Bolsa de Instrumental y Libros (Compra/Venta entre alumnos)
  bolsaInstrumental: [
    {
      id: "art-1",
      titulo: "Articulador Semiajustable tipo Whip-Mix con Arco Facial",
      categoria: "Equipamiento",
      estadoUso: "Como nuevo (1 cuatrimestre de uso)",
      precio: "$ 140.000",
      vendedor: "Martín (5° Año)",
      contactoWhatsapp: "2215129876",
      ubicacion: "La Plata / Facultad",
      fecha: "Ayer"
    },
    {
      id: "art-2",
      titulo: "Caja Completa de Instrumental de Periodoncia (Curetas Gracey 1/2 a 13/14 Hu-Friedy)",
      categoria: "Instrumental",
      estadoUso: "Muy buen estado, excelente filo",
      precio: "$ 85.000",
      vendedor: "Florencia (Graduada)",
      contactoWhatsapp: "2214332211",
      ubicacion: "Facultad / Tolosa",
      fecha: "Hace 3 días"
    },
    {
      id: "art-3",
      titulo: "Libro 'Operatoria Dental - Barrancos Mooney' 5ta Edición",
      categoria: "Libros / Apuntes",
      estadoUso: "Sin subrayar, encuadernación impecable",
      precio: "$ 35.000",
      vendedor: "Joaquín (4° Año)",
      contactoWhatsapp: "2216778899",
      ubicacion: "Centro La Plata",
      fecha: "Hace 4 días"
    },
    {
      id: "art-4",
      titulo: "Micromotor y Contraángulo KaVo Intramatic",
      categoria: "Rotatorios",
      estadoUso: "Excelente funcionamiento, recién lubricado",
      precio: "$ 110.000",
      vendedor: "Lucía (5° Año)",
      contactoWhatsapp: "2215904030",
      ubicacion: "Mesa FOE",
      fecha: "Hace 5 días"
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
  • Banco de instrumental y articuladores para clínicas.
  • Biblioteca virtual de resúmenes y modelos de examen.
  • Calculadora de promedios y modelos de historias clínicas.
  • Asesoría académica y defensa de los derechos estudiantiles en el Consejo Directivo.
- **Encontranos en**: Hall Central de la Facultad (calle 50 entre 1 y 115) o por Instagram **@foe_odontounlp**.`
    }
  ]
};

// Exportar al objeto global del navegador
window.ODONTO_DATA = ODONTO_DATA;
