"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateFreight, exampleInputs, type FreightInputs } from "../../calculator/freightCalculator";
import {
  evaluateLaycan,
  parseDateInput,
  parseLaycanRange,
  type LaycanEvaluation,
  type LaycanWindow,
} from "../../calculator/laycan";
import {
  defaultDistanceNm,
  extractPortFromStatus,
  getDistance,
  parseDistanceCsv,
  resolvePortName,
} from "../../calculator/portDistances";

type CsvRow = Record<string, string>;

type VesselOption = {
  id: string;
  name: string;
  source: "capesize" | "market";
  currentPort: string;
  etdDate: string;
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
  laycanWindow: LaycanWindow | null;
  laycanLabel: string;
};

const formatMoney = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const formatNumber = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

const formatDateLabel = (value?: string) => {
  const parsed = parseDateInput(value ?? "");
  if (!parsed) return "--";
  return parsed.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

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

export default function ManualCalculationPage() {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
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
      departureDate: string;
      result?: ReturnType<typeof calculateFreight>;
      laycanEvaluation?: LaycanEvaluation;
      waitingCost?: number;
      adjustedProfit?: number;
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
          const etdDate = (row.etd_date ?? "").trim();

          return {
            id: `${source}-${index}`,
            name,
            source,
            currentPort: currentPort || currentPortRaw || "UNKNOWN",
            etdDate,
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
          const laycanLabel = row.laycan ?? "";
          const laycanWindow = parseLaycanRange(laycanLabel);

          return {
            id: `${source}-${index}`,
            name,
            source,
            raw: row,
            loadPort: loadPort || loadPortRaw || "UNKNOWN",
            dischargePort: dischargePort || dischargePortRaw || "UNKNOWN",
            portCosts,
            laycanLabel,
            laycanWindow,
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
              departureDate: todayIso,
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

  const getLaycanEvaluation = (
    voyage: { vesselId: string; cargoId: string; departureDate: string },
    vessel: VesselOption,
    cargo: CargoOption,
  ) => {
    if (!cargo.laycanWindow) return undefined;
    const departureDate = parseDateInput(voyage.departureDate);
    if (!departureDate) return undefined;
    const ballastNm = getDistance(distanceMap, vessel.currentPort, cargo.loadPort);
    return evaluateLaycan({
      departureDate,
      ballastNm,
      ballastSpeed: vessel.data.speed.ballast,
      laycan: cargo.laycanWindow,
    });
  };

  const calculateVoyage = (voyageId: string) => {
    setVoyages((prev) =>
      prev.map((voyage) => {
        if (voyage.id !== voyageId) return voyage;
        const vessel = vessels.find((item) => item.id === voyage.vesselId);
        const cargo = cargos.find((item) => item.id === voyage.cargoId);
        if (!vessel || !cargo) return voyage;
        const laycanEvaluation = getLaycanEvaluation(voyage, vessel, cargo);
        if (laycanEvaluation?.status === "infeasible") {
          return {
            ...voyage,
            result: undefined,
            laycanEvaluation,
            waitingCost: undefined,
            adjustedProfit: undefined,
          };
        }
        const inputs = getVoyageInputs(voyage);
        if (!inputs) return voyage;
        const result = calculateFreight(inputs);
        let waitingCost = 0;
        if (laycanEvaluation?.status === "early" && laycanEvaluation.waitingDays > 0) {
          const waitingHireCost = laycanEvaluation.waitingDays * vessel.data.dailyHire;
          const waitingFuelCost =
            laycanEvaluation.waitingDays *
            (vessel.data.portConsumption.idle.ifo * bunkerPrices.ifo +
              vessel.data.portConsumption.idle.mdo * bunkerPrices.mdo);
          waitingCost = waitingHireCost + waitingFuelCost;
        }
        const adjustedProfit = result.profit - waitingCost;
        return {
          ...voyage,
          result,
          laycanEvaluation,
          waitingCost,
          adjustedProfit,
        };
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
        departureDate: todayIso,
      },
    ]);
  };

  const removeVoyage = (voyageId: string) => {
    setVoyages((prev) => prev.filter((voyage) => voyage.id !== voyageId));
  };

  const updateVoyage = (
    voyageId: string,
    updates: Partial<{ vesselId: string; cargoId: string; departureDate: string }>,
  ) => {
    setVoyages((prev) =>
      prev.map((voyage) =>
        voyage.id === voyageId
          ? {
              ...voyage,
              ...updates,
              result: undefined,
              laycanEvaluation: undefined,
              waitingCost: undefined,
              adjustedProfit: undefined,
            }
          : voyage,
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
              const etdDate = vessel?.etdDate ?? "";
              const etdParsed = parseDateInput(etdDate);
              const departureParsed = parseDateInput(voyage.departureDate);
              const isBeforeEtd =
                etdParsed && departureParsed
                  ? departureParsed.getTime() < etdParsed.getTime()
                  : false;
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
                  <div className="mt-2 text-xs text-neutral-600">
                    Vessel ETD: {formatDateLabel(etdDate)}
                  </div>
                  <label className="mt-2 block text-sm">
                    <span className="text-neutral-500">Vessel Available / Departure Date</span>
                    <input
                      className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                      type="date"
                      value={voyage.departureDate}
                      onChange={(event) =>
                        updateVoyage(voyage.id, { departureDate: event.target.value })
                      }
                    />
                  </label>
                  {isBeforeEtd ? (
                    <div className="mt-1 text-xs font-semibold text-red-600">
                      Departure date is earlier than vessel ETD.
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="mt-3 w-full rounded border border-neutral-300 px-3 py-2 text-xs font-semibold hover:border-neutral-400"
                    onClick={() => calculateVoyage(voyage.id)}
                    disabled={!vessel || !cargo}
                  >
                    Calculate
                  </button>
                  <button
                    type="button"
                    className="mt-2 w-full rounded border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:border-red-300"
                    onClick={() => removeVoyage(voyage.id)}
                  >
                    Delete
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
            const laycanEvaluation = voyage.laycanEvaluation;
            const laycanStatus =
              laycanEvaluation?.status === "infeasible"
                ? "Miss Laycan (Infeasible)"
                : laycanEvaluation?.status === "early"
                  ? `Early arrival - waiting ${formatNumber(laycanEvaluation.waitingDays)} days`
                  : laycanEvaluation?.status === "feasible"
                    ? "Feasible"
                    : "Laycan unavailable";
            const ballastNm =
              vessel && cargo
                ? getDistance(distanceMap, vessel.currentPort, cargo.loadPort)
                : defaultDistanceNm;
            const ladenNm =
              cargo ? getDistance(distanceMap, cargo.loadPort, cargo.dischargePort) : defaultDistanceNm;
            const formatDate = (date?: Date) =>
              date
                ? date.toLocaleDateString("en-US", {
                    timeZone: "UTC",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : "--";
            return (
              <section key={voyage.id} className="rounded-lg border border-neutral-200 p-4 text-sm">
                <h2 className="text-lg font-semibold">
                  Voyage {index + 1}: {vessel?.name ?? "--"} → {cargo?.name ?? "--"}
                </h2>
                {!result && laycanEvaluation?.status === "infeasible" ? (
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="font-semibold text-red-600">{laycanStatus}</div>
                    <div className="grid grid-cols-2 gap-2 text-neutral-600">
                      <div>Laycan Window</div>
                      <div>{cargo?.laycanLabel ?? "--"}</div>
                      <div>ETA at Load Port</div>
                      <div>{formatDate(laycanEvaluation.eta)}</div>
                    </div>
                    <div className="text-neutral-500">
                      Voyage is infeasible due to laycan miss. Adjust departure date.
                    </div>
                  </div>
                ) : !result ? (
                  <div className="mt-3 text-xs text-neutral-500">
                    Click Calculate to generate results.
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-neutral-500">Laycan Window</div>
                      <div>{cargo?.laycanLabel ?? "--"}</div>
                      <div className="text-neutral-500">ETA at Load Port</div>
                      <div>{formatDate(laycanEvaluation?.eta)}</div>
                      <div className="text-neutral-500">Feasibility</div>
                      <div
                        className={
                          laycanEvaluation?.status === "infeasible"
                            ? "font-semibold text-red-600"
                            : "font-semibold text-green-600"
                        }
                      >
                        {laycanStatus}
                      </div>
                      <div className="text-neutral-500">Waiting Days</div>
                      <div>
                        {laycanEvaluation?.status === "early"
                          ? `${formatNumber(laycanEvaluation.waitingDays)} days`
                          : "0 days"}
                      </div>
                      <div className="text-neutral-500">Waiting Cost</div>
                      <div>{formatMoney(voyage.waitingCost ?? 0)}</div>
                      <div className="text-neutral-500">Adjusted Profit</div>
                      <div>{formatMoney(voyage.adjustedProfit ?? result.profit)}</div>
                    </div>

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
                      <div className="text-neutral-500">Steaming Days</div>
                      <div>{formatNumber(result.steamingDays)} days</div>
                      <div className="text-neutral-500">Ballast Days</div>
                      <div>{formatNumber(result.ballastDays)} days</div>
                      <div className="text-neutral-500">Laden Days</div>
                      <div>{formatNumber(result.ladenDays)} days</div>
                      <div className="text-neutral-500">Loadport Days</div>
                      <div>{formatNumber(result.loadportDays)} days</div>
                      <div className="text-neutral-500">Disport Days</div>
                      <div>{formatNumber(result.disportDays)} days</div>
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
                      <div className="text-neutral-500">Misc Expenses</div>
                      <div>{formatMoney(result.miscExpense)}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-neutral-500">Freight Gross</div>
                      <div>{formatMoney(result.freightGross)}</div>
                      <div className="text-neutral-500">Freight Commissions</div>
                      <div>{formatMoney(result.freightCommissions)}</div>
                      <div className="text-neutral-500">Revenue Net</div>
                      <div>{formatMoney(result.revenueNet)}</div>
                      <div className="text-neutral-500">Hire Gross</div>
                      <div>{formatMoney(result.hireGross)}</div>
                      <div className="text-neutral-500">Hire Commissions</div>
                      <div>{formatMoney(result.hireCommissions)}</div>
                      <div className="text-neutral-500">Loaded Qty</div>
                      <div>{formatNumber(result.loadedQty)} MT</div>
                      <div className="text-neutral-500">Load Rate</div>
                      <div>{formatNumber(inputs?.cargo.loadRate ?? 0)} MT/day</div>
                      <div className="text-neutral-500">Discharge Rate</div>
                      <div>{formatNumber(inputs?.cargo.dischargeRate ?? 0)} MT/day</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-neutral-500">IFO At Sea</div>
                      <div>{formatNumber(result.ifoAtSea)} MT</div>
                      <div className="text-neutral-500">IFO In Port</div>
                      <div>{formatNumber(result.ifoInPort)} MT</div>
                      <div className="text-neutral-500">Total IFO</div>
                      <div>{formatNumber(result.totalIfo)} MT</div>
                      <div className="text-neutral-500">MDO At Sea</div>
                      <div>{formatNumber(result.mdoAtSea)} MT</div>
                      <div className="text-neutral-500">MDO In Port</div>
                      <div>{formatNumber(result.mdoInPort)} MT</div>
                      <div className="text-neutral-500">Total MDO</div>
                      <div>{formatNumber(result.totalMdo)} MT</div>
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


