import type { CodeChange, ConversationEntry, Lane, Project, Task } from '../../shared/types'
import notchDemoBackdrop from './assets/notch-demo-backdrop.png'

export const MARKETING_PRODUCT_DEMO_MS = 21000
/** Notch sequence length after the 3-2-1 countdown (main process demo). */
export const MARKETING_NOTCH_DEMO_MS = 10000
export const MARKETING_DEMO_COUNTDOWN_MS = 2700
export const MARKETING_DEMO_FOLLOW_UP =
  'Looks good. Ship the session cookie path fix and note it in the PR.'
export const MARKETING_DEMO_AGENT_REPLY =
  'On it. Landing the cookie path fix on the branch and adding a short note in the PR.'
export const MARKETING_DEMO_AGENT_STATUS = 'Still working on the session cookie path fix.'

export const MARKETING_NATURE_BACKDROP_URL = notchDemoBackdrop

const tabId = 'marketing-demo-tab'
const projectId = 'marketing-demo-project'
const now = '2026-07-18T10:00:00.000Z'

export const marketingDemoProject: Project = {
  id: projectId,
  name: 'northstar',
  path:
    typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
      ? 'C:\\Users\\demo\\northstar'
      : '/Users/demo/northstar',
  runMode: 'worktree',
  autoMoveTasks: 1,
  pathMissing: false,
  createdAt: now
}

export const marketingDemoLanes: Lane[] = [
  { id: 'md-lane-active', tabId, name: 'Active', position: 0 },
  { id: 'md-lane-review', tabId, name: 'Review', position: 1 },
  { id: 'md-lane-done', tabId, name: 'Done', position: 2 }
]

const task = (
  id: string,
  laneId: string,
  title: string,
  summary: string,
  status: Task['status'],
  position: number,
  extras?: Partial<Task>
): Task => ({
  id,
  tabId,
  laneId,
  projectId,
  title,
  summary,
  status,
  runModeOverride: null,
  model: null,
  branchName: extras?.branchName ?? null,
  worktreePath: extras?.worktreePath ?? null,
  pushedToMain: extras?.pushedToMain ?? 0,
  position,
  createdAt: now,
  updatedAt: now,
  runStartedAt: extras?.runStartedAt ?? null,
  queuedMessages: extras?.queuedMessages
})

/** Feature task the demo opens: rich TS + CSS diffs. */
export const marketingDemoFeatureTaskId = 'md-task-auth-session'

export const marketingDemoTasks: Task[] = [
  task('md-task-empty-1', 'md-lane-active', 'Polish empty board copy', 'Tone pass for first-run.', 'idle', 0),
  task('md-task-empty-2', 'md-lane-active', 'Add keyboard shortcut sheet', 'Document ⌘K and Esc.', 'idle', 1),
  task('md-task-empty-3', 'md-lane-active', 'Tighten sidebar metrics', 'Align running / issues counts.', 'idle', 2),
  task(
    'md-task-running-1',
    'md-lane-active',
    'Wire Stripe webhook retries',
    'Cursor Agent is implementing idempotent handlers.',
    'processing',
    3,
    { runStartedAt: new Date(Date.now() - 42_000).toISOString(), branchName: 'feat/stripe-webhooks' }
  ),
  task(
    'md-task-running-2',
    'md-lane-active',
    'Migrate settings to SQLite',
    'Moving appearance prefs off localStorage.',
    'processing',
    4,
    { runStartedAt: new Date(Date.now() - 18_000).toISOString(), branchName: 'feat/settings-db' }
  ),
  task(
    marketingDemoFeatureTaskId,
    'md-lane-review',
    'Fix auth redirect loop',
    'Session cookies survive refresh; redirect lands on /app.',
    'done_unread',
    0,
    { branchName: 'fix/auth-session', pushedToMain: 0 }
  ),
  task(
    'md-task-review-2',
    'md-lane-review',
    'Agent model picker polish',
    'Hover flyouts + curated model lists.',
    'done_unread',
    1,
    { branchName: 'feat/model-picker' }
  ),
  task(
    'md-task-review-3',
    'md-lane-review',
    'Notch finish-chat park',
    'Click-away collapses to a mid strip.',
    'attention',
    2,
    { branchName: 'fix/notch-park' }
  ),
  task('md-task-done-1', 'md-lane-done', 'Ship onboarding tour', 'Six-step spotlight walkthrough.', 'done_read', 0, {
    pushedToMain: 1
  }),
  task('md-task-done-2', 'md-lane-done', 'Diff viewer syntax highlight', 'hljs for TS / CSS / JSON.', 'done_read', 1, {
    pushedToMain: 1
  }),
  task('md-task-done-3', 'md-lane-done', 'Optimistic task delete', 'Board updates before IPC returns.', 'done_read', 2, {
    pushedToMain: 1
  }),
  task('md-task-done-4', 'md-lane-done', 'Appearance font preview', 'Live card + code sample.', 'done_read', 3, {
    pushedToMain: 1
  })
]

