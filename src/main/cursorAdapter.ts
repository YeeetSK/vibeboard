import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AgentModel, CursorDebugInfo, CursorStatus, RunTaskResult } from '../shared/types'

const execFileAsync = promisify(execFile)
const cursorAgentVersion = '2026.07.16-899851b'
const isWindows = process.platform === 'win32'

/** Unix install script (macOS / Linux). */
export const cursorInstallCommand = [
  'set -e',
  'OS="$(uname -s)"',
  'case "$OS" in Darwin*) OS="darwin" ;; Linux*) OS="linux" ;; *) echo "Unsupported OS: $OS"; exit 1 ;; esac',
  'ARCH="$(uname -m)"',
  'case "$ARCH" in arm64|aarch64) ARCH="arm64" ;; x86_64|amd64) ARCH="x64" ;; *) echo "Unsupported architecture: $ARCH"; exit 1 ;; esac',
  `VERSION="${cursorAgentVersion}"`,
  'FINAL_DIR="$HOME/.local/share/cursor-agent/versions/$VERSION"',
  'TEMP_DIR="$HOME/.local/share/cursor-agent/versions/.tmp-$VERSION-$(date +%s)"',
  'URL="https://downloads.cursor.com/lab/$VERSION/$OS/$ARCH/agent-cli-package.tar.gz"',
  'echo "Downloading Cursor Agent package..."',
  'mkdir -p "$TEMP_DIR" "$HOME/.local/bin"',
  'curl -fL "$URL" | tar --strip-components=1 -xzf - -C "$TEMP_DIR"',
  'rm -rf "$FINAL_DIR"',
  'mv "$TEMP_DIR" "$FINAL_DIR"',
  'ln -sf "$FINAL_DIR/cursor-agent" "$HOME/.local/bin/agent"',
  'ln -sf "$FINAL_DIR/cursor-agent" "$HOME/.local/bin/cursor-agent"',
  'echo "Cursor Agent installed."'
].join(' && ')

/** Official Windows installer from cursor.com. */
export const windowsCursorInstallCommand =
  "irm 'https://cursor.com/install?win32=true' | iex"

let lastInstallOutput = ''

export interface CursorAdapter {
  status(): Promise<CursorStatus>
  installCli(): Promise<RunTaskResult>
}

export class PlaceholderCursorAdapter implements CursorAdapter {
  async status(): Promise<CursorStatus> {
    const debug = await getCursorDebugInfo()
    const isReady = Boolean(debug.agentCommand) && isAuthenticatedStatus(debug.authStatus)
    return {
      available: isReady,
      label: isReady ? 'agent signed in' : debug.agentCommand ? 'agent login required' : 'agent missing',
      debug
    }
  }

  installCli(): Promise<RunTaskResult> {
    return installCursorCli()
  }
}

export function windowsCursorAgentDir(): string {
  const localAppData =
    process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(localAppData, 'cursor-agent')
}

/** Keep the current Electron process able to find a just-installed agent. */
export function ensureWindowsAgentPath(): void {
  if (!isWindows) return
  const agentDir = windowsCursorAgentDir()
  const current = process.env.PATH ?? ''
  const parts = current.split(path.delimiter).filter(Boolean)
  if (parts.some((part) => path.resolve(part) === path.resolve(agentDir))) return
  process.env.PATH = `${agentDir}${path.delimiter}${current}`
}

export function processEnvWithAgentPath(): NodeJS.ProcessEnv {
  if (isWindows) ensureWindowsAgentPath()
  return { ...process.env }
}

export async function resolveAgentCommand(): Promise<string | null> {
  if (isWindows) ensureWindowsAgentPath()

  for (const candidate of agentCandidates()) {
    if (await canRun(candidate)) return candidate
  }

  const fromShell = await resolveFromShell('agent')
  if (fromShell) return fromShell

  for (const candidate of legacyCursorAgentCandidates()) {
    if (await canRun(candidate)) return candidate
  }

  const legacyFromShell = await resolveFromShell('cursor-agent')
  if (legacyFromShell) return legacyFromShell

  return null
}

