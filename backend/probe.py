import re
import socket

import paramiko

PROBE = "\n".join(
    [
        "echo '## hostname'",
        "hostname 2>/dev/null || echo unknown",
        "echo '## nproc'",
        "nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1",
        "echo '## uptime'",
        "awk '{print $1}' /proc/uptime 2>/dev/null || true",
        "echo '## load'",
        "awk '{print $1, $2, $3}' /proc/loadavg 2>/dev/null || true",
        "echo '## cpu1'",
        "grep '^cpu ' /proc/stat 2>/dev/null | head -n 1 || true",
        "sleep 1",
        "echo '## cpu2'",
        "grep '^cpu ' /proc/stat 2>/dev/null | head -n 1 || true",
        "echo '## mem'",
        "grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached):' /proc/meminfo 2>/dev/null || true",
        "echo '## disk'",
        "df -P -k / 2>/dev/null | awk 'NR==2 { print $2, $3, $NF }' || true",
    ]
)


def redact(message: str, secrets: list[str | None]) -> str:
    text = message or ""
    for secret in secrets:
        if secret and len(secret) >= 4:
            text = text.replace(secret, "••••")
    return " ".join(text.split())[:400]


def collect(host: str, port: int, username: str, password: str) -> dict:
    output = run_probe(host, port, username, password)
    try:
        return parse_probe(output)
    except Exception as error:
        message = str(error) or "Не удалось разобрать ответ сервера."
        raise RuntimeError(redact(message, [password])) from None


def offline(message: str, password: str | None = None) -> dict:
    return {
        "online": False,
        "hostname": None,
        "uptime_seconds": None,
        "load1": None,
        "load5": None,
        "load15": None,
        "cpu_count": None,
        "cpu_percent": None,
        "mem_total": None,
        "mem_used": None,
        "mem_percent": None,
        "disk_total": None,
        "disk_used": None,
        "disk_percent": None,
        "disk_mount": None,
        "error": redact(message, [password]),
    }


def run_probe(host: str, port: int, username: str, password: str) -> str:
    host = host.strip()
    username = username.strip()
    if not host or not username or not password:
        raise RuntimeError("У сервера не заданы адрес, пользователь или пароль.")
    if not isinstance(port, int) or port < 1 or port > 65535:
        raise RuntimeError("Порт SSH должен быть от 1 до 65535.")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=12,
            banner_timeout=12,
            auth_timeout=12,
            look_for_keys=False,
            allow_agent=False,
        )
        _stdin, stdout, stderr = client.exec_command(PROBE, timeout=20)
        output = stdout.read().decode("utf-8", errors="replace")
        error_output = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        if code:
            detail = redact(error_output or output or f"код {code}", [password])
            raise RuntimeError(f"Команда на сервере завершилась с ошибкой. {detail}")
        return output
    except RuntimeError:
        raise
    except Exception as error:
        raise RuntimeError(public_ssh_error(error, password, port)) from None
    finally:
        client.close()


def public_ssh_error(error: Exception, password: str, port: int) -> str:
    raw = redact(str(error) or "неизвестная ошибка", [password])
    text = raw.lower()
    if "authentication" in text or "auth fail" in text:
        return "Сервер отклонил аутентификацию. Проверьте пользователя и пароль."
    if isinstance(error, (TimeoutError, socket.timeout)) or "timed out" in text or "timeout" in text:
        return "Сервер не ответил вовремя. Проверьте адрес и что порт SSH открыт."
    if "connection refused" in text or "errno 10061" in text or "errno 111" in text:
        return f"Соединение отклонено. На сервере не слушается порт {port}."
    if "name or service not known" in text or "nodename nor servname" in text or "getaddrinfo" in text:
        return "Не удалось найти адрес сервера."
    if "connection reset" in text:
        return "Сервер сбросил соединение."
    if "no route" in text or "host is unreachable" in text or "network is unreachable" in text:
        return "Хост недоступен по сети."
    return f"Ошибка SSH: {raw}"


