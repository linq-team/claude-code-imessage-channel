#!/usr/bin/env node
/**
 * iMessage Channel for Claude Code
 * Powered by Linq (https://linqapp.com)
 *
 * Two-way bridge: text your Linq number from iMessage and it pushes
 * into your Claude Code session. Claude replies back via iMessage.
 *
 * Setup:
 *   /plugin install imessage@linq-team-claude-code-imessage-channel
 *   /imessage:configure <token>
 *   /imessage:configure <phone>
 *   claude --channels plugin:imessage@linq-team-claude-code-imessage-channel
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import Linq from '@linqapp/sdk'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

// --- Configuration ---

interface ChannelConfig {
  token: string
  fromPhone: string
  apiUrl: string
  webhookPort: number
  defaultRecipient: string
  allowedSenders: Set<string>
}

interface AccessConfig {
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled'
  allowFrom: string[]
  defaultRecipient?: string
  pendingPairings: Record<string, { phone: string; createdAt: string }>
  ackReaction?: string
  pollInterval?: number
}

const ACCESS_FILE = path.join(process.env.HOME || '', '.claude', 'channels', 'imessage', 'access.json')

function loadAccessConfig(): AccessConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf-8'))
    return {
      dmPolicy: raw.dmPolicy || 'pairing',
      allowFrom: raw.allowFrom || [],
      defaultRecipient: raw.defaultRecipient,
      pendingPairings: raw.pendingPairings || {},
      ackReaction: raw.ackReaction,
      pollInterval: raw.pollInterval,
    }
  } catch {
    return { dmPolicy: 'pairing', allowFrom: [], pendingPairings: {} }
  }
}

function saveAccessConfig(access: AccessConfig): void {
  const dir = path.dirname(ACCESS_FILE)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(ACCESS_FILE, JSON.stringify(access, null, 2) + '\n')
}

function generatePairingCode(): string {
  return Math.random().toString(36).substring(2, 8)
}

const CHANNEL_DIR = path.join(process.env.HOME || '', '.claude', 'channels', 'imessage')

function parseEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {}
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
  } catch (e: any) { console.error('[imessage] Failed to read env file:', e.message) }
  return vars
}

function loadChannelConfig(): ChannelConfig {
  let token = process.env.LINQ_TOKEN || ''
  let fromPhone = process.env.LINQ_FROM_PHONE || ''
  let apiUrl = process.env.LINQ_API_URL || 'https://api.linqapp.com/api/partner'
  let defaultRecipient = process.env.LINQ_DEFAULT_RECIPIENT || ''
  let allowedSenders = process.env.LINQ_ALLOWED_SENDERS || ''

  const envVars = parseEnvFile(path.join(CHANNEL_DIR, '.env'))
  token = token || envVars.LINQ_TOKEN || ''
  fromPhone = fromPhone || envVars.LINQ_FROM_PHONE || ''
  if (envVars.LINQ_API_URL) apiUrl = envVars.LINQ_API_URL
  defaultRecipient = defaultRecipient || envVars.LINQ_DEFAULT_RECIPIENT || ''
  allowedSenders = allowedSenders || envVars.LINQ_ALLOWED_SENDERS || ''

  const configJsonPath = path.join(CHANNEL_DIR, 'config.json')
  try {
    const cfg = JSON.parse(fs.readFileSync(configJsonPath, 'utf-8'))
    defaultRecipient = defaultRecipient || cfg.defaultRecipient || ''
    allowedSenders = allowedSenders || (cfg.allowedSenders || []).join(',')
    if (cfg.apiUrl) apiUrl = cfg.apiUrl
  } catch (e: any) { /* config.json is optional */ }

  // Legacy fallback: ~/.linq/config.json
  if (!token || !fromPhone) {
    const legacyPath = path.join(process.env.HOME || '', '.linq', 'config.json')
    if (fs.existsSync(legacyPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'))
        const profileName = process.env.LINQ_PROFILE || raw.profile || 'default'
        const profile = raw.profiles?.[profileName]
        if (profile) {
          if (!token && profile.token) {
            token = profile.token
            console.error('[imessage] using legacy ~/.linq/config.json — run /imessage:configure to migrate')
          }
          fromPhone = fromPhone || profile.fromPhone || ''
          defaultRecipient = defaultRecipient || profile.defaultRecipient || ''
        }
      } catch {}
    }
  }

  return {
    token,
    fromPhone,
    apiUrl,
    webhookPort: parseInt(process.env.LINQ_CHANNEL_PORT || '9998', 10),
    defaultRecipient,
    allowedSenders: new Set(allowedSenders.split(',').filter(Boolean)),
  }
}

