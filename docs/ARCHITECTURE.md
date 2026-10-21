# Architecture

```
                         ┌──────────────────────── src/engine ────────────────────────┐
                         │ World (rules-v1) · SpatialHash · Rng · physics formulas    │
                         └──────────────▲──────────────────────────────▲──────────────┘
                                        │ step(actions)                │ perceive()
                         ┌──────────────┴───────────── src/sim ────────┴──────────────┐
                         │ Match: world + controllers + decision schedule + reward-v1 │
                         │ Tournament: seeds × spawn rotations → statistics + CIs     │
                         └───▲──────────────────▲────────────────────▲────────────────┘
                             │                  │                    │
        ┌────────────────────┴───┐  ┌───────────┴──────────┐  ┌──────┴───────────────────────┐
        │ Browser                │  │ Node CLI (headless)  │  │ Node bridge (rl/bridge)      │
        │ sim.worker  ─frames─▶  │  │ npm run tournament   │  │ framed JSON + float32 stdio  │
        │ main thread: Canvas,   │  │ npm run benchmark    │  └──────▲───────────────────────┘
        │ React UI, input        │  └──────────────────────┘         │ subprocess pipes
        │ tournament.worker      │                          ┌────────┴───────────────────────┐
        └────────────────────────┘                          │ Python (rl/)                   │
                                                            │ Gymnasium · SB3 VecEnv ·       │
                                                            │ PettingZoo Parallel · PPO ·    │
                                                            │ export → public/models/*.json  │
                                                            └────────────────────────────────┘
```

## One engine, three hosts

There is exactly one implementation of the rules, the TypeScript `World`. The browser, the headless
Node tools and the Python training environments all run it. The Python side does **not** re-implement
the physics: `rl/bridge_client.py` starts `node rl/bridge/dist/bridge.mjs` (an esbuild bundle of
`rl/bridge/*.ts` plus the engine) and exchanges length-prefixed JSON headers with raw float32
observation payloads. This removes the classic failure mode of RL game projects — training on rules
that differ from the shipped game — by construction instead of by testing.

It is still tested: a golden trajectory (`rl/tests/fixtures/golden_trajectory.json`) is reproduced
exactly by the in-process engine (Vitest) and through the bridge (pytest), and an independent Python
statement of the documented rules (`rl/rules_reference.py`) checks engine snapshots every step.
See [TESTING.md](TESTING.md).

## Engine (`src/engine`)

* `config.ts` — every rule constant (`GameConfig`), validated (finite, positive, physically possible).
* `physics.ts` — the closed-form formulas (radius, speed, merge delay, decay, eat test, vision).
* `world.ts` — state and the fixed tick order (see [RULES.md](RULES.md)); event list per tick;
  mass ledger; `toJSON` / `fromJSON` snapshots with validation of untrusted input
  (bounded array sizes, finite numbers, referential integrity).
* `spatial.ts` — uniform-grid spatial hash with stamp-based deduplication, allocation-free after
  warm-up. Food uses 128-wu buckets (points), cells 256-wu buckets (discs inserted in every bucket
  their bounding box touches). It serves food eating, predation candidates and AI food queries.

## Controllers (`src/ai`)

* `perception.ts` — the only window onto the world for any controller: own cells, and the cells,
  food, pellets and thorns inside the vision radius. Shared tactical helpers (threat assessment,
  split reach, heuristic danger field).
* `heuristics.ts` — Random, Greedy, Survival, Aggressive, Hybrid ([AI_ALGORITHMS.md](AI_ALGORITHMS.md)).
* `rl.ts` — `act-v1` action decoding, `obs-v1` encoder, `reward-v1`, the MLP forward pass and model
  validation.
* `neural.ts` — the PPO policy: encode → MLP → softmax → sample or argmax → action.

Every controller returns an `AgentAction` and a *trace*. Heuristic traces contain the values their
decision code actually used (mode, target, threats, risk). Neural traces contain the observation,
action probabilities, chosen index and the value estimate — never an invented goal.

## Match (`src/sim/match.ts`)

Wraps a world with one controller per agent (`human`, `external`, or a policy) and a decision
schedule: every AI decides once per `decisionInterval = 2` ticks (15 Hz) and holds its direction in
between; split/eject fire only on the decision tick. Human and external split/eject requests fire once
on the next tick. Reward-v1 is accumulated per decision window for every agent, so the browser shows
exactly the reward the trainer sees. A per-agent RNG stream makes stochastic policies reproducible.

## Browser

* `sim.worker.ts` owns the Match. A self-scheduled loop (~60 Hz) advances
  `floor(accumulated wall time × speed / tick)` fixed ticks, at most 12 ms of work per iteration;
  backlog beyond 4 ticks is dropped and the *measured* speed is reported instead of silently lagging.
  "Max" speed runs ticks for 12 ms per iteration. When paused the loop stops entirely (no CPU use).
* Each iteration posts one frame: cells/food/pellets/thorns as transferable `Float32Array`s, agent
  summaries, the inspected agent's detail (perception, trace, reward, optional heuristic heatmap), new
  mass-history samples and log lines.
* The main thread (`GameCanvas.tsx`) renders with `requestAnimationFrame`, interpolating cell
  positions between the last two frames by cell id. Render FPS therefore never affects simulation
  results. A `ResizeObserver` resizes the canvas backing store and **redraws synchronously** in the
  same callback, so toggling panels or resizing never shows a blank or black canvas; while paused the
  loop redraws only when the frame, camera or size changed.
* React state for panels is throttled to ~8 Hz; the 60 Hz path never touches React.
* `tournament.worker.ts` runs headless matches back to back and streams partial reports.

## Python (`rl/`)

* `bridge_client.py` — process management and framing; `send`/`recv` are split so several bridge
  processes step in parallel (`NebulousVecEnv(processes=4)` ≈ 2.5× throughput on 8 threads).
* `envs.py` — `NebulousVecEnv` (SB3 `VecEnv`, auto-reset, `terminal_observation`,
  `TimeLimit.truncated`), `NebulousEnv` (Gymnasium), `NebulousParallelEnv` (PettingZoo Parallel API).
* `train.py` — curriculum PPO / MaskablePPO with `VecNormalize`, per-stage checkpoints, resume,
  `init_from` fine-tuning, CSV/TensorBoard logs, self-play snapshots pushed into the bridge as frozen
  `ppo` opponents.
* `imitate.py` — behaviour cloning + DAgger from heuristic teachers (bridge modes `quantizeLearner`,
  `labelPolicy`), producing an SB3 checkpoint for `init_from`.
* `export.py` — SB3 → `nebulous-mlp` JSON (+ PyTorch reference outputs for the equivalence test,
  training curve, imitation and evaluation summaries).
* `evaluate.py` / `report.py` — held-out evaluation of any policy in the learner slot under identical
  seeds, rendered to Markdown.
* `rules_reference.py` — the documented rules restated independently, used to check engine snapshots.

## Data formats

| file | format | validated by |
|---|---|---|
| `public/models/*.json` | `nebulous-mlp` v1: architecture, float64 weights, VecNormalize stats, schema versions, training metadata | `validateModel` (versions, shapes, finiteness) |
| experiment save | `nebulous-experiment` v1: mode, settings, UI, full `nebulous-match` snapshot (world + RNG states) | `parseExperiment`, `parseSnapshot` (size limits, finite numbers, ranges) |
| tournament report | JSON + CSV per agent-match | — |
