import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import path from 'node:path'
import type {
  AgentCliId,
  CodeChange,
  ConversationAttachment,
  Project,
  RunMode,
  Task
} from '../shared/types'
import {
  agentCliDisplayName,
  buildProviderSpawn,
  isProviderAuthenticated,
  processEnvWithProviderPath,
  resolveProviderCommand,
  windowsCommandNeedsShell
} from './agentCli'
import { VibeBoardStore } from './database'

const protectedBranchNames = new Set(['main', 'master', 'develop', 'development', 'trunk', 'dev', 'release'])

const projectMemoryFileName = '.vibeboard-memory.md'
const projectMemoryMaxChars = 12000
const actualMessageMarker = 'VibeBoardStartActualMessage'

interface RunCursorTaskInput {
  taskId: string
  store: VibeBoardStore
  onStateChanged: () => void
  /** When true at completion, keep status as processing so a queued follow-up can run. */
  shouldContinue?: () => boolean
}

interface TaskRunTarget {
  cwd: string
  mode: RunMode
  branchName: string | null
  worktreePath: string | null
}

interface ActiveCursorRun {
  child: ChildProcess
  abort: () => void
  flushProgress: () => void
}

const activeCursorRuns = new Map<string, ActiveCursorRun>()

function quoteWindowsCmdArg(value: string): string {
  if (!value) return '""'
  if (!/[\s"]/g.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

/** Spawn Claude/Codex/Cursor with Windows .cmd shim support and safe argv quoting. */
function spawnProviderProcess(
  command: string,
  args: string[],
  options: { cwd: string; hooksPath: string }
): ChildProcess {
  const env = {
    ...processEnvWithProviderPath(),
    // Force agent git commits through our hooks so Co-authored-by / Cursor trailers are stripped.
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: options.hooksPath
  }
  const base = {
    cwd: options.cwd,
    // Ignore stdin. Codex/Claude treat an open pipe as "wait for more prompt input"
    // and hang forever even when the prompt was passed as an argv argument.
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
    env
  }

  if (windowsCommandNeedsShell(command)) {
    const cmdline = [quoteWindowsCmdArg(command), ...args.map(quoteWindowsCmdArg)].join(' ')
    return spawn(cmdline, {
      ...base,
      shell: true,
      windowsVerbatimArguments: true
    })
  }

  return spawn(command, args, base)
}

export function stopCursorTask(taskId: string): boolean {
  const active = activeCursorRuns.get(taskId)
  if (!active) return false
  active.abort()
  return true
}

export function flushAllCursorProgress(): void {
  for (const active of activeCursorRuns.values()) {
    active.flushProgress()
  }
}

export function stopAllCursorTasks(): string[] {
  const taskIds = [...activeCursorRuns.keys()]
  for (const taskId of taskIds) {
    stopCursorTask(taskId)
  }
  return taskIds
}

/** Read a relative file from the task worktree (preferred) or project checkout. */
export async function readTaskWorkspaceFile(
  store: VibeBoardStore,
  taskId: string,
  relativePath: string
): Promise<string | null> {
  const context = store.getTaskRunContext(taskId)
  if (!context?.project) return null

  const cleaned = relativePath.trim().replace(/\\/g, '/')
  if (!cleaned || cleaned.startsWith('/') || cleaned.includes('\0')) return null
  if (cleaned.split('/').some((part) => part === '..')) return null

  const roots = [context.task.worktreePath, context.project.path]
    .filter((root): root is string => Boolean(root?.trim()))
    .map((root) => path.resolve(root))

  for (const root of roots) {
    const fullPath = path.resolve(root, cleaned)
    const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`
    if (fullPath !== root && !fullPath.startsWith(rootWithSep)) continue
    try {
      return await readFile(fullPath, 'utf8')
    } catch {
      // try next root
    }
  }

  return null
}

export async function runCursorTask({
  taskId,
  store,
  onStateChanged,
  shouldContinue
}: RunCursorTaskInput): Promise<void> {
  const context = store.getTaskRunContext(taskId)
  if (!context) {
    return
  }

  if (!context.project) {
    store.updateTaskStatus({ taskId, status: 'attention' })
    store.appendConversation(taskId, 'system', 'Select a project before running this task.')
    onStateChanged()
    return
  }
  const isRevertRun = context.prompt.includes('Revert the code changes made for this specific task only.')
  const isCommitToMainRun = /Push the commit to (main|the default branch) on origin/i.test(context.prompt)
  const providerId: AgentCliId = store.getAgentCliSettings().activeCli
  const providerLabel = agentCliDisplayName(providerId)

  store.updateTaskStatus({ taskId, status: 'processing' })
  store.appendConversation(taskId, 'system', `Starting ${providerLabel} CLI in the project folder.`)
  onStateChanged()

  const agentCommand = await resolveProviderCommand(providerId)
  if (!agentCommand) {
    store.updateTaskStatus({ taskId, status: 'attention' })
    store.appendConversation(
      taskId,
      'system',
      `${providerLabel} CLI is not installed. Use Install & sign in in the sidebar, then run this task again.`
    )
    onStateChanged()
    return
  }

  if (!(await isProviderAuthenticated(providerId, agentCommand))) {
    store.updateTaskStatus({ taskId, status: 'attention' })
    store.appendConversation(
      taskId,
      'system',
      `${providerLabel} is installed but not signed in. Use Sign in in the sidebar, then run this task again.`
    )
    onStateChanged()
    return
  }

  let runTarget: TaskRunTarget
  try {
    runTarget = await prepareTaskRunTarget(context.task, context.project, store)
  } catch (error) {
    store.updateTaskStatus({ taskId, status: 'attention' })
    store.appendConversation(
      taskId,
      'system',
      error instanceof Error ? error.message : 'Could not prepare the task run workspace.'
    )
    onStateChanged()
    return
  }

  if (runTarget.mode === 'worktree') {
    const syncMessage = await syncPrimaryCheckoutToOrigin(context.project.path, { stashIfNeeded: false })
    if (syncMessage.didSync) {
      store.appendConversation(taskId, 'system', syncMessage.message)
      onStateChanged()
    }
  }

  await ensureProjectMemoryGitignoredForRoots(context.project.path, runTarget.cwd, runTarget.worktreePath)

  const baselineDiff = await collectGitDiffText(runTarget.cwd)
  const optimizedPrompt = await buildFocusedPrompt(
    runTarget.cwd,
    context.prompt,
    context.previousPrompts,
    context.attachments,
    runTarget
  )
  onStateChanged()

  const spawnPlan = buildProviderSpawn(providerId, agentCommand, optimizedPrompt, context.task.model)

  const hooksPath = await ensureVibeBoardGitHooks()
  const child = spawnProviderProcess(spawnPlan.command, spawnPlan.args, {
    cwd: runTarget.cwd,
    hooksPath
  })

  let stdoutBuffer = ''
  let stderrBuffer = ''
  let stderrLineBuffer = ''
  let aborted = false
  const stdoutLines: string[] = []
  const progressPublisher = createLiveProgressPublisher({
    taskId,
    store,
    onStateChanged,
    providerId
  })
  store.appendConversation(taskId, 'system', `${providerLabel} is running. Tool activity and thinking will appear here.`)
  onStateChanged()

  const abort = (): void => {
    if (aborted) return
    aborted = true
    progressPublisher.flush()
    progressPublisher.stop()
    if (!child.killed) {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL')
        }
      }, 800)
    }
  }
  activeCursorRuns.set(taskId, {
    child,
    abort,
    flushProgress: () => {
      progressPublisher.flush()
    }
  })

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      stdoutLines.push(line)
      progressPublisher.handleLine(line)
    }
  })

  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderrBuffer += text
    // Codex streams human progress on stderr; surface useful lines live.
    if (providerId === 'codex' || providerId === 'claude') {
      stderrLineBuffer += text
      const lines = stderrLineBuffer.split(/\r?\n/)
      stderrLineBuffer = lines.pop() ?? ''
      for (const line of lines) {
        progressPublisher.handleStderrLine(line)
      }
    }
  })

  await new Promise<void>((resolve) => {
    let finished = false
    const finish = (): void => {
      if (!finished) {
        finished = true
        activeCursorRuns.delete(taskId)
        progressPublisher.stop()
        resolve()
      }
    }

    child.on('error', (error) => {
      if (aborted) {
        store.updateTaskStatus({ taskId, status: 'attention' })
        onStateChanged()
        finish()
        return
      }
      const continueQueue = shouldContinue?.() ?? false
      if (!continueQueue) {
        store.updateTaskStatus({ taskId, status: 'attention' })
      }
      store.appendConversation(
        taskId,
        'system',
        `${error.message}\nRetry keeps the saved conversation and focused project context.`
      )
      onStateChanged()
      finish()
    })

    child.on('close', async (code) => {
      if (stdoutBuffer.trim()) {
        stdoutLines.push(stdoutBuffer)
        progressPublisher.handleLine(stdoutBuffer)
      }

      let assistantMessage = summarizeProviderRun(providerId, stdoutLines, stderrBuffer)
      let lastMessageFileChars = 0
      let lastMessageFilePresent = false
      if (!assistantMessage && spawnPlan.lastMessagePath) {
        try {
          const fromFile = (await readFile(spawnPlan.lastMessagePath, 'utf8')).trim()
          lastMessageFilePresent = true
          lastMessageFileChars = fromFile.length
          if (fromFile) assistantMessage = normalizeAssistantReply(fromFile)
        } catch {
          // file missing when the run failed before writing a final message
        }
      }
      if (spawnPlan.lastMessagePath) {
        try {
          rmSync(path.dirname(spawnPlan.lastMessagePath), { recursive: true, force: true })
        } catch {
          // ignore cleanup failures
        }
      }
      if (assistantMessage) {
        store.appendConversation(taskId, 'assistant', assistantMessage)
      } else if (code === 0 && !aborted) {
        store.appendConversation(
          taskId,
          'system',
          `${providerLabel} finished without a chat reply. Retry the prompt if you expected an answer.`
        )
      }

      if (providerId === 'codex' && (!assistantMessage || process.env.VIBEBOARD_DEBUG_CODEX === '1')) {
        const debug = buildCodexRunDebug({
          taskId,
          exitCode: code,
          aborted,
          stdoutLines,
          stderr: stderrBuffer,
          assistantPreview: assistantMessage,
          lastMessageFilePresent,
          lastMessageFileChars,
          lastMessagePath: spawnPlan.lastMessagePath ?? null
        })
        void writeCodexRunDebugLog(debug)
        if (!assistantMessage && !aborted) {
          store.appendConversation(taskId, 'system', formatCodexDebugSystemMessage(debug))
        }
      }

      if (aborted) {
        store.updateTaskStatus({ taskId, status: 'attention' })
        onStateChanged()
        finish()
        return
      }

      const continueQueue = shouldContinue?.() ?? false

      if (code === 0) {
        const nextDiff = await collectGitDiffText(runTarget.cwd)
        const workingTreeClean = nextDiff.trim() === ''
        const hadCapturedChanges = store.countCodeChanges(taskId) > 0
        // Commit/push clears the working tree; show only leftover uncommitted work (or nothing).
        // Otherwise keep using the run baseline so no-op runs do not wipe earlier captured diffs.
        const changes =
          isCommitToMainRun || workingTreeClean
            ? parseGitDiff(nextDiff)
            : nextDiff === baselineDiff
              ? []
              : parseGitDiff(nextDiff, baselineDiff)
        if (isRevertRun || isCommitToMainRun || workingTreeClean || changes.length > 0) {
          store.replaceCodeChanges(taskId, changes)
        }

        if (isCommitToMainRun) {
          // Only mark when there were real captured changes that are now gone (pushed + clean).
          // Chat-only / no-diff tasks must not get this marker.
          store.setTaskPushedToMain(taskId, workingTreeClean && hadCapturedChanges && changes.length === 0)
        } else if (isRevertRun) {
          store.setTaskPushedToMain(taskId, false)
        }

        if (isCommitToMainRun && context.project) {
          try {
            const syncMessage = await syncPrimaryCheckoutToOrigin(context.project.path, { stashIfNeeded: true })
            store.appendConversation(taskId, 'system', syncMessage.message)
          } catch (error) {
            store.appendConversation(
              taskId,
              'system',
              error instanceof Error
                ? `Could not sync the project folder to origin: ${error.message}`
                : 'Could not sync the project folder to origin.'
            )
          }
        }

        if (!continueQueue) {
          store.updateTaskStatus({ taskId, status: 'done_unread' })
        }
      } else {
        if (!continueQueue) {
          store.updateTaskStatus({ taskId, status: 'attention' })
        }
        const failureText = stderrBuffer.trim() || `${providerLabel} CLI exited with code ${code ?? 'unknown'}.`
        const recoveryText = assistantMessage
          ? 'Recovered partial agent output above. Retry keeps the saved conversation and focused project context.'
          : 'Retry keeps the saved conversation and focused project context.'
        store.appendConversation(
          taskId,
          'system',
          `${failureText}\n${recoveryText}`
        )
      }
      onStateChanged()
      finish()
    })
  })
}

async function prepareTaskRunTarget(task: Task, project: Project, store: VibeBoardStore): Promise<TaskRunTarget> {
  const mode = task.runModeOverride ?? project.runMode ?? 'worktree'
  const branchName = task.branchName ?? buildTaskBranchName(task)

  if (mode === 'shared') {
    return {
      cwd: project.path,
      mode,
      branchName: task.branchName,
      worktreePath: task.worktreePath
    }
  }

  await assertGitWorkTree(project.path)

  if (mode === 'branch') {
    await ensureBranch(project.path, branchName)
    await runCommandStrict('git', ['checkout', branchName], project.path)
    store.updateTaskRunWorkspace({ taskId: task.id, branchName, worktreePath: null })
    return {
      cwd: project.path,
      mode,
      branchName,
      worktreePath: null
    }
  }

  const worktreePath = task.worktreePath ?? taskWorktreePath(project.id, task.id)
  await ensureWorktree(project.path, worktreePath, branchName)
  store.updateTaskRunWorkspace({ taskId: task.id, branchName, worktreePath })

  return {
    cwd: worktreePath,
    mode,
    branchName,
    worktreePath
  }
}

const liveProgressMinIntervalMs = 2500
const liveProgressHeartbeatMs = 20_000
const liveProgressMaxLength = 280
const liveThinkingMinPublishLength = 48

function createLiveProgressPublisher(input: {
  taskId: string
  store: VibeBoardStore
  onStateChanged: () => void
  providerId: AgentCliId
}): {
  handleLine: (line: string) => void
  handleStderrLine: (line: string) => void
  flush: () => void
  stop: () => void
} {
  let lastPublishedAt = 0
  let lastPublishedText = ''
  let pendingText: string | null = null
  let thinkingBuffer = ''
  let flushTimer: NodeJS.Timeout | null = null
  let heartbeatTimer: NodeJS.Timeout | null = null
  let stopped = false

  const clearFlushTimer = (): void => {
    if (!flushTimer) return
    clearTimeout(flushTimer)
    flushTimer = null
  }

  const clearHeartbeatTimer = (): void => {
    if (!heartbeatTimer) return
    clearTimeout(heartbeatTimer)
    heartbeatTimer = null
  }

  const publish = (text: string): void => {
    if (stopped) return
    const normalized = text.trim()
    if (!normalized || normalized === lastPublishedText) return

    input.store.appendConversation(input.taskId, 'system', normalized)
    input.onStateChanged()
    lastPublishedAt = Date.now()
    lastPublishedText = normalized
    pendingText = null
    scheduleHeartbeat()
  }

  const flushPending = (): void => {
    flushTimer = null
    if (!pendingText) return
    publish(pendingText)
  }

  const queue = (text: string): void => {
    if (stopped) return
    const normalized = text.trim()
    if (!normalized || normalized === lastPublishedText) return

    const waitMs = Math.max(0, liveProgressMinIntervalMs - (Date.now() - lastPublishedAt))
    if (waitMs === 0) {
      clearFlushTimer()
      publish(normalized)
      return
    }

    pendingText = normalized
    if (flushTimer) return
    flushTimer = setTimeout(flushPending, waitMs)
  }

  const scheduleHeartbeat = (): void => {
    clearHeartbeatTimer()
    if (stopped) return
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null
      if (stopped) return
      queue('Still working… agent is active with no new chat update yet.')
      scheduleHeartbeat()
    }, liveProgressHeartbeatMs)
  }

  scheduleHeartbeat()

  return {
    handleLine: (line: string) => {
      const providerUpdate = extractProviderProgress(input.providerId, line)
      if (providerUpdate) {
        thinkingBuffer = ''
        queue(providerUpdate)
        return
      }

      const toolUpdate = extractLiveToolProgress(line)
      if (toolUpdate) {
        thinkingBuffer = ''
        queue(toolUpdate)
        return
      }

      const thinkingChunk = extractLiveThinkingChunk(line)
      if (!thinkingChunk) return

      thinkingBuffer = mergeThinkingBuffer(thinkingBuffer, thinkingChunk)
      const preview = formatThinkingProgress(thinkingBuffer)
      if (!preview) return
      queue(preview)
    },
    handleStderrLine: (line: string) => {
      const update = extractStderrProgress(input.providerId, line)
      if (!update) return
      thinkingBuffer = ''
      queue(update)
    },
    flush: () => {
      if (stopped) return
      clearFlushTimer()
      if (pendingText) {
        publish(pendingText)
        return
      }
      const preview = formatThinkingProgress(thinkingBuffer)
      if (preview) publish(preview)
    },
    stop: () => {
      stopped = true
      clearFlushTimer()
      clearHeartbeatTimer()
      pendingText = null
      thinkingBuffer = ''
    }
  }
}

function extractStderrProgress(providerId: AgentCliId, line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  // Skip noisy launcher warnings.
  if (/^WARNING:/i.test(trimmed)) return null
  if (/operation not permitted/i.test(trimmed)) return null
  if (/^\s*at\s+/i.test(trimmed)) return null

  if (providerId === 'codex') {
    if (/^(thinking|working|running|reading|editing|searching|planning|executing)\b/i.test(trimmed)) {
      return clampLiveProgress(trimmed)
    }
    if (/error:|failed|not logged in|unauthorized/i.test(trimmed)) {
      return clampLiveProgress(trimmed)
    }
    // Short status-y lines from the TUI-ish stderr progress stream.
    if (trimmed.length <= 180 && !trimmed.startsWith('{') && !/^\[/.test(trimmed)) {
      return clampLiveProgress(trimmed)
    }
  }

  if (providerId === 'claude' && /error:|failed|not logged in|authentication/i.test(trimmed)) {
    return clampLiveProgress(trimmed)
  }

  return null
}

function extractLiveToolProgress(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const toolUpdate = formatToolProgress(JSON.parse(trimmed) as unknown)
    return toolUpdate ? clampLiveProgress(toolUpdate) : null
  } catch {
    return null
  }
}

function extractLiveThinkingChunk(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const text = normalizeCursorText(findReadableText(JSON.parse(trimmed) as unknown))
    if (!shouldDisplayLiveProgressText(text)) return null
    return text
  } catch {
    const text = normalizeCursorText(trimmed)
    if (!shouldDisplayLiveProgressText(text)) return null
    return text
  }
}

function shouldDisplayLiveProgressText(text: string): boolean {
  if (!shouldDisplayCursorText(text)) return false
  if (text.includes(actualMessageMarker)) return false
  if (/^VibeBoard project memory/i.test(text)) return false
  if (/^Focused file candidates:/i.test(text)) return false
  if (/^User task:/i.test(text)) return false
  if (text.length < 8) return false
  return true
}

function mergeThinkingBuffer(previous: string, next: string): string {
  const left = previous.replace(/\s+/g, ' ').trim()
  const right = next.replace(/\s+/g, ' ').trim()
  if (!left) return right
  if (!right) return left
  if (right.startsWith(left) || right.includes(left)) return right
  if (left.endsWith(right) || left.includes(right)) return left
  if (/^[,.;:!?)]/.test(right)) return `${left}${right}`
  return `${left} ${right}`
}

/** Only publish complete thoughts, never raw stream deltas like "actual source of the". */
function formatThinkingProgress(buffer: string): string | null {
  const normalized = buffer.replace(/\s+/g, ' ').trim()
  if (normalized.length < liveThinkingMinPublishLength) return null

  const sentences = normalized.match(/[^.!?…]+[.!?…]+(?:\s+|$)/g)
  if (!sentences?.length) return null

  const preview = sentences
    .slice(-2)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (preview.length < liveThinkingMinPublishLength) return null
  return clampLiveProgress(preview)
}

function clampLiveProgress(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= liveProgressMaxLength) return normalized
  return `${normalized.slice(0, liveProgressMaxLength - 1).trim()}…`
}

function formatToolProgress(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const type = String(record.type ?? record.event ?? '').toLowerCase()
  const subtype = String(record.subtype ?? record.status ?? '').toLowerCase()

  const toolName = findToolName(record)
  if (!toolName) {
    if (type.includes('tool') || subtype.includes('tool')) {
      const target = findToolTarget(record)
      if (target) return `Using tools on \`${target}\``
    }
    return null
  }

  const verb = toolProgressVerb(toolName, subtype)
  const target = findToolTarget(record)
  return target ? `${verb} \`${target}\`` : `${verb}…`
}

function findToolName(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 5) return null
  const record = value as Record<string, unknown>

  for (const key of ['name', 'tool', 'toolName', 'tool_name']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim() && !/^(tool_call|function|tool)$/i.test(candidate)) {
      return candidate.trim()
    }
  }

  for (const [key, nested] of Object.entries(record)) {
    if (/tool/i.test(key) && nested && typeof nested === 'object') {
      const nestedName = findToolName(nested, depth + 1)
      if (nestedName) return nestedName

      for (const nestedKey of Object.keys(nested as Record<string, unknown>)) {
        if (/ToolCall$|tool_call$/i.test(nestedKey) || /^(Read|Write|Edit|Grep|Shell|Glob|Search|Delete|Bash)/i.test(nestedKey)) {
          return nestedKey.replace(/ToolCall$/i, '').replace(/_tool_call$/i, '')
        }
      }
    }
  }

  return null
}

