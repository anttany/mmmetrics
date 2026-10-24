import os
import re
import shutil
import sqlite3
import threading
import time
import uuid
from pathlib import Path

POLL_INTERVAL_MS = 15_000
HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000
RETENTION_MS = 6 * 60 * 60 * 1000
METRICS = ("cpu", "memory", "disk", "load", "offline")
COOLDOWNS = (300, 600, 1800, 3600)

_lock = threading.RLock()
_connection: sqlite3.Connection | None = None


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def connect() -> sqlite3.Connection:
    global _connection
    with _lock:
        if _connection is not None:
            return _connection
        load_env_file()
        database = sqlite3.connect(database_file(), check_same_thread=False)
        database.row_factory = sqlite3.Row
        _connection = database
        migrate(database)
        return database


def database_file() -> str:
    root = os.environ.get("LOCALAPPDATA") or os.environ.get("HOME") or str(Path.cwd() / "data")
    directory = Path(root) / "mmmetrics"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / "metrics.sqlite"
    legacy = Path.cwd() / "data" / "metrics.sqlite"
    if not target.exists() and legacy.exists():
        for suffix in ("", "-wal", "-shm"):
            source = Path(str(legacy) + suffix)
            if source.exists():
                shutil.copyfile(source, Path(str(target) + suffix))
    return str(target)


def load_env_file() -> None:
    path = Path.cwd() / ".env.local"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value)


def migrate(database: sqlite3.Connection) -> None:
    database.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 3000;
        CREATE TABLE IF NOT EXISTS samples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          online INTEGER NOT NULL,
          hostname TEXT,
          uptime_seconds REAL,
          load1 REAL,
          load5 REAL,
          load15 REAL,
          cpu_count INTEGER,
          cpu_percent REAL,
          mem_total INTEGER,
          mem_used INTEGER,
          mem_percent REAL,
          disk_total INTEGER,
          disk_used INTEGER,
          disk_percent REAL,
          disk_mount TEXT,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          host TEXT NOT NULL,
          port INTEGER NOT NULL,
          username TEXT NOT NULL,
          password TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alert_rules (
          id TEXT PRIMARY KEY,
          server_id TEXT,
          metric TEXT NOT NULL,
          threshold REAL NOT NULL,
          enabled INTEGER NOT NULL,
          cooldown_sec INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alert_state (
          rule_id TEXT NOT NULL,
          server_id TEXT NOT NULL,
          active INTEGER NOT NULL,
          last_sent INTEGER NOT NULL,
          PRIMARY KEY (rule_id, server_id)
        );
        CREATE TABLE IF NOT EXISTS alert_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          server_id TEXT,
          rule_id TEXT,
          message TEXT NOT NULL,
          sent INTEGER NOT NULL
        );
        """
    )
    columns = {row["name"] for row in database.execute("PRAGMA table_info(samples)")}
    if "server_id" not in columns:
        database.execute("ALTER TABLE samples ADD COLUMN server_id TEXT")
    database.execute("CREATE INDEX IF NOT EXISTS samples_server_ts ON samples (server_id, ts)")
    import_env_server(database)
    if database.execute("SELECT value FROM settings WHERE key = 'friendly_import_name'").fetchone() is None:
        database.execute("UPDATE servers SET name = 'Сервер' WHERE name = host")
        database.execute("INSERT INTO settings (key, value) VALUES ('friendly_import_name', '1')")
    database.commit()


def import_env_server(database: sqlite3.Connection) -> None:
    if database.execute("SELECT id FROM servers LIMIT 1").fetchone():
        return
    host = os.environ.get("SSH_HOST", "").strip()
    username = os.environ.get("SSH_USER", "").strip()
    password = os.environ.get("SSH_PASSWORD", "")
    if not host or not username or not password:
        return
    server_id = str(uuid.uuid4())
    database.execute(
        """
        INSERT INTO servers (id, name, host, port, username, password, created_at)
        VALUES (?, 'Сервер', ?, 22, ?, ?, ?)
        """,
        (server_id, host, username, password, now_ms()),
    )
    database.execute("UPDATE samples SET server_id = ? WHERE server_id IS NULL", (server_id,))


def now_ms() -> int:
    return int(time.time() * 1000)


def list_servers() -> list[dict]:
    with _lock:
        rows = connect().execute(
            """
            SELECT id, name, host, port, username,
                   CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END AS has_password
            FROM servers ORDER BY created_at ASC
            """
        ).fetchall()
    return [public_server(row) for row in rows]


def list_secrets() -> list[dict]:
    with _lock:
        rows = connect().execute(
            "SELECT id, name, host, port, username, password FROM servers ORDER BY created_at ASC"
        ).fetchall()
    return [{**public_server(row), "password": row["password"] or ""} for row in rows]


def get_server(server_id: str) -> dict | None:
    return next((server for server in list_servers() if server["id"] == server_id), None)


def get_secret(server_id: str) -> dict | None:
    return next((server for server in list_secrets() if server["id"] == server_id), None)


def create_server(payload: dict) -> dict:
    parsed = parse_draft(payload, password_required=True)
    server_id = str(uuid.uuid4())
    with _lock:
        connect().execute(
            """
            INSERT INTO servers (id, name, host, port, username, password, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (server_id, parsed["name"], parsed["host"], parsed["port"], parsed["username"], parsed["password"], now_ms()),
        )
        connect().commit()
    created = get_server(server_id)
    if not created:
        raise ApiError("Не удалось сохранить сервер.")
    return created


