import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { KeyboardAlertCapability, KeyboardAlertSettings } from '../shared/types'

const execFileAsync = promisify(execFile)

export const defaultKeyboardAlertSettings: KeyboardAlertSettings = {
  enabled: false,
  flashOnTaskFailed: true,
  flashOnTaskCompleted: false,
  flashOnAllFinished: false,
  stopOnAppFocus: true,
  stopOnOpenTask: true
}

export const mergeKeyboardAlertSettings = (
  settings: Partial<KeyboardAlertSettings> | null | undefined
): KeyboardAlertSettings => ({
  enabled: Boolean(settings?.enabled),
  flashOnTaskFailed: settings?.flashOnTaskFailed ?? defaultKeyboardAlertSettings.flashOnTaskFailed,
  flashOnTaskCompleted:
    settings?.flashOnTaskCompleted ?? defaultKeyboardAlertSettings.flashOnTaskCompleted,
  flashOnAllFinished:
    settings?.flashOnAllFinished ?? defaultKeyboardAlertSettings.flashOnAllFinished,
  stopOnAppFocus: settings?.stopOnAppFocus ?? defaultKeyboardAlertSettings.stopOnAppFocus,
  stopOnOpenTask: settings?.stopOnOpenTask ?? defaultKeyboardAlertSettings.stopOnOpenTask
})

/** Hard on/off blink cadence - keep short so it reads as a warning, not a fade. */
const FLASH_INTERVAL_MS = 220
const FLASH_ON_LEVEL = 1
const TEST_FLASH_MS = 2800

type GetSettings = () => KeyboardAlertSettings
type IsMainFocused = () => boolean
/** Task ids that currently match configured alert conditions (open tabs). */
type GetAlertTaskIds = () => string[]

let getSettings: GetSettings | null = null
let isMainFocused: IsMainFocused | null = null
let getAlertTaskIds: GetAlertTaskIds | null = null
let helperPathCache: string | null = null
let capabilityCache: KeyboardAlertCapability | null = null
let flashTimer: ReturnType<typeof setInterval> | null = null
let flashOn = false
let savedBrightness: number | null = null
/** Tasks that should flash when the app is in the background. */
const pendingTaskIds = new Set<string>()
/** Generic flash (all finished / test) that is not tied to a task id. */
let genericPending = false

export const bindKeyboardAlertDeps = (deps: {
  getSettings: GetSettings
  isMainAppFocused: IsMainFocused
  getAlertTaskIds: GetAlertTaskIds
}): void => {
  getSettings = deps.getSettings
  isMainFocused = deps.isMainAppFocused
  getAlertTaskIds = deps.getAlertTaskIds
}

function projectRootCandidates(): string[] {
  const appPath = app.getAppPath()
  return [
    path.join(process.resourcesPath, 'kblight'),
    path.join(appPath, 'build', 'kblight'),
    path.join(appPath, '..', 'build', 'kblight'),
    path.join(process.cwd(), 'build', 'kblight')
  ]
}

function sourcePathCandidates(): string[] {
  const appPath = app.getAppPath()
  return [
    path.join(appPath, 'native', 'kblight.swift'),
    path.join(appPath, '..', 'native', 'kblight.swift'),
    path.join(process.cwd(), 'native', 'kblight.swift')
  ]
}

function ensureHelperBinary(): string | null {
  if (process.platform !== 'darwin') return null
  if (helperPathCache && existsSync(helperPathCache)) return helperPathCache

  for (const candidate of projectRootCandidates()) {
    if (existsSync(candidate)) {
      helperPathCache = candidate
      return candidate
    }
  }

  const source = sourcePathCandidates().find((entry) => existsSync(entry))
  if (!source) return null

  try {
    const outDir = path.join(app.getPath('userData'), 'bin')
    mkdirSync(outDir, { recursive: true })
    const outBin = path.join(outDir, 'kblight')
    execFileSync('swiftc', [source, '-O', '-o', outBin], {
      stdio: 'ignore',
      timeout: 120_000
    })
    helperPathCache = outBin
    return outBin
  } catch {
    return null
  }
}

