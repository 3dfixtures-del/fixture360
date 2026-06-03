# ADINN Fixture360 - Neon PostgreSQL Version

Fixture360 is a 360 degree fixture preview and measurement web application for retail spaces. This version uses **Neon PostgreSQL** for application data and keeps uploaded media files in backend storage.

## Latest Feature Set

- Preview code validity using days and hours
- Maximum views per preview code
- New preview code generated when validity timing is edited
- Admin login and employee login
- Full employee CRUD with admin-controlled permissions
- Employee View Access permission
- Viewer tracking by project and preview code
- Mandatory client name and company name before preview access
- Project creator tracking with employee name and employee ID
- Measurements support width, height, and depth
- Multiple panoramic images creating multiple 3D view tabs
- Media upload order: Site Photo, Ricky Image, 2D PDF Diagram, Panorama / 3D View

## Tech Stack

Frontend:
- React + Vite
- CSS custom styling
- Panorama viewer component

Backend:
- Python 3.14
- FastAPI
- Psycopg 3
- Neon PostgreSQL
- Uvicorn

Storage:
- Neon PostgreSQL stores users, sessions, projects, measurements, fixtures, feedback, media metadata, preview code history, and viewer logs.
- Local/backend storage stores uploaded files such as site photos, Ricky images, PDFs, and panorama images.

## Backend Environment Variables

Configure these variables locally or in Render:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
DATA_DIR=/var/data
UPLOAD_DIR=/var/data/uploads
PUBLIC_BASE_URL=https://fixture360-api.onrender.com
CORS_ORIGINS=http://localhost:5173,https://YOUR-FRONTEND.vercel.app
PYTHON_VERSION=3.14.3
```

## Local Backend Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
python3 -m pip install --upgrade pip setuptools wheel
python3 -m pip install -r requirements.txt

export DATABASE_URL='postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require'
export DATA_DIR='./data'
export PUBLIC_BASE_URL='http://localhost:8000'
export CORS_ORIGINS='http://localhost:5173'

python3 app.py
```

Backend runs at:

```text
http://localhost:8000
```

Health check:

```text
http://localhost:8000/api/health
```

Expected response:

```json
{"status":"ok","database":"neon_postgres"}
```

## Local Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at:

```text
http://localhost:5173
```

## Demo Access

Client preview code:

```text
DEMO360
```

Admin login:

```text
Email: adminfixtures@adinn.co.in
Password: admin123
```

Change the default admin password before production use.

## Neon PostgreSQL Tables

The backend creates these tables automatically:

- `users`
- `sessions`
- `projects`

Each row stores a JSONB document. This keeps the current project structure flexible while moving the database from MongoDB to Neon PostgreSQL.

## Deployment Notes

Recommended deployment:

- Backend: Render Web Service
- Database: Neon PostgreSQL
- Frontend: Vercel
- Media file storage: Render persistent disk for MVP, object storage for production

For production scalability, move uploaded files to S3, Cloudflare R2, or another object storage service.
