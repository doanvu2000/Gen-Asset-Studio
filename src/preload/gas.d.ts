import type { GasApi } from '../shared/types'

declare global {
  interface Window {
    gas: GasApi
  }
}

export {}
