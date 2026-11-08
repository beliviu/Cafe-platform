import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/plus-jakarta-sans'
import './styles/tokens.css'
import './index.css'
import './App.css'
import './styles/ui.css'
import './styles/shell.css'
import './styles/owner.css'
import './styles/business.css'
import './styles/charts.css'
import './styles/staff.css'
import './styles/inventory.css'
import './styles/pos.css'
import './styles/finance.css'
import './styles/customers.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
