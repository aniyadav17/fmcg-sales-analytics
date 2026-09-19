# Power BI report: FMCG Sales Analytics

This is a Power BI Desktop project (`.pbip`, with a TMDL semantic model and a PBIR report). It is built on the **same
cleaned data** as the web dashboard, and its 2025 KPIs reconcile exactly with the web app:

| KPI (CY 2025) | Value |
|---|---|
| Net secondary sales | ₹35.29 Cr |
| Achievement | 97.0% |
| Growth vs last year | +15.0% |
| Outlet productivity | 51.9% |
| Distributor stock | ₹3.93 Cr (37 days cover) |
| Outstanding | ₹3.13 Cr |

## Pages
| Page | KPI cards | Tables |
|---|---|---|
| Executive Overview | Net Secondary Sales, Achievement %, Growth vs LY, Gross Margin % | Region Performance, Category Performance |
| Sales Performance | Net Secondary Sales, Target, Achievement %, Variance to Target | State, Distributor, Salesperson Performance |
| Distributor Analytics | Primary Sales, Secondary Sales, Distributor Stock, Outstanding | Distributor Scorecard |
| Salesperson & Beat | Active Outlets, Productive Outlets, Productivity %, Avg Order Value | Salesperson Productivity, Beat Productivity |
| Product & SKU | Net Secondary Sales, Units Sold, Gross Margin %, Active SKUs | Brand Performance, SKU Performance |
| Inventory & Stock | Stock Value, Stock Cover (days), Stock-out %, Slow & Non-moving Stock | Stock by Distributor, Stock Health Summary |
| Collections | Invoice Amount, Collected, Outstanding, Overdue | Distributor Collections, Receivables Ageing |

## Semantic model
- **Facts:** `Sales` (1.08M invoice lines), `Targets`, `Stock` (month-end snapshots), `Collections`.
- **Dimensions:** `Date` (with the Indian financial year), `Distributor` (Region › State › Territory), `Salesperson`,
  `Beat`, `Outlet`, `Product`, `Category`.
- **Relationships:** a star schema with 16 single-direction relationships, and no bi-directional filters.
- **Measures:** about 70 measures, all in the `KPI` table, organised into display folders: Sales, Targets, Distribution,
  Product, Stock, Collections, and display versions in ₹ Cr and ₹ Lakh.

**How some measures work:**
- **Growth:** uses `SAMEPERIODLASTYEAR` on the marked Date table.
- **Outlet productivity:** Productive Outlets and Active Outlets are averaged over the months in the selected period.
  Active Outlets uses `TREATAS` so distributor, salesperson and beat filters reach the outlet master.
- **Stock:** measures take the snapshot at the month-end of the selected period.
- **Collections:** outstanding and overdue are as of 31-Dec-2025.

## How to open it
1. Generate the data once from the repository root:

   ```bash
   python data/generate_data.py
   ```

   This writes the star-schema CSVs to `data/processed/powerbi/`.
2. Open `FMCG Sales Analytics.pbip` in Power BI Desktop.
3. Go to **Transform data → Edit parameters** and set `DataFolder` to
   `<your clone>\data\processed\powerbi\`. Include the trailing backslash.
4. Click **Refresh**.

The report opens filtered to **CY 2025**. Change the year in the **Filters** pane.
