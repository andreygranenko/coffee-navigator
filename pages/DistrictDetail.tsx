import React from "react";
import { Link, useParams } from "react-router-dom";
import { useData } from "../data";
import { ArrowLeft, AlertCircle, Coffee, Star, Bus, ShoppingBag, Download, Heart } from "lucide-react";
import { getAuthToken } from "../auth";
import { clusterLv } from "../types";
import {
  BarChart, Bar, CartesianGrid, Tooltip, XAxis, YAxis, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";

export default function DistrictDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useData();
  const [reportLoading, setReportLoading] = React.useState(false);
  const [reportError, setReportError] = React.useState<string | null>(null);
  const [isFav, setIsFav] = React.useState(false);
  const [favLoading, setFavLoading] = React.useState(false);

  React.useEffect(() => {
    const token = getAuthToken();
    if (!token || !id) return;
    fetch("/api/favorites", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((ids: string[]) => setIsFav(ids.includes(id)))
      .catch(() => {});
  }, [id]);

  const toggleFavorite = async () => {
    const token = getAuthToken();
    if (!token || !id) return;
    setFavLoading(true);
    try {
      if (isFav) {
        await fetch(`/api/favorites/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        setIsFav(false);
      } else {
        await fetch("/api/favorites", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ districtId: id }),
        });
        setIsFav(true);
      }
    } catch {}
    setFavLoading(false);
  };

  if (error) return <div className="p-10 text-red-600">Failed to load data: {error}</div>;
  if (loading || !data) return <div className="p-10 text-stone-500">Loading…</div>;

  const district = data.districts.find((d) => d.id === id);
  if (!district) return <div className="p-10 text-center">District not found</div>;

  const cafes = data.cafes.filter((c) => c.districtId === id);
  const venues = data.venues.filter((v) => v.districtId === id);
  const dedicatedCafes = venues.filter((v) => v.amenity === "cafe");
  const otherVenues = venues.filter((v) => v.amenity !== "cafe");

  const cityAvg = {
    competition: avg(data.districts.map((d) => d.competitionScore)),
    demand: avg(data.districts.map((d) => d.demandScore)),
    quality: avg(data.districts.map((d) => d.qualityScore)),
    opportunity: avg(data.districts.map((d) => d.opportunityScore)),
  };

  const radarData = [
    { subject: "Konkurence", A: district.competitionScore, B: cityAvg.competition, fullMark: 10 },
    { subject: "Pieprasījums", A: district.demandScore, B: cityAvg.demand, fullMark: 10 },
    { subject: "Kvalitāte", A: district.qualityScore, B: cityAvg.quality, fullMark: 10 },
    { subject: "Iespējas", A: district.opportunityScore, B: cityAvg.opportunity, fullMark: 10 },
  ];

  const statData = [
    { name: "Konkurence", value: district.competitionScore, fill: "#f43f5e" },
    { name: "Pieprasījums", value: district.demandScore, fill: "#3b82f6" },
    { name: "Kvalitāte", value: district.qualityScore, fill: "#f59e0b" },
    { name: "Iespējas", value: district.opportunityScore, fill: "#10b981" },
  ];

  // Derived insight signals
  const fragmentation = marketFragmentation(district.ratingStdDev, district.cafeCount);
  const priceGap = priceGapSignal(district.avgPriceLevel, district.officesPerKm2);
  const transitGrade = transitAccessibility(district.transitPerKm2);

  const downloadReport = async () => {
    const token = getAuthToken();
    if (!token) {
      setReportError("Lūdzu, vispirms ielogojies.");
      return;
    }
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await fetch(`/api/reports/district/${district.id}.pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Kļūda (${res.status})`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${district.name.replace(/\s+/g, "_")}_Analize_${new Date().getFullYear()}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Sistēmas kļūda: Neizdevās ģenerēt PDF. Lūdzu, mēģiniet vēlāk.");
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-10 space-y-8">
      <div>
        <Link to="/explore" className="inline-flex items-center text-stone-500 hover:text-amber-600 mb-4 transition-colors">
          <ArrowLeft size={16} className="mr-1" /> Atpakaļ uz karti
        </Link>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold text-coffee-900">{district.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="px-3 py-1 bg-coffee-100 text-coffee-800 rounded-full text-sm font-medium">
                {clusterLv(district.cluster)}
              </span>
              {district.lowConfidence && (
                <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                  Mazs tirgus ({district.venueCount} objekti)
                </span>
              )}
              {!district.lowConfidence && district.lowQualitySample && (
                <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                  Kvalitātes vērtējums vājš ({district.qualitySampleSize} novērtētas kafejnīcas)
                </span>
              )}
              <span className="text-stone-400 text-sm">·</span>
              <span className="text-stone-500 font-medium">{district.areaKm2} km²</span>
            </div>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg border border-stone-200 shadow-sm text-center">
            <div className="text-xs text-stone-500 uppercase font-bold">Iespējas</div>
            <div className="text-2xl font-bold text-emerald-600">{district.opportunityScore}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          <button
            onClick={downloadReport}
            disabled={reportLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-coffee-800 text-white disabled:opacity-60"
          >
            <Download size={16} />
            {reportLoading ? "Ģenerē PDF..." : "Lejupielādēt PDF atskaiti"}
          </button>
          {getAuthToken() && (
            <button
              onClick={toggleFavorite}
              disabled={favLoading}
              title={isFav ? "Noņemt no izlases" : "Pievienot izlasei"}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors disabled:opacity-50 ${
                isFav
                  ? "bg-rose-50 border-rose-300 text-rose-600 hover:bg-rose-100"
                  : "bg-white border-stone-300 text-stone-600 hover:border-rose-300 hover:text-rose-500"
              }`}
            >
              <Heart size={16} fill={isFav ? "currentColor" : "none"} />
              {isFav ? "Izlasē" : "Pievienot izlasei"}
            </button>
          )}
          {reportError && <div className="text-red-600 text-sm w-full">{reportError}</div>}
        </div>
      </div>

      {/* Key metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card icon={Coffee} label="Kafijas objekti" value={district.venueCount} unit="kopā"
          sub={`${district.venuesPerKm2} uz km² · ${district.cafeCount} novērtētas kafejnīcas`} />
        <Card icon={Star} label="Vid. vērtējums"
          value={district.avgRating != null ? district.avgRating.toFixed(1) : "—"} unit="/5.0"
          sub={`${district.totalReviews.toLocaleString()} atsauksmes · σ=${district.ratingStdDev != null ? district.ratingStdDev.toFixed(2) : "—"}`} />
        <Card icon={AlertCircle} label="Tirgus stāvoklis" value={
          district.competitionScore > 7 ? "Piesātināts"
          : district.competitionScore < 3 ? "Nepietiekami apkalpots"
          : "Līdzsvarots"
        } unit="" sub={`Pamatojoties uz ${district.venuesPerKm2} kafijas objektiem uz km²`} />
      </div>

      {/* Non-obvious insights row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InsightCard
          label="Kvalitātes niša"
          title={fragmentation.label}
          detail={fragmentation.detail}
          color={fragmentation.color}
          icon="📊"
        />
        <InsightCard
          label="Cenu niša"
          title={priceGap.label}
          detail={priceGap.detail}
          color={priceGap.color}
          icon="💰"
        />
        <InsightCard
          label="Transporta pieejamība"
          title={transitGrade.label}
          detail={transitGrade.detail}
          color={transitGrade.color}
          icon="🚌"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
          <h3 className="text-lg font-bold text-coffee-900 mb-6">Rajons pret pilsētas vidējo</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "#78716c", fontSize: 12 }} />
                <PolarRadiusAxis angle={30} domain={[0, 10]} tick={false} axisLine={false} />
                <Radar name={district.name} dataKey="A" stroke="#8d6e63" fill="#8d6e63" fillOpacity={0.5} />
                <Radar name="Pilsētas vid." dataKey="B" stroke="#9ca3af" fill="#9ca3af" fillOpacity={0.1} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }} itemStyle={{ color: "#3e2723", fontSize: "12px" }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
          <h3 className="text-lg font-bold text-coffee-900 mb-6">Rādītāju profils</h3>
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

      {/* POI breakdown + demand signals */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
        <h3 className="text-lg font-bold text-coffee-900 mb-4">Pieprasījuma signāli</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center mb-4">
          <PoiBox label="Universitātes" v={district.poiBreakdown.universities} />
          <PoiBox label="Parki" v={district.poiBreakdown.parks} />
          <PoiBox label="Apskates objekti" v={district.poiBreakdown.tourist_attractions} />
          <PoiBox label="Biroji" v={district.officeCount} sub={`${district.officesPerKm2}/km²`} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-center border-t border-stone-100 pt-4">
          <PoiBox label="Transporta pieturas" v={district.transitCount} sub={`${district.transitPerKm2}/km²`} icon={<Bus size={14} className="inline mr-1 text-blue-400" />} />
          <PoiBox label="Lielveikali" v={district.mallCount} sub="tirdzniecības centri un lielveikali" icon={<ShoppingBag size={14} className="inline mr-1 text-purple-400" />} />
          <PoiBox label="Transporta mezgli" v={district.poiBreakdown.transport_hubs} sub="galvenās stacijas" />
        </div>
      </div>

      {/* Venue breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* All OSM venues */}
        {venues.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
            <div className="p-6 pb-3 flex items-baseline gap-3">
              <h3 className="text-lg font-bold text-coffee-900">Visi kafijas objekti</h3>
              <span className="text-xs text-stone-400 font-medium">{dedicatedCafes.length} kafejnīcas · {otherVenues.length} restorāni/ātrā ēd.</span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-stone-500 uppercase text-xs sticky top-0">
                  <tr>
                    <th className="px-6 py-2 text-left">Nosaukums</th>
                    <th className="px-6 py-2 text-right">Tips</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {[...dedicatedCafes, ...otherVenues].map((v) => (
                    <tr key={v.id} className="hover:bg-stone-50">
                      <td className="px-6 py-2 text-coffee-900">{v.name ?? <span className="text-stone-400 italic">Bez nosaukuma</span>}</td>
                      <td className="px-6 py-2 text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          v.amenity === "cafe" ? "bg-amber-100 text-amber-800"
                          : v.amenity === "restaurant" ? "bg-orange-100 text-orange-700"
                          : "bg-stone-100 text-stone-600"
                        }`}>
                          {AMENITY_LV_DETAIL[v.amenity] ?? v.amenity.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Google-rated cafes with full detail */}
        {cafes.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
            <div className="p-6 pb-3 flex items-baseline gap-3">
              <h3 className="text-lg font-bold text-coffee-900">Novērtētās kafejnīcas</h3>
              <span className="text-xs text-stone-400 font-medium">Google Places · {cafes.length} ar atsauksmēm</span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-stone-500 uppercase text-xs sticky top-0">
                  <tr>
                    <th className="px-6 py-2 text-left">Nosaukums</th>
                    <th className="px-6 py-2 text-right">Vērtējums</th>
                    <th className="px-6 py-2 text-right">Atsauksmes</th>
                    <th className="px-6 py-2 text-right">Cena</th>
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
                        <td className="px-6 py-2 text-right text-stone-400">{c.priceLevel ? "€".repeat(c.priceLevel) : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Palīgkonstantes ───────────────────────────────────────────────────────────

const AMENITY_LV_DETAIL: Record<string, string> = {
  cafe: "Kafejnīca",
  restaurant: "Restorāns",
  fast_food: "Ātrā ēdināšana",
};

// ── Ieskatu palīgfunkcijas ────────────────────────────────────────────────────

function marketFragmentation(stdDev: number | null, cafeCount: number) {
  if (cafeCount < 3 || stdDev == null) {
    return { label: "Nepietiekami dati", detail: "Pārāk maz kafejnīcu, lai novērtētu kvalitātes sadalījumu.", color: "stone" };
  }
  if (stdDev < 0.3) {
    return { label: "Viendabīga kvalitāte", detail: `Zema dispersija (σ=${stdDev.toFixed(2)}) — esošās kafejnīcas ir līdzīgas pēc kvalitātes. Grūti izcelties tikai ar kvalitāti.`, color: "blue" };
  }
  if (stdDev < 0.6) {
    return { label: "Jaukta kvalitāte", detail: `Vidēja izkliede (σ=${stdDev.toFixed(2)}) — tirgū ir nepilnības. Augstas kvalitātes pretendents varētu izcelties.`, color: "amber" };
  }
  return { label: "Sadrumstalots tirgus", detail: `Augsta dispersija (σ=${stdDev.toFixed(2)}) — liela kvalitātes atšķirība starp esošajām kafejnīcām. Spēcīga iespēja premium ieejošajam.`, color: "emerald" };
}

function priceGapSignal(avgPrice: number | null, officesPerKm2: number) {
  if (avgPrice == null) {
    return { label: "Nav cenu datu", detail: "Esošajām kafejnīcām trūkst Google cenu līmeņa atzīmju.", color: "stone" };
  }
  const priceLabel = avgPrice < 1.5 ? "Lēts (€)" : avgPrice < 2.5 ? "Vidējs (€€)" : "Premium (€€€)";
  if (avgPrice < 1.5 && officesPerKm2 > 3) {
    return { label: "Cenu niša: premium", detail: `Vid. ${priceLabel}, bet ${officesPerKm2.toFixed(1)} biroji/km² — biroja darbinieki parasti tērē vairāk. Iespēja vidēja/premium specialty kafejnīcai.`, color: "emerald" };
  }
  if (avgPrice >= 2.5) {
    return { label: "Premium segments", detail: `Vid. ${priceLabel} — esošās kafejnīcas ir dārgas. Iespēja pieejamākai specialty alternatīvai.`, color: "amber" };
  }
  return { label: priceLabel, detail: `Vidējais cenu līmenis ${avgPrice.toFixed(1)}/4.0, ${officesPerKm2.toFixed(1)} biroji/km².`, color: "blue" };
}

function transitAccessibility(transitPerKm2: number) {
  if (transitPerKm2 > 15) {
    return { label: "Lieliska pieejamība", detail: `${transitPerKm2.toFixed(1)} pieturas/km² — ļoti augsta klientu plūsma no ceļotājiem un transporta lietotājiem visu dienu.`, color: "emerald" };
  }
  if (transitPerKm2 > 7) {
    return { label: "Laba pieejamība", detail: `${transitPerKm2.toFixed(1)} pieturas/km² — labs transporta pārklājums. Regulāra ikdienas plūsma no autobusu un tramvaju pasažieriem.`, color: "blue" };
  }
  if (transitPerKm2 > 2) {
    return { label: "Vidēja pieejamība", detail: `${transitPerKm2.toFixed(1)} pieturas/km² — nedaudz transporta, galvenokārt uz auto orientēts. Ierobežo spontāno klientu plūsmu.`, color: "amber" };
  }
  return { label: "Zema pieejamība", detail: `${transitPerKm2.toFixed(1)} pieturas/km² — galvenokārt atkarīgs no automašīnas. Būtiski ierobežo gājēju plūsmu.`, color: "red" };
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

const COLOR_MAP: Record<string, string> = {
  emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
  amber: "bg-amber-50 border-amber-200 text-amber-800",
  blue: "bg-blue-50 border-blue-200 text-blue-800",
  red: "bg-red-50 border-red-200 text-red-800",
  stone: "bg-stone-50 border-stone-200 text-stone-600",
};

function InsightCard({ label, title, detail, color, icon }: { label: string; title: string; detail: string; color: string; icon: string }) {
  const cls = COLOR_MAP[color] ?? COLOR_MAP.stone;
  return (
    <div className={`p-4 rounded-xl border ${cls}`}>
      <div className="text-xs font-bold uppercase tracking-wide opacity-70 mb-1">{icon} {label}</div>
      <div className="font-semibold text-sm mb-1">{title}</div>
      <p className="text-xs leading-relaxed opacity-80">{detail}</p>
    </div>
  );
}

function PoiBox({ label, v, sub, icon }: { label: string; v: number; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="p-4 bg-stone-50 rounded-lg">
      <div className="text-2xl font-bold text-coffee-900">{v}</div>
      <div className="text-xs text-stone-500 uppercase tracking-wide">{icon}{label}</div>
      {sub && <div className="text-xs text-stone-400 mt-0.5">{sub}</div>}
    </div>
  );
}
