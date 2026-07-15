import type { StorageConfig } from "@/lib/api/schemas";

/**
 * Compose a public, browser-accessible URL for an object stored under the
 * configured bucket. `key` is the path within the bucket
 * (e.g. `knowledge-videos/abc-uuid.mp4`).
 */
export function assetUrl(key: string, storage: StorageConfig): string {
  return `${storage.public_base}/${storage.bucket}/${key}`;
}
