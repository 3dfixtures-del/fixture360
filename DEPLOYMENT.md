# ADINN Fixture360 MongoDB Deployment Guide

This version uses MongoDB instead of SQLite.

## 1. Create MongoDB Atlas Database

1. Create a MongoDB Atlas account.
2. Create a project and a free/shared cluster.
3. Create a database user.
4. Add your Render outbound IP access rule or allow network access for deployment testing.
5. Copy the connection string.

Example connection string:

```text
mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
```

## 2. Push Project to GitHub

```bash
git add .
git commit -m "Convert Fixture360 backend to MongoDB"
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
MONGODB_URI=your_mongodb_atlas_connection_string
MONGODB_DB=fixture360
DATA_DIR=/var/data
UPLOAD_DIR=/var/data/uploads
PUBLIC_BASE_URL=https://fixture360-api.onrender.com
CORS_ORIGINS=http://localhost:5173,https://YOUR-FRONTEND.vercel.app
```

Add a persistent disk for panorama uploads:

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
{"status":"ok","database":"mongodb"}
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
- Restrict MongoDB network access.
- Use a strong MongoDB username and password.
- Use Render persistent disk or object storage for panorama images.
- Set `PUBLIC_BASE_URL` to the final backend URL.
- Set `CORS_ORIGINS` to the final frontend URL only.
- Test admin login, project creation, panorama upload, preview code, measurements, fixtures, and feedback.
