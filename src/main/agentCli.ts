import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  AgentCliId,
  AgentCliProviderStatus,
  AgentCliRememberedProvider,
  AgentCliSettings,
  AgentCliSnapshot,
  AgentCliSnapshotOptions,
  AgentModel
} from '../shared/types'
import {
  ensureWindowsAgentPath,
  getCursorDebugInfo,
  isAgentAuthenticated as isCursorAuthenticated,
  listAgentModels as listCursorAgentModels,
  resolveAgentCommand as resolveCursorAgentCommand,
  windowsCursorAgentDir
} from './cursorAdapter'

const execFileAsync = promisify(execFile)
const isWindows = process.platform === 'win32'

function windowsUserLocalBin(): string {
  return path.join(os.homedir(), '.local', 'bin')
}

function windowsNpmGlobalBin(): string {
  const appData =
    process.env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'npm')
}

/** Prepend common Windows CLI install dirs so Electron can see freshly installed tools. */
export function ensureWindowsProviderPath(): void {
  if (!isWindows) return
  ensureWindowsAgentPath()
  const extras = [windowsUserLocalBin(), windowsNpmGlobalBin(), windowsCursorAgentDir()]
  const current = process.env.PATH ?? ''
  const parts = current.split(path.delimiter).filter(Boolean)
  const resolvedParts = new Set(parts.map((part) => path.resolve(part)))
  const missing = extras.filter((dir) => !resolvedParts.has(path.resolve(dir)))
  if (missing.length === 0) return
  process.env.PATH = `${missing.join(path.delimiter)}${path.delimiter}${current}`
}

export function processEnvWithProviderPath(): NodeJS.ProcessEnv {
  ensureWindowsProviderPath()
  return { ...process.env }
}

export function windowsCommandNeedsShell(command: string): boolean {
  return isWindows && /\.(cmd|bat)$/i.test(command)
}

export const AGENT_CLI_IDS: AgentCliId[] = ['cursor', 'claude', 'codex']

export const defaultAgentCliSettings: AgentCliSettings = {
  activeCli: 'cursor',
  rememberedProviders: {}
}

export const mergeAgentCliSettings = (
  input?: Partial<AgentCliSettings> | null,
  previous?: AgentCliSettings | null
): AgentCliSettings => {
  const activeCli =
    normalizeAgentCliId(input?.activeCli) ??
    normalizeAgentCliId(previous?.activeCli) ??
    defaultAgentCliSettings.activeCli
  const rememberedProviders = mergeRememberedProviders(
    previous?.rememberedProviders,
    input?.rememberedProviders
  )
  return { activeCli, rememberedProviders }
}

function mergeRememberedProviders(
  previous?: Partial<Record<AgentCliId, AgentCliRememberedProvider>> | null,
  next?: Partial<Record<AgentCliId, AgentCliRememberedProvider>> | null
): Partial<Record<AgentCliId, AgentCliRememberedProvider>> {
  const merged: Partial<Record<AgentCliId, AgentCliRememberedProvider>> = { ...(previous ?? {}) }
  if (!next) return merged
  for (const id of AGENT_CLI_IDS) {
    const entry = next[id]
    if (!entry) continue
    merged[id] = normalizeRememberedProvider(entry) ?? merged[id]
  }
  return merged
}

function normalizeRememberedProvider(value: unknown): AgentCliRememberedProvider | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<AgentCliRememberedProvider>
  if (typeof record.installed !== 'boolean') return null
  if (typeof record.authenticated !== 'boolean') return null
  if (typeof record.available !== 'boolean') return null
  return {
    installed: record.installed,
    authenticated: record.authenticated,
    available: record.available,
    command: typeof record.command === 'string' ? record.command : null,
    detail: typeof record.detail === 'string' ? record.detail : '',
    checkedAt: typeof record.checkedAt === 'string' ? record.checkedAt : new Date(0).toISOString()
  }
}

export const normalizeAgentCliId = (value: unknown): AgentCliId | null => {
  if (value === 'cursor' || value === 'claude' || value === 'codex') return value
  return null
}

export const agentCliDisplayName = (id: AgentCliId): string => {
  switch (id) {
    case 'cursor':
      return 'Cursor'
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
  }
}

/** Official native installer (macOS / Linux / WSL). */
export const claudeUnixInstallCommand = 'curl -fsSL https://claude.ai/install.sh | bash'

/** Official PowerShell installer (Windows). */
export const claudeWindowsInstallCommand = "irm https://claude.ai/install.ps1 | iex"

/** npm global install for Codex CLI (works when ChatGPT.app is absent). */
export const codexNpmInstallCommand = 'npm install -g @openai/codex'

