import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

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

    const readTextFile = async (filePath: string, maxChars: number) => {
      const content = await fs.readFile(filePath, "utf8");
      if (content.length <= maxChars) return content;
      return `${content.slice(0, maxChars)}\n... (truncated)`;
    };

    const readDirectoryFiles = async (
      baseDir: string,
      extensions: string[],
      maxCharsPerFile: number,
      maxFiles: number,
    ) => {
      const results: Array<{ path: string; content: string }> = [];
      const queue: string[] = [baseDir];
      const allowed = new Set(extensions.map((ext) => ext.toLowerCase()));

      while (queue.length > 0 && results.length < maxFiles) {
        const current = queue.shift();
        if (!current) continue;
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= maxFiles) break;
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            queue.push(fullPath);
            continue;
          }
          const ext = path.extname(entry.name).toLowerCase();
          if (!allowed.has(ext)) continue;
          const content = await readTextFile(fullPath, maxCharsPerFile);
          const relative = path.relative(process.cwd(), fullPath);
          results.push({ path: relative, content });
        }
      }

      return results;
    };

    const safeRead = async <T,>(label: string, fn: () => Promise<T>, fallback: T) => {
      try {
        return await fn();
      } catch (err) {
        console.error(`Failed to read ${label}:`, err);
        return fallback;
      }
    };

    const knowledgeDir = path.join(process.cwd(), "knowledge");
    const publicDir = path.join(process.cwd(), "public");
    const calculatorDir = path.join(process.cwd(), "src", "calculator");

    const knowledgeFiles = await safeRead(
      "knowledge",
      () => readDirectoryFiles(knowledgeDir, [".md", ".txt"], 12000, 20),
      [],
    );
    const publicFiles = await safeRead(
      "public",
      () => readDirectoryFiles(publicDir, [".md", ".txt", ".csv"], 12000, 40),
      [],
    );
    const calculatorFiles = await safeRead(
      "calculator",
      () => readDirectoryFiles(calculatorDir, [".ts"], 12000, 20),
      [],
    );

    const buildContextBlock = (title: string, files: Array<{ path: string; content: string }>) => {
      if (!files.length) return `${title}: (none)\n`;
      return [
        `${title}:`,
        ...files.map(
          (file) =>
            `---\n[${file.path}]\n${file.content.trim()}\n`,
        ),
      ].join("\n");
    };

    const systemContent = [
      "You are a helpful assistant for the SlashOps prototype.",
      "Use the provided knowledge and data to answer user questions.",
      "If data is missing or truncated, say so clearly.",
      "",
      buildContextBlock("KNOWLEDGE", knowledgeFiles),
      buildContextBlock("PUBLIC_DATA", publicFiles),
      buildContextBlock("CALCULATOR_CODE", calculatorFiles),
    ].join("\n");
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
          { role: "system", content: systemContent },
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
