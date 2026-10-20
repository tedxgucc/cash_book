// Supabase Edge Function: "ask"
// Powers the "Ask AI" tab and the memo writer. Only signed-in team members can call it.
// Uses Google Gemini (free tier). Claude still works if you prefer it: set ANTHROPIC_API_KEY instead.
// Deploy:  supabase functions deploy ask
// Secrets: supabase secrets set GEMINI_API_KEY=...   (optional: GEMINI_MODEL)
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Flash-Lite answers fastest (it thinks at the "minimal" level by default).
// If it's busy or over its free limit, try the bigger Flash model.
const GEMINI_MODELS = [Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite", "gemini-3.8-flash"];

async function askGemini(key: string, prompt: string): Promise<string> {
  let last = "Gemini API error";
  for (const model of GEMINI_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500 },
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (r.ok) {
      const parts = out?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (text) return text;
      last = "Gemini returned an empty answer. Try rephrasing the question.";
      continue;
    }
    last = out?.error?.message ?? `Gemini API error (${r.status})`;
    if (![429, 500, 503].includes(r.status)) break; // only retry when busy / over quota
  }
  throw new Error(last);
}

async function askClaude(key: string, prompt: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(out?.error?.message ?? "Claude API error");
  return (out.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Check the caller is on the team list, using their own login.
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: onTeam, error } = await sb.rpc("is_team");
    if (error || !onTeam) return json({ error: "You are not on the team list." }, 403);

    const { prompt } = await req.json();
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 250_000) return json({ error: "Empty or too-long question." }, 400);

    const gemini = Deno.env.get("GEMINI_API_KEY"), claude = Deno.env.get("ANTHROPIC_API_KEY");
    if (!gemini && !claude) return json({ error: "Ask AI is not set up yet: add the GEMINI_API_KEY secret." }, 500);
    try {
      const text = gemini ? await askGemini(gemini, prompt) : await askClaude(claude!, prompt);
      return json({ text });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
