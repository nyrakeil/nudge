import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")

  if (!code) {
    return NextResponse.redirect(new URL("/", origin))
  }

  const supabase = await createClient()

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    console.error("Auth exchange error:", exchangeError.message)
    return NextResponse.redirect(new URL("/", origin))
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    console.error("Get user error:", userError?.message)
    return NextResponse.redirect(new URL("/", origin))
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      name: user.user_metadata.full_name || user.email || "User",
    },
    { onConflict: "id" }
  )

  if (profileError) {
    console.error("Profile upsert error:", profileError.message)
    return NextResponse.redirect(new URL("/", origin))
  }

  const { data: profile, error: fetchProfileError } = await supabase
    .from("profiles")
    .select("push_style")
    .eq("id", user.id)
    .single()

  if (fetchProfileError) {
    console.error("Fetch profile error:", fetchProfileError.message)
    return NextResponse.redirect(new URL("/", origin))
  }

  if (!profile?.push_style) {
    return NextResponse.redirect(new URL("/onboarding", origin))
  }

  return NextResponse.redirect(new URL("/session", origin))
}