export const agentCliDocsUrl = (id: AgentCliId): string => {
  switch (id) {
    case 'cursor':
      return 'https://cursor.com/docs/cli/installation'
    case 'claude':
      return 'https://code.claude.com/docs/en/quickstart'
    case 'codex':
      return 'https://developers.openai.com/codex/cli'
  }
}

export async function resolveClaudeCommand(): Promise<string | null> {
  ensureWindowsProviderPath()
  if (isWindows) {
    const localBin = windowsUserLocalBin()
    const npmBin = windowsNpmGlobalBin()
    return resolveBinary('claude', [
      path.join(localBin, 'claude.exe'),
      path.join(localBin, 'claude.cmd'),
      path.join(npmBin, 'claude.exe'),
      path.join(npmBin, 'claude.cmd'),
      path.join(os.homedir(), '.claude', 'bin', 'claude.exe'),
      path.join(os.homedir(), '.claude', 'local', 'claude.exe')
    ])
  }

  return resolveBinary('claude', [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.claude', 'bin', 'claude'),
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    // Claude Code desktop / app bundles (when present)
    '/Applications/Claude.app/Contents/MacOS/claude',
    '/Applications/Claude.app/Contents/Resources/claude',
    path.join(os.homedir(), 'Applications', 'Claude.app', 'Contents', 'Resources', 'claude')
  ])
}

