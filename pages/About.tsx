import React from "react";
import { useData } from "../data";

export default function About() {
  const { data } = useData();
  const total = data?.districts.length ?? 0;
  const high = data?.districts.filter((d) => !d.lowConfidence).length ?? 0;
  const cafes = data?.cafes.length ?? 0;

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-12">
      <h1 className="text-3xl font-bold text-coffee-900 mb-6">Par metodoloģiju</h1>

      <div className="prose prose-stone max-w-none">
        <p className="text-lg text-stone-600 leading-relaxed mb-8">
          <strong>Rīgas kafejnīcu navigators</strong> novērtē katru Rīgas rajonu pēc iespējām atvērt specialty kafejnīcu,
          izmantojot tikai publiskos datus. Šis ir MVP — mērķis ir godīgums, nevis maģija.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-bold text-coffee-800 mb-4">Datu avoti</h2>
          <ul className="list-disc pl-5 space-y-2 text-stone-600">
            <li><strong>Google Places API</strong> — adreses, vērtējumi un atsauksmju skaits visām kafejnīcām Rīgas robežās (pēc filtrēšanas: <strong>{cafes}</strong> darbojošās kafejnīcas ar ≥5 atsauksmēm).</li>
            <li><strong>OpenStreetMap rajonu robežas</strong> — {total} poligoni, kas aptver Rīgu, izmantoti telpiskajam savienojumam un km² aprēķinam.</li>
            <li><strong>Google Places (POI)</strong> — universitātes, parki, tūrisma objekti un transporta mezgli kā ikdienas pieprasījuma starpniecības rādītāji.</li>
            <li><strong>OpenStreetMap (Overpass)</strong> — biroju ēkas un biroju objekti rajona biroju blīvuma signālam.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-bold text-coffee-800 mb-4">Iespējas vērtējums</h2>
          <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
            <p className="text-stone-600 mb-4">
              Katrs rajons saņem četrus vērtējumus skalā 0–10. Katrs ievaddats tiek normalizēts min-max pāri visiem rajoniem,
              un galīgā formula ir:
            </p>
            <div className="font-mono bg-stone-100 p-4 rounded text-sm text-stone-800 overflow-x-auto">
              Iespējas = 0.4·Pieprasījums + 0.3·(1−Konkurence) + 0.3·Kvalitāte
            </div>
            <ul className="text-sm text-stone-600 mt-4 list-disc pl-5 space-y-1">
              <li><strong>Pieprasījums</strong> — POI uz km² plus biroju blīvums (no OSM). Logaritmiskā skala novērš pilsētas centra anomāliju iespiešanu visos pārējos rajonos pie nulles.</li>
              <li><strong>Konkurence</strong> — visi kafijas pakalpojumu objekti uz km² (OSM: kafejnīcas + restorāni + ātrā ēdināšana). Plašāks par "tikai kafejnīcas", jo restorāni un ātrā ēdināšana arī pasniedz kafiju. Logaritmiskā skala tā pati iemesla dēļ.</li>
              <li><strong>Kvalitāte</strong> — Bajesa izlīdzinātais vidējais vērtējums no Google Places (mazie rajoni tiek pievilkti pie pilsētas vidējā).</li>
            </ul>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-bold text-coffee-800 mb-4">Rajona tips (klasteris)</h2>
          <p className="text-stone-600">
            Rajonu arhetipus piešķir <strong>K-Means</strong> algoritms uz normalizētiem rajona raksturlielumiem
            (kafejnīcu blīvums, POI sadalījums, biroju blīvums, kvalitāte un digitālās gatavības rādītāji), pēc tam
            kartēti uz lasāmiem nosaukumiem kā <em>Tūristu zona</em>, <em>Studentu rajons</em>, <em>Biznesa centrs</em>,
            <em>Jaukts rajons</em> un <em>Zaļā zona</em>.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-bold text-coffee-800 mb-4">Ticamības karodziņi</h2>
          <p className="text-stone-600">
            No {total} rajoniem tikai <strong>{high}</strong> ir pietiekami daudz datu un tiek uzskatīti par
            augstas ticamības rajoniem rangos. Pārējie joprojām redzami kartē, atzīmēti pelēki, un izslēgti no
            "Top ieteikumiem" — viena 5 zvaigžņu mikrokafejnīca nedrīkst padarīt rajonu par labāko Rīgā.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-coffee-800 mb-4">Zināmie ierobežojumi</h2>
          <ul className="list-disc pl-5 space-y-2 text-stone-600">
            <li>Komerciālā nekustamā īpašuma / īres cenas modelī nav iekļautas.</li>
            <li>Biroju dati nāk no OpenStreetMap tagiem (kopienas rediģēti), tāpēc pārklājums un konsekvence var atšķirties pēc rajona.</li>
            <li>POI blīvums neņem vērā diennakts klientu plūsmu — biroju rajons pulksten 9 no rīta un tūrisma rajons pusdienlaikā šeit izskatās vienādi.</li>
            <li>Vērtējumi ir atpaliekoši signāli: tie atspoguļo esošās kafejnīcas, nevis neapmierināto pieprasījumu tieši.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