function findToolTarget(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 6) return null
  const record = value as Record<string, unknown>

  for (const key of [
    'path',
    'filePath',
    'file_path',
    'target_file',
    'targetFile',
    'filename',
    'glob',
    'glob_pattern',
    'pattern',
    'command',
    'query',
    'search_term',
    'url'
  ]) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return shortenToolTarget(candidate.trim())
    }
  }

  for (const nested of Object.values(record)) {
    const target = findToolTarget(nested, depth + 1)
    if (target) return target
  }

  return null
}

function shortenToolTarget(target: string): string {
  const singleLine = target.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= 96) return singleLine
  return `${singleLine.slice(0, 93).trim()}…`
}

function toolProgressVerb(toolName: string, subtype: string): string {
  const normalized = toolName.replace(/ToolCall$/i, '').replace(/_/g, ' ').trim()
  const lower = normalized.toLowerCase()
  const done = /complet|end|success|result|finished/.test(subtype)

  if (/read|open|cat/.test(lower)) return done ? 'Read' : 'Reading'
  if (/write|edit|apply|patch|strreplace|search_replace/.test(lower)) return done ? 'Edited' : 'Editing'
  if (/delete|remove/.test(lower)) return done ? 'Deleted' : 'Deleting'
  if (/grep|search|rg|find/.test(lower)) return done ? 'Searched' : 'Searching'
  if (/glob|list/.test(lower)) return done ? 'Listed files' : 'Listing files'
  if (/shell|bash|terminal|command|exec/.test(lower)) return done ? 'Ran command' : 'Running command'
  if (/fetch|web|http/.test(lower)) return done ? 'Fetched' : 'Fetching'
  return done ? `Used ${normalized}` : `Using ${normalized}`
}

