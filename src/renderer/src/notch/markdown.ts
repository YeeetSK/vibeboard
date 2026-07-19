/** Single newlines become hard breaks so agent replies match the chat layout. */
export function preserveMarkdownNewlines(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/([^\n])\n(?!\n)/g, '$1  \n')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
