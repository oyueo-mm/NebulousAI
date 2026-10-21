# Reinforcement learning

Results are in [EXPERIMENTS.md](EXPERIMENTS.md). This document describes the environment, the
interfaces and how training, imitation, evaluation and export work.

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

The PettingZoo environment is implemented and API-tested, but the shipped models were trained with the
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
(1 = E, 3 = S, 5 = W, 7 = N); special 0 = none, 1 = split, 2 = eject. A unit test pins the whole table.

Impossible specials (cooldown, too small, at the cell cap) are passed to the engine, ignored, counted
(`invalidSplits/Ejects`) and cost −0.01. Models v2 – v4 additionally use **invalid-action masking**
(sb3-contrib MaskablePPO): an action whose special is impossible according to the observation's own
`canSplit` / `canEject` features gets logit −10⁸ (these features are exactly the engine's validity
test). The mask is a property of the exported model (`actionMasking: true`) and is applied identically
by the TypeScript inference. v1, trained without it, emitted ≈ 540 impossible requests per episode in
the hunt scenario — see EXPERIMENTS.md.

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

`rl/configs/ppo_v1.json` (v2: identical plus masking): MlpPolicy with separate 128-128 tanh networks for policy and value,
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

Later runs continue from a checkpoint (`init_from`: weights and VecNormalize statistics) with
overridden learning rate, entropy coefficient and clip range:

| run | starts from | stages |
|---|---|---|
| v3 | v2 final | F: 12 M steps of the D mix · G: 4 M steps of the E mix (lr 2e-4, entropy 0.005) |
| v4 | bc-v4 (imitation) | H: 10 M steps of the D mix · I: 3 M steps of the E mix (lr 1e-4, entropy 0.002, clip 0.1) |

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

## Imitation initialisation (`rl/imitate.py`, `rl/configs/bc_v4.json`)

Pure PPO did not reach heuristic level in the full game, so v4 starts from imitation:

1. **Demonstrations**: for each scenario its best heuristic (by the held-out evaluation) drives the
   learner slot, restricted to the 27 act-v1 actions (`quantizeLearner`; `encodeAction` maps a heading
   to the nearest of 8 directions, throttle < 0.3 → stay), so every label is reproducible by the
   network: Hybrid (forage, evade), Greedy (hunt), Survival (mixed, self-play). 880 k states.
2. **DAgger**, 3 rounds: the network plays (argmax) and the teacher only *labels* the visited states
   (`labelPolicy`); the aggregated set (2.2 M states) is trained on again. Plain behaviour cloning died
   within 34 s in the full game despite 68 % label accuracy; DAgger removed the compounding errors.
3. **Initialisation**: VecNormalize statistics are fitted to the demonstrations; the policy is trained
   with masked cross-entropy, the value head on discounted Monte-Carlo returns of the normalised reward
   of the teachers' own trajectories, so PPO does not start with a random critic.
4. The checkpoint is continued by MaskablePPO (`ppo_v4.json`, `init_from`).

The heuristics never run inside the exported model; they only produced training labels.

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
labelled "untrained" everywhere in the UI. Weights are written as the shortest decimal that round-trips
to the same float32 (`weightPrecision: "float32"`, restored with `Math.fround`), which halves the file
size without changing a single bit of the network.

## Evaluation

The full commands are in [EXPERIMENTS.md](EXPERIMENTS.md#reproduce). `rl.evaluate` puts each policy
(5 heuristics, optionally restricted to the discrete actions; the untrained network; any number of
exported networks through the TypeScript inference; the evaluated network through PyTorch) in the
learner slot of every scenario, on the same 48 held-out seeds, with one fixed self-play opponent for
all rows, and reports how many episodes PyTorch and TypeScript inference play identically. The
tournament runner compares policies as equals in free-for-all matches with spawn rotation. Both report
means with 95 % confidence intervals.