async function assertGitWorkTree(cwd: string): Promise<void> {
  const output = await runCommandStrict('git', ['rev-parse', '--is-inside-work-tree'], cwd).catch((error) => {
    throw new Error(`This run mode needs a Git repository. ${error instanceof Error ? error.message : ''}`.trim())
  })
  if (output.trim() !== 'true') {
    throw new Error('This run mode needs a Git repository.')
  }
}

async function ensureBranch(cwd: string, branchName: string): Promise<void> {
  const exists = await runCommandStrict('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], cwd)
    .then(() => true)
    .catch(() => false)
  if (exists) return
  await runCommandStrict('git', ['branch', branchName], cwd)
}

async function ensureWorktree(cwd: string, worktreePath: string, branchName: string): Promise<void> {
  let worktreeExists = false
  try {
    const worktreeStat = await stat(worktreePath)
    worktreeExists = worktreeStat.isDirectory()
  } catch {
    // The worktree does not exist yet.
  }
  if (worktreeExists) {
    await assertGitWorkTree(worktreePath)
    return
  }

  await mkdir(path.dirname(worktreePath), { recursive: true })
  await runCommand('git', ['fetch', 'origin', '--prune'], cwd)
  const branchExists = await runCommandStrict('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], cwd)
    .then(() => true)
    .catch(() => false)

  if (branchExists) {
    await runCommandStrict('git', ['worktree', 'add', worktreePath, branchName], cwd)
    return
  }

  const defaultBranch = await resolveDefaultBranch(cwd)
  const startPoint =
    defaultBranch &&
    (await runCommandStrict('git', ['rev-parse', '--verify', `origin/${defaultBranch}`], cwd)
      .then(() => `origin/${defaultBranch}`)
      .catch(() => null))

  await runCommandStrict(
    'git',
    ['worktree', 'add', '-b', branchName, worktreePath, startPoint ?? 'HEAD'],
    cwd
  )
}

interface SyncPrimaryCheckoutResult {
  didSync: boolean
  message: string
}

/** Fast-forward the project folder (primary checkout) to origin's default branch when safe. */
async function syncPrimaryCheckoutToOrigin(
  projectPath: string,
  options: { stashIfNeeded: boolean }
): Promise<SyncPrimaryCheckoutResult> {
  const isGitRepo = await runCommandStrict('git', ['rev-parse', '--is-inside-work-tree'], projectPath)
    .then((output) => output.trim() === 'true')
    .catch(() => false)
  if (!isGitRepo) {
    return { didSync: false, message: 'Project folder is not a Git repository; skipped sync.' }
  }

  await runCommand('git', ['fetch', 'origin', '--prune'], projectPath)

  const defaultBranch = await resolveDefaultBranch(projectPath)
  if (!defaultBranch) {
    return { didSync: false, message: 'Could not resolve the default branch; skipped project folder sync.' }
  }

  const currentBranch = (await runCommand('git', ['branch', '--show-current'], projectPath)).trim()
  if (!currentBranch) {
    return { didSync: false, message: 'Project folder is in detached HEAD; skipped sync.' }
  }
  if (currentBranch !== defaultBranch) {
    return {
      didSync: false,
      message: `Project folder is on \`${currentBranch}\`, not \`${defaultBranch}\`; left untouched.`
    }
  }

  const behindCount = Number.parseInt(
    (await runCommand('git', ['rev-list', '--count', `HEAD..origin/${defaultBranch}`], projectPath)).trim(),
    10
  )
  if (!Number.isFinite(behindCount) || behindCount <= 0) {
    return { didSync: false, message: `Project folder already matches origin/${defaultBranch}.` }
  }

  const dirty = (await runCommand('git', ['status', '--porcelain'], projectPath)).trim().length > 0
  let stashRef: string | null = null
  if (dirty) {
    if (!options.stashIfNeeded) {
      return {
        didSync: false,
        message: `Project folder is ${behindCount} commit(s) behind origin/${defaultBranch} but has local changes; left untouched.`
      }
    }

    const stashMessage = `vibeboard-autosync-${new Date().toISOString().slice(0, 10)}`
    await runCommandStrict('git', ['stash', 'push', '-u', '-m', stashMessage], projectPath)
    stashRef = stashMessage
  }

  try {
    await runCommandStrict('git', ['merge', '--ff-only', `origin/${defaultBranch}`], projectPath)
  } catch (error) {
    if (stashRef) {
      await runCommand('git', ['stash', 'pop'], projectPath)
    }
    throw error
  }

  return {
    didSync: true,
    message: stashRef
      ? `Synced project folder to origin/${defaultBranch} (${behindCount} commit(s)). Local WIP stashed as \`${stashRef}\`.`
      : `Synced project folder to origin/${defaultBranch} (${behindCount} commit(s)).`
  }
}

function taskWorktreePath(projectId: string, taskId: string): string {
  return path.join(app.getPath('userData'), 'task-worktrees', projectId, taskId)
}

function buildTaskBranchName(task: Task): string {
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'task'
  return `vibeboard/${slug}-${task.id.slice(0, 8)}`
}

/** Removes the task worktree and deletes its local + remote (origin) branch when present. */
export async function cleanupTaskGitWorkspace(task: Task, project: Project | null): Promise<void> {
  if (!project?.path) return
  if (!task.branchName && !task.worktreePath) return

  const cwd = project.path
  const isGitRepo = await runCommandStrict('git', ['rev-parse', '--is-inside-work-tree'], cwd)
    .then((output) => output.trim() === 'true')
    .catch(() => false)
  if (!isGitRepo) return

  if (task.worktreePath) {
    await runCommand('git', ['worktree', 'remove', '--force', task.worktreePath], cwd)
    await rm(task.worktreePath, { recursive: true, force: true }).catch(() => undefined)
    await runCommand('git', ['worktree', 'prune'], cwd)
  }

  const branchName = task.branchName?.trim()
  if (!branchName || protectedBranchNames.has(branchName)) return

  const currentBranch = (await runCommand('git', ['branch', '--show-current'], cwd)).trim()
  if (currentBranch === branchName) {
    const fallbackBranch = await resolveDefaultBranch(cwd)
    if (fallbackBranch && fallbackBranch !== branchName) {
      await runCommand('git', ['checkout', fallbackBranch], cwd)
    }
  }

  await runCommand('git', ['branch', '-D', branchName], cwd)

  const remoteHeads = await runCommand('git', ['ls-remote', '--heads', 'origin', branchName], cwd)
  if (!remoteHeads.trim()) return

  await runCommand('git', ['push', 'origin', '--delete', branchName], cwd)
}

async function resolveDefaultBranch(cwd: string): Promise<string | null> {
  const symbolicRef = (await runCommand('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd)).trim()
  const remoteMatch = symbolicRef.match(/refs\/remotes\/origin\/(.+)$/)
  if (remoteMatch?.[1]) return remoteMatch[1]

  for (const candidate of ['main', 'master']) {
    const exists = await runCommandStrict('git', ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`], cwd)
      .then(() => true)
      .catch(() => false)
    if (exists) return candidate
  }

  return null
}

/**
 * Hooks used for agent runs: strip Co-authored-by / Cursor attribution from commit messages.
 * Wired via GIT_CONFIG core.hooksPath so we rewrite the message even if the agent passes --trailer.
 */
async function ensureVibeBoardGitHooks(): Promise<string> {
  const hooksPath = path.join(app.getPath('userData'), 'git-hooks')
  await mkdir(hooksPath, { recursive: true })

  const stripScript = `#!/bin/sh
# VibeBoard: leave commit authorship to the user. Strip agent attribution trailers.
msg_file="$1"
[ -n "$msg_file" ] && [ -f "$msg_file" ] || exit 0
tmp="$(mktemp)"
# Drop Co-authored-by and Made-with / Made with Cursor style trailers (case-insensitive).
grep -viE '^[[:space:]]*(Co-authored-by:|Made-with:|Made-with[[:space:]]|Made with )' "$msg_file" > "$tmp" || cp "$msg_file" "$tmp"
mv "$tmp" "$msg_file"
exit 0
`

  for (const hookName of ['prepare-commit-msg', 'commit-msg'] as const) {
    const hookPath = path.join(hooksPath, hookName)
    await writeFile(hookPath, stripScript, { encoding: 'utf8', mode: 0o755 })
  }

  return hooksPath
}

async function buildFocusedPrompt(
  projectPath: string,
  prompt: string,
  previousPrompts: string[],
  attachments: ConversationAttachment[] = [],
  runTarget?: TaskRunTarget
): Promise<string> {
  const [trackedFiles, changedFiles, manifestSummary, projectMemory] = await Promise.all([
    listTrackedFiles(projectPath),
    listChangedFiles(projectPath),
    readManifestSummary(projectPath),
    prepareProjectMemory(projectPath)
  ])
  const candidateFiles = rankRelevantFiles(prompt, trackedFiles, changedFiles).slice(0, 40)
  const attachmentPaths = attachments.map((attachment) => attachment.filePath).filter(Boolean)
  const worktreeRules =
    runTarget?.mode === 'worktree'
      ? [
          'Git worktree rules:',
          '- You are inside a task worktree. Edit only this worktree.',
          '- Do not edit or clean up the project main checkout or other worktrees.',
          '- The default branch (main/master) is usually checked out in the project folder already, so never run `git checkout main` or `git checkout master` here.',
          '- To publish commits onto the default branch on origin, push with `git push origin HEAD:main` (or HEAD:master). Prefer that over checking out the default branch.',
          '- VibeBoard syncs the project folder to origin after Commit-to-main runs; you do not need to update it yourself.'
        ].join('\n')
      : ''

  return [
    'You are running inside VibeBoard as a background coding agent.',
    '',
    'Git authorship rules (mandatory for every commit):',
    '- Never add Co-authored-by, Made-with, Made with Cursor, or any agent/tool attribution trailer.',
    '- Do not pass --trailer, Co-authored-by, or similar attribution flags on git commit.',
    '- Leave authorship entirely to the user (normal git user.name / user.email only).',
    '- If a suggested commit command includes co-author attribution, rewrite it without that attribution and run the cleaned command.',
    '',
    'Token and exploration rules:',
    '- Do not scan the whole repository unless the task explicitly requires it.',
    '- Start from the focused file candidates below.',
    '- Open only files that are likely relevant to the requested change.',
    '- Prefer targeted searches over broad recursive reading.',
    '- Keep edits scoped to the task.',
    `- Use ${projectMemoryFileName} for durable project context before re-discovering basics.`,
    `- Update ${projectMemoryFileName} only when you learn stable project facts, setup steps, conventions, or standing user preferences.`,
    `- Keep ${projectMemoryFileName} concise and never store secrets, tokens, credentials, or temporary task logs.`,
    `- Never stage or commit ${projectMemoryFileName}. It must stay local (listed in .gitignore).`,
    `- You may commit a .gitignore entry for ${projectMemoryFileName} if needed so it stays ignored.`,
    `- When you are ready to give the final user-facing answer, write ${actualMessageMarker} exactly once on its own line as the first line of that final answer.`,
    `- Never mention ${actualMessageMarker} again after that first marker line.`,
    `- Put only the final answer after that first marker line. Do not put tool logs, stream metadata, progress narration, prompt text, or internal reasoning after it.`,
    '',
    worktreeRules,
    projectMemory
      ? `VibeBoard project memory from ${projectMemoryFileName}:\n${projectMemory}`
      : `VibeBoard project memory: ${projectMemoryFileName} is available for durable local notes.`,
    '',
    previousPrompts.length > 0
      ? `Recent user messages for this task, oldest to newest:\n${previousPrompts.map((entry) => `- ${entry}`).join('\n')}`
      : '',
    previousPrompts.length > 0 ? 'Use these only as context. The current user task below is authoritative.' : '',
    '',
    manifestSummary ? `Project hints:\n${manifestSummary}` : '',
    candidateFiles.length > 0 ? `Focused file candidates:\n${candidateFiles.map((file) => `- ${file}`).join('\n')}` : '',
    '',
    attachmentPaths.length > 0
      ? [
          'User-attached images for this message (read these files for visual context):',
          ...attachmentPaths.map((filePath) => `- ${filePath}`)
        ].join('\n')
      : '',
    '',
    'User task:',
    prompt || (attachmentPaths.length > 0 ? 'Use the attached images as the primary task context.' : prompt)
  ]
    .filter(Boolean)
    .join('\n')
}

async function prepareProjectMemory(projectPath: string): Promise<string> {
  await ensureProjectMemoryGitignored(projectPath)

  const memoryPath = path.join(projectPath, projectMemoryFileName)
  let content = ''

  try {
    content = await readFile(memoryPath, 'utf8')
  } catch {
    content = initialProjectMemoryContent()
    try {
      await writeFile(memoryPath, content, 'utf8')
    } catch {
      return ''
    }
  }

  const trimmed = content.trim()
  if (trimmed.length <= projectMemoryMaxChars) return trimmed

  return `${trimmed.slice(0, projectMemoryMaxChars).trim()}\n\n[Trimmed by VibeBoard. Keep this file shorter so future tasks receive the full memory.]`
}

function initialProjectMemoryContent(): string {
  return [
    '# VibeBoard Project Memory',
    '',
    'This is local memory for VibeBoard background agent tasks.',
    'It helps future tasks avoid re-discovering the same project details.',
    '',
    'Keep this file short and durable. Useful entries include:',
    '- project architecture',
    '- setup and verification commands',
    '- recurring conventions',
    '- standing user preferences for this project',
    '- known pitfalls',
    '',
    'Do not store secrets, tokens, credentials, or temporary task logs.',
    'This file should stay local and uncommitted.',
    ''
  ].join('\n')
}

function gitignoreAlreadyHasMemoryEntry(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return false
    return (
      trimmed === projectMemoryFileName ||
      trimmed === `/${projectMemoryFileName}` ||
      trimmed === `**/${projectMemoryFileName}` ||
      trimmed === '*.vibeboard-memory.md'
    )
  })
}

function appendMemoryIgnoreBlock(existing: string): string {
  const normalized = existing.replace(/\s+$/u, '')
  const block = `# VibeBoard local project memory\n${projectMemoryFileName}\n`
  if (!normalized) return block
  return `${normalized}\n\n${block}`
}

/**
 * Ensure `.vibeboard-memory.md` is listed in `.gitignore` (append-only) and unstaged if needed.
 * Safe to call on task open and before agent runs.
 */
export async function ensureProjectMemoryGitignored(projectPath: string): Promise<void> {
  if (!projectPath.trim()) return

  const gitignorePath = path.join(projectPath, '.gitignore')
  try {
    const existing = await readFile(gitignorePath, 'utf8').catch(() => '')
    if (!gitignoreAlreadyHasMemoryEntry(existing)) {
      await writeFile(gitignorePath, appendMemoryIgnoreBlock(existing), 'utf8')
    }
  } catch {
    // Best-effort. Prompt still tells the agent not to commit this file.
  }

  // Also keep a local exclude entry (shared common dir when possible).
  try {
    const commonDir = await resolveGitCommonDir(projectPath)
    if (commonDir) {
      const infoDir = path.join(commonDir, 'info')
      const excludePath = path.join(infoDir, 'exclude')
      await mkdir(infoDir, { recursive: true })
      const existing = await readFile(excludePath, 'utf8').catch(() => '')
      if (!gitignoreAlreadyHasMemoryEntry(existing)) {
        await writeFile(excludePath, appendMemoryIgnoreBlock(existing), 'utf8')
      }
    }
  } catch {
    // ignore
  }

  // If it was already staged/tracked, drop it from the index without deleting the file.
  try {
    await runCommand('git', ['rm', '--cached', '-f', '--ignore-unmatch', '--', projectMemoryFileName], projectPath)
  } catch {
    // ignore
  }
}

/** Ensure ignore rules in the project checkout and any task worktree. */
export async function ensureProjectMemoryGitignoredForRoots(
  ...roots: Array<string | null | undefined>
): Promise<void> {
  const unique = [...new Set(roots.map((root) => root?.trim()).filter(Boolean))] as string[]
  await Promise.all(unique.map((root) => ensureProjectMemoryGitignored(root)))
}

async function resolveGitDir(projectPath: string): Promise<string | null> {
  const dotGitPath = path.join(projectPath, '.git')

  try {
    const dotGit = await stat(dotGitPath)
    if (dotGit.isDirectory()) return dotGitPath
    if (!dotGit.isFile()) return null

    const gitFile = await readFile(dotGitPath, 'utf8')
    const match = gitFile.match(/^gitdir:\s*(.+)\s*$/m)
    if (!match) return null

    return path.resolve(projectPath, match[1])
  } catch {
    return null
  }
}

async function resolveGitCommonDir(projectPath: string): Promise<string | null> {
  try {
    const common = (await runCommand('git', ['rev-parse', '--git-common-dir'], projectPath)).trim()
    if (common) return path.resolve(projectPath, common)
  } catch {
    // fall through
  }
  return resolveGitDir(projectPath)
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

function runCommandStrict(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd })
    let output = ''
    let errorOutput = ''

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output)
        return
      }
      reject(new Error(errorOutput.trim() || `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`))
    })

    child.on('error', (error) => {
      reject(error)
    })
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

function summarizeProviderRun(providerId: AgentCliId, lines: string[], stderr: string): string {
  if (providerId === 'claude') {
    const fromStream = summarizeClaudeRun(lines)
    if (fromStream) return fromStream
  }
  if (providerId === 'codex') {
    const fromStream = summarizeCodexRun(lines)
    if (fromStream) return fromStream
  }
  // Cursor stream dumps need the aggressive filter; Claude/Codex already returned above.
  if (providerId === 'cursor') {
    const cursorStyle = summarizeCursorRun(lines)
    if (cursorStyle) return cursorStyle
  }
  const stderrText = extractPlainStderrFromStderr(stderr)
  if (stderrText) return stderrText
  return ''
}

function summarizeClaudeRun(lines: string[]): string {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i]?.trim()
    if (!trimmed) continue
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>
      if (event.type === 'result' && typeof event.result === 'string' && event.result.trim()) {
        return normalizeAssistantReply(event.result)
      }
    } catch {
      // keep scanning
    }
  }
  return ''
}

