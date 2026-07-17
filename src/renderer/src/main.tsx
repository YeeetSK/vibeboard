import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { startProcessingClock } from './processingClock'
import './styles.css'

startProcessingClock()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
