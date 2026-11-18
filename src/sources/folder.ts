/** Watches a folder of .eml files (an exported mailbox, a Gmail filter forward, or the mock inbox). */
import { mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";

export interface RawMessage {
  raw: Buffer;
  ref: string;
}

export interface Source {
  name: string;
  fetch(): Promise<RawMessage[]>;
  /** done -> archive, failed -> dead-letter folder for inspection / retry */
  ack(ref: string, outcome: "done" | "failed"): Promise<void>;
  close?(): Promise<void>;
}

export class FolderSource implements Source {
  name = "folder";
  constructor(private dir: string) {
    for (const d of [dir, join(dir, "processed"), join(dir, "failed")]) mkdirSync(d, { recursive: true });
  }
  async fetch(): Promise<RawMessage[]> {
    return readdirSync(this.dir)
      .filter((f) => f.toLowerCase().endsWith(".eml"))
      .sort()
      .map((f) => ({ raw: readFileSync(join(this.dir, f)), ref: join(this.dir, f) }));
  }
  async ack(ref: string, outcome: "done" | "failed") {
    renameSync(ref, join(this.dir, outcome === "done" ? "processed" : "failed", basename(ref)));
  }
  /** Move dead-lettered files back into the inbox so the next run retries them. */
  requeueFailed(): string[] {
    const failedDir = join(this.dir, "failed");
    const files = readdirSync(failedDir).filter((f) => f.endsWith(".eml"));
    for (const f of files) renameSync(join(failedDir, f), join(this.dir, f));
    return files;
  }
}
