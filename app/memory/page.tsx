"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

type Memory = {
  content: string
  created_at: string
  type: string
}

const SECTIONS = [
  { title: "Your goals", type: "goal" },
  { title: "Your avoidance patterns", type: "avoidance_pattern" },
  { title: "What gets you moving", type: "what_worked" },
  { title: "Promises you made", type: "promise" },
] as const

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [needsSignIn, setNeedsSignIn] = useState(false)

  useEffect(() => {
    async function loadMemories() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setNeedsSignIn(true)
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from("memories")
        .select("content, created_at, type")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })

      setMemories(data ?? [])
      setLoading(false)
    }

    loadMemories()
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="text-zinc-400">Loading memories...</p>
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
    <div className="min-h-screen bg-black px-6 py-12">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-10">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold text-zinc-50">Memory</h1>
          <p className="text-zinc-400">
            What Nudge has learned about how you work.
          </p>
        </div>

        <div className="flex flex-col gap-8">
          {SECTIONS.map((section) => {
            const items = memories.filter(
              (memory) => memory.type === section.type
            )

            return (
              <section key={section.type} className="flex flex-col gap-4">
                <h2 className="text-lg font-medium text-zinc-50">
                  {section.title}
                </h2>

                {items.length === 0 ? (
                  <p className="text-sm text-zinc-500">Nothing here yet.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {items.map((memory, index) => (
                      <li
                        key={`${section.type}-${index}-${memory.created_at}`}
                        className="rounded-lg bg-zinc-900 px-4 py-3 ring-1 ring-zinc-800"
                      >
                        <p className="text-sm leading-relaxed text-zinc-200">
                          {memory.content}
                        </p>
                        <p className="mt-2 text-xs text-zinc-500">
                          {new Date(memory.created_at).toLocaleDateString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>

        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href="/session">Start another session</Link>
        </Button>
      </main>
    </div>
  )
}
