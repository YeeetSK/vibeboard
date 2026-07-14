import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { CursorDebugInfo, CursorStatus, RunTaskResult } from '../shared/types'

const execFileAsync = promisify(execFile)
const cursorInstallCommand = 'curl https://cursor.com/install -fsS | bash'
let lastInstallOutput = ''

export interface CursorAdapter {
  status(): Promise<CursorStatus>
  installCli(): Promise<RunTaskResult>
}

export class PlaceholderCursorAdapter implements CursorAdapter {
  async status(): Promise<CursorStatus> {
    const debug = await getCursorDebugInfo()
    console.info('[VibeBoard Cursor debug]', debug)
    return {
      available: Boolean(debug.agentCommand),
      label: debug.agentCommand ? 'agent ready' : 'agent missing',
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
  return {
    cursorCommand: await resolveCursorCommand(),
    agentCommand: await resolveAgentCommand(),
    checkedCursorCommands: cursorCommandCandidates(),
    checkedAgentCommands: [...agentCandidates(), ...legacyCursorAgentCandidates()],
    installCommand: cursorInstallCommand,
    lastInstallOutput,
    processPath: process.env.PATH ?? '',
    shellPath: await getShellPath()
  }
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
    await execFileAsync(command, ['--version'])
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
