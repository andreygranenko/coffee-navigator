"""Fetch Riga transit stops and retail anchors from OpenStreetMap (Overpass).

Creates derived files only — does not modify existing source datasets.

Outputs:
  - data/derived/osm_transit_riga.csv      (bus/tram/rail stops)
  - data/derived/osm_malls_riga.csv        (malls, shopping centres, large supermarkets)

Run:
  python3 scripts/fetch_osm_transit_malls.py
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
OUT_TRANSIT_CSV = OUT_DIR / "osm_transit_riga.csv"
OUT_MALLS_CSV = OUT_DIR / "osm_malls_riga.csv"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

TRANSIT_FIELDS = ["osm_key", "osm_type", "osm_id", "name", "latitude", "longitude",
                  "stop_type", "operator", "network", "tags_json"]
MALL_FIELDS = ["osm_key", "osm_type", "osm_id", "name", "latitude", "longitude",
               "shop", "amenity", "leisure", "operator", "brand", "tags_json"]


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
    xs: list[float] = []
    ys: list[float] = []
    for feature in data.get("features", []):
        for lon, lat in _iter_coords(feature.get("geometry", {}).get("coordinates")):
            xs.append(lon)
            ys.append(lat)
    if not xs:
        raise RuntimeError("Could not compute bbox from district GeoJSON.")
    return min(ys), min(xs), max(ys), max(xs)


def make_transit_query(south: float, west: float, north: float, east: float) -> str:
    bb = f"{south},{west},{north},{east}"
    return f"""
[out:json][timeout:180];
(
  node["highway"="bus_stop"]({bb});
  node["railway"="tram_stop"]({bb});
  node["railway"="station"]({bb});
  way["railway"="station"]({bb});
  node["amenity"="bus_station"]({bb});
  way["amenity"="bus_station"]({bb});
  node["railway"="halt"]({bb});
);
out center tags;
"""


def make_mall_query(south: float, west: float, north: float, east: float) -> str:
    bb = f"{south},{west},{north},{east}"
    return f"""
[out:json][timeout:180];
(
  node["shop"="mall"]({bb});
  way["shop"="mall"]({bb});
  relation["shop"="mall"]({bb});
  node["shop"="shopping_centre"]({bb});
  way["shop"="shopping_centre"]({bb});
  relation["shop"="shopping_centre"]({bb});
  node["leisure"="shopping_centre"]({bb});
  way["leisure"="shopping_centre"]({bb});
  relation["leisure"="shopping_centre"]({bb});
  node["shop"="supermarket"]({bb});
  way["shop"="supermarket"]({bb});
);
out center tags;
"""


def fetch_overpass(query: str) -> dict:
    last_err: str | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            proc = subprocess.run(
                ["curl", "--silent", "--show-error", "--fail",
                 "--max-time", "240", "--request", "POST",
                 endpoint, "--data-urlencode", f"data={query}"],
                capture_output=True, text=True, check=True,
            )
            return json.loads(proc.stdout)
        except Exception as exc:
            last_err = str(exc)
            time.sleep(1)
    raise RuntimeError(f"All Overpass endpoints failed: {last_err}")


def _coords(el: dict) -> tuple[float, float] | None:
    lat = el.get("lat")
    lon = el.get("lon")
    center = el.get("center") or {}
    if lat is None:
        lat = center.get("lat")
    if lon is None:
        lon = center.get("lon")
    if lat is None or lon is None:
        return None
    return float(lat), float(lon)


def normalize_transit(elements: list[dict]) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for el in elements:
        typ = str(el.get("type", ""))
        osmid = el.get("id")
        if not typ or osmid is None:
            continue
        key = f"{typ}/{osmid}"
        if key in seen:
            continue
        coords = _coords(el)
        if coords is None:
            continue
        tags = el.get("tags") or {}
        stop_type = (
            tags.get("railway") or tags.get("highway") or tags.get("amenity") or ""
        )
        rows.append({
            "osm_key": key,
            "osm_type": typ,
            "osm_id": int(osmid),
            "name": tags.get("name", ""),
            "latitude": coords[0],
            "longitude": coords[1],
            "stop_type": stop_type,
            "operator": tags.get("operator", ""),
            "network": tags.get("network", ""),
            "tags_json": json.dumps(tags, ensure_ascii=False),
        })
        seen.add(key)
    return rows


def normalize_malls(elements: list[dict]) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for el in elements:
        typ = str(el.get("type", ""))
        osmid = el.get("id")
        if not typ or osmid is None:
            continue
        key = f"{typ}/{osmid}"
        if key in seen:
            continue
        coords = _coords(el)
        if coords is None:
            continue
        tags = el.get("tags") or {}
        rows.append({
            "osm_key": key,
            "osm_type": typ,
            "osm_id": int(osmid),
            "name": tags.get("name", ""),
            "latitude": coords[0],
            "longitude": coords[1],
            "shop": tags.get("shop", ""),
            "amenity": tags.get("amenity", ""),
            "leisure": tags.get("leisure", ""),
            "operator": tags.get("operator", ""),
            "brand": tags.get("brand", ""),
            "tags_json": json.dumps(tags, ensure_ascii=False),
        })
        seen.add(key)
    return rows


def write_csv(rows: list[dict], fields: list[str], out_path: Path) -> None:
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    if not GEOJSON.exists():
        sys.exit(f"Missing file: {GEOJSON}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    south, west, north, east = bbox_from_geojson(GEOJSON)
    print(f"BBOX: south={south:.6f}, west={west:.6f}, north={north:.6f}, east={east:.6f}\n")

    print("Fetching transit stops (bus, tram, rail)…")
    transit_data = fetch_overpass(make_transit_query(south, west, north, east))
    transit_rows = normalize_transit(transit_data.get("elements", []))
    write_csv(transit_rows, TRANSIT_FIELDS, OUT_TRANSIT_CSV)
    print(f"  → {len(transit_rows)} stops → {OUT_TRANSIT_CSV.relative_to(ROOT)}")

    time.sleep(2)  # be polite to Overpass

    print("Fetching retail anchors (malls, shopping centres, supermarkets)…")
    mall_data = fetch_overpass(make_mall_query(south, west, north, east))
    mall_rows = normalize_malls(mall_data.get("elements", []))
    write_csv(mall_rows, MALL_FIELDS, OUT_MALLS_CSV)
    print(f"  → {len(mall_rows)} venues → {OUT_MALLS_CSV.relative_to(ROOT)}")

    # Summary
    print()
    stop_types = {}
    for r in transit_rows:
        t = r["stop_type"]
        stop_types[t] = stop_types.get(t, 0) + 1
    print("Transit stop types:", dict(sorted(stop_types.items(), key=lambda x: -x[1])))
    mall_types = {}
    for r in mall_rows:
        t = r["shop"] or r["leisure"] or r["amenity"] or "?"
        mall_types[t] = mall_types.get(t, 0) + 1
    print("Retail anchor types:", dict(sorted(mall_types.items(), key=lambda x: -x[1])))


if __name__ == "__main__":
    main()
