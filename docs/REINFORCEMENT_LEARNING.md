# Reinforcement learning

Results of the shipped model are in [EXPERIMENTS.md](EXPERIMENTS.md). This document describes the
environment, the interfaces and how training, evaluation and export work.

## Environment

The learning environment *is* the game: Python drives the TypeScript engine through the Node bridge
(see [ARCHITECTURE.md](ARCHITECTURE.md)). One environment = one `Match` in which agent 0 is the
learner (`external` controller) and the other agents are scripted opponents described by a
**scenario**:

```jsonc
{ "name": "evade", "maxSeconds": 90, "learnerStartMass": [20, 45], "config": { "respawn": true, "thornCount": 6 },
  "opponents": [ { "kind": "greedy", "count": 3, "startMass": [110, 260] }, { "kind": "aggressive", "count": 2, "startMass": [110, 260] } ] }
```

At every reset the env picks a scenario (weighted), samples start masses and a spawn rotation from the
episode seed, and builds the match. Opponents respawn when the scenario enables it; the learner never
does — **its death terminates the episode** (no suicide/restart loop is possible inside an episode).
`maxSeconds` produces a *truncation* (`TimeLimit.truncated = True`), which PPO bootstraps through.

| | |
|---|---|
| Step | one decision = 2 ticks = 1/15 s of game time |
| Seeds | training: bridge-local sequence from 1 000 000 (+10 M per process); evaluation: 9 000 000 + i — disjoint by construction |
| Interfaces | `NebulousVecEnv` (SB3 VecEnv, N envs over k Node processes), `NebulousEnv` (Gymnasium), `NebulousParallelEnv` (PettingZoo Parallel, several learners in one world) |
| Checks | `gymnasium.utils.env_checker.check_env`, SB3 `check_env`, PettingZoo `parallel_api_test` — all pass (`rl/tests`) |

The PettingZoo environment is implemented and API-tested, but the shipped model was trained with the
single-learner VecEnv plus frozen self-play opponents (see Stage E) — simultaneous multi-learner
training has not been run.

## Observation — `obs-v1` (139 float32)

Relative to the agent's mass-weighted centre and scaled by its vision radius `V`; only entities inside
`V` appear; empty slots are all zeros with `valid = 0` (padding and mask are separate features).

| block | features |
|---|---|
| self (12) | ln(M/20)/6, cells/16, canSplit, canEject, vx/230, vy/230, distance to W/E/N/S wall ÷ V (clipped to 1), largest/total mass, soonest merge wait ÷ 25 s |
| 8 nearest enemy cells × 10 | valid, dx/V, dy/V, dist/V, log2(m/m_largest)/4, vx/230, vy/230, threat (can eat my smallest cell), prey (my largest can eat it), splitThreat |
| 8 nearest food items × 3 | valid, dx/V, dy/V (food includes ejected pellets) |
| 8 angular food sectors | food mass in each 45° sector ÷ 30, clipped to 1 |
| 3 nearest thorns × 5 | valid, dx/V, dy/V, dist/V, dangerous (my largest cell would burst) |

No absolute coordinates, no screen data, nothing outside vision. A test asserts the vector is unchanged
when an out-of-vision cell moves. Values are clipped to [−3, 3] by the encoder and normalised by
`VecNormalize` (running mean/var, clip ±10) during training; the statistics are exported with the model.

## Action — `act-v1` (Discrete 27)

`index = move × 3 + special`; move 0 = stay, move k ∈ 1…8 = heading `(k − 1) · 45°` in world space
(1 = E, 3 = S, 5 = W, 7 = N); special 0 = none, 1 = split, 2 = eject. Impossible specials are passed
to the engine, ignored, counted (`invalidSplits/Ejects`) and cost −0.01 — the agent must learn when a
split is possible (the `canSplit` / `canEject` features tell it). A unit test pins the whole table.

## Reward — `reward-v1`

Per decision step, computed in TypeScript (`computeReward`) so the browser inspector shows the same
number the trainer receives:

```
r = 10 · Δ ln(total mass)           (only while alive; diminishing returns for large agents)
  + 1    per enemy agent eliminated
  − 3    on death (terminal)
  − 0.25 per own cell eaten
  − 0.03 per successful eject, − 0.02 per successful split, − 0.01 per rejected split/eject
  + 0    per step alive
```

Design notes and exploit checks:

* **Log growth** prevents large agents from being paid more for the same food; a mass-20 agent earns
  ≈ +0.49 per food item, a mass-2000 agent ≈ +0.005.
* **Eject / re-absorb loops** lose 20 % of the ejected mass (rules) *and* pay the eject cost, so they are
  strictly negative (unit-tested on the engine).
