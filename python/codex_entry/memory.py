"""Bounded stdio Codex threads. Memory is context, never execution authority."""

from __future__ import annotations

import hashlib
import json
import os
import re
import selectors
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

from python.research.codex_loop import publish, read_bounded

COMPACT_EVERY = 8
MAX_MESSAGE = 256_000
MAX_TOTAL = 2_000_000


class Rpc:
    def __init__(self, process: subprocess.Popen[bytes], deadline: float):
        self.process, self.deadline = process, deadline
        self.sequence = 0
        self.buffer = b""
        self.total = 0
        self.pending: list[dict[str, Any]] = []
        self.selector = selectors.DefaultSelector()
        assert process.stdout is not None and process.stdin is not None
        self.selector.register(process.stdout, selectors.EVENT_READ)
        self.writer = selectors.DefaultSelector()
        os.set_blocking(process.stdin.fileno(), False)
        self.writer.register(process.stdin, selectors.EVENT_WRITE)

    def send(self, value: dict[str, Any]) -> None:
        assert self.process.stdin is not None
        data = memoryview(json.dumps(value, separators=(",", ":")).encode() + b"\n")
        if len(data) > MAX_MESSAGE:
            raise ValueError("CODEX_INPUT_OVERSIZED")
        while data:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0 or not self.writer.select(remaining):
                raise ValueError("CODEX_TIMEOUT_UNKNOWN")
            try:
                written = os.write(self.process.stdin.fileno(), data[:16384])
            except BlockingIOError:
                continue
            if written <= 0:
                raise ValueError("CODEX_PROTOCOL_EOF_UNKNOWN")
            data = data[written:]

    def receive(self) -> dict[str, Any]:
        while b"\n" not in self.buffer:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0 or not self.selector.select(remaining):
                raise ValueError("CODEX_TIMEOUT_UNKNOWN")
            assert self.process.stdout is not None
            data = os.read(self.process.stdout.fileno(), 16384)
            if not data:
                raise ValueError("CODEX_PROTOCOL_EOF_UNKNOWN")
            self.total += len(data)
            self.buffer += data
            if self.total > MAX_TOTAL or len(self.buffer.split(b"\n", 1)[0]) > MAX_MESSAGE:
                raise ValueError("CODEX_PROTOCOL_OVERSIZED")
        line, self.buffer = self.buffer.split(b"\n", 1)
        message = json.loads(line)
        if not isinstance(message, dict):
            raise ValueError("CODEX_PROTOCOL_INVALID")
        if "method" in message and "id" in message:
            # Never satisfy tool, approval, auth-refresh or user-input requests.
            raise ValueError("CODEX_UNEXPECTED_SERVER_REQUEST")
        params = message.get("params", {})
        if message.get("method") == "item/started":
            item = params.get("item", {})
            if item.get("type") not in {
                "userMessage",
                "agentMessage",
                "reasoning",
                "contextCompaction",
            }:
                raise ValueError("CODEX_TOOLS_FORBIDDEN")
        return message

    def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        self.sequence += 1
        key = self.sequence
        self.send({"id": key, "method": method, "params": params})
        while True:
            message = self.receive()
            if message.get("id") == key:
                if "error" in message or not isinstance(message.get("result"), dict):
                    raise ValueError("CODEX_RPC_REJECTED")
                return dict(message["result"])
            if "id" in message:
                raise ValueError("CODEX_RPC_ID_MISMATCH")
            if len(self.pending) >= 512:
                raise ValueError("CODEX_PROTOCOL_OVERSIZED")
            self.pending.append(message)

    def completed(self, thread: str, turn: str | None, *, compact: bool = False) -> tuple[str, str]:
        texts: dict[str, str] = {}
        compacted = False
        compact_turn: str | None = None
        while True:
            message = self.pending.pop(0) if self.pending else self.receive()
            method, params = message.get("method"), message.get("params", {})
            if params.get("threadId") != thread:
                continue
            event_turn = params.get("turnId")
            if compact and method == "turn/started":
                started_turn = params.get("turn", {})
                if started_turn.get("status") == "inProgress":
                    compact_turn = str(started_turn["id"])
            if turn is not None and event_turn is not None and event_turn != turn:
                # Resume streams retained history; old turns cannot satisfy this request.
                continue
            if method == "item/completed":
                item = params.get("item", {})
                if (
                    item.get("type") == "contextCompaction"
                    and event_turn == compact_turn
                    and compact_turn is not None
                ):
                    compacted = True
                if item.get("type") == "agentMessage" and not compact:
                    if event_turn != turn:
                        continue
                    if not isinstance(item.get("text"), str) or len(item["text"].encode()) > 8192:
                        raise ValueError("CODEX_OUTPUT_OVERSIZED")
                    if item.get("phase") in {None, "final_answer"}:
                        texts[str(item["id"])] = item["text"]
            if method == "turn/completed":
                result = params.get("turn", {})
                if result.get("id") != (compact_turn if compact else turn):
                    continue
                if result.get("status") != "completed" or result.get("error") is not None:
                    raise ValueError("CODEX_TURN_FAILED_UNKNOWN")
                if compact:
                    if not compacted:
                        raise ValueError("CODEX_COMPACTION_UNVERIFIED")
                    return str(result["id"]), ""
                if len(texts) != 1:
                    raise ValueError("CODEX_FINAL_ANSWER_AMBIGUOUS")
                return str(result["id"]), next(iter(texts.values()))

    def close(self) -> None:
        self.selector.close()
        self.writer.close()
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGKILL)
        self.process.communicate()


