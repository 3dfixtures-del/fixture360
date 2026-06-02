from __future__ import annotations

import hashlib
import os
import re
import secrets
import shutil
import string
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from bson import ObjectId
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError, PyMongoError

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR))).resolve()
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(DATA_DIR / "uploads"))).resolve()
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "fixture360")

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
db: Database = mongo_client[MONGODB_DB]

app = FastAPI(title="Fixture360 API", version="2.0.0")


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


app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def generate_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "FX-" + "".join(secrets.choice(alphabet) for _ in range(6))


def safe_filename(filename: str) -> str:
    name = Path(filename).name
    stem = Path(name).stem[:48].replace(" ", "-") or "panorama"
    stem = re.sub(r"[^A-Za-z0-9._-]", "-", stem)
    suffix = Path(name).suffix.lower() or ".jpg"
    token = secrets.token_hex(4)
    return f"{stem}-{token}{suffix}"


def object_id(value: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=404, detail="Invalid id")
    return ObjectId(value)


def setup_indexes() -> None:
    db.users.create_index([("email", ASCENDING)], unique=True)
    db.sessions.create_index([("token", ASCENDING)], unique=True)
    db.sessions.create_index([("user_id", ASCENDING)])
    db.projects.create_index([("unique_code", ASCENDING)], unique=True)
    db.projects.create_index([("created_at", DESCENDING)])
    db.projects.create_index([("measurements.id", ASCENDING)])
    db.projects.create_index([("fixtures.id", ASCENDING)])


def ensure_demo_panorama() -> None:
    target = UPLOAD_DIR / "walltron-demo.jpeg"
    if target.exists():
        return
    candidates = [
        BASE_DIR / "uploads" / "walltron-demo.jpeg",
        PROJECT_DIR / "sample" / "walltron-demo-panorama.jpeg",
        PROJECT_DIR / "sample" / "walltron-demo.jpeg",
    ]
    for source in candidates:
        if source.exists():
            shutil.copyfile(source, target)
            return


def seed_data() -> None:
    created = now_iso()

    if db.users.find_one({"email": "admin@fixture360.local"}) is None:
        db.users.insert_one({
            "name": "Fixture360 Admin",
            "email": "admin@fixture360.local",
            "password_hash": hash_password("admin123"),
            "role": "admin",
            "created_at": created,
        })

    ensure_demo_panorama()
    if db.projects.find_one({"unique_code": "DEMO360"}) is None and (UPLOAD_DIR / "walltron-demo.jpeg").exists():
        project_id = ObjectId()
        db.projects.insert_one({
            "_id": project_id,
            "unique_code": "DEMO360",
            "project_name": "Walltron Shop Fixture Preview",
            "client_name": "Demo Client",
            "client_phone": "",
            "location": "Demo Retail Space",
            "panorama_filename": "walltron-demo.jpeg",
            "shop_width": 18,
            "shop_length": 24,
            "shop_height": 10,
            "unit": "ft",
            "status": "published",
            "measurements": [
                {
                    "id": str(ObjectId()),
                    "side_name": "Front Display Wall",
                    "width": 18,
                    "height": 10,
                    "unit": "ft",
                    "yaw": -25,
                    "pitch": 2,
                    "remarks": "Main customer-facing wall",
                    "created_at": created,
                },
                {
                    "id": str(ObjectId()),
                    "side_name": "Left Product Wall",
                    "width": 12,
                    "height": 10,
                    "unit": "ft",
                    "yaw": -92,
                    "pitch": 0,
                    "remarks": "Exterior/interior wall shelf zone",
                    "created_at": created,
                },
                {
                    "id": str(ObjectId()),
                    "side_name": "Right Branding Wall",
                    "width": 12,
                    "height": 10,
                    "unit": "ft",
                    "yaw": 62,
                    "pitch": 1,
                    "remarks": "Round Walltron display zone",
                    "created_at": created,
                },
                {
                    "id": str(ObjectId()),
                    "side_name": "Ceiling Height",
                    "width": 18,
                    "height": 10,
                    "unit": "ft",
                    "yaw": 0,
                    "pitch": 46,
                    "remarks": "Overall height reference",
                    "created_at": created,
                },
            ],
            "fixtures": [
                {
                    "id": str(ObjectId()),
                    "fixture_name": "Premium Wall Shelf",
                    "fixture_type": "Wall Display",
                    "width": 8,
                    "height": 7,
                    "depth": 1,
                    "unit": "ft",
                    "yaw": -38,
                    "pitch": -4,
                    "scale": 1.1,
                    "color": "#CF1E01",
                    "remarks": "Proposed shelf fixture",
                    "created_at": created,
                },
                {
                    "id": str(ObjectId()),
                    "fixture_name": "Circular Product Island",
                    "fixture_type": "Center Display",
                    "width": 6,
                    "height": 6,
                    "depth": 2,
                    "unit": "ft",
                    "yaw": 50,
                    "pitch": -5,
                    "scale": 1.0,
                    "color": "#101828",
                    "remarks": "Hero product display",
                    "created_at": created,
                },
            ],
            "feedback": [],
            "created_at": created,
            "updated_at": created,
        })


