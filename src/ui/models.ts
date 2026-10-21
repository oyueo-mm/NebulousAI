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

async function fetchModel(base: string, entry: ModelIndexEntry): Promise<MlpModelFile> {
  const res = await fetch(`${base}models/${entry.file}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const file = (await res.json()) as MlpModelFile;
  new MlpPolicyModel(file); // validates schema versions, shapes and finiteness
  return file;
}

/**
 * Loads public/models/index.json, then the default model first (so the game can start),
 * then the rest in the background. Invalid files are reported, never fatal.
 * `onUpdate` fires after the default model and again whenever another model arrives.
 */
export async function loadModels(base: string, onUpdate: (state: LoadedModels) => void): Promise<void> {
  const files: MlpModelFile[] = [];
  const errors: string[] = [];
  let index: ModelIndexEntry[] = [];
  try {
    const res = await fetch(`${base}models/index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = (await res.json()) as ModelIndexEntry[];
  } catch (err) {
    onUpdate({ files, errors: [`models/index.json: ${err instanceof Error ? err.message : String(err)}`], defaultId: null });
    return;
  }
  const order = new Map(index.map((e, i) => [e.id, i]));
  const publish = () => {
    // Keep the index order (newest first by convention).
    const sorted = [...files].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const loaded = new Set(sorted.map((f) => f.id));
    const defaultId = index.find((e) => e.default && loaded.has(e.id))?.id ?? sorted.find((f) => f.trained)?.id ?? sorted[0]?.id ?? null;
    onUpdate({ files: sorted, errors: [...errors], defaultId });
  };
  const load = async (entry: ModelIndexEntry) => {
    try {
      files.push(await fetchModel(base, entry));
    } catch (err) {
      errors.push(`${entry.file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const first = index.find((e) => e.default) ?? index.find((e) => e.trained) ?? index[0];
  if (first) await load(first);
  publish();
  await Promise.all(index.filter((e) => e !== first).map((e) => load(e).then(publish)));
}
