import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured" },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const prompt = url.searchParams.get("q") || "Say hi in one short sentence.";
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  try {
    const genai = new GoogleGenAI({ apiKey });
    const result = await genai.models.generateContent({
      model,
      contents: prompt,
    });
    const text = result.text ?? "";
    return NextResponse.json({ model, prompt, text });
  } catch (e: any) {
    console.error("[agent/ping] gemini call failed:", e);
    return NextResponse.json(
      { error: e?.message || "gemini call failed" },
      { status: 500 },
    );
  }
}
