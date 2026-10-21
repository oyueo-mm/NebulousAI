# AI algorithms

All policies implement one interface (`src/ai/types.ts`): given a `Perception` (what the agent can
see) and its own RNG, return an `AgentAction {dx, dy, split, eject}` plus a trace. They never mutate the
world and never see beyond the vision radius. Every AI decides at 15 Hz (`decisionInterval = 2`).

Heuristics output a continuous direction; the PPO network outputs one of the 27 discrete `act-v1`
actions. Both go through the same engine entry point (`World.step`).

## Shared tactics (`src/ai/perception.ts`)

* **Threat**: a visible enemy cell T is a threat if `m_T ≥ 1.25 · m` of the own cell nearest to it.
  Its *reach* is `2.2 r_T + 60`, plus the split reach `2 r_half + splitSpeed / boostDecay` if T could
  eat that cell after splitting. `danger = clamp(1 − gap / reach, 0, 1)` where gap is the edge gap.
* **Prey**: a visible enemy cell our largest cell can eat (`m_largest ≥ 1.25 · m_Q`).
* **Danger field** `dangerAt(x, y, horizon)`: Σ over threats of `(1 − gap/reach)²`, where each threat
  is projected to pursue the point at 0.9 × its top speed for `horizon` seconds; walls add danger
  proportional to the current threat level (cornered cells have no escape route); thorns add danger
  for cells big enough to burst and *reduce* it for small cells when a large pursuer is near (hiding).
  This field is what the browser's risk heatmap draws, labelled as heuristic.

## Random

Keeps its heading and re-rolls a uniform random direction with probability 0.1 per decision; splits
and ejects with probability 0.01 each. Seeded, so reproducible. Lower-bound baseline.

## Greedy

1. If the top threat's danger > 0.55 → **flee** along the danger-weighted sum of away-vectors plus a
   wall push.
2. Else if a visible prey with ≥ 10 % of our largest mass exists → **chase** the one maximising
   `mass / (distance + 50)`. It splits *naively* when the half can eat the prey and the gap is within
   80 % of split reach — without checking whether the halves will be exposed.
3. Else → **forage**: the food item with the most food mass within 120 wu, per unit distance
   (among the 24 nearest, neighbourhood of the 64 nearest).

## Survival

Scores 16 headings. For each, the cell's reachable positions after 0.4, 1.0 and 1.8 s (clamped to the
arena — pushing into a wall counts as standing still, +0.3 danger) are evaluated with the pursuit-aware
danger field; score = `−4 · danger + w_food · food_in_cone + 0.12 · heading_persistence` with
`w_food = 0.6 · (1 − risk)`. When calm (risk < 0.15) and the straight path to the best food cluster is
predicted safe (danger ≤ 0.1), it simply goes there. Last resort: if a threat is within 20 wu and it
can split, it splits away so the launched half escapes. It never hunts.

Two bugs found while measuring it (documented because they show why survival is not "free"):
first version fled straight into walls and was finished off in corners (44–56 % deaths); sampling
positions outside the arena made walls look safe. Clamping sample points and wall-aware danger brought
deaths to ≈ 6–10 %.

## Aggressive

1. Evades only when danger > 0.75.
2. **Hunt planning** for every catchable prey: closing speed `v_me − 0.6 v_prey`; intercept time
   `τ = gap / max(30, closing)`; aim at the prey's predicted position after `min(τ, 1.2)` s; value
   `m_prey / (1 + τ) · (1 − exposure)` with exposure = danger at the aim point.
3. **Split-attack decision**: allowed when the half can eat the prey, the gap is < 90 % of split
   reach, we have ≤ 4 cells, and *no visible cell other than the prey could eat one of our halves* near
   the aim point. Odds = `(1 − gap / (0.9 reach)) × (0.6 if the prey is much faster)`; split at ≥ 0.35.
   (The first version only checked current threats and would split next to a 260-mass bystander that
   could eat its 150-mass halves — caught by a unit test.)
4. Otherwise forages like Greedy.

## Hybrid

Mode switch: if risk > 0.45 → Survival's decision; else if a hunt has split odds ≥ 0.4 or a prey with
≥ 8 % of our mass is catchable within 4 s → Aggressive's hunt; else safe foraging (direct to the best
food cluster when the path danger ≤ 0.2, otherwise Survival's heading scorer with a heavier food
weight). It was meant as the strong heuristic baseline. Measured results
([EXPERIMENTS.md](EXPERIMENTS.md)) show a cautious generalist: it survives about as often as Survival,
but it does not win the most matches — Greedy and Aggressive win more often through high-variance
aggression — and in the full-game learner-slot evaluation Survival, not Hybrid, is the strongest
heuristic.

## PPO (neural)

`src/ai/neural.ts`: `obs-v1` encoding (139 floats) → VecNormalize statistics → MLP
(139 → 128 → 128 → 27, tanh; separate 139 → 128 → 128 → 1 value network) → invalid-action mask (models
trained with masking) → softmax → sample or argmax ("Deterministic PPO" toggle; argmax is clearly
stronger for v4). Weights are exported from Stable-Baselines3 / sb3-contrib and checked against PyTorch
outputs (see [REINFORCEMENT_LEARNING.md](REINFORCEMENT_LEARNING.md)). The browser inspector shows the
observation, the top action probabilities, the chosen action and V(s); it draws no "target" because
the network has none.

Shipped networks: `ppo-v4` (default; imitation-initialised MaskablePPO), `ppo-v3`, `ppo-v2`, `ppo-v1`
(pure RL generations) and `ppo-untrained` (random weights). Measured strengths and weaknesses of each
are in [EXPERIMENTS.md](EXPERIMENTS.md); in short, only v4 matches or beats the heuristics in the full
game, and v1 – v3 exploit a decay loophole by staying fragmented.

## Ranking and metrics (tournaments)

* **Rank**: alive agents first, by current mass; then dead agents by survival time; ties by peak mass,
  then agent id. **Win** = rank 1.
* **Win rate** with a Wilson 95 % interval; means with a normal-approximation 95 % CI.
* **Survival** = simulated seconds alive. **Final mass** = mass at the end (0 if dead).
* **Kills** = enemy agents whose last cell this agent ate. **Cells eaten** = enemy cells eaten.
* **Split hit** = splits followed by eating an enemy cell within 3 s ÷ splits ("포식 성공률").
* **Exchange** = enemy cells eaten ÷ (enemy cells eaten + own cells lost).
* A match ends at the time limit or when ≤ 1 agent is alive (tournaments disable respawn).
