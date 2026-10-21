"""Export a Stable-Baselines3 PPO policy to the browser JSON format (nebulous-mlp v1).

    python -m rl.export --model rl/checkpoints/ppo-v1/final.zip --id ppo-v1 --label "PPO v1" --out public/models/ppo-v1.json
    python -m rl.export --untrained --id ppo-untrained --out public/models/ppo-untrained.json

The TypeScript MLP (src/ai/rl.ts) recomputes exactly what is written here; the
equivalence fixture produced with --fixture is checked by `npm test`.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import torch as th
from torch import nn

from .envs import NUM_ACTIONS, OBS_SIZE

FORMAT = "nebulous-mlp"


def _f32(values: np.ndarray) -> list:
    """Shortest decimal that round-trips to the same float32 (the browser restores it with Math.fround)."""
    flat = [float(np.format_float_positional(v, unique=True, trim="-")) for v in values.astype(np.float32).ravel()]
    return np.asarray(flat, dtype=np.float64).reshape(values.shape).tolist()


def _dense(layer: nn.Linear) -> dict[str, Any]:
    return {"weight": _f32(layer.weight.detach().cpu().numpy()), "bias": _f32(layer.bias.detach().cpu().numpy())}


def _linears(seq: nn.Module) -> list[nn.Linear]:
    return [m for m in seq.modules() if isinstance(m, nn.Linear)]


def _activation(policy) -> str:
    fn = policy.activation_fn
    if fn is nn.Tanh:
        return "tanh"
    if fn is nn.ReLU:
        return "relu"
    raise ValueError(f"unsupported activation {fn}")


def policy_to_json(model, vecnorm=None, *, model_id: str, label: str, trained: bool, versions: dict[str, str], training: dict | None = None,
                   masking: bool = False) -> dict[str, Any]:
    policy = model.policy
    ext = policy.mlp_extractor
    obs_norm = None
    if vecnorm is not None and vecnorm.norm_obs:
        obs_norm = {
            "mean": vecnorm.obs_rms.mean.astype(np.float64).tolist(),
            "var": vecnorm.obs_rms.var.astype(np.float64).tolist(),
            "clip": float(vecnorm.clip_obs),
            "eps": float(vecnorm.epsilon),
        }
    out = {
        "format": FORMAT, "formatVersion": 1, "id": model_id, "label": label, "trained": trained,
        "obsVersion": versions["obs"], "actionVersion": versions["action"], "rulesVersion": versions["rules"], "rewardVersion": versions["reward"],
        "activation": _activation(policy), "weightPrecision": "float32", "obsSize": OBS_SIZE, "numActions": NUM_ACTIONS, "obsNorm": obs_norm,
        "policyNet": [_dense(l) for l in _linears(ext.policy_net)],
        "actionNet": _dense(policy.action_net),
        "valueNet": [_dense(l) for l in _linears(ext.value_net)],
        "valueHead": _dense(policy.value_net),
        "actionMasking": masking,
    }
    if training is not None:
        out["training"] = training
    return out


def normalize(obs: np.ndarray, vecnorm) -> np.ndarray:
    return vecnorm.normalize_obs(obs) if vecnorm is not None and vecnorm.norm_obs else obs


@th.no_grad()
def torch_outputs(model, obs_norm: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Logits, probabilities and values computed by PyTorch from already-normalised observations."""
    policy = model.policy
    x = th.as_tensor(obs_norm, dtype=th.float64)
    p64 = policy.to(th.float64)
    # MlpPolicy's feature extractor is Flatten (identity for 1-D obs); calling it would cast to float32.
    assert isinstance(p64.features_extractor, nn.Module) and type(p64.features_extractor).__name__ == "FlattenExtractor"
    latent_pi, latent_vf = p64.mlp_extractor(x)
    logits = p64.action_net(latent_pi)
    values = p64.value_net(latent_vf).squeeze(-1)
    probs = th.softmax(logits, dim=-1)
    policy.to(th.float32)
    return logits.numpy(), probs.numpy(), values.numpy()


def make_fixture(model, vecnorm, observations: np.ndarray, model_id: str, masking: bool = False) -> dict[str, Any]:
    """Reference outputs. With masking, probs/argmax use logits set to -1e8 where invalid
    (exactly sb3-contrib's MaskableCategorical); raw logits are stored unmasked."""
    from .envs import action_masks_from_obs

    normed = normalize(observations.astype(np.float32), vecnorm)
    logits, probs, values = torch_outputs(model, normed)
    masks = action_masks_from_obs(observations) if masking else np.ones_like(logits, dtype=bool)
    used = np.where(masks, logits, -1e8)
    used_probs = np.exp(used - used.max(axis=1, keepdims=True))
    used_probs /= used_probs.sum(axis=1, keepdims=True)
    return {
        "modelId": model_id, "masking": masking,
        "observations": observations.astype(np.float32).astype(np.float64).tolist(),
        "logits": logits.tolist(), "probs": used_probs.tolist(), "values": values.tolist(),
        "argmax": used.argmax(axis=1).tolist(),
    }