const config = loadChannelConfig()

// --- Linq SDK Client ---

const linq = new Linq({
  apiKey: config.token,
  baseURL: config.apiUrl,
})

// --- MCP Channel Server ---

const mcp = new Server(
  { name: 'imessage', version: '0.2.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions: `You are connected to iMessage via Linq. Messages arrive as <channel source="imessage" sender="..." chat_id="...">.

When you receive a message:
- Read it and respond helpfully
- Reply using the reply tool, passing the chat_id from the tag
- Use the react tool to add tapback reactions (like, love, laugh, etc) when appropriate
- For longer tasks, stream your progress: send a short initial message with reply (e.g. "On it..."), then call edit_message with the message_id to update it as you work. The message edits in-place on their phone.
- You can also send messages to new numbers using the send tool
- Read receipts and typing indicators are sent automatically
- If the channel event meta has an image_path attribute, Read that file — it is a photo the sender attached. Respond about what you see.
- For non-image attachments, the meta will contain attachment details with local file paths you can Read.
- For bold/italic/underline text, use text_decorations on reply/send. Example: text "hello world" with text_decorations [{"range": [0, 5], "style": "bold"}] makes "hello" bold. Animations: shake, explode, ripple, bloom, jitter. Do NOT use markdown — iMessage doesn't render it.
- To send a URL with a rich preview card, use the send_link tool instead of putting the URL in text.
- Use check_capability to verify if a number supports iMessage or RCS before sending.

The person texting you is your operator. Follow their instructions. Be concise in replies - this is iMessage, not email.
Your iMessage number: ${config.fromPhone}`,
  },
)

// --- Tools ---

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Reply to an iMessage conversation',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string', description: 'Chat ID from the inbound message' },
          text: { type: 'string', description: 'Message to send' },
          effect: { type: 'string', description: 'Optional iMessage effect. Screen: confetti, fireworks, lasers, sparkles, celebration, hearts, love, balloons, happy_birthday, echo, spotlight. Bubble: slam, loud, gentle, invisible.' },
          reply_to: { type: 'string', description: 'Optional message ID to reply to, creating a threaded conversation' },
          files: { type: 'array', items: { type: 'string' }, description: 'Optional absolute file paths to attach. Images, videos, audio, documents supported. Max 100MB each.' },
          text_decorations: { type: 'array', items: { type: 'object', properties: { range: { type: 'array', items: { type: 'number' } }, style: { type: 'string' }, animation: { type: 'string' } } }, description: 'Optional text styling. Each item has range [start, end) and either style (bold, italic, strikethrough, underline) or animation (big, small, shake, nod, explode, ripple, bloom, jitter). iMessage only.' },
        },
        required: ['chat_id', 'text'],
      },
    },
    {
      name: 'edit_message',
      description: 'Edit a previously sent message. Use this for streaming: send an initial short message with reply, then call edit_message to update it as you work. The message updates in-place on their phone (iOS 16+).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          message_id: { type: 'string', description: 'ID of the message to edit (returned from reply or send)' },
          text: { type: 'string', description: 'New text content to replace the message with' },
        },
        required: ['message_id', 'text'],
      },
    },
    {
      name: 'react',
      description: 'React to a message with a tapback (like, love, dislike, laugh, emphasize, question)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string', description: 'Chat ID' },
          message_id: { type: 'string', description: 'Message ID to react to' },
          reaction: { type: 'string', description: 'Reaction type: like, love, dislike, laugh, emphasize, question' },
        },
        required: ['chat_id', 'message_id', 'reaction'],
      },
    },
    {
      name: 'send',
      description: 'Send an iMessage to a phone number',
      inputSchema: {
        type: 'object' as const,
        properties: {
          to: { type: 'string', description: 'Phone number (e.g. +1XXXXXXXXXX)' },
          text: { type: 'string', description: 'Message to send' },
          effect: { type: 'string', description: 'Optional iMessage effect. Screen: confetti, fireworks, lasers, sparkles, celebration, hearts, love, balloons, happy_birthday, echo, spotlight. Bubble: slam, loud, gentle, invisible.' },
          files: { type: 'array', items: { type: 'string' }, description: 'Optional absolute file paths to attach. Images, videos, audio, documents supported. Max 100MB each.' },
          text_decorations: { type: 'array', items: { type: 'object', properties: { range: { type: 'array', items: { type: 'number' } }, style: { type: 'string' }, animation: { type: 'string' } } }, description: 'Optional text styling. Each item has range [start, end) and either style (bold, italic, strikethrough, underline) or animation (big, small, shake, nod, explode, ripple, bloom, jitter). iMessage only.' },
        },
        required: ['to', 'text'],
      },
    },
    {
      name: 'send_link',
      description: 'Send a URL with a rich link preview card via iMessage. The link must be the only content — no text or media alongside it.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string', description: 'Chat ID to send to' },
          url: { type: 'string', description: 'URL to send with rich preview' },
        },
        required: ['chat_id', 'url'],
      },
    },
    {
      name: 'check_capability',
      description: 'Check if a phone number supports iMessage or RCS before sending',
      inputSchema: {
        type: 'object' as const,
        properties: {
          phone: { type: 'string', description: 'Phone number to check (e.g. +1XXXXXXXXXX)' },
          service: { type: 'string', enum: ['imessage', 'rcs'], description: 'Service to check for. Default: imessage' },
        },
        required: ['phone'],
      },
    },
  ],
}))

// --- File upload helper ---

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.heic': 'image/heic', '.heif': 'image/heif', '.tiff': 'image/tiff', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mpeg': 'video/mpeg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.html': 'text/html',
  '.doc': 'application/msword', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

async function uploadFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  const contentType = (MIME_TYPES[ext] || 'application/octet-stream') as any
  const filename = path.basename(filePath)
  const stat = fs.statSync(filePath)

  const { attachment_id, upload_url, required_headers } = await linq.attachments.create({
    filename,
    content_type: contentType,
    size_bytes: stat.size,
  })

  const fileBuffer = fs.readFileSync(filePath)
  const uploadResp = await fetch(upload_url, {
    method: 'PUT',
    headers: required_headers,
    body: fileBuffer,
  })
  if (!uploadResp.ok) throw new Error(`Failed to upload file: ${uploadResp.status}`)

  return attachment_id
}

// --- Helpers ---

const BUBBLE_EFFECTS = ['slam', 'loud', 'gentle', 'invisible']

function buildMessage(text: string, opts?: { effect?: string; reply_to?: string; files_ids?: string[]; text_decorations?: any[] }) {
  const textPart: any = { type: 'text', value: text }
  if (opts?.text_decorations?.length) textPart.text_decorations = opts.text_decorations
  const parts: any[] = [textPart]
  if (opts?.files_ids) {
    for (const id of opts.files_ids) parts.push({ type: 'media', attachment_id: id })
  }
  const message: any = { parts, preferred_service: 'iMessage' as const }
  if (opts?.effect) message.effect = { name: opts.effect, type: BUBBLE_EFFECTS.includes(opts.effect) ? 'bubble' : 'screen' }
  if (opts?.reply_to) message.reply_to = { message_id: opts.reply_to }
  return message
}

async function uploadFiles(files?: string[]): Promise<string[]> {
  if (!files) return []
  const ids: string[] = []
  for (const f of files) ids.push(await uploadFile(f))
  return ids
}

async function markRead(chatId: string): Promise<void> {
  try { await linq.chats.markAsRead(chatId) } catch (e: any) { console.error('[imessage] markRead error:', e.message) }
}

async function startTyping(chatId: string): Promise<void> {
  try { await linq.chats.typing.start(chatId) } catch (e: any) { console.error('[imessage] startTyping error:', e.message) }
}

async function stopTyping(chatId: string): Promise<void> {
  try { await linq.chats.typing.stop(chatId) } catch (e: any) { console.error('[imessage] stopTyping error:', e.message) }
}

// --- Tool Handlers ---

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  if (name === 'reply') {
    const { chat_id, text, effect, reply_to, files, text_decorations } = args as { chat_id: string; text: string; effect?: string; reply_to?: string; files?: string[]; text_decorations?: any[] }
    try {
      await stopTyping(chat_id)
      const fileIds = await uploadFiles(files)
      const message = buildMessage(text, { effect, reply_to, files_ids: fileIds, text_decorations })
      const data = await linq.chats.messages.send(chat_id, { message })
      const messageId = data.message?.id || ''
      return { content: [{ type: 'text' as const, text: `sent via iMessage (message_id: ${messageId})` }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  if (name === 'edit_message') {
    const { message_id, text } = args as { message_id: string; text: string }
    try {
      await linq.messages.update(message_id, { text, part_index: 0 })
      return { content: [{ type: 'text' as const, text: 'message edited' }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  if (name === 'react') {
    const { message_id, reaction } = args as { chat_id: string; message_id: string; reaction: string }
    try {
      await linq.messages.addReaction(message_id, {
        type: reaction as any,
        operation: 'add',
        part_index: 0,
      })
      return { content: [{ type: 'text' as const, text: `reacted with ${reaction}` }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  if (name === 'send') {
    const { to, text, effect, files, text_decorations } = args as { to: string; text: string; effect?: string; files?: string[]; text_decorations?: any[] }
    try {
      const fileIds = await uploadFiles(files)
      const message = buildMessage(text, { effect, files_ids: fileIds, text_decorations })
      const data = await linq.chats.create({
        to: [to],
        from: config.fromPhone,
        message,
      })
      const chatId = data.chat?.id || ''
      const messageId = (data.chat as any)?.message?.id || ''
      return { content: [{ type: 'text' as const, text: `sent to ${to} (chat_id: ${chatId}, message_id: ${messageId})` }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  if (name === 'send_link') {
    const { chat_id, url } = args as { chat_id: string; url: string }
    try {
      const data = await linq.chats.messages.send(chat_id, {
        message: { parts: [{ type: 'link', value: url }] },
      })
      const messageId = data.message?.id || ''
      return { content: [{ type: 'text' as const, text: `link sent (message_id: ${messageId})` }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  if (name === 'check_capability') {
    const { phone, service } = args as { phone: string; service?: string }
    try {
      const check = service === 'rcs'
        ? await linq.capability.checkRCS({ address: phone, from: config.fromPhone })
        : await linq.capability.checkiMessage({ address: phone, from: config.fromPhone })
      const svc = service === 'rcs' ? 'RCS' : 'iMessage'
      return { content: [{ type: 'text' as const, text: check.available ? `${phone} supports ${svc}` : `${phone} does not support ${svc}` }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  throw new Error(`unknown tool: ${name}`)
})

// --- Connect to Claude Code ---

await mcp.connect(new StdioServerTransport())

// --- Message Polling ---

const POLL_INTERVAL = parseInt(process.env.LINQ_POLL_INTERVAL || '3000', 10)
const seenMessageIds = new Set<string>()
let lastPollTime = new Date().toISOString()

async function pollForMessages(): Promise<void> {
  try {
    const chatsData = await linq.chats.listChats({ from: config.fromPhone, limit: 10 })
    const chats = chatsData.chats || []

    for (const chat of chats) {
      const chatId = chat.id
      const msgsData = await linq.chats.messages.list(chatId, { limit: 5 })
      const messages = msgsData.messages || []

      for (const msg of messages) {
        if (seenMessageIds.has(msg.id)) continue
        seenMessageIds.add(msg.id)
        if (msg.is_from_me) continue

        const msgTime = new Date(msg.sent_at || msg.created_at || 0)
        const startTime = new Date(lastPollTime)
        if (msgTime < startTime) continue

        // Extract text and media from message parts
        let messageText = ''
        const attachments: { id: string; filename: string; mime_type: string; localPath?: string }[] = []
        const inboxDir = path.join(CHANNEL_DIR, 'inbox')
        for (const part of (msg.parts || [])) {
          if (part.type === 'text') messageText = (part as any).value || ''
          if (part.type === 'media' && (part as any).id) {
            const partId = (part as any).id
            const filename = (part as any).filename || `${partId}.bin`
            try {
              const attData = await linq.attachments.retrieve(partId)
              let localPath: string | undefined
              if (attData.download_url) {
                try {
                  fs.mkdirSync(inboxDir, { recursive: true })
                  const dlResp = await fetch(attData.download_url, { signal: AbortSignal.timeout(15000) })
                  if (dlResp.ok) {
                    const buffer = Buffer.from(await dlResp.arrayBuffer())
                    localPath = path.join(inboxDir, filename)
                    fs.writeFileSync(localPath, buffer)
                  }
                } catch (e: any) { console.error('[imessage] Failed to download attachment:', e.message) }
              }
              attachments.push({ id: partId, filename, mime_type: (part as any).mime_type || 'unknown', localPath })
            } catch {
              attachments.push({ id: partId, filename, mime_type: (part as any).mime_type || 'unknown' })
            }
          }
        }
        messageText = messageText || (msg as any).text || ''
        if (!messageText && attachments.length === 0) continue

        const sender = (msg as any).from || (msg as any).from_handle?.handle || (chat as any).handles?.find((h: any) => !h.is_me)?.handle || ''

        // Access control
        const access = loadAccessConfig()
        if (access.dmPolicy === 'disabled') {
          console.error(`[imessage] Dropped (policy: disabled)`)
          continue
        }

        const isAllowed = access.dmPolicy === 'open' ||
          access.allowFrom.includes(sender) ||
          (config.allowedSenders.size > 0 && config.allowedSenders.has(sender))

        if (!isAllowed) {
          if (access.dmPolicy === 'pairing') {
            const code = generatePairingCode()
            access.pendingPairings[code] = { phone: sender, createdAt: new Date().toISOString() }
            saveAccessConfig(access)
            try {
              await linq.chats.messages.send(chatId, {
                message: { parts: [{ type: 'text', value: `Pairing code: ${code}\nGive this to the Claude Code operator to approve your access.` }] },
              })
            } catch (e: any) { console.error('[imessage] Failed to send pairing code:', e.message) }
            console.error(`[imessage] Pairing code ${code} sent to ${sender}`)
          } else {
            console.error(`[imessage] Dropped message from ${sender} (not in allowlist)`)
          }
          continue
        }

        // Ack reaction
        if (access.ackReaction && msg.id) {
          try {
            await linq.messages.addReaction(msg.id, { type: access.ackReaction as any, operation: 'add', part_index: 0 })
          } catch (e: any) { console.error('[imessage] ackReaction error:', e.message) }
        }

        markRead(chatId)
        startTyping(chatId)

        // Push to Claude Code
        const imagePaths = attachments.filter(a => a.localPath && a.mime_type.startsWith('image/')).map(a => a.localPath!)
        await mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: messageText || (attachments.length > 0 ? '(attachment)' : ''),
            meta: {
              sender,
              chat_id: chatId,
              message_id: msg.id,
              ...(imagePaths.length === 1 && { image_path: imagePaths[0] }),
              ...(imagePaths.length > 1 && { image_paths: imagePaths }),
              ...(attachments.filter(a => !a.mime_type.startsWith('image/')).length > 0 && {
                attachments: attachments.filter(a => !a.mime_type.startsWith('image/')).map(a => ({
                  filename: a.filename,
                  mime_type: a.mime_type,
                  ...(a.localPath && { path: a.localPath }),
                })),
              }),
            },
          },
        })
        console.error(`[imessage] ${sender}: ${messageText.substring(0, 80)}${attachments.length > 0 ? ` [${attachments.length} attachment(s)]` : ''}`)
      }
    }

    if (seenMessageIds.size > 1000) {
      const arr = [...seenMessageIds]
      arr.splice(0, arr.length - 500)
      seenMessageIds.clear()
      arr.forEach(id => seenMessageIds.add(id))
    }
  } catch (e: any) {
    console.error(`[imessage] Poll error: ${e.message}`)
  }
}

// --- Auto Contact Card Setup ---

const CLAUDE_CODE_LOGO = 'https://storage.googleapis.com/sm-artworks/be75b541-e429-4b61-a058-6a04bc35f712/customer_file_small.png'

async function setupContactCard(): Promise<void> {
  if (!config.fromPhone || !config.token) return

  try {
    const existing = await linq.contactCard.retrieve({ phone_number: config.fromPhone })
    const cards = (existing as any).contact_cards || []
    const active = cards.find((c: any) => c.phone_number === config.fromPhone && c.is_active)

    if (active && active.first_name === 'Claude' && active.last_name === 'Code') {
      console.error(`[imessage]   Contact card already set: Claude Code`)
      return
    }

    await linq.contactCard.create({
      phone_number: config.fromPhone,
      first_name: 'Claude',
      last_name: 'Code',
      image_url: CLAUDE_CODE_LOGO,
    })
    console.error(`[imessage]   Contact card set: Claude Code`)
  } catch (e: any) {
    console.error(`[imessage]   Contact card setup error: ${e.message}`)
  }
}

// --- Webhook fallback ---

const webhookServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end('Method not allowed')
    return
  }

  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks).toString()

  try {
    const event = JSON.parse(body)
    const data = event.data || event
    const messageText = data.message?.text || data.text || ''
    const sender = data.message?.from || data.from || ''
    const chatId = data.chat?.id || data.chat_id || ''
    const messageId = data.message?.id || ''

    if (!messageText) { res.writeHead(200); res.end('ok'); return }
    if (messageId) seenMessageIds.add(messageId)

    const access = loadAccessConfig()
    if (access.dmPolicy === 'disabled') { res.writeHead(200); res.end('ok'); return }
    const isAllowed = access.dmPolicy === 'open' || access.allowFrom.includes(sender)
    if (!isAllowed) { res.writeHead(200); res.end('ok'); return }

    if (chatId) { markRead(chatId); startTyping(chatId) }

    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: messageText,
        meta: { sender, chat_id: chatId, message_id: messageId },
      },
    })
    console.error(`[imessage] webhook: ${sender}: ${messageText.substring(0, 80)}`)
  } catch (e: any) {
    console.error(`[imessage] Webhook error: ${e.message}`)
  }

  res.writeHead(200)
  res.end('ok')
})

webhookServer.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[imessage]   Webhook: port ${config.webhookPort} in use, skipping (polling still active)`)
  } else {
    console.error(`[imessage]   Webhook error: ${err.message}`)
  }
})

