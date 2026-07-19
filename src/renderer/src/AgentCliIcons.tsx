import type { ReactElement } from 'react'
import type { AgentCliId } from '../../shared/types'
import cursorIcon from './assets/agent-cli/cursor.png'
import claudeIcon from './assets/agent-cli/claude.png'
import codexIcon from './assets/agent-cli/codex.png'

const ICONS: Record<AgentCliId, string> = {
  cursor: cursorIcon,
  claude: claudeIcon,
  codex: codexIcon
}

export function AgentCliIcon({
  id,
  size = 18,
  className
}: {
  id: AgentCliId
  size?: number
  className?: string
}): ReactElement {
  return (
    <img
      className={className}
      src={ICONS[id]}
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  )
}
