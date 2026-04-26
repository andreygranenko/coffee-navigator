import React, { useMemo, useState } from "react";
import { useData } from "../data";
import RigaMap from "../components/RigaMap";
import { ChevronRight, Search, X } from "lucide-react";
import type { ColorMode, DistrictSummary } from "../types";

export default function Explore() {
  const { data, loading, error } = useData();
  const [selectedDistrictId, setSelectedDistrictId] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("opportunity");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCafes, setShowCafes] = useState(false);
  const [hideLowConfidence, setHideLowConfidence] = useState(false);
  const [filters, setFilters] = useState({ minOpportunity: 0, maxCompetition: 10 });

  const districts = data?.districts ?? [];
  const cafes = data?.cafes ?? [];
  const geojson = data?.geojson;

  const filteredDistricts = useMemo(() => {
    return districts.filter((d) =>
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      d.opportunityScore >= filters.minOpportunity &&
      d.competitionScore <= filters.maxCompetition &&
      (!hideLowConfidence || !d.lowConfidence)
    );
  }, [districts, searchQuery, filters, hideLowConfidence]);

  const selectedDistrict = districts.find((d) => d.id === selectedDistrictId);

  const cafesInSelected = useMemo(
    () => (selectedDistrict ? cafes.filter((c) => c.districtId === selectedDistrict.id) : []),
    [cafes, selectedDistrict]
  );

  if (error) {
    return <div className="p-10 text-center text-red-600">Failed to load data: {error}</div>;
  }
  if (loading || !geojson) {
    return <div className="p-10 text-center text-stone-500">Loading data…</div>;
  }

  return (
    <div className="flex h-[calc(100vh-64px)] md:h-screen overflow-hidden flex-col md:flex-row">
      {/* Sidebar */}
      <div className="w-full md:w-96 bg-white border-r border-stone-200 flex flex-col h-1/2 md:h-full z-10 shadow-xl">
        <div className="p-4 border-b border-stone-100 bg-white space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-stone-400" size={18} />
            <input
              type="text"
              placeholder="Search districts..."
              className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex gap-2 text-xs">
            <div className="flex flex-col flex-1 gap-1">
              <label className="text-stone-500 font-medium">Min Opportunity ({filters.minOpportunity})</label>
              <input
                type="range" min="0" max="10" step="0.5"
                value={filters.minOpportunity}
                onChange={(e) => setFilters((p) => ({ ...p, minOpportunity: Number(e.target.value) }))}
                className="accent-amber-600 h-1 bg-stone-200 rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <div className="flex flex-col flex-1 gap-1">
              <label className="text-stone-500 font-medium">Max Competition ({filters.maxCompetition})</label>
              <input
                type="range" min="0" max="10" step="0.5"
                value={filters.maxCompetition}
                onChange={(e) => setFilters((p) => ({ ...p, maxCompetition: Number(e.target.value) }))}
                className="accent-stone-600 h-1 bg-stone-200 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>

          <div className="flex gap-3 text-xs text-stone-600">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={hideLowConfidence} onChange={(e) => setHideLowConfidence(e.target.checked)} />
              Hide low-data
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showCafes} onChange={(e) => setShowCafes(e.target.checked)} />
              Show cafes
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-stone-50/50">
          {filteredDistricts.length === 0 ? (
            <div className="p-8 text-center text-stone-400">
              <p>No districts match your criteria.</p>
              <button
                onClick={() => { setFilters({ minOpportunity: 0, maxCompetition: 10 }); setSearchQuery(""); }}
                className="text-amber-600 text-sm mt-2 font-medium hover:underline"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            filteredDistricts.map((d) => <DistrictCard key={d.id} d={d} selected={selectedDistrictId === d.id} onClick={() => setSelectedDistrictId(d.id)} />)
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative bg-stone-100 h-1/2 md:h-full">
        <div className="absolute top-4 left-4 z-[1000] bg-white/90 backdrop-blur rounded-lg shadow-sm border border-stone-200 p-1 flex gap-1">
          {(["opportunity", "competition", "demand"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setColorMode(m)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                colorMode === m
                  ? m === "opportunity" ? "bg-emerald-100 text-emerald-800"
                    : m === "competition" ? "bg-rose-100 text-rose-800"
                    : "bg-blue-100 text-blue-800"
                  : "hover:bg-stone-100 text-stone-600"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="w-full h-full p-4 md:p-8">
          <RigaMap
            districts={districts}
            geojson={geojson}
            cafes={cafes}
            selectedId={selectedDistrictId || undefined}
            onDistrictClick={(id) => setSelectedDistrictId(id === selectedDistrictId ? null : id)}
            colorMode={colorMode}
            showCafes={showCafes}
          />
        </div>

        {selectedDistrict && (
          <div className="absolute bottom-0 md:bottom-8 md:right-8 w-full md:w-80 bg-white rounded-t-2xl md:rounded-2xl shadow-2xl border border-stone-200 p-6 z-[1000]" style={{ animation: "slideUp 0.3s ease-out" }}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-coffee-900">{selectedDistrict.name}</h2>
                <p className="text-stone-500 text-sm">
                  {selectedDistrict.cluster}
                  {selectedDistrict.lowConfidence && <span className="ml-2 text-amber-600 text-xs font-medium">· low data</span>}
                </p>
              </div>
              <button onClick={() => setSelectedDistrictId(null)} className="text-stone-400 hover:text-stone-600 p-1">
                <X size={20} />
              </button>
            </div>

            <ScoreBar label="Competition" value={selectedDistrict.competitionScore} color="rose" />
            <ScoreBar label="Demand" value={selectedDistrict.demandScore} color="blue" />
            <ScoreBar label="Quality" value={selectedDistrict.qualityScore} color="amber" />

            <div className="mt-6 pt-4 border-t border-stone-100 grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-coffee-800">{selectedDistrict.cafeCount}</div>
                <div className="text-xs text-stone-500 uppercase">Cafes</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-coffee-800">
                  {selectedDistrict.avgRating ?? "–"}
                </div>
                <div className="text-xs text-stone-500 uppercase">Avg Rating</div>
              </div>
            </div>

            {cafesInSelected.length > 0 && (
              <div className="mt-4 max-h-32 overflow-y-auto text-xs text-stone-600 border-t border-stone-100 pt-3">
                <div className="font-semibold text-stone-500 mb-1 uppercase text-[10px] tracking-wide">Top cafes</div>
                {cafesInSelected
                  .slice()
                  .sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
                  .slice(0, 5)
                  .map((c) => (
                    <div key={c.id} className="flex justify-between gap-2 py-0.5">
                      <span className="truncate">{c.name}</span>
                      <span className="text-stone-400 shrink-0">{c.rating ?? "–"}★</span>
                    </div>
                  ))}
              </div>
            )}

            <a href={`#/district/${selectedDistrict.id}`} className="block mt-6 w-full py-3 bg-coffee-800 hover:bg-coffee-900 text-white text-center rounded-lg font-medium transition-colors text-sm">
              View Full District Passport
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function DistrictCard({ d, selected, onClick }: { d: DistrictSummary; selected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`p-4 rounded-xl cursor-pointer border transition-all duration-200 ${
        selected
          ? "bg-white border-amber-500 shadow-md ring-1 ring-amber-500/20"
          : "bg-white border-stone-200 hover:border-amber-300 hover:shadow-sm"
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-bold text-coffee-900 flex items-center gap-1">
          {d.name}
          {d.lowConfidence && <span className="text-[9px] text-amber-700 font-semibold">·LOW DATA</span>}
        </h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${
          d.cluster.includes("Business") ? "bg-indigo-100 text-indigo-700"
          : d.cluster.includes("Tourist") ? "bg-rose-100 text-rose-700"
          : d.cluster.includes("Student") ? "bg-emerald-100 text-emerald-700"
          : "bg-stone-100 text-stone-600"
        }`}>
          {d.cluster}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-stone-500">
        <div>
          <span className="block font-semibold text-stone-900">{d.cafeCount}</span>
          Cafes
        </div>
        <div className="w-px h-6 bg-stone-200"></div>
        <div>
          <span className="block font-semibold text-stone-900">{d.opportunityScore}</span>
          Oppty. Score
        </div>
        <div className="ml-auto">
          <ChevronRight size={16} className={`transition-transform ${selected ? "rotate-90" : "text-stone-300"}`} />
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: "rose" | "blue" | "amber" }) {
  const palette: Record<string, string> = {
    rose: "bg-rose-400",
    blue: "bg-blue-400",
    amber: "bg-amber-400",
  };
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs font-semibold uppercase text-stone-400 mb-1">
        <span>{label}</span>
        <span>{value}/10</span>
      </div>
      <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
        <div className={`h-full ${palette[color]} rounded-full`} style={{ width: `${value * 10}%` }} />
      </div>
    </div>
  );
}
