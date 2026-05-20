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
import numpy as np
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
# Primary office source: OSM Overpass export (see scripts/fetch_osm_offices.py)
OSM_OFFICES_CSV = ROOT / "data" / "derived" / "osm_offices_riga.csv"
# Transit stops (bus, tram, rail) and retail anchors from OSM
OSM_TRANSIT_CSV = ROOT / "data" / "derived" / "osm_transit_riga.csv"
OSM_MALLS_CSV = ROOT / "data" / "derived" / "osm_malls_riga.csv"
# Broad competition layer: cafes + restaurants + fast_food (coffee-service venues)
OSM_HOSPITALITY_CSV = ROOT / "data" / "derived" / "osm_hospitality_riga.csv"
# Legacy fallback: noisy Google Places business_centers + Gemini classification
BUSINESS_CENTERS_CSV = RAW / "riga_business_centers_20251026_122518.csv"
BUSINESS_CENTERS_CLASSIFICATION = ROOT / "data" / "derived" / "business_centers_classification.json"
EXCLUDED_OFFICE_TYPES = {
    "government",
    "diplomatic",
    "ngo",
    "religion",
    "political_party",
}

VENDING_RE = re.compile(r"vending|automāt|automat", re.IGNORECASE)
MIN_REVIEWS = 5
LOW_CONFIDENCE_VENUES = 5   # OSM venue count threshold — reflects true market presence
LOW_QUALITY_SAMPLE = 3      # Google Places rated cafes below this → quality score unreliable
BAYES_PRIOR = 5  # smoothing weight for district quality score

WEIGHTS = {"demand": 0.4, "competition": 0.3, "quality": 0.3}

