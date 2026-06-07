from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import psycopg
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fpdf import FPDF
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Annotated

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "public" / "data"
SCHEMA_SQL_PATH = ROOT / "sql" / "schema_postgres.sql"
DEFAULT_DB_URL = os.getenv("DATABASE_URL", "postgresql://riga:riga_dev_password@localhost:5432/riga_navigator")
USE_POSTGRES = os.getenv("USE_POSTGRES", "1") != "0"


@dataclass
class CachedJson:
    mtime: float
    data: Any


_cache: dict[str, CachedJson] = {}


def _load_json(name: str) -> Any:
    path = DATA_DIR / name
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Data file not found: {name}")

    stat = path.stat()
    cached = _cache.get(name)
    if cached and cached.mtime == stat.st_mtime:
        return cached.data

    data = json.loads(path.read_text())
    _cache[name] = CachedJson(mtime=stat.st_mtime, data=data)
    return data


def _hash_password(password: str) -> str:
    iterations = 200_000
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), iterations).hex()
    return f"pbkdf2_sha256${iterations}${salt}${digest}"


def _verify_password(password: str, encoded: str) -> bool:
    try:
        algo, iterations_str, salt, digest = encoded.split("$", 3)
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations_str)).hex()
    return hmac.compare_digest(check, digest)


def _with_pg(fn):
    if not USE_POSTGRES:
        return None
    try:
        with psycopg.connect(DEFAULT_DB_URL, autocommit=False) as conn:
            with conn.cursor() as cur:
                result = fn(cur)
            conn.commit()
            return result
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[backend] PostgreSQL operation failed: {exc}")
        return None


def _fetch_latest_artifact(name: str) -> Any | None:
    def _q(cur):
        cur.execute(
            """
            SELECT a.payload
            FROM artifacts a
            JOIN model_runs mr ON mr.id = a.run_id
            WHERE a.name = %s
            ORDER BY mr.created_at DESC
            LIMIT 1
            """,
            (name,),
        )
        row = cur.fetchone()
        return row[0] if row else None

    return _with_pg(_q)


def _get_dataset(artifact_name: str, fallback_file: str) -> Any:
    payload = _fetch_latest_artifact(artifact_name)
    if payload is not None:
        return payload
    return _load_json(fallback_file)


def _extract_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization must be Bearer token")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty bearer token")
    return token


CLUSTER_LV: dict[str, str] = {
    "Business Hub": "Biznesa centrs",
    "Tourist Center": "Tūristu zona",
    "Student / Hipster": "Studentu rajons",
    "Mixed Urban": "Jaukts rajons",
    "Green / Parks": "Zaļā zona",
    "Suburban": "Piepilsēta",
}

def _resolve_font(candidates: list[str]) -> str:
    for path in candidates:
        if Path(path).exists():
            return path
    raise RuntimeError(f"No PDF font found in: {candidates}")


ARIAL_FONT = _resolve_font([
    "/System/Library/Fonts/Supplemental/Arial.ttf",                  # macOS
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",               # Debian/Ubuntu
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",                        # Alpine/Fedora
])
ARIAL_BOLD = _resolve_font([
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
])


def _pdf_safe(value: Any) -> str:
    return str(value)


