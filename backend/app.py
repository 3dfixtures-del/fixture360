from __future__ import annotations

import hashlib
import os
import secrets
import shutil
import sqlite3
import string
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR))).resolve()
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(DATA_DIR / "uploads"))).resolve()
DB_PATH = Path(os.getenv("DB_PATH", str(DATA_DIR / "fixture360.db"))).resolve()
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")

def parse_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "")
    origins = [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]
    origins.extend([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ])
    return list(dict.fromkeys(origins))

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Fixture360 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def generate_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "FX-" + "".join(secrets.choice(alphabet) for _ in range(6))


def safe_filename(filename: str) -> str:
    name = Path(filename).name
    stem = Path(name).stem[:48].replace(" ", "-") or "panorama"
    suffix = Path(name).suffix.lower() or ".jpg"
    token = secrets.token_hex(4)
    return f"{stem}-{token}{suffix}"


def execute_schema() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'admin',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                unique_code TEXT UNIQUE NOT NULL,
                project_name TEXT NOT NULL,
                client_name TEXT NOT NULL,
                client_phone TEXT,
                location TEXT,
                panorama_filename TEXT NOT NULL,
                shop_width REAL,
                shop_length REAL,
                shop_height REAL,
                unit TEXT NOT NULL DEFAULT 'ft',
                status TEXT NOT NULL DEFAULT 'draft',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS measurements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                side_name TEXT NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                unit TEXT NOT NULL DEFAULT 'ft',
                yaw REAL NOT NULL DEFAULT 0,
                pitch REAL NOT NULL DEFAULT 0,
                remarks TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS fixtures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                fixture_name TEXT NOT NULL,
                fixture_type TEXT,
                width REAL,
                height REAL,
                depth REAL,
                unit TEXT NOT NULL DEFAULT 'ft',
                yaw REAL NOT NULL DEFAULT 0,
                pitch REAL NOT NULL DEFAULT 0,
                scale REAL NOT NULL DEFAULT 1,
                color TEXT NOT NULL DEFAULT '#CF1E01',
                remarks TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT,
                message TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'new',
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            """
        )
        conn.commit()


def seed_data() -> None:
    with get_db() as conn:
        admin = conn.execute("SELECT id FROM users WHERE email = ?", ("admin@fixture360.local",)).fetchone()
        if admin is None:
            conn.execute(
                "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (
                    "Fixture360 Admin",
                    "admin@fixture360.local",
                    hash_password("admin123"),
                    "admin",
                    now_iso(),
                ),
            )

        demo = conn.execute("SELECT id FROM projects WHERE unique_code = ?", ("DEMO360",)).fetchone()
        demo_file = UPLOAD_DIR / "walltron-demo.jpeg"
        if demo is None and demo_file.exists():
            created = now_iso()
            cursor = conn.execute(
                """
                INSERT INTO projects (
                    unique_code, project_name, client_name, client_phone, location,
                    panorama_filename, shop_width, shop_length, shop_height, unit, status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "DEMO360",
                    "Walltron Shop Fixture Preview",
                    "Demo Client",
                    "",
                    "Demo Retail Space",
                    "walltron-demo.jpeg",
                    18,
                    24,
                    10,
                    "ft",
                    "published",
                    created,
                    created,
                ),
            )
            project_id = cursor.lastrowid
            measurements = [
                (project_id, "Front Display Wall", 18, 10, "ft", -25, 2, "Main customer-facing wall"),
                (project_id, "Left Product Wall", 12, 10, "ft", -92, 0, "Exterior/interior wall shelf zone"),
                (project_id, "Right Branding Wall", 12, 10, "ft", 62, 1, "Round Walltron display zone"),
                (project_id, "Ceiling Height", 18, 10, "ft", 0, 46, "Overall height reference"),
            ]
            conn.executemany(
                """
                INSERT INTO measurements
                (project_id, side_name, width, height, unit, yaw, pitch, remarks, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [(*item, created) for item in measurements],
            )
            fixtures = [
                (project_id, "Premium Wall Shelf", "Wall Display", 8, 7, 1, "ft", -38, -4, 1.1, "#CF1E01", "Proposed shelf fixture"),
                (project_id, "Circular Product Island", "Center Display", 6, 6, 2, "ft", 50, -5, 1.0, "#101828", "Hero product display"),
            ]
            conn.executemany(
                """
                INSERT INTO fixtures
                (project_id, fixture_name, fixture_type, width, height, depth, unit, yaw, pitch, scale, color, remarks, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [(*item, created) for item in fixtures],
            )
        conn.commit()


@app.on_event("startup")
def startup() -> None:
    execute_schema()
    seed_data()


class LoginRequest(BaseModel):
    email: str
    password: str


class MeasurementCreate(BaseModel):
    side_name: str = Field(..., min_length=1)
    width: float
    height: float
    unit: str = "ft"
    yaw: float = 0
    pitch: float = 0
    remarks: Optional[str] = None


class MeasurementUpdate(BaseModel):
    side_name: Optional[str] = None
    width: Optional[float] = None
    height: Optional[float] = None
    unit: Optional[str] = None
    yaw: Optional[float] = None
    pitch: Optional[float] = None
    remarks: Optional[str] = None


class FixtureCreate(BaseModel):
    fixture_name: str = Field(..., min_length=1)
    fixture_type: Optional[str] = None
    width: Optional[float] = None
    height: Optional[float] = None
    depth: Optional[float] = None
    unit: str = "ft"
    yaw: float = 0
    pitch: float = 0
    scale: float = 1
    color: str = "#CF1E01"
    remarks: Optional[str] = None


class ProjectUpdate(BaseModel):
    project_name: Optional[str] = None
    client_name: Optional[str] = None
    client_phone: Optional[str] = None
    location: Optional[str] = None
    shop_width: Optional[float] = None
    shop_length: Optional[float] = None
    shop_height: Optional[float] = None
    unit: Optional[str] = None
    status: Optional[str] = None


class FeedbackCreate(BaseModel):
    name: Optional[str] = None
    message: str = Field(..., min_length=1)


def require_admin(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")
    token = authorization.removeprefix("Bearer ").strip()
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT users.id, users.name, users.email, users.role
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ?
            """,
            (token,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid session")
    return row_to_dict(row) or {}


def project_payload(project: sqlite3.Row) -> dict[str, Any]:
    data = row_to_dict(project) or {}
    data["panorama_url"] = f"/uploads/{data['panorama_filename']}"
    return data


def full_project_payload(project_id: int, public_base_url: str = "") -> dict[str, Any]:
    with get_db() as conn:
        project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        measurements = conn.execute(
            "SELECT * FROM measurements WHERE project_id = ? ORDER BY id ASC", (project_id,)
        ).fetchall()
        fixtures = conn.execute(
            "SELECT * FROM fixtures WHERE project_id = ? ORDER BY id ASC", (project_id,)
        ).fetchall()
        feedback_rows = conn.execute(
            "SELECT * FROM feedback WHERE project_id = ? ORDER BY id DESC", (project_id,)
        ).fetchall()

    data = project_payload(project)
    data["panorama_url"] = public_base_url + data["panorama_url"]
    data["measurements"] = [row_to_dict(row) for row in measurements]
    data["fixtures"] = [row_to_dict(row) for row in fixtures]
    data["feedback"] = [row_to_dict(row) for row in feedback_rows]
    return data


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/admin/login")
def login(body: LoginRequest) -> dict[str, Any]:
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (body.email.lower().strip(),)).fetchone()
        if user is None or user["password_hash"] != hash_password(body.password):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        token = secrets.token_urlsafe(32)
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user["id"], now_iso()),
        )
        conn.commit()
    return {
        "token": token,
        "user": {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]},
    }


@app.get("/api/admin/me")
def me(user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return {"user": user}


@app.get("/api/admin/projects")
def list_projects(user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY id DESC").fetchall()
    return {"projects": [project_payload(row) for row in rows]}


@app.post("/api/admin/projects")
def create_project(
    project_name: str = Form(...),
    client_name: str = Form(...),
    client_phone: str = Form(""),
    location: str = Form(""),
    shop_width: float | None = Form(None),
    shop_length: float | None = Form(None),
    shop_height: float | None = Form(None),
    unit: str = Form("ft"),
    panorama: UploadFile = File(...),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    if not panorama.filename:
        raise HTTPException(status_code=400, detail="Panorama image is required")

    content_type = panorama.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are allowed")

    filename = safe_filename(panorama.filename)
    filepath = UPLOAD_DIR / filename
    with filepath.open("wb") as out_file:
        shutil.copyfileobj(panorama.file, out_file)

    with get_db() as conn:
        code = generate_code()
        while conn.execute("SELECT id FROM projects WHERE unique_code = ?", (code,)).fetchone() is not None:
            code = generate_code()
        created = now_iso()
        cursor = conn.execute(
            """
            INSERT INTO projects (
                unique_code, project_name, client_name, client_phone, location,
                panorama_filename, shop_width, shop_length, shop_height, unit,
                status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                code,
                project_name,
                client_name,
                client_phone,
                location,
                filename,
                shop_width,
                shop_length,
                shop_height,
                unit,
                "draft",
                created,
                created,
            ),
        )
        conn.commit()
        project_id = cursor.lastrowid
    return {"project": full_project_payload(project_id)}


@app.get("/api/admin/projects/{project_id}")
def get_project(project_id: int, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return {"project": full_project_payload(project_id)}


@app.put("/api/admin/projects/{project_id}")
def update_project(
    project_id: int,
    body: ProjectUpdate,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {"project": full_project_payload(project_id)}
    allowed = {
        "project_name",
        "client_name",
        "client_phone",
        "location",
        "shop_width",
        "shop_length",
        "shop_height",
        "unit",
        "status",
    }
    updates = {key: value for key, value in fields.items() if key in allowed}
    updates["updated_at"] = now_iso()
    set_clause = ", ".join(f"{key} = ?" for key in updates.keys())
    values = list(updates.values()) + [project_id]
    with get_db() as conn:
        exists = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.execute(f"UPDATE projects SET {set_clause} WHERE id = ?", values)
        conn.commit()
    return {"project": full_project_payload(project_id)}


@app.delete("/api/admin/projects/{project_id}")
def delete_project(project_id: int, user: dict[str, Any] = Depends(require_admin)) -> dict[str, str]:
    with get_db() as conn:
        project = conn.execute("SELECT panorama_filename FROM projects WHERE id = ?", (project_id,)).fetchone()
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
    file_path = UPLOAD_DIR / project["panorama_filename"]
    if file_path.exists() and project["panorama_filename"] != "walltron-demo.jpeg":
        file_path.unlink(missing_ok=True)
    return {"message": "Project deleted"}


@app.post("/api/admin/projects/{project_id}/measurements")
def add_measurement(
    project_id: int,
    body: MeasurementCreate,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    with get_db() as conn:
        if conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.execute(
            """
            INSERT INTO measurements
            (project_id, side_name, width, height, unit, yaw, pitch, remarks, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                body.side_name,
                body.width,
                body.height,
                body.unit,
                body.yaw,
                body.pitch,
                body.remarks,
                now_iso(),
            ),
        )
        conn.commit()
    return {"project": full_project_payload(project_id)}


@app.put("/api/admin/measurements/{measurement_id}")
def update_measurement(
    measurement_id: int,
    body: MeasurementUpdate,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        with get_db() as conn:
            row = conn.execute("SELECT project_id FROM measurements WHERE id = ?", (measurement_id,)).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Measurement not found")
            return {"project": full_project_payload(row["project_id"])}

    allowed = {"side_name", "width", "height", "unit", "yaw", "pitch", "remarks"}
    updates = {key: value for key, value in fields.items() if key in allowed}
    set_clause = ", ".join(f"{key} = ?" for key in updates.keys())
    values = list(updates.values()) + [measurement_id]

    with get_db() as conn:
        row = conn.execute("SELECT project_id FROM measurements WHERE id = ?", (measurement_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Measurement not found")
        project_id = row["project_id"]
        conn.execute(f"UPDATE measurements SET {set_clause} WHERE id = ?", values)
        conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now_iso(), project_id))
        conn.commit()
    return {"project": full_project_payload(project_id)}


@app.delete("/api/admin/measurements/{measurement_id}")
def delete_measurement(measurement_id: int, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute("SELECT project_id FROM measurements WHERE id = ?", (measurement_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Measurement not found")
        project_id = row["project_id"]
        conn.execute("DELETE FROM measurements WHERE id = ?", (measurement_id,))
        conn.commit()
    return {"project": full_project_payload(project_id)}


@app.post("/api/admin/projects/{project_id}/fixtures")
def add_fixture(
    project_id: int,
    body: FixtureCreate,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    with get_db() as conn:
        if conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.execute(
            """
            INSERT INTO fixtures
            (project_id, fixture_name, fixture_type, width, height, depth, unit, yaw, pitch, scale, color, remarks, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                body.fixture_name,
                body.fixture_type,
                body.width,
                body.height,
                body.depth,
                body.unit,
                body.yaw,
                body.pitch,
                body.scale,
                body.color,
                body.remarks,
                now_iso(),
            ),
        )
        conn.commit()
    return {"project": full_project_payload(project_id)}


@app.delete("/api/admin/fixtures/{fixture_id}")
def delete_fixture(fixture_id: int, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute("SELECT project_id FROM fixtures WHERE id = ?", (fixture_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Fixture not found")
        project_id = row["project_id"]
        conn.execute("DELETE FROM fixtures WHERE id = ?", (fixture_id,))
        conn.commit()
    return {"project": full_project_payload(project_id)}


@app.get("/api/public/projects/{unique_code}")
def get_public_project(unique_code: str) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM projects WHERE UPPER(unique_code) = UPPER(?)",
            (unique_code.strip(),),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Preview code not found")
    return {"project": full_project_payload(row["id"], public_base_url=PUBLIC_BASE_URL)}


@app.post("/api/public/projects/{unique_code}/feedback")
def add_public_feedback(unique_code: str, body: FeedbackCreate) -> dict[str, str]:
    with get_db() as conn:
        project = conn.execute("SELECT id FROM projects WHERE UPPER(unique_code) = UPPER(?)", (unique_code.strip(),)).fetchone()
        if project is None:
            raise HTTPException(status_code=404, detail="Preview code not found")
        conn.execute(
            "INSERT INTO feedback (project_id, name, message, status, created_at) VALUES (?, ?, ?, ?, ?)",
            (project["id"], body.name, body.message, "new", now_iso()),
        )
        conn.commit()
    return {"message": "Feedback submitted"}


@app.get("/uploads/{filename}")
def get_upload(filename: str) -> FileResponse:
    path = UPLOAD_DIR / Path(filename).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
