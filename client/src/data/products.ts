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

export interface Product {
  id: string
  name: string
  image: string
  price: number
  inStock: boolean
  category: ProductCategory
}

export const products: Product[] = [
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
]
