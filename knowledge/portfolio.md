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

## Knowledge signals (optional fallbacks)

If JSON artifacts are missing, the chat layer will parse the following lines
from any `knowledge/*.md` file to populate the portfolio context pack.
Keep each signal on a single line.

TRACE_SUMMARY: TRACE_MISSING: run pipeline to generate portfolio_trace.json
TOP1_TOP2_ONE_SENTENCE: TOPK_MISSING: run pipeline to generate topk_portfolios.json
TOP1_TOP2_KEY_DELTAS: {}
THRESHOLD_BUNKER: THRESHOLD_MISSING
THRESHOLD_DELAY: THRESHOLD_MISSING

## Example response format (no asterisks)

According to the BEST_PORTFOLIO data provided, the optimal combination earns:

Total Profit: $16,417,021.62

This portfolio assigns 10 vessels out of 15 available to 10 cargos out of 11 available.

Top 3 Most Profitable Individual Assignments:

1. EVEREST OCEAN → Indonesia – India (Coal)
   Adjusted Profit: $1,905,972.33
   TCE: $91,140.09/day

2. ATLANTIC FORTUNE → South Africa – China (Iron Ore)
   Adjusted Profit: $1,712,227.45
   TCE: $38,196.37/day

3. POLARIS SPIRIT → Australia – South Korea (Iron Ore)
   Adjusted Profit: $2,061,830.25
   TCE: $71,787.02/day

Why This Combination is Best:

The optimizer evaluated 17,474,313 combinations after applying feasibility filters (freight rate > 0, laycan feasibility, quantity within range and ≤ vessel DWT). The selected combination maximizes total fleet profit by:
Matching vessels to cargos based on adjusted profit (after waiting costs for early laycan arrivals)
Searching cargo quantities in 1% steps across contract ranges
Optimizing speed blends (0-100% between warranted and economical profiles)

Note: The system indicates TRACE_MISSING and TOPK_MISSING, meaning the step-by-step trace and top-K comparison data are not currently available. To see why this combination beats the second-best alternative, you would need to run the pipeline to generate data/portfolio_trace.json and data/topk_portfolios.json.
