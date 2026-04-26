"""Build clean JSON data for the frontend from raw CSV/GeoJSON sources.

Reads (read-only) from data/drive-download-20260420T132813Z-3-001/.
Writes to public/data/.

Run from project root:
    source .venv/bin/activate
    python scripts/build_data.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "drive-download-20260420T132813Z-3-001"
OUT = ROOT / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

CAFES_CSV = RAW / "riga_cafes_enriched_20251026_113656.csv"
GEOJSON = RAW / "riga_districts.geojson"
POI_LAYERS = {
    "universities": RAW / "riga_universities_20251026_122518.csv",
    "parks": RAW / "riga_parks_20251026_122518.csv",
    "tourist_attractions": RAW / "riga_tourist_attractions_20251026_122518.csv",
    "transport_hubs": RAW / "riga_transport_hubs_20251026_122518.csv",
}

VENDING_RE = re.compile(r"vending|automāt|automat", re.IGNORECASE)
MIN_REVIEWS = 5
LOW_CONFIDENCE_CAFES = 10
BAYES_PRIOR = 5  # smoothing weight for district quality score

WEIGHTS = {"demand": 0.4, "competition": 0.3, "quality": 0.3}


def to_gdf(df: pd.DataFrame) -> gpd.GeoDataFrame:
    geom = [Point(xy) for xy in zip(df["longitude"], df["latitude"])]
    return gpd.GeoDataFrame(df, geometry=geom, crs="EPSG:4326")


def normalize(s: pd.Series) -> pd.Series:
    """Min-max to [0, 1]. Empty/constant series → 0."""
    if s.empty or s.max() == s.min():
        return pd.Series([0.0] * len(s), index=s.index)
    return (s - s.min()) / (s.max() - s.min())


def classify_cluster(row: pd.Series) -> str:
    """Rule-based cluster from POI mix and density. Replaces K-Means for MVP."""
    total_poi = row["poi_total"]
    if total_poi == 0:
        return "Residential"

    tourist_share = row["poi_tourist_attractions"] / total_poi
    transit_share = row["poi_transport_hubs"] / total_poi
    uni_per_km2 = row["poi_universities"] / max(row["area_km2"], 0.01)
    poi_density = total_poi / max(row["area_km2"], 0.01)

    if tourist_share > 0.30 and row["poi_tourist_attractions"] >= 5:
        return "Tourist Center"
    if uni_per_km2 > 3 and row["poi_universities"] >= 3:
        return "Student / Hipster"
    if transit_share > 0.60 and row["avg_rating"] and row["avg_rating"] >= 4.2:
        return "Business Hub"
    if poi_density < 5:
        return "Residential"
    return "Mixed"


def main() -> None:
    print(f"Reading from: {RAW}")
    print(f"Writing to:   {OUT}\n")

    # --- 1. Load district polygons -------------------------------------------------
    districts = gpd.read_file(GEOJSON)
    # rename to avoid collision with `name` column in POI/cafe CSVs during sjoin
    districts = districts.rename(columns={"name": "district"})
    # area in km² — project to a metric CRS first (LKS-92 / Latvia EPSG:3059)
    districts["area_km2"] = districts.to_crs(3059).area / 1e6
    print(f"Loaded {len(districts)} district polygons")

    # --- 2. Load and clean cafes ---------------------------------------------------
    cafes_raw = pd.read_csv(CAFES_CSV)
    print(f"Loaded {len(cafes_raw)} raw cafes")

    cafes_gdf = to_gdf(cafes_raw)
    # spatial join: which district contains each cafe
    cafes_joined = gpd.sjoin(
        cafes_gdf, districts[["district", "geometry"]], how="left", predicate="within"
    )
    cafes_joined = cafes_joined.rename(columns={"name": "cafe_name"})

    n_inside_riga = cafes_joined["district"].notna().sum()
    print(f"  inside Riga polygons: {n_inside_riga} / {len(cafes_joined)}")

    # filters: inside Riga, operational, real reviews, not a vending machine
    is_operational = cafes_joined["business_status"] == "OPERATIONAL"
    has_reviews = cafes_joined["user_ratings_total"].fillna(0) >= MIN_REVIEWS
    not_vending = ~cafes_joined["cafe_name"].fillna("").str.contains(VENDING_RE)
    in_district = cafes_joined["district"].notna()

    clean_mask = is_operational & has_reviews & not_vending & in_district
    cafes_clean = cafes_joined[clean_mask].copy()
    print(f"  after cleaning: {len(cafes_clean)} cafes")

    # --- 3. Load and spatial-join POI layers --------------------------------------
    poi_counts_per_district: dict[str, pd.Series] = {}
    for layer_name, path in POI_LAYERS.items():
        df = pd.read_csv(path)
        gdf = to_gdf(df)

        if layer_name == "transport_hubs":
            # Keep only meaningful hubs (bus/train/light_rail), drop generic stops
            mask = gdf["google_types"].fillna("").str.contains(
                r"bus_station|train_station|light_rail_station", regex=True
            )
            gdf = gdf[mask]

        joined = gpd.sjoin(
            gdf, districts[["district", "geometry"]], how="inner", predicate="within"
        )
        counts = joined.groupby("district").size()
        poi_counts_per_district[layer_name] = counts
        print(f"  POI '{layer_name}': {len(gdf)} → {len(joined)} after Riga filter")

    # --- 4. Per-district cafe metrics ---------------------------------------------
    global_avg_rating = cafes_clean["rating"].mean()
    print(f"\nGlobal mean rating (clean): {global_avg_rating:.3f}")

    grouped = cafes_clean.groupby("district")
    district_cafe_stats = pd.DataFrame({
        "total_cafes": grouped.size(),
        "avg_rating": grouped["rating"].mean(),
        "total_reviews": grouped["user_ratings_total"].sum(),
        "avg_price_level": grouped["price_level"].mean(),
        "pct_with_website": grouped["website"].apply(lambda s: 100 * s.notna().sum() / len(s)),
    })

    # --- 5. Build the per-district frame ------------------------------------------
    df = districts[["district", "area_km2"]].drop(columns="geometry", errors="ignore").copy()
    df = df.merge(district_cafe_stats, on="district", how="left")
    df["total_cafes"] = df["total_cafes"].fillna(0).astype(int)
    df["total_reviews"] = df["total_reviews"].fillna(0).astype(int)

    for layer_name, counts in poi_counts_per_district.items():
        df[f"poi_{layer_name}"] = df["district"].map(counts).fillna(0).astype(int)
    df["poi_total"] = sum(df[f"poi_{k}"] for k in POI_LAYERS)

    # density: per km²
    df["cafes_per_km2"] = df["total_cafes"] / df["area_km2"].clip(lower=0.01)
    df["poi_per_km2"] = df["poi_total"] / df["area_km2"].clip(lower=0.01)

    # --- 6. Compute scores --------------------------------------------------------
    df["competition_norm"] = normalize(df["cafes_per_km2"])
    df["demand_norm"] = normalize(df["poi_per_km2"])

    # Bayesian-smoothed quality: districts with few cafes pulled toward global mean
    df["quality_smoothed"] = (
        (df["avg_rating"].fillna(global_avg_rating) * df["total_cafes"]
         + global_avg_rating * BAYES_PRIOR)
        / (df["total_cafes"] + BAYES_PRIOR)
    )
    # rescale 1-5 to 0-1
    df["quality_norm"] = (df["quality_smoothed"] - 1) / 4

    df["opportunity_norm"] = (
        WEIGHTS["demand"] * df["demand_norm"]
        + WEIGHTS["competition"] * (1 - df["competition_norm"])
        + WEIGHTS["quality"] * df["quality_norm"]
    )

    # 0-10 scale for the UI
    for col in ["competition", "demand", "quality", "opportunity"]:
        df[f"{col}_score"] = (df[f"{col}_norm"] * 10).round(1)

    # --- 7. Cluster + confidence flag ---------------------------------------------
    df["cluster"] = df.apply(classify_cluster, axis=1)
    df["low_confidence"] = df["total_cafes"] < LOW_CONFIDENCE_CAFES

    # --- 8. Output districts.json -------------------------------------------------
    def slugify(name: str) -> str:
        # ASCII-safe id for URL routing
        s = name.lower()
        replacements = {
            "ā": "a", "č": "c", "ē": "e", "ģ": "g", "ī": "i", "ķ": "k",
            "ļ": "l", "ņ": "n", "š": "s", "ū": "u", "ž": "z",
        }
        for k, v in replacements.items():
            s = s.replace(k, v)
        return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

    df["id"] = df["district"].apply(slugify)
    df = df.sort_values("opportunity_score", ascending=False).reset_index(drop=True)

    districts_payload = []
    for _, row in df.iterrows():
        districts_payload.append({
            "id": row["id"],
            "name": row["district"],
            "cluster": row["cluster"],
            "lowConfidence": bool(row["low_confidence"]),
            "areaKm2": round(row["area_km2"], 2),
            "cafeCount": int(row["total_cafes"]),
            "avgRating": round(row["avg_rating"], 2) if pd.notna(row["avg_rating"]) else None,
            "totalReviews": int(row["total_reviews"]),
            "cafesPerKm2": round(row["cafes_per_km2"], 2),
            "poiTotal": int(row["poi_total"]),
            "poiPerKm2": round(row["poi_per_km2"], 2),
            "poiBreakdown": {
                k: int(row[f"poi_{k}"]) for k in POI_LAYERS
            },
            "competitionScore": float(row["competition_score"]),
            "demandScore": float(row["demand_score"]),
            "qualityScore": float(row["quality_score"]),
            "opportunityScore": float(row["opportunity_score"]),
        })

    out_districts = OUT / "districts.json"
    out_districts.write_text(json.dumps(districts_payload, ensure_ascii=False, indent=2))
    print(f"\nWrote {out_districts.relative_to(ROOT)}: {len(districts_payload)} districts")

    # --- 9. Output cafes.json -----------------------------------------------------
    cafes_payload = []
    district_to_id = dict(zip(df["district"], df["id"]))
    for _, row in cafes_clean.iterrows():
        cafes_payload.append({
            "id": row["place_id"],
            "name": row["cafe_name"],
            "lat": float(row["latitude"]),
            "lng": float(row["longitude"]),
            "rating": float(row["rating"]) if pd.notna(row["rating"]) else None,
            "reviews": int(row["user_ratings_total"]) if pd.notna(row["user_ratings_total"]) else 0,
            "priceLevel": int(row["price_level"]) if pd.notna(row["price_level"]) else None,
            "address": row.get("formatted_address") or row.get("vicinity") or "",
            "website": row["website"] if pd.notna(row.get("website")) else None,
            "googleMapsUrl": row.get("google_maps_url"),
            "districtId": district_to_id.get(row["district"]),
            "districtName": row["district"],
        })

    out_cafes = OUT / "cafes.json"
    out_cafes.write_text(json.dumps(cafes_payload, ensure_ascii=False, indent=2))
    print(f"Wrote {out_cafes.relative_to(ROOT)}: {len(cafes_payload)} cafes")

    # --- 10. Copy GeoJSON, attaching district id for frontend join ----------------
    geo_out = json.loads(GEOJSON.read_text())
    for feat in geo_out["features"]:
        feat["properties"]["id"] = slugify(feat["properties"]["name"])
    out_geo = OUT / "districts.geojson"
    out_geo.write_text(json.dumps(geo_out, ensure_ascii=False))
    print(f"Wrote {out_geo.relative_to(ROOT)}: {len(geo_out['features'])} polygons")

    # --- 11. Summary --------------------------------------------------------------
    print("\n--- Top 5 by opportunity (high-confidence only) ---")
    top = df[~df["low_confidence"]].head(5)
    print(top[["district", "cluster", "total_cafes", "opportunity_score",
              "competition_score", "demand_score", "quality_score"]].to_string(index=False))

    print(f"\nDistricts with low_confidence (cafes < {LOW_CONFIDENCE_CAFES}): "
          f"{int(df['low_confidence'].sum())} / {len(df)}")


if __name__ == "__main__":
    main()
