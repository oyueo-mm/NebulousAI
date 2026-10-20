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


def _dense(layer: nn.Linear) -> dict[str, Any]:
    return {"weight": layer.weight.detach().cpu().double().numpy().tolist(), "bias": layer.bias.detach().cpu().double().numpy().tolist()}


def _linears(seq: nn.Module) -> list[nn.Linear]:
    return [m for m in seq.modules() if isinstance(m, nn.Linear)]


def _activation(policy) -> str:
    fn = policy.activation_fn
    if fn is nn.Tanh:
        return "tanh"
    if fn is nn.ReLU:
        return "relu"
    raise ValueError(f"unsupported activation {fn}")


def policy_to_json(model, vecnorm=None, *, model_id: str, label: str, trained: bool, versions: dict[str, str], training: dict | None = None) -> dict[str, Any]:
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
        "activation": _activation(policy), "obsSize": OBS_SIZE, "numActions": NUM_ACTIONS, "obsNorm": obs_norm,
        "policyNet": [_dense(l) for l in _linears(ext.policy_net)],
        "actionNet": _dense(policy.action_net),
        "valueNet": [_dense(l) for l in _linears(ext.value_net)],
        "valueHead": _dense(policy.value_net),
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
    features = p64.extract_features(x, p64.pi_features_extractor) if hasattr(p64, "pi_features_extractor") else x
    latent_pi, latent_vf = p64.mlp_extractor(features)
    logits = p64.action_net(latent_pi)
    values = p64.value_net(latent_vf).squeeze(-1)
    probs = th.softmax(logits, dim=-1)
    policy.to(th.float32)
    return logits.numpy(), probs.numpy(), values.numpy()


def make_fixture(model, vecnorm, observations: np.ndarray, model_id: str) -> dict[str, Any]:
    normed = normalize(observations.astype(np.float32), vecnorm)
    logits, probs, values = torch_outputs(model, normed)
    return {
        "modelId": model_id,
        "observations": observations.astype(np.float32).astype(np.float64).tolist(),
        "logits": logits.tolist(), "probs": probs.tolist(), "values": values.tolist(),
        "argmax": logits.argmax(axis=1).tolist(),
    }


def collect_observations(env_config: dict, n: int, seed: int, model=None, vecnorm=None) -> np.ndarray:
    """Real observations from the engine (policy rollouts), for equivalence testing."""
    from .envs import NebulousVecEnv

    env = NebulousVecEnv(8, env_config, seed=seed)
    obs = env.reset()
    rng = np.random.default_rng(seed)
    rows = []
    try:
        while len(rows) < n:
            rows.extend(obs[: min(len(obs), n - len(rows))])
            if model is not None:
                actions, _ = model.predict(normalize(obs, vecnorm), deterministic=False)
            else:
                actions = rng.integers(0, NUM_ACTIONS, len(obs))
            for _ in range(int(rng.integers(3, 12))):
                env.step_async(actions)
                obs, _, _, _ = env.step_wait()
    finally:
        env.close()
    return np.asarray(rows[:n], dtype=np.float32)


def main() -> None:
    from stable_baselines3 import PPO
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
    ap.add_argument("--fixture-size", type=int, default=64)
    args = ap.parse_args()

    from .train import build_model, load_config, stage_env_config
    from .envs import NebulousVecEnv

    cfg = load_config(args.config)
    vecnorm = None
    if args.untrained:
        env = NebulousVecEnv(1, stage_env_config(cfg, cfg["stages"][0]))
        versions = env.versions
        model = build_model(cfg, env, device="cpu", tensorboard=None)
        env.close()
        trained = False
    else:
        model = PPO.load(args.model, device="cpu")
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
        training = {"algorithm": "PPO (Stable-Baselines3), not trained", "totalTimesteps": 0, "seed": cfg.get("seed")}
    data = policy_to_json(model, vecnorm, model_id=args.id, label=args.label or args.id, trained=trained, versions=versions, training=training)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {args.out} ({Path(args.out).stat().st_size / 1024:.0f} KiB)")

    if args.fixture:
        mixed = stage_env_config(cfg, cfg["stages"][-1])
        obs = collect_observations(mixed, args.fixture_size, seed=4_242_000, model=model if trained else None, vecnorm=vecnorm)
        fixture = make_fixture(model, vecnorm, obs, args.id)
        Path(args.fixture).parent.mkdir(parents=True, exist_ok=True)
        Path(args.fixture).write_text(json.dumps(fixture), encoding="utf-8")
        print(f"wrote {args.fixture} ({len(obs)} observations)")


if __name__ == "__main__":
    main()
