/**
 * Browser inference equivalence: the TypeScript MLP must reproduce PyTorch outputs for the
 * exported models on real engine observations (fixtures written by `python -m rl.export --fixture`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MlpPolicyModel, argmax, type MlpModelFile } from './rl';

const MODELS = resolve(__dirname, '../../public/models');
const FIXTURES = resolve(__dirname, '../../rl/tests/fixtures');
const index: { id: string; file: string; trained: boolean }[] = existsSync(`${MODELS}/index.json`) ? JSON.parse(readFileSync(`${MODELS}/index.json`, 'utf8')) : [];

describe('PyTorch ↔ TypeScript inference equivalence', () => {
  it('every shipped model has an equivalence fixture', () => {
    for (const m of index) expect(existsSync(`${FIXTURES}/${m.id}-equivalence.json`), `${m.id} fixture`).toBe(true);
  });

  for (const entry of index) {
    it(`${entry.id}: logits, probabilities, values and argmax match PyTorch`, () => {
      const file = JSON.parse(readFileSync(`${MODELS}/${entry.file}`, 'utf8')) as MlpModelFile;
      const fx = JSON.parse(readFileSync(`${FIXTURES}/${entry.id}-equivalence.json`, 'utf8')) as {
        observations: number[][]; logits: number[][]; probs: number[][]; values: number[]; argmax: number[];
      };
      const model = new MlpPolicyModel(file);
      expect(fx.observations.length).toBeGreaterThanOrEqual(32);
      let maxLogit = 0, maxProb = 0, maxValue = 0, argmaxAgree = 0;
      fx.observations.forEach((obs, i) => {
        const out = model.forward(obs);
        for (let a = 0; a < out.logits.length; a++) {
          maxLogit = Math.max(maxLogit, Math.abs(out.logits[a] - fx.logits[i][a]));
          maxProb = Math.max(maxProb, Math.abs(out.probs[a] - fx.probs[i][a]));
        }
        maxValue = Math.max(maxValue, Math.abs(out.value - fx.values[i]));
        if (argmax(out.logits) === fx.argmax[i]) argmaxAgree++;
      });
      expect(maxLogit).toBeLessThan(1e-5);
      expect(maxProb).toBeLessThan(1e-6);
      expect(maxValue).toBeLessThan(1e-5);
      expect(argmaxAgree).toBe(fx.observations.length);
    });
  }
});
