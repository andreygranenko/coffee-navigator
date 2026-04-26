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
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

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
# noisy raw layer + Gemini classification → real office buildings only
BUSINESS_CENTERS_CSV = RAW / "riga_business_centers_20251026_122518.csv"
BUSINESS_CENTERS_CLASSIFICATION = ROOT / "data" / "derived" / "business_centers_classification.json"

VENDING_RE = re.compile(r"vending|automāt|automat", re.IGNORECASE)
MIN_REVIEWS = 5
LOW_CONFIDENCE_CAFES = 10
BAYES_PRIOR = 5  # smoothing weight for district quality score

WEIGHTS = {"demand": 0.4, "competition": 0.3, "quality": 0.3}

# K-Means: features used for unsupervised clustering of districts.
CLUSTER_FEATURES = [
    "cafes_per_km2",
    "poi_per_km2",
    "offices_per_km2",
    "quality_smoothed",
    "pct_with_website",
    "avg_price_level",
    "share_universities",
    "share_parks",
    "share_attractions",
    "share_transport",
    "share_offices",
]
N_CLUSTERS = 5
RANDOM_STATE = 42


def to_gdf(df: pd.DataFrame) -> gpd.GeoDataFrame:
    geom = [Point(xy) for xy in zip(df["longitude"], df["latitude"])]
    return gpd.GeoDataFrame(df, geometry=geom, crs="EPSG:4326")


def normalize(s: pd.Series) -> pd.Series:
    """Min-max to [0, 1]. Empty/constant series → 0."""
    if s.empty or s.max() == s.min():
        return pd.Series([0.0] * len(s), index=s.index)
    return (s - s.min()) / (s.max() - s.min())


def name_clusters(centroids: pd.DataFrame) -> dict[int, str]:
    """Name K-Means centroids by their dominant traits.

    Strategy: claim each archetype only when the centroid actually exhibits
    its signature (e.g. Tourist Center requires `share_attractions > 0.5`),
    otherwise leave that archetype unused. Whatever is unclaimed becomes
    "Mixed Urban" or "Suburban" based on density.

    Returns {cluster_id: name}.
    """
    names: dict[int, str] = {}
    claimed: set[int] = set()

    def claim(name: str, scores: pd.Series, threshold_check) -> None:
        candidates = scores.drop(index=list(claimed))
        if candidates.empty:
            return
        winner = int(candidates.idxmax())
        if threshold_check(centroids.loc[winner]):
            names[winner] = name
            claimed.add(winner)

    # 1. Tourist Center — needs an actual concentration of attractions.
    claim(
        "Tourist Center",
        centroids["share_attractions"],
        lambda c: c["share_attractions"] >= 0.5,
    )
    # 2. Business Hub — only if the cluster actually has offices.
    claim(
        "Business Hub",
        _zscore(centroids["offices_per_km2"]) + _zscore(centroids["share_offices"]),
        lambda c: c["offices_per_km2"] >= 0.5 or c["share_offices"] >= 0.2,
    )
    # 3. Student / Hipster — needs a real university footprint.
    claim(
        "Student / Hipster",
        centroids["share_universities"],
        lambda c: c["share_universities"] >= 0.15 and c["poi_per_km2"] >= 1.0,
    )
    # 4. For whatever is left, use density to distinguish urban vs suburban.
    #    Highest cafe density of remaining → Mixed Urban (Centrs-like).
    #    Lowest POI density → Suburban / Green.
    remaining = [i for i in centroids.index if i not in claimed]
    if remaining:
        rem_centroids = centroids.loc[remaining]
        # Most urban remainder
        urban_winner = int(rem_centroids["cafes_per_km2"].idxmax())
        names[urban_winner] = "Mixed Urban"
        claimed.add(urban_winner)
    for i in centroids.index:
        if i in claimed:
            continue
        c = centroids.loc[i]
        # Park-dominated AND low density → Green / Parks
        if c["share_parks"] >= 0.4 and c["poi_per_km2"] < 5:
            names[int(i)] = "Green / Parks"
        else:
            names[int(i)] = "Suburban"
        claimed.add(int(i))
    return names


def _zscore(s: pd.Series) -> pd.Series:
    if s.std() == 0:
        return pd.Series([0.0] * len(s), index=s.index)
    return (s - s.mean()) / s.std()


