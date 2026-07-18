import { ReactElement, useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function MarkdownCodeBlock({
  code,
  language,
  html
}: {
  code: string
  language: string
  html: string
}): ReactElement {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      // Clipboard may be unavailable in some environments.
    }
  }

  return (
    <div className="markdown-code-block">
      <button
        className="markdown-code-copy"
        type="button"
        onClick={() => {
          void copy()
        }}
        title={copied ? 'Copied' : 'Copy code'}
        aria-label={copied ? 'Copied' : 'Copy code'}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <code
        className={`markdown-code${language ? ` language-${language}` : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
