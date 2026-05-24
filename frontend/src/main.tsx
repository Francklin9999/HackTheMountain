import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { printQRToConsole } from './utils/consoleQR'

const url = import.meta.env.VITE_PUBLIC_URL || window.location.origin
printQRToConsole(url)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
