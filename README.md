# Pick your place

A static signup demo with five options and a limit of two selections per option in each browser.

## Run locally

Open `index.html` directly, or serve this folder with any static file server. For example:

```powershell
python -m http.server 8000
```

Then visit http://127.0.0.1:8000.

## Deploy

Upload this folder to any static web host, including Netlify or GitHub Pages. No build command, server, database, or environment variables are required.

## Limitation

Selections are saved in the visitor's browser using `localStorage`. They are not shared across visitors or devices, and capacity is enforced only within that browser. This static version has no shared admin roster.