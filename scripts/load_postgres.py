"""Load current JSON artifacts into PostgreSQL (read-only source files).

Usage:
  python3 -m pip install -r scripts/requirements-postgres.txt
  python3 scripts/load_postgres.py

Optional env:
  DATABASE_URL=postgresql://riga:riga_dev_password@localhost:5432/riga_navigator
  RUN_LABEL=manual-2026-04-28
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = ROOT / "public" / "data"
SCHEMA_SQL = ROOT / "sql" / "schema_postgres.sql"
DEFAULT_DB_URL = "postgresql://riga:riga_dev_password@localhost:5432/riga_navigator"


def read_json(path: Path):
    return json.loads(path.read_text())


def as_float(v: Any) -> float | None:
    return float(v) if v is not None else None


def as_int(v: Any) -> int | None:
    return int(v) if v is not None else None


def main() -> None:
    db_url = os.getenv("DATABASE_URL", DEFAULT_DB_URL)
    run_label = os.getenv("RUN_LABEL", f"local-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}")

    districts = read_json(PUBLIC_DATA / "districts.json")
    cafes = read_json(PUBLIC_DATA / "cafes.json")
    venues = read_json(PUBLIC_DATA / "venues.json")
    clusters = read_json(PUBLIC_DATA / "clusters.json")
    geojson = read_json(PUBLIC_DATA / "districts.geojson")

    schema_sql = SCHEMA_SQL.read_text()

    with psycopg.connect(db_url, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute(schema_sql)
            cur.execute(
                """
                INSERT INTO model_runs (run_label, notes)
                VALUES (%s, %s::jsonb)
                ON CONFLICT (run_label) DO UPDATE
                  SET notes = EXCLUDED.notes
                RETURNING id
                """,
                (
                    run_label,
                    json.dumps(
                        {
                            "source": "public/data",
                            "districts": len(districts),
                            "cafes": len(cafes),
                            "venues": len(venues),
                            "clusters": len(clusters),
                        }
                    ),
                ),
            )
            run_id = cur.fetchone()[0]

            # Keep source files immutable: we only copy data into DB tables for this run snapshot.
            cur.execute("DELETE FROM artifacts WHERE run_id = %s", (run_id,))
            cur.execute("DELETE FROM district_poi_breakdown WHERE run_id = %s", (run_id,))
            cur.execute("DELETE FROM cafes WHERE run_id = %s", (run_id,))
            cur.execute("DELETE FROM venues WHERE run_id = %s", (run_id,))
            cur.execute("DELETE FROM clusters WHERE run_id = %s", (run_id,))
            cur.execute("DELETE FROM districts WHERE run_id = %s", (run_id,))

            artifact_rows = [
                (run_id, "districts", json.dumps(districts, ensure_ascii=False)),
                (run_id, "cafes", json.dumps(cafes, ensure_ascii=False)),
                (run_id, "venues", json.dumps(venues, ensure_ascii=False)),
                (run_id, "clusters", json.dumps(clusters, ensure_ascii=False)),
                (run_id, "districts_geojson", json.dumps(geojson, ensure_ascii=False)),
            ]
            cur.executemany(
                "INSERT INTO artifacts (run_id, name, payload) VALUES (%s, %s, %s::jsonb)",
                artifact_rows,
            )

            district_rows = [
                (
                    d["id"],
                    run_id,
                    d["name"],
                    d["cluster"],
                    as_int(d["clusterId"]),
                    bool(d["lowConfidence"]),
                    bool(d.get("lowQualitySample")) if d.get("lowQualitySample") is not None else None,
                    as_float(d["areaKm2"]),
                    as_int(d["cafeCount"]),
                    as_float(d.get("avgRating")),
                    as_int(d["totalReviews"]),
                    as_float(d["cafesPerKm2"]),
                    as_int(d["poiTotal"]),
                    as_float(d["poiPerKm2"]),
                    as_int(d["officeCount"]),
                    as_float(d["officesPerKm2"]),
                    as_int(d.get("venueCount")),
                    as_float(d.get("venuesPerKm2")),
                    as_int(d.get("transitCount")),
                    as_float(d.get("transitPerKm2")),
                    as_int(d.get("mallCount")),
                    as_int(d.get("qualitySampleSize")),
                    as_float(d.get("ratingStdDev")),
                    as_float(d.get("avgPriceLevel")),
                    as_float(d["competitionScore"]),
                    as_float(d["demandScore"]),
                    as_float(d["qualityScore"]),
                    as_float(d["opportunityScore"]),
                )
                for d in districts
            ]
            cur.executemany(
                """
                INSERT INTO districts (
                  id, run_id, name, cluster, cluster_id, low_confidence, low_quality_sample, area_km2,
                  cafe_count, avg_rating, total_reviews, cafes_per_km2, poi_total, poi_per_km2, office_count,
                  offices_per_km2, venue_count, venues_per_km2, transit_count, transit_per_km2, mall_count,
                  quality_sample_size, rating_std_dev, avg_price_level, competition_score, demand_score,
                  quality_score, opportunity_score
                ) VALUES (
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                district_rows,
            )

            poi_rows = []
            for d in districts:
                for poi_type, poi_count in d["poiBreakdown"].items():
                    poi_rows.append((d["id"], poi_type, int(poi_count), run_id))
            cur.executemany(
                """
                INSERT INTO district_poi_breakdown (district_id, poi_type, poi_count, run_id)
                VALUES (%s, %s, %s, %s)
                """,
                poi_rows,
            )

            cafe_rows = [
                (
                    c["id"],
                    run_id,
                    c["name"],
                    as_float(c["lat"]),
                    as_float(c["lng"]),
                    as_float(c.get("rating")),
                    as_int(c["reviews"]),
                    as_int(c.get("priceLevel")),
                    c.get("address") or "",
                    c.get("website"),
                    c.get("googleMapsUrl"),
                    c.get("districtId"),
                    c.get("districtName"),
                )
                for c in cafes
            ]
            cur.executemany(
                """
                INSERT INTO cafes (
                  id, run_id, name, lat, lng, rating, reviews, price_level, address, website, google_maps_url,
                  district_id, district_name
                ) VALUES (
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                cafe_rows,
            )

            venue_rows = [
                (
                    v["id"],
                    run_id,
                    v.get("name"),
                    as_float(v["lat"]),
                    as_float(v["lng"]),
                    v.get("amenity") or "unknown",
                    v.get("districtId"),
                )
                for v in venues
            ]
            cur.executemany(
                """
                INSERT INTO venues (id, run_id, name, lat, lng, amenity, district_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                venue_rows,
            )

            cluster_rows = [
                (
                    as_int(c["clusterId"]),
                    c["name"],
                    as_int(c["size"]),
                    json.dumps(c["members"], ensure_ascii=False),
                    json.dumps(c["centroid"], ensure_ascii=False),
                    run_id,
                )
                for c in clusters
            ]
            cur.executemany(
                """
                INSERT INTO clusters (cluster_id, name, size, members, centroid, run_id)
                VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s)
                """,
                cluster_rows,
            )

        conn.commit()

    print(f"Loaded PostgreSQL run_id={run_id}, run_label={run_label}")
    print(
        f"districts={len(districts)} cafes={len(cafes)} venues={len(venues)} "
        f"clusters={len(clusters)} poi_rows={len(poi_rows)} artifacts={len(artifact_rows)}"
    )


if __name__ == "__main__":
    main()
