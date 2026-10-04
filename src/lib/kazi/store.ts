import { promises as fs } from "node:fs";
import path from "node:path";
import { Database, type Job } from "./types";

const DATA_DIR = process.env.KAZI_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "kazi.json");

let queue: Promise<unknown> = Promise.resolve();

// Serialises read-modify-write cycles so concurrent pipeline steps never clobber each other.
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

async function readDb(): Promise<Database> {
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    return Database.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { jobs: [] };
    }
    throw err;
  }
}

async function writeDb(db: Database) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, DB_FILE);
}

export const store = {
  dataDir: DATA_DIR,

  get(): Promise<Database> {
    return serialize(readDb);
  },

  update<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
    return serialize(async () => {
      const db = await readDb();
      const result = await mutator(db);
      await writeDb(db);
      return result;
    });
  },

  async getJob(id: string): Promise<Job | undefined> {
    const db = await this.get();
    return db.jobs.find((j) => j.id === id);
  },

  updateJob(id: string, patch: Partial<Job> | ((job: Job) => void)): Promise<Job> {
    return this.update((db) => {
      const job = db.jobs.find((j) => j.id === id);
      if (!job) throw new Error(`Job ${id} not found`);
      if (typeof patch === "function") patch(job);
      else Object.assign(job, patch);
      job.updatedAt = new Date().toISOString();
      return job;
    });
  },

  appendLog(id: string, line: string) {
    return this.updateJob(id, (job) => {
      job.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
    });
  },
};
