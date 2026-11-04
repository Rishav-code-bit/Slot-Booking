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

The server listens on `0.0.0.0` by default and uses the platform's `PORT` environment variable when provided. To keep it local-only, set `HOST` to `127.0.0.1`. Deploy behind HTTPS and set `COOKIE_SECURE=1` when using HTTPS.