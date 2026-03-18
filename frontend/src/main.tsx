import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyDSConfig, loadStoredDSConfig } from './lib/dsConfig.ts'

// Apply stored design system config before first render
applyDSConfig(loadStoredDSConfig());
import { ConfirmProvider } from './components/ConfirmDialog.tsx'
import { TooltipProvider } from './components/GlobalTooltip.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ConfirmProvider>
  </StrictMode>,
)
