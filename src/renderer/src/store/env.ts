import { create } from 'zustand'
import type { AccountInfo, EnvStatus, FixContext, FixSnapshot, RateLimits, SetupSnapshot } from '@shared/types'

const MAX_LOG = 800

interface EnvStore {
  setup: SetupSnapshot | null
  env: EnvStatus | null
  account: AccountInfo | null
  rateLimits: RateLimits | null
  fix: FixSnapshot
  fixAvailable: boolean
  log: string[]
  uacDismissed: boolean
  init: () => () => void
  refreshFixAvailable: () => Promise<boolean>
  openFix: (ctx: FixContext) => Promise<void>
  dismissUac: (v: boolean) => void
}

const IDLE_FIX: FixSnapshot = { phase: 'idle', context: null, text: '', proposal: null, result: null, error: null }

export const useEnv = create<EnvStore>()((set, get) => ({
  setup: null,
  env: null,
  account: null,
  rateLimits: null,
  fix: IDLE_FIX,
  fixAvailable: false,
  log: [],
  uacDismissed: false,
  init: () => {
    const g = window.gas
    void Promise.all([g.setup.get(), g.env.get(), g.account.get(), g.setup.log(), g.fix.get()]).then(([setup, env, account, log, fix]) =>
      set({ setup, env, account, log: log.slice(-MAX_LOG), fix })
    )
    const offs = [
      g.setup.onChange((setup) => {
        const prevNeed = get().setup?.steps.find((s) => s.id === 'longPath')?.need
        const need = setup.steps.find((s) => s.id === 'longPath')?.need
        set({ setup, ...(need === 'uac' && prevNeed !== 'uac' ? { uacDismissed: false } : {}) })
      }),
      g.setup.onLog((line) => set({ log: [...get().log, line].slice(-MAX_LOG) })),
      g.env.onChange((env) => set({ env })),
      g.account.onChange((account) => {
        set({ account, ...(account?.loggedIn ? {} : { rateLimits: null }) })
        void get().refreshFixAvailable()
      }),
      g.account.onRateLimits((rateLimits) => set({ rateLimits })),
      g.fix.onChange((fix) => set({ fix }))
    ]
    return () => offs.forEach((off) => off())
  },
  refreshFixAvailable: async () => {
    const fixAvailable = await window.gas.fix.available().catch(() => false)
    set({ fixAvailable })
    return fixAvailable
  },
  openFix: async (ctx) => {
    await window.gas.fix.start(ctx)
  },
  dismissUac: (uacDismissed) => set({ uacDismissed })
}))
