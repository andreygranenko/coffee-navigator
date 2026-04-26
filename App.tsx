import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Explore from './pages/Explore';
import DistrictDetail from './pages/DistrictDetail';
import Recommendations from './pages/Recommendations';
import Compare from './pages/Compare';
import About from './pages/About';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Landing />} />
          <Route path="explore" element={<Explore />} />
          <Route path="district/:id" element={<DistrictDetail />} />
          <Route path="recommendations" element={<Recommendations />} />
          <Route path="compare" element={<Compare />} />
          <Route path="about" element={<About />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
