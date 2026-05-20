import React, { useEffect, useState } from "react";
import { getAuthToken } from "../auth";

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

export default function Admin() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
