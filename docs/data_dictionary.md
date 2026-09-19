# Data Dictionary

All raw extracts are produced by `data/generate_data.py` in `data/raw/` and validated / published by
`data/build_dataset.py`. Dates are ISO `YYYY-MM-DD`; money is Indian Rupees (₹); quantities are in selling units.

**Period:** 1 Jan 2021 – 31 Dec 2025 (60 months). **Report / as-of date:** 31 Dec 2025.
**Scale (default seed 42):** ~1.08 M sales lines · 294 K stock snapshots · 157 K target rows · 15.8 K collection rows.

---

## Relationships

```
Region 1─N State 1─N Territory 1─N Distributor 1─N Salesperson 1─N Beat 1─N Outlet
Category 1─N Sub-category / Brand 1─N SKU 1─N Price list (per FY price period)

sales_transactions  N─1 Distributor, Outlet (secondary / returns), SKU, Calendar
sales_targets       N─1 Salesperson, Category, Month        (+ sku_target_mix for SKU level)
distributor_stock   N─1 Distributor, SKU, Month-end
collections         N─1 Distributor, primary Invoice_No
```

---

## Fact tables

### `sales_transactions.csv.gz` — grain: one invoice line (invoice × SKU)

| Field | Type | Description |
|---|---|---|
| Transaction_ID | text | Unique line id `TXN########` |
| Transaction_Date | date | Invoice date |
| Invoice_No | text | `PI/<FY>/#######` primary, `SI/<FY>/#######` secondary, `CN/<FY>/#######` credit note (return). FY = Indian financial year, e.g. `2425` |
| Region, State, City, Territory | text | Geography of the distributor (primary) or outlet (secondary) |
| Distributor_ID | text | FK → distributor_master |
| Salesperson_ID | text | FK → salesperson_master (blank on primary) |
| Beat_ID | text | FK → beat_master (blank on primary) |
| Outlet_ID | text | FK → outlet_master (blank on primary) |
| SKU_ID | text | FK → product_master |
| Quantity | int | Units; **negative on Sales Return** |
| MRP | decimal | Unit MRP (incl. GST) for the price period |
| Unit_Price | decimal | Distributor price (PTD) on primary, retailer price (PTR) on secondary / returns, ex-GST |
| Gross_Sales | decimal | Quantity × Unit_Price |
| Discount | decimal | Trade discount / scheme value |
| Net_Sales | decimal | Gross_Sales − Discount (**the "sales" measure**) |
| Cost | decimal | Quantity × standard cost of goods |
| Gross_Margin | decimal | Net_Sales − Cost |
| Tax | decimal | GST on Net_Sales (5 / 12 / 18 % by product) |
| Invoice_Value | decimal | Net_Sales + Tax |
| Sales_Type | text | `Primary` (company → distributor), `Secondary` (distributor → outlet), `Sales Return` (outlet → distributor) |
| Payment_Type | text | Cash / UPI / Credit / Credit (NEFT/RTGS) / Credit Note |

### `sales_targets.csv` — grain: Month × Salesperson × Category

| Field | Type | Description |
|---|---|---|
| Month | `YYYY-MM` | Target month |
| Region, State, Territory, Distributor_ID, Salesperson_ID | text | Hierarchy of the salesperson |
| Category | text | Product category |
| SKU_ID | text | `ALL` — targets are set at category level (see `sku_target_mix`) |
| Target_Amount | decimal | Net secondary sales target (₹) |
| Target_Quantity | int | Indicative units (Target_Amount ÷ average category price) |

Targets = last-year actual of the same month (smoothed with neighbouring months) × (1 + regional plan growth ± salesperson stretch).

### `sku_target_mix.csv` — grain: Month × SKU

| Field | Type | Description |
|---|---|---|
| Month | `YYYY-MM` | |
| SKU_ID, Category | text | |
| Mix_Share | decimal | SKU's planned share of its category target (sums to 1 per category-month). SKU target = Category target × Mix_Share |

### `distributor_stock.csv.gz` — grain: Month-end × Distributor × SKU

| Field | Type | Description |
|---|---|---|
| Snapshot_Date | date | Month-end |
| Distributor_ID, SKU_ID | text | |
| Opening_Stock | int | Units at start of month (= previous Closing_Stock) |
| Primary_Received | int | Units billed by the company in the month |
| Secondary_Sales | int | Units sold to outlets |
| Sales_Return | int | Units returned by outlets |
| Adjustment | int | Damage / expiry write-off, shrinkage, audit variance (usually negative) |
| Closing_Stock | int | Opening + Primary − Secondary + Returns + Adjustment |
| Stock_Value | decimal | Closing_Stock × distributor price |
| Days_of_Stock | decimal | Closing ÷ (average monthly secondary of last 3 months ÷ 30); 999 = no sales |
| Stock_Status | text | Stock-out / Low Stock (<7 d) / Healthy (7–45 d) / Overstock (45–90 d) / Slow-moving (>90 d) / Non-moving (no sales in 3 months) |
| Age_0_30 … Age_90_Plus | int | FIFO ageing of Closing_Stock by days since receipt |

