import cabinetImage from '../assets/products/cabinet.svg'
import gpuImage from '../assets/products/gpu.svg'
import headphonesImage from '../assets/products/headphones.svg'
import keyboardImage from '../assets/products/keyboard.svg'
import laptopImage from '../assets/products/laptop.svg'
import memoryImage from '../assets/products/memory.svg'
import monitorImage from '../assets/products/monitor.svg'
import mouseImage from '../assets/products/mouse.svg'
import routerImage from '../assets/products/router.svg'
import smartphoneImage from '../assets/products/smartphone.svg'
import ssdImage from '../assets/products/ssd.svg'
import webcamImage from '../assets/products/webcam.svg'

export type ProductCategory =
  | 'Laptop'
  | 'Monitor'
  | 'Mouse'
  | 'Teclado'
  | 'SSD'
  | 'GPU'
  | 'Audífonos'
  | 'Smartphone'
  | 'Memoria RAM'
  | 'Router'
  | 'Webcam'
  | 'Gabinete'

export interface ProductSpecification {
  label: string
  value: string
}

export interface Product {
  id: string
  name: string
  image: string
  price: number
  inStock: boolean
  category: ProductCategory
  description: string
  specifications: ProductSpecification[]
}

type ProductSummary = Omit<Product, 'description' | 'specifications'>
type ProductDetails = Pick<Product, 'description' | 'specifications'>

const productSummaries = [
  { id: 'laptop-01', name: 'Laptop NovaBook Air 14', image: laptopImage, price: 899, inStock: true, category: 'Laptop' },
  { id: 'laptop-02', name: 'Laptop Vector Pro 16 para creación y productividad', image: laptopImage, price: 1499, inStock: true, category: 'Laptop' },
  { id: 'laptop-03', name: 'Laptop Pulse 15', image: laptopImage, price: 1099, inStock: false, category: 'Laptop' },
  { id: 'monitor-01', name: 'Monitor Horizon QHD 27', image: monitorImage, price: 329, inStock: true, category: 'Monitor' },
  { id: 'monitor-02', name: 'Monitor Orbit UltraWide 34', image: monitorImage, price: 649, inStock: true, category: 'Monitor' },
  { id: 'monitor-03', name: 'Monitor Flux IPS 24', image: monitorImage, price: 199, inStock: false, category: 'Monitor' },
  { id: 'mouse-01', name: 'Mouse inalámbrico Nebula S', image: mouseImage, price: 49, inStock: true, category: 'Mouse' },
  { id: 'mouse-02', name: 'Mouse ergonómico Vector Lift', image: mouseImage, price: 79, inStock: true, category: 'Mouse' },
  { id: 'mouse-03', name: 'Mouse gaming Pulse RGB', image: mouseImage, price: 59, inStock: true, category: 'Mouse' },
  { id: 'keyboard-01', name: 'Teclado mecánico NovaKey TKL', image: keyboardImage, price: 109, inStock: true, category: 'Teclado' },
  { id: 'keyboard-02', name: 'Teclado inalámbrico SlimWave', image: keyboardImage, price: 69, inStock: false, category: 'Teclado' },
  { id: 'keyboard-03', name: 'Teclado compacto Orbit 65', image: keyboardImage, price: 89, inStock: true, category: 'Teclado' },
  { id: 'ssd-01', name: 'SSD NVMe Vector 1 TB', image: ssdImage, price: 99, inStock: true, category: 'SSD' },
  { id: 'ssd-02', name: 'SSD portátil Flux 2 TB USB-C', image: ssdImage, price: 169, inStock: true, category: 'SSD' },
  { id: 'ssd-03', name: 'SSD SATA NovaDrive 480 GB', image: ssdImage, price: 49, inStock: true, category: 'SSD' },
  { id: 'gpu-01', name: 'Tarjeta gráfica Nova RTX 4070 12 GB', image: gpuImage, price: 599, inStock: true, category: 'GPU' },
  { id: 'gpu-02', name: 'Tarjeta gráfica Vector RX 7800 XT', image: gpuImage, price: 549, inStock: false, category: 'GPU' },
  { id: 'gpu-03', name: 'Tarjeta gráfica Pulse Arc 16 GB', image: gpuImage, price: 429, inStock: true, category: 'GPU' },
  { id: 'headphones-01', name: 'Audífonos inalámbricos Halo ANC', image: headphonesImage, price: 149, inStock: true, category: 'Audífonos' },
  { id: 'headphones-02', name: 'Headset gaming Nebula 7.1', image: headphonesImage, price: 99, inStock: true, category: 'Audífonos' },
  { id: 'headphones-03', name: 'Audífonos compactos Flux Buds', image: headphonesImage, price: 79, inStock: false, category: 'Audífonos' },
  { id: 'smartphone-01', name: 'Smartphone Nova One 256 GB', image: smartphoneImage, price: 699, inStock: true, category: 'Smartphone' },
  { id: 'smartphone-02', name: 'Smartphone Orbit Max 512 GB', image: smartphoneImage, price: 949, inStock: true, category: 'Smartphone' },
  { id: 'smartphone-03', name: 'Smartphone Pulse Mini 128 GB', image: smartphoneImage, price: 499, inStock: true, category: 'Smartphone' },
  { id: 'memory-01', name: 'Memoria RAM Vector DDR5 32 GB', image: memoryImage, price: 129, inStock: true, category: 'Memoria RAM' },
  { id: 'memory-02', name: 'Kit RAM Nova DDR4 16 GB', image: memoryImage, price: 69, inStock: true, category: 'Memoria RAM' },
  { id: 'memory-03', name: 'Memoria RAM Orbit RGB 64 GB', image: memoryImage, price: 249, inStock: false, category: 'Memoria RAM' },
  { id: 'router-01', name: 'Router Wi-Fi 6 Mesh Halo AX3000', image: routerImage, price: 189, inStock: true, category: 'Router' },
  { id: 'router-02', name: 'Router compacto NovaLink AX1800', image: routerImage, price: 109, inStock: true, category: 'Router' },
  { id: 'router-03', name: 'Sistema Mesh Vector Pro de tres nodos', image: routerImage, price: 279, inStock: true, category: 'Router' },
  { id: 'webcam-01', name: 'Webcam Orbit 4K con enfoque automático', image: webcamImage, price: 139, inStock: true, category: 'Webcam' },
  { id: 'webcam-02', name: 'Webcam NovaView Full HD', image: webcamImage, price: 69, inStock: false, category: 'Webcam' },
  { id: 'webcam-03', name: 'Webcam Flux Stream 2K', image: webcamImage, price: 99, inStock: true, category: 'Webcam' },
  { id: 'cabinet-01', name: 'Gabinete Nova Core Airflow', image: cabinetImage, price: 119, inStock: true, category: 'Gabinete' },
  { id: 'cabinet-02', name: 'Gabinete Vector Glass ATX', image: cabinetImage, price: 149, inStock: true, category: 'Gabinete' },
  { id: 'cabinet-03', name: 'Gabinete compacto Orbit Mini', image: cabinetImage, price: 99, inStock: true, category: 'Gabinete' },
] as const satisfies readonly ProductSummary[]

