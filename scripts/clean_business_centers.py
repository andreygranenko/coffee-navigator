"""Classify the noisy `business_centers` POI layer with Gemini.

Reads :  data/drive-download-20260420T132813Z-3-001/riga_business_centers_20251026_122518.csv
Writes:  data/derived/business_centers_classification.json

Resumable. Each successful batch is flushed to disk. If the quota dies, the API
key gets rotated, or the process is interrupted, just rerun this script — it
picks up where it left off, keyed by `place_id`.

Usage:
    source .venv/bin/activate
    python scripts/clean_business_centers.py
    python scripts/clean_business_centers.py --limit 100         # smoke test
    python scripts/clean_business_centers.py --batch-size 30     # smaller batches
    python scripts/clean_business_centers.py --model gemini-2.0-flash
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types

ROOT = Path(__file__).resolve().parent.parent
RAW = (
    ROOT
    / "data"
    / "drive-download-20260420T132813Z-3-001"
    / "riga_business_centers_20251026_122518.csv"
)
OUT_DIR = ROOT / "data" / "derived"
OUT_FILE = OUT_DIR / "business_centers_classification.json"

# gemini-2.5-flash free tier: 10 RPM, 250 RPD. With batches of 50, 1909 rows ≈ 39
# requests — fits easily. gemini-2.0-flash is also fine (15 RPM, 1500 RPD).
DEFAULT_MODEL = "gemini-2.5-flash"
DEFAULT_BATCH_SIZE = 50
MIN_REQUEST_INTERVAL_S = 6.5  # 10 RPM = one request per 6s; leave a margin

PROMPT = """\
You are classifying Google Places entries from Riga, Latvia. We want to keep ONLY
real office buildings / business centers — places where professionals work daily.

For each entry, return is_office=true if it is one of:
- A named business center (BC X, Office Center X, biroju centrs)
- A real company office (IT, tech, finance, law, consulting, gov/admin, banking, insurance)
- A coworking space
- A clearly white-collar office workplace

Return is_office=false for:
- Hotels, hostels, lodging, apartments
- Retail stores, supermarkets, malls
- Car repair / auto / petrol
- Restaurants, cafes, bars, food
- Pharmacies, clinics, hospitals (medical, not admin)
- Warehouses, factories, industrial sites, storage
- Localities, neighborhoods, political entities ("locality,political")
- Schools, kindergartens, training centers
- Beauty salons, gyms, leisure
- Post offices, gas stations
- Anything you can't confidently call an office workplace

