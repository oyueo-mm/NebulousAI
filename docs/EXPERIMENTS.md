# Experiments

All numbers on this page come from files committed in this repository and can be regenerated with
the commands at the end. Two complementary protocols are used:

* **Learner-slot evaluation** (`rl/evaluate.py`): one policy controls agent 0 of a training-style
  scenario while the scripted opponents stay fixed; every policy plays the **same 48 held-out seeds**
  (9 000 000 – 9 000 047, never used in training) in five scenarios. Self-play scenarios use the same
  frozen opponent (`ppo-v3`) for every row. Full tables: [results/rl_eval.md](results/rl_eval.md)
  (data: [results/rl_eval.json](results/rl_eval.json)).
* **Free-for-all tournaments** (`npm run tournament`): all policies are equal participants, no
  respawn, each seed played once per spawn rotation; 20 seeds per preset. Data:
  [results/tournaments/](results/tournaments/) (JSON + per-agent CSV).

Means are reported with normal-approximation 95 % confidence intervals, win rates with Wilson
intervals. When intervals overlap, no difference is claimed.

Hardware for everything below: Intel Core Ultra 7 256V (8 threads), no GPU, Windows 11, Node 24,
Python 3.12, PyTorch 2.14 (CPU), Stable-Baselines3 2.9, sb3-contrib 2.9.

## Models

| model | what it is | PPO timesteps | wall time |
|---|---|---:|---:|
| `ppo-untrained` | random initial weights, same architecture — the "before training" baseline | 0 | — |
| `ppo-v1` | PPO, curriculum A → E (forage, evade, hunt, mixed, self-play) | 6.42 M | 25 min |
| `ppo-v2` | identical to v1 except **invalid-action masking** (MaskablePPO) | 6.42 M | 28 min |
| `ppo-v3` | v2 fine-tuned on the full game: 12 M mixed + 4 M self-play, lower entropy / learning rate | 22.4 M total | +65 min |
| `bc-v4` | imitation only: behaviour cloning on 880 k heuristic demonstrations + 3 DAgger rounds (2.2 M labelled states) | 0 | 9 min |
| `ppo-v4` | MaskablePPO initialised from `bc-v4` (policy *and* value), 10 M mixed + 3 M self-play | 13.0 M | 52 min |

All share rules-v1, obs-v1, act-v1, reward-v1 and a 139 → 128 → 128 → 27 tanh MLP (separate value
network). Configs: `rl/configs/ppo_v1.json` … `ppo_v4.json`, `bc_v4.json`. `ppo-v4` is the default
model in the web app. The imitation teachers were chosen per scenario as the best heuristic in the
held-out evaluation (Hybrid for forage/evade, Greedy for hunt, Survival for mixed/self-play), always
restricted to the 27 discrete actions; heuristics only provide training labels — the network acts on
its own at inference time.

## Headline: the full game

Learner-slot evaluation, scenario `mixed` (two of each heuristic, equal start mass, 150 s, 48 seeds):

| policy | return | final mass | survival (s) | death rate |
|---|---:|---:|---:|---:|
| random | −0.55 ± 0.51 | 0.7 ± 1.4 | 21.3 | 0.98 |
| greedy | 23.04 ± 2.10 | 185.5 ± 29.6 | 142.0 | 0.15 |
| **survival** (best heuristic) | 23.70 ± 1.51 | 223.9 ± 23.1 | 148.4 | 0.04 |
| aggressive | 23.30 ± 2.10 | 214.1 ± 38.2 | 138.7 | 0.15 |
| hybrid | 21.71 ± 2.11 | 189.9 ± 25.6 | 143.0 | 0.12 |
| survival restricted to 27 actions | 21.79 ± 1.77 | 186.5 ± 24.6 | 139.6 | 0.12 |
| ppo-untrained | −1.56 ± 0.39 | 1.5 ± 1.6 | 27.4 | 0.94 |
| ppo-v1 | 4.39 ± 2.55 | 57.6 ± 25.4 | 81.4 | 0.67 |
| ppo-v2 (masked) | 5.41 ± 3.35 | 71.1 ± 35.5 | 83.7 | 0.71 |
| ppo-v3 (after long mixed stage, before self-play) | 10.48 ± 3.26 | 99.7 ± 32.5 | 103.8 | 0.50 |
| ppo-v3 | 6.04 ± 3.05 | 62.2 ± 28.2 | 94.3 | 0.69 |
| bc-v4 (imitation only) | 23.31 ± 2.40 | 234.4 ± 36.0 | 138.8 | 0.15 |
| ppo-v4 (after mixed stage, before self-play) | 26.28 ± 0.87 | 283.8 ± 23.7 | 150.0 | 0.00 |
| **ppo-v4** (argmax) | **26.62 ± 1.31** | **308.3 ± 35.9** | 148.9 | **0.02** |
| ppo-v4 (sampled) | 22.97 ± 2.45 | 245.1 ± 31.8 | 143.6 | 0.10 |

