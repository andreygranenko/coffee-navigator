import React from "react";
import { useData } from "../data";

export default function About() {
  const { data } = useData();
  const total = data?.districts.length ?? 0;
  const high = data?.districts.filter((d) => !d.lowConfidence).length ?? 0;
  const cafes = data?.cafes.length ?? 0;

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-12">
      <h1 className="text-3xl font-bold text-coffee-900 mb-6">About the Methodology</h1>

      <div className="prose prose-stone max-w-none">
        <p className="text-lg text-stone-600 leading-relaxed mb-8">
          The <strong>Riga Coffee Navigator</strong> scores each Riga district on opportunity to open
          a specialty cafe, using only public data. This is an MVP — the goal is honest, not magical.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-bold text-coffee-800 mb-4">Data Sources</h2>
          <ul className="list-disc pl-5 space-y-2 text-stone-600">
            <li><strong>Google Places API</strong> — locations, ratings, review counts for all cafes within Riga's polygon boundaries (after filtering: <strong>{cafes}</strong> operational cafes with ≥5 reviews).</li>
            <li><strong>OpenStreetMap district boundaries</strong> — {total} polygons covering Riga, used for spatial join and km² calculation.</li>
            <li><strong>Google Places (POIs)</strong> — universities, parks, tourist attractions and bus/train transport hubs as proxies for daily demand.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-bold text-coffee-800 mb-4">The Opportunity Score</h2>
          <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
            <p className="text-stone-600 mb-4">
              Each district gets four scores in 0–10. Each input is min-max normalized across all districts,
              and the final formula is:
            </p>
            <div className="font-mono bg-stone-100 p-4 rounded text-sm text-stone-800 overflow-x-auto">
              Opportunity = 0.4·Demand + 0.3·(1−Competition) + 0.3·Quality
            </div>
            <ul className="text-sm text-stone-600 mt-4 list-disc pl-5 space-y-1">
              <li><strong>Demand</strong> — POIs per km² (universities, parks, attractions, transport hubs).</li>
              <li><strong>Competition</strong> — cafes per km².</li>
              <li><strong>Quality</strong> — Bayesian-smoothed avg rating (small districts pulled toward city mean).</li>
            </ul>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-bold text-coffee-800 mb-4">Cluster Type</h2>
          <p className="text-stone-600">
            Rule-based for MVP (not K-Means yet). A district is classified <em>Tourist Center</em>,
            <em> Student / Hipster</em>, <em>Business Hub</em>, <em>Residential</em>, or <em>Mixed</em>
            from the dominant POI mix and density.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-bold text-coffee-800 mb-4">Confidence Flags</h2>
          <p className="text-stone-600">
            Out of {total} districts, only <strong>{high}</strong> have ≥10 cafes and are treated as
            high-confidence in the rankings. The rest are still shown on the map, marked grey, and
            excluded from "Top picks" — a single 5-star micro-cafe shouldn't make a district the
            best in Riga.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-coffee-800 mb-4">Known Limitations</h2>
          <ul className="list-disc pl-5 space-y-2 text-stone-600">
            <li>Commercial real estate / rent prices are not in the model.</li>
            <li>The "business_centers" Google Places layer is too noisy (returns hotels, shops, posts) and is excluded from demand on purpose.</li>
            <li>POI density doesn't account for time-of-day footfall — an office area at 9am vs a tourist area at noon look the same here.</li>
            <li>Ratings are a lagging signal: they reflect existing cafes, not unmet demand directly.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
