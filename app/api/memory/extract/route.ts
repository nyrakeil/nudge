// app/api/memory/extract/route.ts
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const anthropic = new Anthropic()

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { sessionId } = await req.json()

  // Fetch messages from DB (not from client — more reliable)
  const { data: msgs } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (!msgs || msgs.length === 0) {
    return Response.json({ ok: true, skipped: true })
  }

  const conversation = msgs.map(m => `${m.role}: ${m.content}`).join('\n')

  let extracted = {
    avoidance_patterns: [] as string[],
    what_worked: [] as string[],
    promises: [] as string[],
    did_move: false,
    summary: ''
  }

  try {
    const result = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Analyze this work session. Return ONLY valid JSON, no markdown, no explanation.

Session:
${conversation}

Required structure:
{
  "avoidance_patterns": ["pattern if observed, else empty array"],
  "what_worked": ["what helped them start, else empty array"],
  "promises": ["any promises they made, else empty array"],
  "did_move": true or false,
  "summary": "one sentence"
}`
      }]
    })

    const raw = result.content[0]?.type === 'text'
      ? result.content[0].text.trim() : '{}'
    // Strip any accidental markdown fences
    const clean = raw.replace(/^```json\n?|\n?```$/g, '').trim()
    extracted = { ...extracted, ...JSON.parse(clean) }
  } catch (err) {
    console.error('Memory extraction failed:', err)
    // Don't crash — just save what we have (empty)
  }

  // Save memories
  const toInsert = [
    ...extracted.avoidance_patterns.map(c =>
      ({ user_id: user.id, type: 'avoidance_pattern', content: c })),
    ...extracted.what_worked.map(c =>
      ({ user_id: user.id, type: 'what_worked', content: c })),
    ...extracted.promises.map(c =>
      ({ user_id: user.id, type: 'promise', content: c }))
  ].filter(m => m.content?.trim())

  if (toInsert.length > 0) {
    await supabase.from('memories').insert(toInsert)
  }

  await supabase.from('sessions').update({
    ended_at: new Date().toISOString(),
    did_move: extracted.did_move,
    summary: extracted.summary
  }).eq('id', sessionId)

  return Response.json({ ok: true })
}