import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MlpModelFile } from '../ai/rl';
import type { AgentAction } from '../engine/types';
import type { MatchSetup, MatchSnapshot } from '../sim/match';
import type { AgentSummary, Frame, FrameStats, FromWorker, InspectDetail, ToWorker } from '../worker/protocol';
import { t } from '../i18n';

export interface FrameStore {
  prev: Frame | null;
  curr: Frame | null;
  /** performance.now() when curr arrived, and the interval between the last two frames. */
  currAt: number;
  interval: number;
  version: number;
}

export interface SimUi {
  agents: AgentSummary[];
  stats: FrameStats | null;
  inspect: InspectDetail | null;
  running: boolean;
  over: boolean;
  time: number;
  tick: number;
}

const UI_INTERVAL_MS = 120;
const HISTORY_CAP = 1200;

export function useSimulation() {
  const workerRef = useRef<Worker | null>(null);
  const frames = useRef<FrameStore>({ prev: null, curr: null, currAt: 0, interval: 33, version: 0 });
  const [ui, setUi] = useState<SimUi>({ agents: [], stats: null, inspect: null, running: false, over: false, time: 0, tick: 0 });
  const [history, setHistory] = useState<{ t: number; mass: number[] }[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(0);
  const pendingSaves = useRef(new Map<number, (s: MatchSnapshot) => void>());
  const lastUi = useRef(0);
  const historyBuf = useRef<{ t: number; mass: number[] }[]>([]);
  const logBuf = useRef<string[]>([]);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const msg = ev.data;
      if (msg.type === 'frame') {
        const f = frames.current;
        const now = performance.now();
        if (f.curr && msg.tick > f.curr.tick) {
          f.prev = f.curr;
          f.interval = Math.max(8, Math.min(100, now - f.currAt));
        } else if (f.curr && msg.tick < f.curr.tick) {
          f.prev = null;
        }
        f.curr = msg;
        f.currAt = now;
        f.version++;
        if (msg.history.length) historyBuf.current.push(...msg.history);
        if (msg.log.length) logBuf.current.push(...msg.log);
        const prevUi = lastUi.current;
        if (now - prevUi > UI_INTERVAL_MS || !msg.running) {
          lastUi.current = now;
          setUi({ agents: msg.agents, stats: msg.stats, inspect: msg.inspect, running: msg.running, over: msg.over, time: msg.time, tick: msg.tick });
          if (historyBuf.current.length) {
            const add = historyBuf.current;
            historyBuf.current = [];
            setHistory((h) => {
              const next = h.concat(add);
              return next.length > HISTORY_CAP ? next.filter((_, i) => i % 2 === 0) : next;
            });
          }
          if (logBuf.current.length) {
            const add = logBuf.current;
            logBuf.current = [];
            setLog((l) => l.concat(add).slice(-80));
          }
        }
      } else if (msg.type === 'ready') {
        setReady((r) => r + 1);
        setError(null);
      } else if (msg.type === 'saved') {
        pendingSaves.current.get(msg.requestId)?.(msg.snapshot);
        pendingSaves.current.delete(msg.requestId);
      } else if (msg.type === 'error') {
        setError(t.app.simError(msg.message));
      }
    };
    worker.onerror = (e) => setError(t.app.workerFailed(e.message || t.app.unknownError));
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const send = useCallback((msg: ToWorker) => workerRef.current?.postMessage(msg), []);

  const resetBuffers = useCallback(() => {
    frames.current = { prev: null, curr: null, currAt: 0, interval: 33, version: frames.current.version + 1 };
    historyBuf.current = [];
    logBuf.current = [];
    setHistory([]);
    setLog([]);
  }, []);

  const api = useMemo(() => ({
    init(setup: MatchSetup, models: MlpModelFile[], running: boolean) {
      resetBuffers();
      send({ type: 'init', setup, models, running });
    },
    load(snapshot: MatchSnapshot, models: MlpModelFile[]) {
      resetBuffers();
      send({ type: 'load', snapshot, models });
    },
    setRunning: (value: boolean) => send({ type: 'running', value }),
    setSpeed: (value: number) => send({ type: 'speed', value }),
    stepOnce: () => send({ type: 'stepOnce' }),
    input: (agentId: number, action: AgentAction) => send({ type: 'input', agentId, action }),
    inspect: (agentId: number | null, heatmap: boolean) => send({ type: 'inspect', agentId, heatmap }),
    save(): Promise<MatchSnapshot> {
      const requestId = Math.floor(Math.random() * 1e9);
      return new Promise((resolve) => {
        pendingSaves.current.set(requestId, resolve);
        send({ type: 'save', requestId });
      });
    },
  }), [send, resetBuffers]);

  return { frames, ui, history, log, error, ready, api };
}