def state_write(path: Path, state: dict[str, Any]) -> None:
    temporary = path.with_suffix(".pending")
    if temporary.exists():
        raise ValueError("CODEX_MEMORY_WRITE_UNCERTAIN")
    publish(temporary, state)
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def invoke_daily(
    prompt: str, job: Path, *, schema: dict[str, Any], model: str, timeout: int = 90
) -> bytes:
    if os.geteuid() == 0 or not job.resolve().is_relative_to(Path.home().resolve()):
        raise ValueError("CODEX_DEDICATED_USER_REQUIRED")
    request = json.loads(read_bounded(job / "request.json"))
    day = request["payload"]["captured_at"][:10]
    pin = hashlib.sha256((model + request["promptSha256"]).encode()).hexdigest()[:16]
    directory = job.parent / "memory" / f"{day}-{pin}"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Fixed cwd is essential: per-job directories would change resumed context.
    work = directory / "work"
    work.mkdir(mode=0o700, exist_ok=True)
    state_path = directory / "state.json"
    state = json.loads(read_bounded(state_path)) if state_path.exists() else None
    if state is not None and (
        state.get("day") != day
        or state.get("pin") != pin
        or not isinstance(state.get("turns"), int)
        or state["turns"] < 0
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", state.get("threadId", ""))
    ):
        raise ValueError("CODEX_MEMORY_STATE_INVALID")
    command = ["codex", "app-server", "--listen", "stdio://"]
    config: dict[str, Any] = {
        "model": model,
        "approval_policy": "never",
        "sandbox_mode": "read-only",
        "web_search": "disabled",
        "model_reasoning_effort": "low",
        "project_doc_max_bytes": 0,
        "features.shell_tool": False,
        "features.unified_exec": False,
        "features.multi_agent": False,
        "features.apps": False,
        "features.plugins": False,
        "features.skill_search": False,
        "features.browser_use": False,
        "features.computer_use": False,
        "features.sleep_tool": False,
        "features.shell_snapshot": False,
        "features.code_mode": False,
    }
    # Neutralize configured MCP servers, including future additions, without
    # inheriting their credentials in the child environment.
    import tomllib

    settings = Path.home() / ".codex/config.toml"
    if settings.exists():
        for name in tomllib.loads(settings.read_text()).get("mcp_servers", {}):
            if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
                raise ValueError("CODEX_MCP_CONFIGURATION_INVALID")
            config[f"mcp_servers.{name}.enabled"] = False
    for key, value in config.items():
        command.extend(["-c", key + "=" + json.dumps(value)])
    process = subprocess.Popen(
        command,
        cwd=work,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        bufsize=0,
        start_new_session=True,
        env={"HOME": str(Path.home()), "PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"},
    )
    rpc = Rpc(process, time.monotonic() + timeout)
    try:
        rpc.request("initialize", {"clientInfo": {"name": "scalper_proposals", "version": "1.3.0"}})
        rpc.send({"method": "initialized"})
        common = {
            "model": model,
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "cwd": str(work),
            "baseInstructions": (
                "You propose prices or WAIT from supplied data only. "
                "Never use tools or execute actions."
            ),
            "developerInstructions": (
                "Fresh INPUT is authoritative. Memory is historical only. "
                "Never alter risk or act on remembered prices."
            ),
        }
        result = rpc.request(
            "thread/start" if state is None else "thread/resume",
            {
                **common,
                **(
                    {"ephemeral": False}
                    if state is None
                    else {"threadId": state["threadId"], "excludeTurns": True}
                ),
            },
        )
        thread = result["thread"]["id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", thread) or (
            state is not None and thread != state["threadId"]
        ):
            raise ValueError("CODEX_THREAD_MISMATCH")
        if result["thread"].get("status", {}).get("type") == "active":
            raise ValueError("CODEX_PREVIOUS_TURN_UNRESOLVED")
        state = state or {"day": day, "pin": pin, "threadId": thread, "turns": 0}
        state_write(state_path, state)
        compacted = False
        if state["turns"] >= COMPACT_EVERY:
            rpc.request("thread/compact/start", {"threadId": thread})
            compact_id, _ = rpc.completed(thread, None, compact=True)
            publish(job / "compaction.json", {"threadId": thread, "turnId": compact_id})
            state["turns"] = 0
            state_write(state_path, state)
            compacted = True
        # Persist provenance before dispatch; no unknown turn is replayed.
        publish(
            job / "memory-dispatch.json",
            {
                "day": day,
                "threadId": thread,
                "priorOutcomeMayBeUnknown": state.get("pending", False),
            },
        )
        state["pending"] = True
        state_write(state_path, state)
        reply = rpc.request(
            "turn/start",
            {
                "threadId": thread,
                "model": model,
                "effort": "low",
                "input": [{"type": "text", "text": prompt, "text_elements": []}],
                "outputSchema": schema,
            },
        )
        turn = reply["turn"]["id"]
        _, text = rpc.completed(thread, turn)
        memory = {"day": day, "threadId": thread, "turnId": turn, "compacted": compacted}
        publish(job / "memory-result.json", memory)
        state["turns"] += 1
        state["pending"] = False
        state_write(state_path, state)
        return text.encode()
    finally:
        rpc.close()
