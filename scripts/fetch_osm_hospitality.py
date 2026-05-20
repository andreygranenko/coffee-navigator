"""Fetch Riga coffee-service venues from OpenStreetMap (Overpass).

Captures all places that realistically serve coffee:
  amenity=cafe, amenity=restaurant, amenity=fast_food

This gives a much broader competition baseline than Google Places
cafe-type-only data, which misses breakfast spots, bistros, etc.

Output:
  data/derived/osm_hospitality_riga.csv

Run:
  python3 scripts/fetch_osm_hospitality.py
"""
from __future__ import annotations

import csv
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent
GEOJSON = ROOT / "data" / "drive-download-20260420T132813Z-3-001" / "riga_districts.geojson"
OUT_DIR = ROOT / "data" / "derived"
OUT_CSV = OUT_DIR / "osm_hospitality_riga.csv"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

FIELDS = ["osm_key", "osm_type", "osm_id", "name", "latitude", "longitude",
          "amenity", "cuisine", "operator", "brand", "tags_json"]

AMENITY_TYPES = ["cafe", "restaurant", "fast_food"]


def _iter_coords(coords: object) -> Iterable[tuple[float, float]]:
    if (
        isinstance(coords, list)
        and len(coords) == 2
        and all(isinstance(v, (int, float)) for v in coords)
    ):
        yield float(coords[0]), float(coords[1])
        return
    if isinstance(coords, list):
        for child in coords:
            yield from _iter_coords(child)


def bbox_from_geojson(path: Path) -> tuple[float, float, float, float]:
    data = json.loads(path.read_text())
    xs, ys = [], []
    for feat in data.get("features", []):
        for lon, lat in _iter_coords(feat.get("geometry", {}).get("coordinates")):
            xs.append(lon); ys.append(lat)
    if not xs:
        raise RuntimeError("Could not compute bbox.")
    return min(ys), min(xs), max(ys), max(xs)


def make_query(south: float, west: float, north: float, east: float) -> str:
    bb = f"{south},{west},{north},{east}"
    parts = "\n".join(
        f'  node["amenity"="{t}"]({bb});\n  way["amenity"="{t}"]({bb});'
        for t in AMENITY_TYPES
    )
    return f"[out:json][timeout:180];\n(\n{parts}\n);\nout center tags;"


def fetch_overpass(query: str) -> dict:
    last_err = None
    for ep in OVERPASS_ENDPOINTS:
        try:
            proc = subprocess.run(
                ["curl", "--silent", "--show-error", "--fail",
                 "--max-time", "240", "--request", "POST",
                 ep, "--data-urlencode", f"data={query}"],
                capture_output=True, text=True, check=True,
            )
            return json.loads(proc.stdout)
        except Exception as e:
            last_err = str(e); time.sleep(1)
    raise RuntimeError(f"All endpoints failed: {last_err}")


def normalize_rows(elements: list[dict]) -> list[dict]:
    rows, seen = [], set()
    for el in elements:
        typ = str(el.get("type", "")); osmid = el.get("id")
        if not typ or osmid is None: continue
        key = f"{typ}/{osmid}"
        if key in seen: continue
        lat = el.get("lat"); lon = el.get("lon")
        c = el.get("center") or {}
        if lat is None: lat = c.get("lat")
        if lon is None: lon = c.get("lon")
        if lat is None or lon is None: continue
        tags = el.get("tags") or {}
        rows.append({
            "osm_key": key, "osm_type": typ, "osm_id": int(osmid),
            "name": tags.get("name", ""),
            "latitude": float(lat), "longitude": float(lon),
            "amenity": tags.get("amenity", ""),
            "cuisine": tags.get("cuisine", ""),
            "operator": tags.get("operator", ""),
            "brand": tags.get("brand", ""),
            "tags_json": json.dumps(tags, ensure_ascii=False),
        })
        seen.add(key)
    return rows


def main() -> None:
    if not GEOJSON.exists():
        sys.exit(f"Missing: {GEOJSON}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    south, west, north, east = bbox_from_geojson(GEOJSON)
    print(f"BBOX: {south:.4f},{west:.4f},{north:.4f},{east:.4f}")
    print(f"Fetching: {', '.join(AMENITY_TYPES)}…")

    data = fetch_overpass(make_query(south, west, north, east))
    rows = normalize_rows(data.get("elements", []))

    from collections import Counter
    type_counts = Counter(r["amenity"] for r in rows)
    print(f"  Total: {len(rows)}")
    for t, n in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"    amenity={t}: {n}")

    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader(); writer.writerows(rows)
    print(f"\nWrote {OUT_CSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
