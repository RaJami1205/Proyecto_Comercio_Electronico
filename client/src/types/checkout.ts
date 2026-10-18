/** Define los datos de comprador y entrega utilizados durante Checkout y creación de Orders. */
export interface BuyerInfo {
  fullName: string
  email: string
  phone: string
}

export interface DeliveryInfo {
  province: string
  canton: string
  address: string
  additionalInfo?: string
}

export interface CheckoutData {
  buyer: BuyerInfo
  delivery: DeliveryInfo
}
