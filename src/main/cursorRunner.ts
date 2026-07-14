import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { CodeChange } from '../shared/types'
import { VibeBoardStore } from './database'

interface RunCursorTaskInput {
  taskId: string
  store: VibeBoardStore
  onStateChanged: () => void
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

export async function runCursorTask({ taskId, store, onStateChanged }: RunCursorTaskInput): Promise<void> {
  const context = store.getTaskRunContext(taskId)
  if (!context) {
    return
  }

  if (!context.project) {
    store.updateTaskStatus({ taskId, status: 'attention' })
    store.appendConversation(taskId, 'system', 'Select a project before running this task with Cursor.')
    onStateChanged()
    return
  }
  const projectPath = context.project.path

  store.updateTaskStatus({ taskId, status: 'processing' })
  store.appendConversation(taskId, 'system', 'Starting Cursor agent in the project folder.')
  onStateChanged()

  const hasCursorAgent = await commandExists('cursor-agent')
  if (!hasCursorAgent) {
    store.updateTaskStatus({ taskId, status: 'attention' })
    store.appendConversation(taskId, 'system', 'cursor-agent is not installed or is not available on PATH.')
    onStateChanged()
    return
  }

  const optimizedPrompt = await buildFocusedPrompt(projectPath, context.prompt)
  store.appendConversation(taskId, 'system', 'Prepared a focused project brief to reduce unnecessary repo exploration.')
  onStateChanged()

  const command = `cursor-agent --print --force --output-format stream-json ${shellQuote(optimizedPrompt)}`
  const child = spawn('/bin/zsh', ['-lc', command], {
    cwd: projectPath,
    env: process.env
  })

  let stdoutBuffer = ''
  let stderrBuffer = ''
  let lastMessage = ''

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const message = summarizeCursorLine(line)
      if (message && message !== lastMessage) {
        lastMessage = message
        store.appendConversation(taskId, 'assistant', message)
        onStateChanged()
      }
    }
  })

  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString()
  })

  await new Promise<void>((resolve) => {
    let finished = false
    const finish = (): void => {
      if (!finished) {
        finished = true
        resolve()
      }
    }

    child.on('error', (error) => {
      store.updateTaskStatus({ taskId, status: 'attention' })
      store.appendConversation(taskId, 'system', error.message)
      onStateChanged()
      finish()
    })

    child.on('close', async (code) => {
      if (stdoutBuffer.trim()) {
        const message = summarizeCursorLine(stdoutBuffer)
        if (message) {
          store.appendConversation(taskId, 'assistant', message)
        }
      }

      const changes = await collectGitDiff(projectPath)
      if (changes.length > 0) {
        store.replaceCodeChanges(taskId, changes)
      }

      if (code === 0) {
        store.updateTaskStatus({ taskId, status: 'done_unread' })
        store.appendConversation(
          taskId,
          'system',
          changes.length > 0
            ? `Captured ${changes.length} changed file${changes.length === 1 ? '' : 's'}.`
            : 'Cursor finished without file changes.'
        )
      } else {
        store.updateTaskStatus({ taskId, status: 'attention' })
        store.appendConversation(
          taskId,
          'system',
          stderrBuffer.trim() || `Cursor agent exited with code ${code ?? 'unknown'}.`
        )
      }
      onStateChanged()
      finish()
    })
  })
}

async function buildFocusedPrompt(projectPath: string, prompt: string): Promise<string> {
  const [trackedFiles, changedFiles, manifestSummary] = await Promise.all([
    listTrackedFiles(projectPath),
    listChangedFiles(projectPath),
    readManifestSummary(projectPath)
  ])
  const candidateFiles = rankRelevantFiles(prompt, trackedFiles, changedFiles).slice(0, 40)

  return [
    'You are running inside VibeBoard as a background coding agent.',
    '',
    'Token and exploration rules:',
    '- Do not scan the whole repository unless the task explicitly requires it.',
    '- Start from the focused file candidates below.',
    '- Open only files that are likely relevant to the requested change.',
    '- Prefer targeted searches over broad recursive reading.',
    '- Keep edits scoped to the task.',
    '',
    manifestSummary ? `Project hints:\n${manifestSummary}` : '',
    candidateFiles.length > 0 ? `Focused file candidates:\n${candidateFiles.map((file) => `- ${file}`).join('\n')}` : '',
    '',
    'User task:',
    prompt
  ]
    .filter(Boolean)
    .join('\n')
}

function listTrackedFiles(cwd: string): Promise<string[]> {
  return runCommand('git', ['ls-files'], cwd).then((output) =>
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((file) => !isIgnoredForContext(file))
  )
}

