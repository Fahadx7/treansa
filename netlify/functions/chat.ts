/**
 * chat.ts — Netlify Function
 * POST /.netlify/functions/chat
 * Saudi stock advisor powered by Claude Haiku
 */

import type { Handler } from "@netlify/functions";

const SYSTEM_PROMPT = `أنت مستشار أسهم سعودي متخصص في سوق تداول (TASI). تحلل الأسهم تقنياً وتقدم توصيات مبنية على RSI وMACD وموجات إليوت. ردودك باللغة العربية دائماً. أجب بشكل مختصر ومنظم. في نهاية كل رد أضف: ⚠️ للاستشارة فقط وليس توصية مالية`;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
  }

  const ip = event.headers["x-forwarded-for"]?.split(",")[0] ?? "unknown";
  if (!checkRateLimit(ip + ":chat", 20, 60_000)) {
    return { statusCode: 429, body: JSON.stringify({ success: false, error: "تجاوزت الحد المسموح، انتظر دقيقة." }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 503, body: JSON.stringify({ success: false, error: "مفتاح Claude غير مضبوط في الخادم." }) };
  }

  let messages: Array<{ role: string; content: string }>;
  try {
    const body = JSON.parse(event.body || "{}");
    messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) throw new Error("invalid");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: "messages مطلوب" }) };
  }

  // Keep only last 10 turns to limit token usage
  const trimmed = messages.slice(-10).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: String(m.content).slice(0, 2000),
  }));

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: trimmed,
      }),
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const reply = data?.content?.[0]?.text ?? "";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, reply }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: e.message || "خطأ في الخادم" }),
    };
  }
};
