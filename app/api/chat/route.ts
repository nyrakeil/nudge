// app/api/chat/route.ts
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { buildSystemPrompt } from "@/lib/ai/prompt"

const anthropic = new Anthropic()

type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return `${error.status} ${error.message}`
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function errorResponse(message: string, status: number) {
  console.error(`[chat] ${message}`)
  return Response.json({ error: message }, { status })
}

export async function POST(req: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse("Unauthorized", 401)
  }

  let body: { messages?: ChatMessage[]; sessionId?: string }
  try {
    body = await req.json()
  } catch (error) {
    return errorResponse(getErrorMessage(error), 400)
  }

  const { messages, sessionId } = body

  if (!sessionId || !Array.isArray(messages) || messages.length === 0) {
    return errorResponse("Invalid request: messages and sessionId are required", 400)
  }

  const [{ data: profile }, { data: project }, { data: memories }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("projects")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("memories")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ])

  const avoidancePatterns =
    memories
      ?.filter((memory) => memory.type === "avoidance_pattern")
      .map((memory) => memory.content) || []

  const whatWorked =
    memories
      ?.filter((memory) => memory.type === "what_worked")
      .map((memory) => memory.content) || []

  const promises =
    memories
      ?.filter((memory) => memory.type === "promise")
      .map((memory) => memory.content) || []

  const systemPrompt = buildSystemPrompt({
    name: profile?.name || "you",
    project: project?.name || "your work",
    whyItMatters: project?.why_it_matters || "",
    pushStyle: profile?.push_style || "direct",
    avoidancePatterns,
    whatWorked,
    recentPromises: promises,
  })

  const lastMessage = messages[messages.length - 1]

  if (lastMessage?.role === "user") {
    await supabase.from("messages").insert({
      session_id: sessionId,
      user_id: user.id,
      role: "user",
      content: lastMessage.content,
    })
  }

  try {
    const claudeStream = anthropic.messages.stream({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 500,
      system: systemPrompt,
      messages,
    })

    const encoder = new TextEncoder()
    let assistantText = ""

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of claudeStream) {
            if (event.type !== "content_block_delta") continue

            const delta = event.delta as { type?: string; text?: string }
            if (delta.type !== "text_delta" || !delta.text) continue

            assistantText += delta.text
            controller.enqueue(encoder.encode(delta.text))
          }

          if (assistantText.trim()) {
            const { error: insertError } = await supabase.from("messages").insert({
              session_id: sessionId,
              user_id: user.id,
              role: "assistant",
              content: assistantText,
            })

            if (insertError) {
              throw new Error(`Failed to save assistant message: ${insertError.message}`)
            }
          }

          controller.close()
        } catch (error) {
          const message = getErrorMessage(error)
          console.error("[chat] Stream failed:", error)
          controller.error(new Error(message))
        }
      },
    })

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    })
  } catch (error) {
    return errorResponse(getErrorMessage(error), 500)
  }
}