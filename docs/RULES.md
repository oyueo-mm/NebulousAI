# Game rules — `rules-v1`

This is the specification the engine (`src/engine/world.ts`) implements and that the independent Python
checker (`rl/rules_reference.py`) tests snapshots against. Every number below is a field of
`GameConfig` in `src/engine/config.ts`; the value shown is the `rules-v1` default.

Units: distance in world units (wu), time in **simulated** seconds, mass in mass units.

## World

| | default |
|---|---|
| Arena | 3000 × 3000 wu rectangle, `(0,0)` top-left, +x east, +y south |
| Simulation step | fixed tick `tickSeconds = 1/30` s; nothing reads wall-clock time |
| Agents | any number; default play: you + 15 bots, watch: 12 bots |
| Food | `foodMax = 600` items of `foodMass = 1` |
| Thorns | `thornCount = 10` |
| Start mass | `startMass = 20` (identical for every agent unless a scenario overrides it) |

All randomness comes from seeded Mulberry32 streams (`src/engine/rng.ts`): stream 0 is the world
(spawns, food), streams `1000 + i` belong to agent *i*'s policy. Equal seed + equal actions ⇒ equal
state, bit for bit (tested). Initial spawn points are generated from the seed alone; a tournament's
`spawnRotation` shifts which agent receives which slot, so policies can swap start positions.

## Mass and radius

`r = sqrt(m / (π ρ))` with areal density `ρ = 1/(16π)`, i.e. `r = 4 √m`. The same radius is used for
collision, eating, vision and rendering — there is no separate display radius. A start cell (m = 20)
has r ≈ 17.9; `maxCellMass = 20000` (r ≈ 566) caps any single cell so it always fits in the arena.
Mass gained above the cap is discarded and counted in the ledger (`capLost`).

## Movement

An action is a direction vector `(dx, dy)` whose length is the throttle (clamped to 1), plus `split`
and `eject` flags. Every cell of the agent receives:

* control velocity `u · throttle · v_max(m)`, with
  `v_max(m) = clamp(230 · (m / 20)^(-0.36), 40, 230)` wu/s — strictly non-increasing in mass;
* cohesion toward the agent's mass-weighted centre, `0.9 /s × offset`, capped at `0.6 · v_max`
  (only when it has more than one cell);
* a boost velocity from splits/bursts that decays as `exp(−5 t)`.

Position update per tick: `x += (v_control + v_cohesion + v_boost) · dt`, then the centre is clamped to
`[r, size − r]`, so a cell never leaves the arena. Cells are clamped again after they grow at the end
of the tick (a cell eating against a wall must not poke through it — a bug the Python checker found).

## Tick order

Each `step()` performs, in this fixed order:

1. **Actions** — record each agent's action (agent id order); perform split and eject requests.
2. **Movement** — cells, then ejected pellets (pellets bounce off walls and slow down like boosts).
3. **Separation** — same-owner cells that may not merge yet are pushed apart by their overlap,
   shared inversely to mass.
4. **Merging** — same-owner cells whose timers have expired merge when the smaller one's centre is
   inside the larger (`d ≤ r_big`); the larger keeps its id and position, masses add.
5. **Thorns** — see below.
6. **Predation** — see below.
7. **Food and pellets** — largest cell first (ties: lower id); an item is eaten when its centre lies
   strictly inside the cell; each item is eaten at most once.
8. **Decay, bookkeeping, regeneration** — mass decay, radius update and clamp, pellet expiry, deaths,
   respawns, food and thorn regeneration.

## Predation

A cell P eats a cell Q of a **different** owner when

* `m_P ≥ eatRatio · m_Q` with `eatRatio = 1.25`, and
* the centre distance `d ≤ r_P − eatDepth · r_Q` with `eatDepth = 0.4` (Q must be well inside P —
  touching is not enough).

