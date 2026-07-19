import { ReactElement } from 'react'
import type { NotchOverlaySnapshot } from '../../../shared/types'
import { NotchSlotText } from './NotchSlotText'

export function CompactStatus({
  snapshot,
  tone,
  surfaceClass,
  onClick
}: {
  snapshot: NotchOverlaySnapshot
  tone: string
  surfaceClass: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      className={`notch-island compact tone-${tone}${surfaceClass}`}
      type="button"
      onClick={onClick}
      title={
        snapshot.headline === 'Running'
          ? 'View running agents'
          : snapshot.headline === 'Done'
            ? 'View finished tasks'
            : snapshot.headline === 'Inactive'
              ? 'Nothing needs attention'
              : 'Reopen last finish panel, or open a task that needs you'
      }
    >
      <span className="notch-top">
        <span className="notch-side notch-side-left">
          {snapshot.headline ? (
            <>
              <span className="notch-dot" aria-hidden="true" />
              <NotchSlotText className="notch-headline" value={snapshot.headline} />
            </>
          ) : null}
        </span>
        <span className="notch-camera-gap" aria-hidden="true" />
        <span className="notch-side notch-side-right">
          <NotchSlotText
            className="notch-trailing"
            value={
              snapshot.trailing === 'spinner'
                ? 'spinner'
                : snapshot.trailing
                  ? snapshot.trailing
                  : null
            }
          />
        </span>
      </span>
    </button>
  )
}
