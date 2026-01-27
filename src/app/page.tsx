"use client";

import Link from "next/link";

const cards = [
  {
    title: "AI Chatbot",
    description: "Ask operational questions and get instant assistance.",
    href: "/chat",
  },
  {
    title: "Manual Calculation",
    description: "Select vessels and cargos from CSV with detailed breakdowns.",
    href: "/manual",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-wide text-neutral-500">SlashOps</p>
        <h1 className="text-3xl font-semibold">Operations Toolkit</h1>
        <p className="text-sm text-neutral-600">
          Start a calculation or open the assistant to support your daily workflow.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-neutral-400 hover:shadow-md"
          >
            <div className="text-base font-semibold">{card.title}</div>
            <div className="mt-2 text-sm text-neutral-600">{card.description}</div>
            <div className="mt-4 text-xs font-semibold text-neutral-500">Open</div>
          </Link>
        ))}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Tip: Keep API keys in <code className="rounded bg-white px-1 py-0.5">.env.local</code> and
        avoid sharing them in chat or email.
      </section>
    </main>
  );
}
