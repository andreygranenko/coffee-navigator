CREATE TABLE IF NOT EXISTS model_runs (
  id BIGSERIAL PRIMARY KEY,
  run_label TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Snapshot artifacts keep exact API shape from JSON files (read-only source transfer)
CREATE TABLE IF NOT EXISTS artifacts (
  run_id BIGINT NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (run_id, name)
);

CREATE TABLE IF NOT EXISTS districts (
  id TEXT NOT NULL,
  run_id BIGINT NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cluster TEXT NOT NULL,
  cluster_id INT NOT NULL,
  low_confidence BOOLEAN NOT NULL,
  low_quality_sample BOOLEAN,
  area_km2 NUMERIC(10, 3) NOT NULL,
  cafe_count INT NOT NULL,
  avg_rating NUMERIC(4, 2),
  total_reviews INT NOT NULL,
  cafes_per_km2 NUMERIC(10, 3) NOT NULL,
  poi_total INT NOT NULL,
  poi_per_km2 NUMERIC(10, 3) NOT NULL,
  office_count INT NOT NULL,
  offices_per_km2 NUMERIC(10, 3) NOT NULL,
  venue_count INT,
  venues_per_km2 NUMERIC(10, 3),
  transit_count INT,
  transit_per_km2 NUMERIC(10, 3),
  mall_count INT,
  quality_sample_size INT,
  rating_std_dev NUMERIC(6, 3),
  avg_price_level NUMERIC(4, 2),
  competition_score NUMERIC(4, 1) NOT NULL,
  demand_score NUMERIC(4, 1) NOT NULL,
  quality_score NUMERIC(4, 1) NOT NULL,
  opportunity_score NUMERIC(4, 1) NOT NULL,
  PRIMARY KEY (id, run_id)
);

CREATE TABLE IF NOT EXISTS district_poi_breakdown (
  district_id TEXT NOT NULL,
  poi_type TEXT NOT NULL,
  poi_count INT NOT NULL,
  run_id BIGINT NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  PRIMARY KEY (district_id, poi_type, run_id),
  FOREIGN KEY (district_id, run_id) REFERENCES districts(id, run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cafes (
  id TEXT NOT NULL,
  run_id BIGINT NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  rating NUMERIC(3, 2),
  reviews INT NOT NULL,
  price_level INT,
  address TEXT NOT NULL,
  website TEXT,
  google_maps_url TEXT,
  district_id TEXT,
  district_name TEXT,
  PRIMARY KEY (id, run_id),
  FOREIGN KEY (district_id, run_id) REFERENCES districts(id, run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS venues (
  id TEXT NOT NULL,
  run_id BIGINT NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  name TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  amenity TEXT NOT NULL,
  district_id TEXT,
  PRIMARY KEY (id, run_id),
  FOREIGN KEY (district_id, run_id) REFERENCES districts(id, run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clusters (
  cluster_id INT NOT NULL,
  name TEXT NOT NULL,
  size INT NOT NULL,
  members JSONB NOT NULL,
  centroid JSONB NOT NULL,
  run_id BIGINT NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  PRIMARY KEY (cluster_id, run_id)
);

-- Product entities for explainability and future expansion
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id BIGINT REFERENCES model_runs(id) ON DELETE SET NULL,
  district_id TEXT,
  cafe_id TEXT,
  venue_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id BIGINT REFERENCES model_runs(id) ON DELETE SET NULL,
  district_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_districts_run ON districts(run_id);
CREATE INDEX IF NOT EXISTS idx_districts_opportunity ON districts(opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_districts_cluster ON districts(cluster, run_id);
CREATE INDEX IF NOT EXISTS idx_cafes_run ON cafes(run_id);
CREATE INDEX IF NOT EXISTS idx_cafes_district ON cafes(district_id, run_id);
CREATE INDEX IF NOT EXISTS idx_venues_run ON venues(run_id);
CREATE INDEX IF NOT EXISTS idx_venues_district ON venues(district_id, run_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON user_sessions(expires_at);

CREATE OR REPLACE VIEW v_latest_run AS
SELECT id, run_label, created_at
FROM model_runs
ORDER BY created_at DESC
LIMIT 1;

CREATE OR REPLACE VIEW v_latest_districts AS
SELECT d.*
FROM districts d
JOIN v_latest_run lr ON d.run_id = lr.id;

CREATE OR REPLACE VIEW v_top_opportunity AS
SELECT
  name,
  cluster,
  opportunity_score,
  demand_score,
  competition_score,
  quality_score,
  low_confidence
FROM v_latest_districts
ORDER BY opportunity_score DESC, demand_score DESC;

CREATE OR REPLACE VIEW v_office_density AS
SELECT
  name,
  cluster,
  office_count,
  offices_per_km2
FROM v_latest_districts
ORDER BY offices_per_km2 DESC, office_count DESC;