webhookServer.listen(config.webhookPort, '127.0.0.1', () => {
  console.error(`[imessage]   Webhook: http://127.0.0.1:${config.webhookPort} (fallback)`)
})

// --- Startup ---

const startupAccess = loadAccessConfig()

console.error(`[imessage] Channel ready`)
console.error(`[imessage]   Policy:  ${startupAccess.dmPolicy}`)
console.error(`[imessage]   Polling: every ${startupAccess.pollInterval || POLL_INTERVAL}ms`)
console.error(`[imessage]   From:    ${config.fromPhone}`)
console.error(`[imessage]   API:     ${config.apiUrl}`)
if (startupAccess.allowFrom.length > 0) {
  console.error(`[imessage]   Allowed: ${startupAccess.allowFrom.join(', ')}`)
}

setupContactCard()

setInterval(pollForMessages, startupAccess.pollInterval || POLL_INTERVAL)
console.error(`[imessage]   Polling started`)

setTimeout(async () => {
  const recipient = config.defaultRecipient || startupAccess.defaultRecipient || (startupAccess.allowFrom.length > 0 ? startupAccess.allowFrom[0] : '')
  if (recipient) {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: `Channel connected. Send a greeting NOW by calling the send tool with to="${recipient}" and a brief message like "Hey, Claude Code is online. Text me anything."`,
        meta: {
          sender: 'system',
          event_type: 'channel_ready',
          recipient,
        },
      },
    })
  } else if (!config.token || !config.fromPhone) {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: 'Channel connected but Linq is not configured. Tell the user to run:\n1. /imessage:configure <token> — set their Linq API token\n2. /imessage:configure <phone> — set their Linq phone number\nGet a token at https://zero.linqapp.com/api-tooling/ or run `linq signup` for a sandbox.',
        meta: { sender: 'system', event_type: 'setup_required' },
      },
    })
  } else {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: 'Channel connected but no recipient phone number is configured. Ask the user: "What\'s your phone number? I\'ll text you to confirm the connection." Then use the send tool with their number. Remember the number for future messages.',
        meta: { sender: 'system', event_type: 'channel_ready_no_recipient' },
      },
    })
  }
}, 2000)
