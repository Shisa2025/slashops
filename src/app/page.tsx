"use client";

import Link from "next/link";

const cards = [
  {
    title: "Manual Calculation",
    description: "Select vessels and cargos from CSV with detailed breakdowns.",
    href: "/manual",
  },
  {
    title: "Demo Calculation",
    description: "Preset vessel/cargo demo with recommendations and summary.",
    href: "/democalculation1",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Calculations</h1>
        <p className="text-sm text-neutral-600">
          Choose a mode to start your freight and voyage calculations.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-neutral-200 p-4 transition hover:border-neutral-400"
          >
            <div className="text-base font-semibold">{card.title}</div>
            <div className="mt-2 text-sm text-neutral-600">{card.description}</div>
          </Link>
        ))}
      </section>
    </main>
  );
}