What this shows:

1. **Pure PPO (v1 – v3) did not reach heuristic level in the full game**, despite up to 22.4 M steps.
   Every version beats the untrained network and Random by a wide margin, and each step (masking,
   longer training) helped in most scenarios, but the death rate stayed at 0.50 – 0.71 against
   0.04 – 0.15 for the heuristics. The self-play stage of v3 *lowered* its full-game score (10.5 → 6.0).
2. **Imitation alone reaches heuristic level** (bc-v4: return 23.3 vs 23.7 for Survival, intervals
   overlap) but dies more often (0.15 vs 0.04).
3. **PPO on top of imitation exceeds every heuristic** in this protocol: ppo-v4's return (25.3 – 27.9)
   and final mass (272 – 344) intervals lie entirely above Survival's (22.2 – 25.2 and 201 – 247), with a
   death rate of 0.02. The improvement over bc-v4 (death 0.15 → 0.02) is what reinforcement learning
   added. Argmax is clearly better than sampling for v4.

Caveat: the opponents here are the same heuristics the curriculum trained against (only the seeds
are held out). The free-for-all tournaments below test the policies as equals, but also against
the same heuristic families — generalisation to genuinely new opponents was not measured.

## Other scenarios (learner slot, 48 held-out seeds)

| scenario | best heuristic | ppo-v1 | ppo-v3 | bc-v4 | ppo-v4 |
|---|---|---|---|---|---|
| forage (alone, 60 s): final mass | 125.4 ± 1.6 | 114.8 ± 9.1 | **139.2 ± 5.2** | 121.6 ± 4.5 | 133.3 ± 2.6 |
| evade (big predators): final mass / death | 104.3 ± 22.8 (Greedy) / 0.25 (Hybrid) | 120.4 ± 24.3 / 0.31 | **160.9 ± 26.0** / 0.21 | 75.0 ± 18.1 / 0.38 | 134.6 ± 19.8 / **0.17** |
| hunt (small prey): final mass / death | 277.4 ± 41.8 / 0.06 (Greedy) | 169.6 ± 33.5 / 0.25 | 204.8 ± 33.3 / 0.19 | 249.9 ± 29.9 / 0.04 | 274.6 ± 24.5 / **0.02** |
| self-play mix: final mass / death | 232.5 ± 15.7 / 0.02 (Survival) | 53.5 ± 26.5 / 0.73 | 92.9 ± 31.3 / 0.54 | 244.9 ± 31.0 / 0.04 | 263.1 ± 31.8 / 0.06 |

* In simple sub-tasks pure PPO did beat the heuristics: v3 forages better than every heuristic
  (139 vs 125, intervals separated) and keeps more mass while evading.
* Hunting and the mixed games are where pure PPO failed and imitation-initialised PPO matched or beat
  the best heuristic (hunt: equal to Greedy; self-play mix: intervals overlap with Survival).

### Before vs after training

Same seeds, same scenario, untrained → v4 (argmax): forage 25.6 → 133.3 mass; evade death 0.75 → 0.17;
hunt death 0.62 → 0.02; mixed death 0.94 → 0.02 and mass 1.5 → 308.3.

### Browser inference is the trained policy

In every scenario the `ppo-v4` row driven by PyTorch (Stable-Baselines3 `predict`) and the row driven
by the TypeScript MLP inside the engine produced **48/48 identical episodes** (same return and length),
and the same held for v1 and v3 in the earlier runs. Together with the fixture test (|Δlogit| < 1e-5,
measured ≈ 5e-15) this shows the browser executes the trained network, not an approximation.

## Free-for-all tournaments (20 seeds, spawn rotation, no respawn, 180 s)