@app.on_event("startup")
def startup() -> None:
    try:
        mongo_client.admin.command("ping")
        setup_indexes()
        seed_data()
    except PyMongoError as exc:
        raise RuntimeError(f"Could not connect to MongoDB. Check MONGODB_URI. Details: {exc}") from exc


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
    session = db.sessions.find_one({"token": token})
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid session")
    user = db.users.find_one({"_id": session["user_id"]})
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid session")
    return {"id": str(user["_id"]), "name": user["name"], "email": user["email"], "role": user["role"]}


def project_payload(project: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(project["_id"]),
        "unique_code": project.get("unique_code"),
        "project_name": project.get("project_name"),
        "client_name": project.get("client_name"),
        "client_phone": project.get("client_phone", ""),
        "location": project.get("location", ""),
        "panorama_filename": project.get("panorama_filename"),
        "panorama_url": f"/uploads/{project.get('panorama_filename')}",
        "shop_width": project.get("shop_width"),
        "shop_length": project.get("shop_length"),
        "shop_height": project.get("shop_height"),
        "unit": project.get("unit", "ft"),
        "status": project.get("status", "draft"),
        "created_at": project.get("created_at"),
        "updated_at": project.get("updated_at"),
    }


def full_project_payload(project_id: str | ObjectId, public_base_url: str = "") -> dict[str, Any]:
    oid = project_id if isinstance(project_id, ObjectId) else object_id(project_id)
    project = db.projects.find_one({"_id": oid})
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    data = project_payload(project)
    data["panorama_url"] = public_base_url + data["panorama_url"]
    data["measurements"] = project.get("measurements", [])
    data["fixtures"] = project.get("fixtures", [])
    data["feedback"] = sorted(project.get("feedback", []), key=lambda item: item.get("created_at", ""), reverse=True)
    return data


@app.get("/api/health")
def health() -> dict[str, str]:
    mongo_client.admin.command("ping")
    return {"status": "ok", "database": "mongodb"}


@app.post("/api/admin/login")
def login(body: LoginRequest) -> dict[str, Any]:
    user = db.users.find_one({"email": body.email.lower().strip()})
    if user is None or user["password_hash"] != hash_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = secrets.token_urlsafe(32)
    db.sessions.insert_one({"token": token, "user_id": user["_id"], "created_at": now_iso()})
    return {
        "token": token,
        "user": {"id": str(user["_id"]), "name": user["name"], "email": user["email"], "role": user["role"]},
    }


