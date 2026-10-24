import logging
import threading
import time

from backend.alerts import evaluate
from backend.probe import collect, offline
from backend.store import POLL_INTERVAL_MS, get_secret, insert_sample, list_secrets

log = logging.getLogger("mmmetrics")
_lock = threading.Lock()
_stop = threading.Event()
_thread: threading.Thread | None = None


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=loop, name="mmmetrics-poller", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()


def poll_now(server_id: str | None = None) -> None:
    with _lock:
        collect_and_store(server_id)


def loop() -> None:
    interval = POLL_INTERVAL_MS / 1000
    while not _stop.is_set():
        started = time.time()
        try:
            poll_now()
        except Exception as error:
            log.error("опрос не удался: %s", error)
        _stop.wait(max(0, interval - (time.time() - started)))


def collect_and_store(server_id: str | None) -> None:
    servers = [server for server in list_secrets() if not server_id or server["id"] == server_id]
    for server in servers:
        try:
            sample = collect(server["host"], int(server["port"]), server["username"], server["password"])
            insert_sample(server["id"], sample)
            evaluate(server, sample)
        except Exception as error:
            message = str(error) or "Не удалось опросить сервер."
            log.error("опрос не удался: %s", message)
            try:
                sample = offline(message, server["password"])
                insert_sample(server["id"], sample)
                evaluate(server, sample)
            except Exception:
                log.error("не удалось записать сбой в локальную базу")


def known(server_id: str) -> bool:
    return get_secret(server_id) is not None