| preset | entry | n | win rate [95 % CI] | avg rank | final mass | alive at end |
|---|---|---:|---|---:|---:|---:|
| all heuristics (2 each, 10 agents) | Greedy | 200 | 19.5 % [14.6, 25.5] | 4.13 | 267 ± 25 | 86 % |
| | Aggressive | 200 | 20.0 % [15.0, 26.1] | 4.88 | 243 ± 27 | 79 % |
| | Hybrid | 200 | 5.5 % [3.1, 9.6] | 4.53 | 228 ± 12 | 94 % |
| | Survival | 200 | 5.0 % [2.7, 9.0] | 4.59 | 220 ± 12 | 90 % |
| | Random | 200 | 0 % [0, 1.9] | 9.37 | 0 | 0.5 % |
| PPO v4 + all heuristics (2 each, 12 agents) | **ppo-v4** | 240 | 14.6 % [10.7, 19.6] | **4.56** | **287 ± 19** | 87 % |
| | Greedy | 240 | 17.5 % [13.2, 22.8] | 5.72 | 266 ± 28 | 78 % |
| | Aggressive | 240 | 14.2 % [10.3, 19.1] | 5.79 | 261 ± 25 | 83 % |
| | Hybrid | 240 | 2.1 % [0.9, 4.8] | 5.88 | 239 ± 12 | 93 % |
| | Survival | 240 | 1.7 % [0.6, 4.2] | 5.66 | 236 ± 12 | 90 % |
| Hybrid vs PPO (4 + 4) | **ppo-v4** | 160 | **21.9 % [16.2, 28.9]** | **3.48** | **353 ± 19** | 97 % |
| | Hybrid | 160 | 3.1 % [1.3, 7.1] | 5.53 | 273 ± 12 | 98 % |
| PPO vs PPO (4 + 4) | ppo-v4 | 160 | 25.0 % [18.9, 32.2] | 2.50 | 386 ± 16 | 100 % |
| | ppo-untrained | 160 | 0 % [0, 2.3] | 6.50 | 21 ± 2 | 75 % |
| PPO generations (2 each) | ppo-v4 | 160 | 32.5 % [25.7, 40.1] | 3.76 | 373 ± 15 | 100 % |
| | ppo-v3 | 160 | 9.4 % [5.8, 14.9] | 4.25 | 336 ± 7 | 100 % |
| | ppo-v2 | 160 | 6.3 % [3.4, 11.1] | 4.58 | 324 ± 7 | 99 % |
| | ppo-v1 | 160 | 1.9 % [0.6, 5.4] | 5.41 | 313 ± 5 | 100 % |

Head-to-head heuristics (4 + 4): Greedy beats Random (win 25.0 % vs 0 %); Greedy vs Survival
21.9 % vs 3.1 % wins, but Survival survives as long (169 vs 166 s); Aggressive vs Survival 23.1 % vs 1.9 %.

Reading: in a 12-agent free-for-all, ppo-v4 has the best average rank and the highest final mass, but
its win rate is not distinguishable from Greedy's or Aggressive's — it wins by staying large and alive,
rarely by eating others (0.04 enemy cells per match). Against Hybrid alone it is clearly stronger.
Rank 1 rewards high-variance aggression; Greedy and Aggressive win more often than the cautious
Survival / Hybrid in every heuristic tournament.

## Training curves (last 10 rollouts of each stage, from `training_meta.json`)

| run | stage | steps | return (first → last) | death rate | final mass |
|---|---|---:|---|---:|---:|
| v1 | A-forage | 0.4 M | −2.45 → 12.32 | 0.00 | 113 |
| v1 | B-evade | 0.7 M | → 3.32 | 0.41 | 85 |
| v1 | C-hunt | 0.7 M | → −9.60 | 0.57 | 86 |
| v1 | D-mixed | 3.0 M | −8.35 → −2.62 | 0.72 | 54 |
| v2 | A-forage | 0.4 M | 3.86 → 17.22 | 0.00 | 120 |
| v2 | C-hunt | 0.7 M | → −1.47 | 0.36 | 117 |
| v2 | D-mixed | 3.0 M | −2.17 → 1.65 | 0.69 | 59 |
| v3 | F-mixed-long | 12 M | 2.49 → 8.41 | 0.55 | 86 |
| v4 | H-mixed-from-bc | 10 M | −3.24 → 15.68 | 0.28 | 172 |
| v4 | I-selfplay-from-bc | 3 M | 14.67 → 22.33 | 0.10 | 235 |

(The first rollouts of a stage still average episodes from the previous stage, and training returns mix
several scenarios, so
these numbers are not comparable with the evaluation tables. The full curves are shown per model in the RL Lab.)

## Diagnoses that shaped the runs

