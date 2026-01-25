"use client";

import { useState } from "react";
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
  loadPort: string;
  dischargePort: string;
  data: FreightInputs["cargo"];
};

const ports = [
  "Singapore",
  "Qingdao",
  "Port Hedland",
  "Dampier",
  "Tubarao",
  "Rotterdam",
  "Fujairah",
];

const distanceTable: Record<string, Record<string, number>> = {
  Singapore: {
    Qingdao: 2800,
    "Port Hedland": 2450,
    Dampier: 2100,
    Tubarao: 9300,
    Rotterdam: 8400,
    Fujairah: 330,
  },
  Qingdao: {
    "Port Hedland": 3200,
    Dampier: 2900,
    Tubarao: 10800,
    Rotterdam: 10000,
    Fujairah: 4700,
  },
  "Port Hedland": {
    Dampier: 380,
    Tubarao: 10900,
    Rotterdam: 9400,
    Fujairah: 5400,
  },
  Dampier: {
    Tubarao: 11100,
    Rotterdam: 9600,
    Fujairah: 5600,
  },
  Tubarao: {
    Rotterdam: 4400,
    Fujairah: 8400,
  },
  Rotterdam: {
    Fujairah: 6200,
  },
};

const defaultDistanceNm = 3000;

const getDistance = (from: string, to: string) => {
  if (from === to) return 0;
  return (
    distanceTable[from]?.[to] ??
    distanceTable[to]?.[from] ??
    defaultDistanceNm
  );
};

const vessels: VesselPreset[] = [
  {
    id: "vessel-a",
    name: "Vessel A",
    currentPort: "Singapore",
    data: exampleInputs.vessel,
  },
  {
    id: "vessel-b",
    name: "Vessel B",
    currentPort: "Qingdao",
    data: {
      ...exampleInputs.vessel,
      speed: { ballast: 14.5, laden: 12.5 },
      dailyHire: 12500,
    },
  },
  {
    id: "vessel-c",
    name: "Vessel C",
    currentPort: "Dampier",
    data: {
      ...exampleInputs.vessel,
      speed: { ballast: 13.5, laden: 11.8 },
      dailyHire: 11800,
    },
  },
  {
    id: "vessel-d",
    name: "Vessel D",
    currentPort: "Tubarao",
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
    loadPort: "Port Hedland",
    dischargePort: "Qingdao",
    data: {
      ...exampleInputs.cargo,
      cargoQty: 165000,
      freightRate: 8.5,
    },
  },
  {
    id: "cargo-2",
    name: "Cargo 2 (Committed)",
    loadPort: "Tubarao",
    dischargePort: "Rotterdam",
    data: {
      ...exampleInputs.cargo,
      cargoQty: 170000,
      freightRate: 10.25,
    },
  },
  {
    id: "cargo-3",
    name: "Cargo 3 (Committed)",
    loadPort: "Dampier",
    dischargePort: "Qingdao",
    data: {
      ...exampleInputs.cargo,
      cargoQty: 150000,
      freightRate: 8.1,
    },
  },
  {
    id: "cargo-x",
    name: "Market Cargo X",
    loadPort: "Qingdao",
    dischargePort: "Singapore",
    data: {
      ...exampleInputs.cargo,
      cargoQty: 90000,
      freightRate: 12,
    },
  },
];

const baseCosts = exampleInputs.costs;

export default function Home() {
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [selectedVesselId, setSelectedVesselId] = useState(vessels[0].id);
  const [selectedCargoId, setSelectedCargoId] = useState(cargos[0].id);
  const [bunkerPrices, setBunkerPrices] = useState({
    ifo: baseCosts.ifoPrice,
    mdo: baseCosts.mdoPrice,
  });
  const [bunkerDays, setBunkerDays] = useState(exampleInputs.options.bunkerDays);
  const [customCargo, setCustomCargo] = useState({
    loadPort: ports[0],
    dischargePort: ports[1],
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

  const selectedVessel = vessels.find((v) => v.id === selectedVesselId) ?? vessels[0];
  const selectedCargoPreset = cargos.find((c) => c.id === selectedCargoId) ?? cargos[0];

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
  const ballastNm = getDistance(selectedVessel.currentPort, loadPort);
  const ladenNm = getDistance(loadPort, dischargePort);

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

  const recommendations = vessels.flatMap((vessel) =>
    cargos.map((cargo) => {
      const comboInputs: FreightInputs = {
        vessel: vessel.data,
        cargo: cargo.data,
        distances: {
          ballastNm: getDistance(vessel.currentPort, cargo.loadPort),
          ladenNm: getDistance(cargo.loadPort, cargo.dischargePort),
        },
        costs: {
          ...baseCosts,
          ifoPrice: bunkerPrices.ifo,
          mdoPrice: bunkerPrices.mdo,
        },
        options: { bunkerDays },
      };
      const comboResult = calculateFreight(comboInputs);
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
                  {ports.map((port) => (
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
                  {ports.map((port) => (
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
          <div className="text-neutral-500">Profit</div>
          <div>{formatMoney(result.profit)}</div>
          <div className="text-neutral-500">TCE</div>
          <div>{formatMoney(result.tce)}</div>
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