function summarizeCodexRun(lines: string[]): string {
  const messages: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>
      // Prefer completed agent_message items; skip outer event text that can be tool/status noise.
      const item = event.item as Record<string, unknown> | undefined
      if (item) {
        const fromItem = extractCodexMessageText(item)
        if (
          fromItem &&
          (event.type === 'item.completed' ||
            event.type === 'item.updated' ||
            event.type === 'item.done' ||
            item.type === 'agent_message')
        ) {
          messages.push(fromItem)
          continue
        }
      }
      if (event.type === 'agent_message' || event.type === 'message') {
        const direct = extractCodexMessageText(event)
        if (direct) messages.push(direct)
      }
    } catch {
      // ignore
    }
  }
  if (messages.length > 0) return normalizeAssistantReply(messages[messages.length - 1])
  return ''
}

interface CodexRunDebug {
  taskId: string
  at: string
  exitCode: number | null
  aborted: boolean
  stdoutLineCount: number
  stderrChars: number
  stderrHead: string
  eventTypes: string[]
  itemTypes: string[]
  assistantPreview: string
  lastMessageFilePresent: boolean
  lastMessageFileChars: number
  lastMessagePath: string | null
  sampleLines: string[]
}

function buildCodexRunDebug(input: {
  taskId: string
  exitCode: number | null
  aborted: boolean
  stdoutLines: string[]
  stderr: string
  assistantPreview: string
  lastMessageFilePresent: boolean
  lastMessageFileChars: number
  lastMessagePath: string | null
}): CodexRunDebug {
  const eventTypes: string[] = []
  const itemTypes: string[] = []
  const sampleLines: string[] = []
  for (const line of input.stdoutLines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (sampleLines.length < 8) {
      sampleLines.push(trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed)
    }
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof event.type === 'string') eventTypes.push(event.type)
      const item = event.item as Record<string, unknown> | undefined
      if (item && typeof item.type === 'string') itemTypes.push(item.type)
    } catch {
      eventTypes.push('non-json')
    }
  }
  return {
    taskId: input.taskId,
    at: new Date().toISOString(),
    exitCode: input.exitCode,
    aborted: input.aborted,
    stdoutLineCount: input.stdoutLines.length,
    stderrChars: input.stderr.length,
    stderrHead: input.stderr.trim().slice(0, 400),
    eventTypes: uniqueTail(eventTypes, 24),
    itemTypes: uniqueTail(itemTypes, 24),
    assistantPreview: input.assistantPreview.slice(0, 200),
    lastMessageFilePresent: input.lastMessageFilePresent,
    lastMessageFileChars: input.lastMessageFileChars,
    lastMessagePath: input.lastMessagePath,
    sampleLines
  }
}

