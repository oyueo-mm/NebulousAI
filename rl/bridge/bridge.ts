/**
 * NebulousAI engine bridge for Python.
 *
 * Wire format (both directions): uint32-LE length + UTF-8 JSON header. Responses whose
 * header has `bin > 0` are followed by uint32-LE length + that many bytes of float32-LE
 * observations, row-major.
 *
 * Commands
 *   init         { numEnvs, env: EnvConfig, seed }                 → versions
 *   reset        { seeds?: number[] }                               → obs[numEnvs × OBS]
 *   step         { actions: number[] }  auto-resets finished envs   → obs, rewards, dones, infos, terminal obs
 *   setEnv       { env: EnvConfig }     applies at each env's next reset
 *   addModel     { model: MlpModelFile } registers a frozen policy for 'ppo' opponents (self-play)
 *   snapshot     { index }                                          → world JSON of env `index`
 *   maReset      { seed, learners, scenario, decisionInterval?, reward? } → obs[learners × OBS]
 *   maStep       { actions: number[] }                              → obs, rewards, terminated, truncated
 *   close
 */
import { MlpPolicyModel, OBS_SIZE, type MlpModelFile } from '../../src/ai/rl';
import { LearnerEnv, MultiEnv, VERSIONS, type EnvConfig, type EpisodeInfo } from './envs';

type Request = { cmd: string; [k: string]: unknown };

const models = new Map<string, MlpPolicyModel>();
let envs: LearnerEnv[] = [];
let multi: MultiEnv | null = null;
let baseSeed = 0;
let episodeCounter = 0;

/** Training seeds are drawn from a fixed, documented sequence per bridge run. */
function nextSeed(): number {
  return (baseSeed + episodeCounter++) >>> 0;
}

function write(header: Record<string, unknown>, bin?: Float32Array): void {
  const json = Buffer.from(JSON.stringify(bin ? { ...header, bin: bin.byteLength } : header), 'utf8');
  const parts: Buffer[] = [u32(json.length), json];
  if (bin) parts.push(u32(bin.byteLength), Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength));
  process.stdout.write(Buffer.concat(parts));
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function pack(rows: Float32Array[]): Float32Array {
  const out = new Float32Array(rows.length * OBS_SIZE);
  rows.forEach((r, i) => out.set(r, i * OBS_SIZE));
  return out;
}

function handle(req: Request): void {
  switch (req.cmd) {
    case 'init': {
      const n = Number(req.numEnvs);
      if (!Number.isInteger(n) || n < 1 || n > 512) throw new Error('numEnvs must be an integer in [1, 512]');
      baseSeed = Number(req.seed ?? 0) >>> 0;
      episodeCounter = 0;
      envs = Array.from({ length: n }, () => new LearnerEnv(req.env as EnvConfig, models));
      write({ ok: true, ...VERSIONS });
      return;
    }
    case 'setEnv':
      for (const e of envs) e.setConfig(req.env as EnvConfig);
      write({ ok: true });
      return;
    case 'addModel': {
      const m = new MlpPolicyModel(req.model as MlpModelFile);
      models.set(m.file.id, m);
      write({ ok: true, id: m.file.id });
      return;
    }
    case 'reset': {
      const seeds = Array.isArray(req.seeds) ? (req.seeds as number[]) : null;
      const rows = envs.map((e, i) => new Float32Array(e.reset(seeds ? seeds[i] : nextSeed())));
      write({ ok: true, seeds: envs.map((e) => e.seed) }, pack(rows));
      return;
    }
    case 'step': {
      const actions = req.actions as number[];
      if (!Array.isArray(actions) || actions.length !== envs.length) throw new Error('actions length must equal numEnvs');
      const rows: Float32Array[] = [];
      const terminal: Float32Array[] = [];
      const rewards: number[] = [], dones: boolean[] = [], truncated: boolean[] = [];
      const infos: (EpisodeInfo & { terminal_index: number } | null)[] = [];
      envs.forEach((e, i) => {
        const r = e.step(actions[i]);
        rewards.push(r.reward);
        dones.push(r.terminated || r.truncated);
        truncated.push(r.truncated);
        if (r.info) {
          terminal.push(new Float32Array(r.obs));
          infos.push({ ...r.info, terminal_index: terminal.length - 1 });
          rows.push(new Float32Array(e.reset(nextSeed())));
        } else {
          infos.push(null);
          rows.push(new Float32Array(r.obs));
        }
      });
      write({ ok: true, rewards, dones, truncated, infos, terminals: terminal.length }, pack([...rows, ...terminal]));
      return;
    }
    case 'snapshot': {
      const e = envs[Number(req.index ?? 0)];
      if (!e) throw new Error('no such env');
      write({ ok: true, world: e.match.world.toJSON(), tick: e.match.tick });
      return;
    }
    case 'maReset': {
      multi = new MultiEnv(models);
      const obs = multi.reset(Number(req.seed ?? 0) >>> 0, Number(req.learners), req.scenario as never, { decisionInterval: req.decisionInterval as number | undefined, reward: req.reward as never });
      write({ ok: true }, pack(obs.map((o) => new Float32Array(o))));
      return;
    }
    case 'maStep': {
      if (!multi) throw new Error('maReset first');
      const r = multi.step(req.actions as number[]);
      write({ ok: true, rewards: r.rewards, terminated: r.terminated, truncated: r.truncated }, pack(r.obs.map((o) => new Float32Array(o))));
      return;
    }
    case 'close':
      write({ ok: true });
      process.exit(0);
    // eslint-disable-next-line no-fallthrough
    default:
      throw new Error(`unknown command ${req.cmd}`);
  }
}

let buffer: Buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
  buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break;
    const text = buffer.subarray(4, 4 + len).toString('utf8');
    buffer = buffer.subarray(4 + len);
    try {
      handle(JSON.parse(text) as Request);
    } catch (err) {
      write({ ok: false, error: err instanceof Error ? err.stack ?? err.message : String(err) });
    }
  }
});
process.stdin.on('end', () => process.exit(0));
