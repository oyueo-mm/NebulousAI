"""Evaluate policies in the learner slot on held-out seeds, under identical conditions.

    python -m rl.evaluate --model rl/checkpoints/ppo-v1/final.zip --model-json public/models/ppo-v1.json \
        --untrained-json public/models/ppo-untrained.json --episodes 48 --out docs/results/rl_eval.json

Every policy plays exactly the same (scenario, seed) pairs, seeds start at EVAL_SEED_BASE
(never used in training). Heuristics and the TypeScript network run inside the bridge
(`learnerPolicy`); "ppo-v1 (torch)" is driven from Python by Stable-Baselines3, so the
torch and TypeScript rows also cross-check browser inference end to end.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .envs import EVAL_SEED_BASE, NebulousVecEnv
from .train import load_config


def scenarios_from_config(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for stage in cfg["stages"]:
        for sc in stage["scenarios"]:
            seen.setdefault(sc["name"], {k: v for k, v in sc.items() if k != "weight"})
    return list(seen.values())


def run_episodes(scenario: dict, seeds: list[int], decision_interval: int, *, learner_policy: str | None = None,
                 model_id: str | None = None, deterministic: bool = True, models: list[dict] = (), quantize: bool = False,
                 act: Callable[[np.ndarray], np.ndarray] | None = None, processes: int = 4) -> list[dict[str, Any]]:
    env_cfg: dict[str, Any] = {"scenarios": [scenario], "decisionInterval": decision_interval}
    if learner_policy:
        env_cfg.update(learnerPolicy=learner_policy, learnerModelId=model_id, learnerDeterministic=deterministic, quantizeLearner=quantize)
    env = NebulousVecEnv(len(seeds), env_cfg, seed=EVAL_SEED_BASE + 5_000_000, processes=processes)
    try:
        for m in models:
            env.add_model(m)
        obs = env.reset(seeds=seeds)
        results: list[dict[str, Any] | None] = [None] * len(seeds)
        while any(r is None for r in results):
            actions = act(obs) if act is not None else np.zeros(len(seeds), dtype=np.int64)
            env.step_async(actions)
            obs, _, dones, infos = env.step_wait()
            for i, d in enumerate(dones):
                if d and results[i] is None:
                    results[i] = infos[i]["nebulous"]
        return [r for r in results if r is not None]
    finally:
        env.close()


def make_torch_act(path: str, cfg: dict[str, Any], scenario: dict[str, Any]) -> Callable[[np.ndarray], np.ndarray]:
    """Deterministic SB3 policy (with its VecNormalize stats and action masks if trained with them)."""
    from stable_baselines3.common.vec_env import VecNormalize

    from .envs import action_masks_from_obs
    from .train import algorithm_class

    model = algorithm_class(cfg).load(path, device="cpu")
    vn = Path(path).with_name(Path(path).stem + "_vecnormalize.pkl")
    dummy = NebulousVecEnv(1, {"scenarios": [scenario]})
    vecnorm = VecNormalize.load(str(vn), dummy) if vn.exists() else None
    if vecnorm is not None:
        vecnorm.training = False
    dummy.close()
    masking = cfg.get("algorithm") == "maskable_ppo"

    def act(obs: np.ndarray) -> np.ndarray:
        x = vecnorm.normalize_obs(obs) if vecnorm is not None else obs
        kw = {"action_masks": action_masks_from_obs(obs)} if masking else {}
        return model.predict(x, deterministic=True, **kw)[0]

    return act


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    def mean_ci(key: str) -> tuple[float, float]:
        v = np.asarray([float(r[key]) for r in rows])
        ci = 1.96 * v.std(ddof=1) / math.sqrt(len(v)) if len(v) > 1 else 0.0
        return float(v.mean()), float(ci)

    out: dict[str, Any] = {"episodes": len(rows)}
    for key in ("r", "final_mass", "max_mass", "survival", "kills", "cells_eaten", "rank", "splits", "invalid"):
        m, ci = mean_ci(key)
        out[key] = round(m, 3)
        out[f"{key}_ci"] = round(ci, 3)
    out["death_rate"] = round(float(np.mean([r["died"] for r in rows])), 3)
    out["win_rate"] = round(float(np.mean([r["won"] for r in rows])), 3)
    return out


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="rl/configs/ppo_v1.json", help="training config of --model (algorithm, decision interval)")
    ap.add_argument("--scenario-config", help="config whose scenarios to evaluate on (default: --config)")
    ap.add_argument("--model", help="SB3 .zip for the torch-driven row")
    ap.add_argument("--model-json", help="exported JSON of the same model, for the TypeScript-driven rows")
    ap.add_argument("--untrained-json", help="exported untrained network (before-training baseline)")
    ap.add_argument("--selfplay-opponent", help="model JSON that plays the 'selfplay-snapshot' opponents (default: --model-json); the same for every row")
    ap.add_argument("--compare", nargs="*", default=[], help="more exported model JSONs to evaluate (TypeScript argmax rows)")
    ap.add_argument("--episodes", type=int, default=48)
    ap.add_argument("--scenarios", nargs="*", help="subset of scenario names (default: all in the config)")
    ap.add_argument("--heuristics", nargs="*", default=["random", "greedy", "survival", "aggressive", "hybrid"])
    ap.add_argument("--quantized", nargs="*", default=[], help="heuristics to also evaluate restricted to the 27 discrete actions")
    ap.add_argument("--extra-zip", nargs="*", default=[], help="label=path.zip pairs evaluated via torch (e.g. imitation-only checkpoints)")
    ap.add_argument("--out")
    args = ap.parse_args()

    cfg = load_config(args.config)
    di = cfg.get("decision_interval", 2)
    scen_cfg = load_config(args.scenario_config) if args.scenario_config else cfg
    scenarios = [s for s in scenarios_from_config(scen_cfg) if not args.scenarios or s["name"] in args.scenarios]
    seeds = [EVAL_SEED_BASE + i for i in range(args.episodes)]
    models: list[dict] = []
    trained_json = json.loads(Path(args.model_json).read_text(encoding="utf-8")) if args.model_json else None
    untrained_json = json.loads(Path(args.untrained_json).read_text(encoding="utf-8")) if args.untrained_json else None
    compare_json = [json.loads(Path(p).read_text(encoding="utf-8")) for p in args.compare]
    for m in (trained_json, untrained_json, *compare_json):
        if m:
            models.append(m)
    # Self-play scenarios reference the frozen snapshot id: one fixed opponent model for every row.
    opponent = json.loads(Path(args.selfplay_opponent).read_text(encoding="utf-8")) if args.selfplay_opponent else trained_json
    if opponent:
        models.append({**opponent, "id": "selfplay-snapshot"})
        report_opponent = opponent["id"]
    else:
        report_opponent = None
        scenarios = [s for s in scenarios if not any(o.get("modelId") == "selfplay-snapshot" for o in s["opponents"])]

    torch_act = make_torch_act(args.model, cfg, scenarios[0]) if args.model else None

    entries: list[tuple[str, dict[str, Any]]] = [(h, {"learner_policy": h}) for h in args.heuristics]
    entries += [(f"{h} (quantized)", {"learner_policy": h, "quantize": True}) for h in args.quantized]
    for pair in args.extra_zip:
        label, path = pair.split("=", 1)
        entries.append((label, {"act": make_torch_act(path, cfg, scenarios[0])}))
    if untrained_json:
        entries.append((f"{untrained_json['id']} (argmax)", {"learner_policy": "ppo", "model_id": untrained_json["id"]}))
    for m in compare_json:
        entries.append((f"{m['id']} (TS, argmax)", {"learner_policy": "ppo", "model_id": m["id"]}))
    if trained_json:
        entries.append((f"{trained_json['id']} (TS, argmax)", {"learner_policy": "ppo", "model_id": trained_json["id"]}))
        entries.append((f"{trained_json['id']} (TS, sampled)", {"learner_policy": "ppo", "model_id": trained_json["id"], "deterministic": False}))
    if torch_act is not None:
        entries.append(("ppo (torch, argmax)", {"act": torch_act}))

    report: dict[str, Any] = {"createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "config": args.config, "episodes": args.episodes,
                              "seeds": [seeds[0], seeds[-1]], "selfplayOpponent": report_opponent, "results": {}, "agreement": {}}
    for sc in scenarios:
        report["results"][sc["name"]] = {}
        per_entry: dict[str, list[dict[str, Any]]] = {}
        print(f"\n== scenario {sc['name']} ({args.episodes} held-out seeds)")
        print(f"{'policy':<26}{'return':>16}{'final mass':>16}{'survival s':>14}{'death':>8}{'win':>7}{'kills':>8}")
        for name, kw in entries:
            t0 = time.time()
            rows = run_episodes(sc, seeds, di, models=models, **kw)
            per_entry[name] = rows
            s = summarize(rows)
            s["wallSeconds"] = round(time.time() - t0, 1)
            report["results"][sc["name"]][name] = s
            print(f"{name:<26}{s['r']:>9.2f} ±{s['r_ci']:<5.2f}{s['final_mass']:>9.1f} ±{s['final_mass_ci']:<5.1f}"
                  f"{s['survival']:>9.1f} ±{s['survival_ci']:<4.1f}{s['death_rate']:>7.2f}{s['win_rate']:>7.2f}{s['kills']:>8.2f}", flush=True)
        ts_key = f"{trained_json['id']} (TS, argmax)" if trained_json else None
        if ts_key and "ppo (torch, argmax)" in per_entry:
            a, b = per_entry[ts_key], per_entry["ppo (torch, argmax)"]
            same = sum(1 for x, y in zip(a, b) if abs(x["r"] - y["r"]) < 1e-6 and x["l"] == y["l"])
            report["agreement"][sc["name"]] = {"identical_episodes": same, "episodes": len(a)}
            print(f"   torch vs TypeScript inference: {same}/{len(a)} episodes identical")
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(report, indent=1), encoding="utf-8")
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
