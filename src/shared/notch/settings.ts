import type { NotchOverlayCapability, NotchOverlaySettings } from '../types'

export const defaultNotchOverlaySettings: NotchOverlaySettings = {
  enabled: false,
  expandOnTaskCompleted: true,
  showFinishChat: true,
  expandOnAttention: true,
  expandOnAllFinished: false
}

export const mergeNotchOverlaySettings = (
  settings: Partial<NotchOverlaySettings> | null | undefined
): NotchOverlaySettings => ({
  enabled: Boolean(settings?.enabled),
  expandOnTaskCompleted:
    settings?.expandOnTaskCompleted ?? defaultNotchOverlaySettings.expandOnTaskCompleted,
  showFinishChat: settings?.showFinishChat ?? defaultNotchOverlaySettings.showFinishChat,
  expandOnAttention: settings?.expandOnAttention ?? defaultNotchOverlaySettings.expandOnAttention,
  expandOnAllFinished:
    settings?.expandOnAllFinished ?? defaultNotchOverlaySettings.expandOnAllFinished
})

export const emptyNotchOverlayCapability: NotchOverlayCapability = {
  supported: false,
  platform: 'unknown',
  hasNotch: false,
  reason: null
}
