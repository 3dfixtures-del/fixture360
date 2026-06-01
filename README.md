# Fixture360 Web Application

Fixture360 is a full-stack MVP for a panorama-based retail fixture preview system.

The client opens the website, enters a unique preview code, and views their 360° shop result with measurement labels and fixture overlays.

## Included Features

- First screen with unique preview code access
- Public read-only client preview
- 360° equirectangular panorama viewer
- Dynamic measurement mode: click anywhere inside the 360° viewer to place measurement labels
- Fixture overlay labels with width, height, depth, color, and scale
- Admin login
- Admin project creation
- Panorama image upload
- Auto-generated unique preview code
- Add, edit, reposition, and delete measurement labels
- Add/delete fixture overlays
- Client feedback submission
- SQLite database storage
- Local uploaded image storage
- Sample demo project with your panorama image

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

## Project Structure

```text
fixture360-project/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   ├── fixture360.db              # auto-created on first run
│   └── uploads/
│       └── walltron-demo.jpeg
│
├── frontend/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── api.js
│       ├── styles.css
│       └── components/
│           └── PanoramaViewer.jsx
│
└── sample/
    └── walltron-demo-panorama.jpeg
```

## Requirements

Install these before running:

- Python 3.10 or newer
- Node.js 18 or newer
- npm

## Run the Backend

Open Terminal and run:

```bash
cd fixture360-project/backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Backend will run at:

```text
http://localhost:8000
```

API health check:

```text
http://localhost:8000/api/health
```

## Run the Frontend

Open a second Terminal window and run:

```bash
cd fixture360-project/frontend
npm install
npm run dev
```

Frontend will run at:

```text
http://localhost:5173
```

## Client Flow

1. Open `http://localhost:5173`
2. Enter the unique preview code, for example `DEMO360`
3. View the interactive 360° panorama
4. Drag to look around
5. See measurements and fixture overlays
6. Submit feedback if needed

## Admin Flow

1. Open `http://localhost:5173`
2. Click `Admin / Employee Login`
3. Login using the demo admin account
4. Create a new project
5. Upload a panorama image
6. Add measurements by entering label + size, clicking Place / Reposition, then clicking the exact spot in the panorama
7. Add fixture overlays
8. Copy the generated unique code
9. Share the code with the client

## How Data Is Stored

This MVP uses SQLite.

The database is created at:

```text
backend/fixture360.db
```

Uploaded panorama images are stored locally at:

```text
backend/uploads/
```

Tables used:

- `users` - admin login users
- `sessions` - admin login sessions
- `projects` - client projects and panorama file references
- `measurements` - side/corner measurement labels
- `fixtures` - fixture overlay labels
- `feedback` - client comments

## Notes About Measurements

A single panorama image cannot automatically produce perfect real-world dimensions. This MVP uses practical measurement input with easy visual placement:

- Admin enters a measurement label, width/length, height, and unit
- Admin clicks `Place / Reposition`
- Admin clicks anywhere inside the 360° viewer where the label should appear
- The app automatically records the yaw/pitch position
- Existing measurement labels can be edited, repositioned, or deleted
- Quick chips are provided for common labels like Front Wall, Door, Shelf Area, and Ceiling Height

This is reliable for client presentation because the dimensions are based on entered site measurements rather than guessed from the image.

## Notes About Fixtures

This MVP shows fixtures as clean 3D-positioned overlay cards inside the 360° scene. It is intentionally lightweight and fast.

Future upgrade options:

- Upload real GLB/GLTF 3D fixture models
- Drag-and-drop fixture placement
- Floor/wall anchoring
- Mobile AR preview
- LiDAR-based measurement scan
- Multi-panorama virtual shop tour
- PDF proposal export

## Production Upgrade Checklist

Before using this live with clients:

- Replace demo admin password
- Add HTTPS
- Use stronger authentication
- Move uploads to cloud storage such as S3 or Cloudflare R2
- Use PostgreSQL instead of SQLite
- Add user roles for admin and employees
- Add project permissions
- Add backup system
- Add branded domain

## Python 3.14 Note

This project is updated for Python 3.14 by avoiding old pinned FastAPI/Pydantic versions.
If you previously created a virtual environment using the older requirements, delete it and recreate it:

```bash
cd ~/Desktop/Adinn/Adinn-Projects/fixture360-project/backend
rm -rf venv
python3.14 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install --no-cache-dir -r requirements.txt
python app.py
```
