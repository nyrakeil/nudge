// app/api/dev-test/route.ts
// DELETE THIS FILE BEFORE PRODUCTION

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function GET() {
  try {
    const message = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 200,
      messages: [{ role: "user", content: "Say exactly: AI core is working." }],
    });

    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return new Response(text || "No text returned", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    console.error("Dev test failed:", error);

    return new Response("AI core test failed. Check terminal logs.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

// Test: open http://localhost:3000/api/dev-test in browser
// You should see: AI core is working.