type ProductId = (typeof productSummaries)[number]['id']

function createDetails(
  description: string,
  specifications: Array<[label: string, value: string]>,
): ProductDetails {
  return {
    description,
    specifications: specifications.map(([label, value]) => ({ label, value })),
  }
}

const productDetails = {
  'laptop-01': createDetails(
    'Portátil ligera para estudio, trabajo diario y movilidad, con autonomía pensada para acompañar toda la jornada.',
    [['Procesador', 'Ryzen 5, 8 núcleos'], ['Memoria', '16 GB DDR5'], ['Almacenamiento', '512 GB SSD NVMe'], ['Pantalla', '14" IPS Full HD'], ['Conectividad', 'Wi-Fi 6 y Bluetooth 5.3']],
  ),
  'laptop-02': createDetails(
    'Estación portátil de alto rendimiento para creación de contenido, multitarea exigente y productividad profesional.',
    [['Procesador', 'Ryzen 7, 12 núcleos'], ['Memoria', '32 GB DDR5'], ['Almacenamiento', '1 TB SSD NVMe'], ['Pantalla', '16" QHD 120 Hz'], ['Gráficos', 'GPU dedicada 8 GB']],
  ),
  'laptop-03': createDetails(
    'Equipo versátil para entretenimiento y productividad que equilibra una pantalla fluida con potencia portátil.',
    [['Procesador', 'Core 7, 10 núcleos'], ['Memoria', '16 GB DDR5'], ['Almacenamiento', '1 TB SSD NVMe'], ['Pantalla', '15.6" IPS 144 Hz'], ['Conectividad', 'Wi-Fi 6E y Bluetooth 5.3']],
  ),
  'monitor-01': createDetails(
    'Monitor QHD de alta fluidez para trabajar con detalle, disfrutar contenido y jugar con una respuesta precisa.',
    [['Panel', 'IPS de 27"'], ['Resolución', '2560 × 1440'], ['Frecuencia', '165 Hz'], ['Respuesta', '1 ms'], ['Puertos', 'HDMI y DisplayPort']],
  ),
  'monitor-02': createDetails(
    'Pantalla ultrapanorámica para ampliar el espacio de trabajo y disfrutar una experiencia visual envolvente.',
    [['Panel', 'VA de 34"'], ['Resolución', '3440 × 1440'], ['Frecuencia', '144 Hz'], ['Curvatura', '1500R'], ['Puertos', 'USB-C, HDMI y DisplayPort']],
  ),
  'monitor-03': createDetails(
    'Monitor compacto con colores consistentes para oficinas, aulas y estaciones de trabajo de uso diario.',
    [['Panel', 'IPS de 24"'], ['Resolución', '1920 × 1080'], ['Frecuencia', '100 Hz'], ['Respuesta', '5 ms'], ['Puertos', 'HDMI y DisplayPort']],
  ),
  'mouse-01': createDetails(
    'Mouse inalámbrico preciso y ligero para alternar con comodidad entre trabajo creativo y uso cotidiano.',
    [['Sensor', 'Óptico de 16 000 DPI'], ['Conexión', '2.4 GHz y Bluetooth'], ['Botones', '6 programables'], ['Autonomía', 'Hasta 70 horas'], ['Peso', '78 g']],
  ),
  'mouse-02': createDetails(
    'Diseño vertical que favorece una postura natural durante jornadas prolongadas de oficina y navegación.',
    [['Sensor', 'Óptico de 4 000 DPI'], ['Conexión', '2.4 GHz y Bluetooth'], ['Botones', '6 botones'], ['Diseño', 'Vertical ergonómico'], ['Autonomía', 'Hasta 5 meses']],
  ),
  'mouse-03': createDetails(
    'Mouse con respuesta rápida e iluminación configurable para sesiones de juego y tareas de alta precisión.',
    [['Sensor', 'Óptico de 12 000 DPI'], ['Conexión', 'USB cableado'], ['Botones', '7 programables'], ['Sondeo', '1 000 Hz'], ['Iluminación', 'RGB configurable']],
  ),
  'keyboard-01': createDetails(
    'Teclado mecánico sin bloque numérico que libera espacio sin renunciar a una escritura firme y precisa.',
    [['Interruptores', 'Mecánicos lineales'], ['Formato', 'TKL'], ['Conexión', 'USB-C desmontable'], ['Iluminación', 'RGB por tecla'], ['Distribución', 'Español']],
  ),
  'keyboard-02': createDetails(
    'Teclado de perfil bajo y funcionamiento silencioso para escritorios limpios y trabajo híbrido.',
    [['Teclas', 'Membrana silenciosa'], ['Formato', 'Completo'], ['Conexión', 'Bluetooth y 2.4 GHz'], ['Autonomía', 'Hasta 6 meses'], ['Distribución', 'Español']],
  ),
  'keyboard-03': createDetails(
    'Formato compacto para espacios reducidos, con respuesta táctil y personalización pensada para entusiastas.',
    [['Interruptores', 'Mecánicos táctiles'], ['Formato', '65 %'], ['Conexión', 'USB-C desmontable'], ['Intercambio', 'Hot-swap'], ['Iluminación', 'RGB configurable']],
  ),
  'ssd-01': createDetails(
    'Unidad interna de alta velocidad para acelerar el sistema, las aplicaciones y las cargas de archivos pesados.',
    [['Capacidad', '1 TB'], ['Interfaz', 'PCIe 4.0 NVMe'], ['Lectura', 'Hasta 5 000 MB/s'], ['Formato', 'M.2 2280'], ['Memoria', 'NAND 3D']],
  ),
  'ssd-02': createDetails(
    'Almacenamiento portátil veloz para trasladar proyectos, bibliotecas multimedia y respaldos entre equipos.',
    [['Capacidad', '2 TB'], ['Interfaz', 'USB 3.2 Gen 2x2'], ['Lectura', 'Hasta 2 000 MB/s'], ['Conector', 'USB-C'], ['Construcción', 'Aluminio compacto']],
  ),
  'ssd-03': createDetails(
    'Alternativa accesible para renovar computadoras compatibles y mejorar notablemente su respuesta cotidiana.',
    [['Capacidad', '480 GB'], ['Interfaz', 'SATA III'], ['Lectura', 'Hasta 550 MB/s'], ['Formato', '2.5 pulgadas'], ['Memoria', 'NAND 3D']],
  ),
  'gpu-01': createDetails(
    'Gráficos de alto rendimiento para juegos en alta resolución, creación visual y flujos acelerados.',
    [['Memoria', '12 GB GDDR6X'], ['Interfaz', 'PCIe 4.0'], ['Salidas', '3 × DP y 1 × HDMI'], ['Refrigeración', 'Triple ventilador'], ['Fuente sugerida', '650 W']],
  ),
  'gpu-02': createDetails(
    'Tarjeta preparada para experiencias fluidas en QHD y cargas creativas con abundante memoria gráfica.',
    [['Memoria', '16 GB GDDR6'], ['Interfaz', 'PCIe 4.0'], ['Salidas', '3 × DP y 1 × HDMI'], ['Refrigeración', 'Triple ventilador'], ['Fuente sugerida', '700 W']],
  ),
  'gpu-03': createDetails(
    'Solución gráfica versátil para edición, transmisión y juegos modernos con amplia memoria de video.',
    [['Memoria', '16 GB GDDR6'], ['Interfaz', 'PCIe 4.0'], ['Salidas', '3 × DP y 1 × HDMI'], ['Refrigeración', 'Doble ventilador'], ['Fuente sugerida', '600 W']],
  ),
  'headphones-01': createDetails(
    'Audífonos envolventes con cancelación activa para concentrarse, viajar o disfrutar música con comodidad.',
    [['Formato', 'Over-ear'], ['Conexión', 'Bluetooth 5.3'], ['Cancelación', 'Activa híbrida'], ['Autonomía', 'Hasta 40 horas'], ['Carga', 'USB-C']],
  ),
  'headphones-02': createDetails(
    'Headset cómodo con sonido posicional y micrófono claro para juego coordinado y comunicación en línea.',
    [['Formato', 'Over-ear'], ['Conexión', 'USB cableado'], ['Audio', 'Virtual 7.1'], ['Micrófono', 'Retráctil'], ['Iluminación', 'RGB lateral']],
  ),
  'headphones-03': createDetails(
    'Auriculares compactos para música y llamadas diarias, con estuche de carga fácil de transportar.',
    [['Formato', 'In-ear'], ['Conexión', 'Bluetooth 5.3'], ['Autonomía', '6 + 24 horas'], ['Resistencia', 'IPX4'], ['Carga', 'USB-C']],
  ),
  'smartphone-01': createDetails(
    'Smartphone equilibrado para fotografía, entretenimiento y multitarea con conectividad de nueva generación.',
    [['Pantalla', '6.4" OLED 120 Hz'], ['Memoria', '8 GB'], ['Almacenamiento', '256 GB'], ['Cámara principal', '50 MP'], ['Conectividad', '5G y Wi-Fi 6']],
  ),
  'smartphone-02': createDetails(
    'Pantalla amplia, gran capacidad y cámara avanzada para usuarios que concentran su día en el teléfono.',
    [['Pantalla', '6.8" AMOLED 120 Hz'], ['Memoria', '12 GB'], ['Almacenamiento', '512 GB'], ['Cámara principal', '108 MP'], ['Conectividad', '5G y Wi-Fi 6E']],
  ),
  'smartphone-03': createDetails(
    'Teléfono compacto que conserva una experiencia ágil, buena cámara y conectividad moderna.',
    [['Pantalla', '6.1" OLED 90 Hz'], ['Memoria', '6 GB'], ['Almacenamiento', '128 GB'], ['Cámara principal', '48 MP'], ['Conectividad', '5G y Wi-Fi 6']],
  ),
  'memory-01': createDetails(
    'Kit de memoria veloz para ampliar la capacidad de equipos modernos y sostener multitarea exigente.',
    [['Capacidad', '32 GB (2 × 16 GB)'], ['Tipo', 'DDR5'], ['Frecuencia', '6 000 MHz'], ['Formato', 'DIMM'], ['Voltaje', '1.35 V']],
  ),
  'memory-02': createDetails(
    'Actualización práctica para computadoras DDR4 que necesitan mayor fluidez en aplicaciones cotidianas.',
    [['Capacidad', '16 GB (2 × 8 GB)'], ['Tipo', 'DDR4'], ['Frecuencia', '3 200 MHz'], ['Formato', 'DIMM'], ['Voltaje', '1.35 V']],
  ),
  'memory-03': createDetails(
    'Memoria de gran capacidad con iluminación sutil para estaciones creativas y equipos de alto desempeño.',
    [['Capacidad', '64 GB (2 × 32 GB)'], ['Tipo', 'DDR5'], ['Frecuencia', '5 600 MHz'], ['Formato', 'DIMM'], ['Voltaje', '1.25 V'], ['Iluminación', 'RGB configurable']],
  ),
  'router-01': createDetails(
    'Router de alto alcance que combina velocidad Wi-Fi 6 y capacidad Mesh para hogares conectados.',
    [['Estándar', 'Wi-Fi 6'], ['Velocidad', 'AX3000'], ['Bandas', 'Dual Band'], ['Puertos', '4 × Gigabit'], ['Cobertura', 'Compatible con Mesh']],
  ),
  'router-02': createDetails(
    'Conectividad estable en un formato discreto para apartamentos y hogares con múltiples dispositivos.',
    [['Estándar', 'Wi-Fi 6'], ['Velocidad', 'AX1800'], ['Bandas', 'Dual Band'], ['Puertos', '4 × Gigabit'], ['Cobertura', 'Hasta 180 m²']],
  ),
  'router-03': createDetails(
    'Sistema de tres nodos para extender una red uniforme a viviendas amplias sin perder continuidad.',
    [['Estándar', 'Wi-Fi 6'], ['Velocidad', 'AX5400'], ['Bandas', 'Tri Band'], ['Puertos', '3 × Gigabit por nodo'], ['Cobertura', 'Hasta 500 m²']],
  ),
  'webcam-01': createDetails(
    'Cámara nítida para videollamadas y contenido en alta resolución, con enfoque automático preciso.',
    [['Resolución', '4K a 30 fps'], ['Sensor', '8 MP'], ['Enfoque', 'Automático'], ['Micrófonos', 'Estéreo'], ['Conexión', 'USB-C']],
  ),
  'webcam-02': createDetails(
    'Webcam sencilla para clases y reuniones, con imagen Full HD y configuración inmediata.',
    [['Resolución', '1080p a 30 fps'], ['Sensor', '2 MP'], ['Enfoque', 'Fijo'], ['Micrófono', 'Integrado mono'], ['Conexión', 'USB-A']],
  ),
  'webcam-03': createDetails(
    'Webcam fluida para streaming y colaboración, con resolución 2K y audio estéreo integrado.',
    [['Resolución', '1440p a 60 fps'], ['Sensor', '4 MP'], ['Enfoque', 'Automático'], ['Micrófonos', 'Estéreo'], ['Conexión', 'USB-C']],
  ),
  'cabinet-01': createDetails(
    'Gabinete ventilado para equipos de alto desempeño, con espacio amplio y frontal de malla.',
    [['Compatibilidad', 'ATX, mATX y Mini-ITX'], ['Frontal', 'Malla de alto flujo'], ['Ventiladores', '3 incluidos'], ['GPU máxima', '380 mm'], ['Panel lateral', 'Vidrio templado']],
  ),
  'cabinet-02': createDetails(
    'Chasis amplio con paneles de vidrio e iluminación integrada para una construcción limpia y visible.',
    [['Compatibilidad', 'ATX y mATX'], ['Paneles', 'Vidrio frontal y lateral'], ['Ventiladores', '4 ARGB incluidos'], ['GPU máxima', '400 mm'], ['Radiador', 'Hasta 360 mm']],
  ),
  'cabinet-03': createDetails(
    'Gabinete compacto para construir equipos eficientes cuando el espacio del escritorio es limitado.',
    [['Compatibilidad', 'mATX y Mini-ITX'], ['Frontal', 'Malla compacta'], ['Ventiladores', '2 incluidos'], ['GPU máxima', '320 mm'], ['Radiador', 'Hasta 240 mm']],
  ),
} satisfies Record<ProductId, ProductDetails>

export const products: Product[] = productSummaries.map((product) => ({
  ...product,
  ...productDetails[product.id],
}))
