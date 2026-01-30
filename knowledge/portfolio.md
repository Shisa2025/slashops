# Portfolio Optimization Notes

This document explains the multi-vessel + multi-cargo portfolio optimizer used by the chat
assistant. It is intended to make the calculation and ranking logic auditable.

## Why this exists (judge-facing)

The portfolio result must be defensible under questions like:
- Why did #1 beat #2?
- Under what bunker price or port delay does the recommendation flip?
- What filters and feasibility rules were applied?

This file defines the non-black-box audit chain used to answer those questions.

## Goal and constraints

- Goal: maximize total profit across the fleet.
- Each vessel can be matched to at most one cargo.
- Each cargo can be used at most once.
- It is allowed for a vessel to be unassigned.

## Filters (hard constraints)

Before a vessel/cargo pair is considered feasible, these filters are applied:

- Freight rate must be > 0.
- Laycan must be present and evaluable; laycan miss => infeasible.
- Cargo quantity must be within the contract range (if provided).
- Cargo quantity must not exceed vessel DWT.

If any filter fails, the pair is excluded.

## Explainability outputs (required artifacts)

To avoid a black-box result, the system produces three artifacts under `data/`:

- `data/portfolio_trace.json`
  - step-by-step filter counts, feasibility logic, and solver metadata
- `data/topk_portfolios.json`
  - top K portfolios, with a structured diff for top1 vs top2
- `data/thresholds.json`
  - scenario thresholds for bunker price delta and port delay days

These are loaded into the chat context pack so answers can cite specific evidence.

## Search dimensions

For each feasible vessel/cargo pair, the calculator searches:

- Cargo quantity: in 1% steps across the contract range
  - Step size = max(baseQty * 1%, 1 MT)
- Speed blend: ballast and laden each search 0.00 to 1.00 in 1% steps
  - 0.00 = warranted profile, 1.00 = economical profile

The best (highest adjusted profit) result for the pair is kept.

## Laycan handling

- If ETA is after laycan end: infeasible, exclude.
- If ETA is before laycan start: early arrival, add waiting cost.
- If ETA is within window: feasible with zero waiting cost.

## Distance handling

Distances come from `public/business_data/port_data/port_distances.csv`.
If a leg is missing, the system uses a default fallback distance of 3000 nm.
Each leg is labeled in the output as either `port_distances.csv` or `fallback`.

## Profit model (core formulas)

Profit = Net revenue - (Net hire + Bunkers + Port/Operating/Misc)
Net revenue = Net freight + ballast bonus
TCE = Profit / total duration

## Combination count

The total search space is explained as:

vessels x cargo-qty steps x speed steps^2

This number is reported in the output, along with the evaluated count
after filters are applied.

## Top-K comparison (why #1 beats #2)

The system produces a Top-K list (K=5) and a structured diff between #1 and #2:
- voyages that differ between the two portfolios
- profit delta attribution by voyage
- changes in avg TCE, total waiting days, and fallback distance count

The chat assistant must cite this diff when asked "why not second?".

## Scenario thresholds (when it flips)

Two scenario knobs are tracked:
- bunker_price_delta (USD/MT)
- port_delay_delta_days (days)

The system reports the first threshold at which:
- best portfolio changes, or
- runner-up profit exceeds best profit

These thresholds are included in `data/thresholds.json` and must be cited.
