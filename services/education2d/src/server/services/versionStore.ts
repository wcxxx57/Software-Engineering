import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  versionRecordSchema,
  visualizationIndexSchema,
  type VersionRecord,
  type VisualizationIndex,
  type VisualizationSpec,
} from "../../shared/schema.js";
import { validateVisualizationSpec } from "../../shared/validation.js";
import { NotFoundError, VersionConflictError } from "../errors.js";
import { KeyedMutex } from "./keyedMutex.js";

const VISUALIZATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_ID = /^[a-f0-9]{64}$/;

export interface StoredVisualization {
  index: VisualizationIndex;
  version: VersionRecord;
}

export interface CommitInput {
  visualizationId: string;
  baseVersionId: string;
  sourceRequestId: string;
  summary: string;
  spec: VisualizationSpec;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, content, "utf8");
  await fs.promises.rename(temporary, filePath);
}

export class VersionStore {
  private readonly mutex = new KeyedMutex();

  constructor(private readonly rootDir: string) {}

  private visualizationDir(visualizationId: string): string {
    if (!VISUALIZATION_ID.test(visualizationId)) throw new NotFoundError("可视化不存在");
    return path.join(this.rootDir, "visualizations", visualizationId);
  }

  private indexPath(visualizationId: string): string {
    return path.join(this.visualizationDir(visualizationId), "index.json");
  }

  private versionPath(visualizationId: string, versionId: string): string {
    if (!VERSION_ID.test(versionId)) throw new NotFoundError("版本不存在");
    return path.join(this.visualizationDir(visualizationId), "versions", `${versionId}.json`);
  }

  private async readJson(filePath: string): Promise<unknown> {
    try {
      return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError("可视化或版本不存在");
      throw error;
    }
  }

  async readIndex(visualizationId: string): Promise<VisualizationIndex> {
    return visualizationIndexSchema.parse(await this.readJson(this.indexPath(visualizationId)));
  }

  async readVersion(visualizationId: string, versionId: string): Promise<VersionRecord> {
    return versionRecordSchema.parse(await this.readJson(this.versionPath(visualizationId, versionId)));
  }

  async getCurrent(visualizationId: string): Promise<StoredVisualization> {
    const index = await this.readIndex(visualizationId);
    const version = await this.readVersion(visualizationId, index.currentVersionId);
    return { index, version };
  }

  async create(specInput: VisualizationSpec, sourceRequestId: string, summary: string): Promise<StoredVisualization> {
    const visualizationId = crypto.randomUUID();
    const spec = validateVisualizationSpec(specInput);
    const createdAt = new Date().toISOString();
    const payload = { parentVersionId: null, createdAt, sourceRequestId, summary, spec };
    const versionId = crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex");
    const version = versionRecordSchema.parse({ versionId, ...payload });
    const index = visualizationIndexSchema.parse({
      visualizationId,
      currentVersionId: versionId,
      undoStack: [],
      redoStack: [],
      createdAt,
      updatedAt: createdAt,
    });

    await atomicWrite(this.versionPath(visualizationId, versionId), `${JSON.stringify(version, null, 2)}\n`);
    await atomicWrite(this.indexPath(visualizationId), `${JSON.stringify(index, null, 2)}\n`);
    return { index, version };
  }

  async commit(input: CommitInput): Promise<StoredVisualization> {
    return this.mutex.runExclusive(input.visualizationId, async () => {
      const current = await this.getCurrent(input.visualizationId);
      if (current.index.currentVersionId !== input.baseVersionId) {
        throw new VersionConflictError(current.index.currentVersionId);
      }

      const spec = validateVisualizationSpec(input.spec);
      const createdAt = new Date().toISOString();
      const payload = {
        parentVersionId: current.index.currentVersionId,
        createdAt,
        sourceRequestId: input.sourceRequestId,
        summary: input.summary,
        spec,
      };
      const versionId = crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex");
      const version = versionRecordSchema.parse({ versionId, ...payload });
      const index = visualizationIndexSchema.parse({
        ...current.index,
        currentVersionId: versionId,
        undoStack: [...current.index.undoStack, current.index.currentVersionId],
        redoStack: [],
        updatedAt: createdAt,
      });

      await atomicWrite(this.versionPath(input.visualizationId, versionId), `${JSON.stringify(version, null, 2)}\n`);
      await atomicWrite(this.indexPath(input.visualizationId), `${JSON.stringify(index, null, 2)}\n`);
      return { index, version };
    });
  }

  async navigate(visualizationId: string, direction: "undo" | "redo", baseVersionId: string): Promise<StoredVisualization> {
    return this.mutex.runExclusive(visualizationId, async () => {
      const current = await this.getCurrent(visualizationId);
      if (current.index.currentVersionId !== baseVersionId) {
        throw new VersionConflictError(current.index.currentVersionId);
      }

      const sourceStack = direction === "undo" ? current.index.undoStack : current.index.redoStack;
      if (sourceStack.length === 0) return current;

      const targetVersionId = sourceStack.at(-1)!;
      const createdAt = new Date().toISOString();
      const index = visualizationIndexSchema.parse({
        ...current.index,
        currentVersionId: targetVersionId,
        undoStack: direction === "undo"
          ? current.index.undoStack.slice(0, -1)
          : [...current.index.undoStack, current.index.currentVersionId],
        redoStack: direction === "redo"
          ? current.index.redoStack.slice(0, -1)
          : [...current.index.redoStack, current.index.currentVersionId],
        updatedAt: createdAt,
      });

      await atomicWrite(this.indexPath(visualizationId), `${JSON.stringify(index, null, 2)}\n`);
      return { index, version: await this.readVersion(visualizationId, targetVersionId) };
    });
  }

  async listVersions(visualizationId: string): Promise<VersionRecord[]> {
    const versionsDir = path.join(this.visualizationDir(visualizationId), "versions");
    let files: string[];
    try {
      files = await fs.promises.readdir(versionsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError("可视化不存在");
      throw error;
    }
    const versions = await Promise.all(
      files.filter((file) => file.endsWith(".json")).map((file) => this.readJson(path.join(versionsDir, file)).then((value) => versionRecordSchema.parse(value))),
    );
    return versions.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
}
