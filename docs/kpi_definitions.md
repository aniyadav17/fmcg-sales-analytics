# KPI Definitions

Single source of truth: [`src/content/kpis.ts`](../src/content/kpis.ts) — the same text is shown on the in-app **KPI Definitions** page and in the ⓘ tooltips on every KPI card.

**Conventions**

- **Sales** means *Net Sales* (after trade discount, before GST) on the selected sales basis; the default basis is **secondary sales net of returns**.
- **Growth** compares with the *same period last year* (SPLY).
- **Targets** are set at *Salesperson × Category × Month*; brand / SKU targets are derived with the SKU plan mix; targets are not shown below salesperson grain (beat, outlet type).
- **Stock** and **receivables** are balances at the *end of the selected period*.

## Sales

| KPI | Definition | Formula | Business interpretation |
|---|---|---|---|
| **Sales (Net Sales)** | Invoice value after trade discount and before GST, on the selected sales basis (default: secondary sales net of returns). | `Σ (Quantity × Unit Price) − Σ Trade Discount   [returns carry negative quantity]` | The headline revenue number. Secondary (sell-out) shows real market demand; primary (sell-in) shows company billing. |
| **Primary Sales** | Company → distributor billing at distributor price (PTD). | `Σ Net Sales where Sales_Type = "Primary"` | Company revenue. Primary running ahead of secondary for several months means stock is being pushed into the pipeline (loading) and will show up as high distributor stock. |
| **Secondary Sales** | Distributor → retailer billing at retailer price (PTR), net of sales returns. | `Σ Net Sales (Secondary) + Σ Net Sales (Sales Return, negative)` | True consumer-facing offtake through the distribution network. Targets and salesperson incentives are measured on secondary. |
| **Sales Return %** | Value of goods returned by outlets (damage, expiry, near-expiry) as a share of secondary sales. | `\|Σ Return Net Sales\| ÷ Σ Secondary Net Sales × 100` | Healthy FMCG return rates are ~1–2%. Higher rates point to over-stocking at outlets, short-shelf-life SKUs or quality issues. |
| **Primary / Secondary Ratio** | Primary billing value (at distributor price) relative to net secondary value (at retailer price) for the same period. | `Primary Net Sales ÷ Net Secondary Sales` | Primary is billed ~8–10% below retailer price, so with pipeline growth a ratio of 0.88–1.02 is balanced. Persistently above ~1.02 = pipeline loading (stock building up at distributors); below ~0.88 = de-stocking or supply constraints. |
| **Growth % (vs LY)** | Change versus the same period last year (SPLY). | `(Sales current period − Sales same period LY) ÷ Sales same period LY × 100` | Removes seasonality. Compare to category growth and price increase (~3–7% a year) to separate volume from price growth. |

## Targets

| KPI | Definition | Formula | Business interpretation |
|---|---|---|---|
| **Target** | Monthly secondary-sales target set at Salesperson × Category × Month (last-year actual × plan growth). Brand/SKU views disaggregate it with the SKU plan mix. | `Σ Target_Amount   (SKU level: Category Target × SKU plan share)` | The yardstick for achievement. Targets are not available below salesperson grain (beat / outlet type filters). |
| **Achievement %** | Net secondary sales as a percentage of target for the same scope and period. | `Net Secondary Sales ÷ Target × 100` | ≥100% on / above plan, 90–100% watch, 80–90% under-performing, <80% is an exception that needs a recovery plan. |
| **Variance to Target** | Absolute gap between actual net secondary sales and target. | `Net Secondary Sales − Target` | Ranks where the money is: a 70% achiever with a small target can matter less than a 95% achiever with a big one. |

## Product

| KPI | Definition | Formula | Business interpretation |
|---|---|---|---|
| **Gross Margin** | Net sales minus standard cost of goods sold. | `Net Sales − (Quantity × Standard Cost)` | Absolute profit pool. On secondary sales it represents the system margin (company + distributor). |
| **Margin %** | Gross margin as a share of net sales. | `Gross Margin ÷ Net Sales × 100` | Mix indicator. A fall with stable prices signals cost inflation (e.g. FY 2022-23) or a shift to lower-margin packs / higher discounts. |
| **Contribution %** | Share of an item in the total of its peer group for the same filters. | `Item Net Sales ÷ Total Net Sales × 100` | Portfolio concentration. Typically ~20% of SKUs drive ~80% of sales (Pareto). |

## Distribution

