# Fixture360 Deployment Guide

Recommended setup:
- Backend API: Render Web Service
- Frontend: Vercel Vite app

## Backend on Render

Use these settings if creating the service manually:

- Runtime: Python
- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Health Check Path: `/api/health`

Environment variables:

```env
DATA_DIR=/var/data
PUBLIC_BASE_URL=https://YOUR-BACKEND-NAME.onrender.com
CORS_ORIGINS=https://YOUR-FRONTEND-NAME.vercel.app,http://localhost:5173
```

Attach a persistent disk:

- Mount path: `/var/data`
- Size: 1 GB or more

## Frontend on Vercel

Use these settings:

- Framework: Vite
- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`

Environment variable:

```env
VITE_API_URL=https://YOUR-BACKEND-NAME.onrender.com
```

After setting or changing `VITE_API_URL`, redeploy the frontend.

## Local testing before deployment

Backend:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.
