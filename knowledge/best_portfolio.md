# BEST_PORTFOLIO - Optimal Vessel-Cargo Assignments

## Summary
- Total profit: $24,566,438.22
- Vessels used: 10 / 15
- Cargos used: 10 / 11

## Assumptions
- Default bunker prices: IFO $440.00/MT, MDO $850.00/MT
- Distance fallback: 3,000 nm when no port_distance match
- Speed blend: searched 0.00-1.00 in 1% steps (0=warranted, 1=economical)
- Laycan: feasible or early only; miss is excluded; early adds waiting cost

## Filters applied
- Freight rate > 0
- Laycan evaluable and not missed (early allowed with waiting cost)
- Quantity within range (if provided)
- Quantity <= vessel DWT

## Assignments (detailed)
| # | Vessel | Cargo | Route | Qty (MT) | Freight ($/MT) | Profit (USD) | TCE (USD/day) | Laycan | ETA Load Port | Feasibility | Ballast NM (source) | Laden NM (source) | Waiting Days | Waiting Cost | Adjusted Profit |
| - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| 1 | ATLANTIC FORTUNE | South Africa – China (Iron Ore) | PARADIP -> SALDANHA BAY -> TIANJIN | 180,000 | $22.00 | $2,647,031.45 | $56,322.48 | 15–22 March 2026 | Mar 11, 2026 | early | 3,000 (fallback) | 8,350.68 (port_distance) | 3.31 | $42,915.16 | $2,604,116.30 |
| 2 | PACIFIC VANGUARD | Australia – China (Iron Ore) | CAOFEIDIAN -> DAMPIER -> QINGDAO | 181,900 | $22.00 | $2,927,845.57 | $90,371.81 | 12–18 March 2026 | Mar 10, 2026 | early | 3,725.37 (port_distance) | 3,331.2 (port_distance) | 1.58 | $20,442.31 | $2,907,403.25 |
| 3 | CORAL EMPEROR | West Africa – India (Bauxite) | ROTTERDAM -> KAMSAR ANCHORAGE -> MANGALORE | 180,250 | $22.00 | $3,037,205.08 | $89,561.53 | 10–18 April 2026 | Mar 15, 2026 | early | 3,000 (fallback) | 3,000 (fallback) | 25.84 | $334,981.87 | $2,702,223.21 |
| 4 | EVEREST OCEAN | Indonesia – India (Coal) | XIAMEN -> TABONEO -> KRISHNAPATNAM | 165,000 | $22.00 | $2,911,914.51 | $106,557.75 | 10–15 April 2026 | Mar 9, 2026 | early | 1,975.74 (port_distance) | 2,411.88 (port_distance) | 31.57 | $406,508.28 | $2,505,406.24 |
| 5 | POLARIS SPIRIT | Australia – South Korea (Iron Ore) | KANDLA -> PORT HEDLAND -> GWANGYANG LNG TERMINAL | 181,500 | $22.00 | $2,980,563.31 | $98,583.19 | 9–15 March 2026 | Mar 9, 2026 | feasible | 3,000 (fallback) | 3,473.39 (port_distance) | 0 | $0.00 | $2,980,563.31 |
| 6 | IRON CENTURY | West Africa - China (Bauxite cargoes) | PORT TALBOT -> KAMSAR ANCHORAGE -> QINGDAO | 181,800 | $23.00 | $2,859,549.65 | $48,493.12 | 2-10 April 2026 | Mar 19, 2026 | early | 3,000 (fallback) | 11,124 (port_distance) | 14 | $182,126.00 | $2,677,423.65 |
| 7 | MOUNTAIN TRADER | Brazil - China (Iron ore cargoes) | GWANGYANG LNG TERMINAL -> ITAGUAI -> DAGANG (QINGDAO) | 180,000 | $22.30 | $3,070,009.77 | $102,071.45 | 1-8 April 2026 | Mar 15, 2026 | early | 3,000 (fallback) | 3,000 (fallback) | 16.08 | $208,468.97 | $2,861,540.80 |
| 8 | NAVIS PRIDE | Australia - China (Iron ore cargoes) | MUNDRA -> PORT HEDLAND -> LIANYUNGANG | 176,000 | $9.00 | $508,169.60 | $16,720.27 | 7-11 March 2026 | Mar 8, 2026 | feasible | 3,000 (fallback) | 3,545.52 (port_distance) | 0 | $0.00 | $508,169.60 |
| 9 | ZENITH GLORY | Brazil – China (Iron Ore) | VIZAG -> PONTA DA MADEIRA -> CAOFEIDIAN | 182,400 | $22.00 | $2,553,424.84 | $47,458.21 | 3–10 April 2026 | Mar 16, 2026 | early | 3,000 (fallback) | 11,049.5 (port_distance) | 17.31 | $223,663.51 | $2,329,761.33 |
| 10 | TITAN LEGACY | Canada – China (Coking Coal) | JUBAIL -> VANCOUVER (CANADA) -> FANGCHENG | 176,000 | $22.00 | $2,582,627.26 | $62,522.17 | 18–26 March 2026 | Mar 10, 2026 | early | 3,000 (fallback) | 6,011.32 (port_distance) | 7.16 | $92,796.73 | $2,489,830.53 |