* **Hiding**: the alive bonus is 0 and mass decays above 60, so pure hiding earns nothing; decay
  costs a big agent ≈ 0.02 per second.
* **Suicide / restart**: death terminates the episode with −3; there is no respawn inside an episode.
* **Meaningless motion** earns nothing; standing still is allowed but forfeits food.
* Reward is separate from evaluation: tournaments measure win rate, survival, final mass, kills.

## Algorithm — PPO (Stable-Baselines3)

`rl/configs/ppo_v1.json`: MlpPolicy with separate 128-128 tanh networks for policy and value,
`n_steps = 256` × 32 envs per rollout (8 192 steps), batch 2 048, 5 epochs, lr 3e-4, γ = 0.995,
λ = 0.95, clip 0.2, entropy 0.01, VecNormalize on observations and rewards. 32 environments run in
4 Node bridge processes. Discrete actions use SB3's standard categorical distribution — no custom
distribution.

### Curriculum

| stage | scenarios (weights) | purpose |
|---|---|---|
| A-forage | alone, no thorns, 60 s | find and collect food |
| B-evade | 3 Greedy + 2 Aggressive at 110–260 mass vs learner 20–45 (3), forage (1) | survive predators |
| C-hunt | small Random/Survival prey + 2 Greedy, learner 70–140 (3), evade (1) | chase, split-attack |
| D-mixed | 2 of every heuristic, equal start mass, 150 s (4), hunt (1), evade (1) | the full game |
| E-selfplay | 3 frozen copies of itself + 7 heuristics (2), mixed (2) | self-play; snapshot refreshed every 200 k steps |

Stage switches take effect at each environment's next reset; the trainer forces a reset so a stage
starts clean. In Stage E the current policy is exported to the bridge as `selfplay-snapshot` (weights
+ normalisation) and opponents of kind `ppo` use it through the same TypeScript inference as the
browser.

### Running

```bash
npm ci && npm run build:node                       # bundle the bridge
pip install torch --index-url https://download.pytorch.org/whl/cpu   # or a CUDA build
pip install -r rl/requirements.txt
python -m rl.train --config rl/configs/smoke.json   # ~20 s wiring check
python -m rl.train --config rl/configs/ppo_v1.json  # full curriculum
python -m rl.train --config rl/configs/ppo_v1.json --resume   # continue after the last finished stage
```

Outputs in `rl/checkpoints/ppo-v1/`: `<stage>.zip` + `<stage>_vecnormalize.pkl` after each stage,
`final.zip`, `logs/progress.csv`, `tb/` (TensorBoard) and `training_meta.json` (the per-rollout curve
shown in the RL Lab). `--device cuda` uses a GPU when available; on Colab, install Node 20+ and run the
same commands. Checkpoints are git-ignored; only the exported browser JSON is committed.

## Export and browser inference

```bash
python -m rl.export --model rl/checkpoints/ppo-v1/final.zip --id ppo-v1 --label "PPO v1" \
  --meta rl/checkpoints/ppo-v1/training_meta.json --out public/models/ppo-v1.json \
  --fixture rl/tests/fixtures/ppo-v1-equivalence.json
python -m rl.export --untrained --id ppo-untrained --label "PPO (untrained)" --out public/models/ppo-untrained.json \
  --fixture rl/tests/fixtures/ppo-untrained-equivalence.json
```

The JSON holds the layer weights (float64), activation, VecNormalize mean/var/clip/eps, and the
obs/action/rules/reward versions; the browser refuses a model whose versions or shapes do not match.
`src/ai/inference.test.ts` loads each shipped model and its fixture — real engine observations with
PyTorch's logits, probabilities and values — and requires agreement to 1e-5 (logits, values), 1e-6
(probabilities) and identical argmax. The TypeScript normaliser rounds to float32 exactly as
VecNormalize does. End to end, `rl.evaluate` runs the same seeds once with actions from PyTorch and
once with the TypeScript policy inside the bridge and reports how many episodes are identical.

The untrained model has the same architecture with random initial weights and no normalisation; it is
labelled "untrained" everywhere in the UI.

## Evaluation

```bash
python -m rl.evaluate --model rl/checkpoints/ppo-v1/final.zip --model-json public/models/ppo-v1.json \
  --untrained-json public/models/ppo-untrained.json --episodes 48 --out docs/results/rl_eval.json
npm run tournament -- --preset ppo-mixed --seeds 20 --out public/results
```

`rl.evaluate` puts each policy (5 heuristics, untrained network, trained network via TypeScript argmax
and sampling, trained network via PyTorch) in the learner slot of every scenario, on the same 48
held-out seeds. The tournament runner compares policies as equals in free-for-all matches with spawn
rotation. Both report means with 95 % confidence intervals.