**v1 spammed impossible actions.** Two thirds of the 27 actions carry a split or eject, most of which
are impossible for a small cell. In the hunt scenario the stage-C checkpoint issued ≈ 540 rejected
requests per episode (−5.4 return from the −0.01 penalty alone) and 19 *valid* splits that rarely
caught anything. → v2 masks actions the observation marks as impossible (`canSplit`, `canEject`);
the same mask is applied in the browser. Stage-C return improved from −9.6 to −1.5 and the death rate
from 0.57 to 0.36.

**v1 died small, to big splitting predators, near walls.** Over 40 mixed episodes v1 died 28 times,
with a mean mass of 29 at death, to cells 5.3× its mass on average (Greedy 13, Aggressive 11, Hybrid 3,
Survival 1); 13 deaths came right after the killer split and 16 within 250 wu of a wall. The
observation already contains `splitThreat` flags and wall distances, so this was a learning problem
rather than missing information — which motivated longer training (v3) and, when that was not enough,
imitation initialisation (v4).

**Plain behaviour cloning collapsed; DAgger fixed it.** The first behaviour-cloned policy matched the
teacher on 68 % of held-out *teacher* states but died in 98 % of mixed episodes after 34 s: off the
teacher's state distribution its errors compounded. Three DAgger rounds (the network plays, the
teachers only label the visited states) reduced the number of episodes ending inside the same
collection window from 407 to 89 to 73, and the resulting bc-v4 reaches heuristic level.

## Reward and rule exploitation checks

| check | finding |
|---|---|
| eject / re-absorb loops | Not used: ≤ 0.4 ejects per match for every network; the rules make the loop lose 20 % (engine-tested). |
| standing still / hiding | Not observed: v4 survives the full 150 s in mixed while ending with the highest mass. |
| suicide / restart | Impossible by design: death terminates the episode with −3. |
| meaningless back-and-forth | Not measured directly; v4 forages more mass per episode than any heuristic, which argues against it. |
| **split abuse — found** | In PPO-only games v1 – v3 split 47 – 50 times per match with a 0 % split-attack hit rate. Sampling their cells after the first minute shows **100 % of their cells at or below the 60-mass decay floor** (7.7 cells, ≈ 200 mass), i.e. they keep themselves fragmented so that **mass decay never applies**: decay is defined per cell above 60, not per agent. This is a genuine loophole in rules-v1 that RL discovered. ppo-v4 does it far less (2.5 cells, 61 % of mass above the floor), presumably because its imitation start never fragmented. |

The loophole is left in place because every shipped model was trained on rules-v1; fixing it (decay on
the agent's total mass) is planned as rules-v2 together with retraining.

## Reproduce

```bash
npm ci && npm run build:node
pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install -r rl/requirements.txt
python -m rl.train   --config rl/configs/ppo_v1.json      # v1;  ppo_v2.json for v2
python -m rl.train   --config rl/configs/ppo_v3.json      # needs rl/checkpoints/ppo-v2/final.zip
python -m rl.imitate --config rl/configs/bc_v4.json       # needs public/models/ppo-v3.json (self-play opponents)
python -m rl.train   --config rl/configs/ppo_v4.json      # needs rl/checkpoints/bc-v4/bc.zip
python -m rl.evaluate --config rl/configs/ppo_v4.json --scenario-config rl/configs/ppo_v1.json \
  --model rl/checkpoints/ppo-v4/final.zip --model-json public/models/ppo-v4.json \
  --untrained-json public/models/ppo-untrained.json --selfplay-opponent public/models/ppo-v3.json \
  --quantized survival --compare public/models/ppo-v1.json public/models/ppo-v2.json public/models/ppo-v3.json \
  --episodes 48 --out docs/results/rl_eval.json
python -m rl.report docs/results/rl_eval.json > docs/results/rl_eval.md
for p in heuristics greedy-vs-random greedy-vs-survival survival-vs-aggressive ppo-generations; do
  node dist-node/tournament.mjs --preset $p --seeds 20 --out docs/results/tournaments --web public/results; done
for p in ppo-mixed hybrid-vs-ppo ppo-vs-ppo; do
  node dist-node/tournament.mjs --preset $p --model ppo-v4 --seeds 20 --out docs/results/tournaments --web public/results; done
```

Training is seeded, but PyTorch CPU kernels and thread scheduling are not guaranteed bit-reproducible,
so a retrained model will differ in detail. Evaluation and tournaments of a *given* model are exactly
reproducible.