export async function resolveCodexCommand(): Promise<string | null> {
  ensureWindowsProviderPath()
  if (isWindows) {
    const localBin = windowsUserLocalBin()
    const npmBin = windowsNpmGlobalBin()
    return resolveBinary('codex', [
      path.join(npmBin, 'codex.exe'),
      path.join(npmBin, 'codex.cmd'),
      path.join(localBin, 'codex.exe'),
      path.join(localBin, 'codex.cmd')
    ])
  }

  // ChatGPT desktop app (unified Codex) ships the CLI inside the app bundle.
  // PATH often does not include it, so probe the bundle before shell lookup.
  return resolveBinary('codex', [
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    path.join(os.homedir(), 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
    '/Applications/Codex.app/Contents/Resources/codex',
    path.join(os.homedir(), 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
    path.join(os.homedir(), '.local', 'bin', 'codex'),
    path.join(os.homedir(), '.npm-global', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex'
  ])
}

export async function resolveProviderCommand(id: AgentCliId): Promise<string | null> {
  ensureWindowsProviderPath()
  switch (id) {
    case 'cursor':
      return resolveCursorAgentCommand()
    case 'claude':
      return resolveClaudeCommand()
    case 'codex':
      return resolveCodexCommand()
  }
}

export async function isProviderAuthenticated(id: AgentCliId, command?: string | null): Promise<boolean> {
  const resolved = command ?? (await resolveProviderCommand(id))
  if (!resolved) return false
  switch (id) {
    case 'cursor':
      return isCursorAuthenticated(resolved)
    case 'claude':
      return isClaudeAuthenticated(resolved)
    case 'codex':
      return isCodexAuthenticated(resolved)
  }
}

const providerStatusCache = new Map<
  AgentCliId,
  { at: number; status: AgentCliProviderStatus }
>()
const providerStatusCacheTtlMs = 20_000

export function invalidateAgentCliStatusCache(id?: AgentCliId): void {
  if (id) {
    providerStatusCache.delete(id)
    return
  }
  providerStatusCache.clear()
}

export async function getProviderStatus(
  id: AgentCliId,
  options: { fresh?: boolean } = {}
): Promise<AgentCliProviderStatus> {
  if (!options.fresh) {
    const cached = providerStatusCache.get(id)
    if (cached && Date.now() - cached.at < providerStatusCacheTtlMs) {
      return cached.status
    }
  }

  const command = await resolveProviderCommand(id)
  if (!command) {
    const status: AgentCliProviderStatus = {
      id,
      label: agentCliDisplayName(id),
      installed: false,
      authenticated: false,
      available: false,
      command: null,
      detail: `${agentCliDisplayName(id)} CLI not found`
    }
    providerStatusCache.set(id, { at: Date.now(), status })
    return status
  }

  const authenticated = await isProviderAuthenticated(id, command)
  const status: AgentCliProviderStatus = {
    id,
    label: agentCliDisplayName(id),
    installed: true,
    authenticated,
    available: authenticated,
    command,
    detail: authenticated ? 'Signed in' : `${agentCliDisplayName(id)} needs login`
  }
  providerStatusCache.set(id, { at: Date.now(), status })
  return status
}

export function buildRememberedAgentCliSnapshot(settings: AgentCliSettings): AgentCliSnapshot {
  const providers = AGENT_CLI_IDS.map((id) => statusFromRemembered(id, settings.rememberedProviders?.[id]))
  // Seed in-memory cache so follow-up live calls can short-circuit briefly.
  for (const provider of providers) {
    if (!settings.rememberedProviders?.[provider.id]) continue
    providerStatusCache.set(provider.id, { at: Date.now(), status: provider })
  }
  const activeCli = settings.activeCli
  const active = providers.find((item) => item.id === activeCli) ?? providers[0]
  return { activeCli, providers, active }
}

export function rememberedProvidersFromSnapshot(
  snapshot: AgentCliSnapshot
): Partial<Record<AgentCliId, AgentCliRememberedProvider>> {
  const checkedAt = new Date().toISOString()
  const remembered: Partial<Record<AgentCliId, AgentCliRememberedProvider>> = {}
  for (const provider of snapshot.providers) {
    remembered[provider.id] = {
      installed: provider.installed,
      authenticated: provider.authenticated,
      available: provider.available,
      command: provider.command,
      detail: provider.detail,
      checkedAt
    }
  }
  return remembered
}

function statusFromRemembered(
  id: AgentCliId,
  remembered?: AgentCliRememberedProvider
): AgentCliProviderStatus {
  if (!remembered) {
    return {
      id,
      label: agentCliDisplayName(id),
      installed: false,
      authenticated: false,
      available: false,
      command: null,
      detail: 'Checking…'
    }
  }
  return {
    id,
    label: agentCliDisplayName(id),
    installed: remembered.installed,
    authenticated: remembered.authenticated,
    available: remembered.available,
    command: remembered.command,
    detail: remembered.detail || (remembered.available ? 'Signed in' : remembered.installed ? `${agentCliDisplayName(id)} needs login` : `${agentCliDisplayName(id)} CLI not found`)
  }
}

export async function getAgentCliSnapshot(
  settings: AgentCliSettings,
  options: AgentCliSnapshotOptions = {}
): Promise<AgentCliSnapshot> {
  if (options.source === 'remembered') {
    return buildRememberedAgentCliSnapshot(settings)
  }

  const providers = await Promise.all(
    AGENT_CLI_IDS.map((id) => getProviderStatus(id, { fresh: options.fresh || options.source === 'live' }))
  )
  const activeCli = settings.activeCli
  const active = providers.find((item) => item.id === activeCli) ?? providers[0]
  return {
    activeCli,
    providers,
    active
  }
}

/** Model catalog for the currently selected agent CLI. */
export async function listActiveAgentModels(activeCli: AgentCliId): Promise<AgentModel[]> {
  switch (activeCli) {
    case 'cursor':
      return listCursorAgentModels()
    case 'codex':
      return listCodexModels()
    case 'claude':
      return listClaudeModels()
  }
}

async function listCodexModels(): Promise<AgentModel[]> {
  const command = await resolveCodexCommand()
  if (!command) {
    throw new Error('Codex CLI is not installed.')
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, ['debug', 'models'], {
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024,
      shell: windowsCommandNeedsShell(command),
      env: {
        ...processEnvWithProviderPath(),
        // Avoid TUI/dumb-terminal refusals for non-interactive listing.
        TERM: process.env.TERM && process.env.TERM !== 'dumb' ? process.env.TERM : 'xterm-256color'
      }
    })
    const models = parseCodexModelsOutput([stdout, stderr].join('\n'))
    if (models.length === 0) throw new Error('No models returned by Codex.')
    return [{ id: 'auto', label: 'Auto', isDefault: true, isCurrent: true }, ...models]
  } catch (error) {
    if (error instanceof Error && /not installed|No models returned/i.test(error.message)) throw error
    // Fallback catalog if debug models is unavailable on this build.
    return [
      { id: 'auto', label: 'Auto', isDefault: true, isCurrent: true },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' }
    ]
  }
}

function parseCodexModelsOutput(output: string): AgentModel[] {
  const jsonStart = output.indexOf('{')
  if (jsonStart < 0) return []
  try {
    const parsed = JSON.parse(output.slice(jsonStart)) as {
      models?: Array<{ slug?: string; display_name?: string; visibility?: string }>
    }
    const models: AgentModel[] = []
    const seen = new Set<string>()
    for (const entry of parsed.models ?? []) {
      const id = entry.slug?.trim()
      if (!id || seen.has(id)) continue
      if (entry.visibility && entry.visibility !== 'list') continue
      seen.add(id)
      models.push({
        id,
        label: entry.display_name?.trim() || id
      })
    }
    return models
  } catch {
    return []
  }
}

async function listClaudeModels(): Promise<AgentModel[]> {
  const command = await resolveClaudeCommand()
  if (!command) {
    throw new Error('Claude CLI is not installed.')
  }

  // Claude Code does not expose a stable machine-readable model list in all builds.
  // Ship the common aliases accepted by `claude --model`.
  return [
    { id: 'auto', label: 'Auto', isDefault: true, isCurrent: true },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'opus', label: 'Opus' },
    { id: 'haiku', label: 'Haiku' }
  ]
}

/** Keep Cursor debug status available for the existing repair / install flow. */
export async function getCursorCompatStatus(): Promise<{
  available: boolean
  label: string
  debug: Awaited<ReturnType<typeof getCursorDebugInfo>>
}> {
  const debug = await getCursorDebugInfo()
  const available = Boolean(debug.agentCommand) && (await isCursorAuthenticated(debug.agentCommand))
  return {
    available,
    label: available ? 'agent signed in' : debug.agentCommand ? 'agent login required' : 'agent missing',
    debug
  }
}

async function isClaudeAuthenticated(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['auth', 'status'], {
      timeout: 8000,
      env: processEnvWithProviderPath(),
      shell: windowsCommandNeedsShell(command)
    })
    return true
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : NaN
    if (code === 1) return false
    // Older builds / unexpected failures: treat as not ready.
    return false
  }
}

