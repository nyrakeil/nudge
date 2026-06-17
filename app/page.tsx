"use client"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

export default function Home() {
  async function handleStartSession() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-black px-6">
      <main className="flex max-w-lg flex-col items-center gap-8 text-center">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-4xl">
          Stuck? This AI doesn&apos;t motivate you. It gets you to start.
        </h1>
        <p className="text-lg leading-relaxed text-zinc-400">
          For founders and builders who know what to do but can&apos;t begin.
        </p>
        <Button size="lg" onClick={handleStartSession}>
          Start a session
        </Button>
      </main>
    </div>
  )
}
