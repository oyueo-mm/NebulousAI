import { MlpPolicyModel, type MlpModelFile } from '../ai/rl';

export interface ModelIndexEntry {
  id: string;
  file: string;
  label: string;
  trained: boolean;
}

export interface LoadedModels {
  files: MlpModelFile[];
  errors: string[];
}

/** Fetches public/models/index.json and every model it lists; invalid files are reported, not fatal. */
export async function fetchModels(base: string): Promise<LoadedModels> {
  const files: MlpModelFile[] = [];
  const errors: string[] = [];
  let index: ModelIndexEntry[] = [];
  try {
    const res = await fetch(`${base}models/index.json`);
    if (!res.ok) return { files, errors: [`models/index.json: HTTP ${res.status}`] };
    index = (await res.json()) as ModelIndexEntry[];
  } catch (err) {
    return { files, errors: [`models/index.json: ${String(err)}`] };
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
  files.sort((a, b) => Number(b.trained) - Number(a.trained) || a.id.localeCompare(b.id));
  return { files, errors };
}