async function isCodexAuthenticated(command: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['login', 'status'], {
      timeout: 15000,
      env: processEnvWithProviderPath(),
      shell: windowsCommandNeedsShell(command)
    })
    const text = [stdout, stderr].join('').toLowerCase()
    if (/not logged in|unauthenticated|no credentials/i.test(text)) return false
    if (/logged in|chatgpt|api key|authenticated/i.test(text)) return true
    return true
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : NaN
    if (code === 0) return true
    return false
  }
}

async function resolveBinary(name: string, candidates: string[]): Promise<string | null> {
  // Probe absolute candidates first so app-bundled CLIs (ChatGPT.app Codex) win
  // even when `command -v` has nothing on PATH.
  for (const candidate of candidates) {
    if (existsSync(candidate) && (await canRun(candidate))) return candidate
  }
  return resolveFromShell(name)
}

async function resolveFromShell(command: string): Promise<string | null> {
  if (isWindows) {
    try {
      const { stdout } = await execFileAsync('where.exe', [command], {
        timeout: 5000,
        env: processEnvWithProviderPath()
      })
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      const ordered = [
        ...lines.filter((line) => /\.exe$/i.test(line)),
        ...lines.filter((line) => !/\.exe$/i.test(line))
      ]
      for (const candidate of ordered) {
        if (await canRun(candidate)) return candidate
      }
    } catch {
      return null
    }
    return null
  }

  try {
    const { stdout } = await execFileAsync('/bin/zsh', ['-lc', `command -v ${command}`], {
      timeout: 5000
    })
    const trimmed = stdout.trim()
    if (!trimmed) return null
    if (await canRun(trimmed)) return trimmed
    return null
  } catch {
    return null
  }
}

async function canRun(command: string): Promise<boolean> {
  if (!command || (path.isAbsolute(command) && !existsSync(command))) {
    return false
  }
  try {
    // Bundled ChatGPT/Codex binaries are large and can be slow to cold-start.
    await execFileAsync(command, ['--version'], {
      timeout: 15000,
      env: processEnvWithProviderPath(),
      shell: windowsCommandNeedsShell(command)
    })
    return true
  } catch {
    return false
  }
}

export function buildProviderSpawn(
  id: AgentCliId,
  command: string,
  prompt: string,
  model: string | null | undefined
): { command: string; args: string[]; lastMessagePath?: string } {
  const selectedModel = model?.trim()
  const modelArgs =
    selectedModel && selectedModel.toLowerCase() !== 'auto' ? (['--model', selectedModel] as string[]) : []

  switch (id) {
    case 'cursor':
      return {
        command,
        args: [
          '--print',
          '--force',
          '--trust',
          '--output-format',
          'stream-json',
          ...modelArgs,
          prompt
        ]
      }
    case 'claude':
      // Official headless mode: claude -p … (https://code.claude.com/docs/en/headless)
      // --dangerously-skip-permissions == bypassPermissions for unattended file/shell work.
      return {
        command,
        args: [
          '-p',
          prompt,
          '--dangerously-skip-permissions',
          '--output-format',
          'stream-json',
          '--verbose',
          ...modelArgs
        ]
      }
    case 'codex': {
      // ChatGPT.app Codex rejects `--ask-for-approval` AFTER `exec`.
      // Put approval before the subcommand (or omit it; exec defaults to never).
      // https://developers.openai.com/codex/noninteractive
      // https://github.com/openai/codex/issues/26602
      // Also write the final message to a file so chat never depends only on JSONL parsing.
      const lastMessagePath = path.join(
        mkdtempSync(path.join(os.tmpdir(), 'vibeboard-codex-')),
        'last-message.txt'
      )
      return {
        command,
        args: [
          '--ask-for-approval',
          'never',
          'exec',
          '--sandbox',
          'workspace-write',
          '--json',
          '-o',
          lastMessagePath,
          ...modelArgs,
          prompt
        ],
        lastMessagePath
      }
    }
  }
}