def _require_user(authorization: str | None) -> dict[str, Any]:
    if not USE_POSTGRES:
        raise HTTPException(status_code=503, detail="Auth requires PostgreSQL (USE_POSTGRES=1)")

    token = _extract_token(authorization)

    def _q(cur):
        cur.execute(
            """
            SELECT u.id, u.email, u.role, s.expires_at
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = %s
            """,
            (token,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid session token")
        user_id, email, role, expires_at = row
        if expires_at <= datetime.now(timezone.utc):
            cur.execute("DELETE FROM user_sessions WHERE token = %s", (token,))
            raise HTTPException(status_code=401, detail="Session expired")
        return {"id": user_id, "email": email, "role": role, "expiresAt": expires_at.isoformat()}

    user = _with_pg(_q)
    if user is None:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    return user


class RegisterIn(BaseModel):
    email: Annotated[EmailStr, Field(max_length=50)]
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_complexity(cls, v: str) -> str:
        if not any(c.isalpha() for c in v):
            raise ValueError("Parolei jāsatur vismaz viens burts")
        if not any(c.isdigit() for c in v):
            raise ValueError("Parolei jāsatur vismaz viens cipars")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RoleUpdateIn(BaseModel):
    role: str


class ActiveUpdateIn(BaseModel):
    isActive: bool


app = FastAPI(title="Riga Coffee Navigator API", version="0.2.0")

_extra_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_origins=_extra_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    if not USE_POSTGRES:
        return

    if not SCHEMA_SQL_PATH.exists():
        print(f"[backend] Schema file missing: {SCHEMA_SQL_PATH}")
        return

    schema_sql = SCHEMA_SQL_PATH.read_text()

    def _init(cur):
        cur.execute(schema_sql)
        cur.execute("SELECT 1")
        cur.fetchone()

    res = _with_pg(_init)
    if res is None:
        print("[backend] PostgreSQL unavailable; using JSON fallback for data endpoints.")


@app.get("/health")
def health() -> dict[str, Any]:
    pg_ok = False
    model_runs_count = 0

    def _q(cur):
        cur.execute("SELECT 1")
        cur.fetchone()
        return True

    def _runs(cur):
        cur.execute("SELECT COUNT(*) FROM model_runs")
        return cur.fetchone()[0]

    if USE_POSTGRES and _with_pg(_q):
        pg_ok = True
        model_runs_count = _with_pg(_runs) or 0

    data_source = "database" if model_runs_count > 0 else "json_files"
    return {"status": "ok", "postgres": pg_ok, "model_runs": model_runs_count, "data_source": data_source}


@app.get("/api/districts")
def get_districts(
    low_confidence: bool | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    _require_user(authorization)
    districts = _get_dataset("districts", "districts.json")
    if low_confidence is None:
        return districts
    return [d for d in districts if bool(d.get("lowConfidence")) == low_confidence]


@app.get("/api/districts/{district_id}")
def get_district_by_id(district_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _require_user(authorization)
    districts = _get_dataset("districts", "districts.json")
    district = next((d for d in districts if d.get("id") == district_id), None)
    if not district:
        raise HTTPException(status_code=404, detail=f"District not found: {district_id}")
    return district


@app.get("/api/cafes")
def get_cafes(
    district_id: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    _require_user(authorization)
    cafes = _get_dataset("cafes", "cafes.json")
    if not district_id:
        return cafes
    return [c for c in cafes if c.get("districtId") == district_id]


@app.get("/api/venues")
def get_venues(
    district_id: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    _require_user(authorization)
    venues = _get_dataset("venues", "venues.json")
    if not district_id:
        return venues
    return [v for v in venues if v.get("districtId") == district_id]


@app.get("/api/clusters")
def get_clusters(authorization: str | None = Header(default=None)) -> list[dict[str, Any]]:
    _require_user(authorization)
    return _get_dataset("clusters", "clusters.json")


@app.get("/api/geo/districts")
def get_districts_geojson(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _require_user(authorization)
    return _get_dataset("districts_geojson", "districts.geojson")


@app.get("/api/bundle")
def get_bundle(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _require_user(authorization)
    return {
        "districts": _get_dataset("districts", "districts.json"),
        "cafes": _get_dataset("cafes", "cafes.json"),
        "venues": _get_dataset("venues", "venues.json"),
        "geojson": _get_dataset("districts_geojson", "districts.geojson"),
    }


@app.post("/api/auth/register")
def auth_register(payload: RegisterIn) -> dict[str, Any]:
    if not USE_POSTGRES:
        raise HTTPException(status_code=503, detail="Auth requires PostgreSQL (USE_POSTGRES=1)")

    password_hash = _hash_password(payload.password)

    def _q(cur):
        cur.execute("SELECT id FROM users WHERE email = %s", (payload.email.lower(),))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="Email already exists")
        cur.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        admin_count = cur.fetchone()[0]
        role = "admin" if int(admin_count) == 0 else "user"
        cur.execute(
            """
            INSERT INTO users (email, password_hash, role)
            VALUES (%s, %s, %s)
            RETURNING id, email, role, created_at
            """,
            (payload.email.lower(), password_hash, role),
        )
        row = cur.fetchone()
        return {"id": row[0], "email": row[1], "role": row[2], "createdAt": row[3].isoformat()}

    user = _with_pg(_q)
    if user is None:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    return {"user": user}


@app.post("/api/auth/login")
def auth_login(payload: LoginIn) -> dict[str, Any]:
    if not USE_POSTGRES:
        raise HTTPException(status_code=503, detail="Auth requires PostgreSQL (USE_POSTGRES=1)")

    def _q(cur):
        cur.execute(
            "SELECT id, email, password_hash, role, is_active FROM users WHERE email = %s",
            (payload.email.lower(),),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        user_id, email, password_hash, role, is_active = row
        if not is_active:
            raise HTTPException(status_code=403, detail="User is inactive")
        if not _verify_password(payload.password, password_hash):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        cur.execute(
            "INSERT INTO user_sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
            (token, user_id, expires_at),
        )
        return {
            "token": token,
            "expiresAt": expires_at.isoformat(),
            "user": {"id": user_id, "email": email, "role": role},
        }

    result = _with_pg(_q)
    if result is None:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    return result


@app.get("/api/auth/me")
def auth_me(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = _require_user(authorization)
    return {"user": user}


def _require_admin(authorization: str | None) -> dict[str, Any]:
    user = _require_user(authorization)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@app.get("/api/reports/district/{district_id}.pdf")
def district_report_pdf(district_id: str, authorization: str | None = Header(default=None)) -> Response:
    user = _require_user(authorization)

    districts = _get_dataset("districts", "districts.json")
    cafes = _get_dataset("cafes", "cafes.json")
    venues = _get_dataset("venues", "venues.json")

    district = next((d for d in districts if d.get("id") == district_id), None)
    if not district:
        raise HTTPException(status_code=404, detail=f"District not found: {district_id}")

    district_cafes = [c for c in cafes if c.get("districtId") == district_id]
    district_venues = [v for v in venues if v.get("districtId") == district_id]
    top_cafes = sorted(district_cafes, key=lambda c: int(c.get("reviews", 0)), reverse=True)[:8]

    cluster_lv = CLUSTER_LV.get(district.get("cluster", ""), district.get("cluster", ""))

    pdf = FPDF()
    pdf.add_font("Arial", style="", fname=ARIAL_FONT)
    pdf.add_font("Arial", style="B", fname=ARIAL_BOLD)
    pdf.set_auto_page_break(auto=True, margin=10)
    pdf.add_page()

    pdf.set_font("Arial", "B", 16)
    pdf.cell(0, 10, "Riga Cafe Navigator — Rajona atskaite", new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Arial", "", 12)
    pdf.cell(0, 8, f"Rajons: {district['name']}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Klasteris: {cluster_lv}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Iespējas vērtējums: {district['opportunityScore']}/10", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Pieprasījuma vērtējums: {district['demandScore']}/10", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Konkurences vērtējums: {district['competitionScore']}/10", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Kvalitātes vērtējums: {district['qualityScore']}/10", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Biroju blīvums: {district.get('officesPerKm2', 0)} uz km²", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Visi objekti: {len(district_venues)}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Novērtētās kafejnīcas: {len(district_cafes)}", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(3)
    pdf.set_font("Arial", "B", 13)
    pdf.cell(0, 9, "Visbiežāk novērtētās kafejnīcas", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Arial", "", 11)
    if not top_cafes:
        pdf.cell(0, 7, "Šajā rajonā nav atrasta neviena kafejnīca.", new_x="LMARGIN", new_y="NEXT")
    else:
        for cafe in top_cafes:
            name = str(cafe.get("name", "Bez nosaukuma"))
            rating = cafe.get("rating")
            reviews = int(cafe.get("reviews", 0))
            price = cafe.get("priceLevel")
            price_text = ("€" * int(price)) if isinstance(price, int) and price > 0 else "—"
            line = f"- {name} | vērtējums: {rating if rating is not None else '—'} | atsauksmes: {reviews} | cena: {price_text}"
            pdf.multi_cell(0, 6, line, new_x="LMARGIN", new_y="NEXT")

    pdf.ln(3)
    pdf.set_font("Arial", "", 10)
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    pdf.multi_cell(
        0,
        6,
        f"Ģenerēts: Riga Cafe Navigator, lietotājam {user['email']}, {generated_at}.",
    )

    filename = f"rajona-atskaite-{district_id}.pdf"
    pdf_bytes = bytes(pdf.output())

    def _save_report(cur):
        cur.execute("SELECT id FROM v_latest_run")
        row = cur.fetchone()
        run_id = row[0] if row else None
        cur.execute(
            """
            INSERT INTO reports (user_id, run_id, district_id, title, summary)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                user["id"],
                run_id,
                district_id,
                f"Rajona atskaite: {district['name']}",
                f"Iespējas={district['opportunityScore']}, objekti={len(district_venues)}, kafejnīcas={len(district_cafes)}",
            ),
        )

    _with_pg(_save_report)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/admin/overview")
def admin_overview(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _require_admin(authorization)

    def _q(cur):
        cur.execute("SELECT COUNT(*) FROM users")
        users_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM model_runs")
        runs_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM reports")
        reports_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM favorites")
        favorites_count = cur.fetchone()[0]
        cur.execute("SELECT id, run_label, created_at FROM v_latest_run")
        latest = cur.fetchone()
        return {
            "users": users_count,
            "runs": runs_count,
            "reports": reports_count,
            "favorites": favorites_count,
            "latestRun": {
                "id": latest[0],
                "label": latest[1],
                "createdAt": latest[2].isoformat(),
            } if latest else None,
        }

    out = _with_pg(_q)
    if out is None:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    return out


@app.get("/api/admin/users")
def admin_users(authorization: str | None = Header(default=None)) -> list[dict[str, Any]]:
    _require_admin(authorization)

    def _q(cur):
        cur.execute(
            """
            SELECT id, email, role, is_active, created_at
            FROM users
            ORDER BY created_at ASC
            """
        )
        rows = cur.fetchall()
        return [
            {"id": r[0], "email": r[1], "role": r[2], "isActive": r[3], "createdAt": r[4].isoformat()}
            for r in rows
        ]

    users = _with_pg(_q)
    if users is None:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    return users


@app.post("/api/admin/users/{user_id}/role")
def admin_update_role(user_id: int, payload: RoleUpdateIn, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _require_admin(authorization)
    role = payload.role.strip().lower()
    if role not in {"admin", "user"}:
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")

    def _q(cur):
        cur.execute("UPDATE users SET role = %s WHERE id = %s RETURNING id, email, role, is_active", (role, user_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        return {"id": row[0], "email": row[1], "role": row[2], "isActive": row[3]}

    out = _with_pg(_q)
    if out is None:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    return {"user": out}


@app.post("/api/admin/users/{user_id}/active")
def admin_update_active(user_id: int, payload: ActiveUpdateIn, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _require_admin(authorization)

    def _q(cur):
        cur.execute("UPDATE users SET is_active = %s WHERE id = %s RETURNING id, email, role, is_active", (payload.isActive, user_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        return {"id": row[0], "email": row[1], "role": row[2], "isActive": row[3]}

    out = _with_pg(_q)
    if out is None:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    return {"user": out}
