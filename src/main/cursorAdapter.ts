import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AgentModel, CursorDebugInfo, CursorStatus, RunTaskResult } from '../shared/types'

const execFileAsync = promisify(execFile)
const cursorAgentVersion = '2026.07.09-a3815c0'
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
let lastInstallOutput = ''

export interface CursorAdapter {
  status(): Promise<CursorStatus>
  installCli(): Promise<RunTaskResult>
}

export class PlaceholderCursorAdapter implements CursorAdapter {
  async status(): Promise<CursorStatus> {
    const debug = await getCursorDebugInfo()
    console.info('[VibeBoard Cursor debug]', debug)
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

export async function resolveAgentCommand(): Promise<string | null> {
  const fromShell = await resolveFromShell('agent')
  if (fromShell) return fromShell

  for (const candidate of agentCandidates()) {
    if (await canRun(candidate)) return candidate
  }

  const legacyFromShell = await resolveFromShell('cursor-agent')
  if (legacyFromShell) return legacyFromShell

  for (const candidate of legacyCursorAgentCandidates()) {
    if (await canRun(candidate)) return candidate
  }

  return null
}

export async function getCursorDebugInfo(): Promise<CursorDebugInfo> {
  const agentCommand = await resolveAgentCommand()
  return {
    cursorCommand: await resolveCursorCommand(),
    agentCommand,
    authStatus: agentCommand ? await getAgentAuthStatus(agentCommand) : 'agent not installed',
    checkedCursorCommands: cursorCommandCandidates(),
    checkedAgentCommands: [...agentCandidates(), ...legacyCursorAgentCandidates()],
    installCommand: cursorInstallCommand,
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
      maxBuffer: 1024 * 1024
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
    const { stdout, stderr } = await execFileAsync(command, ['status'], { timeout: 5000 })
    return [stdout, stderr].join('').trim() || 'status unavailable'
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error)
    return output.trim() || 'status failed'
  }
}

function isAuthenticatedStatus(status: string): boolean {
  return !/not logged in|authentication required|login required|run 'agent login'|run `agent login`|status failed|status unavailable/i.test(status)
}

async function resolveFromShell(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/bin/zsh', ['-lc', `command -v ${command}`])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function getShellPath(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('/bin/zsh', ['-lc', 'printf "%s" "$PATH"'])
    return stdout.trim()
  } catch {
    return ''
  }
}

async function canRun(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function agentCandidates(): string[] {
  const home = os.homedir()
  return [
    path.join(home, '.local', 'bin', 'agent'),
    path.join(home, '.cursor', 'bin', 'agent'),
    '/opt/homebrew/bin/agent',
    '/usr/local/bin/agent'
  ]
}

function legacyCursorAgentCandidates(): string[] {
  const home = os.homedir()
  return [
    path.join(home, '.local', 'bin', 'cursor-agent'),
    path.join(home, '.cursor', 'bin', 'cursor-agent'),
    '/opt/homebrew/bin/cursor-agent',
    '/usr/local/bin/cursor-agent'
  ]
}

async function installCursorCli(): Promise<RunTaskResult> {
  lastInstallOutput = `Running: ${cursorInstallCommand}`
  console.info('[VibeBoard Cursor install]', lastInstallOutput)
  const result = await runInstallCommand('/bin/zsh', ['-lc', cursorInstallCommand])
  const command = await resolveAgentCommand()

  if (command) {
    return { started: true, message: 'Connected to Cursor CLI.' }
  }

  return {
    started: false,
    message: result.message || 'Cursor CLI install did not finish. Check your network, then try Connect again.'
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
  return [
    '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    '/opt/homebrew/bin/cursor',
    '/usr/local/bin/cursor'
  ]
}

function runInstallCommand(command: string, args: string[]): Promise<RunTaskResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env
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
      child.kill('SIGTERM')
      lastInstallOutput = output.trim() || lastInstallOutput
      finish({
        started: false,
        message: 'No installer output yet. Use Terminal install to see the Cursor installer directly.'
      })
    }, 30000)

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
