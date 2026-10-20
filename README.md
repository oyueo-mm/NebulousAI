# NebulousAI

**세포형 생존 게임을 직접 플레이하고, 휴리스틱·강화학습 AI의 생존 전략과 다중 에이전트 경쟁을 실험하는 인터랙티브 AI 연구실**

*An interactive lab where you play a cell-survival game yourself and study how heuristic and
reinforcement-learning agents survive and compete in a multi-agent arena.*

**Live demo: https://oyueo-mm.github.io/NebulousAI/**

NebulousAI is inspired by the cell-survival genre (Agar.io, Nebulous.io). It is an independent
project with its own rules, code and graphics; it is not affiliated with, endorsed by, or derived from
any commercial game, and it never connects to any game server.

![Watch mode with the decision inspector](docs/images/watch.png)

## What you can do

| Mode | |
|---|---|
| **Play** | Steer a cell with the mouse (or WASD / arrows, or an on-screen joystick on touch screens), eat food, swallow smaller cells, split (Space) to attack or escape, eject mass (E). 15 AI opponents, including the trained PPO network. |
| **Watch AI** | Pick how many of each AI play, follow any agent, pause / step / speed up to 16× or max, and open the **inspector**: what the agent sees, its mode, target, threats and risk (heuristics) or its observation vector, action probabilities and value estimate (PPO). Optional risk heatmap. |
| **Tournament** | Headless matches in a background worker over many seeds with spawn-position rotation; win rate with Wilson intervals, survival / mass with 95 % CIs; JSON/CSV export. Reference results from the CLI are shown alongside. |
| **RL Lab** | The shipped networks (trained and untrained), their training curves and curriculum, and the exact observation, action and reward definitions. |

Everything runs in the browser; there is no backend.

## Implemented vs. planned

Implemented and tested: the deterministic engine (movement, food, predation with deterministic
contest resolution, split, merge, eject, thorns, decay, respawn, mass ledger); play and watch modes;
five heuristic AIs; the decision inspector and heuristic risk heatmap; save / load of complete game
states; browser and CLI tournaments; Gymnasium, Stable-Baselines3 and PettingZoo environments driven by
the same engine; PPO training with a five-stage curriculum including self-play; export to the browser
with a tested TypeScript MLP; GitHub Actions CI and Pages deployment.

Not done (see [Roadmap](#roadmap)): simultaneous multi-learner training (the PettingZoo environment
exists and passes the API test, but the shipped model trained one learner at a time), continuous
action spaces, thorn feeding / shooting, testing on real touch hardware.

## Game rules (short)

`r = 4√m`; speed falls with mass (`230·(m/20)^-0.36`, floor 40); a cell eats a different owner's cell
when it is ≥ 1.25× heavier and the prey's centre is 0.4 r_prey inside its edge; simultaneous contests go
to the largest predator, independent of object order. Split halves a cell (≥ 36 mass, up to 16 cells,
0.5 s cooldown) and launches the half 160 wu forward; halves merge back after 9 – 25 s. Eject fires 16
mass of which 12.8 survive as a pellet. Large cells (≥ 143) that cover a thorn burst into up to 9
pieces; small cells can hide under thorns. Mass above 60 decays 0.2 %/s. Full specification:
[docs/RULES.md](docs/RULES.md).

## AI

* **Random** — seeded random walk (lower bound).
* **Greedy** — flee if in danger, else chase the most valuable prey (naive split attacks), else food.
* **Survival** — scores 16 headings by predicted, pursuit-aware danger (walls and corners included)
  versus food; never hunts; emergency split-escape.
* **Aggressive** — intercept planning with prey motion prediction, split attacks only when the odds are
  good and no bystander could eat its halves.
* **Hybrid** — switches between Survival, Aggressive hunting and safe foraging.
* **PPO** — a 139 → 128 → 128 → 27 MLP trained with Stable-Baselines3 against the real engine,
  executed in the browser by a TypeScript forward pass.

Details and the measured bugs found while building them: [docs/AI_ALGORITHMS.md](docs/AI_ALGORITHMS.md).

## Reinforcement learning

Python never re-implements the game: the Gymnasium / SB3 / PettingZoo environments drive the
TypeScript engine through a Node bridge, so training and the browser share the rules, the
observation encoder (`obs-v1`, 139 floats, vision-limited), the 27 discrete actions (`act-v1`) and
the reward (`reward-v1`). This is verified by a golden trajectory reproduced bit-for-bit by both sides
and by an independent Python rule checker. Results — including where PPO is *worse* than the
heuristics — are in [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md); the setup is in
[docs/REINFORCEMENT_LEARNING.md](docs/REINFORCEMENT_LEARNING.md).

```bash
npm ci && npm run build:node
pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install -r rl/requirements.txt
python -m rl.train --config rl/configs/ppo_v2.json          # ≈ 25 min on an 8-thread CPU
python -m rl.evaluate --config rl/configs/ppo_v2.json --model rl/checkpoints/ppo-v2/final.zip \
  --model-json public/models/ppo-v2.json --untrained-json public/models/ppo-untrained.json --episodes 48
python -m rl.export --config rl/configs/ppo_v2.json --model rl/checkpoints/ppo-v2/final.zip --id ppo-v2 \
  --meta rl/checkpoints/ppo-v2/training_meta.json --out public/models/ppo-v2.json \
  --fixture rl/tests/fixtures/ppo-v2-equivalence.json
```

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS 4 · Canvas 2D · Web Workers · Recharts · Vitest ·
Playwright · Python 3.12 · PyTorch · NumPy · Gymnasium · Stable-Baselines3 / sb3-contrib · PettingZoo.

## Run locally

```bash
npm ci
npm run dev            # http://127.0.0.1:5173/NebulousAI/
npm run build && npm run preview
npm run tournament -- --preset heuristics --seeds 20 --out public/results
npm run benchmark
```

## Tests

```bash
npm test                                         # engine, AI, encodings, golden trajectory, inference equivalence
npm run build:node && python -m pytest rl/tests  # TS↔Python equivalence, rule conformance, Gymnasium/SB3/PettingZoo checkers
npm run build && npm run test:e2e                # Playwright: desktop + mobile emulation
```

What each suite covers and what is *not* covered: [docs/TESTING.md](docs/TESTING.md).

## Performance

Measured numbers (simulation UPS, world / policy time per tick, headless speed, training throughput)
are in [docs/BENCHMARK.md](docs/BENCHMARK.md). The browser shows live Render FPS, simulation UPS,
achieved speed and per-tick world / AI cost in the Performance tab.

## Documentation

[RULES](docs/RULES.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [AI_ALGORITHMS](docs/AI_ALGORITHMS.md) ·
[REINFORCEMENT_LEARNING](docs/REINFORCEMENT_LEARNING.md) · [TESTING](docs/TESTING.md) ·
[BENCHMARK](docs/BENCHMARK.md) · [EXPERIMENTS](docs/EXPERIMENTS.md)

## Roadmap

* Multi-learner PPO through the PettingZoo environment; league training against past snapshots.
* Hybrid action space (continuous heading + discrete special).
* Thorn feeding and shooting via ejected mass.
* Recurrent or attention-based policies over a variable number of visible cells.
* Real-device touch testing; Safari and Firefox in CI.

## License and references

MIT — see [LICENSE](LICENSE). Algorithms: Schulman et al., *Proximal Policy Optimization Algorithms*
(2017); Huang & Ontañón, *A Closer Look at Invalid Action Masking in Policy Gradient Algorithms*
(2020); libraries as listed above. Genre inspiration only: Agar.io and Nebulous.io are trademarks of
their respective owners; this project uses none of their code or assets.
