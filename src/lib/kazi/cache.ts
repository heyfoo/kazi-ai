import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { store } from "./store";

const CACHE_DIR = path.join(store.dataDir, "cache");

export function contentHash(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export async function cached<T>(
  key: string,
  compute: () => Promise<T>,
  onHit?: () => void,
): Promise<T> {
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    onHit?.();
    return JSON.parse(raw) as T;
  } catch {
    // miss
  }
  const value = await compute();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
  return value;
}
