import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { JobStoreProvider } from './store/JobStore.tsx'
import App from './ui/App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <JobStoreProvider>
      <App />
    </JobStoreProvider>
  </StrictMode>,
)