def assign_clusters(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Run K-Means on `CLUSTER_FEATURES` and return (df_with_cluster, centroids).

    The returned centroids frame is in the *original* (unscaled) feature space
    so we can interpret it directly.
    """
    X = df[CLUSTER_FEATURES].fillna(0).to_numpy()
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    km = KMeans(n_clusters=N_CLUSTERS, random_state=RANDOM_STATE, n_init=10)
    labels = km.fit_predict(X_scaled)

    centroids_unscaled = pd.DataFrame(
        scaler.inverse_transform(km.cluster_centers_),
        columns=CLUSTER_FEATURES,
    )
    name_map = name_clusters(centroids_unscaled)

    df = df.copy()
    df["cluster_id"] = labels
    df["cluster"] = df["cluster_id"].map(name_map)
    centroids_unscaled["cluster"] = centroids_unscaled.index.map(name_map)
    return df, centroids_unscaled


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

    # --- 2b. Office buildings (Gemini-cleaned) ------------------------------------
    office_counts: pd.Series = pd.Series(dtype=int)
    if BUSINESS_CENTERS_CLASSIFICATION.exists():
        classification = json.loads(BUSINESS_CENTERS_CLASSIFICATION.read_text())
        office_ids = {pid for pid, v in classification.items() if v.get("is_office")}
        bc_raw = pd.read_csv(BUSINESS_CENTERS_CSV)
        bc_offices = bc_raw[bc_raw["place_id"].isin(office_ids)].dropna(
            subset=["latitude", "longitude"]
        )
        bc_gdf = to_gdf(bc_offices)
        bc_joined = gpd.sjoin(
            bc_gdf, districts[["district", "geometry"]], how="inner", predicate="within"
        )
        office_counts = bc_joined.groupby("district").size()
        print(f"Offices (Gemini-classified): {len(bc_offices)} → {len(bc_joined)} after Riga filter")
    else:
        print(f"WARNING: {BUSINESS_CENTERS_CLASSIFICATION.name} missing — offices feature will be 0.")
        print("         Run scripts/clean_business_centers.py first for the real signal.")

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
    df["office_count"] = df["district"].map(office_counts).fillna(0).astype(int)

    # density: per km²
    df["cafes_per_km2"] = df["total_cafes"] / df["area_km2"].clip(lower=0.01)
    df["poi_per_km2"] = df["poi_total"] / df["area_km2"].clip(lower=0.01)
    df["offices_per_km2"] = df["office_count"] / df["area_km2"].clip(lower=0.01)

    # POI mix as shares — cluster features. Districts with zero POIs get 0 shares.
    poi_total_safe = df["poi_total"].clip(lower=1)
    df["share_universities"] = df["poi_universities"] / poi_total_safe
    df["share_parks"] = df["poi_parks"] / poi_total_safe
    df["share_attractions"] = df["poi_tourist_attractions"] / poi_total_safe
    df["share_transport"] = df["poi_transport_hubs"] / poi_total_safe
    # Office share is computed against (POIs + offices) — separate denominator
    # so we capture how office-heavy a district is regardless of generic POIs.
    total_with_offices = (df["poi_total"] + df["office_count"]).clip(lower=1)
    df["share_offices"] = df["office_count"] / total_with_offices
    # Backfill cafe-derived columns with neutral defaults so K-Means doesn't
    # see NaN in low-data districts.
    df["pct_with_website"] = df["pct_with_website"].fillna(0)
    df["avg_price_level"] = df["avg_price_level"].fillna(2.0)

    # --- 6. Compute scores --------------------------------------------------------
    df["competition_norm"] = normalize(df["cafes_per_km2"])
    # Demand combines generic POIs (foot traffic) and offices (daily commuters).
    # Equal weight is a deliberate MVP choice; tunable later.
    df["demand_raw"] = df["poi_per_km2"] + df["offices_per_km2"]
    df["demand_norm"] = normalize(df["demand_raw"])

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

    # --- 7. K-Means clustering + confidence flag ----------------------------------
    df, centroids = assign_clusters(df)
    df["low_confidence"] = df["total_cafes"] < LOW_CONFIDENCE_CAFES

    print("\n--- K-Means cluster centroids (unscaled, all features) ---")
    print(centroids.round(2).to_string())
    print("\nCluster distribution:")
    print(df["cluster"].value_counts().to_string())

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
            "clusterId": int(row["cluster_id"]),
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
            "officeCount": int(row["office_count"]),
            "officesPerKm2": round(row["offices_per_km2"], 2),
            "competitionScore": float(row["competition_score"]),
            "demandScore": float(row["demand_score"]),
            "qualityScore": float(row["quality_score"]),
            "opportunityScore": float(row["opportunity_score"]),
        })

    out_districts = OUT / "districts.json"
    out_districts.write_text(json.dumps(districts_payload, ensure_ascii=False, indent=2))
    print(f"\nWrote {out_districts.relative_to(ROOT)}: {len(districts_payload)} districts")

    # Centroid summary — useful for the methodology page and debugging.
    centroid_payload = []
    for cid, row in centroids.iterrows():
        members = df[df["cluster_id"] == cid]["district"].tolist()
        centroid_payload.append({
            "clusterId": int(cid),
            "name": row["cluster"],
            "size": int(len(members)),
            "members": members,
            "centroid": {col: round(float(row[col]), 3) for col in CLUSTER_FEATURES},
        })
    out_clusters = OUT / "clusters.json"
    out_clusters.write_text(json.dumps(centroid_payload, ensure_ascii=False, indent=2))
    print(f"Wrote {out_clusters.relative_to(ROOT)}: {len(centroid_payload)} centroids")

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
