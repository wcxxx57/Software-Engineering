import type { ZodError } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ApiSchemaError extends Error {
  readonly zodError: ZodError;
  readonly payload: unknown;

  constructor(zodError: ZodError, payload: unknown) {
    super("Response schema validation failed");
    this.name = "ApiSchemaError";
    this.zodError = zodError;
    this.payload = payload;
  }
}

const STATUS_FALLBACK: Record<number, string> = {
  400: "请求参数有误",
  401: "请先登录后再试",
  402: "余额不足",
  403: "暂无权限访问该资源",
  404: "未找到对应资源",
  408: "请求超时，请重试",
  409: "操作冲突，请刷新后重试",
  422: "请求数据未通过校验",
  429: "操作过于频繁，请稍后再试",
  500: "服务暂时不可用，请稍后重试",
  502: "服务暂时不可用，请稍后重试",
  503: "服务暂时不可用，请稍后重试",
  504: "服务响应超时，请稍后重试",
};

const CJK = /[一-鿿]/;

function isNetworkFailure(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (!(err instanceof TypeError)) return false;

  return /failed to fetch|network(?:\s+error)?|load failed|fetch failed/i.test(err.message);
}

export function humanizeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message && CJK.test(err.message)) return err.message;
    return STATUS_FALLBACK[err.status] ?? `请求失败 (${err.status})`;
  }
  if (err instanceof ApiSchemaError) {
    return "服务返回的数据格式异常，请稍后再试";
  }
  if (err instanceof Error && err.message && CJK.test(err.message)) {
    return err.message;
  }
  if (isNetworkFailure(err)) {
    return "网络连接失败，请检查网络或确认本地服务正在运行后重试";
  }
  if (err instanceof Error && /malformed (?:api )?response|missing data envelope/i.test(err.message)) {
    return "服务返回的数据格式异常，请稍后再试";
  }
  return "操作失败，请稍后重试";
}
