"use client";

import { useEffect, useState } from "react";
import { calculateFreight, exampleInputs, type FreightInputs } from "../calculator/freightCalculator";

const formatMoney = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const formatNumber = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

type VesselPreset = {
  id: string;
  name: string;
  currentPort: string;
  data: FreightInputs["vessel"];
};

type CargoPreset = {
  id: string;
  name: string;
  kind: "committed" | "market";
  loadPort: string;
  dischargePort: string;
  data: FreightInputs["cargo"];
};

const defaultDistanceNm = 3000;

const parseDistanceCsv = (csvText: string) => {
  const lines = csvText.split(/\r?\n/);
  const distanceMap: Record<string, Record<string, number>> = {};
  const portSet = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const [fromRaw, toRaw, distanceRaw] = line.split(",");
    if (!fromRaw || !toRaw || !distanceRaw) continue;
    const from = fromRaw.trim();
    const to = toRaw.trim();
    const distance = Number.parseFloat(distanceRaw.trim());
    if (!Number.isFinite(distance)) continue;

    portSet.add(from);
    portSet.add(to);

    if (!distanceMap[from]) distanceMap[from] = {};
    if (!distanceMap[to]) distanceMap[to] = {};
    distanceMap[from][to] = distance;
    distanceMap[to][from] = distance;
  }

  return {
    distanceMap,
    ports: Array.from(portSet).sort(),
  };
};

const getDistance = (
  distanceMap: Record<string, Record<string, number>>,
  from: string,
  to: string,
) => {
  if (from === to) return 0;
  return distanceMap[from]?.[to] ?? defaultDistanceNm;
};

const permutePick = <T,>(items: T[], pick: number): T[][] => {
  if (pick === 0) return [[]];
  const results: T[][] = [];
  items.forEach((item, index) => {
    const rest = items.filter((_, i) => i !== index);
    permutePick(rest, pick - 1).forEach((tail) => {
      results.push([item, ...tail]);
    });
  });
  return results;
};

const vessels: VesselPreset[] = [
  {
    id: "vessel-a",
    name: "Vessel A",
    currentPort: "SINGAPORE",
    data: exampleInputs.vessel,
  },
  {
    id: "vessel-b",
    name: "Vessel B",
    currentPort: "QINGDAO",
    data: {
      ...exampleInputs.vessel,
      speed: { ballast: 14.5, laden: 12.5 },
      dailyHire: 12500,
    },
  },
  {
    id: "vessel-c",
    name: "Vessel C",
    currentPort: "DAMPIER",
    data: {
      ...exampleInputs.vessel,
      speed: { ballast: 13.5, laden: 11.8 },
      dailyHire: 11800,
    },
  },
  {
    id: "vessel-d",
    name: "Vessel D",
    currentPort: "TUBARAO",
    data: {
      ...exampleInputs.vessel,
      speed: { ballast: 14.2, laden: 12.2 },
      dailyHire: 12350,
    },
  },
];

const cargos: CargoPreset[] = [
  {
    id: "cargo-1",
    name: "Cargo 1 (Committed)",
    kind: "committed",
    loadPort: "PORT HEDLAND",
    dischargePort: "QINGDAO",
    data: {
      ...exampleInputs.cargo,
      cargoQty: 165000,
      freightRate: 8.5,
    },
  },
  {
    id: "cargo-2",
    name: "Cargo 2 (Committed)",
    kind: "committed",
    loadPort: "TUBARAO",
    dischargePort: "ROTTERDAM",
    data: {
      ...exampleInputs.cargo,
      cargoQty: 170000,
      freightRate: 10.25,
    },
  },
  {
    id: "cargo-3",
    name: "Cargo 3 (Committed)",
    kind: "committed",
    loadPort: "DAMPIER",
    dischargePort: "QINGDAO",
    data: {
      ...exampleInputs.cargo,
      cargoQty: 150000,
      freightRate: 8.1,
    },
  },
  {
    id: "cargo-x",
    name: "Market Cargo X",
    kind: "market",
    loadPort: "QINGDAO",
    dischargePort: "SINGAPORE",
    data: {
      ...exampleInputs.cargo,
      cargoQty: 90000,
      freightRate: 12,
    },
  },
];

