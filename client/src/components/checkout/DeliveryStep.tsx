import { useRef, useState, type FormEvent } from 'react'
import type { DeliveryInfo } from '../../types/checkout'
import { normalizeDelivery, validateDelivery } from '../../utils/checkoutValidation'
import styles from '../../styles/checkout/CheckoutForm.module.css'
import pageStyles from '../../styles/pages/CheckoutPage.module.css'

interface DeliveryStepProps {
  value: DeliveryInfo
  onChange: (value: DeliveryInfo) => void
  onContinue: (value: DeliveryInfo) => void
  onBack: () => void
}

const fields: { name: keyof DeliveryInfo; label: string; multiline?: boolean; autoComplete?: string; optional?: boolean }[] = [
  { name: 'province', label: 'Provincia', autoComplete: 'address-level1' },
  { name: 'canton', label: 'Cantón', autoComplete: 'address-level2' },
  { name: 'address', label: 'Dirección', multiline: true, autoComplete: 'street-address' },
  { name: 'additionalInfo', label: 'Información adicional (opcional)', multiline: true, optional: true },
]

function DeliveryStep({ value, onChange, onContinue, onBack }: DeliveryStepProps) {
  const [touched, setTouched] = useState<Partial<Record<keyof DeliveryInfo, boolean>>>({})
  const [attempted, setAttempted] = useState(false)
  const inputs = useRef<Partial<Record<keyof DeliveryInfo, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const errors = validateDelivery(value)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted(true)
    const firstInvalid = fields.find((field) => errors[field.name])
    if (firstInvalid) {
      inputs.current[firstInvalid.name]?.focus()
      return
    }
    onContinue(normalizeDelivery(value))
  }

  return (
    <form noValidate onSubmit={handleSubmit} aria-labelledby="checkout-stage-title">
      <div className={styles.fields}>
        {fields.map((field) => {
          const id = `delivery-${field.name}`
          const error = touched[field.name] || attempted ? errors[field.name] : undefined
          const props = {
            id, name: field.name, autoComplete: field.autoComplete,
            required: !field.optional, value: value[field.name] ?? '',
            onBlur: () => setTouched((current) => ({ ...current, [field.name]: true })),
            'aria-invalid': error ? true : undefined,
            'aria-describedby': error ? `${id}-error` : undefined,
          }
          return (
            <div className={styles.field} key={field.name}>
              <label htmlFor={id}>{field.label}</label>
              {field.multiline ? (
                <textarea {...props} rows={3}
                  ref={(element) => { inputs.current[field.name] = element }}
                  onChange={(event) => onChange({ ...value, [field.name]: event.target.value })}
                />
              ) : (
                <input {...props} type="text"
                  ref={(element) => { inputs.current[field.name] = element }}
                  onChange={(event) => onChange({ ...value, [field.name]: event.target.value })}
                />
              )}
              {error ? <p className={styles.error} id={`${id}-error`}>{error}</p> : null}
            </div>
          )
        })}
      </div>
      <div className={pageStyles.actions}>
        <button type="button" className={pageStyles.back} onClick={onBack}>Atrás</button>
        <button type="submit" className={pageStyles.continue}>Continuar</button>
      </div>
    </form>
  )
}

export default DeliveryStep
