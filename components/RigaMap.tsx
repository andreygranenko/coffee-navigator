import React, { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import type { CafeMarker, ColorMode, DistrictSummary, VenueMarker } from "../types";
import { clusterLv } from "../types";
import { getDistrictColor, type DistrictFeatureCollection } from "../data";

const VENUE_COLORS: Record<string, { fill: string; stroke: string }> = {
  cafe:        { fill: "#92400e", stroke: "#78350f" },   // coffee brown
  restaurant:  { fill: "#ea580c", stroke: "#c2410c" },   // orange
  fast_food:   { fill: "#6b7280", stroke: "#4b5563" },   // grey
};
const VENUE_DEFAULT = { fill: "#a78bfa", stroke: "#7c3aed" };

const AMENITY_LV: Record<string, string> = {
  cafe: "Kafejnīca",
  restaurant: "Restorāns",
  fast_food: "Ātrā ēdināšana",
};

const COLOR_MODE_LV: Record<string, string> = {
  opportunity: "Iespējas",
  competition: "Konkurence",
  demand: "Pieprasījums",
};

interface Props {
  districts: DistrictSummary[];
  geojson: DistrictFeatureCollection;
  cafes: CafeMarker[];
  venues: VenueMarker[];
  selectedId?: string;
  onDistrictClick: (id: string) => void;
  colorMode: ColorMode;
  showCafes?: boolean;
  showVenues?: boolean;
}

const RIGA_CENTER: [number, number] = [56.95, 24.11];
const RIGA_ZOOM = 11;

function MapSizeSync() {
  const map = useMap();
  useEffect(() => {
    const invalidate = () => map.invalidateSize();
    const t1 = window.setTimeout(invalidate, 0);
    const t2 = window.setTimeout(invalidate, 250);
    const t3 = window.setTimeout(invalidate, 700);
    window.addEventListener("resize", invalidate);
    const ro = new ResizeObserver(() => invalidate());
    ro.observe(map.getContainer());
    return () => {
      window.clearTimeout(t1); window.clearTimeout(t2); window.clearTimeout(t3);
      window.removeEventListener("resize", invalidate);
      ro.disconnect();
    };
  }, [map]);
  return null;
}

function scoreFor(d: DistrictSummary, mode: ColorMode): number {
  if (mode === "competition") return d.competitionScore;
  if (mode === "demand") return d.demandScore;
  return d.opportunityScore;
}

export default function RigaMap({
  districts, geojson, cafes, venues, selectedId,
  onDistrictClick, colorMode, showCafes = false, showVenues = false,
}: Props) {
  const districtsById = useMemo(() => {
    const map = new Map<string, DistrictSummary>();
    for (const d of districts) map.set(d.id, d);
    return map;
  }, [districts]);

  const styleKey = `${colorMode}-${selectedId ?? "none"}`;

  const layerStyle = (feature: any) => {
    const id = feature.properties.id;
    const d = districtsById.get(id);
    const isSelected = id === selectedId;
    if (!d) return { color: "#a8a29e", weight: 0.5, fillColor: "#f5f5f4", fillOpacity: 0.3 };
    const fill = getDistrictColor(scoreFor(d, colorMode), colorMode);
    return {
      color: isSelected ? "#3e2723" : d.lowConfidence ? "#a8a29e" : "#78716c",
      weight: isSelected ? 3 : 0.7,
      fillColor: fill,
      fillOpacity: d.lowConfidence ? 0.35 : 0.7,
      dashArray: d.lowConfidence ? "4 3" : undefined,
    };
  };

  const onEachFeature = (feature: any, layer: L.Layer) => {
    const id = feature.properties.id;
    const d = districtsById.get(id);
    layer.on("click", () => onDistrictClick(id));
    if (d) {
      const tip =
        `<b>${d.name}</b><br/>${clusterLv(d.cluster)}${d.lowConfidence ? " · maz datu" : ""}<br/>` +
        `Iespējas: <b>${d.opportunityScore}</b> · Objekti: ${d.venueCount}`;
      (layer as L.Path).bindTooltip(tip, { sticky: true, direction: "top" });
    }
  };

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden border border-stone-200">
      <MapContainer
        center={RIGA_CENTER} zoom={RIGA_ZOOM}
        style={{ width: "100%", height: "100%" }}
        scrollWheelZoom={true}
      >
        <MapSizeSync />
        <TileLayer
          attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GeoJSON key={styleKey} data={geojson as any} style={layerStyle} onEachFeature={onEachFeature} />

        {/* All OSM venues — colored by type */}
        {showVenues && venues.map((v) => {
          const colors = VENUE_COLORS[v.amenity] ?? VENUE_DEFAULT;
          return (
            <CircleMarker
              key={v.id}
              center={[v.lat, v.lng]}
              radius={3}
              pathOptions={{ color: colors.stroke, fillColor: colors.fill, weight: 0.8, fillOpacity: 0.75 }}
            >
              <Tooltip direction="top">
                <div className="text-xs">
                  <div className="font-semibold">{v.name ?? "Bez nosaukuma"}</div>
                  <div className="text-stone-500 capitalize">{AMENITY_LV[v.amenity] ?? v.amenity.replace("_", " ")}</div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {/* Google-rated cafes — shown on top, slightly larger with rating */}
        {showCafes && cafes.map((c) => (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lng]}
            radius={5}
            pathOptions={{ color: "#1c0a00", fillColor: "#fbbf24", weight: 1.5, fillOpacity: 0.95 }}
          >
            <Tooltip direction="top">
              <div className="text-xs">
                <div className="font-semibold">{c.name}</div>
                <div className="text-stone-500">{c.rating ?? "–"} ★ · {c.reviews} atsauksmes</div>
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 z-[1000] bg-white/90 backdrop-blur p-3 rounded-lg shadow-sm border border-stone-200 text-xs">
        <div className="font-semibold mb-2 capitalize">{COLOR_MODE_LV[colorMode] ?? colorMode}</div>
        <div className="flex flex-col gap-1">
          {[8, 5, 2].map((v, i) => (
            <div key={v} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ background: getDistrictColor(v, colorMode) }} />
              <span>{["Augsts", "Vidējs", "Zems"][i]}</span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ background: "#e7e5e4" }} />
            <span>Maz datu</span>
          </div>
        </div>
        {showVenues && (
          <div className="mt-2 pt-2 border-t border-stone-200 flex flex-col gap-1">
            {Object.entries(VENUE_COLORS).map(([type, c]) => (
              <div key={type} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: c.fill }} />
                <span>{AMENITY_LV[type] ?? type.replace("_", " ")}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full border-2 border-stone-800" style={{ background: "#fbbf24" }} />
              <span>Novērtēta kafejnīca (Google)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
