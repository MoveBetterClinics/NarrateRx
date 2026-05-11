import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initSentry } from './lib/sentry'

// Initialize Sentry before React mounts so anything that throws during the
// initial render — including ErrorBoundary fallbacks — is captured. No-op
// when VITE_SENTRY_DSN is unset (local dev, preview builds without telemetry).
initSentry()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
