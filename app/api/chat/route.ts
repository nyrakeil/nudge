// app/api/chat/route.ts
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { buildSystemPrompt } from '@/lib/ai/prompt'

const anthropic = new Anthropic()

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { messages, sessionId } = await req.json()

  // Fetch user context in parallel
  const [{ data: profile }, { data: project }, { data: memories }] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('projects').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('memories').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(20)
    ])

  const avoidancePatterns = memories
    ?.filter(m => m.type === 'avoidance_pattern').map(m => m.content) || []
  const whatWorked = memories
    ?.filter(m => m.type === 'what_worked').map(m => m.content) || []
  const promises = memories
    ?.filter(m => m.type === 'promise').map(m => m.content) || []

  const systemPrompt = buildSystemPrompt({
    name: profile?.name || 'you',
    project: project?.name || 'your work',
    whyItMatters: project?.why_it_matters || '',
    pushStyle: profile?.push_style || 'direct',
    avoidancePatterns, whatWorked, recentPromises: promises
  })

  // Save the user's message
  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.role === 'user') {
    await supabase.from('messages').insert({
      session_id: sessionId,
      user_id: user.id,
      role: 'user',
      content: lastMsg.content
    })
  }

  // Stream Claude response
  const stream = await anthropic.messages.stream({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    max_tokens: 500,
    system: systemPrompt,
    messages
  })

  // Save assistant message after stream completes
  stream.on('finalMessage', async (msg) => {
    const content = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    await supabase.from('messages').insert({
      session_id: sessionId,
      user_id: user.id,
      role: 'assistant',
      content
    })
  })

  return new Response(stream.toReadableStream())
}