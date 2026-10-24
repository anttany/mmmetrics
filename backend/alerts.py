import json
import urllib.error
import urllib.request

from backend.probe import redact
from backend.store import (
    add_alert_log,
    alert_state,
    list_rules,
    now_ms,
    set_alert_state,
    telegram_secret,
)


def evaluate(server: dict, sample: dict) -> None:
    rules = [
        rule
        for rule in list_rules()
        if rule["enabled"] and (rule["serverId"] is None or rule["serverId"] == server["id"])
    ]
    for rule in rules:
        evaluate_rule(server, rule, sample)


def send_test() -> dict:
    return deliver("mmmetrics: проверка связи.")


def evaluate_rule(server: dict, rule: dict, sample: dict) -> None:
    firing = is_firing(rule, sample)
    state = alert_state(rule["id"], server["id"])
    current = now_ms()
    if firing:
        if state and state["active"]:
            return
        if state and current - state["lastSent"] < rule["cooldownSec"] * 1000:
            return
        text = alert_text(server, rule, sample, recovered=False)
        result = deliver(text)
        add_alert_log(
            server["id"],
            rule["id"],
            text if result["ok"] else f"{text} Не отправлено: {result['error']}",
            result["ok"],
        )
        set_alert_state(rule["id"], server["id"], True, current)
        return
    if not state or not state["active"]:
        return
    text = alert_text(server, rule, sample, recovered=True)
    result = deliver(text)
    add_alert_log(
        server["id"],
        rule["id"],
        text if result["ok"] else f"{text} Не отправлено: {result['error']}",
        result["ok"],
    )
    set_alert_state(rule["id"], server["id"], False, current)


def is_firing(rule: dict, sample: dict) -> bool:
    if rule["metric"] == "offline":
        return not sample["online"]
    if not sample["online"]:
        return False
    value = metric_value(rule["metric"], sample)
    return value is not None and value >= rule["threshold"]


def metric_value(metric: str, sample: dict):
    return {
        "cpu": sample["cpu_percent"],
        "memory": sample["mem_percent"],
        "disk": sample["disk_percent"],
        "load": sample["load1"],
    }.get(metric)


def alert_text(server: dict, rule: dict, sample: dict, recovered: bool) -> str:
    head = "Снова в норме" if recovered else "Алерт"
    return "\n".join(
        [
            f"mmmetrics · {head}",
            f"{server['name']} · {server['host']}",
            describe(rule, sample, recovered),
        ]
    )


def describe(rule: dict, sample: dict, recovered: bool) -> str:
    if rule["metric"] == "offline":
        if recovered:
            return "Связь по SSH восстановлена."
        return f"Нет связи: {sample['error']}" if sample["error"] else "Нет связи по SSH."
    current = format_load(metric_value(rule["metric"], sample)) if rule["metric"] == "load" else format_percent(metric_value(rule["metric"], sample))
    limit = format_load(rule["threshold"]) if rule["metric"] == "load" else format_percent(rule["threshold"])
    name = metric_name(rule["metric"])
    if recovered:
        return f"{name} снова ниже порога: {current} (порог {limit})."
    return f"{name}: {current}. Порог {limit}."


def metric_name(metric: str) -> str:
    return {
        "cpu": "Процессор",
        "memory": "Память",
        "disk": "Диск",
        "load": "Нагрузка за 1 мин",
    }.get(metric, "Связь")


def format_percent(value) -> str:
    if value is None:
        return "—"
    text = f"{float(value):.1f}".replace(".", ",")
    return f"{text} %"


def format_load(value) -> str:
    if value is None:
        return "—"
    return f"{float(value):.2f}".replace(".", ",")


def deliver(text: str) -> dict:
    telegram = telegram_secret()
    token = telegram["token"]
    if not telegram["enabled"] or not token or not telegram["chatId"]:
        return {"ok": False, "error": "Telegram не включён или не заполнен."}
    payload = json.dumps(
        {
            "chat_id": telegram["chatId"],
            "text": text[:500],
            "disable_web_page_preview": True,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status >= 400:
                body = response.read().decode("utf-8", errors="replace")
                return {"ok": False, "error": telegram_error(body, token)}
        return {"ok": True}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": telegram_error(body, token)}
    except Exception as error:
        return {"ok": False, "error": redact(str(error) or "Сеть недоступна", [token])}


def telegram_error(body: str, token: str) -> str:
    try:
        parsed = json.loads(body)
        if isinstance(parsed, dict) and parsed.get("description"):
            return redact(str(parsed["description"]), [token])
    except json.JSONDecodeError:
        pass
    return redact(body, [token]) or "Telegram отклонил сообщение."
