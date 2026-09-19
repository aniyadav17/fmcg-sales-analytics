#!/usr/bin/env python3
"""
generate_data.py
================
Deterministic synthetic-data generator for the FMCG Sales Analytics project.

It simulates five years (Jan-2021 .. Dec-2025) of an Indian FMCG company's
distribution business - company -> distributor (primary) -> outlet (secondary) -
and writes "raw" extracts that look like what a DMS / ERP would export:

    data/raw/
        dim_geography.csv            Region > State > Territory > City
        product_master.csv           SKU master (current price list)
        price_list.csv               Price history by FY price period
        distributor_master.csv
        salesperson_master.csv
        beat_master.csv
        outlet_master.csv
        sales_transactions.csv.gz    ~1M invoice lines (Primary / Secondary / Sales Return)
        sales_targets.csv            Monthly Salesperson x Category targets
        sku_target_mix.csv           Monthly SKU share-of-category plan (target disaggregation)
        distributor_stock.csv.gz     Monthly Distributor x SKU stock roll-forward + FIFO ageing
        collections.csv              Primary invoice payments / outstanding
        _ground_truth.json           Business patterns deliberately planted in the data

The data is NOT random noise. It is produced by a small business simulation:

* Demand is generated outlet-by-outlet from outlet type, salesperson skill,
  distributor execution, regional growth, seasonality, COVID-wave disruption,
  SKU life-cycle (core / growing / declining / new launch / slow / seasonal)
  and regional taste.
* Distributors replenish stock with an (s, S) ordering policy that depends on
  their behaviour (star, steady, under-performer, over-stocker, stock-out prone),
  case-pack MOQs and quarter-end "loading" pushes.
* Secondary sales are capped by distributor stock, so stock-outs cause lost
  sales, and slow SKUs bought in full cases turn into slow / non-moving stock.
* Returns flow back one month after the sale; damaged returns are written off.
* Targets are set from last-year actuals plus a plan uplift.
* Collections follow distributor payment behaviour and credit terms.

A handful of data-quality defects (duplicates, missing keys, invalid dates, ...)
are injected on purpose so the ETL step (build_dataset.py) has something real
to detect, report and clean.

Usage
-----
    python data/generate_data.py                 # default ~1M transaction lines
    python data/generate_data.py --scale 0.5     # smaller / faster
    python data/generate_data.py --seed 7        # a different (still reproducible) world
    python data/generate_data.py --no-compress   # plain .csv for the large fact tables

After generation the script runs build_dataset.py (validation + browser bundle)
unless --skip-build is passed.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "raw"

COMPANY = "Aranya Consumer Products Ltd."
START_DATE = np.datetime64("2021-01-01")
N_MONTHS = 60  # Jan-2021 .. Dec-2025
MONTH_START = np.array(
    [np.datetime64(f"{2021 + m // 12}-{m % 12 + 1:02d}-01") for m in range(N_MONTHS + 1)]
)
MONTH_START_DAY = (MONTH_START - START_DATE).astype(np.int64)  # day index of each month start
AS_OF_DAY = int(MONTH_START_DAY[-1] - 1)  # 2025-12-31 : report date for outstanding
ONE_DAY = np.timedelta64(1, "D")


def day_str(day) -> str:
    return str(START_DATE + np.timedelta64(int(day), "D"))

# ----------------------------------------------------------------------------------
# Geography  (region -> state -> (code, market weight, cities))
# ----------------------------------------------------------------------------------
GEO = {
    "North": {
        "Delhi": ("DL", 7, ["New Delhi", "Dwarka", "Rohini", "Shahdara"]),
        "Haryana": ("HR", 4, ["Gurugram", "Faridabad", "Panipat", "Hisar"]),
        "Punjab": ("PB", 4, ["Ludhiana", "Amritsar", "Jalandhar", "Patiala"]),
        "Uttar Pradesh": ("UP", 12, ["Lucknow", "Kanpur", "Noida", "Varanasi", "Agra", "Meerut", "Prayagraj", "Gorakhpur"]),
        "Uttarakhand": ("UK", 2, ["Dehradun", "Haridwar", "Haldwani"]),
    },
    "West": {
        "Maharashtra": ("MH", 12, ["Mumbai", "Pune", "Nagpur", "Nashik", "Aurangabad", "Thane", "Kolhapur"]),
        "Gujarat": ("GJ", 8, ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar"]),
        "Rajasthan": ("RJ", 6, ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer"]),
    },
    "Central": {
        "Madhya Pradesh": ("MP", 6, ["Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain"]),
        "Chhattisgarh": ("CG", 3, ["Raipur", "Bilaspur", "Durg"]),
    },
    "South": {
        "Karnataka": ("KA", 7, ["Bengaluru", "Mysuru", "Hubballi", "Mangaluru", "Belagavi"]),
        "Tamil Nadu": ("TN", 8, ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem"]),
        "Telangana": ("TS", 5, ["Hyderabad", "Warangal", "Karimnagar", "Nizamabad"]),
        "Kerala": ("KL", 4, ["Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur"]),
        "Andhra Pradesh": ("AP", 5, ["Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Nellore"]),
    },
    "East": {
        "West Bengal": ("WB", 7, ["Kolkata", "Howrah", "Siliguri", "Durgapur", "Asansol"]),
        "Bihar": ("BR", 5, ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur"]),
        "Odisha": ("OD", 3, ["Bhubaneswar", "Cuttack", "Rourkela"]),
        "Jharkhand": ("JH", 3, ["Ranchi", "Jamshedpur", "Dhanbad"]),
        "Assam": ("AS", 3, ["Guwahati", "Dibrugarh", "Silchar"]),
    },
}
REGIONS = list(GEO.keys())
METROS = {"New Delhi", "Mumbai", "Pune", "Bengaluru", "Chennai", "Hyderabad", "Kolkata", "Ahmedabad", "Gurugram", "Noida", "Kochi", "Lucknow", "Jaipur"}

# Underlying annual volume growth by region (East = rural push, Central = sluggish)
REGION_TREND = {"North": 0.015, "West": 0.025, "Central": -0.01, "South": 0.045, "East": 0.055}

# ----------------------------------------------------------------------------------
# Product master templates
# (category, sub_category, brand, product noun, variants, packs[(label, MRP)], GST %, season, tier)
# ----------------------------------------------------------------------------------
PRODUCTS = [
    ("Personal Care", "Bath Soap", "Snaana", "Soap", ["Sandal", "Neem", "Aloe Vera", "Lime Fresh", "Rose Glycerine"], [("75 g", 38), ("125 g", 62), ("4x125 g", 230)], 18, "flat", "mass"),
    ("Personal Care", "Body Wash", "FreshAura", "Body Wash", ["Ocean Breeze", "Citrus Burst"], [("250 ml", 199), ("500 ml", 349)], 18, "summer", "premium"),
    ("Personal Care", "Deodorant", "FreshAura", "Deo", ["Sport", "Musk", "Aqua"], [("150 ml", 225)], 18, "summer", "premium"),
    ("Personal Care", "Talc", "FreshAura", "Talc", ["Cool Mint", "Classic"], [("100 g", 95), ("300 g", 230)], 18, "summer", "mass"),
    ("Personal Care", "Hand Wash", "Kavach", "Hand Wash", ["Neem", "Lemon", "Aloe"], [("200 ml", 99), ("750 ml", 199), ("1.5 L", 349)], 18, "monsoon", "mass"),
    ("Health & Wellness", "Chyawanprash", "Ayurvita", "Chyawanprash", ["Classic", "Sugar Free", "Kesar"], [("500 g", 245), ("1 kg", 425)], 12, "winter", "mass"),
    ("Health & Wellness", "Herbal Juice", "Ayurvita", "Juice", ["Aloe Vera", "Amla", "Giloy", "Karela Jamun"], [("500 ml", 199), ("1 L", 349)], 12, "flat", "mass"),
    ("Health & Wellness", "Honey", "Ayurvita", "Honey", ["Pure"], [("250 g", 125), ("500 g", 225), ("1 kg", 399)], 5, "winter", "mass"),
    ("Health & Wellness", "Immunity Tablets", "ImmunoPlus", "Tablets", ["Tulsi", "Ashwagandha", "Multivitamin", "Vitamin C Zinc"], [("60 tab", 299), ("120 tab", 549)], 12, "winter", "premium"),
    ("Health & Wellness", "Digestives", "Sehat", "Digestive", ["Jeera", "Hing Goli", "Ajwain", "Amla Candy"], [("50 g", 40), ("100 g", 75)], 12, "festive", "mass"),
    ("Food & Beverages", "Tea", "Chai Bahar", "Tea", ["Premium Leaf", "Masala", "Green", "Assam Dust"], [("250 g", 145), ("500 g", 280), ("1 kg", 540)], 5, "winter", "mass"),
    ("Food & Beverages", "Biscuits", "Crunchy Bites", "Biscuits", ["Glucose", "Cream Classic", "Digestive Marie", "Butter Cookies"], [("75 g", 10), ("200 g", 30), ("600 g", 90)], 18, "flat", "mass"),
    ("Food & Beverages", "Namkeen", "Swad", "Namkeen", ["Aloo Bhujia", "Moong Dal", "Navratan Mix"], [("40 g", 10), ("200 g", 50), ("400 g", 95)], 12, "festive", "mass"),
    ("Food & Beverages", "Instant Noodles", "Swad", "Noodles", ["Masala", "Atta Veg"], [("70 g", 14), ("280 g", 56)], 12, "flat", "mass"),
    ("Food & Beverages", "Health Drink", "Nutrimix", "Health Drink", ["Chocolate", "Kesar Badam", "Junior"], [("200 g", 150), ("500 g", 345), ("1 kg", 620)], 18, "flat", "premium"),
    ("Food & Beverages", "Ghee & Spices", "Rasoi Gold", "", ["Desi Ghee", "Garam Masala", "Turmeric Powder", "Red Chilli Powder"], [("100 g", 55), ("500 g", 260), ("1 kg", 495)], 5, "festive", "mass"),
    ("Home Care", "Dishwash", "Chamak", "Dishwash", ["Lemon Bar", "Gel Lime"], [("200 g", 25), ("500 g", 99), ("1 kg", 189)], 18, "flat", "mass"),
    ("Home Care", "Floor Cleaner", "Swachh", "Floor Cleaner", ["Pine", "Lavender", "Disinfectant"], [("500 ml", 99), ("1 L", 179), ("2 L", 329)], 18, "monsoon", "mass"),
    ("Home Care", "Toilet Cleaner", "Swachh", "Toilet Cleaner", ["Original", "Lemon"], [("500 ml", 95), ("1 L", 175)], 18, "flat", "mass"),
    ("Home Care", "Detergent", "Suvasa", "Detergent", ["Powder", "Liquid Matic"], [("500 g", 65), ("1 kg", 120), ("4 kg", 445)], 18, "festive", "mass"),
    ("Home Care", "Mosquito Repellent", "Suvasa", "Repellent", ["Liquid Vaporizer", "Coil"], [("45 ml", 89), ("10 pcs", 45)], 18, "monsoon", "mass"),
    ("Oral Care", "Toothpaste", "DantaShakti", "Toothpaste", ["Herbal", "Clove", "Salt Neem", "Whitening", "Sensitive"], [("50 g", 25), ("100 g", 55), ("200 g", 105)], 18, "flat", "mass"),
    ("Oral Care", "Tooth Powder", "DantaShakti", "Tooth Powder", ["Red", "Black"], [("50 g", 30), ("100 g", 55)], 18, "flat", "mass"),
    ("Oral Care", "Toothbrush", "SmileGuard", "Toothbrush", ["Soft", "Medium", "Kids"], [("1 pc", 35), ("3 pc", 95)], 18, "flat", "mass"),
    ("Oral Care", "Mouthwash", "SmileGuard", "Mouthwash", ["Cool Mint", "Clove Fresh"], [("250 ml", 145), ("500 ml", 265)], 18, "flat", "premium"),
    ("Hair Care", "Hair Oil", "Keshini", "Hair Oil", ["Coconut", "Amla", "Bhringraj", "Almond"], [("100 ml", 65), ("200 ml", 120), ("500 ml", 270)], 18, "winter", "mass"),
    ("Hair Care", "Shampoo", "SilkRoots", "Shampoo", ["Anti-Dandruff", "Smooth & Shine", "Herbal"], [("80 ml", 75), ("180 ml", 170), ("340 ml", 299)], 18, "flat", "mass"),
    ("Hair Care", "Conditioner", "SilkRoots", "Conditioner", ["Smooth", "Repair"], [("180 ml", 199)], 18, "flat", "premium"),
    ("Hair Care", "Hair Colour", "Keshini", "Henna", ["Natural Black", "Burgundy"], [("120 g", 99)], 18, "festive", "mass"),
    ("Skin Care", "Face Wash", "Nikhaar", "Face Wash", ["Neem", "Charcoal", "Vitamin C"], [("50 ml", 99), ("100 ml", 175)], 18, "flat", "premium"),
    ("Skin Care", "Body Lotion", "Coco Soft", "Body Lotion", ["Cocoa Butter", "Aloe Hydrate"], [("100 ml", 145), ("400 ml", 399)], 18, "winter", "mass"),
    ("Skin Care", "Sunscreen", "SunVeil", "Sunscreen", ["SPF 30", "SPF 50"], [("50 g", 299), ("100 g", 499)], 18, "summer", "premium"),
    ("Skin Care", "Face Cream", "Nikhaar", "Face Cream", ["Day Glow", "Night Repair"], [("50 g", 249)], 18, "flat", "premium"),
    ("Baby Care", "Baby Oil", "Nanhe", "Baby Oil", ["Massage", "Almond"], [("100 ml", 120), ("200 ml", 220)], 18, "winter", "mass"),
    ("Baby Care", "Baby Powder", "Nanhe", "Baby Powder", ["Classic"], [("100 g", 99), ("200 g", 185)], 18, "summer", "mass"),
    ("Baby Care", "Baby Wipes", "BabyBloom", "Baby Wipes", ["Aloe", "Unscented"], [("72 pcs", 199)], 18, "flat", "premium"),
    ("Baby Care", "Diapers", "BabyBloom", "Diapers", ["Small", "Medium", "Large"], [("20 pcs", 399), ("40 pcs", 749)], 12, "flat", "premium"),
]
CATEGORIES = ["Personal Care", "Health & Wellness", "Food & Beverages", "Home Care", "Oral Care", "Hair Care", "Skin Care", "Baby Care"]
CAT_CODE = {"Personal Care": "PC", "Health & Wellness": "HW", "Food & Beverages": "FB", "Home Care": "HC", "Oral Care": "OC", "Hair Care": "HR", "Skin Care": "SC", "Baby Care": "BC"}

# Month-of-year seasonality shapes (Jan..Dec)
SEASON = {
    "flat":    [1.00, 0.95, 1.00, 1.00, 1.00, 0.95, 0.95, 1.00, 1.05, 1.12, 1.10, 1.00],
    "summer":  [0.60, 0.75, 1.10, 1.50, 1.70, 1.40, 0.90, 0.80, 0.80, 0.80, 0.70, 0.60],
    "winter":  [1.50, 1.20, 0.80, 0.60, 0.50, 0.55, 0.60, 0.70, 0.90, 1.20, 1.50, 1.70],
    "monsoon": [0.60, 0.60, 0.70, 0.80, 1.00, 1.40, 1.80, 1.80, 1.50, 1.00, 0.70, 0.60],
    "festive": [0.90, 0.90, 1.10, 0.90, 0.85, 0.85, 0.90, 1.00, 1.30, 1.60, 1.40, 1.00],
}
# Overall market pulse on order frequency (Diwali Oct/Nov peak, Feb/Jun-Jul softness)
OVERALL_SEASON = np.array([0.97, 0.93, 1.00, 0.98, 1.00, 0.95, 0.95, 1.00, 1.05, 1.12, 1.08, 1.00])

# Price & cost indices by price period (P0 = Jan-Mar 2021, P1 = FY21-22, ... P5 = Apr-Dec 2025)
PRICE_PERIODS = ["Jan-Mar 2021", "FY 2021-22", "FY 2022-23", "FY 2023-24", "FY 2024-25", "FY 2025-26"]
PRICE_PERIOD_FROM = ["2021-01-01", "2021-04-01", "2022-04-01", "2023-04-01", "2024-04-01", "2025-04-01"]
PRICE_PERIOD_TO = ["2021-03-31", "2022-03-31", "2023-03-31", "2024-03-31", "2025-03-31", "2026-03-31"]
PRICE_INDEX = np.cumprod([1.00, 1.04, 1.07, 1.05, 1.04, 1.03])
COST_INDEX = np.cumprod([1.00, 1.05, 1.11, 1.03, 1.02, 1.025])  # FY22-23 input-cost inflation squeezes margin


def price_period(m: np.ndarray | int):
    m = np.asarray(m)
    return np.where(m < 3, 0, np.minimum(5, 1 + (m - 3) // 12))


OUTLET_TYPES = ["General Trade", "Pharmacy", "Supermarket", "Modern Trade", "Wholesale", "Institutional", "E-commerce"]
OT = {t: i for i, t in enumerate(OUTLET_TYPES)}
CHANNEL = {"General Trade": "Traditional Trade", "Wholesale": "Traditional Trade", "Pharmacy": "Pharma",
           "Supermarket": "Modern Trade", "Modern Trade": "Modern Trade", "Institutional": "Institutional",
           "E-commerce": "E-commerce"}
OT_ORDER_FREQ = np.array([1.00, 0.90, 1.50, 2.00, 1.70, 0.80, 2.80])  # relative orders / month
OT_EXTRA_LINES = np.array([1.60, 0.90, 2.40, 3.20, 2.00, 1.40, 3.50])  # lines per order = 1 + Poisson(x)
OT_QTY_MULT = np.array([1.0, 0.8, 2.2, 3.5, 3.5, 2.5, 4.0])
OT_DISC_MEAN = np.array([3.0, 4.0, 6.5, 10.0, 7.0, 12.0, 13.0])  # % trade discount
OT_DISC_SD = np.array([1.0, 1.0, 1.5, 2.0, 1.5, 2.0, 2.5])
OT_RETURN = np.array([1.3, 0.8, 1.2, 1.6, 0.7, 0.6, 1.8])
OT_MIX = {
    "Urban Distributor":    [0.55, 0.15, 0.10, 0.03, 0.12, 0.05, 0.00],
    "Rural Distributor":    [0.70, 0.10, 0.03, 0.00, 0.17, 0.00, 0.00],
    "Super Stockist":       [0.45, 0.12, 0.10, 0.03, 0.25, 0.05, 0.00],
    "Key Account Distributor": [0.00, 0.05, 0.35, 0.35, 0.00, 0.15, 0.10],
}
# Outlet type x category affinity
CAT_AFFINITY = {
    "Pharmacy":      {"Health & Wellness": 4.0, "Oral Care": 1.5, "Baby Care": 2.5, "Skin Care": 1.6, "Personal Care": 0.8, "Food & Beverages": 0.25, "Home Care": 0.2, "Hair Care": 0.7},
    "Institutional": {"Home Care": 3.0, "Food & Beverages": 2.2, "Personal Care": 1.6, "Health & Wellness": 0.5, "Oral Care": 0.5, "Hair Care": 0.3, "Skin Care": 0.3, "Baby Care": 0.2},
    "Supermarket":   {"Skin Care": 1.4, "Baby Care": 1.3},
    "Modern Trade":  {"Skin Care": 1.5, "Baby Care": 1.4, "Health & Wellness": 1.2},
    "E-commerce":    {"Skin Care": 1.8, "Health & Wellness": 1.5, "Baby Care": 1.6, "Food & Beverages": 0.5, "Home Care": 0.6},
}

DIST_ARCHETYPES = ["star", "steady", "underperformer", "overstocker", "stockout_prone"]
ARCH_P = [0.15, 0.43, 0.15, 0.13, 0.14]
ARCH_EXEC = {"star": 1.15, "steady": 1.00, "underperformer": 0.85, "overstocker": 0.90, "stockout_prone": 0.97}
ARCH_TREND = {"star": 0.06, "steady": 0.0, "underperformer": -0.09, "overstocker": -0.03, "stockout_prone": 0.0}
ARCH_COVER = {"star": (22, 4), "steady": (22, 5), "underperformer": (30, 8), "overstocker": (55, 10), "stockout_prone": (10, 3)}
ARCH_PAY_DELAY = {"star": (-5, 3), "steady": (-1, 6), "underperformer": (22, 14), "overstocker": (18, 12), "stockout_prone": (38, 20)}
CREDIT_DAYS = {"Super Stockist": 30, "Urban Distributor": 21, "Rural Distributor": 15, "Key Account Distributor": 30}

DIST_PREFIX = ["Shree Balaji", "Sai Krishna", "Maa Durga", "Ganesh", "Laxmi", "Om Sai", "Jai Ambe", "Shiv Shakti", "Radhe",
               "Mahalaxmi", "Sri Venkateswara", "Annapurna", "Vinayak", "Siddhi", "Bharat", "National", "Royal", "Prime",
               "Metro", "Star", "Global", "Supreme", "United", "Krishna", "Hanuman", "Guru Kripa", "Anand", "New India",
               "Galaxy", "Pioneer", "Sagar", "Kaveri", "Narmada", "Ganga", "Himalaya", "Vindhya", "Sahyadri", "Coromandel"]
DIST_SUFFIX = ["Agencies", "Enterprises", "Distributors", "Marketing", "Trading Co.", "Associates", "Sales Corporation", "Traders"]
FIRST_NAMES = ["Amit", "Rahul", "Priya", "Sanjay", "Neha", "Vikas", "Anjali", "Rohit", "Pooja", "Manoj", "Kavita", "Deepak",
               "Suresh", "Ritu", "Arun", "Sneha", "Rajesh", "Meena", "Nitin", "Swati", "Vivek", "Divya", "Ajay", "Shweta",
               "Karan", "Nisha", "Harish", "Lakshmi", "Prakash", "Asha", "Gaurav", "Sunita", "Tarun", "Rekha", "Imran",
               "Farah", "Joseph", "Mary", "Gurpreet", "Harpreet", "Arjun", "Keerthi", "Sandeep", "Bhavna", "Mohit", "Pallavi"]
LAST_NAMES = {
    "North": ["Sharma", "Verma", "Singh", "Gupta", "Chauhan", "Yadav", "Malhotra", "Saxena", "Arora", "Bansal"],
    "West": ["Patel", "Shah", "Deshmukh", "Joshi", "Kulkarni", "Pawar", "Mehta", "Jain", "Rathore", "Solanki"],
    "Central": ["Tiwari", "Mishra", "Dubey", "Chouhan", "Pandey", "Shukla", "Thakur", "Sahu"],
    "South": ["Reddy", "Nair", "Iyer", "Rao", "Kumar", "Pillai", "Naidu", "Menon", "Gowda", "Krishnan"],
    "East": ["Das", "Banerjee", "Mukherjee", "Roy", "Sahu", "Mohanty", "Ghosh", "Sinha", "Jha", "Barua"],
}
OUTLET_PREFIX = ["Shree", "Sai", "New", "Jai", "Om", "Balaji", "Krishna", "Laxmi", "Maa Durga", "Ganesh", "Royal", "City",
                 "Star", "Sri", "Anand", "Gupta", "Sharma", "Patel", "Janta", "Apna", "Bharat", "Kisan", "Sagar", "Friends",
                 "Metro", "Daily", "Fresh", "Mahavir", "Guru Nanak", "Madina", "St. Mary's", "Venkatesh", "Kamdhenu"]
OUTLET_SUFFIX = {
    "General Trade": ["Kirana Store", "General Store", "Provision Store", "Stores", "Departmental Store"],
    "Pharmacy": ["Medicals", "Pharmacy", "Chemists", "Medical Hall", "Drug House"],
    "Supermarket": ["Supermarket", "Super Bazaar", "Fresh Mart", "Daily Needs"],
    "Modern Trade": ["Hypermarket", "Retail Mall", "Megastore", "Value Mart"],
    "Wholesale": ["Wholesale", "Enterprises", "Traders", "Wholesale Depot"],
    "Institutional": ["Hotel", "Hospital Canteen", "Corporate Canteen", "Hostel Mess", "Caterers"],
    "E-commerce": ["Quick Commerce Hub", "E-Retail Fulfilment Centre", "Dark Store"],
}
LOCALITIES = ["Main Bazaar", "Station Road", "Civil Lines", "Gandhi Nagar", "Nehru Colony", "Market Yard", "Old City",
              "Industrial Area", "Sadar Bazaar", "Model Town", "Rajendra Nagar", "Shastri Nagar", "Bus Stand",
              "College Road", "Ring Road", "New Colony", "Cantonment", "Housing Board", "Ganj", "Chowk"]


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def fy_label(month_idx: np.ndarray) -> np.ndarray:
    """Indian financial year label like '2122' for Apr-21..Mar-22."""
    y = 2021 + month_idx // 12
    mo = month_idx % 12 + 1
    start = np.where(mo >= 4, y, y - 1)
    return np.char.add(np.char.zfill((start % 100).astype(str), 2), np.char.zfill(((start + 1) % 100).astype(str), 2))


# ==================================================================================
def build_geography():
    rows, terrs = [], []
    for region, states in GEO.items():
        for state, (code, weight, cities) in states.items():
            n_terr = min(len(cities), max(2, math.ceil(weight / 2)))
            for t in range(n_terr):
                tcities = cities[t::n_terr]
                tid = f"TER-{len(terrs) + 1:03d}"
                terrs.append(dict(Territory_ID=tid, Territory_Name=f"{tcities[0]} HQ", Region=region, State=state,
                                  State_Code=code, cities=tcities, weight=weight / n_terr))
                for c in tcities:
                    rows.append(dict(Country="India", Region=region, State=state, State_Code=code, City=c,
                                     Territory_ID=tid, Territory_Name=f"{tcities[0]} HQ"))
    return pd.DataFrame(rows), terrs


def build_products(rng):
    rows = []
    for (cat, sub, brand, noun, variants, packs, gst, season, tier) in PRODUCTS:
        for v in variants:
            for pi, (label, mrp) in enumerate(packs):
                size, uom = label.split(" ", 1)
                name = " ".join(x for x in [brand, v, noun, label] if x)
                rows.append(dict(Category=cat, Sub_Category=sub, Brand=brand, Variant=v, Product_Name=name,
                                 Pack_Size=size, UOM=uom, MRP0=float(mrp), GST=gst, season=season, tier=tier,
                                 pack_rank=pi, n_packs=len(packs)))
    df = pd.DataFrame(rows)
    n = len(df)
    df["SKU_ID"] = [f"SKU-{i + 1:04d}" for i in range(n)]
    df["SKU_Code"] = [f"{CAT_CODE[c]}{b[:3].upper()}{i + 1:04d}" for i, (c, b) in enumerate(zip(df.Category, df.Brand))]

    # ---- life-cycle archetypes (the ground truth the dashboard should uncover) ----
    arch = np.array(["core"] * n, dtype=object)
    arch[df.season.values != "flat"] = "seasonal"
    arch[(df.tier.values == "premium")] = "premium"
    growing_kw = ["Green", "Vitamin C", "Charcoal", "SPF 50", "Multivitamin", "Ashwagandha", "Liquid Matic", "Gel Lime", "Giloy"]
    declining_kw = ["Tooth Powder", "Coil", "Lemon Bar", "Assam Dust", "Hing Goli", "Burgundy"]
    for i, r in df.iterrows():
        if any(k in r.Product_Name for k in growing_kw):
            arch[i] = "growing"
        if any(k in r.Product_Name for k in declining_kw):
            arch[i] = "declining"
    launch_m = np.zeros(n, dtype=int)
    new_launch = {"Vitamin C Zinc": 20, "Sensitive": 27, "Karela Jamun": 33, "Butter Cookies": 37, "Night Repair": 42,
                  "Junior": 48, "Rose Glycerine": 17, "Kesar Chyawanprash": 45, "Liquid Matic": 12, "Kesar Badam": 30}
    for i, r in df.iterrows():
        for k, m in new_launch.items():
            if k in f"{r.Variant} {r.Sub_Category}" or k in r.Product_Name:
                launch_m[i] = m + int(r.pack_rank)  # bigger packs follow a month later
                arch[i] = "new"
    weak_launch = df.Product_Name.str.contains("Night Repair|Kesar Chyawanprash|Junior Health Drink 1 kg").values
    # slow movers: expensive big packs + random tail
    big = (df.MRP0.values >= 500) & (arch == "premium")
    slow = big | ((rng.random(n) < 0.10) & np.isin(arch, ["core", "seasonal"]))
    arch[slow & (arch != "new")] = "slow"
    disc_m = np.full(n, N_MONTHS, dtype=int)
    discontinue = {"Tooth Powder 100 g": 44, "Black Tooth Powder 50 g": 50, "Coil Repellent": 51, "Lemon Bar Dishwash 1 kg": 38,
                   "Assam Dust Tea 1 kg": 54, "Hing Goli Digestive 100 g": 49}
    for i, r in df.iterrows():
        for k, m in discontinue.items():
            if k in r.Product_Name:
                disc_m[i] = m
    df["archetype"] = arch
    df["launch_m"] = launch_m
    df["disc_m"] = disc_m
    df["weak_launch"] = weak_launch

    # ---- popularity (base weight) ----
    pack_curve = np.where(df.n_packs.values == 1, 1.0,
                          np.select([df.pack_rank.values == 0, df.pack_rank.values == 1], [1.25, 1.0], 0.45))
    arch_pop = pd.Series(arch).map({"core": 1.6, "seasonal": 1.2, "premium": 0.55, "growing": 0.8, "declining": 1.3,
                                    "new": 0.9, "slow": 0.12}).values
    pop = pack_curve * arch_pop * rng.lognormal(0, 0.60, n)
    pop[weak_launch] *= 0.25
    df["pop"] = pop

    # ---- pricing ----
    retail_margin = np.where(df.tier.values == "premium", 0.22, 0.16)
    dist_margin = np.where(df.tier.values == "premium", 0.10, 0.08)
    cogs_ratio = np.where(df.tier.values == "premium", 0.42, 0.55) * rng.uniform(0.9, 1.1, n)
    mrp = np.zeros((n, 6)); ptr = np.zeros((n, 6)); ptd = np.zeros((n, 6)); cogs = np.zeros((n, 6))
    for p in range(6):
        mrp[:, p] = np.maximum(np.round(df.MRP0.values * PRICE_INDEX[p]), 1)
        ptr[:, p] = np.round(mrp[:, p] * (1 - retail_margin) / (1 + df.GST.values / 100), 2)
        ptd[:, p] = np.round(ptr[:, p] * (1 - dist_margin), 2)
        cogs[:, p] = np.round(ptd[:, p] / PRICE_INDEX[p] * COST_INDEX[p] * cogs_ratio, 2)
    base_units = np.clip(np.round(650 / ptr[:, 0]), 1, 72)
    case = np.select([base_units >= 36, base_units >= 12, base_units >= 4], [24, 12, 6], 3)
    ret_factor = np.where(df.Category.values == "Food & Beverages", 2.0, 1.0) * np.where(arch == "declining", 1.5, 1.0)
    return df, dict(mrp=mrp, ptr=ptr, ptd=ptd, cogs=cogs, base_units=base_units, case=case.astype(int), ret_factor=ret_factor)


def region_affinity(df, rng):
    n = len(df)
    aff = rng.lognormal(0, 0.22, (len(REGIONS), n))
    rules = [
        ("Coconut", {"South": 2.2, "East": 1.2, "North": 0.7}), ("Amla Hair", {"North": 1.5, "Central": 1.3}),
        ("Tea", {"East": 1.6, "North": 1.3, "South": 0.7}), ("Assam Dust", {"East": 2.0}),
        ("Chyawanprash", {"North": 1.7, "Central": 1.3, "South": 0.6}), ("Desi Ghee", {"North": 1.5, "West": 1.3}),
        ("Masala", {"South": 1.2}), ("Deo", {"South": 1.4, "West": 1.3}), ("Sunscreen", {"South": 1.5, "West": 1.3}),
        ("Repellent", {"East": 1.7, "South": 1.3}), ("Noodles", {"North": 1.2, "East": 1.25}),
        ("Namkeen", {"West": 1.6, "Central": 1.3, "North": 1.2}), ("Health Drink", {"South": 1.35, "East": 1.2}),
        ("Henna", {"North": 1.4, "Central": 1.4, "South": 0.6}), ("Body Lotion", {"North": 1.3}),
        ("Tooth Powder", {"East": 1.6, "Central": 1.4}),
    ]
    for kw, mult in rules:
        mask = df.Product_Name.str.contains(kw).values
        for reg, x in mult.items():
            aff[REGIONS.index(reg), mask] *= x
    return aff


def lifecycle_matrix(df, rng):
    """L[sku, month] demand multiplier from the SKU life-cycle archetype."""
    n = len(df)
    m = np.arange(N_MONTHS)
    yrs = m / 12.0
    g = pd.Series(df.archetype).map({"core": 0.02, "seasonal": 0.03, "premium": 0.10, "growing": 0.25,
                                     "declining": -0.22, "new": 0.15, "slow": -0.02}).values
    g = g + rng.normal(0, 0.03, n)
    L = np.exp(np.outer(g, yrs))
    for i in range(n):
        lm = df.launch_m.values[i]
        if lm > 0:
            age = m - lm
            ramp = np.where(age < 0, 0.0, 1 - np.exp(-(age + 1) / 4.0))
            L[i] = ramp * np.exp(g[i] * np.maximum(age, 0) / 12.0)
        dm = df.disc_m.values[i]
        if dm < N_MONTHS:
            L[i, dm:] = 0.0
            L[i, max(0, dm - 6):dm] *= np.linspace(0.8, 0.3, dm - max(0, dm - 6))  # run-down before delisting
    return L


# ==================================================================================
def build_network(rng, terrs, scale):
    """Distributors, salespersons, beats and outlets."""
    w = np.array([t["weight"] for t in terrs])
    extra = rng.multinomial(47, w / w.sum())
    dists = []
    used_names = set()
    for ti, t in enumerate(terrs):
        n = 1 + extra[ti]
        types = []
        types.append("Super Stockist" if (t["weight"] >= 2.5 and rng.random() < 0.45) else "Urban Distributor")
        if t["cities"][0] in METROS:
            types.append("Key Account Distributor")
        while len(types) < n:
            types.append(rng.choice(["Urban Distributor", "Rural Distributor"], p=[0.45, 0.55]))
        for k, dtype in enumerate(types):
            city = t["cities"][0] if k == 0 or dtype == "Key Account Distributor" else t["cities"][rng.integers(len(t["cities"]))]
            for _ in range(50):
                nm = f"{rng.choice(DIST_PREFIX)} {rng.choice(DIST_SUFFIX)}"
                if nm not in used_names:
                    break
            used_names.add(nm)
            if dtype == "Key Account Distributor":
                arch = rng.choice(["star", "steady", "overstocker"], p=[0.35, 0.5, 0.15])
            else:
                arch = rng.choice(DIST_ARCHETYPES, p=ARCH_P)
            new = rng.random() < 0.07
            join_m = int(rng.integers(3, 46)) if new else 0
            dists.append(dict(Distributor_Name=nm, Distributor_Type=dtype, Territory_ID=t["Territory_ID"],
                              Territory_Name=t["Territory_Name"], Region=t["Region"], State=t["State"], City=city,
                              archetype=arch, join_m=join_m, ti=ti))
    D = pd.DataFrame(dists)
    assert len(D) < 255, "distributor index must fit in uint8"
    D.insert(0, "Distributor_ID", [f"DST-{i + 1:04d}" for i in range(len(D))])
    size = pd.Series(D.Distributor_Type).map({"Super Stockist": 1.9, "Urban Distributor": 1.0, "Rural Distributor": 0.65,
                                              "Key Account Distributor": 1.3}).values
    D["size"] = size * rng.lognormal(0, 0.2, len(D))
    D["exec"] = pd.Series(D.archetype).map(ARCH_EXEC).values * rng.lognormal(0, 0.06, len(D))
    D["Distributor_Status"] = "Active"
    idx = D.index[D.archetype == "stockout_prone"].to_numpy()
    D.loc[rng.choice(idx, size=min(4, len(idx)), replace=False), "Distributor_Status"] = "Credit Hold"
    idx = D.index[D.archetype == "underperformer"].to_numpy()
    D.loc[rng.choice(idx, size=min(3, len(idx)), replace=False), "Distributor_Status"] = "Under Review"
    join_dates = []
    for jm in D.join_m:
        if jm == 0:
            join_dates.append(str(np.datetime64("2008-01-01") + np.timedelta64(int(rng.integers(0, 4700)), "D")))
        else:
            join_dates.append(str(MONTH_START[jm] + np.timedelta64(int(rng.integers(0, 20)), "D")))
    D["Join_Date"] = join_dates

    # ---- salespersons & beats ----
    sps, beats = [], []
    for di, d in D.iterrows():
        n_sp = {"Super Stockist": 5, "Urban Distributor": int(rng.integers(3, 5)), "Rural Distributor": int(rng.integers(2, 4)),
                "Key Account Distributor": 3}[d.Distributor_Type]
        for _ in range(n_sp):
            region = d.Region
            name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES[region])}"
            skill = float(np.clip(rng.lognormal(0, 0.18), 0.6, 1.5))
            if rng.random() < 0.07:
                skill = float(rng.uniform(0.55, 0.7))  # chronic low performers
            if d.join_m > 0:
                jd = MONTH_START[d.join_m] + np.timedelta64(int(rng.integers(-20, 5)), "D")
            else:
                jd = np.datetime64("2012-01-01") + np.timedelta64(int(rng.integers(0, 3200)), "D")
            status = "Active" if rng.random() > 0.04 else "On Notice"
            spi = len(sps)
            sps.append(dict(Salesperson_ID=f"SP-{spi + 1:04d}", Salesperson_Name=name, Region=region, State=d.State,
                            Territory_ID=d.Territory_ID, Distributor_ID=d.Distributor_ID, di=di,
                            Joining_Date=str(jd), Status=status, skill=skill))
            t = terrs[d.ti]
            n_beats = 3 if rng.random() < 0.5 else 2
            wds = rng.choice(6, size=n_beats, replace=False)
            for b in range(n_beats):
                city = t["cities"][rng.integers(len(t["cities"]))] if d.Distributor_Type == "Rural Distributor" else d.City
                beats.append(dict(Beat_ID=f"BT-{len(beats) + 1:04d}", Beat_Name=f"{city} - {rng.choice(LOCALITIES)}",
                                  Salesperson_ID=sps[-1]["Salesperson_ID"], Distributor_ID=d.Distributor_ID, spi=spi,
                                  di=di, City=city, Visit_Day=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wds[b]],
                                  wd=int(wds[b])))
    S = pd.DataFrame(sps)
    B = pd.DataFrame(beats)

    # ---- outlets ----
    outs = []
    for bi, b in B.iterrows():
        d = D.loc[b.di]
        n_o = int(rng.poisson(5.5 * scale)) + 2
        mix = np.array(OT_MIX[d.Distributor_Type])
        types = rng.choice(len(OUTLET_TYPES), size=n_o, p=mix / mix.sum())
        for ot in types:
            otn = OUTLET_TYPES[ot]
            if d.join_m > 0:
                open_m = int(d.join_m + rng.integers(0, 10))
            else:
                open_m = 0 if rng.random() < 0.88 else int(rng.integers(1, N_MONTHS))
            close_m = N_MONTHS
            if rng.random() < 0.07 and open_m < N_MONTHS - 8:
                close_m = int(rng.integers(open_m + 6, N_MONTHS))
            outs.append(dict(Outlet_Name=f"{rng.choice(OUTLET_PREFIX)} {rng.choice(OUTLET_SUFFIX[otn])}", ot=int(ot),
                             Outlet_Type=otn, Channel=CHANNEL[otn], Region=d.Region, State=d.State, City=b.City,
                             Territory_ID=d.Territory_ID, Distributor_ID=d.Distributor_ID, Beat_ID=b.Beat_ID,
                             bi=bi, di=b.di, spi=b.spi, open_m=open_m, close_m=close_m))
    O = pd.DataFrame(outs)
    assert len(O) < 65535
    O.insert(0, "Outlet_ID", [f"OUT-{i + 1:05d}" for i in range(len(O))])
    O["Outlet_Status"] = np.where(O.close_m < N_MONTHS, "Closed", "Active")
    od = []
    for om in O.open_m:
        if om == 0:
            od.append(str(np.datetime64("2005-01-01") + np.timedelta64(int(rng.integers(0, 5800)), "D")))
        else:
            od.append(str(MONTH_START[om] + np.timedelta64(int(rng.integers(0, 25)), "D")))
    O["Opening_Date"] = od
    O["Closed_Date"] = [str(MONTH_START[c] - ONE_DAY) if c < N_MONTHS else "" for c in O.close_m]
    return D, S, B, O


# ==================================================================================
def visit_calendar():
    """first visit day-index and number of visits for (month, weekday Mon=0..Sat=5)."""
    first = np.zeros((N_MONTHS + 1, 6), dtype=np.int64)
    cnt = np.zeros((N_MONTHS + 1, 6), dtype=np.int64)
    for m in range(N_MONTHS):
        s, e = MONTH_START_DAY[m], MONTH_START_DAY[m + 1]
        wd0 = (s + 4) % 7  # 2021-01-01 was a Friday (Mon=0)
        for wd in range(6):
            f = s + (wd - wd0) % 7
            first[m, wd] = f
            cnt[m, wd] = (e - 1 - f) // 7 + 1
    return first, cnt


def generate_demand(rng, D, S, B, O, P, px, reg_aff, L, target_lines):
    """Outlet-level order lines (unconstrained demand, before stock availability)."""
    n_o = len(O)
    m = np.arange(N_MONTHS)
    yrs = m / 12.0
    region_idx = pd.Series(O.Region).map({r: i for i, r in enumerate(REGIONS)}).values
    d_region = pd.Series(D.Region).map({r: i for i, r in enumerate(REGIONS)}).values
    state_noise = {s: rng.normal(0, 0.025) for s in O.State.unique()}
    growth = (pd.Series(O.Region).map(REGION_TREND).values
              + pd.Series(O.State).map(state_noise).values
              + pd.Series(D.archetype.values[O.di.values]).map(ARCH_TREND).values
              + rng.normal(0, 0.06, n_o))
    ot = O.ot.values
    growth = growth + np.where(ot == OT["E-commerce"], 0.30, 0.0) + np.where(ot == OT["Modern Trade"], 0.05, 0.0)
    trend = np.exp(np.outer(growth, yrs))
    # Punjab: competitor entry from Jul-2024 -> outlet frequency drops
    pb = (O.State.values == "Punjab")
    trend[pb, 42:] *= 0.82
    # "Rising" outlets: purchase frequency accelerates through 2025 (opportunity signal)
    rising = rng.random(n_o) < 0.06
    boost = np.ones(N_MONTHS)
    boost[48:] = 1 + 0.09 * np.arange(1, 13)
    trend[rising] *= boost
    active = (m[None, :] >= O.open_m.values[:, None]) & (m[None, :] < O.close_m.values[:, None])
    # COVID second wave (Apr-Jun 2021): lockdowns hit GT/MT footfall, e-commerce jumps
    covid = np.ones((len(OUTLET_TYPES), N_MONTHS))
    covid[:, 3:6] = np.array([0.80, 0.68, 0.88])
    covid[OT["Pharmacy"], 3:6] = np.array([1.05, 1.00, 1.00])
    covid[OT["E-commerce"], 3:6] = np.array([1.35, 1.50, 1.20])
    o_freq = rng.lognormal(0, 0.30, n_o)
    o_size = rng.lognormal(0, 0.30, n_o)
    lam = (OT_ORDER_FREQ[ot][:, None] * o_freq[:, None] * S.skill.values[O.spi.values][:, None]
           * D["exec"].values[O.di.values][:, None] * OVERALL_SEASON[m % 12][None, :] * covid[ot] * trend * active)
    exp_lines = (lam * (1 + OT_EXTRA_LINES[ot])[:, None]).sum()
    K = target_lines / exp_lines * 1.04  # small uplift for SKU de-duplication inside an order
    lam *= K
    first, cnt = visit_calendar()
    n_ord = rng.poisson(lam)
    wd = B.wd.values[O.bi.values]
    nvis = cnt[:N_MONTHS][:, wd].T  # (outlet, month)
    n_ord = np.minimum(n_ord, nvis)
    oi, mi = np.nonzero(n_ord)
    c = n_ord[oi, mi]
    ord_outlet = np.repeat(oi, c)
    ord_month = np.repeat(mi, c)
    j = np.arange(c.sum()) - np.repeat(np.cumsum(c) - c, c)
    r0 = np.repeat(rng.integers(0, 5, len(oi)), c)
    owd = wd[ord_outlet]
    week = (r0 + j) % cnt[ord_month, owd]
    ord_day = first[ord_month, owd] + 7 * week
    n_orders = len(ord_outlet)
    log(f"  orders generated: {n_orders:,}  (lambda scale {K:.3f})")

    # lines
    otype = ot[ord_outlet]
    nl = np.minimum(1 + rng.poisson(OT_EXTRA_LINES[otype]), 12)
    li_order = np.repeat(np.arange(n_orders), nl)
    li_outlet = ord_outlet[li_order]
    li_month = ord_month[li_order]
    li_type = otype[li_order]
    li_dist = O.di.values[li_outlet]

    # SKU choice grouped by (distributor, month, outlet type)
    n_sku = len(P)
    cat_idx = pd.Series(P.Category).map({c: i for i, c in enumerate(CATEGORIES)}).values
    type_aff = np.ones((len(OUTLET_TYPES), n_sku))
    for otn, affs in CAT_AFFINITY.items():
        for cat, x in affs.items():
            type_aff[OT[otn], cat_idx == CATEGORIES.index(cat)] *= x
    premium = (P.tier.values == "premium")
    for otn, x in [("General Trade", 0.6), ("Wholesale", 0.45), ("Supermarket", 1.5), ("Modern Trade", 1.8), ("E-commerce", 2.2), ("Pharmacy", 1.2)]:
        type_aff[OT[otn], premium] *= x
    seas = np.array([SEASON[s] for s in P.season.values])
    seas = seas / seas.mean(axis=1, keepdims=True)
    # time x category shocks: COVID immunity boom, North hair-care competitor (Jul-2024+)
    shock = np.ones((len(REGIONS), n_sku, N_MONTHS))
    hw = cat_idx == CATEGORIES.index("Health & Wellness")
    shock[:, hw, 3:7] *= np.array([1.6, 1.9, 1.5, 1.2])
    hand = P.Sub_Category.values == "Hand Wash"
    shock[:, hand, 3:7] *= np.array([1.4, 1.6, 1.3, 1.1])
    hair = (P.Category.values == "Hair Care")
    shock[REGIONS.index("North")][np.ix_(hair, np.arange(42, N_MONTHS))] *= 0.72
    TT = L[None, :, :] * seas[None, :, m % 12] * shock  # (region, sku, month)

    # distributor assortments
    assort, combo_of = [], np.full((len(D), n_sku), -1, dtype=np.int64)
    base_w = []
    C = 0
    for di, d in D.iterrows():
        size = {"Super Stockist": (60, 85), "Urban Distributor": (35, 55), "Rural Distributor": (22, 35),
                "Key Account Distributor": (40, 60)}[d.Distributor_Type]
        k = int(rng.integers(*size))
        w = P["pop"].values * reg_aff[d_region[di]]
        if d.Distributor_Type == "Rural Distributor":
            w = w * np.where(premium, 0.3, 1.2)
        if d.Distributor_Type == "Key Account Distributor":
            w = w * np.where(premium, 2.0, 1.0)
        w = w + 1e-6
        chosen = rng.choice(n_sku, size=min(k, n_sku), replace=False, p=w / w.sum())
        # company pushes every new launch into urban networks
        newl = np.nonzero((P.archetype.values == "new") & (P.pack_rank.values == 0) & (d.Distributor_Type != "Rural Distributor"))[0]
        newl = newl[rng.random(len(newl)) < 0.6]
        chosen = np.unique(np.concatenate([chosen, newl]))
        assort.append(chosen)
        combo_of[di, chosen] = np.arange(C, C + len(chosen))
        base_w.append(P["pop"].values[chosen] * reg_aff[d_region[di], chosen] * rng.lognormal(0, 0.25, len(chosen)))
        C += len(chosen)
    log(f"  distributor x SKU combinations: {C:,}")

    order = np.lexsort((li_type, li_month, li_dist))
    li_order, li_outlet, li_month, li_type, li_dist = (a[order] for a in (li_order, li_outlet, li_month, li_type, li_dist))
    g = (li_dist * N_MONTHS + li_month) * len(OUTLET_TYPES) + li_type
    bounds = np.nonzero(np.diff(g))[0] + 1
    starts = np.concatenate([[0], bounds])
    ends = np.concatenate([bounds, [len(g)]])
    li_sku = np.empty(len(g), dtype=np.int64)
    u = rng.random(len(g))
    cache_key, cache_w = None, None
    for s, e in zip(starts, ends):
        di, mo, ty = li_dist[s], li_month[s], li_type[s]
        if cache_key != (di, mo):
            A = assort[di]
            cache_w = base_w[di] * TT[d_region[di], A, mo]
            cache_key = (di, mo)
        w = cache_w * type_aff[ty, assort[di]]
        cw = np.cumsum(w)
        if cw[-1] <= 0:
            cw = np.cumsum(np.ones_like(w))
        li_sku[s:e] = assort[di][np.searchsorted(cw, u[s:e] * cw[-1], side="right").clip(0, len(w) - 1)]

    # quantity per line
    qty = np.maximum(1, np.round(px["base_units"][li_sku] * OT_QTY_MULT[li_type] * o_size[li_outlet]
                                 * rng.lognormal(-0.05, 0.30, len(li_sku)))).astype(np.int64)
    # merge duplicate SKU lines within an order
    key = li_order * n_sku + li_sku
    uk, inv = np.unique(key, return_inverse=True)
    qty_m = np.bincount(inv, weights=qty).astype(np.int64)
    first_pos = np.zeros(len(uk), dtype=np.int64)
    first_pos[inv[::-1]] = np.arange(len(inv))[::-1]
    li_order = li_order[first_pos]; li_outlet = li_outlet[first_pos]; li_month = li_month[first_pos]
    li_type = li_type[first_pos]; li_dist = li_dist[first_pos]; li_sku = li_sku[first_pos]; qty = qty_m

    # trade discount (quantised to 0.25%)
    arch = P.archetype.values[li_sku]
    disc = rng.normal(OT_DISC_MEAN[li_type], OT_DISC_SD[li_type])
    disc -= np.where(P.tier.values[li_sku] == "premium", 1.5, 0.0)
    disc += np.where(np.isin(li_month % 12, [9, 10]) & np.isin(P.season.values[li_sku], ["flat", "festive"]), 2.0, 0.0)
    disc += np.where((arch == "new") & (li_month - P.launch_m.values[li_sku] < 6), 3.0, 0.0)
    disc += np.where(arch == "declining", 2.5, 0.0)
    disc_u = np.clip(np.round(disc * 4), 0, 160).astype(np.int64)

    lines = dict(order=li_order, outlet=li_outlet, month=li_month, day=ord_day[li_order], dist=li_dist,
                 sku=li_sku, otype=li_type, qty=qty, disc_u=disc_u, combo=combo_of[li_dist, li_sku])
    assert (lines["combo"] >= 0).all()
    srt = np.argsort(lines["month"], kind="stable")
    lines = {k: v[srt] for k, v in lines.items()}
    combos_dist = np.concatenate([np.full(len(a), i) for i, a in enumerate(assort)])
    combos_sku = np.concatenate(assort)
    return lines, combos_dist, combos_sku, rising, seas


# ==================================================================================
def simulate_stock(rng, D, P, px, lines, combos_dist, combos_sku, seas):
    """Monthly distributor x SKU stock roll-forward with (s,S) ordering, stock-outs and FIFO ageing."""
    C = len(combos_dist)
    arch = D.archetype.values[combos_dist]
    smart = np.isin(arch, ["star", "steady"]) | (D.Distributor_Type.values[combos_dist] == "Key Account Distributor")
    cov_mu = np.array([ARCH_COVER[a][0] for a in arch], dtype=float)
    cov_sd = np.array([ARCH_COVER[a][1] for a in arch], dtype=float)
    cover = np.clip(rng.normal(cov_mu, cov_sd), 7, 160)
    sku_arch = P.archetype.values[combos_sku]
    cover = np.where(sku_arch == "slow", cover * 1.6, cover)
    case = px["case"][combos_sku]
    start_m = np.maximum(D.join_m.values[combos_dist], P.launch_m.values[combos_sku])
    disc_m = P.disc_m.values[combos_sku]
    is_new_launch = P.launch_m.values[combos_sku] > 0
    ret_f = px["ret_factor"]

    shape = (C, N_MONTHS)
    opening = np.zeros(shape); prim = np.zeros(shape); sold = np.zeros(shape); ret_in = np.zeros(shape)
    adj = np.zeros(shape); closing = np.zeros(shape); demand = np.zeros(shape)
    ages = np.zeros((4,) + shape)
    no_sale = np.zeros(C)

    ptr = np.searchsorted(lines["month"], np.arange(N_MONTHS + 1))
    kept = np.zeros(len(lines["qty"]), dtype=np.int64)
    ret_rows = []
    first, cnt = visit_calendar()
    for m in range(N_MONTHS):
        s, e = ptr[m], ptr[m + 1]
        lc = lines["combo"][s:e]
        lq = lines["qty"][s:e]
        dem = np.bincount(lc, weights=lq, minlength=C)
        demand[:, m] = dem
        live = m >= start_m
        op = closing[:, m - 1] if m > 0 else np.where(start_m == 0, np.ceil(dem * cover / 30 * rng.uniform(0.8, 1.2, C)), 0)
        op = np.where(live, op, 0)
        opening[:, m] = op
        rin = ret_in[:, m]
        # ---- forecast ----
        # Distributors see booked orders (demand); weaker ones react late and
        # under-weight lost sales, which keeps stock-outs recurring for them.
        if m >= 3:
            fc = 0.2 * demand[:, m - 3] + 0.3 * demand[:, m - 2] + 0.5 * demand[:, m - 1]
            fc = np.where(smart, fc, 0.5 * fc + 0.5 * (0.4 * sold[:, m - 2] + 0.6 * sold[:, m - 1]))
        elif m >= 1:
            fc = demand[:, m - 1].copy()
        else:
            fc = dem.copy()
        s_ratio = seas[combos_sku, m % 12] / seas[combos_sku, (m - 1) % 12]
        fc = np.where(smart, fc * s_ratio, fc)
        just_started = (m == start_m) & (m > 0)
        fc = np.where(just_started, np.maximum(fc, dem), fc)
        # ---- (s,S) replenishment ----
        pos = op + rin
        fc = fc * rng.lognormal(0, 0.10, C)  # forecast error
        sigma = demand[:, max(0, m - 6):m].std(axis=1) if m >= 2 else 0.5 * fc
        safety = np.where(smart, 0.3, np.where(arch == "stockout_prone", 0.05, 0.2)) * sigma
        reorder = fc * (0.6 + 0.5 * cover / 30) + 0.5 * safety
        upto = fc * (1 + cover / 30) + safety
        need = np.where(pos < reorder, np.maximum(0, upto - pos), 0.0)
        so = arch == "stockout_prone"
        need = np.where(so, need * 0.85 * (rng.random(C) > 0.22), need)  # credit-blocked orders
        if m % 3 == 2:  # quarter-end loading (heavier at FY close in March)
            fy_end = 1.5 if m % 12 == 2 else 1.0
            load = np.where(arch == "overstocker", fc * rng.uniform(0.2, 0.6, C),
                            np.where((arch == "steady") & (rng.random(C) < 0.5), fc * rng.uniform(0, 0.2, C), 0))
            need = need + load * fy_end
        # pipeline fill for new launches (company push)
        need = np.where(just_started & is_new_launch, need + case * rng.integers(2, 6, C), need)
        need = np.where(live & (m < disc_m), need, 0)
        # low-volume lines can be bought in inner packs; fast lines in full cases
        eff_case = np.where(fc >= 2 * case, case, np.maximum(1, case // 4))
        order = np.ceil(need / eff_case) * eff_case
        avail = op + rin + order
        # mid-month top-up orders: good distributors chase shortfalls, credit-constrained ones cannot
        short = np.maximum(0, dem - avail)
        topup_rate = np.where(smart, 0.92, np.where(so, 0.10, 0.65)) * (live & (m < disc_m))
        topup = np.ceil(short * topup_rate / eff_case) * eff_case
        order = order + topup
        avail = avail + topup
        prim[:, m] = order
        # ---- secondary sales capped by stock ----
        ratio = np.where(dem > avail, avail / np.maximum(dem, 1e-9), 1.0)
        k = np.floor(lq * ratio[lc]).astype(np.int64)
        kept[s:e] = k
        sl = np.bincount(lc, weights=k, minlength=C)
        sold[:, m] = sl
        # ---- adjustments: damaged returns written off, shrinkage, expiry of dead stock, audit variance ----
        no_sale = np.where((sl == 0) & (op > 0), no_sale + 1, 0)
        a = -np.round(0.5 * rin) - np.floor(op * rng.uniform(0, 0.004, C))
        a -= np.where(no_sale >= 4, np.floor(op * 0.10), 0)
        audit = rng.random(C) < 0.02
        a += np.where(audit, np.round(op * rng.uniform(-0.03, 0.02, C)), 0)
        a = np.maximum(a, -(avail - sl))
        adj[:, m] = a
        cl = avail - sl + a
        closing[:, m] = cl
        # ---- FIFO ageing of closing stock ----
        rem = cl.copy()
        for b in range(3):
            mm = m - b
            rec = (prim[:, mm] + ret_in[:, mm]) if mm >= 0 else np.zeros(C)
            take = np.minimum(rem, rec)
            ages[b, :, m] = take
            rem -= take
        ages[3, :, m] = rem
        # ---- returns from this month's sales arrive next month ----
        if m + 1 < N_MONTHS:
            sku_l = lines["sku"][s:e]
            p_ret = 0.03 * ret_f[sku_l] * OT_RETURN[lines["otype"][s:e]]
            rmask = (rng.random(e - s) < p_ret) & (k > 0)
            idx = np.nonzero(rmask)[0]
            rq = np.maximum(1, np.round(k[idx] * rng.uniform(0.1, 0.5, len(idx)))).astype(np.int64)
            ret_in[:, m + 1] += np.bincount(lc[idx], weights=rq, minlength=C)
            ret_rows.append((idx + s, rq, m + 1))
    live_rows = np.arange(N_MONTHS)[None, :] >= start_m[:, None]
    stock = dict(opening=opening, prim=prim, sold=sold, ret_in=ret_in, adj=adj, closing=closing, ages=ages,
                 demand=demand, live=live_rows)
    return stock, kept, ret_rows


# ==================================================================================
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--scale", type=float, default=1.0, help="scales outlet universe and transaction volume")
    ap.add_argument("--no-compress", action="store_true", help="write large fact tables as plain .csv")
    ap.add_argument("--skip-build", action="store_true", help="do not run build_dataset.py afterwards")
    args = ap.parse_args()
    t0 = time.time()
    rng = np.random.default_rng(args.seed)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    ext = ".csv" if args.no_compress else ".csv.gz"
    for old in RAW_DIR.glob("*.csv*"):
        old.unlink()

    log("Building geography, product and network masters ...")
    geo_df, terrs = build_geography()
    P, px = build_products(rng)
    reg_aff = region_affinity(P, rng)
    L = lifecycle_matrix(P, rng)
    D, S, B, O = build_network(rng, terrs, args.scale)
    log(f"  {len(REGIONS)} regions | {geo_df.State.nunique()} states | {len(terrs)} territories | "
        f"{geo_df.City.nunique()} cities | {len(D)} distributors | {len(S)} salespersons | {len(B)} beats | "
        f"{len(O)} outlets | {len(P)} SKUs")

    log("Generating outlet demand ...")
    lines, combos_dist, combos_sku, rising, seas = generate_demand(
        rng, D, S, B, O, P, px, reg_aff, L, target_lines=int(900_000 * args.scale))

    log("Simulating distributor stock, replenishment and stock-outs ...")
    st, kept, ret_rows = simulate_stock(rng, D, P, px, lines, combos_dist, combos_sku, seas)
    C = len(combos_dist)

    # ------------------------------------------------------------------ secondary lines
    keep = kept > 0
    lost = (lines["qty"] - kept).sum() / lines["qty"].sum()
    log(f"  secondary lines kept: {keep.sum():,} | demand lost to stock-outs: {lost:.1%}")
    sec = {k: v[keep] for k, v in lines.items()}
    sec["qty"] = kept[keep]
    sec["stype"] = np.ones(keep.sum(), dtype=np.int64)
    # ------------------------------------------------------------------ return lines
    first, cnt = visit_calendar()
    r_idx = np.concatenate([r[0] for r in ret_rows])
    r_qty = np.concatenate([r[1] for r in ret_rows])
    r_month = np.concatenate([np.full(len(r[0]), r[2]) for r in ret_rows])
    wd = B.wd.values[O.bi.values[lines["outlet"][r_idx]]]
    r_day = first[r_month, wd] + 7 * rng.integers(0, cnt[r_month, wd])
    ret = {k: v[r_idx] for k, v in lines.items()}
    ret.update(qty=-r_qty, month=r_month, day=r_day, stype=np.full(len(r_idx), 2))
    log(f"  return lines: {len(r_idx):,}")
    # ------------------------------------------------------------------ primary lines
    pm = st["prim"]
    ci, mi = np.nonzero(pm > 0)
    q = pm[ci, mi].astype(np.int64)
    case = px["case"][combos_sku[ci]]
    split = (q >= 2 * case) & (rng.random(len(q)) < 0.45)
    q1 = np.where(split, np.minimum(np.ceil(q * 0.6 / case) * case, q - case), q).astype(np.int64)
    q2 = q - q1
    d_of = combos_dist[ci]
    cyc_a = 2 + (np.arange(len(D)) * 7) % 4  # distributor-specific ordering days
    cyc_b = 15 + (np.arange(len(D)) * 5) % 5

    def workday(m_arr, dom):
        d = MONTH_START_DAY[m_arr] + dom - 1
        return d + ((d + 4) % 7 == 6)  # push Sundays to Monday

    one_cycle = np.isin(D.archetype.values[d_of], ["stockout_prone"])
    pick_b = (~split) & (rng.random(len(q)) < 0.45) & ~one_cycle
    day1 = np.where(pick_b, workday(mi, cyc_b[d_of]), workday(mi, cyc_a[d_of]))
    day2 = workday(mi, cyc_b[d_of])
    pri = dict(month=np.concatenate([mi, mi[split]]), day=np.concatenate([day1, day2[split]]),
               dist=np.concatenate([d_of, d_of[split]]), sku=np.concatenate([combos_sku[ci], combos_sku[ci][split]]),
               qty=np.concatenate([q1, q2[split]]))
    n_pri = len(pri["qty"])
    ddtype = D.Distributor_Type.values[pri["dist"]]
    pdisc = np.where(ddtype == "Super Stockist", 3.0, 1.5) + rng.normal(0, 0.5, n_pri)
    pdisc += np.where(pri["month"] % 3 == 2, 2.0, 0.0)  # quarter-end scheme
    pri["disc_u"] = np.clip(np.round(pdisc * 4), 0, 60).astype(np.int64)
    pri.update(outlet=np.full(n_pri, -1), otype=np.full(n_pri, -1), stype=np.zeros(n_pri, dtype=np.int64))
    log(f"  primary lines: {n_pri:,}")

    # ------------------------------------------------------------------ assemble fact table
    cols = ["day", "month", "stype", "dist", "outlet", "sku", "qty", "disc_u", "otype"]
    F = {c: np.concatenate([pri[c], sec[c], ret[c]]).astype(np.int64) for c in cols}
    o_key = np.where(F["stype"] == 0, F["dist"], F["outlet"])
    srt = np.lexsort((F["sku"], o_key, F["dist"], F["stype"], F["day"]))
    F = {k: v[srt] for k, v in F.items()}
    # one line per invoice x SKU (e.g. two returns of the same SKU on the same visit are merged)
    o_key = np.where(F["stype"] == 0, F["dist"], F["outlet"])
    same = np.concatenate([[False], (F["day"][1:] == F["day"][:-1]) & (F["stype"][1:] == F["stype"][:-1])
                           & (o_key[1:] == o_key[:-1]) & (F["sku"][1:] == F["sku"][:-1])])
    grp = np.cumsum(~same) - 1
    qsum = np.bincount(grp, weights=F["qty"]).astype(np.int64)
    F = {k: v[~same] for k, v in F.items()}
    F["qty"] = qsum
    n = len(F["day"])
    pp = price_period(F["month"])
    sku = F["sku"]
    unit_price = np.where(F["stype"] == 0, px["ptd"][sku, pp], px["ptr"][sku, pp])
    gross = np.round(F["qty"] * unit_price, 2)
    discount = np.round(gross * F["disc_u"] / 400.0, 2)
    net = np.round(gross - discount, 2)
    cost = np.round(F["qty"] * px["cogs"][sku, pp], 2)
    gst = P.GST.values[sku]
    tax = np.round(net * gst / 100.0, 2)
    log(f"  total fact rows: {n:,}")

    # invoices
    inv_key = (F["day"] * 3 + F["stype"]) * 70000 + np.where(F["stype"] == 0, F["dist"], F["outlet"])
    ch = np.concatenate([[True], inv_key[1:] != inv_key[:-1]])
    inv_id = np.cumsum(ch) - 1
    inv_first = np.nonzero(ch)[0]
    inv_stype = F["stype"][inv_first]
    inv_fy = fy_label(F["month"][inv_first])
    prefix = np.array(["PI", "SI", "CN"])[inv_stype]
    seq = np.zeros(len(inv_first), dtype=np.int64)
    grp = pd.Series(np.char.add(prefix, inv_fy))
    seq = grp.groupby(grp).cumcount().values + 1
    inv_no = [f"{a}/{b}/{c:07d}" for a, b, c in zip(prefix, inv_fy, seq)]
    inv_no = np.array(inv_no, dtype=object)
    # payment mode per invoice
    inv_ot = F["otype"][inv_first]
    r = rng.random(len(inv_first))
    pay = np.where(inv_stype == 0, "Credit (NEFT/RTGS)",
          np.where(inv_stype == 2, "Credit Note",
          np.where(np.isin(inv_ot, [OT["General Trade"], OT["Pharmacy"]]),
                   np.where(r < 0.5, "Cash", np.where(r < 0.82, "UPI", "Credit")),
          np.where(inv_ot == OT["Wholesale"], np.where(r < 0.35, "Cash", np.where(r < 0.55, "UPI", "Credit")), "Credit"))))

    dates = (START_DATE + F["day"].astype("timedelta64[D]")).astype(str)
    D_ids = D.Distributor_ID.values
    O_ids = O.Outlet_ID.values
    oi = np.where(F["outlet"] >= 0, F["outlet"], 0)
    is_p = F["stype"] == 0
    tx = pd.DataFrame({
        "Transaction_ID": [f"TXN{i + 1:08d}" for i in range(n)],
        "Transaction_Date": dates,
        "Invoice_No": inv_no[inv_id],
        "Region": D.Region.values[F["dist"]],
        "State": D.State.values[F["dist"]],
        "City": np.where(is_p, D.City.values[F["dist"]], O.City.values[oi]),
        "Territory": D.Territory_ID.values[F["dist"]],
        "Distributor_ID": D_ids[F["dist"]],
        "Salesperson_ID": np.where(is_p, "", S.Salesperson_ID.values[O.spi.values[oi]]),
        "Beat_ID": np.where(is_p, "", O.Beat_ID.values[oi]),
        "Outlet_ID": np.where(is_p, "", O_ids[oi]),
        "SKU_ID": P.SKU_ID.values[sku],
        "Quantity": F["qty"],
        "MRP": px["mrp"][sku, pp],
        "Unit_Price": unit_price,
        "Gross_Sales": gross,
        "Discount": discount,
        "Net_Sales": net,
        "Cost": cost,
        "Gross_Margin": np.round(net - cost, 2),
        "Tax": tax,
        "Invoice_Value": np.round(net + tax, 2),
        "Sales_Type": np.array(["Primary", "Secondary", "Sales Return"])[F["stype"]],
        "Payment_Type": pay[inv_id],
    })

    # ------------------------------------------------------------------ targets
    log("Building targets ...")
    n_sp = len(S)
    cat_of = pd.Series(P.Category).map({c: i for i, c in enumerate(CATEGORIES)}).values
    sec_mask = F["stype"] > 0
    sp_of_row = O.spi.values[F["outlet"][sec_mask]]
    key = (sp_of_row * N_MONTHS + F["month"][sec_mask]) * 8 + cat_of[F["sku"][sec_mask]]
    actual = np.bincount(key, weights=net[sec_mask], minlength=n_sp * N_MONTHS * 8).reshape(n_sp, N_MONTHS, 8)
    plan_growth = pd.Series(S.Region).map({"North": 0.11, "West": 0.12, "Central": 0.10, "South": 0.13, "East": 0.14}).values
    plan_growth = plan_growth + rng.normal(0.01, 0.035, n_sp)
    plan_growth += np.where(D.archetype.values[S.di.values] == "star", 0.03, 0.0)
    tgt = np.zeros_like(actual)
    for mth in range(N_MONTHS):
        if mth < 12:
            base = actual[:, mth, :] * rng.uniform(0.98, 1.12, (n_sp, 8))
        else:
            ly = actual[:, mth - 12, :]
            ly3 = actual[:, max(0, mth - 14):mth - 9, :].mean(axis=1)  # smooth LY with neighbouring months
            base = (0.6 * ly + 0.4 * ly3) * (1 + plan_growth)[:, None] * rng.lognormal(0, 0.05, (n_sp, 8))
            # new salesperson/category with no LY: plan on current run-rate
            base = np.where(ly <= 0, actual[:, mth, :] * 1.08, base)
        tgt[:, mth, :] = np.round(np.maximum(base, 0) / 500) * 500
    ti = np.argwhere(tgt > 0)
    avg_cat_price = np.array([px["ptr"][cat_of == c, -1].mean() for c in range(8)])
    targets = pd.DataFrame({
        "Month": [f"{2021 + mm // 12}-{mm % 12 + 1:02d}" for mm in ti[:, 1]],
        "Region": S.Region.values[ti[:, 0]], "State": S.State.values[ti[:, 0]],
        "Territory": S.Territory_ID.values[ti[:, 0]], "Distributor_ID": S.Distributor_ID.values[ti[:, 0]],
        "Salesperson_ID": S.Salesperson_ID.values[ti[:, 0]], "Category": np.array(CATEGORIES)[ti[:, 2]],
        "SKU_ID": "ALL",
        "Target_Amount": tgt[ti[:, 0], ti[:, 1], ti[:, 2]],
        "Target_Quantity": np.round(tgt[ti[:, 0], ti[:, 1], ti[:, 2]] / avg_cat_price[ti[:, 2]]).astype(int),
    })
    # SKU plan mix (share of category, national, from LY actuals; launches get a planned share)
    sku_m = np.bincount(F["month"][sec_mask] * len(P) + F["sku"][sec_mask], weights=net[sec_mask],
                        minlength=N_MONTHS * len(P)).reshape(N_MONTHS, len(P))
    mix = np.zeros_like(sku_m)
    for mth in range(N_MONTHS):
        base = sku_m[mth - 12] if mth >= 12 else sku_m[mth]
        base = np.where((base <= 0) & (sku_m[mth] > 0), sku_m[mth], base)
        base = base * (P.disc_m.values > mth)
        for c in range(8):
            sel = cat_of == c
            tot = base[sel].sum()
            mix[mth, sel] = base[sel] / tot if tot > 0 else 0
    mi_, si_ = np.nonzero(mix > 0)
    sku_mix = pd.DataFrame({"Month": [f"{2021 + mm // 12}-{mm % 12 + 1:02d}" for mm in mi_],
                            "SKU_ID": P.SKU_ID.values[si_], "Category": P.Category.values[si_],
                            "Mix_Share": np.round(mix[mi_, si_], 6)})

    # ------------------------------------------------------------------ stock snapshots
    log("Building stock snapshots ...")
    live = st["live"] & ~((st["opening"] == 0) & (st["closing"] == 0) & (np.arange(N_MONTHS)[None, :] >= P.disc_m.values[combos_sku][:, None]))
    cc, mm = np.nonzero(live)
    sold3 = np.zeros_like(st["sold"])
    for mth in range(N_MONTHS):
        sold3[:, mth] = st["sold"][:, max(0, mth - 2):mth + 1].mean(axis=1)
    cl = st["closing"][cc, mm]
    s3m = sold3[cc, mm]
    dos = np.where(s3m > 0, np.round(np.divide(cl * 30.0, s3m, out=np.zeros_like(cl), where=s3m > 0), 1), np.where(cl > 0, 999, 0))
    s3 = st["sold"]
    csum = np.cumsum(np.pad(s3, ((0, 0), (1, 0))), axis=1)
    last3 = csum[cc, mm + 1] - csum[cc, np.maximum(0, mm - 2)]
    status = np.select(
        [cl <= 0, (last3 == 0) & (cl > 0), dos > 90, dos > 45, dos < 7],
        ["Stock-out", "Non-moving", "Slow-moving", "Overstock", "Low Stock"], "Healthy")
    stock = pd.DataFrame({
        "Snapshot_Date": (MONTH_START[mm + 1] - ONE_DAY).astype(str),
        "Distributor_ID": D_ids[combos_dist[cc]],
        "SKU_ID": P.SKU_ID.values[combos_sku[cc]],
        "Opening_Stock": st["opening"][cc, mm].astype(np.int64),
        "Primary_Received": st["prim"][cc, mm].astype(np.int64),
        "Secondary_Sales": st["sold"][cc, mm].astype(np.int64),
        "Sales_Return": st["ret_in"][cc, mm].astype(np.int64),
        "Adjustment": st["adj"][cc, mm].astype(np.int64),
        "Closing_Stock": cl.astype(np.int64),
        "Stock_Value": np.round(cl * px["ptd"][combos_sku[cc], price_period(mm)], 2),
        "Days_of_Stock": dos,
        "Stock_Status": status,
        "Age_0_30": st["ages"][0][cc, mm].astype(np.int64),
        "Age_31_60": st["ages"][1][cc, mm].astype(np.int64),
        "Age_61_90": st["ages"][2][cc, mm].astype(np.int64),
        "Age_90_Plus": st["ages"][3][cc, mm].astype(np.int64),
    })
    log(f"  stock rows: {len(stock):,}")

    # ------------------------------------------------------------------ collections
    log("Simulating collections ...")
    pmask = F["stype"] == 0
    p_inv = inv_id[pmask]
    inv_amt = np.bincount(p_inv, weights=(net + tax)[pmask])
    pids = np.unique(p_inv)
    amt = np.round(inv_amt[pids], 2)
    idist = F["dist"][inv_first[pids]]
    iday = F["day"][inv_first[pids]]
    cdays = pd.Series(D.Distributor_Type.values[idist]).map(CREDIT_DAYS).values
    due = iday + cdays
    mu = np.array([ARCH_PAY_DELAY[a][0] for a in D.archetype.values[idist]])
    sd = np.array([ARCH_PAY_DELAY[a][1] for a in D.archetype.values[idist]])
    hold = D.Distributor_Status.values[idist] == "Credit Hold"
    delay = np.round(rng.normal(mu + np.where(hold, 25, 0), sd)).astype(int)
    delay = np.maximum(delay, -cdays + 2)
    pay1 = due + delay
    partial = rng.random(len(pids)) < np.where(np.isin(D.archetype.values[idist], ["stockout_prone", "underperformer", "overstocker"]), 0.30, 0.08)
    frac1 = np.where(partial, rng.uniform(0.4, 0.8, len(pids)), 1.0)
    pay2 = pay1 + rng.integers(15, 75, len(pids))
    # a few chronically unpaid invoices
    bad = (rng.random(len(pids)) < 0.004) | (hold & (iday > AS_OF_DAY - 150) & (rng.random(len(pids)) < 0.5))
    pay1 = np.where(bad, 99999, pay1)
    pay2 = np.where(bad, 99999, pay2)
    a1 = np.round(amt * frac1, 2)
    a2 = np.round(amt - a1, 2)
    coll = []
    fmt = day_str
    for k in range(len(pids)):
        base = dict(Distributor_ID=D_ids[idist[k]], Invoice_No=inv_no[pids[k]], Invoice_Date=fmt(iday[k]),
                    Due_Date=fmt(due[k]), Invoice_Amount=amt[k])
        paid = 0.0
        for (pd_, pa) in ((pay1[k], a1[k]), (pay2[k], a2[k])):
            if pa <= 0:
                continue
            if pd_ <= AS_OF_DAY:
                paid += pa
                coll.append(dict(base, Payment_Date=fmt(pd_), Collection_Date=fmt(pd_ + (pd_ % 3 == 0)),
                                 Collection_Amount=pa, Outstanding_Amount=round(amt[k] - paid, 2),
                                 Days_Overdue=int(max(0, pd_ - due[k]))))
        if amt[k] - paid > 0.5:
            coll.append(dict(base, Payment_Date="", Collection_Date="", Collection_Amount=0.0,
                             Outstanding_Amount=round(amt[k] - paid, 2),
                             Days_Overdue=int(max(0, AS_OF_DAY - due[k]))))
    CL = pd.DataFrame(coll)
    CL.insert(0, "Collection_ID", [f"COL{i + 1:07d}" for i in range(len(CL))])
    st_ = np.where(CL.Payment_Date == "",
                   np.where(CL.Days_Overdue > 0, "Overdue", "Outstanding - Not Due"),
                   np.where(CL.Outstanding_Amount > 0.5, "Partially Paid",
                            np.where(CL.Days_Overdue > 0, "Paid Late", "Paid On Time")))
    CL["Collection_Status"] = st_
    log(f"  primary invoices: {len(pids):,} | collection rows: {len(CL):,}")

    # ------------------------------------------------------------------ master fields that depend on the simulation
    monthly_primary = np.bincount(F["dist"][pmask], weights=(net + tax)[pmask], minlength=len(D)) / np.maximum(1, N_MONTHS - D.join_m.values)
    D["Credit_Limit"] = np.round(monthly_primary * rng.uniform(1.1, 1.8, len(D)) / 50000) * 50000 + 100000
    D["Opening_Balance"] = np.round(monthly_primary * rng.uniform(0.3, 0.9, len(D)) * (D.join_m.values == 0), 2)
    t_d = tgt[:, 48:60, :].sum(axis=(1, 2))
    D["Sales_Target"] = np.round(np.bincount(S.di.values, weights=t_d, minlength=len(D)) / 1000) * 1000
    D["Credit_Days"] = pd.Series(D.Distributor_Type).map(CREDIT_DAYS).values
    S["Target"] = np.round(t_d / 12 / 1000) * 1000

    # ------------------------------------------------------------------ inject data-quality defects (raw only)
    log("Injecting data-quality defects into raw extracts ...")
    dq = {}
    sec_rows = np.nonzero(tx.Sales_Type.values == "Secondary")[0]
    pri_rows = np.nonzero(tx.Sales_Type.values == "Primary")[0]
    pick = lambda arr, k: rng.choice(arr, size=k, replace=False)
    used = set()

    def fresh(arr, k):
        out = []
        while len(out) < k:
            c = int(rng.choice(arr))
            if c not in used:
                used.add(c); out.append(c)
        return np.array(out)

    dup_src = fresh(sec_rows, 240)
    tx["Distributor_ID"] = tx["Distributor_ID"].astype(object)
    r = fresh(sec_rows, 60); tx.loc[r, "Distributor_ID"] = ""; dq["missing_distributor_repairable"] = len(r)
    r = fresh(pri_rows, 15); tx.loc[r, "Distributor_ID"] = ""; dq["missing_distributor_primary"] = len(r)
    r = fresh(sec_rows, 40); tx.loc[r, "SKU_ID"] = ""; dq["missing_sku"] = len(r)
    r = fresh(sec_rows, 35); tx.loc[r, "Outlet_ID"] = ""; dq["missing_outlet"] = len(r)
    r = fresh(sec_rows, 30)
    for c in ["Quantity", "Gross_Sales", "Discount", "Net_Sales", "Cost", "Gross_Margin", "Tax", "Invoice_Value"]:
        tx.loc[r, c] = -tx.loc[r, c]
    dq["negative_qty"] = len(r)
    r = fresh(sec_rows, 25)
    bad_dates = np.array(["2023-02-30", "2024-13-05", "", "31/12/2022", "2027-01-15"], dtype=object)
    tx["Transaction_Date"] = tx["Transaction_Date"].astype(object)
    tx.loc[r, "Transaction_Date"] = bad_dates[np.arange(len(r)) % len(bad_dates)]
    dq["invalid_date"] = len(r)
    r = fresh(sec_rows, 20); tx.loc[r, "Distributor_ID"] = "DST-9999"; dq["unknown_distributor"] = len(r)
    dups = tx.loc[dup_src].copy()
    dups["Transaction_ID"] = [f"TXN{n + i + 1:08d}" for i in range(len(dups))]
    tx = pd.concat([tx, dups], ignore_index=True)
    dq["duplicates"] = len(dups)
    # missing targets: drop a few salesperson-months entirely
    sp_m = targets[["Salesperson_ID", "Month"]].drop_duplicates()
    drop = sp_m.sample(n=36, random_state=args.seed)
    targets = targets.merge(drop.assign(_d=1), how="left", on=["Salesperson_ID", "Month"])
    targets = targets[targets._d.isna()].drop(columns="_d")
    dq["missing_target_sp_months"] = len(drop)
    # stock roll-forward breaks
    r = pick(np.arange(len(stock)), 60)
    stock.loc[r, "Closing_Stock"] = stock.loc[r, "Closing_Stock"] + rng.integers(5, 60, len(r))
    dq["stock_inconsistency"] = len(r)
    # over-collection
    r = pick(np.nonzero(CL.Collection_Amount.values > 0)[0], 8)
    CL.loc[r, "Collection_Amount"] = np.round(CL.loc[r, "Collection_Amount"] * 1.1, 2)
    dq["over_collection"] = len(r)

    # ------------------------------------------------------------------ write raw
    log("Writing raw extracts ...")
    geo_df.to_csv(RAW_DIR / "dim_geography.csv", index=False)
    prod = P.assign(
        MRP=px["mrp"][:, -1], Selling_Price=px["ptr"][:, -1], Distributor_Price=px["ptd"][:, -1],
        Cost_Price=px["cogs"][:, -1], GST_Rate=P.GST, Case_Size=px["case"],
        Launch_Date=[("2019-04-01" if lm == 0 else str(MONTH_START[lm] + np.timedelta64(5, "D"))) for lm in P.launch_m],
        Product_Status=np.where(P.disc_m < N_MONTHS, "Discontinued", np.where(P.launch_m >= 36, "New Launch", "Active")),
        Discontinued_Date=[str(MONTH_START[dm]) if dm < N_MONTHS else "" for dm in P.disc_m],
    )
    prod[["SKU_ID", "SKU_Code", "Product_Name", "Brand", "Category", "Sub_Category", "Variant", "Pack_Size", "UOM",
          "MRP", "Selling_Price", "Distributor_Price", "Cost_Price", "GST_Rate", "Case_Size", "Launch_Date",
          "Product_Status", "Discontinued_Date"]].to_csv(RAW_DIR / "product_master.csv", index=False)
    pl = []
    for i, sid in enumerate(P.SKU_ID.values):
        for p in range(6):
            pl.append((sid, PRICE_PERIODS[p], PRICE_PERIOD_FROM[p], PRICE_PERIOD_TO[p], px["mrp"][i, p], px["ptr"][i, p],
                       px["ptd"][i, p], px["cogs"][i, p]))
    pd.DataFrame(pl, columns=["SKU_ID", "Price_Period", "Effective_From", "Effective_To", "MRP", "Selling_Price",
                              "Distributor_Price", "Cost_Price"]).to_csv(RAW_DIR / "price_list.csv", index=False)
    D[["Distributor_ID", "Distributor_Name", "Region", "State", "City", "Territory_ID", "Territory_Name",
       "Distributor_Type", "Distributor_Status", "Credit_Limit", "Credit_Days", "Opening_Balance", "Sales_Target",
       "Join_Date"]].rename(columns={"Territory_ID": "Territory"}).to_csv(RAW_DIR / "distributor_master.csv", index=False)
    S[["Salesperson_ID", "Salesperson_Name", "Region", "State", "Territory_ID", "Distributor_ID", "Joining_Date",
       "Target", "Status"]].rename(columns={"Territory_ID": "Territory"}).to_csv(RAW_DIR / "salesperson_master.csv", index=False)
    B[["Beat_ID", "Beat_Name", "Salesperson_ID", "Distributor_ID", "City", "Visit_Day"]].to_csv(RAW_DIR / "beat_master.csv", index=False)
    O[["Outlet_ID", "Outlet_Name", "Outlet_Type", "Channel", "Region", "State", "City", "Territory_ID", "Distributor_ID",
       "Beat_ID", "Outlet_Status", "Opening_Date", "Closed_Date"]].rename(columns={"Territory_ID": "Territory"}).to_csv(
        RAW_DIR / "outlet_master.csv", index=False)
    tx.to_csv(RAW_DIR / f"sales_transactions{ext}", index=False)
    targets.to_csv(RAW_DIR / "sales_targets.csv", index=False)
    sku_mix.to_csv(RAW_DIR / "sku_target_mix.csv", index=False)
    stock.to_csv(RAW_DIR / f"distributor_stock{ext}", index=False)
    CL.to_csv(RAW_DIR / "collections.csv", index=False)

    truth = {
        "company": COMPANY, "seed": args.seed, "scale": args.scale, "period": "2021-01-01 to 2025-12-31",
        "as_of_date": day_str(AS_OF_DAY),
        "row_counts": {"sales_transactions": int(len(tx)), "distributor_stock": int(len(stock)),
                       "sales_targets": int(len(targets)), "collections": int(len(CL)), "outlets": int(len(O)),
                       "skus": int(len(P)), "distributors": int(len(D)), "salespersons": int(len(S)), "beats": int(len(B))},
        "injected_dq_defects": dq,
        "planted_patterns": {
            "distributor_archetypes": D.groupby("archetype").Distributor_ID.apply(list).to_dict(),
            "sku_archetypes": P.groupby("archetype").SKU_ID.apply(list).to_dict(),
            "weak_new_launches": P.SKU_ID.values[P.weak_launch.values].tolist(),
            "discontinued_skus": P.SKU_ID.values[P.disc_m.values < N_MONTHS].tolist(),
            "rising_outlets_2025": O.Outlet_ID.values[rising].tolist()[:200],
            "events": [
                "COVID second wave Apr-Jun 2021: GT/MT orders -20..-32%, Health & Wellness and Hand Wash spike, e-commerce +35..50%",
                "FY 2022-23 input-cost inflation: cost +11% vs price +7% -> gross-margin squeeze",
                "Punjab: competitor entry from Jul-2024 -> ~18% lower outlet order frequency",
                "North Hair Care: competitor herbal launch from Jul-2024 -> ~28% lower Hair Care demand",
                "Quarter-end primary loading (heaviest in March) by over-stocking distributors",
                "East & South fastest growing regions; Central slowest",
                "E-commerce and Modern Trade outlets growing faster than General Trade",
            ],
        },
        "demand_lost_to_stockouts_pct": round(float(lost) * 100, 2),
    }
    (RAW_DIR / "_ground_truth.json").write_text(json.dumps(truth, indent=2))
    log(f"Raw data written to {RAW_DIR} in {time.time() - t0:.0f}s")

    if not args.skip_build:
        log("Running build_dataset.py ...")
        subprocess.run([sys.executable, str(ROOT / "build_dataset.py")], check=True)


if __name__ == "__main__":
    main()