# K-Means: features used for unsupervised clustering of districts.
CLUSTER_FEATURES = [
    "venues_per_km2",   # OSM cafe+restaurant+fast_food — complete competition signal
    "poi_per_km2",
    "offices_per_km2",
    "quality_smoothed",
    "pct_with_website",
    "avg_price_level",
    "share_universities",
    "share_parks",
    "share_attractions",
    "transit_per_km2",   # OSM bus/tram stops (replaces low-signal Google transport_hubs)
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


def log_normalize(s: pd.Series) -> pd.Series:
    """Log1p then min-max to [0, 1]. Reduces outlier suppression.

    Without this, Centrs/Vecrīga dominate the linear scale and compress
    every other district toward 0 — e.g. Skanste demand 1.4 instead of ~6.
    """
    return normalize(np.log1p(s))


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
    # 2. Business Hub — rank by raw offices_per_km2 (not combined z-score).
    # share_offices alone inflates for low-POI industrial districts where offices
    # happen to be the only POI type; absolute density is the reliable signal.
    claim(
        "Business Hub",
        centroids["offices_per_km2"],
        lambda c: c["offices_per_km2"] >= 5.0,
    )
    # 3. Student / Hipster — needs a genuine university footprint (>= 0.25 share).
    claim(
        "Student / Hipster",
        centroids["share_universities"],
        lambda c: c["share_universities"] >= 0.25 and c["poi_per_km2"] >= 1.0,
    )
    # 4. For whatever is left, use density to distinguish urban vs suburban.
    #    Highest cafe density of remaining → Mixed Urban (Centrs-like).
    #    Lowest POI density → Suburban / Green.
    remaining = [i for i in centroids.index if i not in claimed]
    if remaining:
        rem_centroids = centroids.loc[remaining]
        # Most urban remainder
        urban_winner = int(rem_centroids["venues_per_km2"].idxmax())
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

    # --- 2b. Office buildings -------------------------------------------------------
    office_counts: pd.Series = pd.Series(dtype=int)
    if OSM_OFFICES_CSV.exists():
        osm_raw = pd.read_csv(OSM_OFFICES_CSV).dropna(subset=["latitude", "longitude"])
        office_tag = osm_raw.get("office", pd.Series(index=osm_raw.index, dtype=str)).fillna("").str.strip().str.lower()
        building_tag = osm_raw.get("building", pd.Series(index=osm_raw.index, dtype=str)).fillna("").str.strip().str.lower()
        # Keep office-like POIs and explicit office buildings, drop public-sector-heavy noise.
        keep_mask = (~office_tag.isin(EXCLUDED_OFFICE_TYPES)) & ((office_tag != "") | (building_tag == "office"))
        osm_offices = osm_raw[keep_mask].copy()
        osm_gdf = to_gdf(osm_offices)
        osm_joined = gpd.sjoin(
            osm_gdf, districts[["district", "geometry"]], how="inner", predicate="within"
        )
        office_counts = osm_joined.groupby("district").size()
        print(f"Offices (OSM filtered): {len(osm_offices)} → {len(osm_joined)} after Riga filter")
    elif BUSINESS_CENTERS_CLASSIFICATION.exists():
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
        print(f"Offices (Gemini fallback): {len(bc_offices)} → {len(bc_joined)} after Riga filter")
    else:
        print(f"WARNING: {OSM_OFFICES_CSV.name} missing and Gemini fallback unavailable — offices feature will be 0.")
        print("         Run scripts/fetch_osm_offices.py (preferred) or scripts/clean_business_centers.py.")

    # --- 2c. Transit stops (OSM bus/tram/rail) ------------------------------------
    transit_counts: pd.Series = pd.Series(dtype=int)
    if OSM_TRANSIT_CSV.exists():
        transit_raw = pd.read_csv(OSM_TRANSIT_CSV).dropna(subset=["latitude", "longitude"])
        # Keep only physical boarding stops — exclude route-only nodes (platforms tagged separately)
        stop_mask = transit_raw["stop_type"].isin(
            ["bus_stop", "tram_stop", "station", "halt", "bus_station"]
        )
        transit_clean = transit_raw[stop_mask].copy()
        transit_gdf = to_gdf(transit_clean)
        transit_joined = gpd.sjoin(
            transit_gdf, districts[["district", "geometry"]], how="inner", predicate="within"
        )
        transit_counts = transit_joined.groupby("district").size()
        print(f"Transit stops (OSM): {len(transit_clean)} → {len(transit_joined)} after Riga filter")
    else:
        print(f"WARNING: {OSM_TRANSIT_CSV.name} missing — run scripts/fetch_osm_transit_malls.py")

    # --- 2d. Retail anchors (OSM malls / shopping centres / supermarkets) ---------
    mall_counts: pd.Series = pd.Series(dtype=int)
    if OSM_MALLS_CSV.exists():
        malls_raw = pd.read_csv(OSM_MALLS_CSV).dropna(subset=["latitude", "longitude"])
        malls_gdf = to_gdf(malls_raw)
        malls_joined = gpd.sjoin(
            malls_gdf, districts[["district", "geometry"]], how="inner", predicate="within"
        )
        mall_counts = malls_joined.groupby("district").size()
        print(f"Retail anchors (OSM): {len(malls_raw)} → {len(malls_joined)} after Riga filter")
    else:
        print(f"WARNING: {OSM_MALLS_CSV.name} missing — run scripts/fetch_osm_transit_malls.py")

    # --- 2e. OSM hospitality — broad competition layer ----------------------------
    # amenity=cafe + restaurant + fast_food covers all realistic coffee-service venues.
    # Used for competition scoring; Google Places cafes still drive quality scoring.
    hospitality_counts: pd.Series = pd.Series(dtype=int)
    hosp_joined_df: pd.DataFrame | None = None   # kept for venues.json output
    if OSM_HOSPITALITY_CSV.exists():
        hosp_raw = pd.read_csv(OSM_HOSPITALITY_CSV).dropna(subset=["latitude", "longitude"])
        hosp_gdf = to_gdf(hosp_raw)
        hosp_joined = gpd.sjoin(
            hosp_gdf, districts[["district", "geometry"]], how="inner", predicate="within"
        )
        hosp_joined_df = hosp_joined.copy()
        hospitality_counts = hosp_joined.groupby("district").size()
        print(f"Hospitality venues (OSM): {len(hosp_raw)} → {len(hosp_joined)} after Riga filter")
    else:
        print(f"WARNING: {OSM_HOSPITALITY_CSV.name} missing — run scripts/fetch_osm_hospitality.py")

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
        "rating_std_dev": grouped["rating"].std(),   # market fragmentation signal
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
    df["transit_count"] = df["district"].map(transit_counts).fillna(0).astype(int)
    df["mall_count"] = df["district"].map(mall_counts).fillna(0).astype(int)
    df["venue_count"] = df["district"].map(hospitality_counts).fillna(0).astype(int)

    # density: per km²
    df["cafes_per_km2"] = df["total_cafes"] / df["area_km2"].clip(lower=0.01)
    df["poi_per_km2"] = df["poi_total"] / df["area_km2"].clip(lower=0.01)
    df["offices_per_km2"] = df["office_count"] / df["area_km2"].clip(lower=0.01)
    df["transit_per_km2"] = df["transit_count"] / df["area_km2"].clip(lower=0.01)
    df["venues_per_km2"] = df["venue_count"] / df["area_km2"].clip(lower=0.01)

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
    # Competition: OSM venues/km² (cafe+restaurant+fast_food) — falls back to
    # Google Places cafes if OSM data is unavailable. Log-scaled to prevent
    # Vecrīga/Centrs from compressing all other districts toward zero.
    competition_base = df["venues_per_km2"] if df["venue_count"].sum() > 0 else df["cafes_per_km2"]
    df["competition_norm"] = log_normalize(competition_base)

    # Demand: POI density + office density. Log-scaled for same outlier reason.
    df["demand_raw"] = df["poi_per_km2"] + df["offices_per_km2"]
    df["demand_norm"] = log_normalize(df["demand_raw"])

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
    # Confidence now based on OSM venue count (complete) not Google Places cafe count (biased).
    # Quality sample tracks rated cafes separately — quality can be uncertain even in a
    # high-venue district (e.g. Skanste: 17 venues but only 1 Google-rated cafe).
    df["low_confidence"] = df["venue_count"] < LOW_CONFIDENCE_VENUES
    df["low_quality_sample"] = df["total_cafes"] < LOW_QUALITY_SAMPLE

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
            "venueCount": int(row["venue_count"]),
            "venuesPerKm2": round(row["venues_per_km2"], 2),
            "transitCount": int(row["transit_count"]),
            "transitPerKm2": round(row["transit_per_km2"], 2),
            "mallCount": int(row["mall_count"]),
            "qualitySampleSize": int(row["total_cafes"]),   # rated Google Places cafes
            "lowQualitySample": bool(row["low_quality_sample"]),
            "ratingStdDev": round(row["rating_std_dev"], 2) if pd.notna(row.get("rating_std_dev")) else None,
            "avgPriceLevel": round(row["avg_price_level"], 2) if pd.notna(row.get("avg_price_level")) else None,
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

    # --- 10. Output venues.json — all OSM hospitality venues for map layer ---------
    venues_payload = []
    if hosp_joined_df is not None:
        for _, row in hosp_joined_df.iterrows():
            venues_payload.append({
                "id": str(row.get("osm_key", "")),
                "name": str(row["name"]) if pd.notna(row.get("name")) else None,
                "lat": float(row["latitude"]),
                "lng": float(row["longitude"]),
                "amenity": str(row.get("amenity", "")),
                "districtId": district_to_id.get(row.get("district", ""), None),
            })
    out_venues = OUT / "venues.json"
    out_venues.write_text(json.dumps(venues_payload, ensure_ascii=False, indent=2))
    print(f"Wrote {out_venues.relative_to(ROOT)}: {len(venues_payload)} venues")

    # --- 12. Copy GeoJSON, attaching district id for frontend join ----------------
    geo_out = json.loads(GEOJSON.read_text())
    for feat in geo_out["features"]:
        feat["properties"]["id"] = slugify(feat["properties"]["name"])
    out_geo = OUT / "districts.geojson"
    out_geo.write_text(json.dumps(geo_out, ensure_ascii=False))
    print(f"Wrote {out_geo.relative_to(ROOT)}: {len(geo_out['features'])} polygons")

    # --- 13. Summary --------------------------------------------------------------
    print("\n--- Top 5 by opportunity (high-confidence only) ---")
    top = df[~df["low_confidence"]].head(5)
    print(top[["district", "cluster", "total_cafes", "opportunity_score",
              "competition_score", "demand_score", "quality_score"]].to_string(index=False))

    print(f"\nDistricts low confidence (venues < {LOW_CONFIDENCE_VENUES}): "
          f"{int(df['low_confidence'].sum())} / {len(df)}")
    print(f"Districts low quality sample (rated cafes < {LOW_QUALITY_SAMPLE}): "
          f"{int(df['low_quality_sample'].sum())} / {len(df)}")


if __name__ == "__main__":
    main()
