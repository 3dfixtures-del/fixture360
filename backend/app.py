from __future__ import annotations

import hashlib
import os
import re
import secrets
import shutil
import string
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import json
from copy import deepcopy
from dataclasses import dataclass

import psycopg
from psycopg.rows import dict_row

try:
    import cloudinary
    import cloudinary.uploader
except Exception:  # Cloudinary is optional for local fallback installs.
    cloudinary = None

ASCENDING = 1
DESCENDING = -1


class DuplicateKeyError(Exception):
    pass


class PyMongoError(Exception):
    pass


class ObjectId(str):
    def __new__(cls, value: str | None = None):
        return str.__new__(cls, value or secrets.token_hex(12))

    @staticmethod
    def is_valid(value: str) -> bool:
        return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-fA-F]{24}", value))


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR))).resolve()
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(DATA_DIR / "uploads"))).resolve()
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")

CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
CLOUDINARY_API_KEY = os.getenv("CLOUDINARY_API_KEY", "").strip()
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET", "").strip()
CLOUDINARY_FOLDER = os.getenv("CLOUDINARY_FOLDER", "fixture360").strip() or "fixture360"
USE_CLOUDINARY = bool(CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET and cloudinary is not None)

if USE_CLOUDINARY:
    cloudinary.config(
        cloud_name=CLOUDINARY_CLOUD_NAME,
        api_key=CLOUDINARY_API_KEY,
        api_secret=CLOUDINARY_API_SECRET,
        secure=True,
    )

DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("NEON_DATABASE_URL")
if not DATABASE_URL:
    # Local PostgreSQL fallback. For Neon, set DATABASE_URL in the terminal or hosting dashboard.
    DATABASE_URL = "postgresql://localhost:5432/fixture360"

ADMIN_EMAIL = "adminfixtures@adinn.co.in"
LEGACY_ADMIN_EMAIL = "admin@fixture360.local"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class InsertOneResult:
    inserted_id: str


@dataclass
class UpdateResult:
    matched_count: int
    modified_count: int = 0


@dataclass
class DeleteResult:
    deleted_count: int


class PostgresCursor(list):
    def sort(self, field: str, direction: int):
        reverse = direction == DESCENDING
        return PostgresCursor(sorted(self, key=lambda row: row.get(field) or "", reverse=reverse))


def _normalize_doc(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: _normalize_doc(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_doc(v) for v in value]
    return value


def _nested_get(doc: dict[str, Any], dotted: str) -> Any:
    current: Any = doc
    for part in dotted.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _matches(doc: dict[str, Any], query: dict[str, Any] | None) -> bool:
    if not query:
        return True
    for key, expected in query.items():
        expected = str(expected) if isinstance(expected, ObjectId) else expected
        if "." in key:
            first, rest = key.split(".", 1)
            array_value = doc.get(first)
            if isinstance(array_value, list):
                if not any(_nested_get(item, rest) == expected for item in array_value if isinstance(item, dict)):
                    return False
            else:
                if _nested_get(doc, key) != expected:
                    return False
        else:
            actual = doc.get(key)
            if isinstance(actual, ObjectId):
                actual = str(actual)
            if actual != expected:
                return False
    return True


def _set_nested(doc: dict[str, Any], dotted: str, value: Any, filter_query: dict[str, Any] | None = None) -> None:
    if ".$." in dotted:
        array_name, rest = dotted.split(".$.", 1)
        array_value = doc.get(array_name, [])
        target_id = None
        if filter_query:
            target_id = filter_query.get(f"{array_name}.id")
        if isinstance(array_value, list):
            for item in array_value:
                if isinstance(item, dict) and (target_id is None or item.get("id") == target_id):
                    item[rest] = value
                    break
        return
    parts = dotted.split(".")
    current = doc
    for part in parts[:-1]:
        current = current.setdefault(part, {})
    current[parts[-1]] = value


class PostgresCollection:
    def __init__(self, store: "PostgresStore", name: str):
        self.store = store
        self.name = name

    def create_index(self, *args, **kwargs) -> None:
        return None

    def _all_docs(self) -> list[dict[str, Any]]:
        with self.store.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(f"SELECT id, doc FROM {self.name}")
            rows = cur.fetchall()
        docs = []
        for row in rows:
            doc = row["doc"]
            if isinstance(doc, str):
                doc = json.loads(doc)
            doc["_id"] = row["id"]
            docs.append(doc)
        return docs

    def _save_doc(self, doc: dict[str, Any]) -> None:
        doc = _normalize_doc(deepcopy(doc))
        doc_id = str(doc.get("_id") or ObjectId())
        doc["_id"] = doc_id
        with self.store.connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.name} (id, doc) VALUES (%s, %s::jsonb) "
                f"ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc",
                (doc_id, json.dumps(doc)),
            )

    def _ensure_unique(self, doc: dict[str, Any], old_id: str | None = None) -> None:
        if self.name == "users":
            for field in ("email", "employee_id"):
                value = doc.get(field)
                if not value:
                    continue
                existing = self.find_one({field: value})
                if existing and str(existing.get("_id")) != str(old_id or doc.get("_id")):
                    raise DuplicateKeyError(f"Duplicate {field}")
        if self.name == "projects":
            value = doc.get("unique_code")
            if value:
                existing = self.find_one({"unique_code": value})
                if existing and str(existing.get("_id")) != str(old_id or doc.get("_id")):
                    raise DuplicateKeyError("Duplicate unique_code")
        if self.name == "sessions":
            value = doc.get("token")
            if value:
                existing = self.find_one({"token": value})
                if existing and str(existing.get("_id")) != str(old_id or doc.get("_id")):
                    raise DuplicateKeyError("Duplicate token")

    def find_one(self, query: dict[str, Any] | None = None) -> dict[str, Any] | None:
        for doc in self._all_docs():
            if _matches(doc, query):
                return doc
        return None

    def find(self, query: dict[str, Any] | None = None) -> PostgresCursor:
        return PostgresCursor([doc for doc in self._all_docs() if _matches(doc, query)])

    def insert_one(self, doc: dict[str, Any]) -> InsertOneResult:
        doc = _normalize_doc(deepcopy(doc))
        doc_id = str(doc.get("_id") or ObjectId())
        doc["_id"] = doc_id
        self._ensure_unique(doc, old_id=doc_id)
        self._save_doc(doc)
        return InsertOneResult(inserted_id=doc_id)

    def update_one(self, query: dict[str, Any], update: dict[str, Any]) -> UpdateResult:
        doc = self.find_one(query)
        if doc is None:
            return UpdateResult(matched_count=0, modified_count=0)
        old_id = str(doc.get("_id"))
        if "$set" in update:
            for key, value in update["$set"].items():
                _set_nested(doc, key, value, query)
        if "$push" in update:
            for key, value in update["$push"].items():
                target = doc.setdefault(key, [])
                if isinstance(value, dict) and "$each" in value:
                    target.extend(value["$each"] or [])
                else:
                    target.append(value)
        if "$pull" in update:
            for key, criteria in update["$pull"].items():
                target = doc.get(key, [])
                if isinstance(target, list) and isinstance(criteria, dict):
                    doc[key] = [item for item in target if not _matches(item, criteria)]
        if "$inc" in update:
            for key, amount in update["$inc"].items():
                doc[key] = int(doc.get(key) or 0) + int(amount)
        self._ensure_unique(doc, old_id=old_id)
        self._save_doc(doc)
        return UpdateResult(matched_count=1, modified_count=1)

    def delete_one(self, query: dict[str, Any]) -> DeleteResult:
        doc = self.find_one(query)
        if doc is None:
            return DeleteResult(deleted_count=0)
        with self.store.connect() as conn, conn.cursor() as cur:
            cur.execute(f"DELETE FROM {self.name} WHERE id = %s", (str(doc["_id"]),))
        return DeleteResult(deleted_count=1)

    def delete_many(self, query: dict[str, Any]) -> DeleteResult:
        docs = self.find(query)
        deleted = 0
        with self.store.connect() as conn, conn.cursor() as cur:
            for doc in docs:
                cur.execute(f"DELETE FROM {self.name} WHERE id = %s", (str(doc["_id"]),))
                deleted += 1
        return DeleteResult(deleted_count=deleted)