const baseCosts = exampleInputs.costs;

export default function Home() {
  const [ports, setPorts] = useState<string[]>([]);
  const [distanceMap, setDistanceMap] = useState<Record<string, Record<string, number>>>({});
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [selectedVesselId, setSelectedVesselId] = useState(vessels[0].id);
  const [selectedCargoId, setSelectedCargoId] = useState(cargos[0].id);
  const [bunkerPrices, setBunkerPrices] = useState({
    ifo: baseCosts.ifoPrice,
    mdo: baseCosts.mdoPrice,
  });
  const [bunkerDays, setBunkerDays] = useState(exampleInputs.options.bunkerDays);
  const [customCargo, setCustomCargo] = useState({
    loadPort: "SINGAPORE",
    dischargePort: "QINGDAO",
    cargoQty: 100000,
    freightRate: 10,
    stowFactor: exampleInputs.cargo.stowFactor,
    loadRate: exampleInputs.cargo.loadRate,
    dischargeRate: exampleInputs.cargo.dischargeRate,
    loadportTT: exampleInputs.cargo.loadportTT,
    disportTT: exampleInputs.cargo.disportTT,
    portIdleDays: exampleInputs.cargo.portIdleDays,
    addressComsPct: exampleInputs.cargo.addressComsPct,
    brokerComsPct: exampleInputs.cargo.brokerComsPct,
    ballastBonus: exampleInputs.cargo.ballastBonus,
  });

  useEffect(() => {
    let isMounted = true;
    fetch("/data/port_distances.csv")
      .then((response) => response.text())
      .then((text) => {
        if (!isMounted) return;
        const parsed = parseDistanceCsv(text);
        setDistanceMap(parsed.distanceMap);
        setPorts(parsed.ports);
      })
      .catch(() => {
        if (!isMounted) return;
        setDistanceMap({});
        setPorts([]);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (ports.length < 2) return;
    setCustomCargo((prev) => ({
      ...prev,
      loadPort: ports.includes(prev.loadPort) ? prev.loadPort : ports[0],
      dischargePort: ports.includes(prev.dischargePort) ? prev.dischargePort : ports[1],
    }));
  }, [ports]);

  const selectedVessel = vessels.find((v) => v.id === selectedVesselId) ?? vessels[0];
  const selectedCargoPreset = cargos.find((c) => c.id === selectedCargoId) ?? cargos[0];
  const portOptions = ports.length > 0 ? ports : ["SINGAPORE", "QINGDAO"];

  const cargoData =
    mode === "preset"
      ? { ...selectedCargoPreset.data, cargoQty: selectedCargoPreset.data.cargoQty }
      : {
          ...exampleInputs.cargo,
          cargoQty: customCargo.cargoQty,
          freightRate: customCargo.freightRate,
          stowFactor: customCargo.stowFactor,
          loadRate: customCargo.loadRate,
          dischargeRate: customCargo.dischargeRate,
          loadportTT: customCargo.loadportTT,
          disportTT: customCargo.disportTT,
          portIdleDays: customCargo.portIdleDays,
          addressComsPct: customCargo.addressComsPct,
          brokerComsPct: customCargo.brokerComsPct,
          ballastBonus: customCargo.ballastBonus,
        };

  const loadPort = mode === "preset" ? selectedCargoPreset.loadPort : customCargo.loadPort;
  const dischargePort =
    mode === "preset" ? selectedCargoPreset.dischargePort : customCargo.dischargePort;
  const ballastNm = getDistance(distanceMap, selectedVessel.currentPort, loadPort);
  const ladenNm = getDistance(distanceMap, loadPort, dischargePort);

  const inputs: FreightInputs = {
    vessel: selectedVessel.data,
    cargo: cargoData,
    distances: { ballastNm, ladenNm },
    costs: {
      ...baseCosts,
      ifoPrice: bunkerPrices.ifo,
      mdoPrice: bunkerPrices.mdo,
    },
    options: { bunkerDays },
  };

  const result = calculateFreight(inputs);

  const computeVoyage = (vessel: VesselPreset, cargo: CargoPreset) => {
    const comboInputs: FreightInputs = {
      vessel: vessel.data,
      cargo: cargo.data,
      distances: {
        ballastNm: getDistance(distanceMap, vessel.currentPort, cargo.loadPort),
        ladenNm: getDistance(distanceMap, cargo.loadPort, cargo.dischargePort),
      },
      costs: {
        ...baseCosts,
        ifoPrice: bunkerPrices.ifo,
        mdoPrice: bunkerPrices.mdo,
      },
      options: { bunkerDays },
    };
    return calculateFreight(comboInputs);
  };

  const recommendations = vessels.flatMap((vessel) =>
    cargos.map((cargo) => {
      const comboResult = computeVoyage(vessel, cargo);
      return {
        vessel: vessel.name,
        cargo: cargo.name,
        profit: comboResult.profit,
        tce: comboResult.tce,
      };
    }),
  );

  const topCombos = [...recommendations]
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);

  const committedCargos = cargos.filter((cargo) => cargo.kind === "committed");
  const marketCargos = cargos.filter((cargo) => cargo.kind === "market");
  const vesselPerms = permutePick(vessels, committedCargos.length);
  const cargoPerms = permutePick(committedCargos, committedCargos.length);

  let bestPortfolioProfit = Number.NEGATIVE_INFINITY;
  let bestPortfolio: Array<{
    vessel: VesselPreset;
    cargo: CargoPreset;
    result: ReturnType<typeof calculateFreight>;
  }> = [];

  vesselPerms.forEach((vesselOrder) => {
    cargoPerms.forEach((cargoOrder) => {
      let totalProfit = 0;
      const assignments: Array<{
        vessel: VesselPreset;
        cargo: CargoPreset;
        result: ReturnType<typeof calculateFreight>;
      }> = [];
      for (let i = 0; i < cargoOrder.length; i += 1) {
        const vessel = vesselOrder[i];
        const cargo = cargoOrder[i];
        const comboResult = computeVoyage(vessel, cargo);
        totalProfit += comboResult.profit;
        assignments.push({ vessel, cargo, result: comboResult });
      }
      if (totalProfit > bestPortfolioProfit) {
        bestPortfolioProfit = totalProfit;
        bestPortfolio = assignments;
      }
    });
  });

  const assignedVessels = new Set(bestPortfolio.map((item) => item.vessel.id));
  const idleVessel = vessels.find((vessel) => !assignedVessels.has(vessel.id));
  const bestMarketForIdle = idleVessel
    ? marketCargos
        .map((cargo) => ({
          cargo,
          result: computeVoyage(idleVessel, cargo),
        }))
        .sort((a, b) => b.result.profit - a.result.profit)[0]
    : undefined;

  const explainabilityDrivers = [
    { label: "Revenue (Net)", value: result.revenueNet },
    { label: "Hire (Net)", value: -result.hireNet },
    { label: "Bunker Expense", value: -result.bunkerExpense },
    { label: "Port Disbursements", value: -result.portDisbursements },
    { label: "Operating Expenses", value: -result.operatingExpenses },
    { label: "Misc Expense", value: -result.miscExpense },
  ]
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 5);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Voyage Recommendation</h1>
        <p className="text-sm text-neutral-600">
          Select a vessel and cargo, set bunker prices, then review the result.
        </p>
      </header>

      <section className="grid gap-6 rounded-lg border border-neutral-200 p-4 md:grid-cols-2">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Step 1: Choose Vessel</h2>
          <label className="text-sm">
            <span className="text-neutral-500">Vessel</span>
            <select
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              value={selectedVesselId}
              onChange={(event) => setSelectedVesselId(event.target.value)}
            >
              {vessels.map((vessel) => (
                <option key={vessel.id} value={vessel.id}>
                  {vessel.name} - {vessel.currentPort}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-neutral-500">
            Speed: {selectedVessel.data.speed.ballast} kn ballast /{" "}
            {selectedVessel.data.speed.laden} kn laden - Hire:{" "}
            {formatMoney(selectedVessel.data.dailyHire)} / day
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Step 2: Choose Cargo</h2>
          <div className="flex gap-2 text-xs">
            <button
              className={`rounded px-3 py-1 ${mode === "preset" ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}
              type="button"
              onClick={() => setMode("preset")}
            >
              Preset
            </button>
            <button
              className={`rounded px-3 py-1 ${mode === "custom" ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}
              type="button"
              onClick={() => setMode("custom")}
            >
              Custom
            </button>
          </div>
          {mode === "preset" ? (
            <label className="text-sm">
              <span className="text-neutral-500">Cargo</span>
              <select
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                value={selectedCargoId}
                onChange={(event) => setSelectedCargoId(event.target.value)}
              >
                {cargos.map((cargo) => (
                  <option key={cargo.id} value={cargo.id}>
                    {cargo.name} - {cargo.loadPort} {"->"} {cargo.dischargePort}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <label>
                <span className="text-neutral-500">Load Port</span>
                <select
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                  value={customCargo.loadPort}
                  onChange={(event) =>
                    setCustomCargo((prev) => ({ ...prev, loadPort: event.target.value }))
                  }
                >
                  {portOptions.map((port) => (
                    <option key={port} value={port}>
                      {port}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-neutral-500">Discharge Port</span>
                <select
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                  value={customCargo.dischargePort}
                  onChange={(event) =>
                    setCustomCargo((prev) => ({
                      ...prev,
                      dischargePort: event.target.value,
                    }))
                  }
                >
                  {portOptions.map((port) => (
                    <option key={port} value={port}>
                      {port}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-neutral-500">Cargo Qty (MT)</span>
                <input
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                  type="number"
                  value={customCargo.cargoQty}
                  onChange={(event) =>
                    setCustomCargo((prev) => ({
                      ...prev,
                      cargoQty: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span className="text-neutral-500">Freight Rate ($/MT)</span>
                <input
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                  type="number"
                  value={customCargo.freightRate}
                  onChange={(event) =>
                    setCustomCargo((prev) => ({
                      ...prev,
                      freightRate: Number(event.target.value),
                    }))
                  }
                />
              </label>
            </div>
          )}
          <div className="text-xs text-neutral-500">
            Route: {loadPort} {"->"} {dischargePort} - Distance: {formatNumber(ladenNm)} nm
          </div>
        </div>
      </section>

      <section className="grid gap-6 rounded-lg border border-neutral-200 p-4 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Step 3: Market Inputs</h2>
          <label className="text-sm">
            <span className="text-neutral-500">IFO Price ($/MT)</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
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
          <label className="text-sm">
            <span className="text-neutral-500">MDO Price ($/MT)</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
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
          <label className="text-sm">
            <span className="text-neutral-500">Bunker Days</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              type="number"
              value={bunkerDays}
              onChange={(event) => setBunkerDays(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="text-xs text-neutral-500">
          Ballast distance from {selectedVessel.currentPort} to {loadPort}:{" "}
          {formatNumber(ballastNm)} nm. If a port pair is missing, the model assumes{" "}
          {defaultDistanceNm} nm.
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Voyage Summary</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="text-neutral-500">Loaded Qty</div>
          <div>{formatNumber(result.loadedQty)} MT</div>
          <div className="text-neutral-500">Total Duration</div>
          <div>{formatNumber(result.totalDuration)} days</div>
          <div className="text-neutral-500">Hire (Net)</div>
          <div>{formatMoney(result.hireNet)}</div>
          <div className="text-neutral-500">Bunker Expense</div>
          <div>{formatMoney(result.bunkerExpense)}</div>
          <div className="text-neutral-500">Revenue (Net)</div>
          <div>{formatMoney(result.revenueNet)}</div>
          <div className="text-neutral-500">Total Expenses</div>
          <div>{formatMoney(result.totalExpenses)}</div>
          <div className="text-neutral-500">Profit</div>
          <div>{formatMoney(result.profit)}</div>
          <div className="text-neutral-500">TCE</div>
          <div>{formatMoney(result.tce)}</div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 p-4 text-sm">
        <h2 className="text-lg font-semibold">Cost & Revenue Breakdown</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="text-neutral-500">Freight Gross</div>
          <div>{formatMoney(result.freightGross)}</div>
          <div className="text-neutral-500">Freight Commissions</div>
          <div>{formatMoney(result.freightCommissions)}</div>
          <div className="text-neutral-500">Freight Net</div>
          <div>{formatMoney(result.freightNet)}</div>
          <div className="text-neutral-500">Hire Gross</div>
          <div>{formatMoney(result.hireGross)}</div>
          <div className="text-neutral-500">Hire Commissions</div>
          <div>{formatMoney(result.hireCommissions)}</div>
          <div className="text-neutral-500">Port Disbursements</div>
          <div>{formatMoney(result.portDisbursements)}</div>
          <div className="text-neutral-500">Operating Expenses</div>
          <div>{formatMoney(result.operatingExpenses)}</div>
          <div className="text-neutral-500">Misc Expense</div>
          <div>{formatMoney(result.miscExpense)}</div>
          <div className="text-neutral-500">Other Expenses Total</div>
          <div>{formatMoney(result.miscExpenseTotal)}</div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 p-4 text-sm">
        <h2 className="text-lg font-semibold">Fuel Consumption</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="text-neutral-500">IFO Total</div>
          <div>{formatNumber(result.totalIfo)} MT</div>
          <div className="text-neutral-500">MDO Total</div>
          <div>{formatNumber(result.totalMdo)} MT</div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 p-4 text-sm">
        <h2 className="text-lg font-semibold">Key Profit Drivers</h2>
        <div className="mt-3 grid gap-2">
          {explainabilityDrivers.map((driver) => (
            <div
              key={driver.label}
              className="flex items-center justify-between rounded border border-neutral-100 px-3 py-2"
            >
              <span>{driver.label}</span>
              <span>{formatMoney(driver.value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 p-4 text-sm">
        <h2 className="text-lg font-semibold">Portfolio Allocation (Committed Cargo)</h2>
        <div className="mt-3 grid gap-2">
          {bestPortfolio.map((assignment) => (
            <div
              key={`${assignment.vessel.id}-${assignment.cargo.id}`}
              className="grid grid-cols-3 gap-3 rounded border border-neutral-100 px-3 py-2"
            >
              <div>{assignment.vessel.name}</div>
              <div>{assignment.cargo.name}</div>
              <div className="text-right">
                {formatMoney(assignment.result.profit)} profit
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-neutral-500">
          Portfolio total profit: {formatMoney(bestPortfolioProfit)}
        </div>
        {idleVessel ? (
          <div className="mt-3 rounded border border-neutral-100 px-3 py-2 text-xs">
            Idle vessel: {idleVessel.name} - Best market option:{" "}
            {bestMarketForIdle?.cargo.name ?? "None"}{" "}
            {bestMarketForIdle
              ? `(${formatMoney(bestMarketForIdle.result.profit)} profit)`
              : ""}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-neutral-200 p-4 text-sm">
        <h2 className="text-lg font-semibold">Top Recommendations</h2>
        <div className="mt-3 grid gap-2">
          {topCombos.map((combo) => (
            <div
              key={`${combo.vessel}-${combo.cargo}`}
              className="grid grid-cols-3 gap-3 rounded border border-neutral-100 px-3 py-2"
            >
              <div>{combo.vessel}</div>
              <div>{combo.cargo}</div>
              <div className="text-right">
                {formatMoney(combo.profit)} profit - {formatMoney(combo.tce)} TCE
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
