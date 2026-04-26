import React from "react";
import { Link, useParams } from "react-router-dom";
import { useData } from "../data";
import { ArrowLeft, AlertCircle, Coffee, Star } from "lucide-react";
import {
  BarChart, Bar, CartesianGrid, Tooltip, XAxis, YAxis, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";

export default function DistrictDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useData();

  if (error) return <div className="p-10 text-red-600">Failed to load data: {error}</div>;
  if (loading || !data) return <div className="p-10 text-stone-500">Loading…</div>;

  const district = data.districts.find((d) => d.id === id);
  if (!district) return <div className="p-10 text-center">District not found</div>;

  const cafes = data.cafes.filter((c) => c.districtId === id);

  const cityAvg = {
    competition: avg(data.districts.map((d) => d.competitionScore)),
    demand: avg(data.districts.map((d) => d.demandScore)),
    quality: avg(data.districts.map((d) => d.qualityScore)),
    opportunity: avg(data.districts.map((d) => d.opportunityScore)),
  };

  const radarData = [
    { subject: "Competition", A: district.competitionScore, B: cityAvg.competition, fullMark: 10 },
    { subject: "Demand", A: district.demandScore, B: cityAvg.demand, fullMark: 10 },
    { subject: "Quality", A: district.qualityScore, B: cityAvg.quality, fullMark: 10 },
    { subject: "Opportunity", A: district.opportunityScore, B: cityAvg.opportunity, fullMark: 10 },
  ];

  const statData = [
    { name: "Competition", value: district.competitionScore, fill: "#f43f5e" },
    { name: "Demand", value: district.demandScore, fill: "#3b82f6" },
    { name: "Quality", value: district.qualityScore, fill: "#f59e0b" },
    { name: "Oppty", value: district.opportunityScore, fill: "#10b981" },
  ];

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-10 space-y-8">
      <div>
        <Link to="/explore" className="inline-flex items-center text-stone-500 hover:text-amber-600 mb-4 transition-colors">
          <ArrowLeft size={16} className="mr-1" /> Back to Map
        </Link>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold text-coffee-900">{district.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="px-3 py-1 bg-coffee-100 text-coffee-800 rounded-full text-sm font-medium">
                {district.cluster}
              </span>
              {district.lowConfidence && (
                <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                  Low data ({district.cafeCount} cafes — outliers possible)
                </span>
              )}
              <span className="text-stone-400 text-sm">·</span>
              <span className="text-stone-500 font-medium">{district.areaKm2} km²</span>
            </div>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg border border-stone-200 shadow-sm text-center">
            <div className="text-xs text-stone-500 uppercase font-bold">Oppty Score</div>
            <div className="text-2xl font-bold text-emerald-600">{district.opportunityScore}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card icon={Coffee} label="Cafe Density" value={district.cafeCount} unit="total" sub={`${district.cafesPerKm2} per km²`} />
        <Card icon={Star} label="Avg Rating" value={district.avgRating ?? "—"} unit="/5.0" sub={`${district.totalReviews.toLocaleString()} reviews total`} />
        <Card icon={AlertCircle} label="Market Status" value={
          district.competitionScore > 7 ? "Saturated"
          : district.competitionScore < 3 ? "Underserved"
          : "Balanced"
        } unit="" sub="Based on cafe density per km²" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
          <h3 className="text-lg font-bold text-coffee-900 mb-6">District vs City Average</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "#78716c", fontSize: 12 }} />
                <PolarRadiusAxis angle={30} domain={[0, 10]} tick={false} axisLine={false} />
                <Radar name={district.name} dataKey="A" stroke="#8d6e63" fill="#8d6e63" fillOpacity={0.5} />
                <Radar name="City Avg" dataKey="B" stroke="#9ca3af" fill="#9ca3af" fillOpacity={0.1} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }} itemStyle={{ color: "#3e2723", fontSize: "12px" }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
          <h3 className="text-lg font-bold text-coffee-900 mb-6">Score Profile</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f5f5f4" />
                <XAxis type="number" domain={[0, 10]} hide />
                <YAxis dataKey="name" type="category" tick={{ fill: "#57534e", fontSize: 12, fontWeight: 500 }} width={90} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "#fafaf9" }} contentStyle={{ borderRadius: "8px" }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* POI breakdown */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
        <h3 className="text-lg font-bold text-coffee-900 mb-4">Points of Interest</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <PoiBox label="Universities" v={district.poiBreakdown.universities} />
          <PoiBox label="Parks" v={district.poiBreakdown.parks} />
          <PoiBox label="Attractions" v={district.poiBreakdown.tourist_attractions} />
          <PoiBox label="Transport hubs" v={district.poiBreakdown.transport_hubs} />
        </div>
      </div>

      {/* Cafe list */}
      {cafes.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
          <h3 className="text-lg font-bold text-coffee-900 p-6 pb-3">Cafes in {district.name} ({cafes.length})</h3>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 uppercase text-xs sticky top-0">
                <tr>
                  <th className="px-6 py-2 text-left">Name</th>
                  <th className="px-6 py-2 text-right">Rating</th>
                  <th className="px-6 py-2 text-right">Reviews</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {cafes
                  .slice()
                  .sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
                  .map((c) => (
                    <tr key={c.id} className="hover:bg-stone-50">
                      <td className="px-6 py-2">
                        {c.googleMapsUrl ? (
                          <a href={c.googleMapsUrl} target="_blank" rel="noreferrer" className="text-coffee-900 hover:text-amber-700">
                            {c.name}
                          </a>
                        ) : c.name}
                      </td>
                      <td className="px-6 py-2 text-right text-stone-600">{c.rating ?? "—"}</td>
                      <td className="px-6 py-2 text-right text-stone-500">{c.reviews}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function avg(arr: number[]): number {
  return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1));
}

function Card({ icon: Icon, label, value, unit, sub }: { icon: any; label: string; value: any; unit: string; sub: string }) {
  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
      <div className="flex items-center gap-3 mb-2 text-stone-500">
        <Icon size={20} />
        <span className="text-sm font-semibold uppercase">{label}</span>
      </div>
      <div className="text-3xl font-bold text-stone-900">
        {value} {unit && <span className="text-lg text-stone-400 font-normal">{unit}</span>}
      </div>
      <p className="text-sm text-stone-400 mt-1">{sub}</p>
    </div>
  );
}

function PoiBox({ label, v }: { label: string; v: number }) {
  return (
    <div className="p-4 bg-stone-50 rounded-lg">
      <div className="text-2xl font-bold text-coffee-900">{v}</div>
      <div className="text-xs text-stone-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}
