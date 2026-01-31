"use client";

import { useState } from "react";
import Link from "next/link";
import { exampleInputs } from "@/calculator/freightCalculator";

type RecommendationData = {
  summary: {
    totalAdjustedProfit: number;
    vesselCount: number;
    cargoCount: number;
  };
  inputs: {
    ifoPrice: number;
    mdoPrice: number;
    portDelayDays: number;
    marketHireRate: number;
  };
  search: {
    totalVessels: number;
    vesselPick: number;
    combos: number;
    assignmentsTested: number;
    freightCalcs: number;
  };
  selectedVessels: Array<{
    name: string;
    source: "capesize" | "market";
    label: string;
    assumedHireRate: number | null;
    charteredIn: boolean;
  }>;
  assignments: Array<{
    index: number;
    vesselName: string;
    vesselLabel: string;
    charteredIn: boolean;
    assumedHireRate: number | null;
    cargoName: string;
    cargoSource: "committed" | "market";
    route: string;
    cargoQty: number;
    tce: number;
    profit: number;
    waitingCost: number;
    adjustedProfit: number;
    laycanLabel: string;
    laycanStatus: string;
    waitingDays: number;
    speedBlend: { ballast: number; laden: number };
    distances: {
      ballastNm: number;
      ladenNm: number;
      ballastFallback: boolean;
      ladenFallback: boolean;
    };
  }>;
  decision: {
    unassigned: string[];
  };
  notes: {
    distanceFallbackNm: number;
    hireNote: string;
    riskNote: string;
  };
};

const formatMoney = (value: number) =>
  (Number.isFinite(value) ? value : 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const formatNumber = (value: number) =>
  (Number.isFinite(value) ? value : 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });

