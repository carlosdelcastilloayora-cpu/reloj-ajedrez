import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// Modo avión: el service worker guarda la app y Stockfish (solo en la versión compilada)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}) })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