function uniqueTail(values: string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = values.length - 1; i >= 0 && out.length < max; i -= 1) {
    const value = values[i]
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out.reverse()
}

function formatCodexDebugSystemMessage(debug: CodexRunDebug): string {
  const parts = [
    'Codex debug:',
    `exit=${debug.exitCode ?? 'null'}`,
    `stdoutLines=${debug.stdoutLineCount}`,
    `events=${debug.eventTypes.join(',') || '(none)'}`,
    `items=${debug.itemTypes.join(',') || '(none)'}`,
    `lastMessageFile=${debug.lastMessageFilePresent ? `${debug.lastMessageFileChars} chars` : 'missing'}`,
    `stderrChars=${debug.stderrChars}`
  ]
  if (debug.stderrHead) parts.push(`stderr=${debug.stderrHead.replace(/\s+/g, ' ')}`)
  if (debug.sampleLines[0]) parts.push(`sample=${debug.sampleLines[0]}`)
  return parts.join(' ')
}

async function writeCodexRunDebugLog(debug: CodexRunDebug): Promise<void> {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'codex-last-run.json'), `${JSON.stringify(debug, null, 2)}\n`, 'utf8')
  } catch {
    // best-effort debug only
  }
}

/** Codex/Claude replies often start with "I'm…" - never treat that as Cursor progress noise. */
function normalizeAssistantReply(text: string): string {
  return normalizeCursorText(text).replace(/[—–]/g, '-').trim()
}

