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
