"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"

type Message = {
  role: "user" | "assistant"
  content: string
}

const INITIAL_MESSAGE: Message = {
  role: "assistant",
  content: "Hey. What are we working on today?",
}

const SESSION_STORAGE_KEY = "nudge_active_session_id"
const MAX_SESSION_AGE_MS = 4 * 60 * 60 * 1000 // 4 hours

function formatElapsed(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

function isSessionFresh(startedAt: string) {
  return Date.now() - new Date(startedAt).getTime() < MAX_SESSION_AGE_MS
}

async function readChatError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")
  if (!text) return response.statusText || "Couldn't get a response."

  try {
    const body = JSON.parse(text) as { error?: string }
    if (body.error) return body.error
  } catch {
    // response body may not be JSON
  }

  return text
}

function removeEmptyAssistantMessage(messages: Message[]): Message[] {
  const last = messages[messages.length - 1]
  if (last?.role === "assistant" && !last.content.trim()) {
    return messages.slice(0, -1)
  }
  return messages
}

export default function SessionPage() {
  const router = useRouter()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const didInitRef = useRef(false)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState("")
  const [lastWorked, setLastWorked] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState("")
  const [elapsed, setElapsed] = useState(0)

  const [initializing, setInitializing] = useState(true)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      if (didInitRef.current) return
      didInitRef.current = true

      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setNeedsSignIn(true)
        setInitializing(false)
        return
      }

      const { data: project } = await supabase
        .from("projects")
        .select("id, name")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!project) {
        router.push("/onboarding")
        return
      }

      let resolvedSession: { id: string; started_at: string } | null = null
      const storedSessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)

      if (storedSessionId) {
        const { data: existingSession } = await supabase
          .from("sessions")
          .select("id, started_at")
          .eq("id", storedSessionId)
          .eq("user_id", user.id)
          .is("ended_at", null)
          .maybeSingle()

        if (existingSession && isSessionFresh(existingSession.started_at)) {
          resolvedSession = existingSession
        } else {
          sessionStorage.removeItem(SESSION_STORAGE_KEY)
        }
      }

      if (!resolvedSession) {
        const { data: session, error: sessionError } = await supabase
          .from("sessions")
          .insert({ user_id: user.id, project_id: project.id })
          .select("id, started_at")
          .single()

        if (sessionError || !session) {
          setError("Couldn't start session.")
          setInitializing(false)
          return
        }

        resolvedSession = session
        sessionStorage.setItem(SESSION_STORAGE_KEY, session.id)
      }

      const [{ data: memory }, { data: savedMessages }] = await Promise.all([
        supabase
          .from("memories")
          .select("content")
          .eq("user_id", user.id)
          .eq("type", "what_worked")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("messages")
          .select("role, content")
          .eq("session_id", resolvedSession.id)
          .order("created_at", { ascending: true }),
      ])

      const restoredMessages: Message[] = [
        INITIAL_MESSAGE,
        ...(savedMessages?.map((message) => ({
          role: message.role as Message["role"],
          content: message.content,
        })) ?? []),
      ]

      const initialElapsed = Math.floor(
        (Date.now() - new Date(resolvedSession.started_at).getTime()) / 1000
      )

      setSessionId(resolvedSession.id)
      setProjectName(project.name)
      setLastWorked(memory?.content ?? null)
      setMessages(restoredMessages)
      setElapsed(Math.max(0, initialElapsed))
      setInitializing(false)
    }

    init()
  }, [router])

  useEffect(() => {
    if (initializing) return

    const interval = setInterval(() => {
      setElapsed((e) => e + 1)
    }, 1000)

    return () => clearInterval(interval)
  }, [initializing])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || streaming || !sessionId) return

    const userMessage: Message = { role: "user", content: input.trim() }
    const updatedMessages = [...messages, userMessage]
    const messagesForApi = updatedMessages
      .filter((message, index) => !(index === 0 && message.role === "assistant"))
      .slice(-30)

    setMessages(updatedMessages)
    setInput("")
    setError(null)
    setStreaming(true)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesForApi, sessionId }),
      })

      if (!response.ok) {
        const message = await readChatError(response)
        console.error("[session] Chat request failed:", message)
        setError(message)
        return
      }

      if (!response.body) {
        const message = "Chat response had no body."
        console.error("[session] Chat request failed:", message)
        setError(message)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ""

      setMessages((prev) => [...prev, { role: "assistant", content: "" }])

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          assistantText += chunk

          setMessages((prev) => {
            const next = [...prev]
            next[next.length - 1] = {
              role: "assistant",
              content: assistantText,
            }
            return next
          })
        }
      } catch (streamError) {
        const message =
          streamError instanceof Error
            ? streamError.message
            : "Chat stream failed."
        console.error("[session] Chat stream failed:", streamError)
        setMessages((prev) => removeEmptyAssistantMessage(prev))
        setError(message)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Couldn't get a response."
      console.error("[session] Chat request failed:", error)
      setError(message)
    } finally {
      setStreaming(false)
    }
  }

  async function handleEndSession() {
    if (!sessionId || ending) return

    setEnding(true)
    setError(null)

    try {
      const response = await fetch("/api/memory/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })

      if (!response.ok) {
        setError("Couldn't end session. Try again.")
        return
      }

      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      router.push("/memory")
    } catch {
      setError("Couldn't end session. Try again.")
    } finally {
      setEnding(false)
    }
  }

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="text-zinc-400">Starting session...</p>
      </div>
    )
  }

  if (needsSignIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-6">
        <p className="text-zinc-400">You need to sign in.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-black lg:flex-row">
      <section className="flex flex-1 flex-col lg:min-h-0">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6">
          {messages.map((message, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                message.role === "user"
                  ? "ml-auto bg-zinc-800 text-zinc-50"
                  : "mr-auto bg-zinc-900 text-zinc-200 ring-1 ring-zinc-800"
              }`}
            >
              {message.content}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSubmit}
          className="border-t border-zinc-800 p-4 sm:p-6"
        >
          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              disabled={streaming}
              className="min-h-12 resize-none border-zinc-700 bg-zinc-900 text-zinc-50 placeholder:text-zinc-500"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit(e)
                }
              }}
            />

            <Button
              type="submit"
              disabled={streaming || !input.trim()}
              className="shrink-0 self-end"
            >
              Send
            </Button>
          </div>
        </form>
      </section>

      <aside className="border-t border-zinc-800 p-4 lg:w-80 lg:shrink-0 lg:border-t-0 lg:border-l lg:p-6">
        <Card className="border-zinc-800 bg-zinc-900 text-zinc-50 ring-zinc-800">
          <CardHeader>
            <CardTitle className="text-zinc-50">Session</CardTitle>
          </CardHeader>

          <CardContent className="flex flex-col gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Project
              </p>
              <p className="mt-1 font-medium">{projectName}</p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Timer
              </p>
              <p className="mt-1 font-mono text-2xl">{formatElapsed(elapsed)}</p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Last time you moved when
              </p>
              <p className="mt-1 text-sm text-zinc-300">
                {lastWorked ?? "Not enough sessions yet."}
              </p>
            </div>

            <Button
              variant="outline"
              className="w-full border-zinc-700 bg-transparent text-zinc-50 hover:bg-zinc-800"
              disabled={ending || streaming}
              onClick={handleEndSession}
            >
              {ending ? "Ending session..." : "End session"}
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}