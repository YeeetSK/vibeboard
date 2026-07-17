import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CodeChange, Project, RunMode, Task } from '../shared/types'
import { isAgentAuthenticated, resolveAgentCommand } from './cursorAdapter'
import { VibeBoardStore } from './database'

const protectedBranchNames = new Set(['main', 'master', 'develop', 'development', 'trunk', 'dev', 'release'])

const projectMemoryFileName = '.vibeboard-memory.md'
const projectMemoryMaxChars = 12000
const actualMessageMarker = 'VibeBoardStartActualMessage'

interface RunCursorTaskInput {
  taskId: string
  store: VibeBoardStore
  onStateChanged: () => void
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
  const isRevertRun = context.prompt.includes('Revert the code changes made for this specific task only.')
  const isCommitToMainRun = /Push the commit to (main|the default branch) on origin/i.test(context.prompt)

  store.updateTaskStatus({ taskId, status: 'processing' })
  store.appendConversation(taskId, 'system', 'Starting Cursor CLI agent in the project folder.')
  onStateChanged()

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

  const baselineDiff = await collectGitDiffText(runTarget.cwd)
  store.appendConversation(taskId, 'system', formatRunTargetMessage(runTarget))
  const optimizedPrompt = await buildFocusedPrompt(runTarget.cwd, context.prompt, context.previousPrompts, runTarget)
  store.appendConversation(taskId, 'system', 'Prepared a focused project brief to reduce unnecessary repo exploration.')
  onStateChanged()

  const child = spawn(agentCommand, ['--print', '--force', '--trust', '--output-format', 'stream-json', optimizedPrompt], {
    cwd: runTarget.cwd,
    env: process.env
  })
  console.info('[VibeBoard Cursor run]', { taskId, projectPath: runTarget.cwd, agentCommand })

  let stdoutBuffer = ''
  let stderrBuffer = ''
  let aborted = false
  const stdoutLines: string[] = []
  const progressPublisher = createLiveProgressPublisher({
    taskId,
    store,
    onStateChanged
  })
  store.appendConversation(taskId, 'system', 'Agent is running. Live progress updates will appear here.')
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
    stderrBuffer += chunk.toString()
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
      store.updateTaskStatus({ taskId, status: 'attention' })
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

      const assistantMessage = summarizeCursorRun(stdoutLines)
      if (assistantMessage) {
        store.appendConversation(taskId, 'assistant', assistantMessage)
      }

      if (aborted) {
        store.updateTaskStatus({ taskId, status: 'attention' })
        onStateChanged()
        finish()
        return
      }

      if (code === 0) {
        const nextDiff = await collectGitDiffText(runTarget.cwd)
        const changes = nextDiff === baselineDiff ? [] : parseGitDiff(nextDiff, baselineDiff)
        if (isRevertRun || changes.length > 0) {
          store.replaceCodeChanges(taskId, changes)
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

        store.updateTaskStatus({ taskId, status: 'done_unread' })
      } else {
        store.updateTaskStatus({ taskId, status: 'attention' })
        const failureText = stderrBuffer.trim() || `Cursor CLI agent exited with code ${code ?? 'unknown'}.`
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

function formatRunTargetMessage(target: TaskRunTarget): string {
  if (target.mode === 'branch') {
    return `Run mode: branch per task (${target.branchName ?? 'task branch'}).`
  }
  if (target.mode === 'worktree') {
    return `Run mode: worktree per task (${target.branchName ?? 'task branch'}). The project folder stays on its own branch and is synced to origin automatically when needed.`
  }
  return 'Run mode: shared working tree.'
}

const liveProgressMinIntervalMs = 2500
const liveProgressHeartbeatMs = 20_000
const liveProgressMaxLength = 280

function createLiveProgressPublisher(input: {
  taskId: string
  store: VibeBoardStore
  onStateChanged: () => void
}): { handleLine: (line: string) => void; flush: () => void; stop: () => void } {
  let lastPublishedAt = 0
  let lastPublishedText = ''
  let pendingText: string | null = null
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
      const update = extractLiveProgressUpdate(line)
      if (!update) return
      queue(update)
    },
    flush: () => {
      if (stopped) return
      clearFlushTimer()
      if (!pendingText) return
      publish(pendingText)
    },
    stop: () => {
      stopped = true
      clearFlushTimer()
      clearHeartbeatTimer()
      pendingText = null
    }
  }
}

function extractLiveProgressUpdate(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as unknown
    const toolUpdate = formatToolProgress(parsed)
    if (toolUpdate) return clampLiveProgress(toolUpdate)

    const text = normalizeCursorText(findReadableText(parsed))
    if (!shouldDisplayLiveProgressText(text)) return null
    return clampLiveProgress(text)
  } catch {
    const text = normalizeCursorText(trimmed)
    if (!shouldDisplayLiveProgressText(text)) return null
    return clampLiveProgress(text)
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

async function buildFocusedPrompt(
  projectPath: string,
  prompt: string,
  previousPrompts: string[],
  runTarget?: TaskRunTarget
): Promise<string> {
  const [trackedFiles, changedFiles, manifestSummary, projectMemory] = await Promise.all([
    listTrackedFiles(projectPath),
    listChangedFiles(projectPath),
    readManifestSummary(projectPath),
    prepareProjectMemory(projectPath)
  ])
  const candidateFiles = rankRelevantFiles(prompt, trackedFiles, changedFiles).slice(0, 40)
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
    'Token and exploration rules:',
    '- Do not scan the whole repository unless the task explicitly requires it.',
    '- Start from the focused file candidates below.',
    '- Open only files that are likely relevant to the requested change.',
    '- Prefer targeted searches over broad recursive reading.',
    '- Keep edits scoped to the task.',
    `- Use ${projectMemoryFileName} for durable project context before re-discovering basics.`,
    `- Update ${projectMemoryFileName} only when you learn stable project facts, setup steps, conventions, or standing user preferences.`,
    `- Keep ${projectMemoryFileName} concise and never store secrets, tokens, credentials, or temporary task logs.`,
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
    'User task:',
    prompt
  ]
    .filter(Boolean)
    .join('\n')
}

async function prepareProjectMemory(projectPath: string): Promise<string> {
  await ensureProjectMemoryIgnored(projectPath)

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

async function ensureProjectMemoryIgnored(projectPath: string): Promise<void> {
  const gitDir = await resolveGitDir(projectPath)
  if (!gitDir) return

  const infoDir = path.join(gitDir, 'info')
  const excludePath = path.join(infoDir, 'exclude')

  try {
    await mkdir(infoDir, { recursive: true })
    const existing = await readFile(excludePath, 'utf8').catch(() => '')
    if (existing.split(/\r?\n/).some((line) => line.trim() === projectMemoryFileName)) return

    const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
    await writeFile(
      excludePath,
      `${existing}${prefix}\n# VibeBoard local project memory\n${projectMemoryFileName}\n`,
      'utf8'
    )
  } catch {
    // Ignoring is best-effort. The prompt still tells the agent not to commit this file.
  }
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
