import { ApiError, ApiSchemaError, humanizeApiError } from "@/lib/api/errors";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/**
 * 包装 Server Action 的 try/catch 样板：
 *  - 命中 ApiError / ApiSchemaError → 返回中文化的 `{ ok: false, message }`
 *  - 其他异常继续向上抛（交给框架触发 error.tsx 边界）
 */
export async function withApiError<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ApiError || err instanceof ApiSchemaError) {
      return { ok: false, message: humanizeApiError(err) };
    }
    throw err;
  }
}