def update_server(server_id: str, payload: dict) -> dict:
    current = get_secret(server_id)
    if not current:
        raise ApiError("Сервер не найден.", 404)
    parsed = parse_draft(payload, password_required=False)
    password = parsed["password"] or current["password"]
    if not password:
        raise ApiError("Укажите пароль.")
    with _lock:
        connect().execute(
            "UPDATE servers SET name = ?, host = ?, port = ?, username = ?, password = ? WHERE id = ?",
            (parsed["name"], parsed["host"], parsed["port"], parsed["username"], password, server_id),
        )
        connect().commit()
    updated = get_server(server_id)
    if not updated:
        raise ApiError("Сервер не найден.", 404)
    return updated


def delete_server(server_id: str) -> None:
    with _lock:
        database = connect()
        database.execute("DELETE FROM samples WHERE server_id = ?", (server_id,))
        database.execute("DELETE FROM alert_state WHERE server_id = ?", (server_id,))
        database.execute("DELETE FROM alert_rules WHERE server_id = ?", (server_id,))
        database.execute("DELETE FROM alert_log WHERE server_id = ?", (server_id,))
        database.execute("DELETE FROM servers WHERE id = ?", (server_id,))
        database.commit()


def insert_sample(server_id: str, sample: dict) -> None:
    with _lock:
        database = connect()
        database.execute(
            """
            INSERT INTO samples (
              ts, online, hostname, uptime_seconds, load1, load5, load15, cpu_count,
              cpu_percent, mem_total, mem_used, mem_percent, disk_total, disk_used,
              disk_percent, disk_mount, error, server_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now_ms(),
                1 if sample["online"] else 0,
                sample["hostname"],
                sample["uptime_seconds"],
                sample["load1"],
                sample["load5"],
                sample["load15"],
                sample["cpu_count"],
                sample["cpu_percent"],
                sample["mem_total"],
                sample["mem_used"],
                sample["mem_percent"],
                sample["disk_total"],
                sample["disk_used"],
                sample["disk_percent"],
                sample["disk_mount"],
                sample["error"],
                server_id,
            ),
        )
        database.execute("DELETE FROM samples WHERE ts < ?", (now_ms() - RETENTION_MS,))
        database.execute(
            """
            DELETE FROM alert_log WHERE id < (
              SELECT id FROM alert_log ORDER BY id DESC LIMIT 1 OFFSET 200
            )
            """
        )
        database.commit()


def has_samples(server_id: str) -> bool:
    with _lock:
        row = connect().execute("SELECT id FROM samples WHERE server_id = ? LIMIT 1", (server_id,)).fetchone()
    return row is not None


def list_cards() -> list[dict]:
    cards = []
    for server in list_servers():
        latest = latest_sample(server["id"])
        cards.append(
            {
                **server,
                "online": None if latest is None else latest["online"],
                "hostname": None if latest is None else latest["hostname"],
                "uptimeSeconds": None if latest is None else latest["uptimeSeconds"],
                "cpuPercent": None if latest is None else latest["cpuPercent"],
                "memPercent": None if latest is None else latest["memPercent"],
                "diskPercent": None if latest is None else latest["diskPercent"],
                "load1": None if latest is None else latest["load1"],
                "error": None if latest is None or latest["online"] else latest["error"],
                "collectedAt": None if latest is None else latest["ts"],
                "activeAlerts": count_active_alerts(server["id"]),
            }
        )
    return cards


def snapshot(server_id: str) -> dict | None:
    server = get_server(server_id)
    if not server:
        return None
    since = now_ms() - HISTORY_WINDOW_MS
    latest = one_sample(
        "SELECT * FROM samples WHERE server_id = ? ORDER BY ts DESC, id DESC LIMIT 1",
        (server_id,),
    )
    last_ok = one_sample(
        "SELECT * FROM samples WHERE server_id = ? AND online = 1 ORDER BY ts DESC, id DESC LIMIT 1",
        (server_id,),
    )
    with _lock:
        rows = connect().execute(
            "SELECT * FROM samples WHERE server_id = ? AND online = 1 AND ts >= ? ORDER BY ts ASC",
            (server_id, since),
        ).fetchall()
    return {
        "server": server,
        "intervalMs": POLL_INTERVAL_MS,
        "historyWindowMs": HISTORY_WINDOW_MS,
        "latest": latest,
        "lastOk": last_ok,
        "history": [sample_out(row) for row in rows],
        "error": None if latest is None or latest["online"] else latest["error"],
        "collectedAt": None if latest is None else latest["ts"],
        "activeAlerts": count_active_alerts(server_id),
        "recentAlerts": list_alert_log(server_id, 8),
    }


def telegram_public() -> dict:
    token = setting("tg_token")
    hint = None
    if token:
        hint = f"••••{token[-4:]}" if len(token) > 8 else "••••"
    return {
        "enabled": setting("tg_enabled") == "1",
        "hasToken": bool(token),
        "tokenHint": hint,
        "chatId": setting("tg_chat") or "",
    }


def telegram_secret() -> dict:
    return {
        "enabled": setting("tg_enabled") == "1",
        "token": setting("tg_token") or "",
        "chatId": setting("tg_chat") or "",
    }


def save_telegram(enabled: bool, token: str | None, chat_id: str) -> dict:
    chat_id = chat_id.strip()
    if len(chat_id) > 64:
        raise ApiError("Chat id слишком длинный.")
    current = telegram_secret()
    stored = (token or "").strip() or current["token"]
    if enabled and (not stored or not chat_id):
        raise ApiError("Чтобы включить Telegram, нужны токен бота и chat id.")
    if stored and not re.fullmatch(r"\d{6,}:[A-Za-z0-9_-]{20,}", stored):
        raise ApiError("Токен бота не похож на токен Telegram.")
    put_setting("tg_enabled", "1" if enabled else "0")
    put_setting("tg_chat", chat_id)
    if stored:
        put_setting("tg_token", stored)
    return telegram_public()


def list_rules() -> list[dict]:
    with _lock:
        rows = connect().execute("SELECT * FROM alert_rules ORDER BY rowid ASC").fetchall()
    return [rule for row in rows if (rule := rule_out(row))]


def create_rule(payload: dict) -> dict:
    rule = parse_rule(payload)
    if rule["serverId"] and not get_server(rule["serverId"]):
        raise ApiError("Сервер для алерта не найден.", 404)
    rule_id = str(uuid.uuid4())
    with _lock:
        connect().execute(
            """
            INSERT INTO alert_rules (id, server_id, metric, threshold, enabled, cooldown_sec)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (rule_id, rule["serverId"], rule["metric"], rule["threshold"], 1 if rule["enabled"] else 0, rule["cooldownSec"]),
        )
        connect().commit()
    created = next((item for item in list_rules() if item["id"] == rule_id), None)
    if not created:
        raise ApiError("Не удалось сохранить алерт.")
    return created


