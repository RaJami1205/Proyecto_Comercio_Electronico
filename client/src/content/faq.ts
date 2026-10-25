/** Contenido estático de Preguntas Frecuentes. Las respuestas son breves y
 * remiten a la política comercial correspondiente en vez de duplicar su
 * texto, manteniendo una única fuente de verdad para cada condición.
 *
 * Los valores de `relatedPolicy.view` usan los literales reales de
 * PolicyView definidos en policyDestinations (utils/appNavigation.ts):
 * 'terms' | 'returns-policy' | 'shipping-policy' | 'privacy-policy' | 'faq'.
 */
import type { PolicyView } from '../utils/appNavigation'

export type FaqCategory = 'compras' | 'pagos' | 'envios' | 'devoluciones' | 'privacidad' | 'atencion-cliente'

export interface FaqRelatedPolicy {
  readonly label: string
  readonly view: PolicyView
}

export interface FaqEntry {
  readonly id: string
  readonly question: string
  readonly category: FaqCategory
  readonly paragraphs: readonly string[]
  readonly relatedPolicy?: FaqRelatedPolicy
}

export const faqEntries: readonly FaqEntry[] = [
  {
    id: 'faq-compra',
    question: '¿Cómo puedo realizar una compra en CiberNova?',
    category: 'compras',
    paragraphs: [
      'Explora el catálogo y agrega los productos que te interesen al Shopping Cart, ajustando las cantidades que necesites.',
      'Cuando estés listo, continúa a Checkout: ahí se revisan los datos del comprador, la dirección de entrega y los artículos antes de generar la Order. El servidor calcula el subtotal, el IVA, el envío y el total definitivos.',
      'Revisa cuidadosamente esa información antes de confirmar: una vez generada la Order, su resumen es la referencia vigente de la compra.',
    ],
    relatedPolicy: { label: 'Ver Términos y condiciones', view: 'terms' as PolicyView },
  },
  {
    id: 'faq-pagos',
    question: '¿Qué métodos de pago acepta CiberNova?',
    category: 'pagos',
    paragraphs: [
      'CiberNova utiliza un Payment Sandbox académico: un entorno de simulación que reproduce tres resultados posibles (pago aprobado, pago rechazado y error del servicio) sin conectarse a ningún banco o pasarela real.',
      'No se realizan cargos, transferencias ni verificaciones bancarias. Los campos de tarjeta que aparecen en el Checkout son únicamente demostrativos: no se envían a ningún servidor ni se almacenan en ningún lugar.',
    ],
    relatedPolicy: { label: 'Ver Términos y condiciones', view: 'terms' as PolicyView },
  },
  {
    id: 'faq-costo-envio',
    question: '¿Cuánto cuesta el envío de un pedido?',
    category: 'envios',
    paragraphs: [
      'Se aplica una tarifa estándar de ₡3 500 cuando el subtotal de la compra, redondeado al colón, es menor a ₡100 000.',
      'El envío es gratuito (₡0) cuando ese subtotal es igual o superior a ₡100 000. Si el carrito no tiene productos con subtotal positivo, no se calcula ningún costo de envío.',
    ],
    relatedPolicy: { label: 'Ver Política de Envíos', view: 'shipping-policy' as PolicyView },
  },
  {
    id: 'faq-tiempos-entrega',
    question: '¿Cuánto tiempo tarda en llegar un pedido?',
    category: 'envios',
    paragraphs: [
      'Dentro de la Gran Área Metropolitana (GAM), el tiempo estimado es de 2 a 5 días hábiles. Fuera de la GAM, de 3 a 7 días hábiles.',
      'Estos plazos son estimaciones comerciales simuladas para fines académicos: CiberNova no gestiona entregas físicas reales.',
    ],
    relatedPolicy: { label: 'Ver Política de Envíos', view: 'shipping-policy' as PolicyView },
  },
  {
    id: 'faq-devoluciones',
    question: '¿Cómo puedo solicitar la devolución de un producto?',
    category: 'devoluciones',
    paragraphs: [
      'La política académica contempla un plazo de 15 días naturales desde la entrega del producto para presentar una solicitud de devolución voluntaria, identificando la compra, el producto y el motivo.',
      'Actualmente no existe un canal operativo de devoluciones: el procedimiento se presenta como demostración. Consulta la política completa para conocer las condiciones, exclusiones y el detalle de cada paso.',
    ],
    relatedPolicy: { label: 'Ver Política de Devoluciones', view: 'returns-policy' as PolicyView },
  },
  {
    id: 'faq-privacidad',
    question: '¿Cómo utiliza CiberNova mi información durante una compra?',
    category: 'privacidad',
    paragraphs: [
      'Los datos de comprador y entrega que ingresas en Checkout se usan únicamente para preparar y generar la Order correspondiente.',
      'El Shopping Cart se guarda con persistencia local en tu navegador, y las Orders del entorno académico se conservan temporalmente según la arquitectura actual del servidor, no de forma permanente.',
    ],
    relatedPolicy: { label: 'Ver Política de Privacidad', view: 'privacy-policy' as PolicyView },
  },
  {
    id: 'faq-atencion-cliente',
    question: '¿Cómo puedo contactar con CiberNova si tengo una consulta?',
    category: 'atencion-cliente',
    paragraphs: [
      'CiberNova es un proyecto académico y actualmente no cuenta con un canal operativo de soporte: no existen un correo, teléfono o formulario de atención real asociados a la plataforma.',
      'Cualquier consulta sobre el funcionamiento del sitio puede dirigirse al equipo del curso en el contexto de la evaluación académica correspondiente.',
    ],
  },
]