import { initSentry } from './lib/sentry'
initSentry()

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installWorkspaceOverride } from './lib/workspaceOverride'

installWorkspaceOverride()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
