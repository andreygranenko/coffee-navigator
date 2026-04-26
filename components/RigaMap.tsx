import React, { useMemo } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip } from "react-leaflet";
import L from "leaflet";
import type { CafeMarker, ColorMode, DistrictSummary } from "../types";
import { getDistrictColor, type DistrictFeatureCollection } from "../data";

interface Props {
  districts: DistrictSummary[];
  geojson: DistrictFeatureCollection;
  cafes: CafeMarker[];
  selectedId?: string;
  onDistrictClick: (id: string) => void;
  colorMode: ColorMode;
  showCafes?: boolean;
}

const RIGA_CENTER: [number, number] = [56.95, 24.11];
const RIGA_ZOOM = 11;

function scoreFor(d: DistrictSummary, mode: ColorMode): number {
  if (mode === "competition") return d.competitionScore;
  if (mode === "demand") return d.demandScore;
  return d.opportunityScore;
}

export default function RigaMap({
  districts,
  geojson,
  cafes,
  selectedId,
  onDistrictClick,
  colorMode,
  showCafes = false,
}: Props) {
  const districtsById = useMemo(() => {
    const map = new Map<string, DistrictSummary>();
    for (const d of districts) map.set(d.id, d);
    return map;
  }, [districts]);

  // remount GeoJSON when style inputs change so colors refresh
  const styleKey = `${colorMode}-${selectedId ?? "none"}`;

  const layerStyle = (feature: any) => {
    const id = feature.properties.id;
    const d = districtsById.get(id);
    const isSelected = id === selectedId;
    if (!d) {
      return {
        color: "#a8a29e",
        weight: 0.5,
        fillColor: "#f5f5f4",
        fillOpacity: 0.3,
      };
    }
    const fill = d.lowConfidence
      ? "#e7e5e4"
      : getDistrictColor(scoreFor(d, colorMode), colorMode);
    return {
      color: isSelected ? "#3e2723" : "#78716c",
      weight: isSelected ? 3 : 0.7,
      fillColor: fill,
      fillOpacity: d.lowConfidence ? 0.4 : 0.7,
    };
  };

  const onEachFeature = (feature: any, layer: L.Layer) => {
    const id = feature.properties.id;
    const d = districtsById.get(id);
    layer.on("click", () => onDistrictClick(id));
    if (d) {
      const tip =
        `<b>${d.name}</b><br/>${d.cluster}${d.lowConfidence ? " · low data" : ""}<br/>` +
        `Opportunity: <b>${d.opportunityScore}</b> · Cafes: ${d.cafeCount}`;
      (layer as L.Path).bindTooltip(tip, { sticky: true, direction: "top" });
    }
  };

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden border border-stone-200">
      <MapContainer
        center={RIGA_CENTER}
        zoom={RIGA_ZOOM}
        style={{ width: "100%", height: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        <GeoJSON
          key={styleKey}
          data={geojson as any}
          style={layerStyle}
          onEachFeature={onEachFeature}
        />
        {showCafes &&
          cafes.map((c) => (
            <CircleMarker
              key={c.id}
              center={[c.lat, c.lng]}
              radius={4}
              pathOptions={{
                color: "#5d4037",
                fillColor: "#a1887f",
                weight: 1,
                fillOpacity: 0.85,
              }}
            >
              <Tooltip direction="top">
                <div className="text-xs">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-stone-500">
                    {c.rating ?? "–"} ★ · {c.reviews} reviews
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
      </MapContainer>

      {/* Legend overlay */}
      <div className="absolute bottom-4 right-4 z-[1000] bg-white/90 backdrop-blur p-3 rounded-lg shadow-sm border border-stone-200 text-xs">
        <div className="font-semibold mb-2 capitalize">{colorMode} Level</div>
        <div className="flex flex-col gap-1">
          {[8, 5, 2].map((v, i) => (
            <div key={v} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded"
                style={{ background: getDistrictColor(v, colorMode) }}
              />
              <span>{["High", "Medium", "Low"][i]}</span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ background: "#e7e5e4" }} />
            <span>Low data</span>
          </div>
        </div>
      </div>
    </div>
  );
}