def parse_probe(output: str) -> dict:
    sections = split_sections(output)
    hostname = clean_hostname(sections.get("hostname"))
    cpu_count = positive_int(first_line(sections.get("nproc")))
    uptime = positive_number(first_line(sections.get("uptime")))
    load = parse_load(sections.get("load"))
    cpu_percent = cpu_usage(sections.get("cpu1"), sections.get("cpu2"))
    memory = parse_memory(sections.get("mem"))
    disk = parse_disk(sections.get("disk"))

    missing = []
    if not hostname:
        missing.append("имя хоста")
    if uptime is None:
        missing.append("аптайм")
    if not load:
        missing.append("нагрузку")
    if not memory:
        missing.append("память")
    if not disk:
        missing.append("диск")
    if missing:
        raise RuntimeError(
            "Сервер прислал неполные данные: нет "
            + ", ".join(missing)
            + ". Нужен Linux с /proc и df."
        )

    mem_used = max(0, memory["total"] - memory["available"])
    return {
        "online": True,
        "hostname": hostname,
        "uptime_seconds": uptime,
        "load1": load[0],
        "load5": load[1],
        "load15": load[2],
        "cpu_count": cpu_count,
        "cpu_percent": cpu_percent,
        "mem_total": memory["total"] * 1024,
        "mem_used": mem_used * 1024,
        "mem_percent": percent(mem_used, memory["total"]),
        "disk_total": disk["total"] * 1024,
        "disk_used": disk["used"] * 1024,
        "disk_percent": percent(disk["used"], disk["total"]),
        "disk_mount": disk["mount"],
        "error": None,
    }


def split_sections(output: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    for part in re.split(r"(?m)^## ", output):
        if "\n" not in part:
            continue
        name, body = part.split("\n", 1)
        name = name.strip()
        if name:
            sections[name] = body.strip()
    return sections


def first_line(value: str | None) -> str:
    if not value:
        return ""
    return value.splitlines()[0].strip()


def clean_hostname(value: str | None) -> str | None:
    hostname = first_line(value)
    if not hostname or len(hostname) > 253 or re.search(r"[\u0000-\u001f]", hostname):
        return None
    return hostname


def positive_int(value: str) -> int | None:
    if not re.fullmatch(r"\d+", value):
        return None
    parsed = int(value)
    return parsed if parsed > 0 else None


def positive_number(value: str) -> float | None:
    if not re.fullmatch(r"\d+(\.\d+)?", value):
        return None
    parsed = float(value)
    return parsed if parsed >= 0 else None


def parse_load(value: str | None) -> tuple[float, float, float] | None:
    parts = first_line(value).split()
    if len(parts) < 3:
        return None
    try:
        numbers = [float(part) for part in parts[:3]]
    except ValueError:
        return None
    if any(item < 0 for item in numbers):
        return None
    return numbers[0], numbers[1], numbers[2]


def cpu_usage(before: str | None, after: str | None) -> float | None:
    first = cpu_counters(before)
    second = cpu_counters(after)
    if not first or not second:
        return None
    total = second["total"] - first["total"]
    idle = second["idle"] - first["idle"]
    if total <= 0:
        return None
    return clamp_percent((1 - idle / total) * 100)


def cpu_counters(line: str | None) -> dict | None:
    parts = first_line(line).split()
    if not parts or parts[0] != "cpu" or len(parts) < 5:
        return None
    try:
        numbers = [float(part) for part in parts[1:]]
    except ValueError:
        return None
    if any(item < 0 for item in numbers):
        return None
    user, nice, system, idle = numbers[:4]
    iowait = numbers[4] if len(numbers) > 4 else 0
    irq = numbers[5] if len(numbers) > 5 else 0
    softirq = numbers[6] if len(numbers) > 6 else 0
    steal = numbers[7] if len(numbers) > 7 else 0
    return {
        "idle": idle + iowait,
        "total": user + nice + system + idle + iowait + irq + softirq + steal,
    }


def parse_memory(value: str | None) -> dict | None:
    found: dict[str, float] = {}
    for line in (value or "").splitlines():
        match = re.match(r"^([A-Za-z]+):\s+(\d+)", line.strip())
        if match:
            found[match.group(1)] = float(match.group(2))
    total = found.get("MemTotal")
    if not total or total <= 0:
        return None
    available = found.get("MemAvailable")
    if available is None:
        available = found.get("MemFree", 0) + found.get("Buffers", 0) + found.get("Cached", 0)
    if available < 0:
        return None
    return {"total": total, "available": available}


def parse_disk(value: str | None) -> dict | None:
    parts = first_line(value).split()
    if len(parts) < 3:
        return None
    try:
        total = float(parts[0])
        used = float(parts[1])
    except ValueError:
        return None
    mount = " ".join(parts[2:])
    if total <= 0 or used < 0 or not mount.startswith("/"):
        return None
    return {"total": total, "used": used, "mount": mount}


def percent(used: float, total: float) -> float | None:
    if total <= 0:
        return None
    return clamp_percent((used / total) * 100)


def clamp_percent(value: float) -> float:
    return max(0, min(100, value))
