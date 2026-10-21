# Benchmark

Measured on one machine; numbers on other hardware will differ. Raw outputs are committed next to
this file: [results/benchmark.txt](results/benchmark.txt) and
[results/browser-benchmark.json](results/browser-benchmark.json).

**Machine**: Intel Core Ultra 7 256V (8 threads), 16 GB RAM, Windows 11, Node 24.19, Chromium from
Playwright 1.64 (headless), no GPU. CPU otherwise idle during these measurements.

## Headless engine (`npm run benchmark`)

1 800 fixed ticks after a 60-tick warm-up, respawn on, default rules. "Policy ms/decision" is the
mean cost of one agent's decision (perception + policy); every AI decides every 2 ticks.

| agents | of which PPO | food | cells | simulation UPS | × real time | world ms / tick | policy ms / decision |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 0 | 600 | 10 | 5 596 | 186.5 | 0.050 | 0.026 |
| 20 | 0 | 600 | 20 | 3 556 | 118.5 | 0.049 | 0.023 |
| 50 | 0 | 1 000 | 57 | 2 032 | 67.7 | 0.056 | 0.018 |
| 50 | 0 | 2 000 | 56 | 1 376 | 45.9 | 0.079 | 0.027 |
| 20 | 10 | 600 | 30 | 1 376 | 45.9 | 0.051 | 0.069 |
| 50 | 25 | 1 000 | 67 | 568 | 18.9 | 0.086 | 0.069 |

* The world step itself (movement, collisions through the spatial hash, eating, merging) stays below
  0.1 ms per tick up to 50 agents and 2 000 food items; the cost is dominated by AI decisions.
* One PPO forward pass (139 → 128 → 128 → 27 policy plus 139 → 128 → 128 → 1 value network, float64,
  typed arrays) takes **≈ 102 µs** in Node. 25 PPO agents deciding at 15 Hz cost ≈ 38 ms per simulated
  second — 4 % of a real-time budget.
* The initial design targets (20 agents and hundreds of food items smooth; 50 agents and 1 000+ food
  feasible) are met with a large margin in headless mode.

## Browser (`node scripts/browser-benchmark.mjs`, production build)

Values read from the app's own Performance tab (성능) after 4 s in each state, measured after the Korean UI and speed-slider update; viewport 1440 × 900, headless
Chromium (rendering still goes through the Canvas 2D path; headless frame pacing is capped at 60 Hz).
Worker timings are averaged over 500 ms windows because browsers coarsen `performance.now()`.

| state | render FPS | simulation UPS | achieved speed | world ms/tick | AI ms/tick | worker ms/frame |
|---|---:|---:|---:|---:|---:|---:|
| watch default, 1x | 60 | 29 | 0.97× | 0.047 | 0.233 | 0.16 |
| watch default, Max speed | 60 | 2738 | 91.27× | 0.040 | 0.220 | 12.26 |
| watch default, fixed 50x | 60 | 1501 | 50.04× | 0.039 | 0.237 | 6.79 |
| 50 heuristic agents, 1000 food, 1x | 60 | 31 | 1.05× | 0.137 | 0.487 | 0.32 |
| 50 agents incl. 25 PPO, 1x | 60 | 32 | 1.05× | 0.119 | 1.788 | 1.01 |
| 50 agents incl. 25 PPO, target 50x | 60 | 493 | 16.43× | 0.059 | 1.428 | 13.56 |
| play default (you + 15 bots), 1x | 60 | 29 | 0.97× | 0.053 | 0.280 | 0.17 |

* The speed slider's fixed targets run 0.25× … 50×. In the default lineup 50× is held exactly; the heavy
  25-PPO lineup reaches about 16× at a 50× target, and the UI shows that achieved value (amber) under the slider
  instead of the target. Max mode is not a fixed rate (about 90× here, about 45× in an earlier run on the same
  machine: it depends on whatever else the machine is doing).
* Render FPS is measured on the main thread independently of the simulation: rendering never changes
  the simulated result (the simulation runs in the worker on fixed ticks).
* At "Max" the worker spends ~12 ms per 16 ms iteration simulating and posts one frame per iteration.
* When paused the worker stops its loop and the canvas only redraws on changes.
* Not measured: real (non-headless) GPU-composited browsers, low-end laptops and phones.

## Training throughput (`rl/train.py`)

| setting | env steps / s |
|---|---:|
| Bridge only, 16 envs in 1 Node process, random actions, mixed scenario | ≈ 2 250 |
| Bridge only, 32 envs over 4 Node processes | ≈ 5 600 |
| PPO v1 end-to-end (32 envs, 4 processes, CPU PyTorch, 4 threads): 6.42 M steps in 25.0 min | ≈ 4 280 |
| MaskablePPO v4 end-to-end: 13.0 M steps in 51.5 min (self-play stage slower: opponents run the MLP) | ≈ 4 210 |
| Imitation (bc-v4): 2.2 M labelled states + training in 9.3 min | — |

## Headless tournaments

Tournament wall times are printed by the CLI (`… × real time`), e.g. 100 heuristic matches of up to
180 s in 128 s (141× real time) and 120 matches with PPO agents in 169 s (128×). Some of these ran
while training was using the CPU, so treat them as lower bounds rather than benchmarks.
