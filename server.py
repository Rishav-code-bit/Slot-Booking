import json
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import closing
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("SIGNUP_DB_PATH", BASE_DIR / "signups.sqlite3"))
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or secrets.token_urlsafe(18)
SESSION_TTL = 8 * 60 * 60
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
ADMIN_SESSIONS = {}
ADMIN_SESSIONS_LOCK = threading.Lock()
DEFAULT_OPTIONS = [
    ("option_a", "Option A", 2),
    ("option_b", "Option B", 2),
    ("option_c", "Option C", 2),
    ("option_d", "Option D", 2),
    ("option_e", "Option E", 2),
]


class SubmissionError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def open_database(path=DATABASE_PATH):
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database(connection, options=DEFAULT_OPTIONS):
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS options (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            capacity INTEGER NOT NULL CHECK (capacity > 0)
        );
        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            option_id TEXT NOT NULL REFERENCES options(id),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    connection.executemany(
        "INSERT OR IGNORE INTO options (id, label, capacity) VALUES (?, ?, ?)",
        options,
    )
    connection.commit()


def list_options(connection):
    rows = connection.execute(
        """
        SELECT options.id, options.label, options.capacity,
               COUNT(submissions.id) AS taken
        FROM options
        LEFT JOIN submissions ON submissions.option_id = options.id
        GROUP BY options.id
        ORDER BY options.id
        """
    ).fetchall()
    result = []
    for row in rows:
        result.append(
            {
                "id": row["id"],
                "label": row["label"],
                "capacity": row["capacity"],
                "taken": row["taken"],
                "remaining": row["capacity"] - row["taken"],
            }
        )
    return result


def list_responses(connection):
    options = list_options(connection)
    groups = {option["id"]: {**option, "people": []} for option in options}
    rows = connection.execute(
        "SELECT id, name, option_id FROM submissions ORDER BY name COLLATE NOCASE"
    ).fetchall()
    for row in rows:
        groups[row["option_id"]]["people"].append(
            {"id": row["id"], "name": row["name"]}
        )
    return list(groups.values())


def submit_response(connection, name, email, option_id):
    name = name.strip()
    email = email.strip().lower()
    option_id = option_id.strip()

    if not name or len(name) > 100:
        raise SubmissionError(400, "Enter your name (up to 100 characters).")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 254:
        raise SubmissionError(400, "Enter a valid email address.")
    if not option_id:
        raise SubmissionError(400, "Choose an available option.")

    try:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute(
            "SELECT 1 FROM submissions WHERE email = ?", (email,)
        ).fetchone():
            raise SubmissionError(409, "This email already has a response.")

        option = connection.execute(
            """
            SELECT options.label, options.capacity, COUNT(submissions.id) AS taken
            FROM options
            LEFT JOIN submissions ON submissions.option_id = options.id
            WHERE options.id = ?
            GROUP BY options.id
            """,
            (option_id,),
        ).fetchone()

        if option is None:
            raise SubmissionError(409, "That option is no longer available.")
        if option["taken"] >= option["capacity"]:
            raise SubmissionError(409, "That option just filled up. Please choose another.")

        connection.execute(
            "INSERT INTO submissions (name, email, option_id) VALUES (?, ?, ?)",
            (name, email, option_id),
        )
        connection.commit()
        return option["label"]
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise


def cancel_response_by_id(connection, submission_id):
    try:
        submission_id = int(submission_id)
    except (TypeError, ValueError):
        raise SubmissionError(400, "Select a valid signup to cancel.")
    if submission_id < 1:
        raise SubmissionError(400, "Select a valid signup to cancel.")
    try:
        connection.execute("BEGIN IMMEDIATE")
        submission = connection.execute(
            "SELECT id FROM submissions WHERE id = ?", (submission_id,)
        ).fetchone()
        if submission is None:
            raise SubmissionError(404, "That signup is no longer active.")
        connection.execute("DELETE FROM submissions WHERE id = ?", (submission["id"],))
        connection.commit()
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise


def create_admin_session():
    token = secrets.token_urlsafe(32)
    with ADMIN_SESSIONS_LOCK:
        ADMIN_SESSIONS[token] = time.time() + SESSION_TTL
    return token


