import { cookies } from "next/headers";

import { AUTH_COOKIE, serverFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { userSchema, type User } from "@/lib/api/schemas";

export async function getAuthToken(): Promise<string | null> {
  return (await cookies()).get(AUTH_COOKIE)?.value ?? null;
}

export async function getSession(): Promise<User | null> {
  const token = await getAuthToken();
  if (!token) return null;
  try {
    return await serverFetch<User>("/me", { schema: userSchema });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return null;
    }
    throw err;
  }
}

export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
