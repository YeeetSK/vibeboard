import { spawn } from 'node:child_process'
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

  const command = `cursor-agent --print --force --output-format stream-json ${shellQuote(context.prompt)}`
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