async function runHelper(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const bin = ensureHelperBinary()
  if (!bin) return { ok: false, stdout: '', stderr: 'Keyboard backlight helper unavailable.' }
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { timeout: 4000 })
    return { ok: true, stdout: String(stdout).trim(), stderr: String(stderr).trim() }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      stdout: String(err.stdout ?? '').trim(),
      stderr: String(err.stderr ?? err.message ?? 'kblight failed').trim()
    }
  }
}

export const getKeyboardAlertCapability = (): KeyboardAlertCapability => {
  if (process.platform !== 'darwin') {
    return {
      supported: false,
      platform: process.platform,
      hasBacklight: false,
      reason: 'Keyboard backlight alerts are only available on macOS.'
    }
  }

  if (capabilityCache) return capabilityCache

  const bin = ensureHelperBinary()
  if (!bin) {
    capabilityCache = {
      supported: false,
      platform: 'darwin',
      hasBacklight: false,
      reason:
        'Could not build the keyboard backlight helper. Install Xcode Command Line Tools (`xcode-select --install`) and restart VibeBoard.'
    }
    return capabilityCache
  }

  try {
    execFileSync(bin, ['probe'], { timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'] })
    capabilityCache = {
      supported: true,
      platform: 'darwin',
      hasBacklight: true,
      reason: null
    }
  } catch {
    capabilityCache = {
      supported: false,
      platform: 'darwin',
      hasBacklight: false,
      reason:
        'No controllable keyboard backlight was found. This Mac may not have a backlit keyboard, or macOS blocked the private brightness API.'
    }
  }
  return capabilityCache
}

async function getBrightness(): Promise<number | null> {
  const result = await runHelper(['get'])
  if (!result.ok) return null
  const value = Number.parseFloat(result.stdout)
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null
}

async function setBrightness(value: number): Promise<boolean> {
  const result = await runHelper([String(Math.min(1, Math.max(0, value)))])
  return result.ok
}

async function restoreBrightness(): Promise<void> {
  if (savedBrightness == null) return
  await setBrightness(savedBrightness)
  savedBrightness = null
}

async function tickFlash(): Promise<void> {
  flashOn = !flashOn
  const target = flashOn ? FLASH_ON_LEVEL : 0
  await setBrightness(target)
}

function clearFlashTimer(): void {
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  flashOn = false
}

/** Stop the visual flash and restore brightness, but keep pending alerts. */
async function pauseFlashingVisual(): Promise<void> {
  clearFlashTimer()
  await restoreBrightness()
}

/** Stop everything, including pending alerts. */
async function clearAllFlashing(): Promise<void> {
  clearFlashTimer()
  pendingTaskIds.clear()
  genericPending = false
  await restoreBrightness()
}

function syncPendingFromStore(): void {
  const settings = getSettings?.()
  if (!settings?.enabled) {
    pendingTaskIds.clear()
    genericPending = false
    return
  }

  const liveIds = new Set(getAlertTaskIds?.() ?? [])
  for (const id of [...pendingTaskIds]) {
    if (!liveIds.has(id)) pendingTaskIds.delete(id)
  }
  for (const id of liveIds) pendingTaskIds.add(id)
}

function hasPendingAlerts(): boolean {
  syncPendingFromStore()
  return pendingTaskIds.size > 0 || genericPending
}

async function startFlashingVisual(): Promise<void> {
  const capability = getKeyboardAlertCapability()
  if (!capability.supported) return
  if (flashTimer) return

  const current = await getBrightness()
  if (current == null) return
  savedBrightness = current

  flashOn = true
  await setBrightness(FLASH_ON_LEVEL)
  flashTimer = setInterval(() => {
    void tickFlash()
  }, FLASH_INTERVAL_MS)
}

function notePendingTask(taskId: string | null): void {
  if (taskId) pendingTaskIds.add(taskId)
  else genericPending = true
}

/**
 * Pause the keyboard flash while using VibeBoard.
 * Pending alerts stay so they can resume when you leave the app.
 */
export const pauseKeyboardAlertFlash = (): void => {
  void pauseFlashingVisual()
}

/** Permanently clear flash for a task (e.g. marked read / resolved). */
export const clearKeyboardAlertFlashForTask = (taskId: string): void => {
  pendingTaskIds.delete(taskId)
  if (pendingTaskIds.size > 0 || genericPending) return
  void clearAllFlashing()
}

export const stopKeyboardAlertFlashIfNeededOnFocus = (): void => {
  const settings = getSettings?.()
  if (!settings?.enabled || !settings.stopOnAppFocus) return
  pauseKeyboardAlertFlash()
}

/**
 * Opening a task only pauses the flash while you are in the app.
 * If the task still needs attention when you leave, flashing resumes.
 */
export const pauseKeyboardAlertFlashForTask = (taskId: string): void => {
  const settings = getSettings?.()
  if (!settings?.enabled || !settings.stopOnOpenTask) return
  // Keep taskId pending; just stop the lights while focused.
  pauseKeyboardAlertFlash()
  void taskId
}

/** Resume flashing when leaving VibeBoard if anything still needs you. */
export const resumeKeyboardAlertFlashIfNeeded = (): void => {
  const settings = getSettings?.()
  if (!settings?.enabled) return
  if (isMainFocused?.()) return
  if (!hasPendingAlerts()) {
    void clearAllFlashing()
    return
  }
  void startFlashingVisual()
}

export const handleKeyboardAlertForStatus = (input: {
  newStatus: string
  oldStatus: string
  taskId: string
  runningCount: number
  runningCountBeforeChange: number
}): void => {
  const settings = getSettings?.()
  if (!settings?.enabled) return

  const leftAttention = input.oldStatus === 'attention' && input.newStatus !== 'attention'
  const leftDoneUnread = input.oldStatus === 'done_unread' && input.newStatus !== 'done_unread'
  if (leftAttention || leftDoneUnread) {
    clearKeyboardAlertFlashForTask(input.taskId)
  }

  const becameAttention = input.newStatus === 'attention' && input.oldStatus !== 'attention'
  const becameDoneUnread = input.newStatus === 'done_unread' && input.oldStatus !== 'done_unread'
  const allFinished =
    input.runningCountBeforeChange > 0 &&
    input.runningCount === 0 &&
    input.oldStatus === 'processing' &&
    input.newStatus !== 'processing'

  let shouldAlert = false
  if (becameAttention && settings.flashOnTaskFailed) {
    notePendingTask(input.taskId)
    shouldAlert = true
  } else if (becameDoneUnread && settings.flashOnTaskCompleted) {
    notePendingTask(input.taskId)
    shouldAlert = true
  } else if (allFinished && settings.flashOnAllFinished) {
    notePendingTask(null)
    shouldAlert = true
  }

  if (!shouldAlert) return

  // While focused, only remember the pending alert; lights stay off until blur.
  if (isMainFocused?.()) return
  void startFlashingVisual()
}

/** Settings test: short flash burst that always restores brightness. */
export const testKeyboardAlertFlash = async (): Promise<{ ok: boolean; reason?: string }> => {
  const capability = getKeyboardAlertCapability()
  if (!capability.supported) {
    return { ok: false, reason: capability.reason ?? 'Unsupported' }
  }

  await pauseFlashingVisual()
  const current = await getBrightness()
  if (current == null) {
    return { ok: false, reason: 'Could not read keyboard brightness.' }
  }
  savedBrightness = current
  flashOn = true
  await setBrightness(FLASH_ON_LEVEL)
  flashTimer = setInterval(() => {
    void tickFlash()
  }, FLASH_INTERVAL_MS)

  setTimeout(() => {
    void pauseFlashingVisual()
  }, TEST_FLASH_MS)

  return { ok: true }
}

export const destroyKeyboardAlertFlash = (): void => {
  clearFlashTimer()
  pendingTaskIds.clear()
  genericPending = false
  if (savedBrightness != null) {
    const restore = savedBrightness
    savedBrightness = null
    void setBrightness(restore)
  }
}

/** @deprecated Prefer pauseKeyboardAlertFlashForTask / clearKeyboardAlertFlashForTask */
export const stopKeyboardAlertFlashForTask = pauseKeyboardAlertFlashForTask
