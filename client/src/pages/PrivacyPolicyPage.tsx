import React from 'react';
import PolicyLayout from '../components/policies/PolicyLayout';
import PolicySection from '../components/policies/PolicySection';
import { isSameTabNavigation } from '../utils/appNavigation';
import type { AppView, CatalogHash } from '../utils/appNavigation';

interface PrivacyPolicyPageProps {
  onCatalogClick: (hash?: CatalogHash) => void;
  onCartClick: () => void;
  onPolicyNavigate: (view: AppView) => void;
}

export const PrivacyPolicyPage: React.FC<PrivacyPolicyPageProps> = ({
  onCatalogClick,
  onCartClick,
  onPolicyNavigate
}) => {
  return (
    <PolicyLayout
      title="Política de Privacidad"
      onCatalogClick={onCatalogClick}
      onCartClick={onCartClick}
      onPolicyNavigate={onPolicyNavigate}
    >
      <PolicySection title="1. Transparencia y Carácter Académico">
        <p>
          CiberNova es una plataforma desarrollada exclusivamente para fines académicos. El entorno utiliza datos de compra con fines demostrativos, los pagos son simulados y no existe una pasarela bancaria real. El almacenamiento de las órdenes es temporal según la arquitectura vigente de la aplicación.
        </p>
      </PolicySection>

      <PolicySection title="2. Información Utilizada y Finalidades">
        <p>CiberNova procesa información temporalmente para las siguientes funcionalidades:</p>
        <ul>
          <li><strong>Navegación y Catálogo:</strong> Las consultas de búsqueda introducidas, filtros y sugerencias se utilizan para permitir la visualización de productos. El historial de búsquedas recientes utiliza memoria temporal de la aplicación.</li>
          <li><strong>Shopping Cart:</strong> Se procesan identificadores de productos, precios y cantidades para mantener la continuidad de tu compra.</li>
          <li><strong>Checkout (Buyer y Delivery):</strong> Los datos de identificación, contacto y entrega introducidos en los formularios se utilizan únicamente para preparar y generar la orden (Order) simulada correspondiente.</li>
          <li><strong>Gestión de Orders:</strong> El servidor recibe la información del Checkout y los importes financieros para registrar los estados transaccionales y aplicar reglas de idempotencia.</li>
          <li><strong>Payment Sandbox:</strong> El sistema de pagos simula escenarios de aprobación o rechazo (Approved, Declined, Error). No se procesan transacciones bancarias reales ni se almacenan tarjetas, CVV o credenciales bancarias en nuestro backend.</li>
        </ul>
      </PolicySection>

      <PolicySection title="3. Mecanismos de Almacenamiento">
        <p>La plataforma diferencia los siguientes mecanismos de almacenamiento de acuerdo con su arquitectura técnica:</p>
        <ul>
          <li><strong>Almacenamiento local del navegador:</strong> El Shopping Cart utiliza <em>localStorage</em> para conservar su contenido entre recargas. Este almacenamiento no está cifrado y no sincroniza datos transaccionales entre dispositivos.</li>
          <li><strong>Estado temporal del Client:</strong> Los datos introducidos en los formularios de Checkout y las búsquedas recientes se mantienen en la memoria temporal de la interfaz (React State).</li>
          <li><strong>Almacenamiento temporal del Server:</strong> Las órdenes (Orders) se procesan en la memoria temporal del servidor (InMemoryOrderStore). Este mecanismo no es una base de datos permanente, por lo que las órdenes dejan de estar disponibles al reiniciar el proceso del servidor.</li>
        </ul>
        <p>
          <strong>Eliminación de datos:</strong> La información del carrito se limpia automáticamente después de una compra confirmada. Los estados temporales desaparecen al reiniciar el navegador o el servidor.
        </p>
      </PolicySection>

      <PolicySection title="4. Medidas Básicas de Protección">
        <p>
          Aunque CiberNova opera en un entorno académico, aplica prácticas técnicas básicas de seguridad: separación de responsabilidades entre el cliente (Client) y el servidor (Server), validación de solicitudes y contratos transaccionales en el backend, restricción de acceso mediante configuración CORS, y protección de credenciales sensibles (como las de Algolia) utilizando variables de entorno.
        </p>
      </PolicySection>

      <PolicySection title="5. Servicios Externos Utilizados">
        <p>La operación de CiberNova se apoya en los siguientes servicios de infraestructura:</p>
        <ul>
          <li><strong>Algolia:</strong> Motor utilizado para las búsquedas del catálogo. Solo se envían consultas de productos; no se envían datos personales del Checkout a este servicio.</li>
          <li><strong>GitHub Pages:</strong> Plataforma utilizada para el alojamiento y despliegue de la interfaz web (Frontend).</li>
          <li><strong>Render:</strong> Servicio utilizado para el alojamiento del servidor (Backend).</li>
        </ul>
      </PolicySection>

      <PolicySection title="6. Consultas de Privacidad">
        <p>
          Dado que CiberNova es un proyecto de demostración académica, no contamos con departamentos operativos de protección de datos, correos electrónicos oficiales de soporte, ni sistemas automatizados para la gestión de derechos ARCO. La información introducida no tiene impacto comercial real.
        </p>
      </PolicySection>

      <PolicySection title="7. Volver al catálogo">
        <a href="#catalog" onClick={event => {
          if (!isSameTabNavigation(event)) return
          event.preventDefault()
          onCatalogClick('#catalog')
        }}>Volver al catálogo</a>
      </PolicySection>
    </PolicyLayout>
  );
};