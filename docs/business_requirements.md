# Business Requirements Document (BRD)
**Project:** FMCG Sales Analytics & Distribution Intelligence Dashboard
**Business owner:** National Sales Head · **Users:** Sales leadership, Regional / Area Sales Managers, Sales MIS, Supply Chain, Finance (credit control)
**Company (fictional):** Aranya Consumer Products Ltd. — Indian FMCG, 8 categories, 239 SKUs, 118 distributors, ~7,200 outlets

---

## 1. Business problem
Sales performance is reviewed from disconnected Excel extracts: primary billing from ERP, secondary sales and stock from
the Distributor Management System (DMS), targets from the annual operating plan and receivables from finance. Each
review needs a day of manual consolidation, numbers differ between teams, and by the time a problem is visible
(a distributor sitting on 4 months of stock, a territory missing target, a rising overdue) it is already a month old.

## 2. Objectives
1. **One version of the truth** for primary, secondary, target, stock and collections, refreshed from source extracts.
2. Show **where performance is coming from and where it is leaking** — region → state → distributor → salesperson → beat → outlet → SKU.
3. Make **distributor health** visible: sell-in vs sell-out, stock cover, ageing, stock-outs, credit exposure.
4. Turn reports into **action**: an exception & opportunity list ranked by rupee impact.
5. Build **trust in the data**: documented KPI definitions and a visible data-quality score.

## 3. Key business questions
| # | Question | Where answered |
|---|---|---|
| Q1 | Are we on target this month / year, and which regions, states, distributors, salespersons are not? | Executive, Sales Performance |
| Q2 | Why did sales go up or down vs last year? | Sales Performance → drill-down (Region → … → SKU) |
| Q3 | Is primary running ahead of secondary (pipeline loading)? | Executive, Distributor Analytics |
| Q4 | Which distributors hold too much / too little stock, and why? | Distributor quadrant, Inventory (distributor → SKU → ageing) |
| Q5 | How productive is the sales force (coverage, productive outlets, lines per call, AOV)? | Salesperson & Beat |
| Q6 | Which SKUs / brands drive growth and margin, which are declining or slow? | Product & SKU |
| Q7 | How much money is stuck in receivables and who is overdue? | Collections |
| Q8 | Where should management act this week? | Exception & Opportunity Center |
| Q9 | Can we trust the numbers? | Data Quality, KPI Definitions, Data Model |

## 4. Scope
**In scope:** 5 years of history (Jan-2021 – Dec-2025); primary, secondary and return transactions; monthly targets;
month-end distributor stock; primary invoice collections; masters for geography, network and product.
**Out of scope (v1):** tertiary / consumer sales, trade-spend ROI, forecasting, write-back / planning, user-level security.

## 5. Functional requirements
| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Global filters: period (date range, year, month, FY presets), region, state, territory, distributor, salesperson, beat, outlet type, category, brand, SKU, sales type | Must |
| FR-02 | Cascading filter lists (e.g. states limited to the chosen regions) and removable filter chips | Must |
| FR-03 | KPI cards with growth vs same period last year and definition tooltips | Must |
| FR-04 | Target vs achievement at any geography / salesperson / category level; SKU targets via plan mix | Must |
| FR-05 | Drill-down from company total to outlet × SKU with contribution-to-change | Must |
| FR-06 | Distributor scorecard with primary, secondary, achievement, growth, stock, cover, outstanding, collection efficiency | Must |
| FR-07 | Sales-vs-stock quadrant to classify distributors | Must |
| FR-08 | Stock health (stock-out / low / healthy / overstock / slow / non-moving), FIFO ageing, high-stock-low-sales exception | Must |
| FR-09 | Receivables ageing (not due, 0-30, 31-60, 61-90, 90+) by region, state, distributor | Must |
| FR-10 | Rule-based exceptions and opportunities with severity, ₹ impact and recommended action | Must |
| FR-11 | Searchable, sortable, paginated tables with CSV export | Must |
| FR-12 | Data-quality report: rules, counts, samples, DQ %, reconciliation | Must |
| FR-13 | Light / dark theme, responsive layout | Should |

## 6. Business rules
- **Sales** = net sales (after trade discount, before GST). Default basis = secondary net of returns.
- **Primary** is billed at distributor price (PTD); **secondary** at retailer price (PTR) → a primary/secondary ratio of 0.88–1.02 is balanced.
- **Targets** are secondary targets at salesperson × category × month; achievement always compares net secondary to target.
- **Growth** = vs same period last year.
- **Stock norms**: 7–45 days of cover; cover uses the last 3 months of secondary.
- **Credit**: due date = invoice date + credit days (15 / 21 / 30); ageing by days past due at the report date.
- **Productivity** is measured monthly (outlets billed in the month ÷ outlets on beat) and averaged.

## 7. Data requirements
See [data_dictionary.md](data_dictionary.md). Grain: invoice line (sales), salesperson × category × month (targets),
distributor × SKU × month-end (stock), payment (collections). Referential integrity to masters is enforced by the ETL.

## 8. Non-functional requirements
| Area | Requirement |
|---|---|
| Performance | ~1M transaction lines; initial load < 3 s on broadband; filter changes re-render within ~0.5 s |
| Hosting | Static hosting (GitHub Pages / Netlify / Vercel), no paid backend for v1 |
| Portability | Data access behind a `DataSource` interface so SQL Server / Azure / DMS APIs can replace static files |
| Reproducibility | Synthetic data generated deterministically from a seed |
| Quality | Automated reconciliation tests between the ETL (pandas) and the dashboard engine (TypeScript) |
| Accessibility | Status colours always paired with icon + label; keyboard-reachable controls; dark mode |

## 9. Assumptions
- Data is synthetic but behaviour is modelled on Indian FMCG distribution (beats, PTR/PTD pricing, GST, FY April–March, quarter-end loading, festive seasonality).
- One salesperson owns each beat; one distributor serves each outlet.
- Returns are credited in the month after the sale; half of returned goods are written off as damaged.

## 10. Success criteria
- Monthly review pack produced from the dashboard without Excel consolidation.
- Every KPI traceable to a documented formula; data-quality score ≥ 99.5 %.
- Exception list used as the agenda of the weekly sales review.
