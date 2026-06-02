# ADINN Fixture360 - MongoDB Version

Fixture360 is a 360 degree fixture preview and measurement web application for retail spaces. This version uses MongoDB for application data and keeps panorama image files in backend storage.

## Main Features

- Client preview screen using a unique preview code
- 360 degree panorama viewer
- Dynamic measurement labels placed anywhere inside the panorama
- Fixture overlay preview
- Admin/team login
- Project creation and management
- Client feedback capture
- MongoDB-backed project, user, session, measurement, fixture, and feedback data

## Tech Stack

Frontend:
- React + Vite
- CSS custom styling
- Panorama viewer component

Backend:
- Python 3.14
- FastAPI
- PyMongo
- MongoDB Atlas or local MongoDB
- Uvicorn

Storage:
- MongoDB stores structured application data
- Local or persistent disk stores uploaded panorama image files

## Backend Environment Variables

Create `backend/.env` locally or configure these variables in Render:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=fixture360
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
pip install -r requirements.txt
export MONGODB_URI="mongodb://localhost:27017"
export MONGODB_DB="fixture360"
python app.py
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
{"status":"ok","database":"mongodb"}
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
Email: admin@fixture360.local
Password: admin123
```

Change the default admin password before production use.

## MongoDB Collections

- `users` - team/admin users
- `sessions` - login sessions
- `projects` - project master data, measurements, fixtures, and feedback

Measurements, fixtures, and feedback are embedded inside each project document for fast project-level retrieval.

## Deployment Notes

Recommended deployment:

- Backend: Render Web Service
- Database: MongoDB Atlas
- Frontend: Vercel
- Panorama image storage: Render persistent disk for MVP, object storage for production

For production scalability, move uploaded image files to S3, Cloudflare R2, or another object storage service.
