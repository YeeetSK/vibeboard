import { app } from 'electron'
import crypto from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ConversationAttachment, TaskMessageAttachmentInput } from '../shared/types'

const maxAttachmentBytes = 8 * 1024 * 1024
const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const extensionForMime = (mimeType: string): string => {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'png'
  }
}

export const attachmentsRootDir = (): string => path.join(app.getPath('userData'), 'attachments')

export const taskAttachmentsDir = (taskId: string): string => path.join(attachmentsRootDir(), taskId)

export async function saveTaskAttachments(
  taskId: string,
  inputs: TaskMessageAttachmentInput[] | undefined
): Promise<ConversationAttachment[]> {
  if (!inputs || inputs.length === 0) return []

  const dir = taskAttachmentsDir(taskId)
  await mkdir(dir, { recursive: true })

  const saved: ConversationAttachment[] = []
  for (const input of inputs) {
    const mimeType = normalizeMimeType(input.mimeType)
    if (!allowedMimeTypes.has(mimeType)) {
      throw new Error(`Unsupported attachment type: ${input.mimeType || 'unknown'}`)
    }

    const buffer = Buffer.from(input.dataBase64, 'base64')
    if (!buffer.length) continue
    if (buffer.byteLength > maxAttachmentBytes) {
      throw new Error(`Attachment "${input.name || 'image'}" is larger than 8MB.`)
    }

    const attachmentId = crypto.randomUUID()
    const safeName = sanitizeFileName(input.name || `image.${extensionForMime(mimeType)}`)
    const fileName = `${attachmentId}-${safeName}`
    const filePath = path.join(dir, fileName)
    await writeFile(filePath, buffer)

    saved.push({
      id: attachmentId,
      name: safeName,
      mimeType,
      filePath,
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`
    })
  }

  return saved
}

export async function withAttachmentDataUrls(
  attachments: ConversationAttachment[] | undefined
): Promise<ConversationAttachment[]> {
  if (!attachments || attachments.length === 0) return []

  const enriched: ConversationAttachment[] = []
  for (const attachment of attachments) {
    if (attachment.dataUrl) {
      enriched.push(attachment)
      continue
    }

    try {
      const buffer = await readFile(attachment.filePath)
      enriched.push({
        ...attachment,
        dataUrl: `data:${attachment.mimeType};base64,${buffer.toString('base64')}`
      })
    } catch {
      enriched.push(attachment)
    }
  }

  return enriched
}

export async function deleteTaskAttachments(taskId: string): Promise<void> {
  try {
    await rm(taskAttachmentsDir(taskId), { recursive: true, force: true })
  } catch {
    // Best-effort cleanup when a task is deleted.
  }
}

function normalizeMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase()
  if (normalized === 'image/jpg') return 'image/jpeg'
  return normalized
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_')
  return base.slice(0, 80) || 'image.png'
}
