"use client";

import { useState } from "react";
import Link from "next/link";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || loading) return;
    setError("");
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content }]);
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Request failed (${response.status})`);
      }

      const data = (await response.json()) as { reply?: string };
      const reply = data?.reply?.trim() || "No response.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err: any) {
      setError(err?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const resetChat = () => {
    if (loading) return;
    setMessages([]);
    setError("");
    setInput("");
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">SlashOps Assistant</p>
            <h1 className="text-2xl font-semibold">Chatbot</h1>
          </div>
          <Link
            href="/"
            className="rounded border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-neutral-400"
          >
            Back to Home
          </Link>
        </div>
        <p className="text-sm text-neutral-600">
          Ask operational questions, generate summaries, or draft actions. The assistant replies using
          the Bedrock proxy.
        </p>
      </header>

      <section className="flex flex-1 flex-col gap-4 rounded-lg border border-neutral-200 bg-white/60 p-4">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>Conversation</span>
          <button
            type="button"
            onClick={resetChat}
            className="rounded border border-neutral-300 px-2 py-1 font-semibold text-neutral-700 hover:border-neutral-400"
          >
            Clear
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded border border-neutral-200 bg-neutral-50 p-4 text-sm">
          {messages.length === 0 ? (
            <div className="text-neutral-500">
              Start the conversation by sending a message.
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[80%] rounded-lg bg-neutral-900 px-4 py-3 text-white"
                    : "mr-auto max-w-[80%] rounded-lg border border-neutral-200 bg-white px-4 py-3 text-neutral-900"
                }
              >
                <div className="text-[11px] uppercase tracking-wide text-neutral-400">
                  {message.role === "user" ? "You" : "Assistant"}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{message.content}</div>
              </div>
            ))
          )}
          {loading ? (
            <div className="mr-auto max-w-[80%] rounded-lg border border-neutral-200 bg-white px-4 py-3 text-neutral-500">
              Thinking...
            </div>
          ) : null}
        </div>

        <form onSubmit={sendMessage} className="flex flex-col gap-2">
          <textarea
            className="min-h-[96px] w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            placeholder="Type a message..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>{input.trim().length} chars</span>
            <button
              type="submit"
              disabled={loading || input.trim().length === 0}
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
