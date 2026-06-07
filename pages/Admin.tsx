import React, { useEffect, useState } from "react";
import { getAuthToken } from "../auth";
import { RefreshCw, Check, X as XIcon } from "lucide-react";

type AdminUser = {
  id: number;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};

type Overview = {
  users: number;
  runs: number;
  reports: number;
  favorites: number;
  latestRun: { id: number; label: string; createdAt: string } | null;
};

type OsmVenue = {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  amenity: string;
  cuisine: string | null;
  operator: string | null;
};

type PreviewResult = {
  totalOsm: number;
  existing: number;
  newFound: number;
  limit: number;
  venues: OsmVenue[];
};

const AMENITY_LV: Record<string, string> = {
  cafe: "Kafejnīca",
  restaurant: "Restorāns",
  fast_food: "Ātrā ēd.",
};

const AMENITY_COLOR: Record<string, string> = {
  cafe: "bg-amber-100 text-amber-800",
  restaurant: "bg-orange-100 text-orange-800",
  fast_food: "bg-stone-100 text-stone-600",
};

export default function Admin() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // OSM refresh state
  const [osmLimit, setOsmLimit] = useState(20);
  const [osmLoading, setOsmLoading] = useState(false);
  const [osmError, setOsmError] = useState<string | null>(null);
  const [osmSuccess, setOsmSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);

  const token = getAuthToken();

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Pieprasījums neizdevās (${res.status})`);
    }
    return res.json();
  }

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [ov, list] = await Promise.all([
        api<Overview>("/api/admin/overview"),
        api<AdminUser[]>("/api/admin/users"),
      ]);
      setOverview(ov);
      setUsers(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Neizdevās ielādēt administrācijas datus");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function toggleRole(user: AdminUser) {
    const role = user.role === "admin" ? "user" : "admin";
    await api(`/api/admin/users/${user.id}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
    await reload();
  }

  async function toggleActive(user: AdminUser) {
    await api(`/api/admin/users/${user.id}/active`, {
      method: "POST",
      body: JSON.stringify({ isActive: !user.isActive }),
    });
    await reload();
  }

  async function runOsmPreview() {
    setOsmLoading(true);
    setOsmError(null);
    setOsmSuccess(null);
    setPreview(null);
    setSelected(new Set());
    try {
      const result = await api<PreviewResult>(`/api/admin/osm-preview?limit=${osmLimit}`, { method: "POST" });
      setPreview(result);
      setSelected(new Set(result.venues.map((v) => v.id)));
    } catch (e) {
      setOsmError(e instanceof Error ? e.message : "Kļūda");
    } finally {
      setOsmLoading(false);
    }
  }

  async function commitSelected() {
    if (!preview) return;
    const venues = preview.venues.filter((v) => selected.has(v.id));
    if (venues.length === 0) return;
    setCommitting(true);
    setOsmError(null);
    try {
      const result = await api<{ message: string }>("/api/admin/osm-commit", {
        method: "POST",
        body: JSON.stringify({ venues }),
      });
      setOsmSuccess(result.message);
      setPreview(null);
      setSelected(new Set());
      await reload();
    } catch (e) {
      setOsmError(e instanceof Error ? e.message : "Kļūda saglabājot");
    } finally {
      setCommitting(false);
    }
  }

  function toggleVenue(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!preview) return;
    if (selected.size === preview.venues.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(preview.venues.map((v) => v.id)));
    }
  }

  if (loading) return <div className="p-10 text-stone-500">Ielādē administrācijas paneli…</div>;
  if (error) return <div className="p-10 text-red-600">{error}</div>;

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-coffee-900">Administrācijas panelis</h1>
        <p className="text-stone-600">Platformas pārvaldība un datu pārskats.</p>
      </div>

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Stat label="Lietotāji" value={overview.users} />
          <Stat label="Datu palaišanas" value={overview.runs} />
          <Stat label="Atskaites" value={overview.reports} />
          <Stat label="Izlase" value={overview.favorites} />
          <Stat label="Pēdējā palaišana" value={overview.latestRun?.label ?? "—"} small />
        </div>
      )}

      {/* OSM refresh section */}
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        <div className="p-4 border-b border-stone-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-coffee-900">Datu atjaunināšana (OSM)</h2>
            <p className="text-xs text-stone-400 mt-0.5">Meklē jaunus objektus OpenStreetMap un ļauj tos apstiprināt pirms saglabāšanas</p>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm text-stone-600 font-medium whitespace-nowrap">Maks. jauni objekti:</label>
            <select
              value={osmLimit}
              onChange={(e) => setOsmLimit(Number(e.target.value))}
              className="px-3 py-1.5 border border-stone-200 rounded-lg text-sm bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            >
              {[10, 20, 30, 50].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button
              onClick={() => void runOsmPreview()}
              disabled={osmLoading}
              className="flex items-center gap-2 px-4 py-1.5 bg-coffee-800 hover:bg-coffee-900 text-white rounded-lg text-sm disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={14} className={osmLoading ? "animate-spin" : ""} />
              {osmLoading ? "Meklē…" : "Meklēt jaunus objektus"}
            </button>
          </div>

          {osmError && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {osmError}
            </div>
          )}
          {osmSuccess && (
            <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 font-medium">
              ✓ {osmSuccess}
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="text-stone-500">
                  OSM kopā: <b className="text-stone-800">{preview.totalOsm}</b> · Esošie DB: <b className="text-stone-800">{preview.existing}</b> · Jauni: <b className="text-emerald-700">{preview.newFound}</b>
                  {preview.newFound > preview.limit && (
                    <span className="ml-2 text-amber-600">(rāda {preview.limit} no {preview.newFound})</span>
                  )}
                </div>
                <span className="text-stone-400 text-xs">Atlasīti: {selected.size}/{preview.venues.length}</span>
              </div>

              {preview.venues.length === 0 ? (
                <div className="py-8 text-center text-stone-400 text-sm bg-stone-50 rounded-xl border border-dashed border-stone-200">
                  Nav atrasti jauni objekti
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50 text-stone-500 uppercase text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left w-8">
                          <input
                            type="checkbox"
                            checked={selected.size === preview.venues.length}
                            onChange={toggleAll}
                            className="accent-amber-600"
                          />
                        </th>
                        <th className="px-3 py-2 text-left">Nosaukums</th>
                        <th className="px-3 py-2 text-left">Tips</th>
                        <th className="px-3 py-2 text-left hidden md:table-cell">Virtuve / Operators</th>
                        <th className="px-3 py-2 text-left hidden md:table-cell">Koordinātes</th>
                        <th className="px-3 py-2 text-left">OSM ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {preview.venues.map((v) => (
                        <tr
                          key={v.id}
                          onClick={() => toggleVenue(v.id)}
                          className={`cursor-pointer transition-colors ${selected.has(v.id) ? "bg-amber-50/60" : "hover:bg-stone-50"}`}
                        >
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={selected.has(v.id)}
                              onChange={() => toggleVenue(v.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="accent-amber-600"
                            />
                          </td>
                          <td className="px-3 py-2.5 font-medium text-coffee-900">
                            {v.name ?? <span className="text-stone-400 italic font-normal">Bez nosaukuma</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${AMENITY_COLOR[v.amenity] ?? "bg-stone-100 text-stone-600"}`}>
                              {AMENITY_LV[v.amenity] ?? v.amenity}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-stone-400 hidden md:table-cell text-xs">
                            {v.cuisine ?? v.operator ?? "—"}
                          </td>
                          <td className="px-3 py-2.5 text-stone-400 hidden md:table-cell text-xs font-mono">
                            {v.lat.toFixed(4)}, {v.lng.toFixed(4)}
                          </td>
                          <td className="px-3 py-2.5 text-stone-300 text-xs font-mono">{v.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.venues.length > 0 && (
                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => { setPreview(null); setSelected(new Set()); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-500 hover:text-stone-700"
                  >
                    <XIcon size={14} /> Atcelt
                  </button>
                  <button
                    onClick={() => void commitSelected()}
                    disabled={selected.size === 0 || committing}
                    className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors"
                  >
                    <Check size={15} />
                    {committing ? "Saglabā…" : `Saglabāt atlasītos (${selected.size})`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Users table */}
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        <div className="p-4 border-b border-stone-100 flex items-center justify-between">
          <h2 className="font-semibold text-coffee-900">Lietotāji</h2>
          <button onClick={() => void reload()} className="px-3 py-1.5 rounded bg-stone-100 text-stone-700 text-sm">
            Atjaunināt
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 uppercase text-xs">
              <tr>
                <th className="px-4 py-2 text-left">E-pasts</th>
                <th className="px-4 py-2 text-left">Loma</th>
                <th className="px-4 py-2 text-left">Statuss</th>
                <th className="px-4 py-2 text-left">Reģistrēts</th>
                <th className="px-4 py-2 text-right">Darbības</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2">{u.email}</td>
                  <td className="px-4 py-2">{u.role === "admin" ? "administrators" : "lietotājs"}</td>
                  <td className="px-4 py-2">{u.isActive ? "aktīvs" : "neaktīvs"}</td>
                  <td className="px-4 py-2">{new Date(u.createdAt).toLocaleString("lv-LV")}</td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <button onClick={() => void toggleRole(u)} className="px-2 py-1 rounded bg-coffee-100 text-coffee-800">
                      {u.role === "admin" ? "Padarīt lietotāju" : "Padarīt adminu"}
                    </button>
                    <button onClick={() => void toggleActive(u)} className="px-2 py-1 rounded bg-stone-100 text-stone-700">
                      {u.isActive ? "Deaktivizēt" : "Aktivizēt"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="bg-white p-4 rounded-xl border border-stone-200">
      <div className="text-xs uppercase text-stone-500">{label}</div>
      <div className={`font-bold text-coffee-900 ${small ? "text-sm mt-1 break-all" : "text-2xl mt-1"}`}>{value}</div>
    </div>
  );
}
