import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bubbleSortFixture } from "../src/shared/fixtures.js";
import { VersionConflictError } from "../src/server/errors.js";
import { VersionStore } from "../src/server/services/versionStore.js";

describe("VersionStore", () => {
  let dataDir: string;
  let store: VersionStore;

  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "education2d-store-"));
    store = new VersionStore(dataDir);
  });
  afterEach(async () => { await fs.promises.rm(dataDir, { recursive: true, force: true }); });

  it("persists immutable versions and undo/redo state", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const nextSpec = { ...created.version.spec, title: "冒泡排序（已编辑）" };
    const committed = await store.commit({ visualizationId: created.index.visualizationId, baseVersionId: created.version.versionId, sourceRequestId: crypto.randomUUID(), summary: "rename", spec: nextSpec });
    expect(committed.index.undoStack).toEqual([created.version.versionId]);
    expect((await store.listVersions(created.index.visualizationId))).toHaveLength(2);

    const undone = await store.navigate(created.index.visualizationId, "undo", committed.version.versionId);
    expect(undone.version.title).toBeUndefined();
    expect(undone.version.spec.title).toBe("冒泡排序");
    const reloaded = new VersionStore(dataDir);
    const redone = await reloaded.navigate(created.index.visualizationId, "redo", undone.version.versionId);
    expect(redone.version.spec.title).toContain("已编辑");
  });

  it("rejects stale base versions", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const committed = await store.commit({ visualizationId: created.index.visualizationId, baseVersionId: created.version.versionId, sourceRequestId: crypto.randomUUID(), summary: "rename", spec: { ...created.version.spec, title: "new" } });
    await expect(store.commit({ visualizationId: created.index.visualizationId, baseVersionId: created.version.versionId, sourceRequestId: crypto.randomUUID(), summary: "stale", spec: committed.version.spec })).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("clears redo after editing from an undone version", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const committed = await store.commit({ visualizationId: created.index.visualizationId, baseVersionId: created.version.versionId, sourceRequestId: crypto.randomUUID(), summary: "edit one", spec: { ...created.version.spec, title: "one" } });
    const undone = await store.navigate(created.index.visualizationId, "undo", committed.version.versionId);
    const branched = await store.commit({ visualizationId: created.index.visualizationId, baseVersionId: undone.version.versionId, sourceRequestId: crypto.randomUUID(), summary: "edit two", spec: { ...undone.version.spec, title: "two" } });
    expect(branched.index.redoStack).toEqual([]);
    expect(await store.listVersions(created.index.visualizationId)).toHaveLength(3);
  });
});
