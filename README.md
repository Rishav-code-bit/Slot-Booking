# Slot Booking

A small signup website with capacity-limited options, an admin-only selections roster, and admin cancellation.

## Run locally

Requires Python 3.10 or later; the app uses only the Python standard library.

```powershell
python server.py
```

Open http://127.0.0.1:8000. On first startup, the server prints the generated admin password. The default username is `admin`. The password changes when the server restarts unless `ADMIN_PASSWORD` is set.

For a stable local admin login, set the credentials before starting the server:

```powershell
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "choose-a-long-private-password"
python server.py
```

The app stores signups in `signups.sqlite3` in this folder. That database is intentionally excluded from Git.

## Run tests

```powershell
python -m unittest -v
```

The server listens on `0.0.0.0` by default so hosting platforms can reach it, and uses the platform's `PORT` environment variable when provided. To keep it local-only, set `HOST` to `127.0.0.1`. Deploy behind HTTPS and set `COOKIE_SECURE=1` when using HTTPS.

## Deploy to Netlify

Netlify serves the frontend from `dist` and routes `/api/*` to a Netlify Function. The Netlify backend uses Neon PostgreSQL so reservations persist and capacity limits remain safe when people submit at the same time. It does not use the local Python server or `signups.sqlite3`.

1. Create a PostgreSQL database on Neon and copy its connection string.
2. In Netlify, add these environment variables for the site:
	- `DATABASE_URL`: the Neon connection string.
	- `ADMIN_USERNAME`: the roster administrator's username.
	- `ADMIN_PASSWORD`: a long, private password.
	- `ADMIN_SESSION_SECRET`: a separate long, random secret for admin sessions.
	- `COOKIE_SECURE`: `1` for the deployed HTTPS site.
3. Connect the Git repository to Netlify and deploy. Netlify reads `netlify.toml`, runs `npm run build`, and the function creates its tables and five default options on the first API request.

Do not set the database or admin secrets in frontend files or commit them to Git. The local Python server remains available for development; Netlify uses the function backend instead.