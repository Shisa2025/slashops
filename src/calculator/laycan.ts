export type LaycanWindow = {
  start: Date;
  end: Date;
};

export type LaycanStatus = "infeasible" | "early" | "feasible";

export type LaycanEvaluation = {
  status: LaycanStatus;
  eta: Date;
  waitingDays: number;
  ballastDays: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const monthIndex = (value: string) => {
  const normalized = value.trim().toLowerCase();
  const months: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };
  return months[normalized];
};

const makeUtcDate = (day: number, month: string, year: number) => {
  const index = monthIndex(month);
  if (index === undefined) return undefined;
  const date = new Date(Date.UTC(year, index, day));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const parseLaycanRange = (value: string | undefined | null): LaycanWindow | null => {
  if (!value) return null;
  const cleaned = value
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const dayRangeSameMonth = cleaned.match(
    /(\d{1,2})\s*-\s*(\d{1,2})\s*([A-Za-z]+)\s*(\d{4})/,
  );
  if (dayRangeSameMonth) {
    const start = makeUtcDate(
      Number.parseInt(dayRangeSameMonth[1], 10),
      dayRangeSameMonth[3],
      Number.parseInt(dayRangeSameMonth[4], 10),
    );
    const end = makeUtcDate(
      Number.parseInt(dayRangeSameMonth[2], 10),
      dayRangeSameMonth[3],
      Number.parseInt(dayRangeSameMonth[4], 10),
    );
    if (start && end) return { start, end };
  }

  const monthFirstRange = cleaned.match(
    /([A-Za-z]+)\s*(\d{1,2})\s*-\s*(\d{1,2})\s*(\d{4})/,
  );
  if (monthFirstRange) {
    const start = makeUtcDate(
      Number.parseInt(monthFirstRange[2], 10),
      monthFirstRange[1],
      Number.parseInt(monthFirstRange[4], 10),
    );
    const end = makeUtcDate(
      Number.parseInt(monthFirstRange[3], 10),
      monthFirstRange[1],
      Number.parseInt(monthFirstRange[4], 10),
    );
    if (start && end) return { start, end };
  }

  const twoDates = cleaned.match(
    /(\d{1,2})\s*([A-Za-z]+)\s*(\d{4})\s*-\s*(\d{1,2})\s*([A-Za-z]+)\s*(\d{4})/,
  );
  if (twoDates) {
    const start = makeUtcDate(
      Number.parseInt(twoDates[1], 10),
      twoDates[2],
      Number.parseInt(twoDates[3], 10),
    );
    const end = makeUtcDate(
      Number.parseInt(twoDates[4], 10),
      twoDates[5],
      Number.parseInt(twoDates[6], 10),
    );
    if (start && end) return { start, end };
  }

  return null;
};

export const calculateBallastDays = (nm: number, speed: number) =>
  speed > 0 ? nm / speed / 24 : 0;

export const parseDateInput = (value: string | undefined | null) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const addDaysUtc = (date: Date, days: number) =>
  new Date(date.getTime() + days * MS_PER_DAY);

const diffDays = (later: Date, earlier: Date) => (later.getTime() - earlier.getTime()) / MS_PER_DAY;

export const evaluateLaycan = (params: {
  departureDate: Date;
  ballastNm: number;
  ballastSpeed: number;
  laycan: LaycanWindow;
}): LaycanEvaluation => {
  const ballastDays = calculateBallastDays(params.ballastNm, params.ballastSpeed);
  const eta = addDaysUtc(params.departureDate, ballastDays);

  if (eta.getTime() > params.laycan.end.getTime()) {
    return { status: "infeasible", eta, waitingDays: 0, ballastDays };
  }

  if (eta.getTime() < params.laycan.start.getTime()) {
    const waitingDays = diffDays(params.laycan.start, eta);
    return { status: "early", eta, waitingDays, ballastDays };
  }

  return { status: "feasible", eta, waitingDays: 0, ballastDays };
};
