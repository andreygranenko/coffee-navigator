import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { getAuthToken, setAuthSession } from "../auth";

type LoginResult = {
  token: string;
  expiresAt: string;
  user: { id: number; email: string; role: string };
};

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  if (getAuthToken()) return <Navigate to="/" replace />;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Ielogošanās neizdevās (${res.status})`);
      }
      const data: LoginResult = await res.json();
      setAuthSession(data.token, data.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ielogošanās neizdevās");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    setLoading(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Reģistrācija neizdevās (${res.status})`);
      }
      setOk("Konts izveidots. Tagad vari ielogоties.");
      setMode("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reģistrācija neizdevās");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-6 md:p-12">
      <h1 className="text-3xl font-bold text-coffee-900 mb-2">Ielogоties</h1>
      <p className="text-stone-600 mb-8">Lai piekļūtu platformai, nepieciešams konts.</p>

      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`px-3 py-1.5 rounded ${mode === "login" ? "bg-coffee-800 text-white" : "bg-stone-100 text-stone-700"}`}
          >
            Ieiet
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`px-3 py-1.5 rounded ${mode === "register" ? "bg-coffee-800 text-white" : "bg-stone-100 text-stone-700"}`}
          >
            Reģistrēties
          </button>
        </div>

        <form onSubmit={mode === "login" ? handleLogin : (e) => { e.preventDefault(); handleRegister(); }} className="space-y-4">
          <div>
            <label className="block text-sm text-stone-600 mb-1">E-pasts</label>
            <input
              type="email"
              required
              maxLength={50}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-coffee-300"
              placeholder="tu@piemers.lv"
            />
          </div>

          <div>
            <label className="block text-sm text-stone-600 mb-1">Parole</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-coffee-300"
              placeholder="Minimums 8 rakstzīmes"
            />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
          {ok && <div className="text-sm text-emerald-700">{ok}</div>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-coffee-800 text-white disabled:opacity-60"
            >
              {loading ? "Lūdzu uzgaidi..." : mode === "login" ? "Ieiet" : "Izveidot kontu"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
