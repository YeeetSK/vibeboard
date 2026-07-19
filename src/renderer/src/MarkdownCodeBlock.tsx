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

/** Wrap each source line; mark lines that appear in the added-diff set. */
export function buildCodeHtmlWithAddedHighlights(
  code: string,
  language: string,
  addedLines: ReadonlySet<string>,
  highlightLine: (line: string, language: string) => string
): string {
  if (addedLines.size === 0) return highlightLine(code, language)

  const lines = code.split('\n')
  const hasHighlightInBlock = lines.some(
    (line) => addedLines.has(line) || addedLines.has(line.trim())
  )
  // Avoid per-line wrappers when this fence has no additions (they only add noise).
  if (!hasHighlightInBlock) return highlightLine(code, language)

  // Use display:block spans for line breaks - do not also join with \n or pre-wrap doubles the gaps.
  return lines
    .map((line) => {
      const highlighted = highlightLine(line, language)
      const isAdded = addedLines.has(line) || addedLines.has(line.trim())
      if (!isAdded) {
        return `<span class="md-diff-line">${highlighted || '&nbsp;'}</span>`
      }
      return `<span class="md-diff-added-line">${highlighted || '&nbsp;'}</span>`
    })
    .join('')
}
