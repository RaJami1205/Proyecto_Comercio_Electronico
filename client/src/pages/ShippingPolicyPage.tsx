/** Presenta condiciones informativas de envío; los cálculos transaccionales viven en las utilidades financieras. */
import React from 'react';
import PolicyLayout from '../components/policies/PolicyLayout';
import PolicySection from '../components/policies/PolicySection';
import { isSameTabNavigation } from '../utils/appNavigation';
import type { AppView, CatalogHash } from '../utils/appNavigation';

interface ShippingPolicyPageProps {
  onCatalogClick: (hash?: CatalogHash) => void;
  onCartClick: () => void;
  onPolicyNavigate: (view: AppView) => void;
}

/** Delega los destinos al propietario de navegación sin gestionar entregas ni modificar Orders. */
export const ShippingPolicyPage: React.FC<ShippingPolicyPageProps> = ({
  onCatalogClick,
  onCartClick,
  onPolicyNavigate
}) => {
  return (
    <PolicyLayout
      title="Política de Envíos"
      onCatalogClick={onCatalogClick}
      onCartClick={onCartClick}
      onPolicyNavigate={onPolicyNavigate}
    >

      <PolicySection title="1. Condiciones Generales">
        <p>
          La presente política describe las condiciones comerciales simuladas de entrega para los productos de tecnología, computación y electrónica disponibles en CiberNova. Actualmente no existe integración con operadores logísticos ni gestión de entregas físicas, dado su carácter estrictamente académico.
        </p>
      </PolicySection>

      <PolicySection title="2. Cobertura Geográfica">
        <p>
          Nuestra política de entrega simulada contempla cobertura a nivel nacional dentro de Costa Rica, diferenciando dos zonas principales:
        </p>
        <ul>
          <li><strong>Gran Área Metropolitana (GAM):</strong> Zona de referencia para entregas con tiempos estimados más cortos.</li>
          <li><strong>Fuera de la GAM:</strong> Demás localidades del país.</li>
        </ul>
      </PolicySection>

      <PolicySection title="3. Tiempos Estimados de Entrega">
        <p>Los plazos de entrega se presentan como estimaciones y no como garantías absolutas:</p>
        <ul>
          <li><strong>Entregas dentro de la GAM:</strong> 2 a 5 días hábiles.</li>
          <li><strong>Entregas fuera de la GAM:</strong> 3 a 7 días hábiles.</li>
        </ul>
        <p>
          Estos tiempos pueden variar según la ubicación del destino, disponibilidad del producto, días feriados o situaciones extraordinarias.
        </p>
      </PolicySection>

      <PolicySection title="4. Costos de Envío (Shipping)">
        <p>El costo de envío se calcula con base en el subtotal de los productos antes de aplicar el IVA del 13%. Las tarifas aplican de la siguiente manera:</p>
        <ul>
          <li><strong>Tarifa estándar (₡3 500):</strong> Se aplica cuando existe un subtotal positivo y su valor redondeado al colón es inferior a ₡100 000.</li>
          <li><strong>Envío gratuito (₡0):</strong> Aplica cuando el subtotal redondeado al colón es igual o superior a ₡100 000.</li>
          <li><strong>Carrito vacío:</strong> Cuando no existen productos que generen un subtotal positivo, no se aplica ningún costo de envío.</li>
        </ul>
      </PolicySection>

      <PolicySection title="5. Restricciones y Condiciones Especiales">
        <ul>
          <li><strong>Disponibilidad:</strong> El stock mostrado en el catálogo está sujeto a validaciones al crear la orden. No se prometen reservas automáticas.</li>
          <li><strong>Información de entrega:</strong> Es responsabilidad del comprador proporcionar información correcta y suficiente durante la etapa de Delivery en el Checkout.</li>
          <li><strong>Zonas y productos especiales:</strong> Ciertos destinos remotos o productos electrónicos delicados podrían requerir precauciones o tiempos adicionales dentro de este escenario simulado.</li>
        </ul>
      </PolicySection>

      <PolicySection title="6. Volver al catálogo">
        <a href="#catalog" onClick={event => {
          if (!isSameTabNavigation(event)) return
          event.preventDefault()
          onCatalogClick('#catalog')
        }}>Volver al catálogo</a>
      </PolicySection>

    </PolicyLayout>
  );
};