#!/usr/bin/env python3
"""
build_dataset.py
================
ETL + data-quality layer.

Reads the raw extracts in data/raw/ (exactly as a DMS / ERP export would be
delivered), validates them, repairs or quarantines bad records, and publishes:

    public/data/                      <- consumed by the React dashboard
        manifest.json                 layout of every binary bundle + metadata
        masters.json                  dimension tables (compact, columnar)
        sales.bin.gz                  cleaned transaction fact (columnar typed arrays)
        stock.bin.gz                  monthly distributor x SKU stock snapshots
        targets.bin.gz                salesperson x month x category targets + SKU plan mix
        collections.bin.gz            primary invoice / payment facts
        data_quality.json             data-quality report shown on the DQ page

    data/processed/                   <- analyst-friendly summaries (Power BI / Excel / SQL)
        monthly_sales_summary.csv
        distributor_scorecard_2025.csv
        data_quality_checks.csv
        quarantined_records.csv

The browser never downloads CSV. Facts are shipped as gzipped column-major typed
arrays so ~1M rows load in a couple of seconds and aggregate in milliseconds.
Monetary values are *not* stored per row: the browser recomputes
Gross = Qty x Price(SKU, price period) and Net = Gross x (1 - discount%), which
keeps the payload small and is reconciled against the raw Net_Sales below.

Usage:  python data/build_dataset.py
"""
from __future__ import annotations

import gzip
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
PROCESSED = ROOT / "processed"
WEB = ROOT.parent / "public" / "data"
START = pd.Timestamp("2021-01-01")
END = pd.Timestamp("2025-12-31")
N_MONTHS = 60
CATEGORIES = ["Personal Care", "Health & Wellness", "Food & Beverages", "Home Care", "Oral Care", "Hair Care", "Skin Care", "Baby Care"]
OUTLET_TYPES = ["General Trade", "Pharmacy", "Supermarket", "Modern Trade", "Wholesale", "Institutional", "E-commerce"]
STYPE = {"Primary": 0, "Secondary": 1, "Sales Return": 2}
NONE16 = 65535


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def raw_file(stem: str) -> Path:
    for ext in (".csv.gz", ".csv"):
        p = RAW / f"{stem}{ext}"
        if p.exists():
            return p
    raise FileNotFoundError(f"{stem}.csv(.gz) not found in {RAW} - run generate_data.py first")


def read(stem: str, **kw) -> pd.DataFrame:
    return pd.read_csv(raw_file(stem), keep_default_na=False, na_values=[], **kw)


