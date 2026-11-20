/** Monta la aplicación bajo StrictMode y la instancia compartida de CartProvider. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import CartProvider from './context/CartProvider'
import SessionProvider from './context/SessionProvider'
import BranchProvider from './context/BranchProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CartProvider>
      <SessionProvider><BranchProvider><App /></BranchProvider></SessionProvider>
    </CartProvider>
  </StrictMode>,
)