| KPI | Definition | Formula | Business interpretation |
|---|---|---|---|
| **Active Distributors** | Distributors with at least one primary or secondary invoice in the period. | `COUNT DISTINCT Distributor_ID with sales in period` | Network health. A drop means distributors stopped billing (credit hold, termination, stock-out). |
| **Active Outlets** | Registered outlets on the beat plan that were open during the period (outlet universe under coverage). | `COUNT Outlet_ID where Opening_Date ≤ period end and not closed before period start` | Coverage — the number of outlets the sales team is expected to visit. |
| **Productive Outlets** | Active outlets that placed at least one secondary order in a month (effective coverage), averaged over the months of the selected period. | `AVERAGE over months of COUNT DISTINCT Outlet_ID with a Secondary invoice` | Reach actually converted into billing each month. Measured monthly because almost every outlet orders at least once in a year. |
| **Outlet Productivity %** | Share of active outlets that billed in a month, averaged over the period. | `Avg monthly Productive Outlets ÷ Avg monthly Active Outlets × 100` | ≥65% good, 50–65% watch, <40% exception. Key salesperson-effectiveness KPI; combine with lines per call to see depth of the order. |
| **Sales per Outlet** | Average net secondary sales per outlet that billed in the period. | `Net Secondary Sales ÷ Productive Outlets` | Throughput per outlet. Grow it by adding lines (range selling) and upgrading packs. |
| **Average Order Value (AOV)** | Average value of a secondary invoice. | `Secondary Net Sales ÷ Number of Secondary Invoices (Orders)` | Order size. Low AOV with high order count = many small drops (costly to serve). |
| **Orders** | Number of distinct secondary invoices (one per outlet visit that produced an order). | `COUNT DISTINCT Invoice_No (Secondary)` | Productive calls. Orders ÷ outlet visits = strike rate. |
| **Lines per Call (LPC)** | Average number of SKU lines per secondary order. | `Secondary invoice lines ÷ Orders` | Range-selling depth. Rising LPC means salespeople are selling more of the portfolio per visit. |

## Inventory

| KPI | Definition | Formula | Business interpretation |
|---|---|---|---|
| **Stock Value** | Distributor closing stock valued at distributor price (PTD) at the snapshot month-end. | `Σ Closing_Stock × Distributor Price` | Working capital sitting with distributors. Compare with sales (stock cover) rather than in isolation. |
| **Stock Cover (Days of Stock)** | How many days of sales the current closing stock can serve. | `Closing Stock ÷ (Last 3 months secondary quantity ÷ 91)` | Norm 7–45 days. <7 = risk of stock-out, 45–90 = overstock, >90 = slow-moving, no sales in 90 days = non-moving. |
| **Stock-out %** | Share of distributor × SKU combinations with zero closing stock. | `Distributor-SKU combos with Closing = 0 ÷ Total active combos × 100` | Lost-sales risk. Stock-outs on high-velocity SKUs cost more than the % suggests — check value of sales at risk. |
| **Stock Ageing** | Closing stock split by age since receipt (FIFO): 0-30, 31-60, 61-90, 90+ days. | `Closing stock allocated to the latest receipts first (FIFO)` | Stock older than 90 days is at expiry / liquidation risk and needs a scheme or stock transfer. |

## Collections

| KPI | Definition | Formula | Business interpretation |
|---|---|---|---|
| **Collection %** | Share of invoices raised in the period that has been collected by the report date. | `Collected against period invoices ÷ Invoice Amount × 100` | Cash conversion of the period’s billing. |
| **Collection Efficiency (CEI)** | Collection Effectiveness Index — how much of what was collectible in the period was actually collected. | `(Opening Outstanding + Invoiced − Closing Outstanding) ÷ (Opening Outstanding + Invoiced) × 100` | >90% strong, 80–90% acceptable, <80% signals credit-control problems. |
| **Outstanding** | Unpaid balance of all primary invoices at the report date. | `Σ (Invoice Amount − Collections received up to report date)` | Receivables exposure. Compare with credit limit per distributor. |
| **Overdue Amount** | Outstanding on invoices whose due date (invoice date + credit days) has passed. | `Σ Outstanding where Report Date > Due Date` | Bucketed 0-30 / 31-60 / 61-90 / 90+ days past due; 90+ is a bad-debt risk and a trigger for credit hold. |
| **Average Days to Collect** | Amount-weighted average number of days between invoice date and payment date. | `Σ (Payment Amount × (Payment Date − Invoice Date)) ÷ Σ Payment Amount` | Should sit at or below the credit period (15–30 days by distributor type). |

## Data Quality

| KPI | Definition | Formula | Business interpretation |
|---|---|---|---|
| **Data Quality %** | Share of records passing all validation rules. | `(Total Records − Exception Records) ÷ Total Records × 100` | Reported with every refresh so users can trust the numbers; exceptions are repaired or quarantined, never silently dropped. |

## Thresholds used for exception highlighting

| Area | Rule |
|---|---|
| Achievement | ≥100% on plan · 90–100% watch · 80–90% under-performing · <80% exception (<70% high severity) |
| Sales trend | Net secondary down 3 consecutive months with ≥10% total drop; last month <75% of the 6-month average |
| Outlet productivity | Salesperson's monthly average <40% of outlets billed |
| Stock cover | <7 days low · 7–45 healthy · 45–90 overstock · >90 slow-moving · no sales in 90 days non-moving |
| Collections | Overdue >25% of credit limit · oldest invoice >60 days past due · CEI <75% |
| Opportunities | SKU growth >25% · state growth > company + 5 pts with ≥100% achievement · salesperson achievement >105% with ≥60% productivity · secondary growth >10% with <15 days cover · outlet orders up ×1.5 |
