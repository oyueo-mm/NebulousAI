"""Client for the Node engine bridge (rl/bridge/bridge.ts).

The Python side never re-implements game rules: every environment step runs the
same TypeScript engine, perception, obs-v1 encoder and reward-v1 code as the
browser. This module only frames messages over the child process's pipes.
"""
from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
BRIDGE_JS = REPO_ROOT / "rl" / "bridge" / "dist" / "bridge.mjs"


class BridgeError(RuntimeError):
    pass


class Bridge:
    """One Node process hosting `num_envs` environments."""

    def __init__(self, node: str | None = None, bridge_js: Path | str | None = None):
        path = Path(bridge_js) if bridge_js else BRIDGE_JS
        if not path.exists():
            raise BridgeError(f"{path} not found - run `npm ci && npm run build:node` first")
        node = node or os.environ.get("NEBULOUS_NODE") or shutil.which("node")
        if not node:
            raise BridgeError("Node.js not found on PATH (set NEBULOUS_NODE)")
        self.proc = subprocess.Popen(
            [node, str(path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None, cwd=str(REPO_ROOT), bufsize=0
        )
        self.obs_size = 0
        self.num_actions = 0
        self.versions: dict[str, Any] = {}

    # ------------------------------------------------------------- framing
    def _read_exact(self, n: int) -> bytes:
        assert self.proc.stdout is not None
        chunks, got = [], 0
        while got < n:
            b = self.proc.stdout.read(n - got)
            if not b:
                raise BridgeError(f"bridge process exited (code {self.proc.poll()})")
            chunks.append(b)
            got += len(b)
        return b"".join(chunks)

    def call(self, cmd: str, **payload: Any) -> tuple[dict[str, Any], np.ndarray | None]:
        self.send(cmd, **payload)
        return self.recv()

    def send(self, cmd: str, **payload: Any) -> None:
        """Writes a request without waiting, so several bridge processes can work in parallel."""
        assert self.proc.stdin is not None
        data = json.dumps({"cmd": cmd, **payload}).encode("utf-8")
        self.proc.stdin.write(struct.pack("<I", len(data)) + data)
        self.proc.stdin.flush()

    def recv(self) -> tuple[dict[str, Any], np.ndarray | None]:
        (hlen,) = struct.unpack("<I", self._read_exact(4))
        header = json.loads(self._read_exact(hlen).decode("utf-8"))
        arr = None
        if header.get("bin"):
            (blen,) = struct.unpack("<I", self._read_exact(4))
            arr = np.frombuffer(self._read_exact(blen), dtype="<f4").copy()
        if not header.get("ok"):
            raise BridgeError(header.get("error", "unknown bridge error"))
        return header, arr

    # ------------------------------------------------------------- commands
    def init(self, num_envs: int, env: dict[str, Any], seed: int) -> dict[str, Any]:
        header, _ = self.call("init", numEnvs=num_envs, env=env, seed=seed)
        self.obs_size = int(header["obsSize"])
        self.num_actions = int(header["numActions"])
        self.versions = {k: header[k] for k in ("rules", "obs", "action", "reward")}
        return header

    def reset(self, seeds: list[int] | None = None) -> tuple[np.ndarray, list[int]]:
        header, arr = self.call("reset", seeds=seeds)
        assert arr is not None
        return arr.reshape(-1, self.obs_size), header["seeds"]

    def step(self, actions: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list, np.ndarray]:
        self.step_send(actions)
        return self.step_recv()

    def step_send(self, actions: np.ndarray) -> None:
        self.send("step", actions=[int(a) for a in actions])

    def step_recv(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list, np.ndarray]:
        header, arr = self.recv()
        assert arr is not None
        rows = arr.reshape(-1, self.obs_size)
        n = len(header["rewards"])
        return (
            rows[:n],
            np.asarray(header["rewards"], dtype=np.float32),
            np.asarray(header["dones"], dtype=bool),
            np.asarray(header["truncated"], dtype=bool),
            header["infos"],
            rows[n:],
        )

    def set_env(self, env: dict[str, Any]) -> None:
        self.call("setEnv", env=env)

    def add_model(self, model: dict[str, Any]) -> None:
        self.call("addModel", model=model)

    def snapshot(self, index: int = 0) -> dict[str, Any]:
        header, _ = self.call("snapshot", index=index)
        return header["world"]

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                self.call("close")
            except BridgeError:
                pass
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def __enter__(self) -> "Bridge":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
