import { MlpPolicyModel, type MlpModelFile } from '../ai/rl';

export interface ModelIndexEntry {
  id: string;
  file: string;
  label: string;
  trained: boolean;
  /** The model Play / Watch use for PPO agents by default. */
  default?: boolean;
}

export interface LoadedModels {
  files: MlpModelFile[];
  errors: string[];
  defaultId: string | null;
}

/** Fetches public/models/index.json and every model it lists; invalid files are reported, not fatal. */
export async function fetchModels(base: string): Promise<LoadedModels> {
  const files: MlpModelFile[] = [];
  const errors: string[] = [];
  let index: ModelIndexEntry[] = [];
  try {
    const res = await fetch(`${base}models/index.json`);
    if (!res.ok) return { files, errors: [`models/index.json: HTTP ${res.status}`], defaultId: null };
    index = (await res.json()) as ModelIndexEntry[];
  } catch (err) {
    return { files, errors: [`models/index.json: ${String(err)}`], defaultId: null };
  }
  await Promise.all(index.map(async (entry) => {
    try {
      const res = await fetch(`${base}models/${entry.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = (await res.json()) as MlpModelFile;
      new MlpPolicyModel(file); // validates schema versions, shapes and finiteness
      files.push(file);
    } catch (err) {
      errors.push(`${entry.file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }));
  // Keep the index order (newest first by convention).
  const order = new Map(index.map((e, i) => [e.id, i]));
  files.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const loaded = new Set(files.map((f) => f.id));
  const defaultId = index.find((e) => e.default && loaded.has(e.id))?.id ?? files.find((f) => f.trained)?.id ?? files[0]?.id ?? null;
  return { files, errors, defaultId };
}
