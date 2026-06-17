"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"

const STEPS = 4
const PUSH_STYLES = [
  { label: "Soft", value: "soft" },
  { label: "Direct", value: "direct" },
  { label: "Brutal", value: "brutal" },
  { label: "Calm", value: "calm" },
] as const

const QUESTIONS = [
  "What are you trying to build or work on?",
  "Why does it matter to you?",
  "What do you usually avoid or freeze on?",
  "How do you want to be pushed?",
] as const

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [projectName, setProjectName] = useState("")
  const [whyItMatters, setWhyItMatters] = useState("")
  const [avoidance, setAvoidance] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function completeOnboarding(pushStyle: string) {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setError("You need to be signed in to continue.")
        return
      }

      const { error: projectError } = await supabase.from("projects").insert({
        user_id: user.id,
        name: projectName.trim(),
        why_it_matters: whyItMatters.trim(),
      })

      if (projectError) {
        console.error("Project insert error:", projectError)
        setError(`Couldn't save your project: ${projectError.message}`)
        return
      }

      const { error: memoryError } = await supabase.from("memories").insert({
        user_id: user.id,
        type: "avoidance_pattern",
        content: avoidance.trim(),
      })

      if (memoryError) {
        console.error("Memory insert error:", memoryError)
        setError(`Couldn't save your answer: ${memoryError.message}`)
        return
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ push_style: pushStyle })
        .eq("id", user.id)

      if (profileError) {
        console.error("Profile update error:", profileError)
        setError(`Couldn't save your preference: ${profileError.message}`)
        return
      }

      router.push("/session")
    } catch {
      setError("Something went wrong. Try again.")
    } finally {
      setLoading(false)
    }
  }

  function handleContinue() {
    if (step === 0 && !projectName.trim()) return
    if (step === 1 && !whyItMatters.trim()) return
    if (step === 2 && !avoidance.trim()) return
    setStep((s) => s + 1)
  }

  const canContinue =
    (step === 0 && projectName.trim()) ||
    (step === 1 && whyItMatters.trim()) ||
    (step === 2 && avoidance.trim())

  return (
    <div className="flex min-h-screen flex-col bg-black px-6 py-12">
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-10">
        <div className="flex justify-center gap-2">
          {Array.from({ length: STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-2 w-2 rounded-full transition-colors ${
                i <= step ? "bg-zinc-50" : "bg-zinc-700"
              }`}
            />
          ))}
        </div>

        <div className="flex flex-1 flex-col justify-center gap-8">
          <h1 className="text-2xl font-semibold leading-tight text-zinc-50 sm:text-3xl">
            {QUESTIONS[step]}
          </h1>

          {step === 0 && (
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Launch my SaaS, finish the deck, ship the feature"
              className="h-12 border-zinc-700 bg-zinc-900 text-zinc-50 placeholder:text-zinc-500"
              disabled={loading}
              onKeyDown={(e) => e.key === "Enter" && canContinue && handleContinue()}
            />
          )}

          {step === 1 && (
            <Textarea
              value={whyItMatters}
              onChange={(e) => setWhyItMatters(e.target.value)}
              placeholder="What changes if you actually do this?"
              className="min-h-32 border-zinc-700 bg-zinc-900 text-zinc-50 placeholder:text-zinc-500"
              disabled={loading}
            />
          )}

          {step === 2 && (
            <Textarea
              value={avoidance}
              onChange={(e) => setAvoidance(e.target.value)}
              placeholder="e.g. opening the laptop, writing the first line, making the call"
              className="min-h-32 border-zinc-700 bg-zinc-900 text-zinc-50 placeholder:text-zinc-500"
              disabled={loading}
            />
          )}

          {step === 3 && (
            <div className="grid grid-cols-2 gap-3">
              {PUSH_STYLES.map((style) => (
                <Button
                  key={style.value}
                  size="lg"
                  variant="outline"
                  className="h-14 border-zinc-700 bg-zinc-900 text-zinc-50 hover:bg-zinc-800"
                  disabled={loading}
                  onClick={() => completeOnboarding(style.value)}
                >
                  {style.label}
                </Button>
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          {loading && (
            <p className="text-sm text-zinc-400">Saving...</p>
          )}

          {step < 3 && (
            <Button
              size="lg"
              className="w-full"
              disabled={!canContinue || loading}
              onClick={handleContinue}
            >
              Continue
            </Button>
          )}
        </div>
      </main>
    </div>
  )
}