function extractCodexMessageText(value: Record<string, unknown>): string | null {
  if (typeof value.text === 'string' && value.text.trim()) return value.text.trim()
  if (typeof value.message === 'string' && value.message.trim()) {
    // Skip non-reply informational items.
    if (value.type === 'error') return null
    return value.message.trim()
  }
  if (typeof value.content === 'string' && value.content.trim()) return value.content.trim()
  if (value.type === 'agent_message' && typeof value.text === 'string' && value.text.trim()) {
    return value.text.trim()
  }
  return null
}

function extractPlainReplyFromStderr(stderr: string): string {
  const trimmed = stderr.trim()
  if (!trimmed || trimmed.length > 4000) return ''
  if (/^WARNING:|error:|failed|not logged|Reading additional input/i.test(trimmed)) return ''
  // Prefer the last non-empty paragraph that looks like prose.
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
  for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
    const part = paragraphs[i]
    if (part.startsWith('{') || part.startsWith('[')) continue
    if (/^(thinking|working|running|reading|editing)\b/i.test(part)) continue
    if (part.length < 2) continue
    return normalizeAssistantReply(part)
  }
  return ''
}

function extractProviderProgress(providerId: AgentCliId, line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const event = JSON.parse(trimmed) as Record<string, unknown>
    if (providerId === 'claude') {
      if (event.type === 'assistant') {
        const message = event.message as Record<string, unknown> | undefined
        const content = message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== 'object') continue
            const record = block as Record<string, unknown>
            if (record.type === 'tool_use' && typeof record.name === 'string') {
              return clampLiveProgress(`Using ${record.name}`)
            }
          }
        }
      }
      if (event.type === 'stream_event') {
        const nested = event.event as Record<string, unknown> | undefined
        const delta = nested?.delta as Record<string, unknown> | undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.trim()) {
          return null
        }
      }
    }
    if (providerId === 'codex') {
      if (event.type === 'thread.started' || event.type === 'turn.started') {
        return clampLiveProgress('Codex started working…')
      }
      if (event.type === 'turn.completed') {
        return clampLiveProgress('Codex finished a turn…')
      }
      if (event.type === 'turn.failed' || event.type === 'error') {
        const message =
          typeof event.message === 'string'
            ? event.message
            : typeof event.error === 'string'
              ? event.error
              : 'Codex reported an error'
        return clampLiveProgress(message)
      }
      const item = event.item as Record<string, unknown> | undefined
      if (event.type === 'item.started' && item?.type === 'command_execution' && typeof item.command === 'string') {
        return clampLiveProgress(`Running ${item.command}`)
      }
      if (event.type === 'item.started' && item?.type === 'file_change') {
        return clampLiveProgress('Editing files…')
      }
      if (
        (event.type === 'item.started' || event.type === 'item.completed') &&
        item?.type === 'reasoning' &&
        typeof item.text === 'string' &&
        item.text.trim()
      ) {
        return clampLiveProgress(item.text.trim())
      }
      if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') {
        const preview = item.text.trim().slice(0, liveProgressMaxLength)
        return preview ? clampLiveProgress(preview) : null
      }
    }
  } catch {
    return null
  }
  return null
}