export const marketingDemoConversations: ConversationEntry[] = [
  {
    id: 'md-c-1',
    taskId: marketingDemoFeatureTaskId,
    role: 'user',
    content:
      'After sign-in I bounce between /login and /app. Fix the session cookie path and make refresh keep me signed in.',
    createdAt: '2026-07-18T09:58:00.000Z'
  },
  {
    id: 'md-c-2',
    taskId: marketingDemoFeatureTaskId,
    role: 'assistant',
    content:
      'The cookie was scoped too tightly and the redirect target ignored an existing session. I updated the session writer and the auth guard so refresh lands on `/app` when a valid `sid` is present.',
    createdAt: '2026-07-18T09:59:20.000Z'
  },
  {
    id: 'md-c-3',
    taskId: marketingDemoFeatureTaskId,
    role: 'assistant',
    content:
      'Also tightened the middleware matcher so static assets skip the auth redirect. That was part of the loop under Vite HMR.',
    createdAt: '2026-07-18T09:59:40.000Z'
  }
]

export const marketingDemoChanges: CodeChange[] = [
  {
    id: 'md-ch-1',
    taskId: marketingDemoFeatureTaskId,
    filePath: 'src/server/auth/session.ts',
    summary: '18 additions, 6 deletions',
    changeType: 'modified',
    language: 'typescript',
    diffText: `@@ -24,14 +24,26 @@ export function writeSession(session: Session) {
-  cookies().set('sid', session.id, {
-    httpOnly: true,
-    sameSite: 'lax'
-  })
+  cookies().set('sid', session.id, {
+    httpOnly: true,
+    sameSite: 'lax',
+    path: '/',
+    secure: process.env.NODE_ENV === 'production',
+    maxAge: 60 * 60 * 24 * 14
+  })
 }
 
 export async function requireSession() {
   const sid = cookies().get('sid')?.value
-  if (!sid) redirect('/login')
+  if (!sid) {
+    redirect('/login')
+  }
+  const session = await loadSession(sid)
+  if (!session) {
+    cookies().delete('sid', { path: '/' })
+    redirect('/login')
+  }
+  return session
 }`,
    createdAt: now
  },
  {
    id: 'md-ch-2',
    taskId: marketingDemoFeatureTaskId,
    filePath: 'src/middleware.ts',
    summary: '11 additions, 4 deletions',
    changeType: 'modified',
    language: 'typescript',
    diffText: `@@ -8,12 +8,19 @@ export function middleware(request: NextRequest) {
   const { pathname } = request.nextUrl
-  if (pathname.startsWith('/app') && !request.cookies.get('sid')) {
-    return NextResponse.redirect(new URL('/login', request.url))
-  }
+  const isProtected = pathname === '/app' || pathname.startsWith('/app/')
+  const hasSession = Boolean(request.cookies.get('sid')?.value)
+
+  if (isProtected && !hasSession) {
+    const login = new URL('/login', request.url)
+    login.searchParams.set('next', pathname)
+    return NextResponse.redirect(login)
+  }
+
+  if (pathname === '/login' && hasSession) {
+    return NextResponse.redirect(new URL('/app', request.url))
+  }
 
   return NextResponse.next()
 }
 
 export const config = {
-  matcher: ['/app/:path*', '/login']
+  matcher: ['/app', '/app/:path*', '/login']
 }`,
    createdAt: now
  },
  {
    id: 'md-ch-3',
    taskId: marketingDemoFeatureTaskId,
    filePath: 'src/styles/auth-shell.css',
    summary: '14 additions, 2 deletions',
    changeType: 'modified',
    language: 'css',
    diffText: `@@ -40,8 +40,20 @@
 .auth-shell {
   min-height: 100dvh;
-  background: #0b0b0c;
+  background:
+    radial-gradient(1200px 600px at 50% -10%, rgba(255, 122, 26, 0.16), transparent 60%),
+    #0b0b0c;
 }
 
 .auth-card {
   width: min(420px, 92vw);
-  padding: 28px;
+  padding: 32px 28px;
+  border: 1px solid rgba(255, 255, 255, 0.08);
+  border-radius: 16px;
+  background: rgba(20, 20, 22, 0.92);
+  backdrop-filter: blur(12px);
 }`,
    createdAt: now
  }
]

export function groupMarketingDemoTasksByLane(tasks: Task[] = marketingDemoTasks): Map<string, Task[]> {
  return new Map(
    marketingDemoLanes.map((lane) => [
      lane.id,
      tasks.filter((task) => task.laneId === lane.id).sort((a, b) => a.position - b.position)
    ])
  )
}
