import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")

  if (!code) {
    return NextResponse.redirect(`${origin}/`)
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.exchangeCodeForSession(code)

    if (error || !user) {
      return NextResponse.redirect(`${origin}/`)
    }

    const { error: upsertError } = await supabase.from("profiles").upsert({
      id: user.id,
      name: user.user_metadata.full_name,
    })

    if (upsertError) {
      return NextResponse.redirect(`${origin}/`)
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("push_style")
      .eq("id", user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.redirect(`${origin}/`)
    }

    if (!profile.push_style) {
      return NextResponse.redirect(`${origin}/onboarding`)
    }

    return NextResponse.redirect(`${origin}/session`)
  } catch {
    return NextResponse.redirect(`${origin}/`)
  }
}