def price_period(m):
    m = np.asarray(m)
    return np.where(m < 3, 0, np.minimum(5, 1 + (m - 3) // 12))


def month_index(dates: pd.Series) -> np.ndarray:
    return ((dates.dt.year - 2021) * 12 + dates.dt.month - 1).to_numpy()


# ----------------------------------------------------------------------------- bundle writer
def write_bundle(name: str, arrays: dict[str, np.ndarray]) -> dict:
    """Column-major binary: each column 4-byte aligned so JS can map typed arrays directly."""
    type_code = {np.dtype("uint8"): "u8", np.dtype("uint16"): "u16", np.dtype("int16"): "i16",
                 np.dtype("uint32"): "u32", np.dtype("int32"): "i32", np.dtype("float32"): "f32"}
    parts, cols, offset = [], [], 0
    for col, arr in arrays.items():
        arr = np.ascontiguousarray(arr)
        b = arr.astype(arr.dtype.newbyteorder("<"), copy=False).tobytes()
        pad = (-len(b)) % 4
        cols.append({"name": col, "type": type_code[arr.dtype], "offset": offset, "length": int(arr.size)})
        parts.append(b + b"\0" * pad)
        offset += len(b) + pad
    data = b"".join(parts)
    path = WEB / f"{name}.bin.gz"
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(data)
    log(f"  {path.name}: {offset / 1e6:.1f} MB raw -> {path.stat().st_size / 1e6:.2f} MB gz")
    return {"file": path.name, "byteLength": offset, "columns": cols}


# ----------------------------------------------------------------------------- DQ bookkeeping
class DQ:
    def __init__(self):
        self.checks, self.quarantine = [], []

    def add(self, cid, table, check, rule, severity, df, mask, action, total, cols=None):
        mask = np.asarray(mask, dtype=bool)
        cnt = int(mask.sum())
        sample = []
        if cnt:
            sub = df.loc[mask, cols] if cols else df.loc[mask]
            sample = sub.head(8).astype(str).to_dict(orient="records")
            q = sub.head(500).copy()
            q.insert(0, "check_id", cid)
            self.quarantine.append(q.astype(str))
        self.checks.append(dict(id=cid, table=table, check=check, rule=rule, severity=severity, count=cnt,
                                pct=round(cnt / max(total, 1) * 100, 4), action=action if cnt else "None required",
                                status="Fail" if cnt and severity == "High" else ("Warn" if cnt else "Pass"),
                                sample=sample))
        return mask


def export_powerbi(tx, dt, T, sp, dist, outl, beat, prod, st, ages, inv, a1, a2, P, cols):
    """Clean star schema for Power BI (data/processed/powerbi). Same cleaned data and business rules as the web dashboard."""
    out = PROCESSED / "powerbi"
    out.mkdir(parents=True, exist_ok=True)
    log("Writing Power BI star schema ...")
    beat_sp = beat.set_index("Beat_ID").Salesperson_ID

    # ---- dimensions ----
    dist[["Distributor_ID", "Distributor_Name", "Region", "State", "Territory_Name", "City", "Distributor_Type",
          "Distributor_Status", "Credit_Limit", "Credit_Days"]].to_csv(out / "dim_distributor.csv", index=False)
    sp.assign(Distributor_Name=sp.Distributor_ID.map(dist.set_index("Distributor_ID").Distributor_Name))[
        ["Salesperson_ID", "Salesperson_Name", "Distributor_ID", "Distributor_Name", "Status"]].to_csv(out / "dim_salesperson.csv", index=False)
    beat.assign(Salesperson_Name=beat.Salesperson_ID.map(sp.set_index("Salesperson_ID").Salesperson_Name))[
        ["Beat_ID", "Beat_Name", "Salesperson_ID", "Salesperson_Name", "Distributor_ID", "Visit_Day"]].to_csv(out / "dim_beat.csv", index=False)
    outl.assign(Salesperson_ID=outl.Beat_ID.map(beat_sp))[
        ["Outlet_ID", "Outlet_Name", "Outlet_Type", "Channel", "City", "Distributor_ID", "Salesperson_ID", "Beat_ID",
         "Outlet_Status", "Opening_Date", "Closed_Date"]].to_csv(out / "dim_outlet.csv", index=False)
    prod.assign(Pack=prod.Pack_Size.astype(str) + " " + prod.UOM)[
        ["SKU_ID", "SKU_Code", "Product_Name", "Brand", "Category", "Sub_Category", "Pack", "Product_Status"]].to_csv(out / "dim_product.csv", index=False)
    pd.DataFrame({"Category": CATEGORIES, "Category_Order": range(1, len(CATEGORIES) + 1)}).to_csv(out / "dim_category.csv", index=False)

    # ---- fact_sales (clean invoice lines) ----
    fs = pd.DataFrame({
        "Date": dt.dt.strftime("%Y-%m-%d").to_numpy(), "Sales_Type": tx.Sales_Type.to_numpy(), "Invoice_No": tx.Invoice_No.to_numpy(),
        "Distributor_ID": tx.Distributor_ID.to_numpy(), "Salesperson_ID": tx.Salesperson_ID.to_numpy(), "Beat_ID": tx.Beat_ID.to_numpy(),
        "Outlet_ID": tx.Outlet_ID.to_numpy(), "SKU_ID": tx.SKU_ID.to_numpy(), "Quantity": tx.Quantity.to_numpy(),
        "Net_Sales": tx.Net_Sales.round(2).to_numpy(), "Cost": tx.Cost.round(2).to_numpy()})
    fs.sort_values(["Date", "Sales_Type"]).to_csv(out / "fact_sales.csv.gz", index=False, compression="gzip")

    # ---- fact_targets (salesperson x category x month, after imputation) ----
    s_i, m_i, c_i = np.nonzero(T > 0)
    pd.DataFrame({
        "Month_Date": [f"{2021 + m // 12}-{m % 12 + 1:02d}-01" for m in m_i], "Salesperson_ID": sp.Salesperson_ID.to_numpy()[s_i],
        "Distributor_ID": sp.Distributor_ID.to_numpy()[s_i], "Category": np.array(CATEGORIES)[c_i],
        "Target_Amount": np.round(T[s_i, m_i, c_i], 2)}).to_csv(out / "fact_targets.csv", index=False)

    # ---- fact_stock (month-end snapshot + cover / status on the dashboard's rules) ----
    nD, nS = len(dist), len(prod)
    sec = cols["stype"] == 1
    units = np.zeros((nD, nS, N_MONTHS))
    np.add.at(units, (cols["di"][sec], cols["si"][sec], cols["month"][sec]), cols["qty"][sec])
    c = np.cumsum(np.pad(units, ((0, 0), (0, 0), (1, 0))), axis=2)
    d_, s_, m_ = st.di.to_numpy(), st.si.to_numpy(), st.m.to_numpy()
    s3 = c[d_, s_, m_ + 1] - c[d_, s_, np.maximum(0, m_ - 2)]
    ptd = P["Distributor_Price"][s_, price_period(m_)]
    closing = st.Closing_Stock.to_numpy().astype(float)
    daily = s3 / 91
    dos = np.where(daily > 0, closing / np.where(daily > 0, daily, 1), np.nan)
    status = np.select([closing <= 0, s3 <= 0, dos > 90, dos > 45, dos < 7],
                       ["Stock-out", "Non-moving", "Slow-moving", "Overstock", "Low Stock"], "Healthy")
    pd.DataFrame({
        "Snapshot_Date": st.Snapshot_Date.to_numpy(), "Distributor_ID": st.Distributor_ID.to_numpy(), "SKU_ID": st.SKU_ID.to_numpy(),
        "Closing_Stock": closing.astype(np.int64), "Stock_Value": np.round(closing * ptd, 2),
        "Sales_3M_Units": s3.astype(np.int64), "Sales_3M_Value_PTD": np.round(s3 * ptd, 2),
        "Days_of_Stock": np.round(dos, 1), "Stock_Status": status,
        "Status_Order": pd.Series(status).map({"Stock-out": 1, "Low Stock": 2, "Healthy": 3, "Overstock": 4, "Slow-moving": 5, "Non-moving": 6}).to_numpy(),
        "Aged_90_Plus_Value": np.round(ages[:, 3] * ptd, 2)}).to_csv(out / "fact_stock.csv.gz", index=False, compression="gzip")

    # ---- fact_collections (primary invoice, status as of the report date) ----
    as_of = int((END - START).days)
    p1 = inv.pay_day_1.to_numpy(); p2 = inv.pay_day_2.to_numpy()
    paid1 = np.where(~np.isnan(p1) & (np.nan_to_num(p1, nan=1e9) <= as_of), a1, 0.0)
    paid2 = np.where(~np.isnan(p2) & (np.nan_to_num(p2, nan=1e9) <= as_of), a2, 0.0)
    amt = inv.Invoice_Amount.to_numpy()
    paid = paid1 + paid2
    outstanding = np.maximum(0, amt - paid)
    outstanding = np.where(outstanding > 0.5, outstanding, 0.0)
    due = inv.due_day.to_numpy()
    dpd = np.where(outstanding > 0, as_of - due, 0)
    bucket = np.select([outstanding <= 0, dpd <= 0, dpd <= 30, dpd <= 60, dpd <= 90],
                       ["Paid", "Not yet due", "0-30", "31-60", "61-90"], "90+")
    inv_day = inv.inv_day.to_numpy()
    wdays = paid1 * np.nan_to_num(p1 - inv_day) + paid2 * np.nan_to_num(p2 - inv_day)
    to_date = lambda d: (START + pd.to_timedelta(d, unit="D")).strftime("%Y-%m-%d")
    pd.DataFrame({
        "Invoice_No": inv.index.to_numpy(), "Distributor_ID": inv.Distributor_ID.to_numpy(),
        "Invoice_Date": to_date(inv_day), "Due_Date": to_date(due), "Invoice_Amount": np.round(amt, 2),
        "Collected_Amount": np.round(paid, 2), "Outstanding_Amount": np.round(outstanding, 2),
        "Overdue_Amount": np.round(np.where(dpd > 0, outstanding, 0), 2), "Days_Past_Due": np.maximum(dpd, 0).astype(int),
        "Ageing_Bucket": bucket, "Ageing_Order": pd.Series(bucket).map({"Not yet due": 1, "0-30": 2, "31-60": 3, "61-90": 4, "90+": 5, "Paid": 6}).to_numpy(),
        "Paid_x_Days": np.round(wdays, 2)}).to_csv(out / "fact_collections.csv", index=False)
    log(f"  Power BI files -> {out}")


def main():
    t0 = time.time()
    WEB.mkdir(parents=True, exist_ok=True)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    dq = DQ()
    tables = []

    # ======================================================================= masters
    log("Loading masters ...")
    geo = read("dim_geography")
    prod = read("product_master")
    prices = read("price_list")
    dist = read("distributor_master")
    sp = read("salesperson_master")
    beat = read("beat_master")
    outl = read("outlet_master")

    regions = ["North", "West", "Central", "South", "East"]
    states = geo.drop_duplicates("State")[["State", "State_Code", "Region"]].reset_index(drop=True)
    terr = geo.drop_duplicates("Territory_ID")[["Territory_ID", "Territory_Name", "State"]].reset_index(drop=True)
    st_idx = {s: i for i, s in enumerate(states.State)}
    te_idx = {t: i for i, t in enumerate(terr.Territory_ID)}
    d_idx = {d: i for i, d in enumerate(dist.Distributor_ID)}
    sp_idx = {s: i for i, s in enumerate(sp.Salesperson_ID)}
    bt_idx = {b: i for i, b in enumerate(beat.Beat_ID)}
    o_idx = {o: i for i, o in enumerate(outl.Outlet_ID)}
    sku_idx = {s: i for i, s in enumerate(prod.SKU_ID)}
    brands = sorted(prod.Brand.unique(), key=lambda b: (CATEGORIES.index(prod[prod.Brand == b].Category.iloc[0]), b))
    subs = list(dict.fromkeys(prod.sort_values("Category", key=lambda c: c.map(CATEGORIES.index)).Sub_Category))

    # master-data checks
    for name, df, key in [("outlet_master", outl, "Outlet_ID"), ("product_master", prod, "SKU_ID"),
                          ("distributor_master", dist, "Distributor_ID")]:
        dq.add(f"M-{name}-dup", name, "Duplicate primary keys", f"{key} must be unique", "High", df,
               df[key].duplicated(), "Remove duplicates", len(df))
    dq.add("M-outlet-beat", "outlet_master", "Outlet not mapped to a valid beat", "Beat_ID exists in beat_master",
           "High", outl, ~outl.Beat_ID.isin(bt_idx), "Map outlet to beat", len(outl))
    dq.add("M-sku-price", "product_master", "SKU without price list", "Every SKU has 6 price periods", "High", prod,
           ~prod.SKU_ID.isin(prices.groupby("SKU_ID").size().loc[lambda s: s == 6].index), "Add price", len(prod))
    tables.append(dict(table="Master data", total=int(len(outl) + len(prod) + len(dist) + len(sp) + len(beat)),
                       exceptions=0))

    # price matrices [sku, period]
    prices["p"] = prices.groupby("SKU_ID").cumcount()
    prices["si"] = prices.SKU_ID.map(sku_idx)
    P = {c: np.zeros((len(prod), 6)) for c in ["MRP", "Selling_Price", "Distributor_Price", "Cost_Price"]}
    for c in P:
        P[c][prices.si.values, prices.p.values] = prices[c].values

    # ======================================================================= transactions
    log("Validating sales transactions ...")
    tx = read("sales_transactions", dtype={"Quantity": np.int64})
    n_raw = len(tx)
    num = ["Gross_Sales", "Discount", "Net_Sales", "Cost", "Tax", "Invoice_Value"]
    tx[num] = tx[num].astype(float)
    dt = pd.to_datetime(tx.Transaction_Date, format="%Y-%m-%d", errors="coerce")
    cols = ["Transaction_ID", "Transaction_Date", "Invoice_No", "Distributor_ID", "Outlet_ID", "SKU_ID", "Sales_Type", "Quantity", "Net_Sales"]
    is_sec = tx.Sales_Type.isin(["Secondary", "Sales Return"]).to_numpy()

    bad_date = dq.add("T-01", "sales_transactions", "Invalid transaction dates",
                      "Transaction_Date is a valid YYYY-MM-DD date within Jan-2021..Dec-2025", "High", tx,
                      dt.isna() | (dt < START) | (dt > END), "Quarantined", n_raw, cols)
    dup = dq.add("T-02", "sales_transactions", "Duplicate transactions",
                 "Business key (Invoice_No, SKU_ID, Sales_Type, Quantity, Outlet_ID) appears once", "High", tx,
                 tx.duplicated(subset=["Invoice_No", "SKU_ID", "Sales_Type", "Quantity", "Outlet_ID"], keep="first"),
                 "Duplicate copies removed (first occurrence kept)", n_raw, cols)
    miss_sku = dq.add("T-03", "sales_transactions", "Missing SKU IDs", "SKU_ID present and in product master",
                      "High", tx, ~tx.SKU_ID.isin(sku_idx), "Quarantined", n_raw, cols)
    miss_out = dq.add("T-04", "sales_transactions", "Missing outlet IDs",
                      "Secondary / return lines carry a valid Outlet_ID", "High", tx,
                      is_sec & ~tx.Outlet_ID.isin(o_idx), "Quarantined", n_raw, cols)
    blank_d = (tx.Distributor_ID == "").to_numpy()
    out_known = tx.Outlet_ID.isin(o_idx).to_numpy()
    repairable = blank_d & is_sec & out_known
    dq.add("T-05", "sales_transactions", "Missing distributor IDs",
           "Distributor_ID populated", "Medium", tx, blank_d,
           f"{int(repairable.sum())} repaired from outlet master; {int((blank_d & ~repairable).sum())} quarantined",
           n_raw, cols)
    outlet_dist = outl.set_index("Outlet_ID").Distributor_ID
    tx.loc[repairable, "Distributor_ID"] = tx.loc[repairable, "Outlet_ID"].map(outlet_dist).values
    no_dist = dq.add("T-06", "sales_transactions", "Sales without a valid distributor",
                     "Distributor_ID exists in distributor master", "High", tx,
                     ~tx.Distributor_ID.isin(d_idx), "Quarantined", n_raw, cols)
    neg = dq.add("T-07", "sales_transactions", "Negative quantities on sales lines",
                 "Quantity > 0 for Primary / Secondary (negatives only allowed on Sales Return)", "High", tx,
                 (tx.Sales_Type != "Sales Return") & (tx.Quantity <= 0), "Quarantined", n_raw, cols)
    dq.add("T-08", "sales_transactions", "Amount integrity", "Net_Sales = Gross_Sales - Discount (+-1)", "Medium", tx,
           (tx.Gross_Sales - tx.Discount - tx.Net_Sales).abs() > 1, "Recomputed", n_raw, cols)
    ok_map = tx.Outlet_ID.map(outlet_dist)
    dq.add("T-09", "sales_transactions", "Outlet-distributor mapping", "Line distributor = outlet's distributor in master",
           "Medium", tx, is_sec & out_known & (ok_map != tx.Distributor_ID).to_numpy() & tx.Distributor_ID.isin(d_idx).to_numpy(),
           "Flagged", n_raw, cols)
    remove = bad_date | dup | miss_sku | miss_out | no_dist | neg
    exc = remove | blank_d
    tables.append(dict(table="Sales transactions", total=n_raw, exceptions=int(exc.sum()), removed=int(remove.sum())))
    tx = tx.loc[~remove].copy()
    dt = dt[~remove]
    log(f"  raw {n_raw:,} -> clean {len(tx):,} ({remove.sum():,} quarantined)")

    # ---- to columnar ----
    day = (dt - START).dt.days.to_numpy()
    month = month_index(dt)
    stype = tx.Sales_Type.map(STYPE).to_numpy()
    di = tx.Distributor_ID.map(d_idx).to_numpy()
    oi = tx.Outlet_ID.map(o_idx).fillna(NONE16).to_numpy().astype(np.int64)
    oi[stype == 0] = NONE16
    si = tx.SKU_ID.map(sku_idx).to_numpy()
    qty = tx.Quantity.to_numpy()
    disc_u = np.round(np.divide(tx.Discount.to_numpy(), tx.Gross_Sales.to_numpy(), out=np.zeros(len(tx)),
                                where=tx.Gross_Sales.to_numpy() != 0) * 400).astype(np.int64)
    order = np.lexsort((si, oi, di, stype, day))
    day, month, stype, di, oi, si, qty, disc_u = (a[order] for a in (day, month, stype, di, oi, si, qty, disc_u))
    raw_net = tx.Net_Sales.to_numpy()[order]
    pp = price_period(month)
    price = np.where(stype == 0, P["Distributor_Price"][si, pp], P["Selling_Price"][si, pp])
    net = qty * price * (1 - disc_u / 400.0)
    recon_diff = np.abs(net - raw_net)
    recon = dict(rows=int(len(net)), raw_net=round(float(raw_net.sum()), 2), recomputed_net=round(float(net.sum()), 2),
                 max_abs_diff=round(float(recon_diff.max()), 4), rows_diff_gt_1=int((recon_diff > 1).sum()))
    log(f"  reconciliation: raw net {raw_net.sum():,.0f} vs recomputed {net.sum():,.0f} (max diff {recon_diff.max():.3f})")
    month_start = np.searchsorted(month, np.arange(N_MONTHS + 1)).tolist()
    sales_layout = write_bundle("sales", {
        "day": day.astype(np.uint16), "stype": stype.astype(np.uint8), "dist": di.astype(np.uint8),
        "outlet": oi.astype(np.uint16), "sku": si.astype(np.uint16), "qty": qty.astype(np.int32),
        "disc": disc_u.astype(np.uint8)})
    sales_layout.update(n=int(len(day)), monthStart=month_start)

    # processed summary for BI tools
    cat_of = prod.Category.to_numpy()
    summ = pd.DataFrame({"Month": month, "Distributor_ID": dist.Distributor_ID.to_numpy()[di], "Category": cat_of[si],
                         "Sales_Type": np.array(list(STYPE))[stype], "Quantity": qty, "Net_Sales": net,
                         "Cost": qty * P["Cost_Price"][si, pp]})
    summ = summ.groupby(["Month", "Distributor_ID", "Category", "Sales_Type"], as_index=False)[["Quantity", "Net_Sales", "Cost"]].sum()
    summ["Month"] = [f"{2021 + m // 12}-{m % 12 + 1:02d}" for m in summ.Month]
    summ["Gross_Margin"] = summ.Net_Sales - summ.Cost
    summ.round(2).to_csv(PROCESSED / "monthly_sales_summary.csv", index=False)

    # ======================================================================= targets
    log("Validating targets ...")
    tg = read("sales_targets")
    mix = read("sku_target_mix")
    n_tg = len(tg)
    tg["m"] = (tg.Month.str[:4].astype(int) - 2021) * 12 + tg.Month.str[5:7].astype(int) - 1
    tg["spi"] = tg.Salesperson_ID.map(sp_idx)
    tg["ci"] = tg.Category.map({c: i for i, c in enumerate(CATEGORIES)})
    T = np.zeros((len(sp), N_MONTHS, 8), dtype=np.float64)
    T[tg.spi.values, tg.m.values, tg.ci.values] = tg.Target_Amount.values
    sec_mask = stype > 0
    sp_of_outlet = outl.Beat_ID.map(beat.set_index("Beat_ID").Salesperson_ID).map(sp_idx).to_numpy()
    sold_spm = np.zeros((len(sp), N_MONTHS))
    np.add.at(sold_spm, (sp_of_outlet[oi[sec_mask]], month[sec_mask]), net[sec_mask])
    has_t = T.sum(axis=2) > 0
    missing = (sold_spm > 0) & ~has_t
    ms_sp, ms_m = np.nonzero(missing)
    miss_df = pd.DataFrame({"Salesperson_ID": sp.Salesperson_ID.to_numpy()[ms_sp],
                            "Month": [f"{2021 + m // 12}-{m % 12 + 1:02d}" for m in ms_m],
                            "Secondary_Sales": np.round(sold_spm[ms_sp, ms_m], 2)})
    dq.add("TG-01", "sales_targets", "Missing targets", "Every salesperson-month with sales has a target",
           "Medium", miss_df, np.ones(len(miss_df), bool),
           "Imputed from the average of adjacent months (same salesperson x category)", int(has_t.sum() + missing.sum()))
    for s_, m_ in zip(ms_sp, ms_m):
        nb = [x for x in (m_ - 1, m_ + 1) if 0 <= x < N_MONTHS and has_t[s_, x]]
        if nb:
            T[s_, m_] = np.mean([T[s_, x] for x in nb], axis=0)
    tables.append(dict(table="Sales targets", total=n_tg, exceptions=int(len(miss_df))))
    MIX = np.zeros((N_MONTHS, len(prod)), dtype=np.float64)
    mix["m"] = (mix.Month.str[:4].astype(int) - 2021) * 12 + mix.Month.str[5:7].astype(int) - 1
    MIX[mix.m.values, mix.SKU_ID.map(sku_idx).values] = mix.Mix_Share.values
    target_layout = write_bundle("targets", {"target": T.astype(np.float32).ravel(), "skuMix": MIX.astype(np.float32).ravel()})
    target_layout.update(dims={"salespersons": len(sp), "months": N_MONTHS, "categories": 8, "skus": len(prod)})

    # ======================================================================= stock
    log("Validating distributor stock ...")
    st = read("distributor_stock")
    n_st = len(st)
    calc = st.Opening_Stock + st.Primary_Received - st.Secondary_Sales + st.Sales_Return + st.Adjustment
    bad = (calc != st.Closing_Stock).to_numpy()
    dq.add("S-01", "distributor_stock", "Stock inconsistencies",
           "Closing = Opening + Primary - Secondary + Returns + Adjustment", "Medium", st, bad,
           "Closing stock recomputed from the roll-forward", n_st,
           ["Snapshot_Date", "Distributor_ID", "SKU_ID", "Opening_Stock", "Primary_Received", "Secondary_Sales",
            "Sales_Return", "Adjustment", "Closing_Stock"])
    st.loc[bad, "Closing_Stock"] = calc[bad]
    ages = st[["Age_0_30", "Age_31_60", "Age_61_90", "Age_90_Plus"]].to_numpy()
    diff = st.Closing_Stock.to_numpy() - ages.sum(axis=1)
    ages[:, 0] = np.maximum(0, ages[:, 0] + diff)
    st["m"] = month_index(pd.to_datetime(st.Snapshot_Date))
    st["di"] = st.Distributor_ID.map(d_idx)
    st["si"] = st.SKU_ID.map(sku_idx)
    prev = st.sort_values(["di", "si", "m"])
    same = (prev.di.values[1:] == prev.di.values[:-1]) & (prev.si.values[1:] == prev.si.values[:-1]) & (prev.m.values[1:] == prev.m.values[:-1] + 1)
    brk = np.zeros(len(prev), bool)
    brk[1:] = same & (prev.Opening_Stock.values[1:] != prev.Closing_Stock.values[:-1])
    dq.add("S-02", "distributor_stock", "Opening stock continuity", "Opening = previous month closing", "Low", prev, brk,
           "Explained by S-01 corrections", n_st, ["Snapshot_Date", "Distributor_ID", "SKU_ID", "Opening_Stock"])
    tables.append(dict(table="Distributor stock", total=n_st, exceptions=int(bad.sum())))
    order = np.lexsort((st.si.values, st.di.values, st.m.values))
    stock_layout = write_bundle("stock", {
        "month": st.m.values[order].astype(np.uint8), "dist": st.di.values[order].astype(np.uint8),
        "sku": st.si.values[order].astype(np.uint16), "closing": st.Closing_Stock.values[order].astype(np.uint32),
        "age0": ages[order, 0].astype(np.uint32), "age1": ages[order, 1].astype(np.uint32),
        "age2": ages[order, 2].astype(np.uint32)})
    stock_layout.update(n=int(n_st), monthStart=np.searchsorted(st.m.values[order], np.arange(N_MONTHS + 1)).tolist())

    # ======================================================================= collections
    log("Validating collections ...")
    cl = read("collections")
    n_cl = len(cl)
    inv_tot = cl.groupby("Invoice_No").agg(amt=("Invoice_Amount", "first"), paid=("Collection_Amount", "sum"))
    over = cl.Invoice_No.map((inv_tot.paid - inv_tot.amt) > 1).to_numpy() & (cl.Collection_Amount > 0).to_numpy()
    dq.add("C-01", "collections", "Collection exceeds invoice amount", "Sum of collections <= invoice amount",
           "Medium", cl, over, "Capped at invoice value (excess held as unapplied advance)", n_cl,
           ["Collection_ID", "Invoice_No", "Invoice_Amount", "Collection_Amount"])
    dq.add("C-02", "collections", "Invoice without distributor", "Distributor_ID exists in master", "High", cl,
           ~cl.Distributor_ID.isin(d_idx), "Quarantined", n_cl)
    tables.append(dict(table="Collections", total=n_cl, exceptions=int(over.sum())))
    cl["inv_day"] = (pd.to_datetime(cl.Invoice_Date) - START).dt.days
    cl["due_day"] = (pd.to_datetime(cl.Due_Date) - START).dt.days
    cl["pay_day"] = (pd.to_datetime(cl.Payment_Date.replace("", None)) - START).dt.days
    pays = cl[cl.Collection_Amount > 0].sort_values(["Invoice_No", "pay_day"])
    pays = pays.assign(k=pays.groupby("Invoice_No").cumcount())
    inv = cl.drop_duplicates("Invoice_No").set_index("Invoice_No")[["Distributor_ID", "inv_day", "due_day", "Invoice_Amount"]]
    p1 = pays[pays.k == 0].set_index("Invoice_No")
    p2 = pays[pays.k >= 1].groupby("Invoice_No").agg(pay_day=("pay_day", "max"), Collection_Amount=("Collection_Amount", "sum"))
    inv = inv.join(p1[["pay_day", "Collection_Amount"]].rename(columns=lambda c: c + "_1")).join(
        p2.rename(columns=lambda c: c + "_2"))
    inv = inv.sort_values("inv_day")
    amt = inv.Invoice_Amount.to_numpy()
    a1 = np.minimum(inv.Collection_Amount_1.fillna(0).to_numpy(), amt)  # cap over-collection (C-01)
    a2 = np.minimum(inv.Collection_Amount_2.fillna(0).to_numpy(), amt - a1)
    coll_layout = write_bundle("collections", {
        "dist": inv.Distributor_ID.map(d_idx).to_numpy().astype(np.uint8),
        "invDay": inv.inv_day.to_numpy().astype(np.uint16), "dueDay": inv.due_day.to_numpy().astype(np.uint16),
        "amount": amt.astype(np.float32),
        "pay1Day": inv.pay_day_1.fillna(NONE16).to_numpy().astype(np.uint16), "pay1Amt": a1.astype(np.float32),
        "pay2Day": inv.pay_day_2.fillna(NONE16).to_numpy().astype(np.uint16), "pay2Amt": a2.astype(np.float32)})
    coll_layout.update(n=int(len(inv)))

    # ======================================================================= Power BI star schema
    export_powerbi(tx, dt, T, sp, dist, outl, beat, prod, st, ages, inv, a1, a2, P,
                   dict(stype=stype, month=month, di=di, si=si, qty=qty))

    # ======================================================================= masters.json
    log("Writing masters and manifest ...")
    beat_sp = beat.Salesperson_ID.map(sp_idx).to_numpy()
    masters = {
        "regions": regions,
        "states": {"name": states.State.tolist(), "code": states.State_Code.tolist(),
                   "region": [regions.index(r) for r in states.Region]},
        "territories": {"id": terr.Territory_ID.tolist(), "name": terr.Territory_Name.tolist(),
                        "state": [st_idx[s] for s in terr.State]},
        "distributors": {
            "id": dist.Distributor_ID.tolist(), "name": dist.Distributor_Name.tolist(),
            "type": dist.Distributor_Type.tolist(), "status": dist.Distributor_Status.tolist(),
            "territory": [te_idx[t] for t in dist.Territory], "city": dist.City.tolist(),
            "creditLimit": dist.Credit_Limit.round(0).tolist(), "creditDays": dist.Credit_Days.tolist(),
            "salesTarget": dist.Sales_Target.round(0).tolist(), "joinDate": dist.Join_Date.tolist()},
        "salespersons": {"id": sp.Salesperson_ID.tolist(), "name": sp.Salesperson_Name.tolist(),
                         "dist": [d_idx[d] for d in sp.Distributor_ID], "joinDate": sp.Joining_Date.tolist(),
                         "status": sp.Status.tolist()},
        "beats": {"id": beat.Beat_ID.tolist(), "name": beat.Beat_Name.tolist(), "sp": beat_sp.tolist(),
                  "visitDay": beat.Visit_Day.tolist()},
        "outletTypes": OUTLET_TYPES,
        "outlets": {"id": outl.Outlet_ID.tolist(), "name": outl.Outlet_Name.tolist(),
                    "type": [OUTLET_TYPES.index(t) for t in outl.Outlet_Type], "beat": [bt_idx[b] for b in outl.Beat_ID],
                    "city": outl.City.tolist(), "status": outl.Outlet_Status.tolist(),
                    "openDate": outl.Opening_Date.tolist(), "closedDate": outl.Closed_Date.tolist()},
        "categories": CATEGORIES,
        "brands": {"name": brands, "cat": [CATEGORIES.index(prod[prod.Brand == b].Category.iloc[0]) for b in brands]},
        "subCategories": {"name": subs, "cat": [CATEGORIES.index(prod[prod.Sub_Category == s].Category.iloc[0]) for s in subs]},
        "skus": {"id": prod.SKU_ID.tolist(), "code": prod.SKU_Code.tolist(), "name": prod.Product_Name.tolist(),
                 "brand": [brands.index(b) for b in prod.Brand], "sub": [subs.index(s) for s in prod.Sub_Category],
                 "cat": [CATEGORIES.index(c) for c in prod.Category], "pack": (prod.Pack_Size.astype(str) + " " + prod.UOM).tolist(),
                 "status": prod.Product_Status.tolist(), "launchDate": prod.Launch_Date.tolist(),
                 "gst": prod.GST_Rate.tolist(), "caseSize": prod.Case_Size.tolist(),
                 "mrp": np.round(P["MRP"], 2).tolist(), "ptr": np.round(P["Selling_Price"], 2).tolist(),
                 "ptd": np.round(P["Distributor_Price"], 2).tolist(), "cogs": np.round(P["Cost_Price"], 2).tolist()},
    }
    (WEB / "masters.json").write_text(json.dumps(masters, separators=(",", ":")), encoding="utf-8")

    truth = json.loads((RAW / "_ground_truth.json").read_text()) if (RAW / "_ground_truth.json").exists() else {}
    manifest = {
        "version": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "company": "Aranya Consumer Products Ltd.",
        "currency": "INR",
        "startDate": "2021-01-01", "endDate": "2025-12-31", "asOfDate": "2025-12-31",
        "months": [f"{2021 + m // 12}-{m % 12 + 1:02d}" for m in range(N_MONTHS)],
        "pricePeriods": ["Jan-Mar 2021", "FY 2021-22", "FY 2022-23", "FY 2023-24", "FY 2024-25", "FY 2025-26"],
        "rawRowCounts": truth.get("row_counts", {}),
        "bundles": {"sales": sales_layout, "stock": stock_layout, "targets": target_layout, "collections": coll_layout},
    }
    (WEB / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")

    # ======================================================================= DQ report
    total = sum(t["total"] for t in tables)
    exc = sum(t["exceptions"] for t in tables)
    for t in tables:
        t["valid"] = t["total"] - t.get("removed", 0)
        t["dqPct"] = round((t["total"] - t["exceptions"]) / max(t["total"], 1) * 100, 3)
    report = {"generatedAt": manifest["generatedAt"], "totalRecords": total, "exceptionRecords": exc,
              "validRecords": total - sum(t.get("removed", 0) for t in tables),
              "dqPct": round((total - exc) / total * 100, 3), "tables": tables, "checks": dq.checks,
              "reconciliation": recon}
    (WEB / "data_quality.json").write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
    pd.DataFrame([{k: v for k, v in c.items() if k != "sample"} for c in dq.checks]).to_csv(
        PROCESSED / "data_quality_checks.csv", index=False)
    if dq.quarantine:
        pd.concat(dq.quarantine, ignore_index=True).to_csv(PROCESSED / "quarantined_records.csv", index=False)

    # ------------------------------------------------------------------ reference totals for automated tests
    # Computed independently with pandas from the cleaned raw rows (raw Net_Sales, raw Stock_Value, raw payments)
    # so the TypeScript engine can be reconciled against them (see src/analytics/engine.test.ts).
    ref_tx = tx.assign(Year=dt.dt.year.to_numpy(), Region=tx.Distributor_ID.map(dist.set_index("Distributor_ID").Region))
    by_year = ref_tx.pivot_table(index="Year", columns="Sales_Type", values="Net_Sales", aggfunc="sum").fillna(0)
    st_dec = st[st.m == N_MONTHS - 1]
    cl_inv = cl.groupby("Invoice_No").agg(amt=("Invoice_Amount", "first"), paid=("Collection_Amount", "sum"))
    reference = {
        "netSalesByYearType": {str(int(y)): {k: round(float(v), 2) for k, v in row.items()} for y, row in by_year.iterrows()},
        "netSecondary2025ByRegion": {r: round(float(v), 2) for r, v in ref_tx[(ref_tx.Year == 2025) & ref_tx.Sales_Type.isin(["Secondary", "Sales Return"])].groupby("Region").Net_Sales.sum().items()},
        "targetByYear": {str(2021 + y): round(float(T[:, y * 12:(y + 1) * 12].sum()), 2) for y in range(5)},
        "stockValueDec2025": round(float(st_dec.Stock_Value.sum()), 2),
        "stockOutLinesDec2025": int((st_dec.Closing_Stock <= 0).sum()),
        "outstandingDec2025": round(float((cl_inv.amt - np.minimum(cl_inv.paid, cl_inv.amt)).clip(lower=0).sum()), 2),
        "secondaryOrders2025": int(ref_tx[(ref_tx.Year == 2025) & (ref_tx.Sales_Type == "Secondary")].Invoice_No.nunique()),
    }
    (PROCESSED / "reference_totals.json").write_text(json.dumps(reference, indent=1), encoding="utf-8")

    # distributor scorecard (CY2025) for BI users
    y25 = month >= 48
    sc = pd.DataFrame({"d": di[y25], "t": stype[y25], "net": net[y25]}).pivot_table(index="d", columns="t", values="net", aggfunc="sum").fillna(0)
    sc = sc.reindex(range(len(dist)), fill_value=0)
    card = dist[["Distributor_ID", "Distributor_Name", "Region", "State", "Distributor_Type"]].copy()
    card["Primary_Sales"] = sc.get(0, 0).round(2).values
    card["Secondary_Sales_Net"] = (sc.get(1, 0) + sc.get(2, 0)).round(2).values
    tg_d = np.bincount(sp.Distributor_ID.map(d_idx).to_numpy(), weights=T[:, 48:60].sum(axis=(1, 2)), minlength=len(dist))
    card["Target"] = tg_d.round(0)
    card["Achievement_Pct"] = np.round(card.Secondary_Sales_Net / card.Target.replace(0, np.nan) * 100, 1)
    card.to_csv(PROCESSED / "distributor_scorecard_2025.csv", index=False)
    log(f"Data quality: {report['dqPct']}% | done in {time.time() - t0:.0f}s -> {WEB}")


if __name__ == "__main__":
    main()
