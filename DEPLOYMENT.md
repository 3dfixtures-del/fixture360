# ADINN Fixture360 Neon PostgreSQL Deployment Guide

This version uses Neon PostgreSQL instead of MongoDB.

## 1. Create Neon PostgreSQL Database

1. Open Neon.
2. Create a new project.
3. Copy the Postgres connection string from the project dashboard/connect screen.
4. Use the pooled or regular connection string with SSL enabled.

Example connection string:

```text
postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
```

This value becomes your backend `DATABASE_URL`.

## 2. Push Project to GitHub

```bash
git add .
git commit -m "Convert Fixture360 backend to Neon PostgreSQL"
git push
```

## 3. Deploy Backend on Render

Create a new Web Service using your GitHub repository.

Settings:

```text
Name: fixture360-api
Root Directory: backend
Runtime: Python
Build Command: pip install -r requirements.txt
Start Command: python app.py
```

Environment variables:

```env
PYTHON_VERSION=3.14.3
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
DATA_DIR=/var/data
UPLOAD_DIR=/var/data/uploads
PUBLIC_BASE_URL=https://fixture360-api.onrender.com
CORS_ORIGINS=http://localhost:5173,https://YOUR-FRONTEND.vercel.app
```

Add a persistent disk for uploaded media files:

```text
Name: fixture360-data
Mount Path: /var/data
Size: 1 GB
```

Test backend:

```text
https://fixture360-api.onrender.com/api/health
```

Expected response:

```json
{"status":"ok","database":"neon_postgres"}
```

## 4. Deploy Frontend on Vercel

Import the same GitHub repository in Vercel.

Settings:

```text
Root Directory: frontend
Framework: Vite
Build Command: npm run build
Output Directory: dist
```

Environment variable:

```env
VITE_API_URL=https://fixture360-api.onrender.com
```

After frontend deployment, update Render:

```env
CORS_ORIGINS=https://YOUR-FRONTEND.vercel.app,http://localhost:5173
```

Then redeploy backend.

## 5. Production Checklist

- Change default admin password.
- Keep `DATABASE_URL` private.
- Use Render persistent disk or object storage for uploaded media.
- Set `PUBLIC_BASE_URL` to the final backend URL.
- Set `CORS_ORIGINS` to the final frontend URL only.
- Test admin login, employee CRUD, project creation, media upload, preview code validity, max views, measurements, fixtures, and feedback.