export async function getCursorDebugInfo(): Promise<CursorDebugInfo> {
  if (isWindows) ensureWindowsAgentPath()
  const agentCommand = await resolveAgentCommand()
  return {
    cursorCommand: await resolveCursorCommand(),
    agentCommand,
    authStatus: agentCommand ? await getAgentAuthStatus(agentCommand) : 'agent not installed',
    checkedCursorCommands: cursorCommandCandidates(),
    checkedAgentCommands: [...agentCandidates(), ...legacyCursorAgentCandidates()],
    installCommand: isWindows ? windowsCursorInstallCommand : cursorInstallCommand,
    lastInstallOutput,
    processPath: process.env.PATH ?? '',
    shellPath: await getShellPath()
  }
}

export async function isAgentAuthenticated(command?: string | null): Promise<boolean> {
  const agentCommand = command ?? (await resolveAgentCommand())
  if (!agentCommand) return false
  return isAuthenticatedStatus(await getAgentAuthStatus(agentCommand))
}

export async function listAgentModels(): Promise<AgentModel[]> {
  const agentCommand = await resolveAgentCommand()
  if (!agentCommand) {
    throw new Error('Cursor Agent is not installed.')
  }
  if (!(await isAgentAuthenticated(agentCommand))) {
    throw new Error('Cursor Agent is not signed in.')
  }

  try {
    const { stdout, stderr } = await execFileAsync(agentCommand, ['models'], {
      timeout: 20000,
      maxBuffer: 1024 * 1024,
      env: processEnvWithAgentPath()
    })
    const models = parseAgentModelsOutput([stdout, stderr].join('\n'))
    if (models.length === 0) {
      throw new Error('No models returned by Cursor Agent.')
    }
    return models
  } catch (error) {
    if (error instanceof Error && /not installed|not signed in|No models returned/i.test(error.message)) {
      throw error
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not list Cursor models. ${detail}`)
  }
}

function parseAgentModelsOutput(output: string): AgentModel[] {
  const models: AgentModel[] = []
  const seen = new Set<string>()

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || /^available models/i.test(line) || /^tip:/i.test(line) || /^use --model/i.test(line)) {
      continue
    }

    const match = line.match(/^(\S+)\s+-\s+(.+)$/)
    if (!match) continue

    const id = match[1]
    let label = match[2].trim()
    let isDefault = false
    let isCurrent = false
    const tagMatch = label.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
    if (tagMatch) {
      label = tagMatch[1].trim() || id
      const tags = tagMatch[2].toLowerCase()
      isDefault = /\bdefault\b/.test(tags)
      isCurrent = /\bcurrent\b/.test(tags)
    }

    if (seen.has(id)) continue
    seen.add(id)
    models.push({ id, label, isDefault, isCurrent })
  }

  return models
}

async function getAgentAuthStatus(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['status'], {
      timeout: 8000,
      env: processEnvWithAgentPath()
    })
    return [stdout, stderr].join('').trim() || 'status unavailable'
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error)
    return output.trim() || 'status failed'
  }
}

function isAuthenticatedStatus(status: string): boolean {
  return !/not logged in|authentication required|login required|run 'agent login'|run `agent login`|status failed|status unavailable/i.test(
    status
  )
}

async function resolveFromShell(command: string): Promise<string | null> {
  if (isWindows) {
    try {
      const { stdout } = await execFileAsync('where.exe', [command], {
        timeout: 5000,
        env: processEnvWithAgentPath()
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
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function getShellPath(): Promise<string> {
  if (isWindows) {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', '[Environment]::GetEnvironmentVariable("PATH","User")'],
        { timeout: 5000 }
      )
      return stdout.trim()
    } catch {
      return process.env.PATH ?? ''
    }
  }

  try {
    const { stdout } = await execFileAsync('/bin/zsh', ['-lc', 'printf "%s" "$PATH"'], {
      timeout: 5000
    })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function canRun(command: string): Promise<boolean> {
  if (!command || (path.isAbsolute(command) && !existsSync(command))) {
    return false
  }

  try {
    await execFileAsync(command, ['--version'], {
      timeout: 8000,
      env: processEnvWithAgentPath(),
      // .cmd / .bat need a shell on Windows; prefer .exe when available.
      shell: isWindows && /\.(cmd|bat)$/i.test(command)
    })
    return true
  } catch {
    return false
  }
}

function agentCandidates(): string[] {
  const home = os.homedir()
  if (isWindows) {
    const agentDir = windowsCursorAgentDir()
    return [
      path.join(agentDir, 'agent.exe'),
      path.join(agentDir, 'cursor-agent.exe'),
      path.join(agentDir, 'agent.cmd'),
      path.join(agentDir, 'cursor-agent.cmd')
    ]
  }

  return [
    path.join(home, '.local', 'bin', 'agent'),
    path.join(home, '.cursor', 'bin', 'agent'),
    '/opt/homebrew/bin/agent',
    '/usr/local/bin/agent'
  ]
}

function legacyCursorAgentCandidates(): string[] {
  const home = os.homedir()
  if (isWindows) {
    const agentDir = windowsCursorAgentDir()
    return [path.join(agentDir, 'cursor-agent.exe'), path.join(agentDir, 'cursor-agent.cmd')]
  }

  return [
    path.join(home, '.local', 'bin', 'cursor-agent'),
    path.join(home, '.cursor', 'bin', 'cursor-agent'),
    '/opt/homebrew/bin/cursor-agent',
    '/usr/local/bin/cursor-agent'
  ]
}

async function installCursorCli(): Promise<RunTaskResult> {
  if (isWindows) {
    return installCursorCliWindows()
  }

  lastInstallOutput = `Running: ${cursorInstallCommand}`
  const result = await runInstallCommand('/bin/zsh', ['-lc', cursorInstallCommand], 120_000)
  const command = await resolveAgentCommand()

  if (command) {
    return { started: true, message: 'Connected to Cursor CLI.' }
  }

  return {
    started: false,
    message: result.message || 'Cursor CLI install did not finish. Check your network, then try Connect again.'
  }
}

async function installCursorCliWindows(): Promise<RunTaskResult> {
  ensureWindowsAgentPath()
  lastInstallOutput = `Running: ${windowsCursorInstallCommand}`

  const result = await runInstallCommand(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', windowsCursorInstallCommand],
    180_000
  )

  ensureWindowsAgentPath()
  const command = await resolveAgentCommand()

  if (command) {
    const authenticated = await isAgentAuthenticated(command)
    return {
      started: true,
      message: authenticated
        ? 'Connected to Cursor CLI.'
        : 'Cursor CLI installed. Sign in to finish setup.'
    }
  }

  return {
    started: false,
    message:
      result.message ||
      'Cursor CLI install did not finish. Check your network, then try Fix again.'
  }
}

async function resolveCursorCommand(): Promise<string | null> {
  const fromShell = await resolveFromShell('cursor')
  if (fromShell) return fromShell

  for (const candidate of cursorCommandCandidates()) {
    if (existsSync(candidate)) return candidate
  }

  return null
}

function cursorCommandCandidates(): string[] {
  if (isWindows) {
    const localAppData =
      process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local')
    return [
      path.join(localAppData, 'Programs', 'cursor', 'Cursor.exe'),
      path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe')
    ]
  }

  return [
    '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    '/opt/homebrew/bin/cursor',
    '/usr/local/bin/cursor'
  ]
}

function runInstallCommand(command: string, args: string[], timeoutMs: number): Promise<RunTaskResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: processEnvWithAgentPath(),
      windowsHide: true
    })
    let output = ''
    let finished = false

    const finish = (result: RunTaskResult): void => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve(result)
    }

    const timeout = setTimeout(() => {
      child.kill()
      lastInstallOutput = output.trim() || lastInstallOutput
      finish({
        started: false,
        message: isWindows
          ? 'Installer is taking too long. Use Sign in / Fix to open PowerShell and finish there.'
          : 'No installer output yet. Use Terminal install to see the Cursor installer directly.'
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      lastInstallOutput = output.trim()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      lastInstallOutput = output.trim()
    })

    child.on('error', (error) => {
      finish({ started: false, message: error.message })
    })

    child.on('close', (code) => {
      lastInstallOutput = output.trim()
      finish({
        started: code === 0,
        message: output.trim() || `Cursor CLI installer exited with code ${code ?? 'unknown'}.`
      })
    })
  })
}
