import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { calculateFreight, exampleInputs, type FreightInputs } from "@/calculator/freightCalculator";
import { evaluateLaycan, parseDateInput, parseLaycanRange, type LaycanEvaluation } from "@/calculator/laycan";
import { getQuantityRangeFeasibility, getWeightFeasibility, type QuantityRange } from "@/calculator/weight";
import {
  defaultDistanceNm,
  extractPortFromStatus,
  getDistance,
  parseDistanceCsv,
  resolvePortName,
} from "@/calculator/portDistances";

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

type PairResult = ReturnType<typeof calculateFreight> & {
  adjustedProfit: number;
  waitingCost: number;
  laycanEvaluation?: LaycanEvaluation;
  vessel: VesselOption;
  cargo: CargoOption;
  ballastNm: number;
  ladenNm: number;
  cargoQty: number;
  speedBlend: { ballast: number; laden: number };
  ballastDistanceKnown: boolean;
  ladenDistanceKnown: boolean;
};

const formatMoney = (value: number | undefined | null) =>
  (Number.isFinite(value ?? NaN) ? (value as number) : 0).toLocaleString("en-US", {
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
        range: { min, max },
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
      range: { min, max },
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
    const multiplier =
      match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2]?.toUpperCase() === "K" ? 1_000 : 1;
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
const blendValues = Array.from({ length: 101 }, (_, i) =>
  Number.parseFloat((i * speedStep).toFixed(2)),
);

const buildCombos = (count: number, pick: number) => {
  const combos: number[][] = [];
  const walk = (start: number, current: number[]) => {
    if (current.length === pick) {
      combos.push([...current]);
      return;
    }
    for (let i = start; i <= count - (pick - current.length); i += 1) {
      current.push(i);
      walk(i + 1, current);
      current.pop();
    }
  };
  walk(0, []);
  return combos;
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bunkerPrices = {
      ifo: Number.isFinite(body?.bunkerPrices?.ifo)
        ? Number(body.bunkerPrices.ifo)
        : exampleInputs.costs.ifoPrice,
      mdo: Number.isFinite(body?.bunkerPrices?.mdo)
        ? Number(body.bunkerPrices.mdo)
        : exampleInputs.costs.mdoPrice,
    };
    const portDelayDays = Number.isFinite(body?.portDelayDays)
      ? Number(body.portDelayDays)
      : 0;
    const marketHireRate = Number.isFinite(body?.marketHireRate)
      ? Number(body.marketHireRate)
      : exampleInputs.vessel.dailyHire;
    const vesselCount = Number.isFinite(body?.vesselCount)
      ? Math.max(1, Math.floor(Number(body.vesselCount)))
      : 4;

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

    const capesizeRows = parseCsv(capesizeText);
    const marketRows = parseCsv(marketVesselsText);
    const vesselsParsed: VesselOption[] = [...capesizeRows, ...marketRows].map((row, index) => {
      const source = index < capesizeRows.length ? "capesize" : "market";
      const name = row.vessel_name || `Vessel ${index + 1}`;
      const dwt = toNumber(row.dwt_mt, exampleInputs.vessel.dwt);
      const ecoLaden = toNumber(row.economical_speed_laden_kn, exampleInputs.vessel.speed.laden);
      const ecoBallast = toNumber(
        row.economical_speed_ballast_kn,
        exampleInputs.vessel.speed.ballast,
      );
      const ecoLadenVlsfo = toNumber(
        row.economical_speed_laden_vlsfo_mt ?? row.economical_speed_laden_vlsf_mt,
        exampleInputs.vessel.consumption.laden.ifo,
      );
      const ecoBallastVlsfo = toNumber(
        row.economical_speed_ballast_vlsfo_mt ?? row.economical_speed_ballast_vlsf_mt,
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
        row.warranted_speed_laden_vlsf_mt ?? row.warranted_speed_laden_vlsfo_mt,
        exampleInputs.vessel.consumptionWarranted.laden.ifo,
      );
      const warrantedBallastVlsfo = toNumber(
        row.warranted_speed_ballast_vlsf_mt ?? row.warranted_speed_ballast_vlsfo_mt,
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
        row.port_consumption_idle_vlsfo_mt_day ?? row.port_consumption_idle_vlsf_mt_day,
        exampleInputs.vessel.portConsumption.idle.ifo,
      );
      const portWorking = toNumber(
        row.port_consumption_working_vlsfo_mt_day ?? row.port_consumption_working_vlsf_mt_day,
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
        data: {
          dwt,
          grainCapacity: dwt,
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
            working: {
              ifo: portWorking,
              mdo: exampleInputs.vessel.portConsumption.working.mdo,
            },
            idle: { ifo: portIdle, mdo: exampleInputs.vessel.portConsumption.idle.mdo },
          },
          dailyHire:
            source === "market"
              ? marketHireRate
              : toNumber(row.hire_rate_usd_day, exampleInputs.vessel.dailyHire),
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
      const dischargeRate = parseRateFromTerms(
        row.discharge_terms ?? "",
        exampleInputs.cargo.dischargeRate,
      );
      const loadportTT = parseTurnTimeDays(row.loading_terms ?? "", exampleInputs.cargo.loadportTT);
      const disportTT = parseTurnTimeDays(
        row.discharge_terms ?? "",
        exampleInputs.cargo.disportTT,
      );
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
    const committedCount = committedRows.length;
    const marketCount = marketCargoRows.length;

    if (cargosParsed.length === 0 || vesselsParsed.length === 0) {
      return NextResponse.json({
        reply: "Missing vessel or cargo data. Please check CSV files in /public.",
      });
    }

    let calcCount = 0;

    const computeBestPair = (vessel: VesselOption, cargo: CargoOption) => {
      if (!Number.isFinite(cargo.data.freightRate) || cargo.data.freightRate <= 0) {
        return null;
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
              cargo: {
                ...cargo.data,
                cargoQty,
                portIdleDays: cargo.data.portIdleDays + portDelayDays,
              },
              distances: { ballastNm, ladenNm },
              costs: {
                ...exampleInputs.costs,
                ifoPrice: bunkerPrices.ifo,
                mdoPrice: bunkerPrices.mdo,
                portDisbLoad: cargo.portCosts.load,
                portDisbDis: cargo.portCosts.discharge,
              },
              options: {
                bunkerDays: exampleInputs.options.bunkerDays,
                speedBlend: { ballast: ballastBlend, laden: ladenBlend },
              },
            };

            const result = calculateFreight(inputs);
            calcCount += 1;

            let waitingCost = 0;
            if (laycanEvaluation.status === "early" && laycanEvaluation.waitingDays > 0) {
              const waitingHireCost = laycanEvaluation.waitingDays * vessel.data.dailyHire;
              const waitingFuelCost =
                laycanEvaluation.waitingDays *
                (vessel.data.portConsumption.idle.ifo * bunkerPrices.ifo +
                  vessel.data.portConsumption.idle.mdo * bunkerPrices.mdo);
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
                speedBlend: { ballast: ballastBlend, laden: ladenBlend },
                ballastDistanceKnown,
                ladenDistanceKnown,
              };
            }
          }
        }
      }

      return best;
    };

    const pairResults: Array<Array<PairResult | null>> = vesselsParsed.map((vessel) =>
      cargosParsed.map((cargo) => computeBestPair(vessel, cargo)),
    );

    const totalVessels = vesselsParsed.length;
    const vesselPick = Math.min(vesselCount, totalVessels);
    const vesselCombos = buildCombos(totalVessels, vesselPick);
    const marketOffset = committedCount;

    if (committedCount > vesselPick) {
      return NextResponse.json({
        reply: `Committed cargos (${committedCount}) exceed selected vessels (${vesselPick}). Increase vessel count or reduce committed cargos.`,
      });
    }

    let maxProfit = 0;
    for (const row of pairResults) {
      for (const pair of row) {
        if (pair && Number.isFinite(pair.adjustedProfit) && pair.adjustedProfit > maxProfit) {
          maxProfit = pair.adjustedProfit;
        }
      }
    }
    const big = maxProfit + 1_000_000_000;

    type PortfolioResult = {
      vessels: VesselOption[];
      assignments: Array<{ vessel: VesselOption; cargo: CargoOption; pair: PairResult }>;
      totalProfit: number;
    };

    let bestPortfolio: PortfolioResult | null = null;
    let evaluatedPortfolios = 0;

    for (const combo of vesselCombos) {
      const selected = combo.map((idx) => vesselsParsed[idx]);
      const assignments: Array<{ vessel: VesselOption; cargo: CargoOption; pair: PairResult }> = [];
      let total = 0;
      let feasible = true;
      const usedVesselPositions = new Set<number>();

      if (committedCount > 0) {
        const committedCost = Array.from({ length: committedCount }, (_, cargoIdx) =>
          Array.from({ length: vesselPick }, (_, vesselPos) => {
            const vesselIdx = combo[vesselPos];
            const pair = pairResults[vesselIdx][cargoIdx];
            return pair ? maxProfit - pair.adjustedProfit : big;
          }),
        );
        const committedAssignment = hungarian(committedCost);
        for (let cargoIdx = 0; cargoIdx < committedCount; cargoIdx += 1) {
          const vesselPos = committedAssignment[cargoIdx];
          if (vesselPos < 0 || vesselPos >= vesselPick) {
            feasible = false;
            break;
          }
          if (usedVesselPositions.has(vesselPos)) {
            feasible = false;
            break;
          }
          const vesselIdx = combo[vesselPos];
          const pair = pairResults[vesselIdx][cargoIdx];
          if (!pair || !Number.isFinite(pair.adjustedProfit)) {
            feasible = false;
            break;
          }
          usedVesselPositions.add(vesselPos);
          assignments.push({ vessel: vesselsParsed[vesselIdx], cargo: cargosParsed[cargoIdx], pair });
          total += pair.adjustedProfit;
        }
      }

      if (!feasible) {
        continue;
      }

      const remainingPositions: number[] = [];
      for (let pos = 0; pos < vesselPick; pos += 1) {
        if (!usedVesselPositions.has(pos)) {
          remainingPositions.push(pos);
        }
      }

      if (remainingPositions.length > 0 && marketCount > 0) {
        const marketCost = Array.from({ length: remainingPositions.length }, (_, rowIdx) =>
          Array.from({ length: marketCount + remainingPositions.length }, (_, colIdx) => {
            if (colIdx >= marketCount) return maxProfit;
            const vesselIdx = combo[remainingPositions[rowIdx]];
            const cargoIdx = marketOffset + colIdx;
            const pair = pairResults[vesselIdx][cargoIdx];
            return pair ? maxProfit - pair.adjustedProfit : big;
          }),
        );
        const marketAssignment = hungarian(marketCost);
        for (let rowIdx = 0; rowIdx < remainingPositions.length; rowIdx += 1) {
          const colIdx = marketAssignment[rowIdx];
          if (colIdx < 0 || colIdx >= marketCount) continue;
          const vesselIdx = combo[remainingPositions[rowIdx]];
          const cargoIdx = marketOffset + colIdx;
          const pair = pairResults[vesselIdx][cargoIdx];
          if (!pair || !Number.isFinite(pair.adjustedProfit) || pair.adjustedProfit <= 0) {
            continue;
          }
          assignments.push({ vessel: vesselsParsed[vesselIdx], cargo: cargosParsed[cargoIdx], pair });
          total += pair.adjustedProfit;
        }
      }

      evaluatedPortfolios += 1;
      if (!bestPortfolio || total > bestPortfolio.totalProfit) {
        bestPortfolio = { vessels: selected, assignments, totalProfit: total };
      }
    }

    if (!bestPortfolio) {
      return NextResponse.json({
        reply:
          "No feasible recommendation found for the committed/market cargos with the current inputs.",
      });
    }

    const assignedVesselIds = new Set(bestPortfolio.assignments.map((item) => item.vessel.id));
    const unassigned = bestPortfolio.vessels.filter((vessel) => !assignedVesselIds.has(vessel.id));
    const assignedCargoCount = bestPortfolio.assignments.length;
    const assignedCommittedCount = bestPortfolio.assignments.filter(
      (item) => item.cargo.source === "committed",
    ).length;
    const assignedMarketCount = assignedCargoCount - assignedCommittedCount;

    const hireNote = `Market vessels are assumed to be chartered-in at a daily hire rate of ${formatMoney(marketHireRate)}/day, applied uniformly for fair comparison against Cargill-owned vessels.`;
    const riskNote =
      "Legs marked [FALLBACK] rely on default distance; ETA, bunker, and profit may be materially off.";

    const replyLines = [
      `Recommendation (${vesselPick} vessels + committed/market cargos)`,
      `Inputs: IFO ${formatMoney(bunkerPrices.ifo)}/MT, MDO ${formatMoney(bunkerPrices.mdo)}/MT, Port delay +${formatNumber(portDelayDays)} days`,
      `Search: vessels=${totalVessels}, choose=${vesselPick}, combos=${formatNumber(vesselCombos.length)}, assignments tested=${formatNumber(evaluatedPortfolios)}, freight calcs=${formatNumber(calcCount)}`,
      `Cargos: committed=${committedCount}, market=${marketCount}, assigned=${assignedCargoCount} (committed ${assignedCommittedCount}, market ${assignedMarketCount})`,
      "",
      `Best total adjusted profit: ${formatMoney(bestPortfolio.totalProfit)}`,
      "Selected vessels:",
      ...bestPortfolio.vessels.map((vessel) => {
        const label =
          vessel.source === "market" ? "Market charter-in vessel" : "Cargill-owned vessel";
        const hire =
          vessel.source === "market"
            ? ` — Assumed hire: ${formatMoney(marketHireRate)}/day (chartered-in)`
            : "";
        return `- ${vessel.name} (${label})${hire}`;
      }),
      "",
      hireNote,
      "",
      "Assignments:",
      ...bestPortfolio.assignments.map((item, idx) => {
        const laycanStatus = item.pair.laycanEvaluation?.status ?? "unknown";
        const waitingDays =
          laycanStatus === "early" ? item.pair.laycanEvaluation?.waitingDays ?? 0 : 0;
        const route = `${item.vessel.currentPort} -> ${item.cargo.loadPort} -> ${item.cargo.dischargePort}`;
        const ballastMarker = item.pair.ballastDistanceKnown ? "" : " [FALLBACK]";
        const ladenMarker = item.pair.ladenDistanceKnown ? "" : " [FALLBACK]";
        const vesselType =
          item.vessel.source === "market"
            ? `Market charter-in vessel (assumed hire ${formatMoney(marketHireRate)}/day, chartered-in)`
            : "Cargill-owned vessel";
        return (
            `${idx + 1}. ${item.vessel.name} -> ${item.cargo.name} (${item.cargo.source})\n` +
          `   Vessel type: ${vesselType}\n` +
          `   Route: ${route}\n` +
          `   Distance: Ballast ${formatNumber(item.pair.ballastNm)} nm${ballastMarker} | ` +
          `Laden ${formatNumber(item.pair.ladenNm)} nm${ladenMarker}\n` +
          `   Qty: ${formatNumber(item.pair.cargoQty)} MT | TCE: ${formatMoney(item.pair.tce)}/day\n` +
          `   Profit: ${formatMoney(item.pair.profit)} | Waiting: ${formatMoney(item.pair.waitingCost)} | Adjusted: ${formatMoney(item.pair.adjustedProfit)}\n` +
          `   Laycan: ${item.cargo.laycanLabel || "--"} | Status: ${laycanStatus} | Waiting days: ${formatNumber(waitingDays)}\n` +
          `   Speed blend: ballast ${item.pair.speedBlend.ballast}, laden ${item.pair.speedBlend.laden}`
        );
      }),
      "",
      unassigned.length
        ? `Decision: not assigning vessel(s): ${unassigned.map((vessel) => vessel.name).join(", ")}`
        : "Decision: not assigning vessel(s): NONE",
      "",
      `Notes: Distances fallback to ${formatNumber(defaultDistanceNm)} nm if missing from port_distances.csv.`,
      `Risk note: ${riskNote}`,
    ];

    const data = {
      summary: {
        totalAdjustedProfit: bestPortfolio.totalProfit,
        vesselCount: vesselPick,
        cargoCount: assignedCargoCount,
      },
      inputs: {
        ifoPrice: bunkerPrices.ifo,
        mdoPrice: bunkerPrices.mdo,
        portDelayDays,
        marketHireRate,
      },
      search: {
        totalVessels,
        vesselPick,
        combos: vesselCombos.length,
        assignmentsTested: evaluatedPortfolios,
        freightCalcs: calcCount,
      },
      selectedVessels: bestPortfolio.vessels.map((vessel) => ({
        name: vessel.name,
        source: vessel.source,
        label: vessel.source === "market" ? "Market charter-in vessel" : "Cargill-owned vessel",
        assumedHireRate: vessel.source === "market" ? marketHireRate : null,
        charteredIn: vessel.source === "market",
      })),
      assignments: bestPortfolio.assignments.map((item, idx) => {
        const laycanStatus = item.pair.laycanEvaluation?.status ?? "unknown";
        const waitingDays =
          laycanStatus === "early" ? item.pair.laycanEvaluation?.waitingDays ?? 0 : 0;
        const route = `${item.vessel.currentPort} -> ${item.cargo.loadPort} -> ${item.cargo.dischargePort}`;
        return {
          index: idx + 1,
          vesselName: item.vessel.name,
          vesselLabel:
            item.vessel.source === "market" ? "Market charter-in vessel" : "Cargill-owned vessel",
          charteredIn: item.vessel.source === "market",
          assumedHireRate: item.vessel.source === "market" ? marketHireRate : null,
          cargoName: item.cargo.name,
          cargoSource: item.cargo.source,
          route,
          cargoQty: item.pair.cargoQty,
          tce: item.pair.tce,
          profit: item.pair.profit,
          waitingCost: item.pair.waitingCost,
          adjustedProfit: item.pair.adjustedProfit,
          laycanLabel: item.cargo.laycanLabel || "--",
          laycanStatus,
          waitingDays,
          speedBlend: item.pair.speedBlend,
          distances: {
            ballastNm: item.pair.ballastNm,
            ladenNm: item.pair.ladenNm,
            ballastFallback: !item.pair.ballastDistanceKnown,
            ladenFallback: !item.pair.ladenDistanceKnown,
          },
        };
      }),
      decision: {
        unassigned: unassigned.map((vessel) => vessel.name),
      },
      notes: {
        distanceFallbackNm: defaultDistanceNm,
        hireNote,
        riskNote,
      },
    };

    return NextResponse.json({ reply: replyLines.join("\n"), data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
