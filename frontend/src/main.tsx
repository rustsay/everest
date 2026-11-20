import './invite'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './design/everest.css'
import { initPwa } from './pwa'

initPwa()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