class PostgresStore:
    def __init__(self, database_url: str):
        self.database_url = database_url
        self.users = PostgresCollection(self, "users")
        self.sessions = PostgresCollection(self, "sessions")
        self.projects = PostgresCollection(self, "projects")

    def connect(self):
        return psycopg.connect(self.database_url)

    def ping(self) -> None:
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()

    def init_schema(self) -> None:
        with self.connect() as conn, conn.cursor() as cur:
            for table in ("users", "sessions", "projects"):
                cur.execute(f"CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, doc JSONB NOT NULL)")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users ((lower(doc->>'email')))")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id_unique ON users ((doc->>'employee_id')) WHERE doc ? 'employee_id'")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_unique ON sessions ((doc->>'token'))")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS projects_unique_code_unique ON projects ((upper(doc->>'unique_code')))")
            cur.execute("CREATE INDEX IF NOT EXISTS projects_created_at_idx ON projects ((doc->>'created_at'))")


db = PostgresStore(DATABASE_URL)

app = FastAPI(title="Fixture360 API", version="4.0.0")


DEFAULT_PERMISSIONS = {
    "view_project": False,
    "create_project": False,
    "edit_project": False,
    "delete_project": False,
    "publish_project": False,
    "manage_employees": False,
}

ALL_PERMISSIONS = {key: True for key in DEFAULT_PERMISSIONS}


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


def now_dt() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_dt().isoformat()


