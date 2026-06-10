import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureJsonFile<T>(filePath: string, initialValue: T): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, JSON.stringify(initialValue, null, 2), "utf8");
  }
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  await ensureJsonFile(filePath, fallback);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile<T>(filePath: string, value: T): Promise<void> {
  await ensureJsonFile(filePath, value);
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
