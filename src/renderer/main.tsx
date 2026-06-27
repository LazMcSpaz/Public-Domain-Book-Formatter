/**
 * Renderer entry point. Mounts the React app inside the ReviewProvider.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ReviewProvider } from './store/ReviewContext'
import { App } from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(
  <StrictMode>
    <ReviewProvider>
      <App />
    </ReviewProvider>
  </StrictMode>
)