def is_admin_session(cookie_header):
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header or "")
    except Exception:
        return False
    morsel = cookie.get("admin_session")
    if morsel is None:
        return False
    token = morsel.value
    with ADMIN_SESSIONS_LOCK:
        expires_at = ADMIN_SESSIONS.get(token)
        if expires_at is None:
            return False
        if expires_at <= time.time():
            del ADMIN_SESSIONS[token]
            return False
        return True


class SignupHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def send_json(self, status, payload, headers=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def is_admin(self):
        return is_admin_session(self.headers.get("Cookie"))

    def redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/responses.html", "/responses") and not self.is_admin():
            self.redirect("/admin.html")
            return
        if path == "/api/options":
            with closing(open_database()) as connection:
                options = list_options(connection)
            self.send_json(200, {"options": options})
            return
        if path == "/api/responses":
            if not self.is_admin():
                self.send_json(401, {"message": "Admin login required."})
                return
            with closing(open_database()) as connection:
                responses = list_responses(connection)
            self.send_json(200, {"options": responses})
            return
        assets = {
            "/": "index.html",
            "/index.html": "index.html",
            "/styles.css": "styles.css",
            "/app.js": "app.js",
            "/responses.html": "responses.html",
            "/responses.js": "responses.js",
            "/admin.html": "admin.html",
            "/admin.js": "admin.js",
        }
        asset = assets.get(path)
        if asset is None:
            self.send_json(404, {"message": "Not found."})
            return
        self.path = f"/{asset}"
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/api/submit", "/api/login", "/api/logout", "/api/admin/cancel"):
            self.send_json(404, {"message": "Not found."})
            return

        try:
            if path in ("/api/logout", "/api/admin/cancel") and not self.is_admin():
                self.send_json(401, {"message": "Admin login required."})
                return
            length = int(self.headers.get("Content-Length", "0"))
            if length > 10_000:
                self.send_json(413, {"message": "Request is too large."})
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("Expected an object.")
            if path == "/api/login":
                username = str(payload.get("username", ""))
                password = str(payload.get("password", ""))
                if not (
                    hmac.compare_digest(username, ADMIN_USERNAME)
                    and hmac.compare_digest(password, ADMIN_PASSWORD)
                ):
                    self.send_json(401, {"message": "Username or password is incorrect."})
                    return
                token = create_admin_session()
                cookie = f"admin_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}"
                if COOKIE_SECURE:
                    cookie += "; Secure"
                self.send_json(200, {"message": "Signed in."}, {"Set-Cookie": cookie})
                return
            if path == "/api/logout":
                cookie = SimpleCookie()
                try:
                    cookie.load(self.headers.get("Cookie", ""))
                except Exception:
                    pass
                morsel = cookie.get("admin_session")
                if morsel is not None:
                    with ADMIN_SESSIONS_LOCK:
                        ADMIN_SESSIONS.pop(morsel.value, None)
                expired_cookie = "admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
                if COOKIE_SECURE:
                    expired_cookie += "; Secure"
                self.send_json(200, {"message": "Signed out."}, {"Set-Cookie": expired_cookie})
                return
            with closing(open_database()) as connection:
                if path == "/api/submit":
                    label = submit_response(
                        connection,
                        str(payload.get("name", "")),
                        str(payload.get("email", "")),
                        str(payload.get("option_id", "")),
                    )
                else:
                    cancel_response_by_id(connection, payload.get("submission_id"))
            if path == "/api/submit":
                self.send_json(
                    201,
                    {"message": "Your place is reserved.", "option": label},
                )
            else:
                self.send_json(200, {"message": "The signup has been cancelled."})
        except SubmissionError as error:
            self.send_json(error.status, {"message": str(error)})
        except (json.JSONDecodeError, ValueError, TypeError):
            self.send_json(400, {"message": "Please send a valid response."})


if __name__ == "__main__":
    with closing(open_database()) as database:
        initialize_database(database)
    server = ThreadingHTTPServer((HOST, PORT), SignupHandler)
    print(f"Signup form available at http://127.0.0.1:{PORT}")
    if not os.environ.get("ADMIN_PASSWORD"):
        print(f"Admin login: {ADMIN_USERNAME} / {ADMIN_PASSWORD}")
        print("Set ADMIN_PASSWORD before deployment to use a permanent admin password.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down signup server.")
        server.server_close()