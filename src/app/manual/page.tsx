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

const resolvePortName = (value: string, ports: string[]) => {
  if (!value) return "";
  const target = normalizePortKey(value);
  if (!target) return "";
  const byNormalized = new Map(ports.map((port) => [normalizePortKey(port), port]));
  return byNormalized.get(target) ?? value;
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
  const [selectedVesselId, setSelectedVesselId] = useState<string>("");
  const [selectedCargoId, setSelectedCargoId] = useState<string>("");
  const [bunkerPrices, setBunkerPrices] = useState({
    ifo: exampleInputs.costs.ifoPrice,
    mdo: exampleInputs.costs.mdoPrice,
  });
  const [portDelayDays, setPortDelayDays] = useState<number>(0);
  const [dailyHireOverride, setDailyHireOverride] = useState<number | null>(null);
  const [adComsOverride, setAdComsOverride] = useState<number | null>(null);
  const [freightOverride, setFreightOverride] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string>("");

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
        setSelectedVesselId((prev) => prev || vesselsParsed[0]?.id || "");

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
        setSelectedCargoId((prev) => prev || cargosParsed[0]?.id || "");
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

  const selectedVessel = vessels.find((vessel) => vessel.id === selectedVesselId) ?? vessels[0];
  const selectedCargo = cargos.find((cargo) => cargo.id === selectedCargoId) ?? cargos[0];

  const effectiveVessel = useMemo(() => {
    if (!selectedVessel) return undefined;
    return {
      ...selectedVessel.data,
      dailyHire: dailyHireOverride ?? selectedVessel.data.dailyHire,
      adComsPct: adComsOverride ?? selectedVessel.data.adComsPct,
    };
  }, [selectedVessel, dailyHireOverride, adComsOverride]);

  const effectiveCargo = useMemo(() => {
    if (!selectedCargo) return undefined;
    return {
      ...selectedCargo.data,
      freightRate: freightOverride ?? selectedCargo.data.freightRate,
      portIdleDays: selectedCargo.data.portIdleDays + portDelayDays,
    };
  }, [selectedCargo, freightOverride, portDelayDays]);

  const ballastNm =
    selectedVessel && selectedCargo
      ? getDistance(distanceMap, selectedVessel.currentPort, selectedCargo.loadPort)
      : defaultDistanceNm;
  const ladenNm =
    selectedCargo && selectedCargo.loadPort && selectedCargo.dischargePort
      ? getDistance(distanceMap, selectedCargo.loadPort, selectedCargo.dischargePort)
      : defaultDistanceNm;

  const inputs: FreightInputs | undefined =
    effectiveVessel && effectiveCargo
      ? {
          vessel: effectiveVessel,
          cargo: effectiveCargo,
          distances: { ballastNm, ladenNm },
          costs: {
            ...exampleInputs.costs,
            ifoPrice: bunkerPrices.ifo,
            mdoPrice: bunkerPrices.mdo,
            portDisbLoad: selectedCargo?.portCosts.load ?? exampleInputs.costs.portDisbLoad,
            portDisbDis: selectedCargo?.portCosts.discharge ?? exampleInputs.costs.portDisbDis,
          },
          options: { bunkerDays: exampleInputs.options.bunkerDays },
        }
      : undefined;

  const result = inputs ? calculateFreight(inputs) : undefined;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Manual Calculation</h1>
        <p className="text-sm text-neutral-600">
          Select a vessel and cargo from CSV, then review the result as a structured breakdown.
        </p>
      </header>

      <section className="grid gap-6 rounded-lg border border-neutral-200 p-4 md:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-base font-semibold">Inputs (CSV)</h2>
            {loadError ? (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {loadError}
              </div>
            ) : null}
            <label className="text-sm">
              <span className="text-neutral-500">Vessel</span>
              <select
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                value={selectedVesselId}
                onChange={(event) => setSelectedVesselId(event.target.value)}
              >
                {vessels.map((vessel) => (
                  <option key={vessel.id} value={vessel.id}>
                    {vessel.name} ({vessel.source})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-neutral-500">Cargo</span>
              <select
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                value={selectedCargoId}
                onChange={(event) => setSelectedCargoId(event.target.value)}
              >
                {cargos.map((cargo) => (
                  <option key={cargo.id} value={cargo.id}>
                    {cargo.name} ({cargo.source})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2 text-xs text-neutral-600">
            <div>
              Route ports: {selectedCargo?.loadPort ?? "--"} {"->"}{" "}
              {selectedCargo?.dischargePort ?? "--"}
            </div>
            <div>
              Ballast start: {selectedVessel?.currentPort ?? "--"}
            </div>
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

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-neutral-700">Overrides</h3>
            <label className="text-sm">
              <span className="text-neutral-500">Daily Hire ($/day)</span>
              <input
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                type="number"
                value={dailyHireOverride ?? selectedVessel?.data.dailyHire ?? ""}
                onChange={(event) =>
                  setDailyHireOverride(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
              />
            </label>
            <label className="text-sm">
              <span className="text-neutral-500">Adcoms (%)</span>
              <input
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                type="number"
                value={
                  adComsOverride !== null
                    ? adComsOverride * 100
                    : (selectedVessel?.data.adComsPct ?? 0) * 100
                }
                onChange={(event) =>
                  setAdComsOverride(
                    event.target.value ? Number(event.target.value) / 100 : null,
                  )
                }
              />
            </label>
            <label className="text-sm">
              <span className="text-neutral-500">Freight Rate ($/MT)</span>
              <input
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                type="number"
                value={freightOverride ?? selectedCargo?.data.freightRate ?? ""}
                onChange={(event) =>
                  setFreightOverride(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
              />
            </label>
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-neutral-200 p-4 text-sm">
            <h2 className="text-lg font-semibold">Vessel Details</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="text-neutral-500">Ship Name</div>
              <div>{selectedVessel?.name ?? "--"}</div>
              <div className="text-neutral-500">DWT</div>
              <div>{formatNumber(selectedVessel?.data.dwt ?? 0)}</div>
              <div className="text-neutral-500">Speed (Ballast/Laden)</div>
              <div>
                {formatNumber(selectedVessel?.data.speed.ballast ?? 0)} /{" "}
                {formatNumber(selectedVessel?.data.speed.laden ?? 0)} kn
              </div>
              <div className="text-neutral-500">Fuel (Ballast IFO/MDO)</div>
              <div>
                {formatNumber(selectedVessel?.data.consumption.ballast.ifo ?? 0)} /{" "}
                {formatNumber(selectedVessel?.data.consumption.ballast.mdo ?? 0)}
              </div>
              <div className="text-neutral-500">Fuel (Laden IFO/MDO)</div>
              <div>
                {formatNumber(selectedVessel?.data.consumption.laden.ifo ?? 0)} /{" "}
                {formatNumber(selectedVessel?.data.consumption.laden.mdo ?? 0)}
              </div>
              <div className="text-neutral-500">Port (Working IFO/MDO)</div>
              <div>
                {formatNumber(selectedVessel?.data.portConsumption.working.ifo ?? 0)} /{" "}
                {formatNumber(selectedVessel?.data.portConsumption.working.mdo ?? 0)}
              </div>
              <div className="text-neutral-500">Port (Idle IFO/MDO)</div>
              <div>
                {formatNumber(selectedVessel?.data.portConsumption.idle.ifo ?? 0)} /{" "}
                {formatNumber(selectedVessel?.data.portConsumption.idle.mdo ?? 0)}
              </div>
              <div className="text-neutral-500">Daily Hire</div>
              <div>{formatMoney(effectiveVessel?.dailyHire ?? 0)}</div>
              <div className="text-neutral-500">Adcoms</div>
              <div>{formatNumber((effectiveVessel?.adComsPct ?? 0) * 100)}%</div>
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 p-4 text-sm">
            <h2 className="text-lg font-semibold">Distances</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="text-neutral-500">Ballast (NM)</div>
              <div>{formatNumber(ballastNm)}</div>
              <div className="text-neutral-500">Ballast Duration</div>
              <div>{formatNumber(result?.ballastDays ?? 0)} days</div>
              <div className="text-neutral-500">Laden (NM)</div>
              <div>{formatNumber(ladenNm)}</div>
              <div className="text-neutral-500">Laden Duration</div>
              <div>{formatNumber(result?.ladenDays ?? 0)} days</div>
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 p-4 text-sm">
            <h2 className="text-lg font-semibold">Cargo Details</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="text-neutral-500">Cargo Qty</div>
              <div>{formatNumber(effectiveCargo?.cargoQty ?? 0)} MT</div>
              <div className="text-neutral-500">Stow Factor</div>
              <div>{formatNumber(effectiveCargo?.stowFactor ?? 0)}</div>
              <div className="text-neutral-500">Loaded Qty</div>
              <div>{formatNumber(result?.loadedQty ?? 0)} MT</div>
              <div className="text-neutral-500">Freight Rate</div>
              <div>{formatMoney(effectiveCargo?.freightRate ?? 0)} / MT</div>
              <div className="text-neutral-500">Address Coms</div>
              <div>{formatNumber((effectiveCargo?.addressComsPct ?? 0) * 100)}%</div>
              <div className="text-neutral-500">Broker Coms</div>
              <div>{formatNumber((effectiveCargo?.brokerComsPct ?? 0) * 100)}%</div>
              <div className="text-neutral-500">Load Rate</div>
              <div>{formatNumber(effectiveCargo?.loadRate ?? 0)} MT/day</div>
              <div className="text-neutral-500">Discharge Rate</div>
              <div>{formatNumber(effectiveCargo?.dischargeRate ?? 0)} MT/day</div>
              <div className="text-neutral-500">Loadport TT</div>
              <div>{formatNumber(effectiveCargo?.loadportTT ?? 0)} days</div>
              <div className="text-neutral-500">Disport TT</div>
              <div>{formatNumber(effectiveCargo?.disportTT ?? 0)} days</div>
              <div className="text-neutral-500">Port Idle</div>
              <div>{formatNumber(effectiveCargo?.portIdleDays ?? 0)} days</div>
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 p-4 text-sm">
            <h2 className="text-lg font-semibold">Expenses</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="text-neutral-500">Hire (Gross)</div>
              <div>{formatMoney(result?.hireGross ?? 0)}</div>
              <div className="text-neutral-500">Hire (Net)</div>
              <div>{formatMoney(result?.hireNet ?? 0)}</div>
              <div className="text-neutral-500">IFO (Total)</div>
              <div>{formatNumber(result?.totalIfo ?? 0)} MT</div>
              <div className="text-neutral-500">MDO (Total)</div>
              <div>{formatNumber(result?.totalMdo ?? 0)} MT</div>
              <div className="text-neutral-500">Bunker Expense</div>
              <div>{formatMoney(result?.bunkerExpense ?? 0)}</div>
              <div className="text-neutral-500">Port Disbursements</div>
              <div>{formatMoney(result?.portDisbursements ?? 0)}</div>
              <div className="text-neutral-500">Operating Expenses</div>
              <div>{formatMoney(result?.operatingExpenses ?? 0)}</div>
              <div className="text-neutral-500">Misc Expense</div>
              <div>{formatMoney(result?.miscExpense ?? 0)}</div>
              <div className="text-neutral-500">Total Expenses</div>
              <div>{formatMoney(result?.totalExpenses ?? 0)}</div>
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 p-4 text-sm">
            <h2 className="text-lg font-semibold">Revenue / Profit / TCE</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="text-neutral-500">Freight Gross</div>
              <div>{formatMoney(result?.freightGross ?? 0)}</div>
              <div className="text-neutral-500">Freight Net</div>
              <div>{formatMoney(result?.freightNet ?? 0)}</div>
              <div className="text-neutral-500">Revenue Net</div>
              <div>{formatMoney(result?.revenueNet ?? 0)}</div>
              <div className="text-neutral-500">Profit</div>
              <div>{formatMoney(result?.profit ?? 0)}</div>
              <div className="text-neutral-500">TCE</div>
              <div>{formatMoney(result?.tce ?? 0)}</div>
              <div className="text-neutral-500">Total Duration</div>
              <div>{formatNumber(result?.totalDuration ?? 0)} days</div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
