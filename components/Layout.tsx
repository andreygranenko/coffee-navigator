import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Coffee, Map, BarChart3, List, Info, LayoutDashboard, GitCompare } from 'lucide-react';

const NavItem = ({ to, icon: Icon, label }: { to: string; icon: any; label: string }) => {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group ${
          isActive
            ? 'bg-coffee-700 text-white shadow-md'
            : 'text-coffee-800 hover:bg-coffee-200'
        }`
      }
    >
      <Icon size={20} className="shrink-0" />
      <span className="font-medium">{label}</span>
    </NavLink>
  );
};

export default function Layout() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-stone-50 text-stone-900">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-coffee-100 border-r border-coffee-200 flex-shrink-0 z-20">
        <div className="p-6 flex items-center gap-2 border-b border-coffee-200/50">
          <div className="w-8 h-8 bg-coffee-800 rounded-lg flex items-center justify-center text-white">
            <Coffee size={18} strokeWidth={3} />
          </div>
          <span className="text-xl font-bold text-coffee-900 tracking-tight">Riga Coffee</span>
        </div>

        <nav className="p-4 space-y-1">
          <div className="px-4 py-2 text-xs font-semibold text-coffee-600 uppercase tracking-wider">Menu</div>
          <NavItem to="/" icon={LayoutDashboard} label="Overview" />
          <NavItem to="/explore" icon={Map} label="District Explorer" />
          <NavItem to="/recommendations" icon={List} label="Top Picks" />
          <NavItem to="/compare" icon={GitCompare} label="Compare" />
          
          <div className="mt-8 px-4 py-2 text-xs font-semibold text-coffee-600 uppercase tracking-wider">Info</div>
          <NavItem to="/about" icon={Info} label="Methodology" />
        </nav>
        
        <div className="mt-auto p-6 border-t border-coffee-200/50">
          <div className="bg-white/50 rounded-xl p-4 text-xs text-coffee-800">
            <p className="font-semibold mb-1">Status: Prototype</p>
            <p className="opacity-75">Data v1.0 • Riga 2025</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto relative">
        <Outlet />
      </main>
    </div>
  );
}
