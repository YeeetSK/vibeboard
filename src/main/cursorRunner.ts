import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { CodeChange } from '../shared/types'
import { isAgentAuthenticated, resolveAgentCommand } from './cursorAdapter'
import { VibeBoardStore } from './database'

interface RunCursorTaskInput {
  taskId: string
  store: VibeBoardStore
  onStateChanged: () => void
}

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
  store.replaceCodeChanges(taskId, [])
  store.appendConversation(taskId, 'system', 'Starting Cursor CLI agent in the project folder.')
  onStateChanged()
  const baselineDiff = await collectGitDiffText(projectPath)

  const agentCommand = await resolveAgentCommand()
  if (!agentCommand) {
    store.updateTaskStatus({ taskId, status: 'attention' })
    store.appendConversation(taskId, 'system', 'Cursor CLI command `agent` is not installed or is not available on PATH.')
    onStateChanged()
    return
  }

  if (!(await isAgentAuthenticated(agentCommand))) {
    store.updateTaskStatus({ taskId, status: 'attention' })
    store.appendConversation(taskId, 'system', 'Cursor Agent is installed but not signed in. Use the sidebar login action, then run this task again.')
    onStateChanged()
    return
  }

  const optimizedPrompt = await buildFocusedPrompt(projectPath, context.prompt)
  store.appendConversation(taskId, 'system', 'Prepared a focused project brief to reduce unnecessary repo exploration.')
  onStateChanged()

  const child = spawn(agentCommand, ['--print', '--force', '--trust', '--output-format', 'stream-json', optimizedPrompt], {
    cwd: projectPath,
    env: process.env
  })
  console.info('[VibeBoard Cursor run]', { taskId, projectPath, agentCommand })

  let stdoutBuffer = ''
  let stderrBuffer = ''
  const stdoutLines: string[] = []

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      stdoutLines.push(line)
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
        stdoutLines.push(stdoutBuffer)
      }

      const assistantMessage = summarizeCursorRun(stdoutLines)
      if (assistantMessage) {
        store.appendConversation(taskId, 'assistant', assistantMessage)
      }

      if (code === 0) {
        const nextDiff = await collectGitDiffText(projectPath)
        const changes = nextDiff === baselineDiff ? [] : parseGitDiff(nextDiff, baselineDiff)
        store.replaceCodeChanges(taskId, changes)
        store.updateTaskStatus({ taskId, status: 'done_unread' })
      } else {
        store.updateTaskStatus({ taskId, status: 'attention' })
        store.appendConversation(
          taskId,
          'system',
          stderrBuffer.trim() || `Cursor CLI agent exited with code ${code ?? 'unknown'}.`
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

function summarizeCursorRun(lines: string[]): string {
  const fragments: string[] = []

  for (const line of lines) {
    const text = summarizeCursorLine(line)
    if (text && !isProgressNarration(text)) fragments.push(text)
  }

  return mergeTextFragments(fragments).trim()
}

function summarizeCursorLine(line: string): string {
  const trimmed = line.trim()
  if (!trimmed) return ''

  try {
    return normalizeCursorText(findReadableText(JSON.parse(trimmed) as unknown))
  } catch {
    return shouldDisplayCursorText(trimmed) ? normalizeCursorText(trimmed) : ''
  }
}

function findReadableText(value: unknown, parentKey = ''): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  for (const key of ['message', 'text', 'content', 'summary']) {
    const text = findReadableText(record[key], key)
    if (shouldDisplayCursorText(text, parentKey || key)) return text
  }

  if (Array.isArray(value)) {
    return value.map((item) => findReadableText(item, parentKey)).filter((text) => shouldDisplayCursorText(text)).join(' ')
  }

  for (const [key, nested] of Object.entries(record)) {
    const text = findReadableText(nested, key)
    if (shouldDisplayCursorText(text, key)) return text
  }
  return ''
}

function shouldDisplayCursorText(text: string, key = ''): boolean {
  const trimmed = normalizeCursorText(text)
  if (!trimmed) return false
  if (key === 'role' || key === 'type' || key === 'event' || key === 'status') return false
  if (
    /^(system|user|assistant|thinking|tool_call|result|metadata|init|start|started|end|done|completed|success)$/i.test(
      trimmed
    )
  ) {
    return false
  }
  if (trimmed.includes('You are running inside VibeBoard as a background coding agent.')) return false
  if (trimmed.includes('Token and exploration rules:')) return false
  if (trimmed.length < 3 && !/[.!?]$/.test(trimmed)) return false
  return true
}

function normalizeCursorText(text: string): string {
  return text
    .trim()
    .replace(
      /^(?:init|start|started|completed|success|done|end)\s+(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s+)?/i,
      ''
    )
    .replace(/^(?:(?:started|completed|success|done|end)\s+)+/i, '')
    .replace(/\s+(?:(?:started|completed|success|done|end)\s*)+$/i, '')
    .trim()
}

function isProgressNarration(text: string): boolean {
  const trimmed = normalizeCursorText(text)
  return /^(i('|’)?m|i am|i('|’)?ll|i will|reading|reviewing|examining|checking|running|looking|scanning|opening|inspecting)\b/i.test(
    trimmed
  ) || /^the project structure is now clear\b/i.test(trimmed)
}

function mergeTextFragments(fragments: string[]): string {
  const output: string[] = []
  let current = ''

  for (const fragment of fragments) {
    const text = normalizeCursorText(fragment)
    if (!text) continue
    if (output.includes(text) || current === text) continue

    if (!current) {
      current = text
      continue
    }

    if (current.endsWith(text)) continue

    if (shouldStartNewParagraph(current, text)) {
      output.push(current)
      current = text
    } else {
      current = joinFragment(current, text)
    }
  }

  if (current) output.push(current)
  return output.join('\n\n')
}

function shouldStartNewParagraph(previous: string, next: string): boolean {
  return previous.endsWith('.') || previous.endsWith('!') || previous.endsWith('?') || next.startsWith('#') || next.startsWith('- ')
}

function joinFragment(previous: string, next: string): string {
  if (/^[,.;:!?)]/.test(next)) return `${previous}${next}`
  if (previous.endsWith('(') || previous.endsWith('/') || next.startsWith('/')) return `${previous}${next}`
  return `${previous} ${next}`
}

function collectGitDiffText(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('git', ['diff', '--no-ext-diff', '--unified=80', '--', '.'], { cwd })
    let output = ''

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.on('close', () => {
      resolve(output.trim())
    })

    child.on('error', () => {
      resolve('')
    })
  })
}

function parseGitDiff(diff: string, baselineDiff = ''): Array<Pick<CodeChange, 'filePath' | 'summary' | 'changeType' | 'language' | 'diffText'>> {
  const files: Array<Pick<CodeChange, 'filePath' | 'summary' | 'changeType' | 'language' | 'diffText'>> = []
  const baselineChunks = diffChunkMap(baselineDiff)
  const chunks = diffChunkMap(diff)

  for (const [fileKey, chunk] of chunks) {
    if (baselineChunks.get(fileKey) === chunk) continue

    const lines = chunk.split('\n')
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

function diffChunkMap(diff: string): Map<string, string> {
  const chunks = new Map<string, string>()

  for (const chunk of diff.split(/^diff --git /m).filter(Boolean)) {
    const normalizedChunk = `diff --git ${chunk}`.trim()
    const header = normalizedChunk.split('\n')[0] ?? ''
    const match = header.match(/^diff --git a\/(.+) b\/(.+)$/)
    chunks.set(match?.[2] ?? match?.[1] ?? header, normalizedChunk)
  }

  return chunks
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
