#!/usr/bin/env node
/**
 * iMessage Channel for Claude Code
 * Powered by Linq (https://linqapp.com)
 *
 * Two-way bridge: text your Linq number from iMessage and it pushes
 * into your Claude Code session. Claude replies back via iMessage.
 *
 * Setup:
 *   1. Get a Linq API token from https://zero.linqapp.com/api-tooling/
 *   2. Set LINQ_TOKEN and LINQ_FROM_PHONE environment variables
 *   3. Create a webhook subscription pointing to this server's port
 *   4. Start Claude Code with --dangerously-load-development-channels server:imessage
 *
 * Architecture:
 *   iMessage -> Linq -> webhook POST -> this server -> Claude Code session
 *   Claude reply -> Linq API -> iMessage -> your phone
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

// --- Configuration ---

interface ChannelConfig {
  token: string
  fromPhone: string
  apiUrl: string
  webhookPort: number
  allowedSenders: Set<string>
}

function loadChannelConfig(): ChannelConfig {
  // Try config file first, then env vars
  let token = process.env.LINQ_TOKEN || ''
  let fromPhone = process.env.LINQ_FROM_PHONE || ''
  let apiUrl = process.env.LINQ_API_URL || 'https://api.linqapp.com/api/partner'

  const configPath = path.join(process.env.HOME || '', '.linq', 'config.json')
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const profileName = process.env.LINQ_PROFILE || raw.profile || 'default'
      const profile = raw.profiles?.[profileName]
      if (profile) {
        token = token || profile.token || ''
        fromPhone = fromPhone || profile.fromPhone || ''
        if (profile.apiUrl) apiUrl = profile.apiUrl
      }
    } catch {}
  }

  return {
    token,
    fromPhone,
    apiUrl,
    webhookPort: parseInt(process.env.LINQ_CHANNEL_PORT || '9998', 10),
    allowedSenders: new Set(
      (process.env.LINQ_ALLOWED_SENDERS || '').split(',').filter(Boolean)
    ),
  }
}

const config = loadChannelConfig()

// --- MCP Channel Server ---

const mcp = new Server(
  { name: 'imessage', version: '0.1.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions: `You are connected to iMessage via Linq. Messages arrive as <channel source="imessage" sender="..." chat_id="...">.

When you receive a message:
- Read it and respond helpfully
- Reply using the reply tool, passing the chat_id from the tag
- You can also send messages to new numbers using the send tool

The person texting you is your operator. Follow their instructions.
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
        },
        required: ['chat_id', 'text'],
      },
    },
    {
      name: 'send',
      description: 'Send an iMessage to a phone number',
      inputSchema: {
        type: 'object' as const,
        properties: {
          to: { type: 'string', description: 'Phone number (e.g. +12025551234)' },
          text: { type: 'string', description: 'Message to send' },
        },
        required: ['to', 'text'],
      },
    },
  ],
}))

async function linqApiCall(endpoint: string, body: object): Promise<Response> {
  return fetch(`${config.apiUrl}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  if (name === 'reply') {
    const { chat_id, text } = args as { chat_id: string; text: string }
    try {
      const resp = await linqApiCall(`chats/${chat_id}/messages`, {
        message: { parts: [{ type: 'text', value: text }] },
      })
      if (!resp.ok) {
        const err = await resp.text()
        return { content: [{ type: 'text' as const, text: `Failed: ${err}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: 'sent via iMessage' }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  if (name === 'send') {
    const { to, text } = args as { to: string; text: string }
    try {
      const resp = await linqApiCall('chats', {
        to: [to],
        from: config.fromPhone,
        message: { parts: [{ type: 'text', value: text }] },
      })
      if (!resp.ok) {
        const err = await resp.text()
        return { content: [{ type: 'text' as const, text: `Failed: ${err}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: `sent to ${to}` }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  throw new Error(`unknown tool: ${name}`)
})

// --- Connect to Claude Code ---

await mcp.connect(new StdioServerTransport())

// --- Webhook Listener for Inbound Messages ---

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

    // Parse Synapse webhook payload
    const eventType = event.type || event.event_type || ''
    const data = event.data || event
    const messageText = data.message?.text || data.text || ''
    const sender = data.message?.from || data.from || ''
    const chatId = data.chat?.id || data.chat_id || ''
    const senderName = data.message?.from_name || data.from_name || sender

    // Skip non-message events and outbound messages
    if (!messageText) {
      res.writeHead(200)
      res.end('ok')
      return
    }

    // Sender gating
    if (config.allowedSenders.size > 0 && !config.allowedSenders.has(sender)) {
      console.error(`[imessage] Dropped message from ${sender} (not in allowlist)`)
      res.writeHead(200)
      res.end('ok')
      return
    }

    // Push to Claude Code
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: messageText,
        meta: {
          sender,
          sender_name: senderName,
          chat_id: chatId,
          event_type: eventType,
        },
      },
    })

    console.error(`[imessage] ${sender}: ${messageText.substring(0, 80)}`)
  } catch (e: any) {
    console.error(`[imessage] Webhook error: ${e.message}`)
  }

  res.writeHead(200)
  res.end('ok')
})

webhookServer.listen(config.webhookPort, '127.0.0.1', () => {
  console.error(`[imessage] Channel ready`)
  console.error(`[imessage]   Webhook: http://127.0.0.1:${config.webhookPort}`)
  console.error(`[imessage]   From:    ${config.fromPhone}`)
  console.error(`[imessage]   API:     ${config.apiUrl}`)
  if (config.allowedSenders.size > 0) {
    console.error(`[imessage]   Allowed: ${[...config.allowedSenders].join(', ')}`)
  }
})