function summarizeCursorRun(lines: string[]): string {
  const fragments: string[] = []

  for (const line of lines) {
    const text = summarizeCursorLine(line)
    if (text && !isProgressNarration(text)) fragments.push(text)
  }

  const merged = mergeTextFragments(fragments)
  const actualMessage = extractActualMessage(merged)
  if (actualMessage) return normalizeFinalAnswer(actualMessage)

  return extractFallbackAnswer(fragments)
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
  if (/running inside VibeBoard as a background coding agent/i.test(trimmed)) return false
  if (trimmed.includes('Token and exploration rules:')) return false
  if (trimmed.length < 3 && !/[.!?]$/.test(trimmed)) return false
  return true
}

function normalizeCursorText(text: string): string {
  return text
    .trim()
    .replace(cursorStreamMarkerPattern(), '')
    .replace(
      /^(?:init|start|started|completed|success|done|end)\s+(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s+)?/i,
      ''
    )
    .replace(
      /\b(?:login|tool_call|tool|result|metadata|started|completed|success|done|init)\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      ''
    )
    .replace(/\btool_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/[—–]/g, '-')
    .replace(/^(?:(?:started|completed|success|done|end)\s+)+/i, '')
    .replace(/\s+(?:(?:started|completed|success|done|end)\s*)+$/i, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function extractActualMessage(text: string): string | null {
  const markerMatch = text.match(new RegExp(`(?:^|\\r?\\n)\\s*${actualMessageMarker}\\s*(?:\\r?\\n|$)`))
  if (!markerMatch || markerMatch.index === undefined) return null
  const markerEnd = markerMatch.index + markerMatch[0].length
  return text.slice(markerEnd)
}

function extractFallbackAnswer(fragments: string[]): string {
  for (const fragment of [...fragments].reverse()) {
    const normalized = normalizeFinalAnswer(stripPromptLeak(fragment))
    if (normalized && !isProgressNarration(normalized) && shouldDisplayCursorText(normalized)) {
      return normalized
    }
  }
  return ''
}

function stripPromptLeak(text: string): string {
  return normalizeCursorText(text).replace(
    /^(?:login\s+)?(?:while\s+)?running inside VibeBoard as a background coding agent\.\s*/i,
    ''
  )
}

function normalizeFinalAnswer(text: string): string {
  return normalizeCursorText(text)
    .split(/\r?\n/)
    .map((line) => stripPromptLeak(line))
    .filter((line) => line && !isProgressNarration(line))
    .join('\n')
    .trim()
}

function cursorStreamMarkerPattern(): RegExp {
  return /\b(?:call--?\d+|call_\d+|tool--?\d+|tool_\d+|fc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_\d+)?)\b/gi
}

function isProgressNarration(text: string): boolean {
  const trimmed = normalizeCursorText(text)
  return (
    /^(i('|’)?m|i am|i('|’)?ll|i will|reading|reviewing|examining|checking|running|looking|scanning|opening|inspecting)\b/i.test(
      trimmed
    ) ||
    /^(the user|the request|the context|a modified .+ appears|files to understand|likely about)\b/i.test(trimmed) ||
    /^the project structure is now clear\b/i.test(trimmed) ||
    /^the task is unclear\b/i.test(trimmed) ||
    /^nothing clear to do yet\b/i.test(trimmed) ||
    /^what do you want next\b/i.test(trimmed)
  )
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
    const child = spawn('git', ['diff', '--no-ext-diff', '--unified=6', '--', '.'], { cwd })
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
    c: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    css: 'css',
    cxx: 'cpp',
    dart: 'dart',
    dockerfile: 'dockerfile',
    go: 'go',
    h: 'c',
    html: 'xml',
    hpp: 'cpp',
    ini: 'ini',
    java: 'java',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    kt: 'kotlin',
    kts: 'kotlin',
    less: 'less',
    lua: 'lua',
    md: 'markdown',
    mjs: 'javascript',
    php: 'php',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    scss: 'scss',
    sh: 'bash',
    sql: 'sql',
    swift: 'swift',
    ts: 'typescript',
    tsx: 'tsx',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml'
  }
  return extension ? languageMap[extension] || '' : ''
}