export default function Recommendation3Plus4Page() {
  const [bunkerPrices, setBunkerPrices] = useState({
    ifo: exampleInputs.costs.ifoPrice,
    mdo: exampleInputs.costs.mdoPrice,
  });
  const [portDelayDays, setPortDelayDays] = useState(0);
  const [marketHireRate, setMarketHireRate] = useState(exampleInputs.vessel.dailyHire);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [data, setData] = useState<RecommendationData | null>(null);

  const getRecommendation = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    setReply("");
    setData(null);
    try {
      const response = await fetch("/api/recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bunkerPrices,
          portDelayDays,
          marketHireRate,
          vesselCount: 4,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Request failed (${response.status})`);
      }
      const payload = (await response.json()) as {
        reply?: string;
        data?: RecommendationData;
      };
      setReply(payload?.reply?.trim() || "No response.");
      setData(payload?.data ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">SlashOps</p>
            <h1 className="text-2xl font-semibold">Recommendation (3+4)</h1>
          </div>
          <Link
            href="/"
            className="rounded border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-neutral-400"
          >
            Back to Home
          </Link>
        </div>
        <p className="text-sm text-neutral-600">
          This page is reserved for the Recommendation (3+4) workflow.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        <div className="text-sm font-semibold text-neutral-800">Global Inputs</div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-xs text-neutral-500">
            <span className="block">IFO Price ($/MT)</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
              type="number"
              value={bunkerPrices.ifo}
              onChange={(event) =>
                setBunkerPrices((prev) => ({
                  ...prev,
                  ifo: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="text-xs text-neutral-500">
            <span className="block">MDO Price ($/MT)</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
              type="number"
              value={bunkerPrices.mdo}
              onChange={(event) =>
                setBunkerPrices((prev) => ({
                  ...prev,
                  mdo: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="text-xs text-neutral-500">
            <span className="block">Port Delay (days)</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
              type="number"
              min={0}
              step={0.5}
              value={portDelayDays}
              onChange={(event) => setPortDelayDays(Number(event.target.value))}
            />
          </label>
          <label className="text-xs text-neutral-500">
            <span className="block">Market Hire Rate ($/day)</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
              type="number"
              min={0}
              step={100}
              value={marketHireRate}
              onChange={(event) => setMarketHireRate(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
            onClick={getRecommendation}
            disabled={loading}
          >
            {loading ? "Calculating..." : "Get Recommendation"}
          </button>
        </div>
        {error ? (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
        <div className="text-sm font-semibold text-neutral-800">What you can do here</div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-600">
          <li>Review Recommendation (3+4) outputs in one place.</li>
          <li>Capture assumptions and rationale behind the suggested plan.</li>
          <li>Share a concise, decision-ready summary with stakeholders.</li>
        </ul>
      </section>

      {data ? (
        <section className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-neutral-800">Recommendation Bill</div>
            <div className="text-xs text-neutral-500">
              Total adjusted profit: {formatMoney(data.summary.totalAdjustedProfit)}
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
              <div className="text-xs font-semibold text-neutral-600">Summary</div>
              <div className="mt-2 space-y-1 text-xs text-neutral-700">
                <div className="flex items-center justify-between">
                  <span>Vessels selected</span>
                  <span>{data.summary.vesselCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Cargos assigned</span>
                  <span>{data.summary.cargoCount}</span>
                </div>
                <div className="flex items-center justify-between font-semibold text-neutral-900">
                  <span>Total adjusted profit</span>
                  <span>{formatMoney(data.summary.totalAdjustedProfit)}</span>
                </div>
              </div>
            </div>
            <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
              <div className="text-xs font-semibold text-neutral-600">Inputs</div>
              <div className="mt-2 space-y-1 text-xs text-neutral-700">
                <div className="flex items-center justify-between">
                  <span>IFO price</span>
                  <span>{formatMoney(data.inputs.ifoPrice)}/MT</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>MDO price</span>
                  <span>{formatMoney(data.inputs.mdoPrice)}/MT</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Port delay</span>
                  <span>+{formatNumber(data.inputs.portDelayDays)} days</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Market hire rate</span>
                  <span>{formatMoney(data.inputs.marketHireRate)}/day</span>
                </div>
              </div>
            </div>
            <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
              <div className="text-xs font-semibold text-neutral-600">Search</div>
              <div className="mt-2 space-y-1 text-xs text-neutral-700">
                <div className="flex items-center justify-between">
                  <span>Vessels scanned</span>
                  <span>{formatNumber(data.search.totalVessels)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Combos</span>
                  <span>{formatNumber(data.search.combos)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Assignments tested</span>
                  <span>{formatNumber(data.search.assignmentsTested)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Freight calcs</span>
                  <span>{formatNumber(data.search.freightCalcs)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="text-xs font-semibold text-neutral-600">Selected vessels</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {data.selectedVessels.map((vessel) => (
                <div
                  key={vessel.name}
                  className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700"
                >
                  <div className="font-semibold text-neutral-900">{vessel.name}</div>
                  <div>{vessel.label}</div>
                  {vessel.charteredIn && vessel.assumedHireRate ? (
                    <div className="text-neutral-500">
                      Assumed hire: {formatMoney(vessel.assumedHireRate)}/day
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <div className="text-xs font-semibold text-neutral-600">Assignments (Line Items)</div>
            <div className="mt-2 overflow-x-auto rounded border border-neutral-200">
              <table className="min-w-full text-xs text-neutral-700">
                <thead className="bg-neutral-50 text-[11px] uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Vessel</th>
                    <th className="px-3 py-2 text-left">Cargo</th>
                    <th className="px-3 py-2 text-left">Route</th>
                    <th className="px-3 py-2 text-right">Qty (MT)</th>
                    <th className="px-3 py-2 text-right">TCE</th>
                    <th className="px-3 py-2 text-right">Adj Profit</th>
                    <th className="px-3 py-2 text-left">Laycan</th>
                    <th className="px-3 py-2 text-left">Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.assignments.map((item) => (
                    <tr key={`${item.vesselName}-${item.cargoName}`} className="border-t">
                      <td className="px-3 py-2">{item.index}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-neutral-900">
                          {item.vesselName}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {item.vesselLabel}
                          {item.charteredIn && item.assumedHireRate
                            ? ` | ${formatMoney(item.assumedHireRate)}/day`
                            : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{item.cargoName}</div>
                        <div className="text-[11px] text-neutral-500">
                          {item.cargoSource}
                        </div>
                      </td>
                      <td className="px-3 py-2">{item.route}</td>
                      <td className="px-3 py-2 text-right">
                        {formatNumber(item.cargoQty)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatMoney(item.tce)}/day
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatMoney(item.adjustedProfit)}
                      </td>
                      <td className="px-3 py-2">
                        <div>{item.laycanLabel}</div>
                        <div className="text-[11px] text-neutral-500">
                          {item.laycanStatus} | wait {formatNumber(item.waitingDays)}d
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className={item.distances.ballastFallback ? "text-amber-600" : ""}>
                          Ballast {formatNumber(item.distances.ballastNm)} nm
                          {item.distances.ballastFallback ? " [FALLBACK]" : ""}
                        </div>
                        <div className={item.distances.ladenFallback ? "text-amber-600" : ""}>
                          Laden {formatNumber(item.distances.ladenNm)} nm
                          {item.distances.ladenFallback ? " [FALLBACK]" : ""}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 rounded border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
            <div className="font-semibold text-neutral-600">Decision</div>
            <div className="mt-2">
              {data.decision.unassigned.length
                ? `Not assigning vessel(s): ${data.decision.unassigned.join(", ")}`
                : "Not assigning vessel(s): NONE"}
            </div>
          </div>

          <div className="mt-4 space-y-1 text-xs text-neutral-600">
            <div>{data.notes.hireNote}</div>
            <div>{data.notes.riskNote}</div>
          </div>
        </section>
      ) : reply ? (
        <section className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
          <div className="text-sm font-semibold text-neutral-800">Recommendation Output</div>
          <pre className="mt-3 whitespace-pre-wrap text-xs text-neutral-700">
            {reply}
          </pre>
        </section>
      ) : null}
    </main>
  );
}