### `collections.csv` — grain: one payment (or open balance) against a primary invoice

| Field | Type | Description |
|---|---|---|
| Collection_ID | text | `COL#######` |
| Distributor_ID | text | |
| Invoice_No | text | Primary invoice |
| Invoice_Date, Due_Date | date | Due = invoice date + credit days (15 / 21 / 30 by distributor type) |
| Invoice_Amount | decimal | Invoice value incl. GST |
| Collection_Amount | decimal | Amount received in this payment (0 on an open-balance row) |
| Outstanding_Amount | decimal | Invoice balance after this payment |
| Payment_Date | date | Date paid (blank when unpaid at the report date) |
| Collection_Date | date | Date realised in the books (payment + 0–1 day) |
| Days_Overdue | int | Days paid after due date, or days past due at the report date if unpaid |
| Collection_Status | text | Paid On Time / Paid Late / Partially Paid / Overdue / Outstanding - Not Due |

---

## Dimension tables

### `dim_geography.csv`
Country, Region (5), State (20), State_Code, City (89), Territory_ID (63), Territory_Name.

### `distributor_master.csv`
| Field | Description |
|---|---|
| Distributor_ID, Distributor_Name | Key and trade name |
| Region, State, City, Territory, Territory_Name | Location |
| Distributor_Type | Super Stockist / Urban Distributor / Rural Distributor / Key Account Distributor (modern trade & e-commerce accounts) |
| Distributor_Status | Active / Credit Hold / Under Review |
| Credit_Limit, Credit_Days | Credit policy |
| Opening_Balance | Receivable balance on 1 Jan 2021 |
| Sales_Target | Annual CY2025 secondary target (sum of its salespersons) |
| Join_Date | Appointment date (a few distributors were appointed during 2021-2024) |

### `salesperson_master.csv`
Salesperson_ID, Salesperson_Name, Region, State, Territory, Distributor_ID, Joining_Date, Target (average monthly 2025 target), Status (Active / On Notice).

### `beat_master.csv`
Beat_ID, Beat_Name, Salesperson_ID, Distributor_ID, City, Visit_Day (Mon–Sat).

### `outlet_master.csv`
Outlet_ID, Outlet_Name, Outlet_Type (General Trade, Pharmacy, Supermarket, Modern Trade, Wholesale, Institutional, E-commerce), Channel (Traditional Trade, Pharma, Modern Trade, Institutional, E-commerce), Region, State, City, Territory, Distributor_ID, Beat_ID, Outlet_Status (Active / Closed), Opening_Date, Closed_Date.

### `product_master.csv`
| Field | Description |
|---|---|
| SKU_ID, SKU_Code, Product_Name | Keys and description |
| Brand, Category, Sub_Category, Variant | Product hierarchy (8 categories, 23 brands, 37 sub-categories, 239 SKUs) |
| Pack_Size, UOM | e.g. `100` `g` |
| MRP, Selling_Price, Distributor_Price, Cost_Price | Current (FY 2025-26) price list; Selling_Price = PTR ex-GST |
| GST_Rate, Case_Size | Tax rate and ordering pack |
| Launch_Date, Product_Status, Discontinued_Date | Life-cycle (Active / New Launch / Discontinued) |

### `price_list.csv`
SKU_ID × Price_Period (Jan–Mar 2021, FY 2021-22 … FY 2025-26) with Effective_From/To, MRP, Selling_Price, Distributor_Price, Cost_Price. Prices rise every April (4–7 %); FY 2022-23 cost inflation (+11 %) outpaced price (+7 %).

---

## Browser bundle (`public/data/`)

| File | Content |
|---|---|
| `manifest.json` | Byte layout of every bundle, month list, row counts |
| `masters.json` | All dimension tables as compact column arrays (+ price matrices) |
| `sales.bin.gz` | Clean sales lines as columns: day (u16), stype (u8), dist (u8), outlet (u16), sku (u16), qty (i32), disc (u8, 0.25 % steps). Net / gross / cost are recomputed on load |
| `stock.bin.gz` | month, dist, sku, closing, age0–age2 |
| `targets.bin.gz` | Dense salesperson × month × category targets + month × SKU plan mix |
| `collections.bin.gz` | Invoice-level amount, due date and up to two payments |
| `data_quality.json` | Validation report |

## Data-quality defects injected on purpose
Duplicates (240), missing distributor IDs (75; 60 repairable from the outlet master), unknown distributor (20),
missing SKU (40), missing outlet (35), negative quantity on sales lines (30), invalid dates (25), missing
salesperson-month targets (36–37), stock roll-forward breaks (60), over-collections (12). All are detected, repaired
or quarantined by `build_dataset.py` and shown on the Data Quality page.
