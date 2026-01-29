"use client";

import Link from "next/link";

const cards = [
  {
    title: "Manual Calculator",
    description:
      "Evaluate one vessel + one cargo with detailed costs, revenue, and laycan feasibility.",
    href: "/manual",
    cta: "Go to Manual Calculator",
  },
  {
    title: "Chat Assistant",
    description:
      "Explain results and concepts like TCE, laycan, bunker costs, and assumptions.",
    href: "/chat",
    cta: "Open Chat Assistant",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-wide text-neutral-500">SlashOps</p>
        <h1 className="text-3xl font-semibold">Voyage P&amp;L &amp; Feasibility Prototype</h1>
        <p className="text-sm text-neutral-600">
          A decision-support tool for single-voyage profitability analysis in dry bulk shipping.
          It mirrors chartering workflows with transparent assumptions, not black-box optimization.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
        <div className="text-sm font-semibold text-neutral-800">What this tool does</div>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Estimate voyage profit and TCE for one vessel carrying one cargo.</li>
          <li>Evaluate laycan feasibility from vessel availability and sailing time.</li>
          <li>Derive distances from a port distance table with fallback assumptions.</li>
          <li>Let users adjust bunker prices and departure dates.</li>
          <li>Separate feasibility (can it be done) from profitability (is it worth it).</li>
        </ul>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-neutral-400 hover:shadow-md"
          >
            <div className="text-base font-semibold">{card.title}</div>
            <div className="mt-2 text-sm text-neutral-600">{card.description}</div>
            <div className="mt-4 text-xs font-semibold text-neutral-500">{card.cta}</div>
          </Link>
        ))}
      </section>
    </main>
  );
}
