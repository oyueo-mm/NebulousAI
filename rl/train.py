"""Curriculum PPO training on the NebulousAI engine.

    python -m rl.train --config rl/configs/ppo_v1.json
    python -m rl.train --config rl/configs/ppo_v1.json --resume       # continue after the last finished stage
    python -m rl.train --config rl/configs/smoke.json                  # ~1 minute sanity run

Outputs (rl/checkpoints/<id>/): one checkpoint + VecNormalize stats per stage,
final.zip, progress.csv / TensorBoard logs, and training_meta.json with the
training curve that the browser's RL Lab displays.
"""
from __future__ import annotations

import argparse
import copy
import json
import platform
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch as th
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.logger import configure
from stable_baselines3.common.vec_env import VecNormalize

from .envs import TRAIN_SEED_BASE, NebulousVecEnv

SELFPLAY_ID = "selfplay-snapshot"


def load_config(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def stage_env_config(cfg: dict[str, Any], stage: dict[str, Any]) -> dict[str, Any]:
    return {"scenarios": stage["scenarios"], "decisionInterval": cfg.get("decision_interval", 2), "reward": cfg.get("reward", {})}


def algorithm_class(cfg: dict[str, Any]):
    """'ppo' (default) or 'maskable_ppo' (sb3-contrib, invalid split/eject actions masked out)."""
    if cfg.get("algorithm", "ppo") == "maskable_ppo":
        from sb3_contrib import MaskablePPO

        return MaskablePPO
    return PPO


def build_model(cfg: dict[str, Any], env, device: str, tensorboard: str | None) -> PPO:
    p = cfg["ppo"]
    act = {"tanh": th.nn.Tanh, "relu": th.nn.ReLU}[p.get("activation", "tanh")]
    arch = p.get("net_arch", [128, 128])
    return algorithm_class(cfg)(
        "MlpPolicy", env, n_steps=p["n_steps"], batch_size=p["batch_size"], n_epochs=p["n_epochs"], learning_rate=p["learning_rate"],
        gamma=p["gamma"], gae_lambda=p["gae_lambda"], clip_range=p["clip_range"], ent_coef=p["ent_coef"], vf_coef=p["vf_coef"],
        max_grad_norm=p["max_grad_norm"], policy_kwargs={"net_arch": {"pi": arch, "vf": arch}, "activation_fn": act},
        seed=cfg.get("seed", 0), device=device, tensorboard_log=tensorboard, verbose=0,
    )


class CurveRecorder(BaseCallback):
    """Records one point per rollout: timesteps, mean episode return/length, and game metrics."""

    def __init__(self, stage: str, curve: list[dict[str, Any]], venv: NebulousVecEnv, print_every: int = 1):
        super().__init__()
        self.stage, self.curve, self.venv, self.print_every = stage, curve, venv, print_every
        self.rollouts = 0
        self.t0 = time.time()
        self.start_steps: int | None = None

    def _on_step(self) -> bool:
        if self.start_steps is None:
            self.start_steps = int(self.num_timesteps)
        return True

    def _on_rollout_end(self) -> None:
        self.rollouts += 1
        eps = self.venv.episode_infos
        self.venv.episode_infos = []
        buf = list(self.model.ep_info_buffer)
        point: dict[str, Any] = {"timesteps": int(self.num_timesteps), "stage": self.stage}
        if buf:
            point["ep_rew_mean"] = round(float(np.mean([e["r"] for e in buf])), 4)
            point["ep_len_mean"] = round(float(np.mean([e["l"] for e in buf])), 2)
        if eps:
            point["episodes"] = len(eps)
            point["final_mass"] = round(float(np.mean([e["final_mass"] for e in eps])), 2)
            point["death_rate"] = round(float(np.mean([e["died"] for e in eps])), 4)
            point["kills"] = round(float(np.mean([e["kills"] for e in eps])), 4)
        self.curve.append(point)
        if self.rollouts % self.print_every == 0:
            fps = (self.num_timesteps - (self.start_steps or 0)) / max(1e-9, time.time() - self.t0)
            print(f"[{self.stage}] t={self.num_timesteps:>9,}  return={point.get('ep_rew_mean', float('nan')):8.3f}  "
                  f"len={point.get('ep_len_mean', float('nan')):7.1f}  mass={point.get('final_mass', float('nan')):7.1f}  "
                  f"death={point.get('death_rate', float('nan')):.2f}  ({fps:,.0f} steps/s)", flush=True)


class SelfPlayRefresher(BaseCallback):
    """Every `every` timesteps, freezes the current policy and hands it to the opponents."""

    def __init__(self, venv: NebulousVecEnv, vecnorm: VecNormalize, versions: dict[str, str], every: int, masking: bool = False):
        super().__init__()
        self.venv, self.vecnorm, self.versions, self.every, self.masking = venv, vecnorm, versions, every, masking
        self.last = 0

    def push(self) -> None:
        from .export import policy_to_json

        snap = policy_to_json(self.model, self.vecnorm, model_id=SELFPLAY_ID, label="self-play snapshot", trained=True, versions=self.versions,
                              masking=self.masking)
        self.venv.add_model(snap)
        self.last = self.num_timesteps

    def _on_training_start(self) -> None:
        self.push()

    def _on_step(self) -> bool:
        if self.num_timesteps - self.last >= self.every:
            self.push()
        return True


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="rl/configs/ppo_v1.json")
    ap.add_argument("--out", help="checkpoint directory (default rl/checkpoints/<id>)")
    ap.add_argument("--resume", action="store_true", help="continue from the last completed stage in --out")
    ap.add_argument("--device", default="auto", help="auto | cpu | cuda")
    ap.add_argument("--scale", type=float, default=1.0, help="multiply every stage's timesteps (quick experiments)")
    ap.add_argument("--processes", type=int, help="Node bridge processes (default from config)")
    args = ap.parse_args()

    cfg = load_config(args.config)
    out = Path(args.out or f"rl/checkpoints/{cfg['id']}")
    out.mkdir(parents=True, exist_ok=True)
    device = ("cuda" if th.cuda.is_available() else "cpu") if args.device == "auto" else args.device
    th.set_num_threads(max(1, int(cfg.get("torch_threads", 4))))
    stages = cfg["stages"]
    meta_path = out / "training_meta.json"
    meta: dict[str, Any] = json.loads(meta_path.read_text(encoding="utf-8")) if args.resume and meta_path.exists() else {
        "algorithm": "MaskablePPO (sb3-contrib)" if cfg.get("algorithm") == "maskable_ppo" else "PPO (Stable-Baselines3)", "config": args.config, "seed": cfg.get("seed", 0), "device": device,
        "stages": [], "curve": [], "wallSeconds": 0.0, "totalTimesteps": 0, "host": platform.platform(), "torch": th.__version__,
    }
    done_stages = {s["name"] for s in meta["stages"]}

    venv = NebulousVecEnv(cfg["num_envs"], stage_env_config(cfg, stages[0]), seed=cfg.get("seed", TRAIN_SEED_BASE), processes=args.processes or cfg.get("processes", 1))
    versions = venv.versions
    norm = cfg.get("normalize", {})
    last_ckpt = None
    for s in stages:
        if s["name"] in done_stages:
            last_ckpt = out / f"{s['name']}.zip"
    tensorboard = None
    try:
        import tensorboard as _  # noqa: F401
        tensorboard = str(out / "tb")
    except ImportError:
        pass

    init_from = cfg.get("init_from")
    if last_ckpt is None and init_from:
        # Fine-tune: start from another run's weights and normalisation statistics.
        last_ckpt = Path(init_from)
        meta.setdefault("initFrom", init_from)
    if last_ckpt is not None and last_ckpt.exists():
        vecnorm = VecNormalize.load(str(last_ckpt.with_name(last_ckpt.stem + "_vecnormalize.pkl")), venv)
        overrides = {k: cfg["ppo"][k] for k in ("learning_rate", "ent_coef", "clip_range") if k in cfg["ppo"]}
        model = algorithm_class(cfg).load(str(last_ckpt), env=vecnorm, device=device, custom_objects=overrides)
        if tensorboard:
            model.tensorboard_log = tensorboard
        print(f"loaded {last_ckpt} at {model.num_timesteps:,} timesteps (overrides: {overrides})")
    else:
        vecnorm = VecNormalize(venv, norm_obs=norm.get("obs", True), norm_reward=norm.get("reward", True), clip_obs=norm.get("clip_obs", 10.0), gamma=cfg["ppo"]["gamma"])
        model = build_model(cfg, vecnorm, device, tensorboard)
    model.set_logger(configure(str(out / "logs"), ["csv"] + (["tensorboard"] if tensorboard else [])))

    print(f"NebulousAI PPO | {cfg['id']} | device={device} | envs={cfg['num_envs']} | versions={versions}")
    for stage in stages:
        if stage["name"] in done_stages:
            continue
        steps = int(stage["timesteps"] * args.scale)
        env_cfg = stage_env_config(cfg, stage)
        callbacks: list[BaseCallback] = [CurveRecorder(stage["name"], meta["curve"], venv)]
        if any(o.get("modelId") == SELFPLAY_ID for sc in stage["scenarios"] for o in sc["opponents"]):
            masking = cfg.get("algorithm") == "maskable_ppo"
            callbacks.append(SelfPlayRefresher(venv, vecnorm, versions, every=int(stage.get("selfplay_refresh", 100_000)), masking=masking))
            # Register a snapshot before the new scenarios can reference it.
            from .export import policy_to_json
            venv.add_model(policy_to_json(model, vecnorm, model_id=SELFPLAY_ID, label="self-play snapshot", trained=True, versions=versions, masking=masking))
        venv.set_env_config(env_cfg)
        # Force fresh episodes under the new stage instead of finishing old-stage ones.
        model._last_obs = vecnorm.reset()  # type: ignore[assignment]
        t0 = time.time()
        print(f"--- stage {stage['name']}: {steps:,} timesteps - {stage.get('description', '')}")
        model.learn(total_timesteps=steps, reset_num_timesteps=False, callback=callbacks, progress_bar=False)
        wall = time.time() - t0
        ckpt = out / f"{stage['name']}.zip"
        model.save(str(ckpt))
        vecnorm.save(str(ckpt.with_name(ckpt.stem + "_vecnormalize.pkl")))
        meta["stages"].append({"name": stage["name"], "timesteps": steps, "description": stage.get("description", ""), "wallSeconds": round(wall, 1)})
        meta["wallSeconds"] = round(meta["wallSeconds"] + wall, 1)
        meta["totalTimesteps"] = int(model.num_timesteps)
        meta["versions"] = versions
        meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")
        print(f"    saved {ckpt} ({wall / 60:.1f} min)")

    model.save(str(out / "final.zip"))
    vecnorm.save(str(out / "final_vecnormalize.pkl"))
    meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")
    venv.close()
    print(f"done: {meta['totalTimesteps']:,} timesteps in {meta['wallSeconds'] / 60:.1f} min -> {out / 'final.zip'}")


if __name__ == "__main__":
    main()
