/// <reference lib="webworker" />
import { MlpPolicyModel, type MlpModelFile } from '../ai/rl';
import { t } from '../i18n';
import { Match } from '../sim/match';
import { buildFrame } from './frames';
import { MAX_MODE_SPEED, ticksDone, ticksWanted, type PaceState } from './pacing';
import type { FrameStats, FromWorker, ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

/**
 * Owns the authoritative Match. Simulation time advances in fixed ticks paced
 * against wall-clock time × speed; rendering happens on the main thread from the
 * frames posted here, so render FPS never influences the simulation.
 */
const FRAME_MS = 16;
const MAX_WORK_MS = 12;

let match: Match | null = null;
let running = false;
let speed = 1;
let inspectId: number | null = null;
let heatmap = false;
const pace: PaceState = { owed: 0 };
let lastLoop = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let historySent = 0;
let log: string[] = [];
// Per-tick costs are averaged over ~500 ms windows: browsers coarsen performance.now(), so a
// single frame's one or two ticks would read as 0 or 0.1 ms.
const meter = { ticks: 0, since: 0, ups: 0, speedActual: 0, worldMs: 0, policyMs: 0, frames: 0,
  sumWorld: 0, sumPolicy: 0, sumWork: 0, frameMs: 0 };

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

function models(files: MlpModelFile[]): Map<string, MlpPolicyModel> {
  const map = new Map<string, MlpPolicyModel>();
  for (const f of files) map.set(f.id, new MlpPolicyModel(f));
  return map;
}

function collectLog(m: Match): void {
  const names = m.world.agents;
  for (const e of m.world.events) {
    const at = t.log.at(m.seconds);
    if (e.type === 'death') log.push(`${at}  ${e.killer >= 0 ? t.log.eliminated(names[e.killer].name, names[e.agent].name) : t.log.died(names[e.agent].name)}`);
    else if (e.type === 'eatCell' && e.mass >= 30) log.push(`${at}  ${t.log.ateCell(names[e.predator].name, e.mass, names[e.prey].name)}`);
    else if (e.type === 'thorn') log.push(`${at}  ${t.log.thorn(names[e.agent].name, e.pieces + 1)}`);
    else if (e.type === 'respawn') log.push(`${at}  ${t.log.respawned(names[e.agent].name)}`);
  }
  if (log.length > 40) log = log.slice(-40);
}

function sendFrame(workMs: number): void {
  if (!match) return;
  const stats: FrameStats = {
    ups: meter.ups, speedActual: meter.speedActual, worldMsPerTick: meter.worldMs, policyMsPerTick: meter.policyMs,
    workerMsPerFrame: running ? meter.frameMs : workMs,
  };
  const frame = buildFrame(match, { inspectId, heatmap, stats, running, historyFrom: historySent, log });
  historySent = match.history.length;
  log = [];
  const transfer: Transferable[] = [frame.cells.buffer, frame.food.buffer, frame.pellets.buffer, frame.thorns.buffer];
  if (frame.inspect?.heatmap) transfer.push(frame.inspect.heatmap.values.buffer);
  post(frame, transfer);
}

function runTicks(maxTicks: number, deadline: number): number {
  if (!match) return 0;
  let n = 0;
  const t0w = match.timing.worldMs, t0p = match.timing.policyMs;
  while (n < maxTicks && !match.isOver()) {
    match.step();
    collectLog(match);
    n++;
    if (performance.now() > deadline) break;
  }
  meter.sumWorld += match.timing.worldMs - t0w;
  meter.sumPolicy += match.timing.policyMs - t0p;
  return n;
}

function loop(): void {
  timer = null;
  if (!match || !running) return;
  const now = performance.now();
  const dtReal = (now - lastLoop) / 1000;
  lastLoop = now;
  const tick = match.world.config.tickSeconds;
  // Falling behind drops the backlog instead of spiralling; the measured speed then reports it.
  const ticks = runTicks(ticksWanted(pace, dtReal, speed, tick), now + MAX_WORK_MS);
  ticksDone(pace, ticks, speed, tick);
  meter.ticks += ticks;
  meter.frames++;
  meter.sumWork += performance.now() - now;
  if (now - meter.since >= 500) {
    const secs = (now - meter.since) / 1000;
    meter.ups = meter.ticks / secs;
    meter.speedActual = (meter.ticks * tick) / secs;
    meter.worldMs = meter.ticks ? meter.sumWorld / meter.ticks : 0;
    meter.policyMs = meter.ticks ? meter.sumPolicy / meter.ticks : 0;
    meter.frameMs = meter.frames ? meter.sumWork / meter.frames : 0;
    meter.ticks = 0; meter.frames = 0; meter.sumWorld = 0; meter.sumPolicy = 0; meter.sumWork = 0;
    meter.since = now;
  }
  sendFrame(performance.now() - now);
  if (match.isOver()) { running = false; sendFrame(0); return; }
  timer = setTimeout(loop, Math.max(0, FRAME_MS - (performance.now() - now)));
}

function start(): void {
  if (timer !== null || !running) return;
  lastLoop = performance.now();
  meter.since = lastLoop;
  meter.ticks = 0; meter.frames = 0; meter.sumWorld = 0; meter.sumPolicy = 0; meter.sumWork = 0;
  timer = setTimeout(loop, 0);
}

function stop(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  meter.ups = 0;
  meter.speedActual = 0;
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init':
      case 'load': {
        stop();
        match = msg.type === 'init' ? new Match(msg.setup, models(msg.models)) : Match.fromJSON(msg.snapshot, models(msg.models));
        running = msg.type === 'init' ? msg.running : false;
        pace.owed = 0;
        historySent = 0;
        log = [];
        post({ type: 'ready', agents: match.world.agents.length, seed: match.setup.seed });
        sendFrame(0);
        start();
        break;
      }
      case 'running':
        running = msg.value && !!match && !match.isOver();
        if (running) start(); else { stop(); sendFrame(0); }
        break;
      case 'speed':
        // Only the pacing changes: the match, its tick counter and all state are kept.
        speed = Math.max(0.05, Math.min(MAX_MODE_SPEED, msg.value));
        pace.owed = 0;
        break;
      case 'stepOnce':
        if (match && !running && !match.isOver()) {
          const t0 = performance.now();
          runTicks(1, Infinity);
          sendFrame(performance.now() - t0);
        }
        break;
      case 'input':
        if (match && match.kinds[msg.agentId] === 'human') match.setExternalAction(msg.agentId, msg.action);
        break;
      case 'inspect':
        inspectId = msg.agentId;
        heatmap = msg.heatmap;
        if (!running) sendFrame(0);
        break;
      case 'save':
        if (match) post({ type: 'saved', requestId: msg.requestId, snapshot: match.toJSON() });
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
