import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, TrendingUp, Users } from 'lucide-react';
import { useData } from '../data';

export default function Landing() {
  const { data, loading } = useData();
  const totalDistricts = data?.districts.length ?? 0;
  const totalCafes = data?.cafes.length ?? 0;
  const totalPois = data?.districts.reduce((acc, d) => acc + d.poiTotal, 0) ?? 0;

  return (
    <div className="w-full pb-20">
      {/* Hero */}
      <div className="bg-coffee-900 text-coffee-50 pt-20 pb-24 px-6 md:px-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-1/2 h-full opacity-10 pointer-events-none">
           <svg viewBox="0 0 100 100" className="w-full h-full">
             <circle cx="80" cy="20" r="30" fill="currentColor" />
             <rect x="10" y="50" width="40" height="40" transform="rotate(45 30 70)" fill="currentColor" />
           </svg>
        </div>

        <div className="max-w-4xl mx-auto relative z-10">
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
            Atrodi piemērotāko rajonu savai <span className="text-amber-400">specialty kafejnīcai</span>.
          </h1>
          <p className="text-xl md:text-2xl text-coffee-200 mb-10 max-w-2xl font-light">
            Datu analīze par konkurenci, pieprasījumu un iespējām visos {totalDistricts || "Rīgas"} rajonos. Beidz minēt — sāc analizēt.
          </p>

          <div className="flex flex-wrap gap-4">
            <Link
              to="/explore"
              className="bg-amber-500 hover:bg-amber-400 text-coffee-950 font-bold py-4 px-8 rounded-full transition-transform hover:scale-105 flex items-center gap-2 shadow-lg shadow-amber-900/50"
            >
              Pārlūkot rajonus <ArrowRight size={20} />
            </Link>
            <Link
              to="/recommendations"
              className="bg-transparent border-2 border-coffee-200 text-coffee-100 hover:bg-white/10 font-semibold py-4 px-8 rounded-full transition-colors"
            >
              Skatīt ieteikumus
            </Link>
          </div>
        </div>
      </div>

      {/* Statistikas kartes */}
      <div className="max-w-6xl mx-auto px-6 -mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 relative z-20">
        <StatCard icon={MapPin} value={loading ? "…" : totalDistricts} label="Analizētie rajoni" tone="amber" />
        <StatCard icon={Users} value={loading ? "…" : totalPois.toLocaleString()} label="Pieprasījuma punkti (POI)" tone="emerald" />
        <StatCard icon={TrendingUp} value={loading ? "…" : `${totalCafes}+`} label="Kafejnīcas (darbojošās, ≥5 atsauksmes)" tone="indigo" />
      </div>

      {/* Vērtības piedāvājums */}
      <div className="max-w-5xl mx-auto mt-24 px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-coffee-900 mb-4">Kāpēc dati ir svarīgi kafejnīcai</h2>
          <p className="text-stone-600 max-w-2xl mx-auto">
            Specialty kafejnīcas atvēršana ir augsta riska investīcija. Mēs izvērtējam katru rajonu pēc konkurences, pieprasījuma un kvalitātes, lai izvēle būtu apzināta.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-8">
            <Step n={1} title="Atrodi brīvās nišas" body="Atrod rajonus ar augstu pieprasījumu (biroji, studenti, apskates objekti), bet zemu konkurences blīvumu." />
            <Step n={2} title="Salīdzini ar pilsētas vidējo" body="Salīdzini potenciālās lokācijas ar pilsētas vidējiem rādītājiem pēc vērtējumiem un klientu plūsmas." />
            <Step n={3} title="Godīgi ticamības signāli" body="Rajoni ar pārāk maz kafejnīcām tiek atzīmēti, lai viena outlier kafejnīca neizkropļotu ieteikumus." />
          </div>
          <div className="bg-coffee-100 rounded-3xl p-8 aspect-square flex items-center justify-center relative">
             <div className="absolute inset-4 border-2 border-dashed border-coffee-300 rounded-2xl"></div>
             <div className="text-center">
                <span className="block text-6xl mb-2">☕</span>
                <span className="font-serif text-2xl text-coffee-800 italic">"Lokācija, lokācija<br/>un dati."</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, value, label, tone }: { icon: any; value: string | number; label: string; tone: "amber" | "emerald" | "indigo" }) {
  const toneClasses: Record<string, string> = {
    amber: "bg-amber-100 text-amber-800",
    emerald: "bg-emerald-100 text-emerald-800",
    indigo: "bg-indigo-100 text-indigo-800",
  };
  return (
    <div className="bg-white p-8 rounded-2xl shadow-xl border border-stone-100 flex flex-col items-center text-center hover:translate-y-[-4px] transition-transform">
      <div className={`p-4 rounded-full mb-4 ${toneClasses[tone]}`}>
        <Icon size={32} />
      </div>
      <h3 className="text-4xl font-bold text-stone-900 mb-2">{value}</h3>
      <p className="text-stone-500 font-medium uppercase tracking-wide text-sm">{label}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-12 h-12 rounded-lg bg-stone-200 flex items-center justify-center shrink-0 font-bold text-xl text-stone-600">{n}</div>
      <div>
        <h4 className="text-xl font-bold text-coffee-900">{title}</h4>
        <p className="text-stone-600 mt-2">{body}</p>
      </div>
    </div>
  );
}
