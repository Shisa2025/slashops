import { getEffectiveProfile, type SpeedBlend } from "./speed";

export type FreightInputs = {
  vessel: {
    dwt: number;
    grainCapacity: number;
    speed: {
      ballast: number;
      laden: number;
    };
    speedWarranted: {
      ballast: number;
      laden: number;
    };
    consumption: {
      ballast: { ifo: number; mdo: number };
      laden: { ifo: number; mdo: number };
    };
    consumptionWarranted: {
      ballast: { ifo: number; mdo: number };
      laden: { ifo: number; mdo: number };
    };
    portConsumption: {
      working: { ifo: number; mdo: number };
      idle: { ifo: number; mdo: number };
    };
    dailyHire: number;
    adComsPct: number;
  };
  cargo: {
    cargoQty: number;
    stowFactor: number;
    freightRate: number;
    addressComsPct: number;
    brokerComsPct: number;
    loadRate: number;
    dischargeRate: number;
    loadportTT: number;
    disportTT: number;
    portIdleDays: number;
    ballastBonus: number;
  };
  distances: {
    ballastNm: number;
    ladenNm: number;
  };
  costs: {
    ifoPrice: number;
    mdoPrice: number;
    cev: number;
    ilhoc: number;
    bunkerDa: number;
    portDisbLoad: number;
    portDisbDis: number;
    miscExpense: number;
  };
  options: {
    bunkerDays: number;
    speedBlend: SpeedBlend;
  };
};

export type FreightOutputs = {
  loadedQty: number;
  ballastDays: number;
  ladenDays: number;
  steamingDays: number;
  loadportDays: number;
  disportDays: number;
  totalDuration: number;
  freightGross: number;
  freightNet: number;
  freightCommissions: number;
  revenueNet: number;
  hireGross: number;
  hireNet: number;
  hireCommissions: number;
  ifoAtSea: number;
  mdoAtSea: number;
  ifoInPort: number;
  mdoInPort: number;
  totalIfo: number;
  totalMdo: number;
  bunkerExpense: number;
  portDisbursements: number;
  operatingExpenses: number;
  miscExpense: number;
  miscExpenseTotal: number;
  totalExpenses: number;
  profit: number;
  tce: number;
};

const daysAtSea = (nm: number, speed: number) => (speed > 0 ? nm / speed / 24 : 0);

