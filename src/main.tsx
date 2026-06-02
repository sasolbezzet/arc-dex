import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import './index.css'
const el = document.getElementById('root')
if (el) createRoot(el).render(<StrictMode><I18nProvider><App /></I18nProvider></StrictMode>)
