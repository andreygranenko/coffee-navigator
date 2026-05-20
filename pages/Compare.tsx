import React, { useState, useMemo } from "react";
import { useData } from "../data";
import { clusterLv } from "../types";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Plus } from "lucide-react";

export default function Compare() {
  const { data, loading, error } = useData();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  React.useEffect(() => {
    if (data && selectedIds.length === 0) {
      const top = data.districts.filter((d) => !d.lowConfidence).slice(0, 2).map((d) => d.id);
      if (top.length >= 2) setSelectedIds(top);
    }
  }, [data, selectedIds.length]);

  const districtsById = useMemo(() => {
    const m = new Map<string, any>();
    data?.districts.forEach((d) => m.set(d.id, d));
    return m;
  }, [data]);

  if (error) return <div className="p-10 text-red-600">Kļūda: {error}</div>;
  if (loading || !data) return <div className="p-10 text-stone-500">Ielādē…</div>;

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev
    );
  };

  const comparisonData = selectedIds
    .map((id) => districtsById.get(id))
    .filter(Boolean)
    .map((d) => ({
      name: d.name,
      Konkurence: d.competitionScore,
      Pieprasījums: d.demandScore,
      Kvalitāte: d.qualityScore,
      Iespējas: d.opportunityScore,
    }));

  return (
    <div className="p-6 md:p-12 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-coffee-900 mb-2">Salīdzināt rajonus</h1>
        <p className="text-stone-500">Atlasi līdz 3 rajoniem, lai vizualizētu atšķirības.</p>
      </div>

      <div className="mb-10 overflow-x-auto pb-4">
        <div className="flex gap-3 min-w-max flex-wrap">
          {data.districts.map((d) => {
            const isSelected = selectedIds.includes(d.id);
            const disabled = !isSelected && selectedIds.length >= 3;
            return (
              <button
                key={d.id}
                onClick={() => toggle(d.id)}
                disabled={disabled}
                className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                  isSelected ? "bg-coffee-800 text-white border-coffee-800 shadow-md"
                  : disabled ? "opacity-40 cursor-not-allowed bg-stone-100 border-stone-200"
                  : "bg-white border-stone-300 hover:border-amber-500 hover:text-amber-800"
                }`}
              >
                {isSelected ? <Check size={14} /> : <Plus size={14} />}
                <span className="text-sm font-medium">
                  {d.name}
                  {d.lowConfidence && <span className="ml-1 text-[9px] text-amber-500 font-bold">·MAZ</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedIds.length === 0 ? (
        <div className="text-center py-20 bg-stone-50 rounded-2xl border border-dashed border-stone-300">
          <p className="text-stone-400">Atlasi rajonus augstāk, lai sāktu salīdzinājumu</p>
        </div>
      ) : (
        <div className="space-y-12">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100 h-96">
            <h3 className="text-lg font-bold text-coffee-900 mb-6">Rādītāju salīdzinājums</h3>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                <XAxis dataKey="name" tick={{ fill: "#57534e" }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 10]} hide />
                <Tooltip cursor={{ fill: "#fafaf9" }} contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }} />
                <Legend />
                <Bar dataKey="Iespējas" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Pieprasījums" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Konkurence" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Kvalitāte" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-stone-200 shadow-sm">
            <table className="w-full bg-white text-sm text-left">
              <thead className="bg-stone-50 text-stone-500 uppercase font-bold text-xs">
                <tr>
                  <th className="px-6 py-4">Rādītājs</th>
                  {selectedIds.map((id) => (
                    <th key={id} className="px-6 py-4 text-coffee-900">{districtsById.get(id)?.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                <Row label="Klasteris">{(d) => clusterLv(d.cluster)}</Row>
                <Row label="Kafejnīcas kopā">{(d) => d.cafeCount}</Row>
                <Row label="Vid. vērtējums">{(d) => d.avgRating ?? "—"}</Row>
                <Row label="Blīvums (kafejnīcas/km²)">{(d) => d.cafesPerKm2}</Row>
                <Row label="POI blīvums (uz km²)">{(d) => d.poiPerKm2}</Row>
                <Row label="Datu ticamība">{(d) => (d.lowConfidence ? "Zema (maz kafejnīcu)" : "Augsta")}</Row>
                <tr className="bg-emerald-50/50">
                  <td className="px-6 py-4 font-bold text-emerald-800">Iespējas vērtējums</td>
                  {selectedIds.map((id) => (
                    <td key={id} className="px-6 py-4 font-bold text-emerald-600 text-lg">
                      {districtsById.get(id)?.opportunityScore}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  function Row({ label, children }: { label: string; children: (d: any) => React.ReactNode }) {
    return (
      <tr>
        <td className="px-6 py-4 font-medium text-stone-900">{label}</td>
        {selectedIds.map((id) => {
          const d = districtsById.get(id);
          return <td key={id} className="px-6 py-4 text-stone-600">{d ? children(d) : "—"}</td>;
        })}
      </tr>
    );
  }
}