function listChangedFiles(cwd: string): Promise<string[]> {
  return runCommand('git', ['status', '--short'], cwd).then((output) =>
    output
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .filter((file) => !isIgnoredForContext(file))
  )
}

function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd })
    let output = ''

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.on('close', () => resolve(output))
    child.on('error', () => resolve(''))
  })
}

async function readManifestSummary(projectPath: string): Promise<string> {
  const packagePath = path.join(projectPath, 'package.json')
  try {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const scripts = Object.keys(packageJson.scripts ?? {}).slice(0, 12)
    const deps = Object.keys({ ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) }).slice(
      0,
      24
    )
    return [
      scripts.length > 0 ? `Scripts: ${scripts.join(', ')}` : '',
      deps.length > 0 ? `Dependencies: ${deps.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  } catch {
    return ''
  }
}

function rankRelevantFiles(prompt: string, files: string[], changedFiles: string[]): string[] {
  const promptTerms = new Set(
    prompt
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3)
  )
  const changedSet = new Set(changedFiles)

  return files
    .map((file) => ({ file, score: scoreFile(file, promptTerms, changedSet.has(file)) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .map((item) => item.file)
}

function scoreFile(file: string, promptTerms: Set<string>, isChanged: boolean): number {
  const normalized = file.toLowerCase()
  const segments = normalized.split(/[/.\\_-]+/)
  let score = isChanged ? 10 : 0

  for (const term of promptTerms) {
    if (normalized.includes(term)) score += 4
    if (segments.includes(term)) score += 3
  }

  if (normalized.includes('src/')) score += 1
  if (/(package\.json|vite\.config|electron|database|runner|app\.tsx|styles\.css)$/.test(normalized)) score += 2
  if (/\.(ts|tsx|js|jsx|css|json|md)$/.test(normalized)) score += 1
  return score
}

function isIgnoredForContext(file: string): boolean {
  return /(^|\/)(node_modules|dist|out|release|\.git)\//.test(file) || /\.(png|jpg|jpeg|gif|webp|dmg|exe|zip)$/i.test(file)
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('/bin/zsh', ['-lc', `command -v ${command}`], { env: process.env })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

function summarizeCursorLine(line: string): string {
  const trimmed = line.trim()
  if (!trimmed) return ''

  try {
    const event = JSON.parse(trimmed) as unknown
    return findReadableText(event)
  } catch {
    return trimmed
  }
}

function findReadableText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  for (const key of ['message', 'text', 'content', 'summary', 'title']) {
    const text = findReadableText(record[key])
    if (text) return text
  }

  for (const nested of Object.values(record)) {
    const text = findReadableText(nested)
    if (text) return text
  }
  return ''
}

function collectGitDiff(cwd: string): Promise<Array<Pick<CodeChange, 'filePath' | 'summary' | 'changeType' | 'language' | 'diffText'>>> {
  return new Promise((resolve) => {
    const child = spawn('git', ['diff', '--no-ext-diff', '--unified=80', '--', '.'], { cwd })
    let output = ''

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.on('close', () => {
      resolve(parseGitDiff(output))
    })

    child.on('error', () => {
      resolve([])
    })
  })
}

function parseGitDiff(diff: string): Array<Pick<CodeChange, 'filePath' | 'summary' | 'changeType' | 'language' | 'diffText'>> {
  const files: Array<Pick<CodeChange, 'filePath' | 'summary' | 'changeType' | 'language' | 'diffText'>> = []
  const chunks = diff.split(/^diff --git /m).filter(Boolean)

  for (const chunk of chunks) {
    const lines = `diff --git ${chunk}`.split('\n')
    const header = lines[0] ?? ''
    const match = header.match(/^diff --git a\/(.+) b\/(.+)$/)
    const filePath = match?.[2] ?? match?.[1] ?? 'unknown'
    const changeType = lines.some((line) => line.startsWith('deleted file'))
      ? 'deleted'
      : lines.some((line) => line.startsWith('new file'))
        ? 'added'
        : 'modified'
    const hunkStart = lines.findIndex((line) => line.startsWith('@@'))
    const diffText = hunkStart >= 0 ? lines.slice(hunkStart).join('\n').trim() : chunk.trim()
    const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
    const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length

    files.push({
      filePath,
      changeType,
      language: languageFromPath(filePath),
      diffText,
      summary: `${added} additions, ${removed} deletions`
    })
  }

  return files
}

function languageFromPath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase()
  const languageMap: Record<string, string> = {
    css: 'css',
    html: 'xml',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    mjs: 'javascript',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'tsx',
    xml: 'xml'
  }
  return extension ? languageMap[extension] || '' : ''
}