def collect_observations(env_config: dict, n: int, seed: int, model=None, vecnorm=None, opponent_model: dict | None = None) -> np.ndarray:
    """Real observations from the engine (policy rollouts), for equivalence testing."""
    from .envs import NebulousVecEnv

    env = NebulousVecEnv(8, env_config, seed=seed)
    if opponent_model is not None:
        # Self-play scenarios reference the frozen snapshot id; use the exported model for it.
        env.add_model({**opponent_model, "id": "selfplay-snapshot"})
    obs = env.reset()
    rng = np.random.default_rng(seed)
    rows = []
    try:
        while len(rows) < n:
            rows.extend(obs[: min(len(obs), n - len(rows))])
            if model is not None:
                kw = {"action_masks": env.action_masks()} if getattr(model, "_nebulous_masking", False) else {}
                actions, _ = model.predict(normalize(obs, vecnorm), deterministic=False, **kw)
            else:
                actions = rng.integers(0, NUM_ACTIONS, len(obs))
            for _ in range(int(rng.integers(3, 12))):
                env.step_async(actions)
                obs, _, _, _ = env.step_wait()
    finally:
        env.close()
    return np.asarray(rows[:n], dtype=np.float32)


def evaluation_rows(report: dict[str, Any], model_id: str) -> list[dict[str, Any]]:
    """Compact table for the RL Lab: per scenario, this model (TS argmax/sampled) and every heuristic."""
    rows = []
    for scenario, entries in report["results"].items():
        for name, s in entries.items():
            if name.startswith(f"{model_id} (") or "(" not in name:
                rows.append({"scenario": scenario, "policy": name, "return": s["r"], "final mass": s["final_mass"],
                             "survival s": s["survival"], "death": s["death_rate"], "win": s["win_rate"], "n": s["episodes"]})
    return rows


def main() -> None:
    from stable_baselines3.common.vec_env import VecNormalize

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", help="SB3 PPO .zip (omit with --untrained)")
    ap.add_argument("--vecnormalize", help="VecNormalize .pkl (default: <model>_vecnormalize.pkl next to the model)")
    ap.add_argument("--untrained", action="store_true", help="export a freshly initialised network with the same architecture")
    ap.add_argument("--config", default="rl/configs/ppo_v1.json", help="training config (architecture, scenarios)")
    ap.add_argument("--id", required=True)
    ap.add_argument("--label")
    ap.add_argument("--out", required=True)
    ap.add_argument("--meta", help="training metadata JSON to embed (curve, stages, evaluation)")
    ap.add_argument("--fixture", help="also write a PyTorch-vs-TypeScript equivalence fixture here")
    ap.add_argument("--imitation-meta", help="bc_meta.json written by rl.imitate, embedded as training.imitation")
    ap.add_argument("--evaluation", help="rl.evaluate report to summarise into training.evaluation (this model's rows + heuristics)")
    ap.add_argument("--fixture-size", type=int, default=64)
    args = ap.parse_args()

    from .train import algorithm_class, build_model, load_config, stage_env_config
    from .envs import NebulousVecEnv

    cfg = load_config(args.config)
    masking = cfg.get("algorithm") == "maskable_ppo"
    vecnorm = None
    if args.untrained:
        env = NebulousVecEnv(1, stage_env_config(cfg, cfg["stages"][0]))
        versions = env.versions
        model = build_model(cfg, env, device="cpu", tensorboard=None)
        env.close()
        trained = False
    else:
        model = algorithm_class(cfg).load(args.model, device="cpu")
        model._nebulous_masking = masking
        vn_path = Path(args.vecnormalize) if args.vecnormalize else Path(args.model).with_name(Path(args.model).stem + "_vecnormalize.pkl")
        if vn_path.exists():
            env = NebulousVecEnv(1, stage_env_config(cfg, cfg["stages"][0]))
            versions = env.versions
            vecnorm = VecNormalize.load(str(vn_path), env)
            vecnorm.training = False
            env.close()
        else:
            env = NebulousVecEnv(1, stage_env_config(cfg, cfg["stages"][0]))
            versions = env.versions
            env.close()
        trained = True

    training = None
    if args.meta and Path(args.meta).exists():
        training = json.loads(Path(args.meta).read_text(encoding="utf-8"))
    if not trained:
        training = {"algorithm": "random initialisation, not trained", "totalTimesteps": 0, "seed": cfg.get("seed")}
    if args.imitation_meta and Path(args.imitation_meta).exists():
        training = dict(training or {})
        training["imitation"] = json.loads(Path(args.imitation_meta).read_text(encoding="utf-8"))
    if args.evaluation and Path(args.evaluation).exists():
        training = dict(training or {})
        training["evaluation"] = evaluation_rows(json.loads(Path(args.evaluation).read_text(encoding="utf-8")), args.id)
    data = policy_to_json(model, vecnorm, model_id=args.id, label=args.label or args.id, trained=trained, versions=versions, training=training,
                          masking=masking)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {args.out} ({Path(args.out).stat().st_size / 1024:.0f} KiB)")

    if args.fixture:
        mixed = stage_env_config(cfg, cfg["stages"][-1])
        obs = collect_observations(mixed, args.fixture_size, seed=4_242_000, model=model if trained else None, vecnorm=vecnorm, opponent_model=data)
        fixture = make_fixture(model, vecnorm, obs, args.id, masking=masking)
        Path(args.fixture).parent.mkdir(parents=True, exist_ok=True)
        Path(args.fixture).write_text(json.dumps(fixture), encoding="utf-8")
        print(f"wrote {args.fixture} ({len(obs)} observations)")


if __name__ == "__main__":
    main()