Respond ONLY with a JSON array following the schema. Use the EXACT place_id from
the input. If the name/types are ambiguous, choose false. Keep `reason` short
(<= 12 words).
"""

# Gemini OpenAPI-style schema. Using dict (not Pydantic) to keep deps minimal.
RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "place_id": {"type": "STRING"},
            "is_office": {"type": "BOOLEAN"},
            "reason": {"type": "STRING"},
        },
        "required": ["place_id", "is_office"],
    },
}


def load_progress() -> dict[str, dict]:
    if OUT_FILE.exists():
        try:
            return json.loads(OUT_FILE.read_text())
        except json.JSONDecodeError:
            print(f"WARN: {OUT_FILE} is corrupt, starting fresh.")
            return {}
    return {}


def save_progress(progress: dict[str, dict]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # write to temp then rename — protects against half-written file on crash
    tmp = OUT_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(progress, ensure_ascii=False, indent=2))
    tmp.replace(OUT_FILE)


def make_rows(batch: pd.DataFrame) -> list[dict]:
    rows = []
    for _, r in batch.iterrows():
        rows.append({
            "place_id": r["place_id"],
            "name": str(r.get("name") or "")[:120],
            "types": str(r.get("google_types") or "")[:200],
            "address": str(r.get("formatted_address") or r.get("vicinity") or "")[:120],
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Process only N records (smoke test)")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--rpm-spacing", type=float, default=MIN_REQUEST_INTERVAL_S,
                        help="Minimum seconds between requests (free tier rate limit)")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env.local")
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("ERROR: GEMINI_API_KEY not found. Add it to .env.local and retry.")

    client = genai.Client(api_key=api_key)

    df = pd.read_csv(RAW).dropna(subset=["place_id"]).drop_duplicates(subset="place_id")
    progress = load_progress()
    print(f"Total records: {len(df)}")
    print(f"Already classified: {len(progress)}")

    todo = df[~df["place_id"].isin(progress.keys())].reset_index(drop=True)
    if args.limit:
        todo = todo.head(args.limit)
    print(f"To process this run: {len(todo)}\n")

    if todo.empty:
        print("Nothing to do.")
        _print_summary(progress)
        return

    bs = args.batch_size
    n_batches = (len(todo) + bs - 1) // bs
    last_call_at = 0.0

    for batch_idx in range(n_batches):
        batch = todo.iloc[batch_idx * bs : (batch_idx + 1) * bs]
        rows = make_rows(batch)

        # rate limiting: spacing requests over time
        wait = args.rpm_spacing - (time.time() - last_call_at)
        if wait > 0 and last_call_at > 0:
            time.sleep(wait)

        try:
            resp = client.models.generate_content(
                model=args.model,
                contents=PROMPT + "\n\nINPUT:\n" + json.dumps(rows, ensure_ascii=False),
                config=genai_types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=RESPONSE_SCHEMA,
                    temperature=0.0,
                ),
            )
            last_call_at = time.time()
        except Exception as e:
            err_str = str(e)
            print(f"\n!! API error on batch {batch_idx + 1}/{n_batches}: {err_str[:300]}")
            save_progress(progress)
            print(f"   Progress saved to {OUT_FILE.relative_to(ROOT)}")
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
                print("   Looks like a quota/rate-limit problem.")
                print("   Options:")
                print("     - wait a minute and rerun (RPM hit)")
                print("     - wait until midnight PT and rerun (RPD hit)")
                print("     - rotate GEMINI_API_KEY in .env.local and rerun")
                print("     - run --limit 100 first to verify the new key works")
            sys.exit(2)

        try:
            classifications = json.loads(resp.text)
        except (json.JSONDecodeError, AttributeError) as e:
            print(f"\n!! Could not parse JSON from model on batch {batch_idx + 1}: {e}")
            print(f"   Raw response: {(getattr(resp, 'text', '') or '')[:500]}")
            save_progress(progress)
            sys.exit(3)

        by_id = {c["place_id"]: c for c in classifications if isinstance(c, dict) and "place_id" in c}
        matched = 0
        for r in rows:
            pid = r["place_id"]
            if pid in by_id:
                c = by_id[pid]
                progress[pid] = {
                    "is_office": bool(c.get("is_office", False)),
                    "reason": str(c.get("reason", ""))[:200],
                    "name": r["name"],
                    "types": r["types"],
                }
                matched += 1
        save_progress(progress)

        offices_so_far = sum(1 for v in progress.values() if v["is_office"])
        unmatched = len(batch) - matched
        print(f"  batch {batch_idx + 1:>3}/{n_batches}  "
              f"matched={matched}/{len(batch)}"
              f"{f' (skipped {unmatched})' if unmatched else ''}  "
              f"total={len(progress)}  offices={offices_so_far}")

    print()
    _print_summary(progress)


def _print_summary(progress: dict[str, dict]) -> None:
    if not progress:
        return
    yes = sum(1 for v in progress.values() if v["is_office"])
    print(f"=== Classified: {len(progress)} ===")
    print(f"   real offices : {yes} ({100 * yes / len(progress):.1f}%)")
    print(f"   discarded    : {len(progress) - yes}")
    print(f"   output file  : {OUT_FILE.relative_to(ROOT)}")
    sample = [v for v in progress.values() if v["is_office"]][:5]
    if sample:
        print("\nSample matches as office:")
        for s in sample:
            print(f"   - {s['name']}  →  {s.get('reason', '')}")


if __name__ == "__main__":
    main()
