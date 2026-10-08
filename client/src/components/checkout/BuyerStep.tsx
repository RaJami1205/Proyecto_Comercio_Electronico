import { useRef, useState, type FormEvent } from 'react'
import type { BuyerInfo } from '../../types/checkout'
import { normalizeBuyer, validateBuyer } from '../../utils/checkoutValidation'
import styles from '../../styles/checkout/CheckoutForm.module.css'
import pageStyles from '../../styles/pages/CheckoutPage.module.css'

interface BuyerStepProps {
  value: BuyerInfo
  onChange: (value: BuyerInfo) => void
  onContinue: (value: BuyerInfo) => void
  onBack: () => void
}

const fields: { name: keyof BuyerInfo; label: string; type: string; autoComplete: string }[] = [
  { name: 'fullName', label: 'Nombre completo', type: 'text', autoComplete: 'name' },
  { name: 'email', label: 'Correo electrónico', type: 'email', autoComplete: 'email' },
  { name: 'phone', label: 'Teléfono', type: 'tel', autoComplete: 'tel' },
]

function BuyerStep({ value, onChange, onContinue, onBack }: BuyerStepProps) {
  const [touched, setTouched] = useState<Partial<Record<keyof BuyerInfo, boolean>>>({})
  const [attempted, setAttempted] = useState(false)
  const inputs = useRef<Partial<Record<keyof BuyerInfo, HTMLInputElement | null>>>({})
  const errors = validateBuyer(value)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted(true)
    const firstInvalid = fields.find((field) => errors[field.name])
    if (firstInvalid) {
      inputs.current[firstInvalid.name]?.focus()
      return
    }
    onContinue(normalizeBuyer(value))
  }

  return (
    <form noValidate onSubmit={handleSubmit} aria-labelledby="checkout-stage-title">
      <div className={styles.fields}>
        {fields.map((field) => {
          const id = `buyer-${field.name}`
          const error = touched[field.name] || attempted ? errors[field.name] : undefined
          return (
            <div className={styles.field} key={field.name}>
              <label htmlFor={id}>{field.label}</label>
              <input
                ref={(element) => { inputs.current[field.name] = element }}
                id={id} name={field.name} type={field.type} autoComplete={field.autoComplete}
                required value={value[field.name]}
                onChange={(event) => onChange({ ...value, [field.name]: event.target.value })}
                onBlur={() => setTouched((current) => ({ ...current, [field.name]: true }))}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              />
              {error ? <p className={styles.error} id={`${id}-error`}>{error}</p> : null}
            </div>
          )
        })}
      </div>
      <div className={pageStyles.actions}>
        <button type="button" className={pageStyles.back} onClick={onBack}>Volver al carrito</button>
        <button type="submit" className={pageStyles.continue}>Continuar</button>
      </div>
    </form>
  )
}

export default BuyerStep
