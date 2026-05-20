import React from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Explore from './pages/Explore';
import DistrictDetail from './pages/DistrictDetail';
import Recommendations from './pages/Recommendations';
import Compare from './pages/Compare';
import Login from './pages/Login';
import Admin from './pages/Admin';
import { clearAuthSession, getAuthToken, getAuthUser, setAuthSession } from './auth';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const [ready, setReady] = React.useState(false);
  const [authed, setAuthed] = React.useState(false);

  React.useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setAuthed(false);
      setReady(true);
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((body) => {
        const user = body?.user;
        if (!user) throw new Error("No user in auth/me response");
        setAuthSession(token, user);
        setAuthed(true);
      })
      .catch(() => {
        clearAuthSession();
        setAuthed(false);
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="p-10 text-stone-500">Checking session…</div>;
  if (!authed) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }: { children: React.ReactElement }) {
  const user = getAuthUser();
  if (!user || user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Landing />} />
          <Route path="explore" element={<Explore />} />
          <Route path="district/:id" element={<DistrictDetail />} />
          <Route path="recommendations" element={<Recommendations />} />
          <Route path="compare" element={<Compare />} />
          <Route path="admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