def update_rule(rule_id: str, payload: dict) -> dict:
    if not any(rule["id"] == rule_id for rule in list_rules()):
        raise ApiError("Алерт не найден.", 404)
    rule = parse_rule(payload)
    if rule["serverId"] and not get_server(rule["serverId"]):
        raise ApiError("Сервер для алерта не найден.", 404)
    with _lock:
        connect().execute(
            """
            UPDATE alert_rules
            SET server_id = ?, metric = ?, threshold = ?, enabled = ?, cooldown_sec = ?
            WHERE id = ?
            """,
            (rule["serverId"], rule["metric"], rule["threshold"], 1 if rule["enabled"] else 0, rule["cooldownSec"], rule_id),
        )
        connect().commit()
    updated = next((item for item in list_rules() if item["id"] == rule_id), None)
    if not updated:
        raise ApiError("Алерт не найден.", 404)
    return updated


def delete_rule(rule_id: str) -> None:
    with _lock:
        database = connect()
        database.execute("DELETE FROM alert_state WHERE rule_id = ?", (rule_id,))
        database.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
        database.commit()


def alert_state(rule_id: str, server_id: str) -> dict | None:
    with _lock:
        row = connect().execute(
            "SELECT active, last_sent FROM alert_state WHERE rule_id = ? AND server_id = ?",
            (rule_id, server_id),
        ).fetchone()
    if not row:
        return None
    return {"active": row["active"] == 1, "lastSent": row["last_sent"] or 0}