@app.get("/api/admin/me")
def me(user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return {"user": user}


@app.get("/api/admin/projects")
def list_projects(user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    rows = list(db.projects.find({}).sort("created_at", DESCENDING))
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

    created = now_iso()
    for _ in range(10):
        code = generate_code()
        try:
            result = db.projects.insert_one({
                "unique_code": code,
                "project_name": project_name,
                "client_name": client_name,
                "client_phone": client_phone,
                "location": location,
                "panorama_filename": filename,
                "shop_width": shop_width,
                "shop_length": shop_length,
                "shop_height": shop_height,
                "unit": unit,
                "status": "draft",
                "measurements": [],
                "fixtures": [],
                "feedback": [],
                "created_at": created,
                "updated_at": created,
            })
            return {"project": full_project_payload(result.inserted_id)}
        except DuplicateKeyError:
            continue
    raise HTTPException(status_code=500, detail="Could not generate a unique preview code")


@app.get("/api/admin/projects/{project_id}")
def get_project(project_id: str, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return {"project": full_project_payload(project_id)}


@app.put("/api/admin/projects/{project_id}")
def update_project(project_id: str, body: ProjectUpdate, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
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
    result = db.projects.update_one({"_id": object_id(project_id)}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": full_project_payload(project_id)}


@app.delete("/api/admin/projects/{project_id}")
def delete_project(project_id: str, user: dict[str, Any] = Depends(require_admin)) -> dict[str, str]:
    project = db.projects.find_one({"_id": object_id(project_id)})
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    db.projects.delete_one({"_id": object_id(project_id)})
    file_path = UPLOAD_DIR / project["panorama_filename"]
    if file_path.exists() and project["panorama_filename"] != "walltron-demo.jpeg":
        file_path.unlink(missing_ok=True)
    return {"message": "Project deleted"}


@app.post("/api/admin/projects/{project_id}/measurements")
def add_measurement(project_id: str, body: MeasurementCreate, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    item = body.model_dump()
    item["id"] = str(ObjectId())
    item["created_at"] = now_iso()
    result = db.projects.update_one(
        {"_id": object_id(project_id)},
        {"$push": {"measurements": item}, "$set": {"updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": full_project_payload(project_id)}


@app.put("/api/admin/measurements/{measurement_id}")
def update_measurement(measurement_id: str, body: MeasurementUpdate, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    fields = body.model_dump(exclude_unset=True)
    project = db.projects.find_one({"measurements.id": measurement_id})
    if project is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    if fields:
        allowed = {"side_name", "width", "height", "unit", "yaw", "pitch", "remarks"}
        updates = {f"measurements.$.{key}": value for key, value in fields.items() if key in allowed}
        updates["updated_at"] = now_iso()
        db.projects.update_one({"measurements.id": measurement_id}, {"$set": updates})
    return {"project": full_project_payload(project["_id"])}


@app.delete("/api/admin/measurements/{measurement_id}")
def delete_measurement(measurement_id: str, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    project = db.projects.find_one({"measurements.id": measurement_id})
    if project is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    db.projects.update_one(
        {"_id": project["_id"]},
        {"$pull": {"measurements": {"id": measurement_id}}, "$set": {"updated_at": now_iso()}},
    )
    return {"project": full_project_payload(project["_id"])}


@app.post("/api/admin/projects/{project_id}/fixtures")
def add_fixture(project_id: str, body: FixtureCreate, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    item = body.model_dump()
    item["id"] = str(ObjectId())
    item["created_at"] = now_iso()
    result = db.projects.update_one(
        {"_id": object_id(project_id)},
        {"$push": {"fixtures": item}, "$set": {"updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": full_project_payload(project_id)}


@app.delete("/api/admin/fixtures/{fixture_id}")
def delete_fixture(fixture_id: str, user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    project = db.projects.find_one({"fixtures.id": fixture_id})
    if project is None:
        raise HTTPException(status_code=404, detail="Fixture not found")
    db.projects.update_one(
        {"_id": project["_id"]},
        {"$pull": {"fixtures": {"id": fixture_id}}, "$set": {"updated_at": now_iso()}},
    )
    return {"project": full_project_payload(project["_id"])}


@app.get("/api/public/projects/{unique_code}")
def get_public_project(unique_code: str) -> dict[str, Any]:
    code = unique_code.strip().upper()
    project = db.projects.find_one({"unique_code": code})
    if project is None:
        raise HTTPException(status_code=404, detail="Preview code not found")
    return {"project": full_project_payload(project["_id"], public_base_url=PUBLIC_BASE_URL)}


@app.post("/api/public/projects/{unique_code}/feedback")
def add_public_feedback(unique_code: str, body: FeedbackCreate) -> dict[str, str]:
    code = unique_code.strip().upper()
    feedback = {
        "id": str(ObjectId()),
        "name": body.name,
        "message": body.message,
        "status": "new",
        "created_at": now_iso(),
    }
    result = db.projects.update_one({"unique_code": code}, {"$push": {"feedback": feedback}, "$set": {"updated_at": now_iso()}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Preview code not found")
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
