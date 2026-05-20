import { useEffect, useState } from "react";
import { getAuthToken } from "./auth";
import type { CafeMarker, DistrictSummary, VenueMarker } from "./types";

// Minimal GeoJSON type — leaflet's GeoJSON layer accepts the raw object.
export interface DistrictFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { id: string; name: string; [k: string]: unknown };
    geometry: { type: string; coordinates: unknown };
  }>;
}

interface DataBundle {
  districts: DistrictSummary[];
  cafes: CafeMarker[];
  venues: VenueMarker[];
  geojson: DistrictFeatureCollection;
}

let cache: Promise<DataBundle> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) throw new Error("Unauthorized. Please log in.");
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return res.json();
}

async function loadAll(): Promise<DataBundle> {
  const [districts, cafes, venues, geojson] = await Promise.all([
    fetchJson("/api/districts"),
    fetchJson("/api/cafes"),
    fetchJson("/api/venues"),
    fetchJson("/api/geo/districts"),
  ]);
  return { districts, cafes, venues, geojson };
}

export function useData() {
  const [data, setData] = useState<DataBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cache) cache = loadAll();
    cache.then(setData).catch((e) => setError(String(e)));
  }, []);

  return { data, error, loading: !data && !error };
}

export function getDistrictColor(score: number, mode: "opportunity" | "competition" | "demand"): string {
  // score is 0-10
  if (mode === "opportunity") {
    if (score >= 7) return "#10b981";
    if (score >= 5) return "#34d399";
    if (score >= 3) return "#a7f3d0";
    return "#e5e7eb";
  }
  if (mode === "competition") {
    if (score >= 7) return "#ef4444";
    if (score >= 4) return "#fca5a5";
    return "#fee2e2";
  }
  // demand
  if (score >= 7) return "#3b82f6";
  if (score >= 4) return "#93c5fd";
  return "#dbeafe";
}
