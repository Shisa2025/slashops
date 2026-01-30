# BEST_PORTFOLIO — Optimal Vessel–Cargo Assignments

## Summary
- Total profit: $16,417,021.62
- Vessels used: 10 / 15
- Cargos used: 10 / 11

## Assumptions
- Default bunker prices: IFO $440.00/MT, MDO $850.00/MT
- Distance fallback: 3,000 nm when no port_distance match
- Speed blend: searched 0.00–1.00 in 1% steps (0=warranted, 1=economical)
- Laycan: feasible or early only; miss is excluded; early adds waiting cost

## Filters applied
- Freight rate > 0
- Laycan evaluable and not missed (early allowed with waiting cost)
- Quantity within range (if provided)
- Quantity <= vessel DWT

## Assignments (detailed)
| # | Vessel | Cargo | Route | Qty (MT) | Freight ($/MT) | Profit (USD) | TCE (USD/day) | Laycan | ETA Load Port | Feasibility | Ballast NM (source) | Laden NM (source) | Waiting Days | Waiting Cost | Adjusted Profit |
| - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| 1 | ATLANTIC FORTUNE | South Africa – China (Iron Ore) | PARADIP -> SALDANHA BAY -> TIANJIN | 162,000 | $22.00 | $1,755,142.61 | $38,196.37 | 15–22 March 2026 | Mar 11, 2026 | early | 3,000 (fallback) | 8,350.68 (port_distance) | 3.31 | $42,915.16 | $1,712,227.45 |
| 2 | CORAL EMPEROR | West Africa - China (Bauxite cargoes) | ROTTERDAM -> KAMSAR ANCHORAGE -> QINGDAO | 162,000 | $23.00 | $1,854,719.87 | $32,069.27 | 2-10 April 2026 | Mar 15, 2026 | early | 3,000 (fallback) | 11,124 (port_distance) | 17.84 | $231,261.87 | $1,623,458.00 |
| 3 | EVEREST OCEAN | Indonesia – India (Coal) | XIAMEN -> TABONEO -> KRISHNAPATNAM | 136,500 | $22.00 | $2,312,480.61 | $91,140.09 | 10–15 April 2026 | Mar 9, 2026 | early | 1,975.74 (port_distance) | 2,411.88 (port_distance) | 31.57 | $406,508.28 | $1,905,972.33 |
| 4 | POLARIS SPIRIT | Australia – South Korea (Iron Ore) | KANDLA -> PORT HEDLAND -> GWANGYANG LNG TERMINAL | 148,500 | $22.00 | $2,061,830.25 | $71,787.02 | 9–15 March 2026 | Mar 9, 2026 | feasible | 3,000 (fallback) | 3,473.39 (port_distance) | 0 | $0.00 | $2,061,830.25 |
| 5 | IRON CENTURY | Canada – China (Coking Coal) | PORT TALBOT -> VANCOUVER (CANADA) -> FANGCHENG | 144,000 | $22.00 | $1,796,298.35 | $45,688.42 | 18–26 March 2026 | Mar 19, 2026 | feasible | 3,000 (fallback) | 6,011.32 (port_distance) | 0 | $0.00 | $1,796,298.35 |
| 6 | MOUNTAIN TRADER | Brazil - China (Iron ore cargoes) | GWANGYANG LNG TERMINAL -> ITAGUAI -> DAGANG (QINGDAO) | 162,000 | $22.30 | $2,150,999.93 | $73,722.28 | 1-8 April 2026 | Mar 15, 2026 | early | 3,000 (fallback) | 3,000 (fallback) | 16.08 | $208,468.97 | $1,942,530.96 |
| 7 | NAVIS PRIDE | Australia - China (Iron ore cargoes) | MUNDRA -> PORT HEDLAND -> LIANYUNGANG | 144,000 | $9.00 | $197,733.70 | $6,835.90 | 7-11 March 2026 | Mar 8, 2026 | feasible | 3,000 (fallback) | 3,545.52 (port_distance) | 0 | $0.00 | $197,733.70 |
| 8 | AURORA SKY | West Africa – India (Bauxite) | JINGTANG -> KAMSAR ANCHORAGE -> MANGALORE | 157,500 | $22.00 | $2,108,861.80 | $65,404.03 | 10–18 April 2026 | Mar 14, 2026 | early | 3,000 (fallback) | 3,000 (fallback) | 27 | $350,055.00 | $1,758,806.80 |
| 9 | ZENITH GLORY | Brazil – China (Iron Ore) | VIZAG -> PONTA DA MADEIRA -> CAOFEIDIAN | 171,000 | $22.00 | $1,628,318.02 | $30,588.14 | 3–10 April 2026 | Mar 16, 2026 | early | 3,000 (fallback) | 11,049.5 (port_distance) | 17.31 | $223,663.51 | $1,404,654.51 |
| 10 | TITAN LEGACY | Australia – China (Iron Ore) | JUBAIL -> DAMPIER -> QINGDAO | 153,000 | $22.00 | $2,028,516.00 | $69,716.12 | 12–18 March 2026 | Mar 10, 2026 | early | 3,000 (fallback) | 3,331.2 (port_distance) | 1.16 | $15,006.73 | $2,013,509.27 |