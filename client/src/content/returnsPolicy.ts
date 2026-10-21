/** Fuente comercial compartida por la página y las futuras respuestas breves de FAQ. */
interface ReturnsPolicySection {
  readonly id: string
  readonly title: string
  readonly paragraphs: readonly string[]
  readonly items?: readonly string[]
  readonly ordered?: boolean
}

const voluntaryReturnWindowDays = 15
const requestSummary = 'Identifica la compra y el producto, explica el motivo y prepara la información para su revisión. Actualmente no existe un canal operativo de devoluciones: el procedimiento se presenta únicamente como demostración académica.'

export const returnsPolicy: {
  readonly title: string
  readonly introduction: string
  readonly voluntaryReturnWindowDays: number
  readonly requestSummary: string
  readonly sections: readonly ReturnsPolicySection[]
} = {
  title: 'Política de Devoluciones',
  introduction: 'Consulta los plazos, las condiciones y los pasos de una devolución voluntaria en CiberNova. Esta política es una simulación académica para productos de tecnología, computación y electrónica; no activa devoluciones ni reembolsos reales.',
  voluntaryReturnWindowDays,
  requestSummary,
  sections: [
    {
      id: 'return-window',
      title: 'Plazos para solicitar devoluciones',
      paragraphs: [
        'La política académica contempla un plazo de ' + voluntaryReturnWindowDays + ' días naturales a partir de la entrega del producto para presentar una solicitud de devolución voluntaria. El día siguiente a la entrega se cuenta como día 1; se incluyen fines de semana y feriados. La solicitud debe presentarse como máximo al finalizar el día 15 y no requiere que la revisión termine dentro de ese plazo.',
        'Este plazo se utiliza para evaluar un caso hipotético de entrega. En la plataforma actual, una Order confirmada y su Purchase Confirmation reflejan un pago Sandbox aprobado: no acreditan un cobro bancario ni una entrega física. CiberNova no registra entregas ni calcula automáticamente el vencimiento de este período.',
        'El plazo regula únicamente la devolución voluntaria simulada. No limita garantías, reclamos por defectos de origen ni otros derechos legales que pudieran resultar aplicables.',
      ],
    },
    {
      id: 'acceptance-conditions',
      title: 'Condiciones para aprobar una devolución',
      paragraphs: [
        'En el ejercicio académico, cada solicitud se revisaría según su motivo y las características del producto. Cumplir los requisitos permite evaluarla; no supone una aprobación automática.',
      ],
      items: [
        'Identificar la compra con su número de orden y señalar el producto y la cantidad que se desea devolver.',
        'Presentar la solicitud de devolución voluntaria dentro del plazo de ' + voluntaryReturnWindowDays + ' días naturales y aportar la fecha de entrega del caso evaluado.',
        'Explicar el motivo de la solicitud y describir el estado del producto de forma clara.',
        'Conservar los componentes y accesorios originales que correspondan al conjunto solicitado, como cables, cargadores o adaptadores.',
        'Mantener el producto en condiciones compatibles con una devolución voluntaria: sin daños por uso indebido ni modificaciones no autorizadas que afecten su funcionamiento o integridad.',
        'Indicar expresamente si existe un defecto o problema de funcionamiento. Ese reclamo debe distinguirse de un cambio de decisión y no rechazarse automáticamente por las exclusiones de devolución voluntaria.',
      ],
    },
    {
      id: 'voluntary-exclusions',
      title: 'Casos en los que no se aceptan devoluciones voluntarias',
      paragraphs: [
        'Dentro de la política académica de devolución voluntaria, no se aceptaría una solicitud en los siguientes supuestos:',
        'Estas exclusiones no sustituyen la evaluación de productos defectuosos ni eliminan garantías o derechos legales aplicables. Un fallo de origen no se considera por sí mismo un daño por uso indebido.',
      ],
      items: [
        'Solicitud presentada después de los ' + voluntaryReturnWindowDays + ' días naturales previstos para la devolución voluntaria.',
        'Daños provocados por uso indebido, golpes, líquidos o conexiones inadecuadas, cuando sean la causa del deterioro del producto.',
        'Alteraciones o modificaciones no autorizadas que afecten la integridad o el funcionamiento del artículo.',
        'Ausencia de componentes esenciales cuando la solicitud requiere devolver el conjunto completo, salvo que la ausencia sea precisamente el motivo del reclamo por una entrega incompleta.',
        'En un caso hipotético con productos o licencias digitales, contenido consumido o una licencia ya activada que no pueda restituirse. Sus condiciones especiales deberían informarse antes de la compra; esta mención no afirma que CiberNova implemente actualmente activaciones o entrega digital.',
      ],
    },
    {
      id: 'request-procedure',
      title: 'Procedimiento general para solicitar una devolución',
      paragraphs: [
        requestSummary,
        'Los siguientes pasos describen cómo se evaluaría una solicitud, no un trámite habilitado en este sitio. No se solicitan números de tarjeta, CVV, cuentas bancarias ni otros datos financieros para esta demostración.',
      ],
      ordered: true,
      items: [
        'Identifica tu compra. Consulta la confirmación y toma como referencia el número de orden; señala el nombre o identificador del producto y la cantidad involucrada.',
        'Prepara la información. Reúne la fecha de entrega del caso hipotético, el motivo, el estado del artículo y la relación de componentes y accesorios. Si hay una falla, describe qué ocurre y cuándo se presenta.',
        'Presenta la solicitud cuando exista un canal de atención publicado. Actualmente no hay correo, teléfono, formulario ni servicio operativo de devoluciones en CiberNova. En una evaluación de laboratorio, estos datos solo forman parte del caso de prueba; no se envían desde esta página.',
        'Revisa las condiciones. En la simulación se comprobarían la referencia de compra, el plazo y el estado del producto, diferenciando la devolución voluntaria de los reclamos por defectos o funcionamiento.',
        'Consulta la decisión. Si se habilitara un canal de atención, por ese mismo medio se comunicarían la aceptación o el rechazo con su explicación y cualquier información pendiente. La plataforma actual no emite estas decisiones ni hace seguimiento de solicitudes.',
        'Después de una aprobación, espera instrucciones específicas antes de entregar o enviar un producto. La demostración solo describe la revisión del conjunto y el acuerdo sobre los siguientes pasos; no coordina recogidas, genera etiquetas ni promete reembolsos bancarios reales.',
      ],
    },
  ],
}
