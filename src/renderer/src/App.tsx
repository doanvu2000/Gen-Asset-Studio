import { useEffect, useState, type ReactElement } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { selectResolvedTheme, useApp, type Route } from '@renderer/store/app'
import { viewTransition } from '@renderer/lib/motion'
import { TitleBar } from '@renderer/components/TitleBar'
import { StatusBar } from '@renderer/components/StatusBar'
import { Sidebar } from '@renderer/components/Sidebar'
import { SettingsDialog } from '@renderer/components/SettingsDialog'
import { UacDialog } from '@renderer/components/UacDialog'
import { FixDialog } from '@renderer/components/FixDialog'
import { useEnv } from '@renderer/store/env'
import { SetupScreen } from '@renderer/screens/SetupScreen'
import { WorkspaceScreen } from '@renderer/screens/WorkspaceScreen'
import { ProjectScreen } from '@renderer/screens/ProjectScreen'
import { Toasts } from '@renderer/components/Toasts'
import { WorkspaceDialogs } from '@renderer/components/WorkspaceDialogs'
import { useWs } from '@renderer/store/workspace'
import { useStyle } from '@renderer/store/style'
import { useQueue } from '@renderer/store/queue'
import { QueueDrawer } from '@renderer/components/QueueDrawer'

const SCREENS: Record<Route, () => ReactElement> = {
  setup: SetupScreen,
  workspace: WorkspaceScreen,
  project: ProjectScreen
}

function useThemeSync(): void {
  const theme = useApp(selectResolvedTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
}

function useBridgeEvents(): void {
  const applySettings = useApp((s) => s.applySettings)
  const setSystemDark = useApp((s) => s.setSystemDark)
  const setMaximized = useApp((s) => s.setMaximized)
  useEffect(() => {
    const offs = [
      window.gas.settings.onChange(applySettings),
      window.gas.theme.onSystemChange(setSystemDark),
      window.gas.window.onMaximizedChange(setMaximized)
    ]
    return () => offs.forEach((off) => off())
  }, [applySettings, setSystemDark, setMaximized])
}

function useEnvBridge(): void {
  const init = useEnv((s) => s.init)
  const initWs = useWs((s) => s.init)
  const initStyle = useStyle((s) => s.init)
  const initQueue = useQueue((s) => s.init)
  const loadModels = useStyle((s) => s.loadModelList)
  const loggedIn = useEnv((s) => !!s.account?.loggedIn)
  useEffect(() => init(), [init])
  useEffect(() => initWs(), [initWs])
  useEffect(() => initStyle(), [initStyle])
  useEffect(() => initQueue(), [initQueue])
  useEffect(() => {
    if (loggedIn) void loadModels()
  }, [loggedIn, loadModels])
  useEffect(() => {
    const block = (e: DragEvent): void => {
      if (!e.dataTransfer || e.defaultPrevented || ![...e.dataTransfer.types].includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])
}

function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const on = (): void => setFocused(true)
    const off = (): void => setFocused(false)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  return focused
}

export function App(): ReactElement {
  useThemeSync()
  useBridgeEvents()
  useEnvBridge()
  const focused = useWindowFocus()
  const route = useApp((s) => s.route)
  const direction = useApp((s) => s.direction)
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const Screen = SCREENS[route]
  const sideVisible = route !== 'setup' && sidebarOpen

  return (
    <MotionConfig reducedMotion="user">
      <div className={focused ? 'app' : 'app blurred'}>
        <TitleBar />
        <div className={sideVisible ? 'body' : 'body side-off'}>
          <Sidebar />
          <div className="main">
            <AnimatePresence initial={false} custom={direction}>
              <motion.div
                key={route}
                className="view"
                custom={direction}
                variants={{
                  enter: (d: number) => ({ opacity: 0, x: 14 * d }),
                  center: { opacity: 1, x: 0 },
                  exit: (d: number) => ({ opacity: 0, x: -10 * d })
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={viewTransition}
              >
                <Screen />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <StatusBar />
        {route !== 'setup' && <QueueDrawer />}
        <SettingsDialog />
        <UacDialog />
        <FixDialog />
        <WorkspaceDialogs />
        <Toasts />
      </div>
    </MotionConfig>
  )
}
