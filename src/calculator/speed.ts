export type SpeedBlend = {
  ballast: number;
  laden: number;
};

type SpeedConsumption = {
  speed: { ballast: number; laden: number };
  consumption: {
    ballast: { ifo: number; mdo: number };
    laden: { ifo: number; mdo: number };
  };
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export const getEffectiveProfile = (
  economical: SpeedConsumption,
  warranted: SpeedConsumption,
  blend: SpeedBlend,
) => {
  const ballastBlend = clamp01(blend.ballast);
  const ladenBlend = clamp01(blend.laden);

  return {
    speed: {
      ballast: lerp(warranted.speed.ballast, economical.speed.ballast, ballastBlend),
      laden: lerp(warranted.speed.laden, economical.speed.laden, ladenBlend),
    },
    consumption: {
      ballast: {
        ifo: lerp(warranted.consumption.ballast.ifo, economical.consumption.ballast.ifo, ballastBlend),
        mdo: lerp(warranted.consumption.ballast.mdo, economical.consumption.ballast.mdo, ballastBlend),
      },
      laden: {
        ifo: lerp(warranted.consumption.laden.ifo, economical.consumption.laden.ifo, ladenBlend),
        mdo: lerp(warranted.consumption.laden.mdo, economical.consumption.laden.mdo, ladenBlend),
      },
    },
  };
};
