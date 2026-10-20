"""Independent Python statement of the rules in docs/RULES.md.

This is deliberately *not* a port of the TypeScript engine: it encodes the documented
formulas and invariants, and the conformance tests check engine snapshots against
them. A disagreement means either the engine or the documentation is wrong.
"""
from __future__ import annotations

import math
from typing import Any


def mass_to_radius(mass: float, cfg: dict[str, Any]) -> float:
    """r = sqrt(m / (pi * rho))"""
    return math.sqrt(mass / (math.pi * cfg["density"]))


def max_speed(mass: float, cfg: dict[str, Any]) -> float:
    """v_max(m) = clamp(v0 * (m / m0)^(-alpha), v_min, v0)"""
    v = cfg["speedBase"] * (mass / cfg["startMass"]) ** (-cfg["speedExponent"])
    return min(cfg["speedBase"], max(cfg["speedMin"], v))


def decayed_mass(mass: float, seconds: float, cfg: dict[str, Any]) -> float:
    if mass <= cfg["decayMinMass"]:
        return mass
    return max(cfg["decayMinMass"], mass - mass * cfg["decayRate"] * seconds)


def can_eat(predator: float, prey: float, cfg: dict[str, Any]) -> bool:
    return predator >= cfg["eatRatio"] * prey


def world_mass(snapshot: dict[str, Any]) -> float:
    total = sum(c["mass"] for c in snapshot["cells"] if c["alive"])
    total += sum(f["mass"] for f in snapshot["food"] if f["alive"])
    total += sum(p["mass"] for p in snapshot["pellets"] if p["alive"])
    total += sum(t["mass"] for t in snapshot["thorns"] if t["alive"])
    return total


def ledger_expected(snapshot: dict[str, Any]) -> float:
    l = snapshot["ledger"]
    return (l["initial"] + l["foodSpawned"] + l["thornSpawned"] + l["agentSpawned"]
            - l["decayLost"] - l["splitLost"] - l["ejectLost"] - l["pelletExpired"] - l["eatLost"] - l["capLost"])


def check_snapshot(s: dict[str, Any]) -> list[str]:
    """Static invariants of one world snapshot. Returns human-readable violations."""
    cfg = s["config"]
    errors: list[str] = []
    ids: set[int] = set()
    per_owner: dict[int, int] = {}
    W, H = cfg["worldWidth"], cfg["worldHeight"]
    for c in s["cells"]:
        m, r = c["mass"], c["r"]
        if not (math.isfinite(m) and m > 0):
            errors.append(f"cell {c['id']}: mass {m}")
        if abs(r - mass_to_radius(m, cfg)) > 1e-9 * max(1.0, r):
            errors.append(f"cell {c['id']}: radius {r} != sqrt(m/(pi rho)) = {mass_to_radius(m, cfg)}")
        if not (r - 1e-9 <= c["x"] <= W - r + 1e-9 and r - 1e-9 <= c["y"] <= H - r + 1e-9):
            errors.append(f"cell {c['id']}: centre ({c['x']:.2f},{c['y']:.2f}) outside [r, size - r]")
        if m > cfg["maxCellMass"] + 1e-9:
            errors.append(f"cell {c['id']}: mass above maxCellMass")
        if c["id"] in ids:
            errors.append(f"duplicate cell id {c['id']}")
        ids.add(c["id"])
        per_owner[c["owner"]] = per_owner.get(c["owner"], 0) + 1
    for owner, n in per_owner.items():
        if n > cfg["maxCells"]:
            errors.append(f"agent {owner}: {n} cells > maxCells")
    for a in s["agents"]:
        own = [c for c in s["cells"] if c["owner"] == a["id"]]
        if a["cellCount"] != len(own):
            errors.append(f"agent {a['id']}: cellCount {a['cellCount']} != {len(own)}")
        if abs(a["totalMass"] - sum(c["mass"] for c in own)) > 1e-6:
            errors.append(f"agent {a['id']}: totalMass != sum of its cells")
        if a["alive"] != (len(own) > 0):
            errors.append(f"agent {a['id']}: alive flag inconsistent with its cells")
    got, want = world_mass(s), ledger_expected(s)
    if abs(got - want) > 1e-6 * max(1.0, got):
        errors.append(f"mass ledger imbalance: world {got:.6f} vs ledger {want:.6f}")
    return errors


def check_transition(a: dict[str, Any], b: dict[str, Any], ticks: int) -> list[str]:
    """Kinematic bound between two snapshots `ticks` apart, for agents that stayed a single cell.

    A lone cell moves at most (v_max + |boost|) * dt per tick; v_max is evaluated at the smallest
    mass the cell can have had in between (speed falls with mass): the smaller snapshot mass minus
    possible decay and any ejections (which remove mass before the movement phase of their tick).
    Boosts only decay.
    """
    cfg = a["config"]
    dt = cfg["tickSeconds"] * ticks
    errors: list[str] = []
    ejects_a = {ag["id"]: ag["stats"]["ejects"] for ag in a["agents"]}
    ejects_b = {ag["id"]: ag["stats"]["ejects"] for ag in b["agents"]}
    cells_a = {c["id"]: c for c in a["cells"]}
    counts_a: dict[int, int] = {}
    counts_b: dict[int, int] = {}
    for c in a["cells"]:
        counts_a[c["owner"]] = counts_a.get(c["owner"], 0) + 1
    for c in b["cells"]:
        counts_b[c["owner"]] = counts_b.get(c["owner"], 0) + 1
    for c in b["cells"]:
        prev = cells_a.get(c["id"])
        if prev is None or counts_a.get(c["owner"]) != 1 or counts_b.get(c["owner"]) != 1:
            continue
        # Decay (end of each tick) can lower the mass used by a later tick's movement too.
        decay = prev["mass"] * cfg["decayRate"] * dt if prev["mass"] > cfg["decayMinMass"] else 0.0
        lightest = min(prev["mass"], c["mass"]) - decay - cfg["ejectMass"] * (ejects_b[c["owner"]] - ejects_a[c["owner"]])
        v = max_speed(max(lightest, 1e-9), cfg) + math.hypot(prev["bx"], prev["by"])
        moved = math.hypot(c["x"] - prev["x"], c["y"] - prev["y"])
        if moved > v * dt * (1 + 1e-9) + 1e-6:
            errors.append(f"cell {c['id']} moved {moved:.3f} > bound {v * dt:.3f}")
    return errors
