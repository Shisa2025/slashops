import { NextResponse } from "next/server";

const extractReply = (data: any) => {
  if (data?.choices?.[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }
  const outputText = data?.output?.[0]?.content?.[0]?.text;
  return typeof outputText === "string" ? outputText : "";
};

export async function POST(req: Request) {
  const missingEnv = [
    "BEDROCK_BASE_URL",
    "BEDROCK_OPENAI_API_KEY",
    "BEDROCK_TEAM_API_KEY",
    "BEDROCK_MODEL",
  ].filter((key) => !process.env[key]);

  if (missingEnv.length > 0) {
    return NextResponse.json(
      { error: `Missing env: ${missingEnv.join(", ")}` },
      { status: 500 }
    );
  }

  const baseURL = process.env.BEDROCK_BASE_URL ?? "";
  if (!/^https?:\/\/.+/i.test(baseURL)) {
    return NextResponse.json(
      { error: "Invalid BEDROCK_BASE_URL (must start with http/https)" },
      { status: 500 }
    );
  }

  try {
    const { message } = await req.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const endpoint = new URL("chat/completions", baseURL.endsWith("/") ? baseURL : `${baseURL}/`);
    const upstream = await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.BEDROCK_OPENAI_API_KEY!}`,
        "x-api-key": process.env.BEDROCK_TEAM_API_KEY!,
      },
      body: JSON.stringify({
        model: process.env.BEDROCK_MODEL!,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: message },
        ],
      }),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      console.error("Upstream /chat/completions failed:", upstream.status, text);
      return NextResponse.json(
        { error: `Upstream error (${upstream.status})`, details: text },
        { status: 500 }
      );
    }

    const data = text ? JSON.parse(text) : {};
    return NextResponse.json({ reply: extractReply(data) });
  } catch (err: any) {
    console.error("POST /api/chat failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error", hint: "Check server logs for details." },
      { status: 500 }
    );
  }
}
