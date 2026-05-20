import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useData } from "../data";
import { clusterLv } from "../types";

export default function Recommendations() {
  const { data, loading, error } = useData();

  const top = useMemo(() => {
    if (!data) return [];
    return data.districts
      .filter((d) => !d.lowConfidence)
      .slice()
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 5);
  }, [data]);

  if (error) return <div className="p-10 text-red-600">Kļūda ielādējot datus: {error}</div>;
  if (loading || !data) return <div className="p-10 text-stone-500">Ielādē…</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-12">
      <div className="mb-10 text-center">
        <h1 className="text-3xl md:text-4xl font-extrabold text-coffee-900 mb-4">Ieteicamākie rajoni</h1>
        <p className="text-stone-600 max-w-2xl mx-auto">
          Sarindoti pēc iespējas vērtējuma — pieprasījuma, zemas konkurences un kafejnīcu kvalitātes balanss. Rajoni ar pārāk maz kafejnīcām izslēgti godīguma dēļ.
        </p>
      </div>

      <div className="space-y-6">
        {top.map((d, idx) => (
          <div key={d.id} className="bg-white rounded-2xl shadow-lg border border-stone-100 overflow-hidden hover:shadow-xl transition-shadow flex flex-col md:flex-row">
            <div className="bg-coffee-900 w-full md:w-32 p-6 flex flex-col items-center justify-center text-white shrink-0">
              <div className="text-xs uppercase font-bold tracking-widest text-coffee-300 mb-1">Vieta</div>
              <div className="text-5xl font-black">#{idx + 1}</div>
            </div>

            <div className="p-6 md:p-8 flex-1">
              <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-coffee-900 hover:text-amber-700 transition-colors">
                    <Link to={`/district/${d.id}`}>{d.name}</Link>
                  </h2>
                  <span className="inline-block mt-2 px-3 py-1 bg-stone-100 text-stone-600 rounded-full text-xs font-bold uppercase tracking-wide">
                    {clusterLv(d.cluster)}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-xs text-stone-500 font-bold uppercase">Iespējas vērtējums</div>
                  <div className="text-2xl font-bold text-emerald-600">{d.opportunityScore}/10</div>
                </div>
              </div>

              <p className="text-stone-600 mb-6 bg-stone-50 p-4 rounded-lg border border-stone-100 italic">
                {explain(d)}
              </p>

              <div className="grid grid-cols-3 gap-4">
                <Pill label="Konkurence" value={d.competitionScore} tone="red" />
                <Pill label="Pieprasījums" value={d.demandScore} tone="blue" />
                <Pill label="Kvalitāte" value={d.qualityScore} tone="amber" />
              </div>

              <div className="mt-6 flex justify-end">
                <Link to={`/district/${d.id}`} className="text-sm font-bold text-coffee-700 hover:text-coffee-900 flex items-center gap-1 group">
                  Skatīt rajona pasi <span className="group-hover:translate-x-1 transition-transform">→</span>
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function explain(d: { competitionScore: number; demandScore: number; qualityScore: number; cluster: string }): string {
  const bits: string[] = [];
  if (d.competitionScore < 4) bits.push("zema konkurence");
  else if (d.competitionScore > 7) bits.push("augsta konkurence (piesātinājuma risks)");
  if (d.demandScore > 6) bits.push("spēcīgs POI pieprasījums");
  if (d.qualityScore > 7) bits.push("esošās kafejnīcas saglabā augstus vērtējumus");
  else if (d.qualityScore < 5) bits.push("kvalitātes niša, ko izmantot");
  const cluster = clusterLv(d.cluster).toLowerCase();
  return `${cluster.charAt(0).toUpperCase() + cluster.slice(1)} rajons ar šādām īpašībām: ${bits.join(", ") || "līdzsvarotas īpašības"}.`;
}

function Pill({ label, value, tone }: { label: string; value: number; tone: "red" | "blue" | "amber" }) {
  const map: Record<string, string> = {
    red: "bg-red-50 text-red-900",
    blue: "bg-blue-50 text-blue-900",
    amber: "bg-amber-50 text-amber-900",
  };
  return (
    <div className={`flex flex-col items-center p-3 rounded-lg ${map[tone]}`}>
      <div className="text-xs font-bold uppercase mb-1 opacity-70">{label}</div>
      <div className="font-semibold">{value} <span className="opacity-60 text-xs">/10</span></div>
    </div>
  );
}