def set_alert_state(rule_id: str, server_id: str, active: bool, last_sent: int) -> None:
    with _lock:
        connect().execute(
            """
            INSERT INTO alert_state (rule_id, server_id, active, last_sent)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (rule_id, server_id) DO UPDATE SET active = excluded.active, last_sent = excluded.last_sent
            """,
            (rule_id, server_id, 1 if active else 0, last_sent),
        )
        connect().commit()


def add_alert_log(server_id: str | None, rule_id: str | None, message: str, sent: bool) -> None:
    from backend.probe import redact

    token = telegram_secret()["token"]
    with _lock:
        connect().execute(
            "INSERT INTO alert_log (ts, server_id, rule_id, message, sent) VALUES (?, ?, ?, ?, ?)",
            (now_ms(), server_id, rule_id, redact(message, [token]), 1 if sent else 0),
        )
        connect().commit()


def list_alert_log(server_id: str | None = None, limit: int = 30) -> list[dict]:
    with _lock:
        if server_id:
            rows = connect().execute(
                "SELECT * FROM alert_log WHERE server_id = ? ORDER BY id DESC LIMIT ?",
                (server_id, limit),
            ).fetchall()
        else:
            rows = connect().execute("SELECT * FROM alert_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [
        {
            "id": row["id"],
            "ts": row["ts"],
            "serverId": row["server_id"],
            "ruleId": row["rule_id"],
            "message": row["message"] or "",
            "sent": row["sent"] == 1,
        }
        for row in rows
    ]


def count_active_alerts(server_id: str) -> int:
    with _lock:
        row = connect().execute(
            "SELECT COUNT(*) AS total FROM alert_state WHERE server_id = ? AND active = 1",
            (server_id,),
        ).fetchone()
    return int(row["total"]) if row else 0


def latest_sample(server_id: str) -> dict | None:
    return one_sample(
        "SELECT * FROM samples WHERE server_id = ? ORDER BY ts DESC, id DESC LIMIT 1",
        (server_id,),
    )


