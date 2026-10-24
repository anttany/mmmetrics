import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from backend.poller import known, poll_now, start, stop
from backend.store import (
    POLL_INTERVAL_MS,
    ApiError,
    connect,
    create_rule,
    create_server,
    delete_rule,
    delete_server,
    get_server,
    has_samples,
    list_alert_log,
    list_cards,
    list_rules,
    list_servers,
    save_telegram,
    snapshot,
    telegram_public,
    update_rule,
    update_server,
)
from backend.alerts import send_test

logging.getLogger("paramiko").setLevel(logging.WARNING)
logging.basicConfig(level=logging.INFO, format="%(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    connect()
    start()
    yield
    stop()


app = FastAPI(lifespan=lifespan)


def json_body(body: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


@app.exception_handler(ApiError)
async def api_error(_request: Request, error: ApiError) -> JSONResponse:
    return json_body({"error": error.message}, error.status)


@app.get("/api/overview")
def overview():
    return json_body({"intervalMs": POLL_INTERVAL_MS, "servers": list_cards()})


@app.get("/api/metrics")
def metrics_get(serverId: str = ""):
    server_id = serverId.strip()
    if not server_id:
        return json_body({"error": "Не указан сервер."}, 400)
    if not known(server_id):
        return json_body({"error": "Сервер не найден."}, 404)
    if not has_samples(server_id):
        import time

        deadline = time.time() + (POLL_INTERVAL_MS + 8_000) / 1000
        while time.time() < deadline and not has_samples(server_id):
            time.sleep(0.2)
    data = snapshot(server_id)
    if not data:
        return json_body({"error": "Сервер не найден."}, 404)
    return json_body(data)


@app.post("/api/metrics")
async def metrics_post(request: Request):
    body = await read_body(request)
    server_id = str(body.get("serverId") or "").strip()
    if not server_id or not known(server_id):
        return json_body({"error": "Сервер не найден."}, 404)
    poll_now(server_id)
    data = snapshot(server_id)
    if not data:
        return json_body({"error": "Сервер не найден."}, 404)
    return json_body(data)


@app.get("/api/servers")
def servers_get():
    return json_body({"servers": list_servers()})


@app.post("/api/servers")
async def servers_post(request: Request):
    server = create_server(await read_body(request))
    poll_now(server["id"])
    return json_body({"server": server}, 201)


@app.patch("/api/servers/{server_id}")
async def servers_patch(server_id: str, request: Request):
    if not get_server(server_id):
        return json_body({"error": "Сервер не найден."}, 404)
    return json_body({"server": update_server(server_id, await read_body(request))})


@app.delete("/api/servers/{server_id}")
def servers_delete(server_id: str):
    delete_server(server_id)
    return json_body({"ok": True})


@app.get("/api/alerts")
def alerts_get():
    return json_body({"telegram": telegram_public(), "rules": list_rules(), "log": list_alert_log(limit=30)})


@app.post("/api/alerts")
async def alerts_post(request: Request):
    body = await read_body(request)
    rule = create_rule(
        {
            "serverId": body.get("serverId"),
            "metric": body.get("metric") or "",
            "threshold": body.get("threshold") or 0,
            "enabled": body.get("enabled", True),
            "cooldownSec": body.get("cooldownSec") or 600,
        }
    )
    return json_body({"rule": rule}, 201)


@app.patch("/api/alerts/{rule_id}")
async def alerts_patch(rule_id: str, request: Request):
    body = await read_body(request)
    rule = update_rule(
        rule_id,
        {
            "serverId": body.get("serverId"),
            "metric": body.get("metric") or "",
            "threshold": body.get("threshold") or 0,
            "enabled": bool(body.get("enabled")),
            "cooldownSec": body.get("cooldownSec") or 600,
        },
    )
    return json_body({"rule": rule})


@app.delete("/api/alerts/{rule_id}")
def alerts_delete(rule_id: str):
    delete_rule(rule_id)
    return json_body({"ok": True})


@app.get("/api/telegram")
def telegram_get():
    return json_body({"telegram": telegram_public()})


@app.put("/api/telegram")
async def telegram_put(request: Request):
    body = await read_body(request)
    telegram = save_telegram(bool(body.get("enabled")), body.get("token"), str(body.get("chatId") or ""))
    return json_body({"telegram": telegram})


@app.post("/api/telegram")
def telegram_post():
    result = send_test()
    if not result["ok"]:
        return json_body({"ok": False, "error": result["error"]}, 400)
    return json_body({"ok": True})


async def read_body(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as error:
        raise ApiError("Нужен JSON в теле запроса.") from error
    if not isinstance(body, dict):
        raise ApiError("Нужен JSON в теле запроса.")
    return body
