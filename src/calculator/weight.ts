export type WeightFeasibility = {
  status: "feasible" | "infeasible";
  maxQty: number;
  overage: number;
  reason?: string;
};

export type QuantityRange = {
  min: number;
  max: number;
  label?: string;
};

export type QuantityRangeFeasibility = {
  status: "feasible" | "infeasible";
  min: number;
  max: number;
  underage: number;
  overage: number;
  reason?: string;
};

export const getWeightFeasibility = (
  cargoQty: number,
  vesselDwt: number,
): WeightFeasibility => {
  const maxQty = Math.max(0, vesselDwt);
  if (!Number.isFinite(cargoQty) || !Number.isFinite(vesselDwt)) {
    return {
      status: "infeasible",
      maxQty,
      overage: 0,
      reason: "Invalid cargo quantity or vessel DWT.",
    };
  }
  if (maxQty <= 0) {
    return {
      status: "infeasible",
      maxQty,
      overage: cargoQty,
      reason: "Vessel DWT is missing or zero.",
    };
  }
  if (cargoQty > maxQty) {
    return {
      status: "infeasible",
      maxQty,
      overage: cargoQty - maxQty,
      reason: `Cargo quantity (${cargoQty} MT) exceeds vessel DWT (${maxQty} MT).`,
    };
  }
  return { status: "feasible", maxQty, overage: 0 };
};

export const getQuantityRangeFeasibility = (
  cargoQty: number,
  range?: QuantityRange | null,
): QuantityRangeFeasibility => {
  if (!range) {
    return { status: "feasible", min: 0, max: 0, underage: 0, overage: 0 };
  }
  const min = Math.min(range.min, range.max);
  const max = Math.max(range.min, range.max);
  if (!Number.isFinite(cargoQty)) {
    return {
      status: "infeasible",
      min,
      max,
      underage: 0,
      overage: 0,
      reason: "Invalid cargo quantity.",
    };
  }
  if (cargoQty < min) {
    return {
      status: "infeasible",
      min,
      max,
      underage: min - cargoQty,
      overage: 0,
      reason: `Cargo quantity (${cargoQty} MT) is below contract minimum (${min} MT).`,
    };
  }
  if (cargoQty > max) {
    return {
      status: "infeasible",
      min,
      max,
      underage: 0,
      overage: cargoQty - max,
      reason: `Cargo quantity (${cargoQty} MT) exceeds contract maximum (${max} MT).`,
    };
  }
  return { status: "feasible", min, max, underage: 0, overage: 0 };
};
