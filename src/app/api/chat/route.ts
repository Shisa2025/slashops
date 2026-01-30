import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { calculateFreight, exampleInputs, type FreightInputs } from "../../../calculator/freightCalculator";
import { evaluateLaycan, parseDateInput, parseLaycanRange, type LaycanEvaluation } from "../../../calculator/laycan";
import { getQuantityRangeFeasibility, getWeightFeasibility, type QuantityRange } from "../../../calculator/weight";
import {
  defaultDistanceNm,
  extractPortFromStatus,
  getDistance,
  parseDistanceCsv,
  resolvePortName,
} from "../../../calculator/portDistances";

export const runtime = "nodejs";

type CsvRow = Record<string, string>;

type VesselOption = {
  id: string;
  name: string;
  source: "capesize" | "market";
  currentPort: string;
  etdDate: string;
  data: FreightInputs["vessel"];
};

type CargoOption = {
  id: string;
  name: string;
  source: "committed" | "market";
  data: FreightInputs["cargo"];
  quantityRange: QuantityRange | null;
  loadPort: string;
  dischargePort: string;
  portCosts: { load: number; discharge: number };
  laycanLabel: string;
  laycanWindow: ReturnType<typeof parseLaycanRange>;
};

type BestPlanSummary = {
  reply: string;
  context: string;
};

type BestPortfolioSummary = {
  reply: string;
  context: string;
};

type PairResult = ReturnType<typeof calculateFreight> & {
  adjustedProfit: number;
  waitingCost: number;
  laycanEvaluation?: LaycanEvaluation;
  vessel: VesselOption;
  cargo: CargoOption;
  ballastNm: number;
  ladenNm: number;
  cargoQty: number;
  ballastDistanceKnown: boolean;
  ladenDistanceKnown: boolean;
  speedBlend: { ballast: number; laden: number };
  departureDateLabel: string;
};

