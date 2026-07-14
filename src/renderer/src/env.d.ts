import type { VibeBoardApi } from '../../shared/types'

declare global {
  interface Window {
    vibeboard: VibeBoardApi
  }
}
