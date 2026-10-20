import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MlpPolicyModel, type MlpModelFile } from '../ai/rl';

/** Loads every exported model JSON in a directory, keyed by model id. */
export function loadModels(dir: string): Map<string, MlpPolicyModel> {
  const models = new Map<string, MlpPolicyModel>();
  if (!existsSync(dir)) return models;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const file = JSON.parse(readFileSync(join(dir, f), 'utf8')) as MlpModelFile;
    models.set(file.id, new MlpPolicyModel(file));
  }
  return models;
}
