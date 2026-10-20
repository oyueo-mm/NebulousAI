# Testing

```bash
npm test                 # Vitest: engine, AI, encodings, inference equivalence, golden trajectory, match, tournaments
npm run build:node && python -m pytest rl/tests -q    # Python environment: equivalence, rule conformance, API checkers
npm run build && npm run test:e2e                     # Playwright on the production build (desktop + mobile emulation)
```

All three run in GitHub Actions on every push (`.github/workflows/deploy.yml`) before deployment.

## Engine physics (`src/engine/world.test.ts`)

Movement exactly `v_max · dt`; throttle scaling and clamping; heavier cells slower; world bounds;
non-finite actions idle; cells that grow against a wall stay inside it; food absorption by centre
containment; one item eaten by exactly one (the largest) cell; food regeneration rate; predation
threshold by mass ratio *and* depth; no eating below the ratio even when fully overlapping; same owner
never eats; simultaneous contest won by the largest predator regardless of array order; chain A ⊃ B ⊃ C;
split halves mass exactly and launches forward, split cost accounted; minimum mass, cooldown and the
16-cell cap; split cells never overlap before merging and merge back with no mass lost; a split attack
reaches prey the whole cell could not; eject mass accounting, pellet transfer and expiry; eject
minimum; eject/re-absorb loops lose mass; thorns: small cells pass, big cells burst with mass conserved,
thorns respawn; death and respawn.

**Invariants** (`checkInvariants`, asserted every 25 ticks over 3 000 chaotic ticks with 12 agents,
random actions, splits, ejects and respawns): finite positive masses, valid coordinates inside
`[r, size − r]`, `r = sqrt(m/(πρ))`, unique ids, no cell above the cap, agent cell counts and total
masses equal the sums of their cells, alive ⇔ has cells, ≤ 16 cells, and the **mass ledger balances**
(world mass = initial + inflows − outflows to 1e-6). World mass itself is *not* assumed constant.

**Determinism**: same seed + same action sequence ⇒ byte-identical JSON state after 900 ticks;
different seeds differ; save → load → continue equals an uninterrupted run; hostile snapshots
(wrong version, negative mass, strings for numbers, owners out of range, 100 000 food items, invalid
config) are rejected without hanging.

## AI and encodings (`src/ai/ai.test.ts`, `src/sim/match.test.ts`)

Perception only reports entities inside vision; dead agents perceive nothing; heuristics always return
finite actions with |a| ≤ 1; Greedy heads for food; Survival flees a big threat; Aggressive
split-attacks reachable prey and declines when a bystander could eat its halves (this test found a
real bug); Random is reproducible. The 27-action table, the 139-slot observation layout, padding /
masks, finiteness and vision-independence are pinned. The MLP forward pass is checked against a
hand-computed network; malformed models are rejected; softmax is stable. Reward-v1 cases. Matches are
reproducible including AI decisions; decisions happen only on decision ticks; external split fires
once; reward windows; ranking order; tournament scheduling and aggregation; Wilson intervals.

## TypeScript ↔ Python equivalence

The Python environment runs the TypeScript engine, so rules cannot diverge. This is verified, not
assumed:

1. **Golden trajectory** (`src/sim/golden.test.ts`, `rl/tests/test_environment.py`): a fixed scenario
   with 7 heuristic opponents, seed 31337 and a documented 32-bit LCG action sequence run for up to 300
   decision steps (the learner dies at step 254). Vitest checks the in-process engine reproduces the
   committed file exactly; pytest checks the Python environment reproduces every reward, done flag,
   observation (bit-identical float32) and every cell's id/owner/position/mass/radius at 10 checkpoints.
   Tolerance: exact for observations and cell states, 1e-6 for rewards (JSON round trip).
2. **Independent rule checker** (`rl/rules_reference.py`): the documented formulas restated in Python
   check engine snapshots on every one of 400 bridge steps in a busy scenario — radius law, bounds, cell
   cap, agent bookkeeping, mass ledger, and a kinematic speed bound for single-cell agents (accounting
   for decay and ejections). It found one real engine bug (cells growing against a wall poked through
   it until the next movement step); the fix is covered by a TypeScript regression test.
3. **Seeds across process layouts**: 3 envs in one bridge process vs 3 processes give identical
   observations and rewards for the same explicit seeds.

## RL environment checks (`rl/tests/test_environment.py`)

`gymnasium.utils.env_checker.check_env` and Stable-Baselines3's `check_env` on `NebulousEnv`;
PettingZoo `parallel_api_test` on `NebulousParallelEnv` plus a check that finished agents are never
asked to act again; VecEnv shapes, finiteness, auto-reset with `terminal_observation`,
`TimeLimit.truncated` and episode info.

## Inference equivalence (`src/ai/inference.test.ts`)

For every model in `public/models/index.json` a fixture of real engine observations with PyTorch's
logits, probabilities and values (float64) must be reproduced by the TypeScript MLP: |Δlogit| < 1e-5,
|Δp| < 1e-6, |ΔV| < 1e-5, identical argmax. A shipped model without a fixture fails the suite.

## Browser (`tests/e2e.spec.ts`, Playwright on the production build)

Desktop Chromium and Pixel 7 emulation: play mode renders a non-empty world (canvas pixels sampled)
and the player grows by steering with the mouse; split → 2 cells → merge back (shortened timer) →
eject lowers mass; a saved state edited to put the player inside a 900-mass predator loads, ends the
game with the game-over screen, and restarts; loading the same save twice and stepping 40 ticks gives
identical leaderboards; watch mode lineup change, inspector, heatmap, 8× speed, free camera, fit, reset;
the canvas is never blank while panels toggle, the window resizes and the game is paused; analytics
tabs and live UPS; a browser tournament runs in its worker and reports CIs; RL Lab lists the models
with trained/untrained badges; mobile HUD, dock, joystick and split button, no horizontal overflow.
Every test fails on console errors, page errors or any HTTP status ≥ 400 (404s, missing workers or
models).

**Not covered**: real touch hardware (only Chromium mobile emulation), Safari/Firefox, and very slow
devices.
