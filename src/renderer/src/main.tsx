import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './assets/fonts/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/setup.css'
import './styles/workspace.css'
import './styles/studio.css'
import './styles/review.css'
import { initI18n } from './i18n'
import { selectResolvedTheme, useApp } from './store/app'
import { App } from './App'
import { Splash } from './components/Splash'
import './styles/splash.css'
import './styles/sprite-project.css'
import './styles/spine-project.css'

async function bootstrap(): Promise<void> {
  const [settings, systemDark, maximized] = await Promise.all([
    window.gas.settings.get(),
    window.gas.theme.systemDark(),
    window.gas.window.isMaximized()
  ])
  useApp.getState().hydrate(settings, systemDark, maximized)
  document.documentElement.dataset.theme = selectResolvedTheme(useApp.getState())
  await initI18n(settings.lang)

  const container = document.getElementById('root')
  if (!container) throw new Error('root element missing')
  createRoot(container).render(
    <StrictMode>
      <App />
      <Splash />
    </StrictMode>
  )
}

void bootstrap()