def one_sample(sql: str, params: tuple) -> dict | None:
    with _lock:
        row = connect().execute(sql, params).fetchone()
    return sample_out(row) if row else None


def setting(key: str) -> str | None:
    with _lock:
        row = connect().execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def put_setting(key: str, value: str) -> None:
    with _lock:
        connect().execute(
            """
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
        connect().commit()


def parse_draft(payload: dict, password_required: bool) -> dict:
    name = clean(str(payload.get("name") or ""), 80)
    host = clean(str(payload.get("host") or ""), 253)
    username = clean(str(payload.get("username") or ""), 64)
    password = str(payload.get("password") or "").replace("\r", "").replace("\n", "")
    try:
        port = int(payload.get("port"))
    except (TypeError, ValueError):
        port = 0
    if not name:
        raise ApiError("Укажите название сервера.")
    if not host or re.search(r"[\s/]", host):
        raise ApiError("Укажите адрес без пробелов.")
    if not username:
        raise ApiError("Укажите пользователя SSH.")
    if port < 1 or port > 65535:
        raise ApiError("Порт должен быть от 1 до 65535.")
    if password_required and not password:
        raise ApiError("Укажите пароль.")
    if len(password) > 256:
        raise ApiError("Пароль слишком длинный.")
    return {"name": name, "host": host, "port": port, "username": username, "password": password}


def parse_rule(payload: dict) -> dict:
    metric = str(payload.get("metric") or "")
    if metric not in METRICS:
        raise ApiError("Неизвестная метрика алерта.")
    try:
        threshold = float(payload.get("threshold") or 0)
    except (TypeError, ValueError):
        raise ApiError("Порог должен быть числом от 0 до 1000.") from None
    if metric != "offline" and (threshold < 0 or threshold > 1000):
        raise ApiError("Порог должен быть числом от 0 до 1000.")
    try:
        cooldown = int(payload.get("cooldownSec") or 600)
    except (TypeError, ValueError):
        cooldown = 0
    if cooldown not in COOLDOWNS:
        raise ApiError("Выберите паузу между повторами: 5, 10, 30 или 60 минут.")
    server_id = payload.get("serverId") or None
    return {
        "serverId": server_id,
        "metric": metric,
        "threshold": 0 if metric == "offline" else threshold,
        "enabled": bool(payload.get("enabled", True)),
        "cooldownSec": cooldown,
    }


def public_server(row: sqlite3.Row) -> dict:
    has_password = row["has_password"] if "has_password" in row.keys() else bool(row["password"])
    return {
        "id": row["id"],
        "name": row["name"],
        "host": row["host"],
        "port": row["port"],
        "username": row["username"],
        "hasPassword": bool(has_password),
    }


def sample_out(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "ts": row["ts"],
        "online": row["online"] == 1,
        "hostname": row["hostname"],
        "uptimeSeconds": row["uptime_seconds"],
        "load1": row["load1"],
        "load5": row["load5"],
        "load15": row["load15"],
        "cpuCount": row["cpu_count"],
        "cpuPercent": row["cpu_percent"],
        "memTotal": row["mem_total"],
        "memUsed": row["mem_used"],
        "memPercent": row["mem_percent"],
        "diskTotal": row["disk_total"],
        "diskUsed": row["disk_used"],
        "diskPercent": row["disk_percent"],
        "diskMount": row["disk_mount"],
        "error": row["error"],
    }


def rule_out(row: sqlite3.Row) -> dict | None:
    if row["metric"] not in METRICS:
        return None
    return {
        "id": row["id"],
        "serverId": row["server_id"],
        "metric": row["metric"],
        "threshold": row["threshold"],
        "enabled": row["enabled"] == 1,
        "cooldownSec": row["cooldown_sec"] or 600,
    }


def clean(value: str, limit: int) -> str:
    return re.sub(r"[\u0000-\u001f]", "", value).strip()[:limit]
