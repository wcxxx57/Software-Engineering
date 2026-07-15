import { NextResponse } from "next/server";

import { ApiError, ApiSchemaError } from "@/lib/api/errors";

/**
 * 把 ApiError / ApiSchemaError 折成对应状态码的 JSON 响应。
 * 其他异常向上抛，由 Next.js 默认错误处理接管。
 */
export function apiErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { message: err.message, code: err.code },
      { status: err.status },
    );
  }
  if (err instanceof ApiSchemaError) {
    return NextResponse.json(
      { message: "服务返回的数据格式异常", code: "SCHEMA_MISMATCH" },
      { status: 502 },
    );
  }
  throw err;
}

/**
 * 大多数代理路由是「拿数据 → 包 envelope → 返回」。本 helper 把样板收敛。
 *
 * 若需要在响应上做额外操作（如写 cookie），请直接使用 apiErrorResponse 处理 catch。
 */
export async function proxyJson<T>(
  fn: () => Promise<T>,
  init?: { status?: number },
): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json({ data }, { status: init?.status ?? 200 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
