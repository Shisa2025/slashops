"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateFreight, exampleInputs, type FreightInputs } from "../../calculator/freightCalculator";

type CsvRow = Record<string, string>;

type VesselOption = {
  id: string;
  name: string;
  source: "capesize" | "market";
  currentPort: string;
  raw: CsvRow;
  data: FreightInputs["vessel"];
};

type CargoOption = {
  id: string;
  name: string;
  source: "committed" | "market";
  raw: CsvRow;
  data: FreightInputs["cargo"];
  loadPort: string;
  dischargePort: string;
  portCosts: { load: number; discharge: number };
};

const formatMoney = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const formatNumber = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

const parseCsv = (text: string): CsvRow[] => {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      current = "";
      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((cell) => cell.trim().length > 0)) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    const record: CsvRow = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });
};

const fetchCsv = async (path: string) => {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (HTTP ${response.status})`);
  }
  return response.text();
};

const toNumber = (value: string | undefined | null, fallback = 0) => {
  if (!value) return fallback;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseFirstNumber = (value: string | undefined | null, fallback = 0) => {
  if (!value) return fallback;
  const match = value.match(/[\d,.]+/);
  return match ? toNumber(match[0], fallback) : fallback;
};

const parsePercent = (value: string | undefined | null, fallback = 0) => {
  if (!value) return fallback;
  const match = value.match(/[\d.]+/);
  if (!match) return fallback;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed / 100 : fallback;
};

const parseTurnTimeDays = (value: string | undefined | null, fallback = 0) => {
  if (!value) return fallback;
  const match = value.match(/([\d.]+)\s*hr/i);
  if (!match) return fallback;
  const hours = Number.parseFloat(match[1]);
  if (!Number.isFinite(hours)) return fallback;
  return hours / 24;
};

const parseRateFromTerms = (value: string | undefined | null, fallback = 0) => {
  if (!value) return fallback;
  const match = value.match(/([\d,.]+)\s*MT/i);
  if (!match) return fallback;
  return toNumber(match[1], fallback);
};

const parsePortCosts = (
  value: string | undefined | null,
  fallbackLoad: number,
  fallbackDischarge: number,
) => {
  if (!value) {
    return { load: fallbackLoad, discharge: fallbackDischarge };
  }
  const amounts = Array.from(value.matchAll(/([\d.]+)\s*([KM])?/gi)).map((match) => {
    const base = Number.parseFloat(match[1]);
    if (!Number.isFinite(base)) return 0;
    const multiplier = match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2]?.toUpperCase() === "K" ? 1_000 : 1;
    return base * multiplier;
  });

  if (amounts.length === 0) {
    return { load: fallbackLoad, discharge: fallbackDischarge };
  }

  const lower = value.toLowerCase();
  if (amounts.length >= 2 && lower.includes("load") && lower.includes("discharge")) {
    return { load: amounts[0], discharge: amounts[1] };
  }

  if (lower.includes("total")) {
    const total = amounts[0];
    return { load: total / 2, discharge: total / 2 };
  }

  if (amounts.length === 1) {
    return { load: amounts[0], discharge: fallbackDischarge };
  }

  return { load: amounts[0], discharge: amounts[1] ?? fallbackDischarge };
};

const normalizePortKey = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();

const simplifyPortLabel = (value: string) => {
  const noParens = value.replace(/\([^)]*\)/g, "");
  const splitDash = noParens.split(/-|–|—/)[0] ?? noParens;
  const splitComma = splitDash.split(",")[0] ?? splitDash;
  return splitComma.trim();
};

const resolvePortName = (value: string, ports: string[]) => {
  if (!value) return "";
  const target = normalizePortKey(value);
  if (!target) return "";
  const byNormalized = new Map(ports.map((port) => [normalizePortKey(port), port]));
  if (byNormalized.has(target)) return byNormalized.get(target) ?? value;

  const simplified = simplifyPortLabel(value);
  const simplifiedKey = normalizePortKey(simplified);
  if (simplifiedKey && byNormalized.has(simplifiedKey)) {
    return byNormalized.get(simplifiedKey) ?? simplified;
  }

  for (const port of ports) {
    const portKey = normalizePortKey(port);
    if (target.includes(portKey) || portKey.includes(target)) {
      return port;
    }
  }

  return value;
};

const extractPortFromStatus = (value: string) => {
  if (!value) return "";
  const match = value.match(/discharging\s+(.+)/i);
  if (!match) return value;
  return match[1].trim();
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

export default function ManualCalculationPage() {
  const [vessels, setVessels] = useState<VesselOption[]>([]);
  const [cargos, setCargos] = useState<CargoOption[]>([]);
  const [ports, setPorts] = useState<string[]>([]);
  const [distanceMap, setDistanceMap] = useState<Record<string, Record<string, number>>>({});
  const [bunkerPrices, setBunkerPrices] = useState({
    ifo: exampleInputs.costs.ifoPrice,
    mdo: exampleInputs.costs.mdoPrice,
  });
  const [portDelayDays, setPortDelayDays] = useState<number>(0);
  const [loadError, setLoadError] = useState<string>("");
  const [voyages, setVoyages] = useState<
    Array<{
      id: string;
      vesselId: string;
      cargoId: string;
      result?: ReturnType<typeof calculateFreight>;
    }>
  >([]);

  useEffect(() => {
    let isMounted = true;
    const loadCsvs = async () => {
      const [capesizeText, marketVesselsText, committedText, marketCargosText, distancesText] =
        await Promise.all([
          fetchCsv("/business_data/vessels/capesize_vessels.csv"),
          fetchCsv("/business_data/vessels/market_vessels.csv"),
          fetchCsv("/business_data/cargos/committed_cargos.csv"),
          fetchCsv("/business_data/cargos/market_cargos.csv"),
          fetchCsv("/business_data/port_data/port_distances.csv"),
        ]);
      return [
        capesizeText,
        marketVesselsText,
        committedText,
        marketCargosText,
        distancesText,
      ] as const;
    };

    loadCsvs()
      .then(([capesizeText, marketVesselsText, committedText, marketCargosText, distancesText]) => {
        if (!isMounted) return;
        setLoadError("");
        const parsedDistances = parseDistanceCsv(distancesText);
        setDistanceMap(parsedDistances.distanceMap);
        setPorts(parsedDistances.ports);

        const capesizeRows = parseCsv(capesizeText);
        const marketRows = parseCsv(marketVesselsText);
        const vesselsParsed = [...capesizeRows, ...marketRows].map((row, index) => {
          const source = index < capesizeRows.length ? "capesize" : "market";
          const name = row.vessel_name || `Vessel ${index + 1}`;
          const dwt = toNumber(row.dwt_mt, exampleInputs.vessel.dwt);
          const ecoLaden = toNumber(row.economical_speed_laden_kn, exampleInputs.vessel.speed.laden);
          const ecoBallast = toNumber(row.economical_speed_ballast_kn, exampleInputs.vessel.speed.ballast);
          const ecoLadenVlsfo = toNumber(row.economical_speed_laden_vlsfo_mt, exampleInputs.vessel.consumption.laden.ifo);
          const ecoBallastVlsfo = toNumber(
            row.economical_speed_ballast_vlsfo_mt,
            exampleInputs.vessel.consumption.ballast.ifo,
          );
          const ecoLadenMgo = toNumber(row.economical_speed_laden_mgo_mt, exampleInputs.vessel.consumption.laden.mdo);
          const ecoBallastMgo = toNumber(
            row.economical_speed_ballast_mgo_mt,
            exampleInputs.vessel.consumption.ballast.mdo,
          );

          const portIdle = toNumber(
            row.port_consumption_idle_vlsfo_mt_day,
            exampleInputs.vessel.portConsumption.idle.ifo,
          );
          const portWorking = toNumber(
            row.port_consumption_working_vlsfo_mt_day,
            exampleInputs.vessel.portConsumption.working.ifo,
          );

          const currentPortRaw = extractPortFromStatus(row.position_status ?? "");
          const currentPort = resolvePortName(currentPortRaw, parsedDistances.ports);

          return {
            id: `${source}-${index}`,
            name,
            source,
            currentPort: currentPort || currentPortRaw || "UNKNOWN",
            raw: row,
            data: {
              dwt,
              grainCapacity: Math.max(dwt, exampleInputs.vessel.grainCapacity),
              speed: { ballast: ecoBallast, laden: ecoLaden },
              consumption: {
                ballast: { ifo: ecoBallastVlsfo, mdo: ecoBallastMgo },
                laden: { ifo: ecoLadenVlsfo, mdo: ecoLadenMgo },
              },
              portConsumption: {
                working: { ifo: portWorking, mdo: exampleInputs.vessel.portConsumption.working.mdo },
                idle: { ifo: portIdle, mdo: exampleInputs.vessel.portConsumption.idle.mdo },
              },
              dailyHire: toNumber(row.hire_rate_usd_day, exampleInputs.vessel.dailyHire),
              adComsPct: exampleInputs.vessel.adComsPct,
            },
          } satisfies VesselOption;
        });
        setVessels(vesselsParsed);

        const committedRows = parseCsv(committedText);
        const marketCargoRows = parseCsv(marketCargosText);
        const baseCosts = exampleInputs.costs;
        const cargosParsed = [...committedRows, ...marketCargoRows].map((row, index) => {
          const source = index < committedRows.length ? "committed" : "market";
          const name = row.route || row.customer || `Cargo ${index + 1}`;
          const qty = parseFirstNumber(row.quantity, exampleInputs.cargo.cargoQty);
          const freightRate = toNumber(row.freight_rate ?? "", exampleInputs.cargo.freightRate);
          const loadRate = parseRateFromTerms(row.loading_terms ?? "", exampleInputs.cargo.loadRate);
          const dischargeRate = parseRateFromTerms(row.discharge_terms ?? "", exampleInputs.cargo.dischargeRate);
          const loadportTT = parseTurnTimeDays(row.loading_terms ?? "", exampleInputs.cargo.loadportTT);
          const disportTT = parseTurnTimeDays(row.discharge_terms ?? "", exampleInputs.cargo.disportTT);
          const commissionPct = parsePercent(row.commission ?? "", 0);
          const commissionIsBroker = (row.commission ?? "").toLowerCase().includes("broker");
          const loadPortRaw = row.load_port ?? "";
          const dischargePortRaw = row.discharge_port ?? "";
          const loadPort = resolvePortName(loadPortRaw, parsedDistances.ports);
          const dischargePort = resolvePortName(dischargePortRaw, parsedDistances.ports);
          const portCosts = parsePortCosts(row.port_cost ?? "", baseCosts.portDisbLoad, baseCosts.portDisbDis);

          return {
            id: `${source}-${index}`,
            name,
            source,
            raw: row,
            loadPort: loadPort || loadPortRaw || "UNKNOWN",
            dischargePort: dischargePort || dischargePortRaw || "UNKNOWN",
            portCosts,
            data: {
              ...exampleInputs.cargo,
              cargoQty: qty,
              freightRate,
              loadRate,
              dischargeRate,
              loadportTT,
              disportTT,
              portIdleDays: exampleInputs.cargo.portIdleDays,
              addressComsPct: commissionIsBroker ? 0 : commissionPct,
              brokerComsPct: commissionIsBroker ? commissionPct : 0,
            },
          } satisfies CargoOption;
        });
        setCargos(cargosParsed);
        setVoyages((prev) => {
          if (prev.length > 0) return prev;
          if (!vesselsParsed[0] || !cargosParsed[0]) return prev;
          return [
            {
              id: `voyage-1`,
              vesselId: vesselsParsed[0].id,
              cargoId: cargosParsed[0].id,
            },
          ];
        });
      })
      .catch((error) => {
        if (!isMounted) return;
        setVessels([]);
        setCargos([]);
        setPorts([]);
        setDistanceMap({});
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load CSV data. Check file locations under public/.";
        setLoadError(message);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const getVoyageInputs = (voyage: { vesselId: string; cargoId: string }) => {
    const vessel = vessels.find((item) => item.id === voyage.vesselId);
    const cargo = cargos.find((item) => item.id === voyage.cargoId);
    if (!vessel || !cargo) return undefined;
    const ballastNm = getDistance(distanceMap, vessel.currentPort, cargo.loadPort);
    const ladenNm = getDistance(distanceMap, cargo.loadPort, cargo.dischargePort);
    const cargoData: FreightInputs["cargo"] = {
      ...cargo.data,
      portIdleDays: cargo.data.portIdleDays + portDelayDays,
    };
    return {
      vessel: vessel.data,
      cargo: cargoData,
      distances: { ballastNm, ladenNm },
      costs: {
        ...exampleInputs.costs,
        ifoPrice: bunkerPrices.ifo,
        mdoPrice: bunkerPrices.mdo,
        portDisbLoad: cargo.portCosts.load,
        portDisbDis: cargo.portCosts.discharge,
      },
      options: { bunkerDays: exampleInputs.options.bunkerDays },
    } satisfies FreightInputs;
  };

  const calculateVoyage = (voyageId: string) => {
    setVoyages((prev) =>
      prev.map((voyage) => {
        if (voyage.id !== voyageId) return voyage;
        const inputs = getVoyageInputs(voyage);
        if (!inputs) return voyage;
        const result = calculateFreight(inputs);
        return { ...voyage, result };
      }),
    );
  };

  const totalProfit = useMemo(
    () => voyages.reduce((sum, voyage) => sum + (voyage.result?.profit ?? 0), 0),
    [voyages],
  );

  const addVoyage = () => {
    if (!vessels[0] || !cargos[0]) return;
    setVoyages((prev) => [
      ...prev,
      {
        id: `voyage-${prev.length + 1}`,
        vesselId: vessels[0].id,
        cargoId: cargos[0].id,
      },
    ]);
  };

  const updateVoyage = (voyageId: string, updates: Partial<{ vesselId: string; cargoId: string }>) => {
    setVoyages((prev) =>
      prev.map((voyage) =>
        voyage.id === voyageId ? { ...voyage, ...updates, result: undefined } : voyage,
      ),
    );
  };

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Manual Calculation</h1>
        <p className="text-sm text-neutral-600">
          Build voyages from CSV, then calculate each leg and total portfolio P&L.
        </p>
      </header>

      <section className="grid gap-6 rounded-lg border border-neutral-200 p-4 md:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-base font-semibold">Voyage List</h2>
            {loadError ? (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {loadError}
              </div>
            ) : null}
            <button
              type="button"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm font-semibold hover:border-neutral-400"
              onClick={addVoyage}
            >
              + Add Voyage
            </button>
          </div>

          <div className="space-y-4">
            {voyages.map((voyage, index) => {
              const vessel = vessels.find((item) => item.id === voyage.vesselId);
              const cargo = cargos.find((item) => item.id === voyage.cargoId);
              const routeLabel = cargo ? `${cargo.loadPort} -> ${cargo.dischargePort}` : "--";
              return (
                <div key={voyage.id} className="rounded border border-neutral-200 p-3 text-sm">
                  <div className="text-xs font-semibold text-neutral-500">
                    Voyage {index + 1}
                  </div>
                  <label className="mt-2 block text-sm">
                    <span className="text-neutral-500">Vessel</span>
                    <select
                      className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                      value={voyage.vesselId}
                      onChange={(event) => updateVoyage(voyage.id, { vesselId: event.target.value })}
                    >
                      {vessels.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name} ({option.source})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-2 block text-sm">
                    <span className="text-neutral-500">Cargo</span>
                    <select
                      className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                      value={voyage.cargoId}
                      onChange={(event) => updateVoyage(voyage.id, { cargoId: event.target.value })}
                    >
                      {cargos.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name} ({option.source})
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-2 text-xs text-neutral-600">
                    Route: {routeLabel}
                  </div>
                  <div className="mt-2 text-xs text-neutral-600">
                    Ballast start: {vessel?.currentPort ?? "--"}
                  </div>
                  <button
                    type="button"
                    className="mt-3 w-full rounded border border-neutral-300 px-3 py-2 text-xs font-semibold hover:border-neutral-400"
                    onClick={() => calculateVoyage(voyage.id)}
                    disabled={!vessel || !cargo}
                  >
                    Calculate
                  </button>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-neutral-700">Market Inputs</h3>
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
              <span className="text-neutral-500">Port Delay (days)</span>
              <select
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                value={portDelayDays}
                onChange={(event) => setPortDelayDays(Number(event.target.value))}
              >
                {[0, 1, 2].map((value) => (
                  <option key={value} value={value}>
                    {value} days
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-neutral-200 p-4 text-sm">
            <h2 className="text-lg font-semibold">Portfolio Summary</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="text-neutral-500">Total Voyages</div>
              <div>{voyages.length}</div>
              <div className="text-neutral-500">Total Profit</div>
              <div>{formatMoney(totalProfit)}</div>
            </div>
          </section>

          {voyages.map((voyage, index) => {
            const vessel = vessels.find((item) => item.id === voyage.vesselId);
            const cargo = cargos.find((item) => item.id === voyage.cargoId);
            const inputs = voyage.result ? getVoyageInputs(voyage) : undefined;
            const result = voyage.result;
            const ballastNm =
              vessel && cargo
                ? getDistance(distanceMap, vessel.currentPort, cargo.loadPort)
                : defaultDistanceNm;
            const ladenNm =
              cargo ? getDistance(distanceMap, cargo.loadPort, cargo.dischargePort) : defaultDistanceNm;
            return (
              <section key={voyage.id} className="rounded-lg border border-neutral-200 p-4 text-sm">
                <h2 className="text-lg font-semibold">
                  Voyage {index + 1}: {vessel?.name ?? "--"} → {cargo?.name ?? "--"}
                </h2>
                {!result ? (
                  <div className="mt-3 text-xs text-neutral-500">
                    Click Calculate to generate results.
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-neutral-500">Route</div>
                      <div>
                        {cargo?.loadPort ?? "--"} → {cargo?.dischargePort ?? "--"}
                      </div>
                      <div className="text-neutral-500">Ballast Start</div>
                      <div>{vessel?.currentPort ?? "--"}</div>
                      <div className="text-neutral-500">Ballast (Start â†’ Load) NM</div>
                      <div>{formatNumber(ballastNm)}</div>
                      <div className="text-neutral-500">Laden (Load â†’ Discharge) NM</div>
                      <div>{formatNumber(ladenNm)}</div>
                      <div className="text-neutral-500">Total NM</div>
                      <div>{formatNumber(ballastNm + ladenNm)}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-neutral-500">Total Duration</div>
                      <div>{formatNumber(result.totalDuration)} days</div>
                      <div className="text-neutral-500">Freight Net</div>
                      <div>{formatMoney(result.freightNet)}</div>
                      <div className="text-neutral-500">Total Expenses</div>
                      <div>{formatMoney(result.totalExpenses)}</div>
                      <div className="text-neutral-500">Profit</div>
                      <div>{formatMoney(result.profit)}</div>
                      <div className="text-neutral-500">TCE</div>
                      <div>{formatMoney(result.tce)}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-neutral-500">Hire (Net)</div>
                      <div>{formatMoney(result.hireNet)}</div>
                      <div className="text-neutral-500">Bunker Expense</div>
                      <div>{formatMoney(result.bunkerExpense)}</div>
                      <div className="text-neutral-500">Port Disbursements</div>
                      <div>{formatMoney(result.portDisbursements)}</div>
                      <div className="text-neutral-500">Operating Expenses</div>
                      <div>{formatMoney(result.operatingExpenses)}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-neutral-500">Loaded Qty</div>
                      <div>{formatNumber(result.loadedQty)} MT</div>
                      <div className="text-neutral-500">Load Rate</div>
                      <div>{formatNumber(inputs?.cargo.loadRate ?? 0)} MT/day</div>
                      <div className="text-neutral-500">Discharge Rate</div>
                      <div>{formatNumber(inputs?.cargo.dischargeRate ?? 0)} MT/day</div>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}