const formatMoney = (value: number | undefined | null) =>
  (Number.isFinite(value ?? NaN) ? (value as number) : 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const formatNumber = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

const formatDateLabel = (value?: Date) => {
  if (!value) return "--";
  return value.toLocaleDateString("en-US", {
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

const safeReadJson = async <T,>(filePath: string, fallback: T): Promise<T> => {
  try {
    await fs.access(filePath);
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      console.warn(`Missing file: ${filePath}`);
    } else {
      console.error(`Failed to read ${filePath}:`, err);
    }
    return fallback;
  }
};

const buildPortfolioContextPack = (params: {
  trace?: any;
  topk?: any;
  thresholds?: any;
}) => {
  const { trace, topk, thresholds } = params;
  const traceSummary =
    trace?.summary ??
    trace?.trace_summary ??
    "TRACE_MISSING: run pipeline to generate data/portfolio_trace.json";

  const top1 = topk?.top1 ?? topk?.[0];
  const top2 = topk?.top2 ?? topk?.[1];
  const diff = topk?.diff ?? topk?.top1_top2_diff;
  const topkOneSentence =
    diff?.one_sentence ??
    diff?.summary ??
    (top1 && top2
      ? "TOPK_DIFF_MISSING: run pipeline to generate top1/top2 diff."
      : "TOPK_MISSING: run pipeline to generate data/topk_portfolios.json");
  const topkKeyDeltas = diff?.key_deltas ?? diff?.deltas ?? {};

  const bunkerLine =
    thresholds?.bunker ?? thresholds?.bunker_price_delta ?? "THRESHOLD_MISSING";
  const delayLine =
    thresholds?.delay ?? thresholds?.port_delay_delta_days ?? "THRESHOLD_MISSING";

  return [
    "PORTFOLIO_CONTEXT_PACK:",
    `TRACE_SUMMARY: ${typeof traceSummary === "string" ? traceSummary : JSON.stringify(traceSummary)}`,
    `TOP1_TOP2_ONE_SENTENCE: ${typeof topkOneSentence === "string" ? topkOneSentence : JSON.stringify(topkOneSentence)}`,
    `TOP1_TOP2_KEY_DELTAS: ${JSON.stringify(topkKeyDeltas)}`,
    `THRESHOLD_BUNKER: ${typeof bunkerLine === "string" ? bunkerLine : JSON.stringify(bunkerLine)}`,
    `THRESHOLD_DELAY: ${typeof delayLine === "string" ? delayLine : JSON.stringify(delayLine)}`,
  ].join("\n");
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

const parseQuantityRange = (
  value: string | undefined | null,
  fallbackQty: number,
): { baseQty: number; range: QuantityRange | null } => {
  if (!value) return { baseQty: fallbackQty, range: null };
  const baseQty = parseFirstNumber(value, fallbackQty);
  const percentMatch = value.match(/([\d.]+)\s*%/);
  if (percentMatch) {
    const pct = Number.parseFloat(percentMatch[1]);
    if (Number.isFinite(pct) && baseQty > 0) {
      const min = baseQty * (1 - pct / 100);
      const max = baseQty * (1 + pct / 100);
      return {
        baseQty,
        range: {
          min,
          max,
          label: `${formatNumber(min)} - ${formatNumber(max)} MT`,
        },
      };
    }
  }
  const rangeMatch = value.match(/([\d,.]+)\s*(?:-|to)\s*([\d,.]+)/i);
  if (rangeMatch) {
    const first = toNumber(rangeMatch[1], baseQty);
    const second = toNumber(rangeMatch[2], baseQty);
    const min = Math.min(first, second);
    const max = Math.max(first, second);
    return {
      baseQty,
      range: {
        min,
        max,
        label: `${formatNumber(min)} - ${formatNumber(max)} MT`,
      },
    };
  }
  return { baseQty, range: null };
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

const isDistanceKnown = (
  distanceMap: Record<string, Record<string, number>>,
  from: string,
  to: string,
) => {
  if (from === to) return true;
  return Number.isFinite(distanceMap[from]?.[to]);
};

const speedStep = 0.01;
const blendValues = Array.from({ length: 101 }, (_, i) => Number.parseFloat((i * speedStep).toFixed(2)));

const computeBestPair = (params: {
  vessel: VesselOption;
  cargo: CargoOption;
  distanceMap: Record<string, Record<string, number>>;
  todayIso: string;
}) => {
  const { vessel, cargo, distanceMap, todayIso } = params;

  if (!Number.isFinite(cargo.data.freightRate) || cargo.data.freightRate <= 0) {
    return null;
  }

  const ballastNm = getDistance(distanceMap, vessel.currentPort, cargo.loadPort);
  const ladenNm = getDistance(distanceMap, cargo.loadPort, cargo.dischargePort);
  const ballastDistanceKnown = isDistanceKnown(distanceMap, vessel.currentPort, cargo.loadPort);
  const ladenDistanceKnown = isDistanceKnown(distanceMap, cargo.loadPort, cargo.dischargePort);
  const laycanWindow = cargo.laycanWindow ?? null;
  const departureDate = parseDateInput(vessel.etdDate) ?? parseDateInput(todayIso);
  if (!laycanWindow || !departureDate) {
    return null;
  }

  const laycanEvaluation = evaluateLaycan({
    departureDate,
    ballastNm,
    ballastSpeed: vessel.data.speed.ballast,
    laycan: laycanWindow,
  });
  if (laycanEvaluation.status === "infeasible") {
    return null;
  }

  const baseQty = cargo.data.cargoQty;
  const qtyRange = cargo.quantityRange;
  const qtyMin = qtyRange ? Math.min(qtyRange.min, qtyRange.max) : baseQty;
  const qtyMax = qtyRange ? Math.max(qtyRange.min, qtyRange.max) : baseQty;
  const qtyStep = Math.max(baseQty * 0.01, 1);
  const qtyValues: number[] = [];
  if (qtyRange) {
    for (let qty = qtyMin; qty <= qtyMax + 1e-6; qty += qtyStep) {
      qtyValues.push(qty);
    }
  } else {
    qtyValues.push(baseQty);
  }

  let best: PairResult | null = null;
  for (const cargoQty of qtyValues) {
    const rangeCheck = getQuantityRangeFeasibility(cargoQty, cargo.quantityRange);
    if (rangeCheck.status === "infeasible") {
      continue;
    }
    const weightCheck = getWeightFeasibility(cargoQty, vessel.data.dwt);
    if (weightCheck.status === "infeasible") {
      continue;
    }

    for (const ballastBlend of blendValues) {
      for (const ladenBlend of blendValues) {
        const inputs: FreightInputs = {
          vessel: vessel.data,
          cargo: { ...cargo.data, cargoQty },
          distances: { ballastNm, ladenNm },
          costs: {
            ...exampleInputs.costs,
            portDisbLoad: cargo.portCosts.load,
            portDisbDis: cargo.portCosts.discharge,
          },
          options: {
            bunkerDays: exampleInputs.options.bunkerDays,
            speedBlend: { ballast: ballastBlend, laden: ladenBlend },
          },
        };

        const result = calculateFreight(inputs);
        let waitingCost = 0;
        if (laycanEvaluation.status === "early" && laycanEvaluation.waitingDays > 0) {
          const waitingHireCost = laycanEvaluation.waitingDays * vessel.data.dailyHire;
          const waitingFuelCost =
            laycanEvaluation.waitingDays *
            (vessel.data.portConsumption.idle.ifo * inputs.costs.ifoPrice +
              vessel.data.portConsumption.idle.mdo * inputs.costs.mdoPrice);
          waitingCost = waitingHireCost + waitingFuelCost;
        }
        const adjustedProfit = result.profit - waitingCost;

        if (!best || adjustedProfit > best.adjustedProfit) {
          best = {
            ...result,
            adjustedProfit,
            waitingCost,
            laycanEvaluation,
            vessel,
            cargo,
            ballastNm,
            ladenNm,
            cargoQty,
            ballastDistanceKnown,
            ladenDistanceKnown,
            speedBlend: { ballast: ballastBlend, laden: ladenBlend },
            departureDateLabel: formatDateLabel(departureDate),
          };
        }
      }
    }
  }

  return best;
};

const hungarian = (cost: number[][]) => {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  const u = Array(n + 1).fill(0);
  const v = Array(m + 1).fill(0);
  const p = Array(m + 1).fill(0);
  const way = Array(m + 1).fill(0);

  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(m + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = Array(n).fill(-1);
  for (let j = 1; j <= m; j += 1) {
    if (p[j] > 0) {
      assignment[p[j] - 1] = j - 1;
    }
  }
  return assignment;
};

const computeBestPortfolioSummary = async (): Promise<BestPortfolioSummary> => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const dataRoot = path.join(process.cwd(), "public", "business_data");
  const [capesizeText, marketVesselsText, committedText, marketCargosText, distancesText] =
    await Promise.all([
      fs.readFile(path.join(dataRoot, "vessels", "capesize_vessels.csv"), "utf8"),
      fs.readFile(path.join(dataRoot, "vessels", "market_vessels.csv"), "utf8"),
      fs.readFile(path.join(dataRoot, "cargos", "committed_cargos.csv"), "utf8"),
      fs.readFile(path.join(dataRoot, "cargos", "market_cargos.csv"), "utf8"),
      fs.readFile(path.join(dataRoot, "port_data", "port_distances.csv"), "utf8"),
    ]);

  const parsedDistances = parseDistanceCsv(distancesText);
  const ports = parsedDistances.ports;

  const capesizeRows = parseCsv(capesizeText);
  const marketRows = parseCsv(marketVesselsText);
  const vesselsParsed: VesselOption[] = [...capesizeRows, ...marketRows].map((row, index) => {
    const source = index < capesizeRows.length ? "capesize" : "market";
    const name = row.vessel_name || `Vessel ${index + 1}`;
    const dwt = toNumber(row.dwt_mt, exampleInputs.vessel.dwt);
    const ecoLaden = toNumber(row.economical_speed_laden_kn, exampleInputs.vessel.speed.laden);
    const ecoBallast = toNumber(row.economical_speed_ballast_kn, exampleInputs.vessel.speed.ballast);
    const ecoLadenVlsfo = toNumber(
      row.economical_speed_laden_vlsfo_mt,
      exampleInputs.vessel.consumption.laden.ifo,
    );
    const ecoBallastVlsfo = toNumber(
      row.economical_speed_ballast_vlsfo_mt,
      exampleInputs.vessel.consumption.ballast.ifo,
    );
    const ecoLadenMgo = toNumber(
      row.economical_speed_laden_mgo_mt,
      exampleInputs.vessel.consumption.laden.mdo,
    );
    const ecoBallastMgo = toNumber(
      row.economical_speed_ballast_mgo_mt,
      exampleInputs.vessel.consumption.ballast.mdo,
    );
    const warrantedLaden = toNumber(
      row.warranted_speed_laden_kn,
      exampleInputs.vessel.speedWarranted.laden,
    );
    const warrantedBallast = toNumber(
      row.warranted_speed_ballast_kn,
      exampleInputs.vessel.speedWarranted.ballast,
    );
    const warrantedLadenVlsfo = toNumber(
      row.warranted_speed_laden_vlsf_mt,
      exampleInputs.vessel.consumptionWarranted.laden.ifo,
    );
    const warrantedBallastVlsfo = toNumber(
      row.warranted_speed_ballast_vlsf_mt,
      exampleInputs.vessel.consumptionWarranted.ballast.ifo,
    );
    const warrantedLadenMgo = toNumber(
      row.warranted_speed_laden_mgo_mt,
      exampleInputs.vessel.consumptionWarranted.laden.mdo,
    );
    const warrantedBallastMgo = toNumber(
      row.warranted_speed_ballast_mgo_mt,
      exampleInputs.vessel.consumptionWarranted.ballast.mdo,
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
    const currentPort = resolvePortName(currentPortRaw, ports);
    const etdDate = (row.etd_date ?? "").trim();

    return {
      id: `${source}-${index}`,
      name,
      source,
      currentPort: currentPort || currentPortRaw || "UNKNOWN",
      etdDate,
      data: {
        dwt,
        grainCapacity: Math.max(dwt, exampleInputs.vessel.grainCapacity),
        speed: { ballast: ecoBallast, laden: ecoLaden },
        speedWarranted: { ballast: warrantedBallast, laden: warrantedLaden },
        consumption: {
          ballast: { ifo: ecoBallastVlsfo, mdo: ecoBallastMgo },
          laden: { ifo: ecoLadenVlsfo, mdo: ecoLadenMgo },
        },
        consumptionWarranted: {
          ballast: { ifo: warrantedBallastVlsfo, mdo: warrantedBallastMgo },
          laden: { ifo: warrantedLadenVlsfo, mdo: warrantedLadenMgo },
        },
        portConsumption: {
          working: { ifo: portWorking, mdo: exampleInputs.vessel.portConsumption.working.mdo },
          idle: { ifo: portIdle, mdo: exampleInputs.vessel.portConsumption.idle.mdo },
        },
        dailyHire: toNumber(row.hire_rate_usd_day, exampleInputs.vessel.dailyHire),
        adComsPct: exampleInputs.vessel.adComsPct,
      },
    };
  });

  const committedRows = parseCsv(committedText);
  const marketCargoRows = parseCsv(marketCargosText);
  const baseCosts = exampleInputs.costs;
  const cargosParsed: CargoOption[] = [...committedRows, ...marketCargoRows].map((row, index) => {
    const source = index < committedRows.length ? "committed" : "market";
    const name = row.route || row.customer || `Cargo ${index + 1}`;
    const { baseQty, range: quantityRange } = parseQuantityRange(
      row.quantity,
      exampleInputs.cargo.cargoQty,
    );
    const freightRate = toNumber(row.freight_rate ?? "", exampleInputs.cargo.freightRate);
    const loadRate = parseRateFromTerms(row.loading_terms ?? "", exampleInputs.cargo.loadRate);
    const dischargeRate = parseRateFromTerms(row.discharge_terms ?? "", exampleInputs.cargo.dischargeRate);
    const loadportTT = parseTurnTimeDays(row.loading_terms ?? "", exampleInputs.cargo.loadportTT);
    const disportTT = parseTurnTimeDays(row.discharge_terms ?? "", exampleInputs.cargo.disportTT);
    const commissionPct = parsePercent(row.commission ?? "", 0);
    const commissionIsBroker = (row.commission ?? "").toLowerCase().includes("broker");
    const loadPortRaw = row.load_port ?? "";
    const dischargePortRaw = row.discharge_port ?? "";
    const loadPort = resolvePortName(loadPortRaw, ports);
    const dischargePort = resolvePortName(dischargePortRaw, ports);
    const portCosts = parsePortCosts(row.port_cost ?? "", baseCosts.portDisbLoad, baseCosts.portDisbDis);
    const laycanLabel = row.laycan ?? "";
    const laycanWindow = parseLaycanRange(laycanLabel);

    return {
      id: `${source}-${index}`,
      name,
      source,
      quantityRange,
      loadPort: loadPort || loadPortRaw || "UNKNOWN",
      dischargePort: dischargePort || dischargePortRaw || "UNKNOWN",
      portCosts,
      laycanLabel,
      laycanWindow,
      data: {
        ...exampleInputs.cargo,
        cargoQty: baseQty,
        freightRate,
        loadRate,
        dischargeRate,
        loadportTT,
        disportTT,
        portIdleDays: exampleInputs.cargo.portIdleDays,
        addressComsPct: commissionIsBroker ? 0 : commissionPct,
        brokerComsPct: commissionIsBroker ? commissionPct : 0,
      },
    };
  });

  if (!vesselsParsed.length || !cargosParsed.length) {
    return {
      reply: "No vessels or cargos found in business_data.",
      context: "BEST_PORTFOLIO: none",
    };
  }

  const pairResults: Array<Array<PairResult | null>> = vesselsParsed.map((vessel) =>
    cargosParsed.map((cargo) =>
      computeBestPair({ vessel, cargo, distanceMap: parsedDistances.distanceMap, todayIso }),
    ),
  );
  const speedSteps = blendValues.length;
  const totalQtySteps = cargosParsed.reduce((sum, cargo) => {
    const baseQty = cargo.data.cargoQty;
    const qtyRange = cargo.quantityRange;
    const qtyMin = qtyRange ? Math.min(qtyRange.min, qtyRange.max) : baseQty;
    const qtyMax = qtyRange ? Math.max(qtyRange.min, qtyRange.max) : baseQty;
    const qtyStep = Math.max(baseQty * 0.01, 1);
    const steps = Math.max(1, Math.floor((qtyMax - qtyMin) / qtyStep) + 1);
    return sum + steps;
  }, 0);
  const combosBeforeFilters =
    vesselsParsed.length * totalQtySteps * speedSteps * speedSteps;

  let maxProfit = 0;
  for (const row of pairResults) {
    for (const pair of row) {
      if (pair && Number.isFinite(pair.adjustedProfit)) {
        if (pair.adjustedProfit > maxProfit) maxProfit = pair.adjustedProfit;
      }
    }
  }

  const n = vesselsParsed.length;
  const m = Math.max(n, cargosParsed.length);
  const big = maxProfit + 1_000_000_000;
  const cost: number[][] = Array.from({ length: n }, (_, i) => {
    const row = Array.from({ length: m }, () => maxProfit);
    for (let j = 0; j < m; j += 1) {
      if (j >= cargosParsed.length) {
        row[j] = maxProfit; // dummy cargo => profit 0
      } else {
        const pair = pairResults[i][j];
        if (!pair) {
          row[j] = big;
        } else {
          row[j] = maxProfit - pair.adjustedProfit;
        }
      }
    }
    return row;
  });

  const assignment = hungarian(cost);
  const chosen: Array<{ vessel: VesselOption; cargo?: CargoOption; pair?: PairResult }> = [];
  let totalProfit = 0;
  const usedCargoIds = new Set<string>();
  for (let i = 0; i < n; i += 1) {
    const j = assignment[i];
    if (j < 0 || j >= cargosParsed.length) {
      chosen.push({ vessel: vesselsParsed[i] });
      continue;
    }
    const pair = pairResults[i][j];
    if (!pair || !Number.isFinite(pair.adjustedProfit) || pair.adjustedProfit <= 0) {
      chosen.push({ vessel: vesselsParsed[i] });
      continue;
    }
    totalProfit += pair.adjustedProfit;
    usedCargoIds.add(cargosParsed[j].id);
    chosen.push({ vessel: vesselsParsed[i], cargo: cargosParsed[j], pair });
  }

  const lines = [
    "Best portfolio (max total profit, one cargo per vessel, cargo used at most once):",
    `- Total profit: ${formatMoney(totalProfit)}`,
    "",
    "Assignments (all vessels):",
  ];

  let usedCount = 0;
  for (const item of chosen) {
    if (!item.cargo || !item.pair) {
      lines.push(`- Vessel: ${item.vessel.name} | Cargo: UNASSIGNED`);
      continue;
    }
    usedCount += 1;
    const ballastSourceLabel = item.pair.ballastDistanceKnown
      ? "port_distances.csv"
      : "fallback (default 3000 nm)";
    const ladenSourceLabel = item.pair.ladenDistanceKnown
      ? "port_distances.csv"
      : "fallback (default 3000 nm)";
    lines.push(
      `- Vessel: ${item.vessel.name} | Cargo: ${item.cargo.name} | Profit ${formatMoney(item.pair.adjustedProfit)}, ` +
        `Rate ${formatMoney(item.cargo.data.freightRate)}/MT, Qty ${formatNumber(item.pair.cargoQty)} MT, ` +
        `Route ${item.vessel.currentPort} -> ${item.cargo.loadPort} -> ${item.cargo.dischargePort}, ` +
        `Ballast ${formatNumber(item.pair.ballastNm)} nm (${ballastSourceLabel}), ` +
        `Laden ${formatNumber(item.pair.ladenNm)} nm (${ladenSourceLabel}), ` +
        `Laycan ${item.cargo.laycanLabel || "--"} (${item.pair.laycanEvaluation?.status ?? "unknown"})`,
    );
    lines.push(
      `  Voyage timing: ETD ${item.pair.departureDateLabel}, ETA ${formatDateLabel(item.pair.laycanEvaluation?.eta)}, ` +
        `Duration ${formatNumber(item.pair.totalDuration)} days, TCE ${formatMoney(item.pair.tce)}/day`,
    );
    lines.push(
      `  Vessel details: DWT ${formatNumber(item.vessel.data.dwt)} MT, ETD ${item.vessel.etdDate || "--"}, ` +
        `Hire ${formatMoney(item.vessel.data.dailyHire)}/day, ` +
        `Eco speed B/L ${formatNumber(item.vessel.data.speed.ballast)}/${formatNumber(item.vessel.data.speed.laden)} kn, ` +
        `Warranted speed B/L ${formatNumber(item.vessel.data.speedWarranted.ballast)}/${formatNumber(item.vessel.data.speedWarranted.laden)} kn`,
    );
    lines.push(
      `  Fuel (IFO/MDO, MT/day): Eco B/L ${formatNumber(item.vessel.data.consumption.ballast.ifo)}/${formatNumber(item.vessel.data.consumption.laden.ifo)}, ` +
        `${formatNumber(item.vessel.data.consumption.ballast.mdo)}/${formatNumber(item.vessel.data.consumption.laden.mdo)} | ` +
        `Warranted B/L ${formatNumber(item.vessel.data.consumptionWarranted.ballast.ifo)}/${formatNumber(item.vessel.data.consumptionWarranted.laden.ifo)}, ` +
        `${formatNumber(item.vessel.data.consumptionWarranted.ballast.mdo)}/${formatNumber(item.vessel.data.consumptionWarranted.laden.mdo)}`,
    );
    lines.push(
      `  Blend ratio (0=warranted, 1=economical): ballast ${item.pair.speedBlend.ballast}, laden ${item.pair.speedBlend.laden}`,
    );
    lines.push(
      `  Cargo details: Stow ${formatNumber(item.cargo.data.stowFactor)}, ` +
        `Load/Disch ${formatNumber(item.cargo.data.loadRate)}/${formatNumber(item.cargo.data.dischargeRate)} MT/day, ` +
        `Port TT load/disch ${formatNumber(item.cargo.data.loadportTT)}/${formatNumber(item.cargo.data.disportTT)} days, ` +
        `Comms addr/broker ${(item.cargo.data.addressComsPct * 100).toFixed(2)}%/${(item.cargo.data.brokerComsPct * 100).toFixed(2)}%, ` +
        `Port costs load/disch ${formatMoney(item.cargo.portCosts.load)}/${formatMoney(item.cargo.portCosts.discharge)}`,
    );
  }

  const unassignedCargos = cargosParsed.filter((cargo) => !usedCargoIds.has(cargo.id));
  lines.push("");
  lines.push("Unassigned cargos:");
  if (!unassignedCargos.length) {
    lines.push("- NONE");
  } else {
    for (const cargo of unassignedCargos) {
      lines.push(`- ${cargo.name} (${cargo.source})`);
    }
  }

  lines.push("");
  lines.push("Filters applied:");
  lines.push("- Exclude freight <= 0");
  lines.push("- Exclude missing laycan (unknown) and laycan miss");
  lines.push("- Exclude quantity/DWT infeasible combos");
  lines.push("- Search strategy: cargo quantity steps at 1%, speedBlend ballast/laden steps at 1%");
  lines.push(
    `- Combination count: vessels(${vesselsParsed.length}) x cargo-qty steps(${totalQtySteps}) x speed(${speedSteps}^2) = ${formatNumber(combosBeforeFilters)}`,
  );

  const usedAssignments = chosen.filter((item) => item.cargo && item.pair);
  const reportLines = [
    "# BEST_PORTFOLIO — Optimal Vessel–Cargo Assignments",
    "",
    "## Summary",
    `- Total profit: ${formatMoney(totalProfit)}`,
    `- Vessels used: ${usedAssignments.length} / ${vesselsParsed.length}`,
    `- Cargos used: ${usedCargoIds.size} / ${cargosParsed.length}`,
    "",
    "## Assumptions",
    `- Default bunker prices: IFO ${formatMoney(exampleInputs.costs.ifoPrice)}/MT, MDO ${formatMoney(exampleInputs.costs.mdoPrice)}/MT`,
    `- Distance fallback: ${formatNumber(defaultDistanceNm)} nm when no port_distance match`,
    "- Speed blend: searched 0.00–1.00 in 1% steps (0=warranted, 1=economical)",
    "- Laycan: feasible or early only; miss is excluded; early adds waiting cost",
    "",
    "## Filters applied",
    "- Freight rate > 0",
    "- Laycan evaluable and not missed (early allowed with waiting cost)",
    "- Quantity within range (if provided)",
    "- Quantity <= vessel DWT",
    "",
    "## Assignments (detailed)",
    "| # | Vessel | Cargo | Route | Qty (MT) | Freight ($/MT) | Profit (USD) | TCE (USD/day) | Laycan | ETA Load Port | Feasibility | Ballast NM (source) | Laden NM (source) | Waiting Days | Waiting Cost | Adjusted Profit |",
    "| - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |",
  ];

  let rowIndex = 1;
  for (const item of chosen) {
    if (!item.cargo || !item.pair) continue;
    const ballastSource = item.pair.ballastDistanceKnown ? "port_distance" : "fallback";
    const ladenSource = item.pair.ladenDistanceKnown ? "port_distance" : "fallback";
    const waitingDays = item.pair.laycanEvaluation?.waitingDays ?? 0;
    const feasibility = item.pair.laycanEvaluation?.status ?? "unknown";
    const route = `${item.vessel.currentPort} -> ${item.cargo.loadPort} -> ${item.cargo.dischargePort}`;
    reportLines.push(
      `| ${rowIndex} | ${item.vessel.name} | ${item.cargo.name} | ${route} | ` +
        `${formatNumber(item.pair.cargoQty)} | ${formatMoney(item.cargo.data.freightRate)} | ` +
        `${formatMoney(item.pair.profit)} | ${formatMoney(item.pair.tce)} | ` +
        `${item.cargo.laycanLabel || "--"} | ${formatDateLabel(item.pair.laycanEvaluation?.eta)} | ${feasibility} | ` +
        `${formatNumber(item.pair.ballastNm)} (${ballastSource}) | ${formatNumber(item.pair.ladenNm)} (${ladenSource}) | ` +
        `${formatNumber(waitingDays)} | ${formatMoney(item.pair.waitingCost)} | ${formatMoney(item.pair.adjustedProfit)} |`,
    );
    rowIndex += 1;
  }

  const knowledgeDir = path.join(process.cwd(), "knowledge");
  const reportPath = path.join(knowledgeDir, "best_portfolio.md");
  await fs.mkdir(knowledgeDir, { recursive: true });
  await fs.writeFile(reportPath, reportLines.join("\n"), "utf8");
  console.log("Generated /knowledge/best_portfolio.md");

  return {
    reply: lines.join("\n"),
    context: [
      "BEST_PORTFOLIO:",
      `totalProfit=${totalProfit}`,
      `assigned=${usedCount}`,
      `vessels=${n}`,
      `cargos=${cargosParsed.length}`,
    ].join("\n"),
  };
};

const computeBestPlanSummary = async (): Promise<BestPlanSummary> => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const dataRoot = path.join(process.cwd(), "public", "business_data");
  const [capesizeText, marketVesselsText, committedText, marketCargosText, distancesText] =
    await Promise.all([
      fs.readFile(path.join(dataRoot, "vessels", "capesize_vessels.csv"), "utf8"),
      fs.readFile(path.join(dataRoot, "vessels", "market_vessels.csv"), "utf8"),
      fs.readFile(path.join(dataRoot, "cargos", "committed_cargos.csv"), "utf8"),
      fs.readFile(path.join(dataRoot, "cargos", "market_cargos.csv"), "utf8"),
      fs.readFile(path.join(dataRoot, "port_data", "port_distances.csv"), "utf8"),
    ]);

  const parsedDistances = parseDistanceCsv(distancesText);
  const ports = parsedDistances.ports;

  const capesizeRows = parseCsv(capesizeText);
  const marketRows = parseCsv(marketVesselsText);
  const vesselsParsed: VesselOption[] = [...capesizeRows, ...marketRows].map((row, index) => {
    const source = index < capesizeRows.length ? "capesize" : "market";
    const name = row.vessel_name || `Vessel ${index + 1}`;
    const dwt = toNumber(row.dwt_mt, exampleInputs.vessel.dwt);
    const ecoLaden = toNumber(row.economical_speed_laden_kn, exampleInputs.vessel.speed.laden);
    const ecoBallast = toNumber(row.economical_speed_ballast_kn, exampleInputs.vessel.speed.ballast);
    const ecoLadenVlsfo = toNumber(
      row.economical_speed_laden_vlsfo_mt,
      exampleInputs.vessel.consumption.laden.ifo,
    );
    const ecoBallastVlsfo = toNumber(
      row.economical_speed_ballast_vlsfo_mt,
      exampleInputs.vessel.consumption.ballast.ifo,
    );
    const ecoLadenMgo = toNumber(
      row.economical_speed_laden_mgo_mt,
      exampleInputs.vessel.consumption.laden.mdo,
    );
    const ecoBallastMgo = toNumber(
      row.economical_speed_ballast_mgo_mt,
      exampleInputs.vessel.consumption.ballast.mdo,
    );
    const warrantedLaden = toNumber(
      row.warranted_speed_laden_kn,
      exampleInputs.vessel.speedWarranted.laden,
    );
    const warrantedBallast = toNumber(
      row.warranted_speed_ballast_kn,
      exampleInputs.vessel.speedWarranted.ballast,
    );
    const warrantedLadenVlsfo = toNumber(
      row.warranted_speed_laden_vlsf_mt,
      exampleInputs.vessel.consumptionWarranted.laden.ifo,
    );
    const warrantedBallastVlsfo = toNumber(
      row.warranted_speed_ballast_vlsf_mt,
      exampleInputs.vessel.consumptionWarranted.ballast.ifo,
    );
    const warrantedLadenMgo = toNumber(
      row.warranted_speed_laden_mgo_mt,
      exampleInputs.vessel.consumptionWarranted.laden.mdo,
    );
    const warrantedBallastMgo = toNumber(
      row.warranted_speed_ballast_mgo_mt,
      exampleInputs.vessel.consumptionWarranted.ballast.mdo,
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
    const currentPort = resolvePortName(currentPortRaw, ports);
    const etdDate = (row.etd_date ?? "").trim();

    return {
      id: `${source}-${index}`,
      name,
      source,
      currentPort: currentPort || currentPortRaw || "UNKNOWN",
      etdDate,
      data: {
        dwt,
        grainCapacity: Math.max(dwt, exampleInputs.vessel.grainCapacity),
        speed: { ballast: ecoBallast, laden: ecoLaden },
        speedWarranted: { ballast: warrantedBallast, laden: warrantedLaden },
        consumption: {
          ballast: { ifo: ecoBallastVlsfo, mdo: ecoBallastMgo },
          laden: { ifo: ecoLadenVlsfo, mdo: ecoLadenMgo },
        },
        consumptionWarranted: {
          ballast: { ifo: warrantedBallastVlsfo, mdo: warrantedBallastMgo },
          laden: { ifo: warrantedLadenVlsfo, mdo: warrantedLadenMgo },
        },
        portConsumption: {
          working: { ifo: portWorking, mdo: exampleInputs.vessel.portConsumption.working.mdo },
          idle: { ifo: portIdle, mdo: exampleInputs.vessel.portConsumption.idle.mdo },
        },
        dailyHire: toNumber(row.hire_rate_usd_day, exampleInputs.vessel.dailyHire),
        adComsPct: exampleInputs.vessel.adComsPct,
      },
    };
  });

  const committedRows = parseCsv(committedText);
  const marketCargoRows = parseCsv(marketCargosText);
  const baseCosts = exampleInputs.costs;
  const cargosParsed: CargoOption[] = [...committedRows, ...marketCargoRows].map((row, index) => {
    const source = index < committedRows.length ? "committed" : "market";
    const name = row.route || row.customer || `Cargo ${index + 1}`;
    const { baseQty, range: quantityRange } = parseQuantityRange(
      row.quantity,
      exampleInputs.cargo.cargoQty,
    );
    const freightRate = toNumber(row.freight_rate ?? "", exampleInputs.cargo.freightRate);
    const loadRate = parseRateFromTerms(row.loading_terms ?? "", exampleInputs.cargo.loadRate);
    const dischargeRate = parseRateFromTerms(row.discharge_terms ?? "", exampleInputs.cargo.dischargeRate);
    const loadportTT = parseTurnTimeDays(row.loading_terms ?? "", exampleInputs.cargo.loadportTT);
    const disportTT = parseTurnTimeDays(row.discharge_terms ?? "", exampleInputs.cargo.disportTT);
    const commissionPct = parsePercent(row.commission ?? "", 0);
    const commissionIsBroker = (row.commission ?? "").toLowerCase().includes("broker");
    const loadPortRaw = row.load_port ?? "";
    const dischargePortRaw = row.discharge_port ?? "";
    const loadPort = resolvePortName(loadPortRaw, ports);
    const dischargePort = resolvePortName(dischargePortRaw, ports);
    const portCosts = parsePortCosts(row.port_cost ?? "", baseCosts.portDisbLoad, baseCosts.portDisbDis);
    const laycanLabel = row.laycan ?? "";
    const laycanWindow = parseLaycanRange(laycanLabel);

    return {
      id: `${source}-${index}`,
      name,
      source,
      quantityRange,
      loadPort: loadPort || loadPortRaw || "UNKNOWN",
      dischargePort: dischargePort || dischargePortRaw || "UNKNOWN",
      portCosts,
      laycanLabel,
      laycanWindow,
      data: {
        ...exampleInputs.cargo,
        cargoQty: baseQty,
        freightRate,
        loadRate,
        dischargeRate,
        loadportTT,
        disportTT,
        portIdleDays: exampleInputs.cargo.portIdleDays,
        addressComsPct: commissionIsBroker ? 0 : commissionPct,
        brokerComsPct: commissionIsBroker ? commissionPct : 0,
      },
    };
  });

  let best:
    | (ReturnType<typeof calculateFreight> & {
        adjustedProfit: number;
        waitingCost: number;
        laycanEvaluation?: LaycanEvaluation;
        vessel: VesselOption;
        cargo: CargoOption;
        ballastNm: number;
        ladenNm: number;
        cargoQty: number;
        ballastDistanceKnown: boolean;
        ladenDistanceKnown: boolean;
      })
    | null = null;

  let skippedWeight = 0;
  let skippedQuantity = 0;
  let skippedLaycan = 0;
  let skippedLaycanUnknown = 0;
  let skippedZeroFreight = 0;
  let evaluated = 0;
  const speedSteps = blendValues.length;
  const totalQtySteps = cargosParsed.reduce((sum, cargo) => {
    const baseQty = cargo.data.cargoQty;
    const qtyRange = cargo.quantityRange;
    const qtyMin = qtyRange ? Math.min(qtyRange.min, qtyRange.max) : baseQty;
    const qtyMax = qtyRange ? Math.max(qtyRange.min, qtyRange.max) : baseQty;
    const qtyStep = Math.max(baseQty * 0.01, 1);
    const steps = Math.max(1, Math.floor((qtyMax - qtyMin) / qtyStep) + 1);
    return sum + steps;
  }, 0);
  const combosBeforeFilters =
    vesselsParsed.length * totalQtySteps * speedSteps * speedSteps;

  for (const vessel of vesselsParsed) {
    for (const cargo of cargosParsed) {
      if (!Number.isFinite(cargo.data.freightRate) || cargo.data.freightRate <= 0) {
        skippedZeroFreight += 1;
        continue;
      }
      const ballastNm = getDistance(parsedDistances.distanceMap, vessel.currentPort, cargo.loadPort);
      const ladenNm = getDistance(parsedDistances.distanceMap, cargo.loadPort, cargo.dischargePort);
      const ballastDistanceKnown = isDistanceKnown(
        parsedDistances.distanceMap,
        vessel.currentPort,
        cargo.loadPort,
      );
      const ladenDistanceKnown = isDistanceKnown(
        parsedDistances.distanceMap,
        cargo.loadPort,
        cargo.dischargePort,
      );
      const laycanWindow = cargo.laycanWindow ?? null;
      const departureDate = parseDateInput(vessel.etdDate) ?? parseDateInput(todayIso);
      let laycanEvaluation: LaycanEvaluation | undefined;
      if (!laycanWindow || !departureDate) {
        skippedLaycanUnknown += 1;
        continue;
      }
      laycanEvaluation = evaluateLaycan({
        departureDate,
        ballastNm,
        ballastSpeed: vessel.data.speed.ballast,
        laycan: laycanWindow,
      });
      if (laycanEvaluation.status === "infeasible") {
        skippedLaycan += 1;
        continue;
      }

      const baseQty = cargo.data.cargoQty;
      const qtyRange = cargo.quantityRange;
      const qtyMin = qtyRange ? Math.min(qtyRange.min, qtyRange.max) : baseQty;
      const qtyMax = qtyRange ? Math.max(qtyRange.min, qtyRange.max) : baseQty;
      const qtyStep = Math.max(baseQty * 0.01, 1);
      const qtyValues: number[] = [];
      if (qtyRange) {
        for (let qty = qtyMin; qty <= qtyMax + 1e-6; qty += qtyStep) {
          qtyValues.push(qty);
        }
      } else {
        qtyValues.push(baseQty);
      }

      for (const cargoQty of qtyValues) {
        const rangeCheck = getQuantityRangeFeasibility(cargoQty, cargo.quantityRange);
        if (rangeCheck.status === "infeasible") {
          skippedQuantity += 1;
          continue;
        }
        const weightCheck = getWeightFeasibility(cargoQty, vessel.data.dwt);
        if (weightCheck.status === "infeasible") {
          skippedWeight += 1;
          continue;
        }

        for (const ballastBlend of blendValues) {
          for (const ladenBlend of blendValues) {
            const inputs: FreightInputs = {
              vessel: vessel.data,
              cargo: { ...cargo.data, cargoQty },
              distances: { ballastNm, ladenNm },
              costs: {
                ...exampleInputs.costs,
                portDisbLoad: cargo.portCosts.load,
                portDisbDis: cargo.portCosts.discharge,
              },
              options: {
                bunkerDays: exampleInputs.options.bunkerDays,
                speedBlend: { ballast: ballastBlend, laden: ladenBlend },
              },
            };

            const result = calculateFreight(inputs);
            evaluated += 1;

            let waitingCost = 0;
            if (laycanEvaluation?.status === "early" && laycanEvaluation.waitingDays > 0) {
              const waitingHireCost = laycanEvaluation.waitingDays * vessel.data.dailyHire;
              const waitingFuelCost =
                laycanEvaluation.waitingDays *
                (vessel.data.portConsumption.idle.ifo * inputs.costs.ifoPrice +
                  vessel.data.portConsumption.idle.mdo * inputs.costs.mdoPrice);
              waitingCost = waitingHireCost + waitingFuelCost;
            }
            const adjustedProfit = result.profit - waitingCost;

            if (!best || adjustedProfit > best.adjustedProfit) {
              best = {
                ...result,
                adjustedProfit,
                waitingCost,
                laycanEvaluation,
                vessel,
                cargo,
                ballastNm,
                ladenNm,
                cargoQty,
                ballastDistanceKnown,
                ladenDistanceKnown,
              };
            }
          }
        }
      }
    }
  }

  if (!best) {
    const reply = [
      "No feasible profitable plan found in current business_data.",
      `Evaluated: ${evaluated}, skipped qty range: ${skippedQuantity}, skipped DWT: ${skippedWeight}, skipped laycan infeasible: ${skippedLaycan}.`,
      "Please verify CSV data, laycan fields, and port info completeness.",
      `skippedZeroFreight=${skippedZeroFreight}, skippedLaycanUnknown=${skippedLaycanUnknown}`,
    ].join("\n");
    const context = [
      "BEST_PLAN: none",
      `evaluated=${evaluated}`,
      `skippedQuantity=${skippedQuantity}`,
      `skippedWeight=${skippedWeight}`,
      `skippedLaycan=${skippedLaycan}`,
      `skippedZeroFreight=${skippedZeroFreight}`,
      `skippedLaycanUnknown=${skippedLaycanUnknown}`,
    ].join("\n");
    return { reply, context };
  }

  const laycanStatus = best.laycanEvaluation?.status ?? "unknown";
  const etaLabel = formatDateLabel(best.laycanEvaluation?.eta);
  const laycanLabel = best.cargo.laycanLabel || "--";
  const distanceFallbackFlag = !best.ballastDistanceKnown || !best.ladenDistanceKnown;
  const ballastSourceLabel = best.ballastDistanceKnown ? "port_distances.csv" : "fallback (default 3000 nm)";
  const ladenSourceLabel = best.ladenDistanceKnown ? "port_distances.csv" : "fallback (default 3000 nm)";

  const reply = [
    "Most profitable plan (using current business_data and /src/calculator):",
    `- Vessel: ${best.vessel.name} (${best.vessel.source})`,
    `- Cargo: ${best.cargo.name} (${best.cargo.source})`,
    `- Route: ${best.vessel.currentPort} -> ${best.cargo.loadPort} -> ${best.cargo.dischargePort}`,
    `- Adjusted profit: ${formatMoney(best.adjustedProfit)} (raw profit: ${formatMoney(best.profit)})`,
    `- TCE: ${formatMoney(best.tce)}/day`,
    `- Cargo qty: ${formatNumber(best.cargoQty)} MT, freight rate: ${formatMoney(best.cargo.data.freightRate)}/MT`,
    `- Distance: Ballast ${formatNumber(best.ballastNm)} nm (${ballastSourceLabel}) / Laden ${formatNumber(best.ladenNm)} nm (${ladenSourceLabel})`,
    `- Laycan: ${laycanLabel} | ETA: ${etaLabel} | Status: ${laycanStatus}`,
    best.waitingCost > 0 ? `- Waiting cost: ${formatMoney(best.waitingCost)}` : "- Waiting cost: 0",
    "- Distance source: shown per leg above",
    "",
    "Filters applied:",
    "- Exclude freight <= 0",
    "- Exclude missing laycan (unknown) and laycan miss",
    "- Exclude quantity/DWT infeasible combos",
    "- Search strategy: cargo quantity steps at 1%, speedBlend ballast/laden steps at 1%",
    `- Combination count: vessels(${vesselsParsed.length}) x cargo-qty steps(${totalQtySteps}) x speed(${speedSteps}^2) = ${formatNumber(combosBeforeFilters)}`,
    `- Evaluated (after filters): ${formatNumber(evaluated)}`,
    "",
    "Core formulas:",
    "Profit = Net revenue - (Net hire + Bunkers + Port/Operating/Misc)",
    "Net revenue = Net freight + ballast bonus",
    "TCE = Profit / total duration",
    "",
    "Key inputs/assumptions:",
    `- Default bunker prices: IFO ${formatMoney(exampleInputs.costs.ifoPrice)}/MT, MDO ${formatMoney(exampleInputs.costs.mdoPrice)}/MT`,
    `- If port distance is missing, default ${formatNumber(defaultDistanceNm)} nm`,
    "- speedBlend searched from 0.00 to 1.00 in 1% steps",
  ].join("\n");

  const context = [
    "BEST_PLAN:",
    `vessel=${best.vessel.name}`,
    `cargo=${best.cargo.name}`,
    `route=${best.vessel.currentPort} -> ${best.cargo.loadPort} -> ${best.cargo.dischargePort}`,
    `adjustedProfit=${best.adjustedProfit}`,
    `profit=${best.profit}`,
    `tce=${best.tce}`,
    `laycanStatus=${laycanStatus}`,
    `eta=${etaLabel}`,
    `distanceFallback=${distanceFallbackFlag}`,
    `evaluated=${evaluated}`,
    `skippedZeroFreight=${skippedZeroFreight}`,
    `skippedLaycanUnknown=${skippedLaycanUnknown}`,
    `skippedLaycan=${skippedLaycan}`,
  ].join("\n");

  return { reply, context };
};

const extractReply = (data: any) => {
  if (data?.choices?.[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }
  const outputText = data?.output?.[0]?.content?.[0]?.text;
  return typeof outputText === "string" ? outputText : "";
};

export async function POST(req: Request) {
  const missingEnv = [
    "BEDROCK_BASE_URL",
    "BEDROCK_OPENAI_API_KEY",
    "BEDROCK_TEAM_API_KEY",
    "BEDROCK_MODEL",
  ].filter((key) => !process.env[key]);

  if (missingEnv.length > 0) {
    return NextResponse.json(
      { error: `Missing env: ${missingEnv.join(", ")}` },
      { status: 500 }
    );
  }

  const baseURL = process.env.BEDROCK_BASE_URL ?? "";
  if (!/^https?:\/\/.+/i.test(baseURL)) {
    return NextResponse.json(
      { error: "Invalid BEDROCK_BASE_URL (must start with http/https)" },
      { status: 500 }
    );
  }

  try {
    const { message } = await req.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const endpoint = new URL("chat/completions", baseURL.endsWith("/") ? baseURL : `${baseURL}/`);

    const readTextFile = async (filePath: string, maxChars: number) => {
      const content = await fs.readFile(filePath, "utf8");
      if (content.length <= maxChars) return content;
      return `${content.slice(0, maxChars)}\n... (truncated)`;
    };

    const readDirectoryFiles = async (
      baseDir: string,
      extensions: string[],
      maxCharsPerFile: number,
      maxFiles: number,
    ) => {
      const results: Array<{ path: string; content: string }> = [];
      const queue: string[] = [baseDir];
      const allowed = new Set(extensions.map((ext) => ext.toLowerCase()));

      while (queue.length > 0 && results.length < maxFiles) {
        const current = queue.shift();
        if (!current) continue;
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= maxFiles) break;
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            queue.push(fullPath);
            continue;
          }
          const ext = path.extname(entry.name).toLowerCase();
          if (!allowed.has(ext)) continue;
          const content = await readTextFile(fullPath, maxCharsPerFile);
          const relative = path.relative(process.cwd(), fullPath);
          results.push({ path: relative, content });
        }
      }

      return results;
    };

    const safeRead = async <T,>(label: string, fn: () => Promise<T>, fallback: T) => {
      try {
        return await fn();
      } catch (err) {
        console.error(`Failed to read ${label}:`, err);
        return fallback;
      }
    };

    const knowledgeDir = path.join(process.cwd(), "knowledge");
    const publicDir = path.join(process.cwd(), "public");
    const calculatorDir = path.join(process.cwd(), "src", "calculator");
    const dataDir = path.join(process.cwd(), "data");

    const bestPlan = await safeRead("best plan", computeBestPlanSummary, null);
    const bestPortfolio = await safeRead("best portfolio", computeBestPortfolioSummary, null);

    const knowledgeFiles = await safeRead(
      "knowledge",
      () => readDirectoryFiles(knowledgeDir, [".md", ".txt"], 12000, 20),
      [],
    );
    const publicFiles = await safeRead(
      "public",
      () => readDirectoryFiles(publicDir, [".md", ".txt", ".csv"], 12000, 40),
      [],
    );
    const calculatorFiles = await safeRead(
      "calculator",
      () => readDirectoryFiles(calculatorDir, [".ts"], 12000, 20),
      [],
    );

    const traceJson = await safeReadJson(path.join(dataDir, "portfolio_trace.json"), null);
    const topkJson = await safeReadJson(path.join(dataDir, "topk_portfolios.json"), null);
    const thresholdsJson = await safeReadJson(path.join(dataDir, "thresholds.json"), null);
    const portfolioContextPack = buildPortfolioContextPack({
      trace: traceJson,
      topk: topkJson,
      thresholds: thresholdsJson,
    });

    const buildContextBlock = (title: string, files: Array<{ path: string; content: string }>) => {
      if (!files.length) return `${title}: (none)\n`;
      return [
        `${title}:`,
        ...files.map(
          (file) =>
            `---\n[${file.path}]\n${file.content.trim()}\n`,
        ),
      ].join("\n");
    };

    const systemContent = [
      "You are a helpful assistant for the SlashOps prototype.",
      "Use the provided knowledge and data to answer user questions.",
      "If data is missing or truncated, say so clearly.",
      "When answering judge questions about BEST_PORTFOLIO, explicitly cite TRACE_SUMMARY, TOP1_TOP2_ONE_SENTENCE, TOP1_TOP2_KEY_DELTAS, THRESHOLD_BUNKER, THRESHOLD_DELAY from PORTFOLIO_CONTEXT_PACK. Do not invent missing values.",
      bestPlan ? `\n${bestPlan.context}\n` : "\nBEST_PLAN: unavailable\n",
      bestPortfolio ? `\n${bestPortfolio.context}\n` : "\nBEST_PORTFOLIO: unavailable\n",
      `\n${portfolioContextPack}\n`,
      "",
      buildContextBlock("KNOWLEDGE", knowledgeFiles),
      buildContextBlock("PUBLIC_DATA", publicFiles),
      buildContextBlock("CALCULATOR_CODE", calculatorFiles),
    ].join("\n");

    const bestPortfolioTrigger =
      /portfolio|multiple|multi|fleet|portfolio best|best portfolio|portfolio profit|portfolio plan/i;
    const bestPlanTrigger =
      /most\s+profitable|highest\s+profit|best\s+plan|best\s+voyage|most profitable plan|best voyage|best plan/i;
    const whyNotSecondTrigger = /why\s+not\s+second|why\s+not\s+2nd|why\s+second|why\s+not\s+top\s*2/i;

    if (whyNotSecondTrigger.test(message)) {
      const hasDiff =
        topkJson &&
        (topkJson?.diff?.one_sentence ||
          topkJson?.top1_top2_diff?.summary ||
          topkJson?.top1_top2_diff?.one_sentence);
      if (!hasDiff) {
        return NextResponse.json({
          reply:
            "Top-2 comparison data is missing. Please run the portfolio pipeline to generate data/topk_portfolios.json, then retry. TODO: generate top1/top2 diff.",
        });
      }
    }
    if (bestPortfolio && bestPortfolioTrigger.test(message)) {
      return NextResponse.json({ reply: bestPortfolio.reply });
    }
    if (bestPlan && bestPlanTrigger.test(message)) {
      return NextResponse.json({ reply: bestPlan.reply });
    }
    try {
      const upstream = await fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.BEDROCK_OPENAI_API_KEY!}`,
          "x-api-key": process.env.BEDROCK_TEAM_API_KEY!,
        },
        body: JSON.stringify({
          model: process.env.BEDROCK_MODEL!,
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: message },
          ],
        }),
      });

      const text = await upstream.text();
      if (!upstream.ok) {
        console.error("Upstream /chat/completions failed:", upstream.status, text);
        return NextResponse.json(
          { error: `Upstream error (${upstream.status})`, details: text },
          { status: 500 }
        );
      }

      const data = text ? JSON.parse(text) : {};
      return NextResponse.json({ reply: extractReply(data) });
    } catch (err) {
      console.error("Upstream /chat/completions failed:", err);
      if (bestPortfolio) {
        return NextResponse.json({
          reply:
            "Upstream chat API unavailable; returning best portfolio based on local data.\n\n" +
            bestPortfolio.reply,
        });
      }
      if (bestPlan) {
        return NextResponse.json({
          reply:
            "Upstream chat API unavailable; returning best plan based on local data.\n\n" +
            bestPlan.reply,
        });
      }
      return NextResponse.json(
        { error: "Upstream chat API unavailable", hint: "Check BEDROCK connectivity or try again." },
        { status: 502 }
      );
    }
  } catch (err: any) {
    console.error("POST /api/chat failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error", hint: "Check server logs for details." },
      { status: 500 }
    );
  }
}