Simultaneous contests are resolved deterministically and independently of array order:
eligibility uses the masses and radii **frozen at the start of the phase**; predators act from largest
to smallest (ties by lower id); each predator eats its eligible prey from largest to smallest; a cell
eaten earlier in the phase can no longer eat. Consequently a contested prey always goes to the largest
eligible predator, and in a chain A ⊃ B ⊃ C the biggest cell eats both. The predator gains
`eatEfficiency · m_Q` (`eatEfficiency = 1`, conservative). Same-owner cells never eat each other.

An agent with no cells left is dead; the agent that ate its last cell is credited with the kill.

## Split

On `split`, if `t − lastSplit ≥ splitCooldown = 0.5 s`, every cell of the agent with
`m ≥ minSplitMass = 36` splits (largest first) while the agent has fewer than `maxCells = 16` cells:

* the cell keeps `(1 − splitCost) · m / 2`; a new cell of the same mass is placed `2r'` ahead in the
  action direction (or the last heading) and launched at `splitSpeed = 800` wu/s, which decays at
  `boostDecay = 5 /s` (≈ 160 wu glide);
* `splitCost = 0`, so mass is conserved exactly; any non-zero cost is recorded as `splitLost`;
* both halves receive a merge timer `min(25, 9 + 0.01 · m)` s.

A split is the main attack: a half that lands deep enough over a smaller enemy eats it. The risk is
built in — two halves are each easier prey, slower to regroup, and cannot merge for ≥ 9 s.
Rejected requests (cooldown, too small, at the cell cap) do nothing and are counted as
`invalidSplits`.

## Eject

On `eject`, if `t − lastEject ≥ 0.12 s`, every cell with `m ≥ minEjectMass = 36` loses
`ejectMass = 16` and fires a pellet of `ejectEfficiency · 16 = 12.8` mass ahead at 700 wu/s.
The missing 3.2 is recorded as `ejectLost` — repeatedly ejecting and re-absorbing **always loses mass**
(tested). Pellets are edible by any cell that is ≥ 1.25× their mass, except their own source cell
during the first 0.4 s; uneaten pellets expire after 30 s (`pelletExpired`).

## Thorns (hazards)

Thorns are static spiky discs of mass 110 (r ≈ 42). A cell with `m ≥ 1.3 · 110 = 143` that covers a
thorn (same swallow test as predation) absorbs it and **bursts**: it keeps half of the combined mass and
the other half is split equally into up to 8 pieces (limited by the cell cap) flung radially; all
pieces get a merge timer. Smaller cells pass over thorns unharmed and are drawn beneath them, so thorns
are hiding places from large pursuers. A consumed thorn respawns at a random place after 8 s.

## Decay

Mass above `decayMinMass = 60` decays at `decayRate = 0.2 %` per simulated second:
`m ← max(60, m − m · 0.002 · dt)`. It is proportional to simulated time, never to frame rate.

## Food

The arena keeps up to 600 food items; while below the cap, 25 items per simulated second are added at
random positions (not inside thorns), using the world RNG.

## Vision

An agent perceives entities within `650 + 3 · r_eq` wu of its centre of mass, where `r_eq` is the
radius of its total mass. Every controller — heuristic and neural — sees only this
(`src/ai/perception.ts`). The human camera frames a similar region.

## Respawn

With `respawn` on, a dead agent reappears after 3 s with its start mass at the sampled spawn point
farthest from existing cells. The human player never respawns (`noRespawn`): death ends your game.
RL learners never respawn either: their death terminates the episode.

## Mass ledger

The world keeps running totals of every inflow (initial mass, spawned food / thorns / agents) and
outflow (decay, split cost, eject loss, expired pellets, eat inefficiency, cap). At every tick

```
Σ cells + Σ food + Σ pellets + Σ thorns  =  initial + inflows − outflows      (to 1e-6 relative)
```

This is asserted in TypeScript after thousands of chaotic ticks and in Python on every bridge step.
The world's total mass is **not** constant (food appears, mass decays); conservation is claimed only for
the closed operations: eating, splitting (`splitCost = 0`), merging and thorn bursts.
