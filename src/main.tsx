import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AppStateProvider } from './state/store'
import { AnnouncerProvider } from './state/announcer'
import { VoiceSessionProvider } from './state/voiceSession'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppStateProvider>
      <AnnouncerProvider>
        <VoiceSessionProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </VoiceSessionProvider>
      </AnnouncerProvider>
    </AppStateProvider>
  </StrictMode>,
)
