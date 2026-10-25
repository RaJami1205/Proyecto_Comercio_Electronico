/** Fuente única para la página pública y TermsDialog de Checkout.
 * Cada cambio comercial debe publicar una nueva versión junto con su contenido.
 */
export interface TermsSection {
  readonly id: string
  readonly title: string
  readonly paragraphs: readonly string[]
  readonly items?: readonly string[]
}

export interface TermsPolicy {
  readonly version: string
  readonly publishedAt: string
  readonly title: string
  readonly introduction: string
  readonly sections: readonly TermsSection[]
}

export const termsPolicy: TermsPolicy = {
  version: '2026-10-lab4-v1',
  publishedAt: '2026-10-21',
  title: 'Términos y condiciones',
  introduction: 'Conoce las reglas de uso de CiberNova, cómo funciona la compra demostrativa y las responsabilidades de quienes participan. Estos términos describen el alcance académico de la plataforma.',
  sections: [
    {
      id: 'site-use',
      title: 'Condiciones de uso del sitio',
      paragraphs: [
        'CiberNova es un proyecto académico de comercio electrónico dedicado a tecnología, computación y electrónica. El catálogo, el carrito y Checkout permiten explorar y evaluar una experiencia de compra; no constituyen un servicio de venta, cobro bancario o distribución física de productos.',
        'Utiliza el catálogo para consultar y comparar productos, y las herramientas de compra para gestionar tu selección. Usa las funcionalidades de forma responsable: no intentes alterar precios o estados, interferir con el servicio ni introducir datos financieros reales. Para las evaluaciones utiliza datos ficticios de comprador y entrega.',
      ],
    },
    {
      id: 'purchase-conditions',
      title: 'Condiciones generales de compra',
      paragraphs: [
        'Los precios y la disponibilidad se consultan en el catálogo. El carrito permite agregar o retirar productos y ajustar cantidades; sus montos son una referencia previa. Antes de confirmar, revisa los artículos, las cantidades, los datos del comprador y la dirección de entrega.',
        'Al confirmar la revisión se solicita una Order al servidor. El servidor verifica los productos, resuelve sus precios y calcula el subtotal, el IVA, el envío aplicable y el total en colones costarricenses (CRC). El resumen de la Order es la referencia vigente de esa compra y puede diferir del carrito si cambió la información del catálogo. La generación puede rechazarse si hay datos inválidos o productos inexistentes.',
        'El costo de envío que aparece en el resumen es parte de la simulación. Ingresar una dirección o generar una Order no programa una entrega ni garantiza disponibilidad física, reserva de inventario o despacho.',
        'El Payment Sandbox simula tres resultados: pago aprobado, pago rechazado y error del servicio. No realiza cargos, transferencias ni operaciones bancarias, y no requiere tarjeta, CVV ni cuentas bancarias. Una aprobación simulada confirma la Order; un rechazo o error la mantiene pendiente y permite un nuevo intento sobre esa misma orden.',
        'La confirmación de compra se muestra cuando el servidor devuelve una Order confirmada con el pago simulado aprobado. Resume esa operación de demostración; no es prueba de un cobro real, una factura fiscal ni una promesa de entrega. Crear una Order pendiente, por sí solo, no equivale a una compra confirmada.',
      ],
    },
    {
      id: 'customer-responsibilities',
      title: 'Responsabilidades del cliente',
      paragraphs: ['Para participar de forma responsable en la experiencia de compra, te corresponde:'],
      items: [
        'Proporcionar datos de prueba completos y coherentes en Checkout y verificar el correo, el teléfono y la dirección de entrega antes de confirmar.',
        'Revisar los productos, las cantidades y los montos de la Order, incluidos el IVA y el costo de envío presentado.',
        'Consultar los términos y las políticas comerciales disponibles, y utilizar los controles de compra y pago simulado sin intentar eludir sus validaciones.',
        'Cuando se incorpore la aceptación expresa de términos en Checkout, revisar y aceptar la versión presentada antes de generar una nueva Order. Esta página informativa no implementa todavía ese mecanismo ni registra una aceptación por el hecho de visitarla.',
      ],
    },
    {
      id: 'cibernova-responsibilities',
      title: 'Responsabilidades de CiberNova',
      paragraphs: [
        'Dentro del alcance académico, CiberNova presenta información comprensible de los productos, sus precios y disponibilidad de catálogo. Ofrece un resumen de compra con los importes calculados por el servidor e informa los costos de envío aplicables dentro de la simulación.',
        'La plataforma muestra los resultados del pago simulado y, cuando corresponde, la confirmación de la Order. Mantiene accesibles las páginas comerciales y procura una navegación clara y consistente, con contenido legible y controles accesibles.',
        'Los datos y las funcionalidades del proyecto pueden actualizarse durante su desarrollo. CiberNova no promete pagos bancarios reales, envíos físicos, garantías técnicas ni otros servicios comerciales que no estén implementados. Si una operación falla, revisa el mensaje presentado antes de continuar o reintentar.',
      ],
    },
  ],
}
