"""Fetch Riga office objects from OpenStreetMap (Overpass) and save raw files.

Creates only new derived files; does not modify existing source datasets.

Outputs:
  - data/derived/osm_offices_riga_raw.json
  - data/derived/osm_offices_riga.csv
  - data/derived/osm_offices_riga_meta.json

Run:
  python3 scripts/fetch_osm_offices.py
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
OUT_RAW = OUT_DIR / "osm_offices_riga_raw.json"
OUT_CSV = OUT_DIR / "osm_offices_riga.csv"
OUT_META = OUT_DIR / "osm_offices_riga_meta.json"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]


def _iter_coords(coords: object) -> Iterable[tuple[float, float]]:
    if (
        isinstance(coords, list)
        and len(coords) == 2
        and all(isinstance(v, (int, float)) for v in coords)
    ):
        yield float(coords[0]), float(coords[1])  # lon, lat
        return
    if isinstance(coords, list):
        for child in coords:
            yield from _iter_coords(child)


def bbox_from_geojson(path: Path) -> tuple[float, float, float, float]:
    data = json.loads(path.read_text())
    xs: list[float] = []
    ys: list[float] = []
    for feature in data.get("features", []):
        geometry = feature.get("geometry", {})
        for lon, lat in _iter_coords(geometry.get("coordinates")):
            xs.append(lon)
            ys.append(lat)
    if not xs or not ys:
        raise RuntimeError("Could not compute bbox from district GeoJSON.")
    return min(ys), min(xs), max(ys), max(xs)  # south, west, north, east


def make_query(south: float, west: float, north: float, east: float) -> str:
    return f"""
[out:json][timeout:180];
(
  node["office"]({south},{west},{north},{east});
  way["office"]({south},{west},{north},{east});
  relation["office"]({south},{west},{north},{east});
  node["building"="office"]({south},{west},{north},{east});
  way["building"="office"]({south},{west},{north},{east});
  relation["building"="office"]({south},{west},{north},{east});
);
out center tags;
"""


def fetch_overpass(query: str) -> dict:
    last_err: str | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            proc = subprocess.run(
                [
                    "curl",
                    "--silent",
                    "--show-error",
                    "--fail",
                    "--max-time",
                    "240",
                    "--request",
                    "POST",
                    endpoint,
                    "--data-urlencode",
                    f"data={query}",
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            body = proc.stdout
            return json.loads(body)
        except Exception as exc:  # surfaced in final RuntimeError below
            last_err = str(exc)
            time.sleep(1)
    raise RuntimeError(f"All Overpass endpoints failed: {last_err}")


def normalize_rows(elements: list[dict]) -> list[dict]:
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

        lat = el.get("lat")
        lon = el.get("lon")
        center = el.get("center") or {}
        if lat is None or lon is None:
            lat = center.get("lat")
            lon = center.get("lon")
        if lat is None or lon is None:
            continue

        tags = el.get("tags") or {}
        rows.append(
            {
                "osm_key": key,
                "osm_type": typ,
                "osm_id": int(osmid),
                "name": tags.get("name", ""),
                "latitude": float(lat),
                "longitude": float(lon),
                "office": tags.get("office", ""),
                "building": tags.get("building", ""),
                "operator": tags.get("operator", ""),
                "brand": tags.get("brand", ""),
                "addr_street": tags.get("addr:street", ""),
                "addr_housenumber": tags.get("addr:housenumber", ""),
                "addr_city": tags.get("addr:city", ""),
                "source": "osm_overpass",
                "tags_json": json.dumps(tags, ensure_ascii=False),
            }
        )
        seen.add(key)
    return rows


def write_csv(rows: list[dict], out_path: Path) -> None:
    if not rows:
        raise RuntimeError("No rows to write.")
    fields = list(rows[0].keys())
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    if not GEOJSON.exists():
        sys.exit(f"Missing file: {GEOJSON}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    south, west, north, east = bbox_from_geojson(GEOJSON)
    print(f"BBOX (Riga): south={south:.6f}, west={west:.6f}, north={north:.6f}, east={east:.6f}")

    query = make_query(south, west, north, east)
    data = fetch_overpass(query)
    elements = data.get("elements", [])
    if not elements:
        sys.exit("Overpass returned no elements.")

    rows = normalize_rows(elements)
    if not rows:
        sys.exit("Overpass returned elements without coordinates/tags.")

    OUT_RAW.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    write_csv(rows, OUT_CSV)
    OUT_META.write_text(
        json.dumps(
            {
                "source": "OpenStreetMap via Overpass",
                "generated_at_unix": int(time.time()),
                "bbox": {
                    "south": south,
                    "west": west,
                    "north": north,
                    "east": east,
                },
                "overpass_endpoints": OVERPASS_ENDPOINTS,
                "elements_total": len(elements),
                "rows_written": len(rows),
                "query": query.strip(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    print(f"Wrote {OUT_RAW.relative_to(ROOT)}")
    print(f"Wrote {OUT_CSV.relative_to(ROOT)} ({len(rows)} rows)")
    print(f"Wrote {OUT_META.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
