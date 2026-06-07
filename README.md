# Riga Coffee Navigator

Web application for analyzing the Riga cafe market. Helps entrepreneurs evaluate districts by competition, demand, and infrastructure before opening a new venue.

## Tech stack

- **Frontend**: React + TypeScript + Vite, react-leaflet, Recharts
- **Backend**: Python, FastAPI, PostgreSQL (psycopg v3)
- **Data pipeline**: pandas, scikit-learn (K-Means), fpdf2
- **Data sources**: Google Places API, OpenStreetMap / Overpass API

## Local development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Frontend (separate terminal)
npm install
npm run dev
```

Requires PostgreSQL running. See `docker-compose.yml` for a local instance.

## Data pipeline

```bash
source .venv/bin/activate
python scripts/build_data.py        # rebuild district scores and clusters
python scripts/load_postgres.py     # load artifacts into PostgreSQL
```

## Project structure

```
backend/        FastAPI application
scripts/        Data pipeline and OSM fetch scripts
sql/            PostgreSQL schema and demo queries
pages/          React pages
components/     Shared React components
data/           Source data and documentation
docs/           Technical documentation
```
