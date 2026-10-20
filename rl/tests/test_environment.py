"""Environment correctness: TS/Python equivalence, rule conformance, Gymnasium / SB3 / PettingZoo APIs."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from rl.bridge_client import Bridge
from rl.envs import NUM_ACTIONS, OBS_SIZE, NebulousEnv, NebulousParallelEnv, NebulousVecEnv
from rl.rules_reference import check_snapshot, check_transition

GOLDEN = Path(__file__).parent / "fixtures" / "golden_trajectory.json"

# Larger start masses so splits, merges, thorn bursts and predation all occur within the run.
BUSY = {
    "decisionInterval": 2,
    "scenarios": [{
        "name": "busy", "maxSeconds": 120, "learnerStartMass": [150, 150], "config": {"respawn": True, "thornCount": 12},
        "opponents": [{"kind": k, "count": 2, "startMass": [40, 220]} for k in ["random", "greedy", "survival", "aggressive", "hybrid"]],
    }],
}

MIXED = {
    "decisionInterval": 2,
    "scenarios": [{
        "name": "mixed", "maxSeconds": 60, "config": {"respawn": True},
        "opponents": [{"kind": k, "count": 2} for k in ["random", "greedy", "survival", "aggressive", "hybrid"]],
    }],
}


def test_golden_trajectory_reproduced_through_bridge():
    """The Python environment and the in-process TypeScript engine produce the same trajectory."""
    g = json.loads(GOLDEN.read_text(encoding="utf-8"))
    with Bridge() as b:
        header = b.init(1, g["env"], 0)
        assert {k: header[k] for k in ("rules", "obs", "action", "reward")} == {k: g["versions"][k] for k in ("rules", "obs", "action", "reward")}
        obs, seeds = b.reset([g["seed"]])
        np.testing.assert_array_equal(obs[0], np.asarray(g["obs0"], dtype=np.float32))
        checkpoints = {c["step"]: c for c in g["checkpoints"]}
        for i, want in enumerate(g["steps"]):
            obs, rew, done, trunc, infos, terminals = b.step(np.asarray([g["actions"][i]]))
            assert rew[0] == pytest.approx(want["reward"], abs=1e-6, rel=1e-6), f"reward differs at step {i}"
            assert bool(done[0]) == (want["terminated"] or want["truncated"]), f"done flag differs at step {i}"
            assert bool(trunc[0]) == want["truncated"]
            cp = checkpoints.get(i)
            if cp is None:
                continue
            last = terminals[infos[0]["terminal_index"]] if done[0] else obs[0]
            np.testing.assert_array_equal(last, np.asarray(cp["obs"], dtype=np.float32), err_msg=f"obs differs at step {i}")
            if not done[0]:  # after a done the bridge has already auto-reset the world
                world = b.snapshot(0)
                assert world["tick"] == cp["tick"]
                got = [[c["id"], c["owner"], c["x"], c["y"], c["mass"], c["r"]] for c in world["cells"]]
                assert got == cp["cells"], f"cell states differ at step {i}"
                assert len(world["food"]) == cp["food"] and len(world["pellets"]) == cp["pellets"]
        assert len(g["steps"]) == g["ended"] + 1


def test_engine_snapshots_conform_to_documented_rules():
    """Independent Python formulas (rules_reference) agree with engine snapshots every step."""
    rng = np.random.default_rng(3)
    with Bridge() as b:
        b.init(1, BUSY, 0)
        b.reset([424242])
        prev = b.snapshot(0)
        checked = 0
        splits_seen = 0
        for _ in range(400):
            _, _, done, _, _, _ = b.step(rng.integers(0, NUM_ACTIONS, 1))
            snap = b.snapshot(0)
            errors = check_snapshot(snap)
            if not done[0]:
                errors += check_transition(prev, snap, BUSY["decisionInterval"])
            assert not errors, errors[:5]
            splits_seen = max(splits_seen, sum(a["stats"]["splits"] for a in snap["agents"]))
            prev = snap
            checked += 1
        assert checked == 400
        assert splits_seen > 0


def test_vec_env_shapes_rewards_and_autoreset():
    env = NebulousVecEnv(6, MIXED, processes=2)
    try:
        obs = env.reset()
        assert obs.shape == (6, OBS_SIZE) and obs.dtype == np.float32
        rng = np.random.default_rng(0)
        finished = 0
        for _ in range(600):
            env.step_async(rng.integers(0, NUM_ACTIONS, 6))
            obs, rew, done, infos = env.step_wait()
            assert np.isfinite(obs).all() and np.isfinite(rew).all()
            assert env.observation_space.contains(obs[0])
            for d, info in zip(done, infos):
                if d:
                    finished += 1
                    assert info["terminal_observation"].shape == (OBS_SIZE,)
                    assert "episode" in info and info["episode"]["l"] > 0
                    assert isinstance(info["TimeLimit.truncated"], bool)
        assert finished > 0
    finally:
        env.close()


def test_explicit_seeds_make_worlds_identical():
    a = NebulousVecEnv(3, MIXED)
    b = NebulousVecEnv(3, MIXED, processes=3)
    try:
        np.testing.assert_array_equal(a.reset(seeds=[7, 8, 9]), b.reset(seeds=[7, 8, 9]))
        for _ in range(50):
            acts = np.array([3, 9, 15])
            a.step_async(acts); b.step_async(acts)
            oa, ra, _, _ = a.step_wait(); ob, rb, _, _ = b.step_wait()
            np.testing.assert_array_equal(oa, ob)
            np.testing.assert_array_equal(ra, rb)
    finally:
        a.close(); b.close()


def test_gymnasium_and_sb3_env_checkers():
    from gymnasium.utils.env_checker import check_env as gym_check
    from stable_baselines3.common.env_checker import check_env as sb3_check

    env = NebulousEnv(MIXED)
    try:
        gym_check(env, skip_render_check=True)
        sb3_check(env, warn=True)
        obs, info = env.reset(seed=5)
        assert obs.shape == (OBS_SIZE,)
        terminated = truncated = False
        steps = 0
        while not (terminated or truncated) and steps < 2000:
            obs, r, terminated, truncated, info = env.step(env.action_space.sample())
            assert math.isfinite(r)
            steps += 1
        assert terminated or truncated
        assert "final_mass" in info
    finally:
        env.close()


def test_pettingzoo_parallel_api():
    from pettingzoo.test import parallel_api_test

    env = NebulousParallelEnv(learners=3, scenario={"name": "ffa", "maxSeconds": 20, "opponents": [{"kind": "aggressive", "count": 2, "startMass": [150, 150]}], "config": {"respawn": True}})
    try:
        parallel_api_test(env, num_cycles=400)
        obs, _ = env.reset(seed=11)
        assert set(obs) == set(env.possible_agents)
        rng = np.random.default_rng(1)
        seen_done = set()
        while env.agents:
            acts = {a: int(rng.integers(0, NUM_ACTIONS)) for a in env.agents}
            obs, rew, term, trunc, _ = env.step(acts)
            for a in acts:
                assert a in rew
                if term[a] or trunc[a]:
                    seen_done.add(a)
            # agents that finished are never asked to act again
            assert not (set(env.agents) & seen_done)
        assert seen_done == set(env.possible_agents)
    finally:
        env.close()