def iso_from_dt(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def validate_validity(days: int, hours: int) -> tuple[int, int]:
    days = int(days or 0)
    hours = int(hours or 0)
    if days < 0 or hours < 0:
        raise HTTPException(status_code=400, detail="Validity days and hours cannot be negative")
    if days == 0 and hours == 0:
        raise HTTPException(status_code=400, detail="Validity must be at least 1 hour")
    return days, hours


def calculate_valid_until(days: int, hours: int) -> str:
    days, hours = validate_validity(days, hours)
    return iso_from_dt(now_dt() + timedelta(days=days, hours=hours))


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def generate_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "FX-" + "".join(secrets.choice(alphabet) for _ in range(6))


def clean_email(value: str) -> str:
    return value.lower().strip()


def safe_filename(filename: str, fallback: str = "upload") -> str:
    name = Path(filename or fallback).name
    stem = Path(name).stem[:48].replace(" ", "-") or fallback
    stem = re.sub(r"[^A-Za-z0-9._-]", "-", stem)
    suffix = Path(name).suffix.lower() or ".bin"
    token = secrets.token_hex(5)
    return f"{stem}-{token}{suffix}"


def object_id(value: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=404, detail="Invalid id")
    return ObjectId(value)


def normalized_permissions(raw: dict[str, Any] | None, role: str = "employee") -> dict[str, bool]:
    if role == "admin":
        return dict(ALL_PERMISSIONS)
    data = dict(DEFAULT_PERMISSIONS)
    if raw:
        for key in data:
            data[key] = bool(raw.get(key))
    return data


def user_payload(user: dict[str, Any]) -> dict[str, Any]:
    role = user.get("role", "employee")
    return {
        "id": str(user["_id"]),
        "employee_id": user.get("employee_id", str(user["_id"])),
        "name": user.get("name", ""),
        "email": user.get("email", ""),
        "role": role,
        "permissions": normalized_permissions(user.get("permissions"), role),
        "is_active": bool(user.get("is_active", True)),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
    }


def setup_indexes() -> None:
    db.users.create_index([("email", ASCENDING)], unique=True)
    db.users.create_index([("employee_id", ASCENDING)], unique=True, sparse=True)
    db.sessions.create_index([("token", ASCENDING)], unique=True)
    db.sessions.create_index([("user_id", ASCENDING)])
    db.projects.create_index([("unique_code", ASCENDING)], unique=True)
    db.projects.create_index([("created_at", DESCENDING)])
    db.projects.create_index([("measurements.id", ASCENDING)])
    db.projects.create_index([("fixtures.id", ASCENDING)])
    db.projects.create_index([("media.id", ASCENDING)])


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


def media_url(filename: str | None, public_base_url: str = "") -> str:
    if not filename:
        return ""
    if isinstance(filename, str) and filename.startswith(("http://", "https://")):
        return filename
    return f"{public_base_url}/uploads/{filename}"


def media_payload(media: dict[str, Any], public_base_url: str = "") -> dict[str, Any]:
    item = dict(media)
    item["url"] = item.get("url") or media_url(item.get("filename"), public_base_url)
    return item


def sort_media(media: list[dict[str, Any]]) -> list[dict[str, Any]]:
    priority = {"site_photo": 1, "ricky_image": 2, "recce_image": 2, "diagram_pdf": 3, "panorama": 4}
    return sorted(media or [], key=lambda item: (priority.get(item.get("type"), 99), item.get("order", 0), item.get("created_at", "")))


def cloudinary_resource_type(media_type: str) -> str:
    # PDFs and future non-image files should be accepted. Cloudinary detects the proper type with "auto".
    return "auto" if media_type == "diagram_pdf" else "image"


def upload_to_cloudinary(upload: UploadFile, filename: str, media_type: str) -> dict[str, Any]:
    if not USE_CLOUDINARY:
        return {}
    if cloudinary is None:
        raise HTTPException(status_code=500, detail="Cloudinary library is not installed")
    try:
        upload.file.seek(0)
        public_id = f"{CLOUDINARY_FOLDER}/{Path(filename).stem}"
        result = cloudinary.uploader.upload(
            upload.file,
            public_id=public_id,
            resource_type=cloudinary_resource_type(media_type),
            overwrite=False,
            use_filename=False,
            unique_filename=False,
        )
        return {
            "url": result.get("secure_url") or result.get("url"),
            "cloudinary_public_id": result.get("public_id"),
            "cloudinary_resource_type": result.get("resource_type") or cloudinary_resource_type(media_type),
            "cloudinary_format": result.get("format"),
            "storage": "cloudinary",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cloudinary upload failed: {exc}") from exc


def delete_cloudinary_media(item: dict[str, Any]) -> None:
    if not item or item.get("storage") != "cloudinary" or not item.get("cloudinary_public_id"):
        return
    if not USE_CLOUDINARY or cloudinary is None:
        return
    try:
        cloudinary.uploader.destroy(
            item["cloudinary_public_id"],
            resource_type=item.get("cloudinary_resource_type") or "image",
        )
    except Exception:
        # Do not block project deletion if remote cleanup fails.
        return


def make_media_item(upload: UploadFile, media_type: str, order: int, label: str | None = None) -> dict[str, Any]:
    if not upload or not upload.filename:
        raise HTTPException(status_code=400, detail="Upload file is missing")

    content_type = upload.content_type or ""
    if media_type in {"site_photo", "ricky_image", "recce_image", "panorama"} and not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are allowed for photos and panoramas")
    if media_type == "diagram_pdf" and content_type not in {"application/pdf", "application/octet-stream"}:
        if not upload.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF uploads are allowed for 2D diagrams")

    fallback = "panorama" if media_type == "panorama" else "ricky" if media_type in {"ricky_image", "recce_image"} else "site-photo" if media_type == "site_photo" else "diagram"
    filename = safe_filename(upload.filename, fallback=fallback)

    item = {
        "id": str(ObjectId()),
        "type": media_type,
        "label": label or upload.filename,
        "filename": filename,
        "original_filename": upload.filename,
        "content_type": content_type,
        "order": order,
        "created_at": now_iso(),
    }

    if USE_CLOUDINARY:
        item.update(upload_to_cloudinary(upload, filename, media_type))
    else:
        filepath = UPLOAD_DIR / filename
        upload.file.seek(0)
        with filepath.open("wb") as out_file:
            shutil.copyfileobj(upload.file, out_file)
        item["storage"] = "local"

    return item


def indexed_label(labels: list[str] | None, index: int, fallback: str) -> str:
    if labels and index < len(labels) and labels[index].strip():
        return labels[index].strip()
    return fallback


def seed_data() -> None:
    created = now_iso()

    existing_new = db.users.find_one({"email": ADMIN_EMAIL})
    existing_old = db.users.find_one({"email": LEGACY_ADMIN_EMAIL})
    admin_doc = {
        "name": "Fixture360 Admin",
        "employee_id": "ADMIN-001",
        "email": ADMIN_EMAIL,
        "password_hash": hash_password("admin123"),
        "role": "admin",
        "permissions": ALL_PERMISSIONS,
        "is_active": True,
        "created_at": created,
        "updated_at": created,
    }
    if existing_new is None and existing_old is not None:
        db.users.update_one({"_id": existing_old["_id"]}, {"$set": admin_doc})
    elif existing_new is None:
        db.users.insert_one(admin_doc)
    else:
        db.users.update_one(
            {"_id": existing_new["_id"]},
            {"$set": {"role": "admin", "permissions": ALL_PERMISSIONS, "is_active": True, "employee_id": existing_new.get("employee_id", "ADMIN-001")}},
        )

    ensure_demo_panorama()
    if db.projects.find_one({"unique_code": "DEMO360"}) is None and (UPLOAD_DIR / "walltron-demo.jpeg").exists():
        admin = db.users.find_one({"email": ADMIN_EMAIL})
        created_by = user_payload(admin) if admin else {"id": "system", "employee_id": "SYSTEM", "name": "System", "email": "", "role": "admin"}
        valid_until = iso_from_dt(now_dt() + timedelta(days=365))
        db.projects.insert_one({
            "unique_code": "DEMO360",
            "valid_days": 365,
            "valid_hours": 0,
            "valid_until": valid_until,
            "max_views": 0,
            "code_history": [{"code": "DEMO360", "valid_days": 365, "valid_hours": 0, "valid_until": valid_until, "max_views": 0, "created_at": created, "generated_reason": "demo_seed"}],
            "project_name": "Walltron Shop Fixture Preview",
            "client_name": "Demo Client",
            "client_phone": "",
            "location": "Demo Retail Space",
            "shop_width": 18,
            "shop_length": 24,
            "shop_height": 10,
            "unit": "ft",
            "status": "published",
            "media": [
                {
                    "id": str(ObjectId()),
                    "type": "panorama",
                    "label": "Demo 360 View 1",
                    "filename": "walltron-demo.jpeg",
                    "original_filename": "walltron-demo.jpeg",
                    "content_type": "image/jpeg",
                    "order": 1,
                    "created_at": created,
                }
            ],
            "panorama_filename": "walltron-demo.jpeg",
            "measurements": [
                {"id": str(ObjectId()), "side_name": "Front Display Wall", "width": 18, "height": 10, "depth": 0, "unit": "ft", "yaw": -25, "pitch": 2, "remarks": "Main customer-facing wall", "created_at": created},
                {"id": str(ObjectId()), "side_name": "Left Product Wall", "width": 12, "height": 10, "depth": 0, "unit": "ft", "yaw": -92, "pitch": 0, "remarks": "Exterior/interior wall shelf zone", "created_at": created},
                {"id": str(ObjectId()), "side_name": "Right Branding Wall", "width": 12, "height": 10, "depth": 0, "unit": "ft", "yaw": 62, "pitch": 1, "remarks": "Round Walltron display zone", "created_at": created},
                {"id": str(ObjectId()), "side_name": "Ceiling Height", "width": 18, "height": 10, "depth": 0, "unit": "ft", "yaw": 0, "pitch": 46, "remarks": "Overall height reference", "created_at": created},
            ],
            "fixtures": [
                {"id": str(ObjectId()), "fixture_name": "Premium Wall Shelf", "fixture_type": "Wall Display", "width": 8, "height": 7, "depth": 1, "unit": "ft", "yaw": -38, "pitch": -4, "scale": 1.1, "color": "#CF1E01", "remarks": "Proposed shelf fixture", "created_at": created},
                {"id": str(ObjectId()), "fixture_name": "Circular Product Island", "fixture_type": "Center Display", "width": 6, "height": 6, "depth": 2, "unit": "ft", "yaw": 50, "pitch": -5, "scale": 1.0, "color": "#101828", "remarks": "Hero product display", "created_at": created},
            ],
            "feedback": [],
            "views": [],
            "viewer_count": 0,
            "created_by": created_by,
            "created_by_user_id": created_by.get("id"),
            "created_by_employee_id": created_by.get("employee_id"),
            "created_by_name": created_by.get("name"),
            "created_at": created,
            "updated_at": created,
        })


@app.on_event("startup")
def startup() -> None:
    try:
        db.ping()
        db.init_schema()
        setup_indexes()
        seed_data()
    except Exception as exc:
        raise RuntimeError(f"Could not connect to Neon/PostgreSQL. Check DATABASE_URL. Details: {exc}") from exc


class LoginRequest(BaseModel):
    email: str
    password: str


class PublicAccessRequest(BaseModel):
    code: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    company_name: str = Field(..., min_length=1)


class PermissionUpdate(BaseModel):
    view_project: Optional[bool] = None
    create_project: Optional[bool] = None
    edit_project: Optional[bool] = None
    delete_project: Optional[bool] = None
    publish_project: Optional[bool] = None
    manage_employees: Optional[bool] = None


class EmployeeCreate(BaseModel):
    name: str = Field(..., min_length=1)
    employee_id: str = Field(..., min_length=1)
    email: str = Field(..., min_length=1)
    password: str = Field(..., min_length=4)
    permissions: PermissionUpdate = Field(default_factory=PermissionUpdate)
    is_active: bool = True


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    employee_id: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    permissions: Optional[PermissionUpdate] = None
    is_active: Optional[bool] = None


class MeasurementCreate(BaseModel):
    side_name: str = Field(..., min_length=1)
    width: float
    height: float
    depth: Optional[float] = 0
    unit: str = "ft"
    yaw: float = 0
    pitch: float = 0
    remarks: Optional[str] = None


class MeasurementUpdate(BaseModel):
    side_name: Optional[str] = None
    width: Optional[float] = None
    height: Optional[float] = None
    depth: Optional[float] = None
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
    valid_days: Optional[int] = None
    valid_hours: Optional[int] = None
    max_views: Optional[int] = None


class FeedbackCreate(BaseModel):
    name: Optional[str] = None
    company_name: Optional[str] = None
    message: str = Field(..., min_length=1)


def require_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")
    token = authorization.removeprefix("Bearer ").strip()
    session = db.sessions.find_one({"token": token})
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid session")
    user = db.users.find_one({"_id": session["user_id"]})
    if user is None or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Invalid session")
    return user_payload(user)


def require_permission(permission: str):
    def checker(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
        if user.get("role") == "admin" or user.get("permissions", {}).get(permission):
            return user
        raise HTTPException(status_code=403, detail="You do not have permission for this action")
    return checker


def require_admin_role(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admin can manage employees")
    return user


def is_code_expired(project: dict[str, Any]) -> bool:
    valid_until = parse_iso(project.get("valid_until"))
    return bool(valid_until and valid_until < now_dt())


def view_counts_by_code(project: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for view in project.get("views", []):
        code = (view.get("code") or project.get("unique_code") or "UNKNOWN").upper()
        counts[code] = counts.get(code, 0) + 1
    return counts


def current_code_view_count(project: dict[str, Any]) -> int:
    return view_counts_by_code(project).get((project.get("unique_code") or "").upper(), 0)


def max_views_reached(project: dict[str, Any]) -> bool:
    max_views = int(project.get("max_views") or 0)
    return max_views > 0 and current_code_view_count(project) >= max_views


def build_code_history(project: dict[str, Any]) -> list[dict[str, Any]]:
    counts = view_counts_by_code(project)
    history = list(project.get("code_history") or [])
    if not history and project.get("unique_code"):
        history = [{
            "code": project.get("unique_code"),
            "valid_days": project.get("valid_days", 0),
            "valid_hours": project.get("valid_hours", 0),
            "valid_until": project.get("valid_until"),
            "max_views": project.get("max_views", 0),
            "created_at": project.get("created_at"),
            "generated_reason": "initial",
        }]
    enriched = []
    for item in history:
        row = dict(item)
        code = (row.get("code") or "").upper()
        row["viewer_count"] = counts.get(code, 0)
        enriched.append(row)
    return enriched


def generate_unique_code() -> str:
    for _ in range(20):
        code = generate_code()
        if db.projects.find_one({"unique_code": code}) is None:
            return code
    raise HTTPException(status_code=500, detail="Could not generate a unique preview code")


def can_view_project(user: dict[str, Any], project: dict[str, Any] | None = None) -> bool:
    if user.get("role") == "admin" or user.get("permissions", {}).get("view_project"):
        return True
    if project and project.get("created_by_user_id") == user.get("id"):
        return True
    return False


def project_payload(project: dict[str, Any], public_base_url: str = "") -> dict[str, Any]:
    media = [media_payload(item, public_base_url) for item in sort_media(project.get("media", []))]
    panoramas = [item for item in media if item.get("type") == "panorama"]
    site_photos = [item for item in media if item.get("type") == "site_photo"]
    ricky_images = [item for item in media if item.get("type") in {"ricky_image", "recce_image"}]
    diagrams = [item for item in media if item.get("type") == "diagram_pdf"]
    primary_panorama = panoramas[0] if panoramas else None
    fallback_filename = project.get("panorama_filename")
    return {
        "id": str(project["_id"]),
        "unique_code": project.get("unique_code"),
        "valid_days": project.get("valid_days", 0),
        "valid_hours": project.get("valid_hours", 0),
        "valid_until": project.get("valid_until"),
        "max_views": int(project.get("max_views") or 0),
        "current_code_view_count": current_code_view_count(project),
        "remaining_views": max(0, int(project.get("max_views") or 0) - current_code_view_count(project)) if int(project.get("max_views") or 0) > 0 else None,
        "code_view_counts": view_counts_by_code(project),
        "code_history": build_code_history(project),
        "is_expired": is_code_expired(project),
        "is_view_limit_reached": max_views_reached(project),
        "project_name": project.get("project_name"),
        "client_name": project.get("client_name"),
        "client_phone": project.get("client_phone", ""),
        "location": project.get("location", ""),
        "panorama_filename": primary_panorama.get("filename") if primary_panorama else fallback_filename,
        "panorama_url": primary_panorama.get("url") if primary_panorama else media_url(fallback_filename, public_base_url),
        "media": media,
        "panoramas": panoramas,
        "site_photos": site_photos,
        "ricky_images": ricky_images,
        "recce_images": ricky_images,
        "diagrams": diagrams,
        "shop_width": project.get("shop_width"),
        "shop_length": project.get("shop_length"),
        "shop_height": project.get("shop_height"),
        "unit": project.get("unit", "ft"),
        "status": project.get("status", "draft"),
        "viewer_count": int(project.get("viewer_count", len(project.get("views", [])))),
        "views": sorted(project.get("views", []), key=lambda item: item.get("viewed_at", ""), reverse=True),
        "created_by": project.get("created_by") or {
            "id": project.get("created_by_user_id"),
            "employee_id": project.get("created_by_employee_id"),
            "name": project.get("created_by_name"),
        },
        "created_at": project.get("created_at"),
        "updated_at": project.get("updated_at"),
    }


def full_project_payload(project_id: str | ObjectId, public_base_url: str = "") -> dict[str, Any]:
    oid = project_id if isinstance(project_id, ObjectId) else object_id(project_id)
    project = db.projects.find_one({"_id": oid})
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    data = project_payload(project, public_base_url=public_base_url)
    data["measurements"] = project.get("measurements", [])
    data["fixtures"] = project.get("fixtures", [])
    data["feedback"] = sorted(project.get("feedback", []), key=lambda item: item.get("created_at", ""), reverse=True)
    return data


@app.get("/api/health")
def health() -> dict[str, Any]:
    db.ping()
    return {"status": "ok", "database": "neon_postgres", "storage": "cloudinary" if USE_CLOUDINARY else "local"}


@app.post("/api/admin/login")
def login(body: LoginRequest) -> dict[str, Any]:
    user = db.users.find_one({"email": clean_email(body.email)})
    if user is None or not user.get("is_active", True) or user["password_hash"] != hash_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = secrets.token_urlsafe(32)
    db.sessions.insert_one({"token": token, "user_id": user["_id"], "created_at": now_iso()})
    return {"token": token, "user": user_payload(user)}


@app.get("/api/admin/me")
def me(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return {"user": user}


@app.get("/api/admin/users")
def list_users(user: dict[str, Any] = Depends(require_admin_role)) -> dict[str, Any]:
    users = list(db.users.find({}).sort("created_at", DESCENDING))
    return {"users": [user_payload(row) for row in users]}


@app.post("/api/admin/users")
def create_user(body: EmployeeCreate, user: dict[str, Any] = Depends(require_admin_role)) -> dict[str, Any]:
    created = now_iso()
    doc = {
        "name": body.name.strip(),
        "employee_id": body.employee_id.strip(),
        "email": clean_email(body.email),
        "password_hash": hash_password(body.password),
        "role": "employee",
        "permissions": normalized_permissions(body.permissions.model_dump(exclude_none=True), "employee"),
        "is_active": body.is_active,
        "created_at": created,
        "updated_at": created,
    }
    try:
        result = db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="Employee email or ID already exists")
    new_user = db.users.find_one({"_id": result.inserted_id})
    return {"user": user_payload(new_user)}


@app.put("/api/admin/users/{user_id}")
def update_user(user_id: str, body: EmployeeUpdate, user: dict[str, Any] = Depends(require_admin_role)) -> dict[str, Any]:
    target = db.users.find_one({"_id": object_id(user_id)})
    if target is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    fields = body.model_dump(exclude_unset=True)
    updates: dict[str, Any] = {}
    if "name" in fields and fields["name"] is not None:
        updates["name"] = fields["name"].strip()
    if "employee_id" in fields and fields["employee_id"] is not None:
        updates["employee_id"] = fields["employee_id"].strip()
    if "email" in fields and fields["email"] is not None:
        updates["email"] = clean_email(fields["email"])
    if "password" in fields and fields["password"]:
        updates["password_hash"] = hash_password(fields["password"])
    if "permissions" in fields and fields["permissions"] is not None and target.get("role") != "admin":
        permissions = fields["permissions"]
        if isinstance(permissions, PermissionUpdate):
            permissions = permissions.model_dump(exclude_none=True)
        current_permissions = dict(target.get("permissions") or {})
        current_permissions.update(permissions or {})
        updates["permissions"] = normalized_permissions(current_permissions, "employee")
    if "is_active" in fields and fields["is_active"] is not None:
        updates["is_active"] = bool(fields["is_active"])
    updates["updated_at"] = now_iso()
    try:
        db.users.update_one({"_id": target["_id"]}, {"$set": updates})
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="Employee email or ID already exists")
    return {"user": user_payload(db.users.find_one({"_id": target["_id"]}))}


@app.delete("/api/admin/users/{user_id}")
def delete_user(user_id: str, user: dict[str, Any] = Depends(require_admin_role)) -> dict[str, str]:
    target = db.users.find_one({"_id": object_id(user_id)})
    if target is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Admin user cannot be deleted")
    db.users.delete_one({"_id": target["_id"]})
    db.sessions.delete_many({"user_id": target["_id"]})
    return {"message": "Employee deleted"}


@app.get("/api/admin/projects")
def list_projects(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if user.get("role") != "admin" and not user.get("permissions", {}).get("view_project"):
        # Employees without company-wide View Access can only see projects they created.
        query = {"created_by_user_id": user.get("id")}
    rows = list(db.projects.find(query).sort("created_at", DESCENDING))
    return {"projects": [project_payload(row) for row in rows], "user": user}


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
    validity_days: int = Form(30),
    validity_hours: int = Form(0),
    max_views: int = Form(0),
    site_photos: list[UploadFile] = File(default=[]),
    site_photo_labels: list[str] = Form(default=[]),
    ricky_images: list[UploadFile] = File(default=[]),
    ricky_image_labels: list[str] = Form(default=[]),
    recce_images: list[UploadFile] = File(default=[]),
    recce_image_labels: list[str] = Form(default=[]),
    diagram_pdfs: list[UploadFile] = File(default=[]),
    diagram_pdf_labels: list[str] = Form(default=[]),
    panorama_images: list[UploadFile] = File(default=[]),
    panorama_image_labels: list[str] = Form(default=[]),
    panorama: UploadFile | None = File(None),
    user: dict[str, Any] = Depends(require_permission("create_project")),
) -> dict[str, Any]:
    if panorama and panorama.filename:
        panorama_images.append(panorama)
    if not panorama_images:
        raise HTTPException(status_code=400, detail="At least one panorama image is required")
    validity_days, validity_hours = validate_validity(validity_days, validity_hours)
    max_views = max(0, int(max_views or 0))

    media: list[dict[str, Any]] = []
    order = 1
    for index, upload in enumerate(site_photos):
        if upload and upload.filename:
            media.append(make_media_item(upload, "site_photo", order, label=indexed_label(site_photo_labels, index, f"Site Photo {index + 1}")))
            order += 1
    for index, upload in enumerate(ricky_images):
        if upload and upload.filename:
            media.append(make_media_item(upload, "ricky_image", order, label=indexed_label(ricky_image_labels, index, f"Ricky Image {index + 1}")))
            order += 1
    for index, upload in enumerate(recce_images):
        if upload and upload.filename:
            media.append(make_media_item(upload, "ricky_image", order, label=indexed_label(recce_image_labels, index, f"Ricky Image {index + 1}")))
            order += 1
    for index, upload in enumerate(diagram_pdfs):
        if upload and upload.filename:
            media.append(make_media_item(upload, "diagram_pdf", order, label=indexed_label(diagram_pdf_labels, index, f"2D Diagram {index + 1}")))
            order += 1
    for index, upload in enumerate(panorama_images):
        if upload and upload.filename:
            media.append(make_media_item(upload, "panorama", order, label=indexed_label(panorama_image_labels, index, f"3D View {index + 1}")))
            order += 1

    if not [item for item in media if item.get("type") == "panorama"]:
        raise HTTPException(status_code=400, detail="At least one valid panorama image is required")

    created = now_iso()
    valid_until = calculate_valid_until(validity_days, validity_hours)
    primary_panorama = next(item for item in media if item["type"] == "panorama")
    created_by = {
        "id": user.get("id"),
        "employee_id": user.get("employee_id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "role": user.get("role"),
    }

    for _ in range(10):
        code = generate_code()
        try:
            result = db.projects.insert_one({
                "unique_code": code,
                "valid_days": validity_days,
                "valid_hours": validity_hours,
                "valid_until": valid_until,
                "max_views": max_views,
                "code_history": [{"code": code, "valid_days": validity_days, "valid_hours": validity_hours, "valid_until": valid_until, "max_views": max_views, "created_at": created, "generated_reason": "initial_create"}],
                "project_name": project_name,
                "client_name": client_name,
                "client_phone": client_phone,
                "location": location,
                "panorama_filename": primary_panorama["filename"],
                "media": media,
                "shop_width": shop_width,
                "shop_length": shop_length,
                "shop_height": shop_height,
                "unit": unit,
                "status": "draft",
                "measurements": [],
                "fixtures": [],
                "feedback": [],
                "views": [],
                "viewer_count": 0,
                "created_by": created_by,
                "created_by_user_id": created_by.get("id"),
                "created_by_employee_id": created_by.get("employee_id"),
                "created_by_name": created_by.get("name"),
                "created_at": created,
                "updated_at": created,
            })
            return {"project": full_project_payload(result.inserted_id)}
        except DuplicateKeyError:
            continue
    raise HTTPException(status_code=500, detail="Could not generate a unique preview code")


@app.get("/api/admin/projects/{project_id}")
def get_project(project_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": object_id(project_id)})
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not can_view_project(user, project):
        raise HTTPException(status_code=403, detail="You do not have view access for this project")
    return {"project": full_project_payload(project["_id"])}


@app.put("/api/admin/projects/{project_id}")
def update_project(project_id: str, body: ProjectUpdate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    oid = object_id(project_id)
    project = db.projects.find_one({"_id": oid})
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {"project": full_project_payload(project_id)}
    if "status" in fields and fields.get("status") is not None:
        if user.get("role") != "admin" and not user.get("permissions", {}).get("publish_project"):
            raise HTTPException(status_code=403, detail="You do not have permission to publish projects")
    else:
        if user.get("role") != "admin" and not user.get("permissions", {}).get("edit_project"):
            raise HTTPException(status_code=403, detail="You do not have permission to edit projects")
    allowed = {"project_name", "client_name", "client_phone", "location", "shop_width", "shop_length", "shop_height", "unit", "status"}
    updates = {key: value for key, value in fields.items() if key in allowed}

    max_views = int(fields.get("max_views") if fields.get("max_views") is not None else project.get("max_views", 0) or 0)
    updates["max_views"] = max(0, max_views)

    validity_changed = "valid_days" in fields or "valid_hours" in fields
    if validity_changed:
        days = fields.get("valid_days") if fields.get("valid_days") is not None else project.get("valid_days", 0)
        hours = fields.get("valid_hours") if fields.get("valid_hours") is not None else project.get("valid_hours", 0)
        days, hours = validate_validity(days, hours)
        old_code = project.get("unique_code")
        new_code = generate_unique_code()
        new_valid_until = calculate_valid_until(days, hours)
        now = now_iso()
        history = list(project.get("code_history") or [])
        if not history and old_code:
            history.append({"code": old_code, "valid_days": project.get("valid_days", 0), "valid_hours": project.get("valid_hours", 0), "valid_until": project.get("valid_until"), "max_views": project.get("max_views", 0), "created_at": project.get("created_at"), "generated_reason": "initial"})
        for row in history:
            if row.get("code") == old_code and not row.get("replaced_at"):
                row["replaced_at"] = now
        history.append({"code": new_code, "valid_days": days, "valid_hours": hours, "valid_until": new_valid_until, "max_views": updates["max_views"], "created_at": now, "generated_reason": "validity_updated", "previous_code": old_code})
        updates["unique_code"] = new_code
        updates["valid_days"] = days
        updates["valid_hours"] = hours
        updates["valid_until"] = new_valid_until
        updates["code_history"] = history

    updates["updated_at"] = now_iso()
    result = db.projects.update_one({"_id": oid}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": full_project_payload(project_id)}


@app.delete("/api/admin/projects/{project_id}")
def delete_project(project_id: str, user: dict[str, Any] = Depends(require_permission("delete_project"))) -> dict[str, str]:
    project = db.projects.find_one({"_id": object_id(project_id)})
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    db.projects.delete_one({"_id": object_id(project_id)})
    for item in project.get("media", []):
        delete_cloudinary_media(item)
        filename = item.get("filename")
        if filename and filename != "walltron-demo.jpeg" and not str(filename).startswith(("http://", "https://")):
            (UPLOAD_DIR / filename).unlink(missing_ok=True)
    legacy = project.get("panorama_filename")
    if legacy and legacy != "walltron-demo.jpeg":
        (UPLOAD_DIR / legacy).unlink(missing_ok=True)
    return {"message": "Project deleted"}


@app.post("/api/admin/projects/{project_id}/media")
def add_project_media(
    project_id: str,
    media_type: str = Form(...),
    label: str = Form(""),
    labels: list[str] = Form(default=[]),
    files: list[UploadFile] = File(default=[]),
    user: dict[str, Any] = Depends(require_permission("edit_project")),
) -> dict[str, Any]:
    project = db.projects.find_one({"_id": object_id(project_id)})
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if media_type not in {"site_photo", "ricky_image", "recce_image", "diagram_pdf", "panorama"}:
        raise HTTPException(status_code=400, detail="Invalid media type")
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one file")
    order_start = len(project.get("media", [])) + 1
    new_items = []
    for index, upload in enumerate(files):
        if upload and upload.filename:
            normalized_type = "ricky_image" if media_type == "recce_image" else media_type
            new_items.append(make_media_item(upload, normalized_type, order_start + index, label=indexed_label(labels, index, label or upload.filename)))
    if not new_items:
        raise HTTPException(status_code=400, detail="No valid files uploaded")
    updates: dict[str, Any] = {"$push": {"media": {"$each": new_items}}, "$set": {"updated_at": now_iso()}}
    if media_type == "panorama" and not project.get("panorama_filename"):
        updates["$set"]["panorama_filename"] = new_items[0]["filename"]
    db.projects.update_one({"_id": project["_id"]}, updates)
    return {"project": full_project_payload(project_id)}


@app.delete("/api/admin/media/{media_id}")
def delete_project_media(media_id: str, user: dict[str, Any] = Depends(require_permission("edit_project"))) -> dict[str, Any]:
    project = db.projects.find_one({"media.id": media_id})
    if project is None:
        raise HTTPException(status_code=404, detail="Media not found")
    item = next((entry for entry in project.get("media", []) if entry.get("id") == media_id), None)
    db.projects.update_one({"_id": project["_id"]}, {"$pull": {"media": {"id": media_id}}, "$set": {"updated_at": now_iso()}})
    if item:
        delete_cloudinary_media(item)
    if item and item.get("filename") != "walltron-demo.jpeg" and not str(item.get("filename", "")).startswith(("http://", "https://")):
        (UPLOAD_DIR / item["filename"]).unlink(missing_ok=True)
    return {"project": full_project_payload(project["_id"])}


@app.post("/api/admin/projects/{project_id}/measurements")
def add_measurement(project_id: str, body: MeasurementCreate, user: dict[str, Any] = Depends(require_permission("edit_project"))) -> dict[str, Any]:
    item = body.model_dump()
    item["id"] = str(ObjectId())
    item["created_at"] = now_iso()
    result = db.projects.update_one({"_id": object_id(project_id)}, {"$push": {"measurements": item}, "$set": {"updated_at": now_iso()}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": full_project_payload(project_id)}


@app.put("/api/admin/measurements/{measurement_id}")
def update_measurement(measurement_id: str, body: MeasurementUpdate, user: dict[str, Any] = Depends(require_permission("edit_project"))) -> dict[str, Any]:
    fields = body.model_dump(exclude_unset=True)
    project = db.projects.find_one({"measurements.id": measurement_id})
    if project is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    if fields:
        allowed = {"side_name", "width", "height", "depth", "unit", "yaw", "pitch", "remarks"}
        updates = {f"measurements.$.{key}": value for key, value in fields.items() if key in allowed}
        updates["updated_at"] = now_iso()
        db.projects.update_one({"measurements.id": measurement_id}, {"$set": updates})
    return {"project": full_project_payload(project["_id"])}


@app.delete("/api/admin/measurements/{measurement_id}")
def delete_measurement(measurement_id: str, user: dict[str, Any] = Depends(require_permission("edit_project"))) -> dict[str, Any]:
    project = db.projects.find_one({"measurements.id": measurement_id})
    if project is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    db.projects.update_one({"_id": project["_id"]}, {"$pull": {"measurements": {"id": measurement_id}}, "$set": {"updated_at": now_iso()}})
    return {"project": full_project_payload(project["_id"])}


@app.post("/api/admin/projects/{project_id}/fixtures")
def add_fixture(project_id: str, body: FixtureCreate, user: dict[str, Any] = Depends(require_permission("edit_project"))) -> dict[str, Any]:
    item = body.model_dump()
    item["id"] = str(ObjectId())
    item["created_at"] = now_iso()
    result = db.projects.update_one({"_id": object_id(project_id)}, {"$push": {"fixtures": item}, "$set": {"updated_at": now_iso()}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": full_project_payload(project_id)}


@app.delete("/api/admin/fixtures/{fixture_id}")
def delete_fixture(fixture_id: str, user: dict[str, Any] = Depends(require_permission("edit_project"))) -> dict[str, Any]:
    project = db.projects.find_one({"fixtures.id": fixture_id})
    if project is None:
        raise HTTPException(status_code=404, detail="Fixture not found")
    db.projects.update_one({"_id": project["_id"]}, {"$pull": {"fixtures": {"id": fixture_id}}, "$set": {"updated_at": now_iso()}})
    return {"project": full_project_payload(project["_id"])}


@app.post("/api/public/access")
def access_public_project(body: PublicAccessRequest, request: Request) -> dict[str, Any]:
    code = body.code.strip().upper()
    project = db.projects.find_one({"unique_code": code})
    if project is None:
        raise HTTPException(status_code=404, detail="Preview code not found")
    if is_code_expired(project):
        raise HTTPException(status_code=410, detail="This preview code has expired. Please contact ADINN for a new code.")
    if max_views_reached(project):
        raise HTTPException(status_code=429, detail="This preview code has reached its maximum allowed views. Please contact ADINN for a new code.")
    view = {
        "id": str(ObjectId()),
        "code": code,
        "name": body.name.strip(),
        "company_name": body.company_name.strip(),
        "viewed_at": now_iso(),
        "ip_address": request.client.host if request.client else None,
    }
    db.projects.update_one({"_id": project["_id"]}, {"$push": {"views": view}, "$inc": {"viewer_count": 1}, "$set": {"updated_at": now_iso()}})
    return {"project": full_project_payload(project["_id"], public_base_url=PUBLIC_BASE_URL), "viewer": view}


@app.get("/api/public/projects/{unique_code}")
def get_public_project(unique_code: str) -> dict[str, Any]:
    code = unique_code.strip().upper()
    project = db.projects.find_one({"unique_code": code})
    if project is None:
        raise HTTPException(status_code=404, detail="Preview code not found")
    if is_code_expired(project):
        raise HTTPException(status_code=410, detail="This preview code has expired. Please contact ADINN for a new code.")
    if max_views_reached(project):
        raise HTTPException(status_code=429, detail="This preview code has reached its maximum allowed views. Please contact ADINN for a new code.")
    return {"project": full_project_payload(project["_id"], public_base_url=PUBLIC_BASE_URL)}


@app.post("/api/public/projects/{unique_code}/feedback")
def add_public_feedback(unique_code: str, body: FeedbackCreate) -> dict[str, str]:
    code = unique_code.strip().upper()
    feedback = {"id": str(ObjectId()), "name": body.name, "company_name": body.company_name, "message": body.message, "status": "new", "created_at": now_iso()}
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