export const calculateFreight = (inputs: FreightInputs): FreightOutputs => {
  const { vessel, cargo, distances, costs, options } = inputs;
  const effectiveProfile = getEffectiveProfile(
    { speed: vessel.speed, consumption: vessel.consumption },
    { speed: vessel.speedWarranted, consumption: vessel.consumptionWarranted },
    options.speedBlend,
  );

  const ballastDays = daysAtSea(distances.ballastNm, effectiveProfile.speed.ballast);
  const ladenDays = daysAtSea(distances.ladenNm, effectiveProfile.speed.laden);
  const steamingDays = ballastDays + ladenDays;

  const loadportWorkingDays = cargo.loadRate > 0 ? cargo.cargoQty / cargo.loadRate : 0;
  const disportWorkingDays = cargo.dischargeRate > 0 ? cargo.cargoQty / cargo.dischargeRate : 0;
  const loadportDays = loadportWorkingDays + cargo.loadportTT + cargo.portIdleDays;
  const disportDays = disportWorkingDays + cargo.disportTT;

  const totalDuration =
    steamingDays + options.bunkerDays + loadportDays + disportDays;

  const loadedQty = Math.min(
    cargo.cargoQty,
    vessel.grainCapacity / cargo.stowFactor,
    vessel.dwt,
  );

  const ifoAtSea =
    ballastDays * effectiveProfile.consumption.ballast.ifo +
    ladenDays * effectiveProfile.consumption.laden.ifo;
  const mdoAtSea =
    ballastDays * effectiveProfile.consumption.ballast.mdo +
    ladenDays * effectiveProfile.consumption.laden.mdo;

  const portWorkingDays = loadportWorkingDays + disportWorkingDays;
  const ifoInPort =
    portWorkingDays * vessel.portConsumption.working.ifo +
    cargo.portIdleDays * vessel.portConsumption.idle.ifo;
  const mdoInPort =
    portWorkingDays * vessel.portConsumption.working.mdo +
    cargo.portIdleDays * vessel.portConsumption.idle.mdo;

  const totalIfo = ifoAtSea + ifoInPort;
  const totalMdo = mdoAtSea + mdoInPort;
  const bunkerExpense = totalIfo * costs.ifoPrice + totalMdo * costs.mdoPrice;

  const hireGross = vessel.dailyHire * totalDuration;
  const hireCommissions = hireGross * vessel.adComsPct;
  const hireNet = hireGross - hireCommissions;

  const freightGross = loadedQty * cargo.freightRate;
  const freightCommissions = freightGross * (cargo.addressComsPct + cargo.brokerComsPct);
  const freightNet = freightGross - freightCommissions;
  const revenueNet = freightNet + cargo.ballastBonus;

  const portDisbursements = costs.portDisbLoad + costs.portDisbDis;
  const operatingExpenses = costs.cev + costs.ilhoc + costs.bunkerDa;
  const miscExpense = costs.miscExpense;
  const miscExpenseTotal = operatingExpenses + portDisbursements + miscExpense;
  const totalExpenses = hireNet + bunkerExpense + miscExpenseTotal;

  const profit = revenueNet - totalExpenses;
  const tce = totalDuration > 0 ? profit / totalDuration : 0;

  return {
    loadedQty,
    ballastDays,
    ladenDays,
    steamingDays,
    loadportDays,
    disportDays,
    totalDuration,
    freightGross,
    freightNet,
    freightCommissions,
    revenueNet,
    hireGross,
    hireNet,
    hireCommissions,
    ifoAtSea,
    mdoAtSea,
    ifoInPort,
    mdoInPort,
    totalIfo,
    totalMdo,
    bunkerExpense,
    portDisbursements,
    operatingExpenses,
    miscExpense,
    miscExpenseTotal,
    totalExpenses,
    profit,
    tce,
  };
};

export const exampleInputs: FreightInputs = {
  vessel: {
    dwt: 62000,
    grainCapacity: 70000,
    speed: { ballast: 14, laden: 12 },
    speedWarranted: { ballast: 14, laden: 12 },
    consumption: {
      ballast: { ifo: 23, mdo: 0.1 },
      laden: { ifo: 18.5, mdo: 0.1 },
    },
    consumptionWarranted: {
      ballast: { ifo: 23, mdo: 0.1 },
      laden: { ifo: 18.5, mdo: 0.1 },
    },
    portConsumption: {
      working: { ifo: 5.5, mdo: 0.1 },
      idle: { ifo: 5.5, mdo: 0.1 },
    },
    dailyHire: 12000,
    adComsPct: 0.0375,
  },
  cargo: {
    cargoQty: 60500,
    stowFactor: 1.33,
    freightRate: 22,
    addressComsPct: 0.0375,
    brokerComsPct: 0.0125,
    loadRate: 8000,
    dischargeRate: 11000,
    loadportTT: 0.5,
    disportTT: 0.5,
    portIdleDays: 0.5,
    ballastBonus: 0,
  },
  distances: {
    ballastNm: 3000,
    ladenNm: 3000,
  },
  costs: {
    ifoPrice: 440,
    mdoPrice: 850,
    cev: 1500,
    ilhoc: 5000,
    bunkerDa: 1500,
    portDisbLoad: 20000,
    portDisbDis: 20000,
    miscExpense: 48000,
  },
  options: {
    bunkerDays: 1,
    speedBlend: { ballast: 0.5, laden: 0.75 },
  },
};
