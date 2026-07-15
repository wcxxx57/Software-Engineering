"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { AUTH_COOKIE, serverFetch } from "@/lib/api/client";
import {
  checkinResponseSchema,
  meProfileSchema,
  studyLanguage,
  studySubjectSchema,
  userSchema,
  type CheckinResponse,
  type MeProfile,
  type StudyLanguage,
  type StudySubject,
  type User,
} from "@/lib/api/schemas";
import { withApiError, type ActionResult } from "@/lib/server/action";

export type CheckinActionResult = ActionResult<CheckinResponse>;

export async function checkinAction(): Promise<CheckinActionResult> {
  return withApiError(async () => {
    const data = await serverFetch<CheckinResponse>("/checkins", {
      method: "POST",
      body: {},
      schema: checkinResponseSchema,
    });
    revalidatePath("/dashboard");
    return data;
  });
}

export type CreateSubjectInput = {
  subject: string;
  language: StudyLanguage;
  total_stages: number;
  target: string;
};

export type CreateSubjectActionResult = ActionResult<StudySubject>;

export async function createSubjectAction(
  input: CreateSubjectInput,
): Promise<CreateSubjectActionResult> {
  const subject = input.subject.trim();
  if (subject.length < 1 || subject.length > 200) {
    return { ok: false, message: "学习主题需在 1–200 字内" };
  }
  const langParse = studyLanguage.safeParse(input.language);
  if (!langParse.success) {
    return { ok: false, message: "请选择编程语言" };
  }
  if (!Number.isInteger(input.total_stages) || input.total_stages <= 0) {
    return { ok: false, message: "请选择学习阶段数" };
  }
  const target = input.target.trim();
  if (target.length > 2000) {
    return { ok: false, message: "学习目标不可超过 2000 字" };
  }

  return withApiError(async () => {
    const data = await serverFetch<StudySubject>("/study-subjects", {
      method: "POST",
      body: {
        subject,
        language: langParse.data,
        total_stages: input.total_stages,
        target,
      },
      schema: studySubjectSchema,
    });
    revalidatePath("/dashboard");
    return data;
  });
}

// ── Active subject ──

export type SetActiveSubjectActionResult = ActionResult<MeProfile>;

export async function setActiveSubjectAction(
  subjectId: number,
): Promise<SetActiveSubjectActionResult> {
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return { ok: false, message: "无效的学习主题" };
  }
  return withApiError(async () => {
    const data = await serverFetch<MeProfile>("/me", {
      method: "PATCH",
      body: { active_study_subject_id: subjectId },
      schema: meProfileSchema,
    });
    revalidatePath("/dashboard");
    return data;
  });
}

// ── Profile update ──

export type UpdateProfileInput = {
  birth_year?: number | null;
  gender?: "MALE" | "FEMALE" | null;
  introduction?: string;
};

export type UpdateProfileActionResult = ActionResult<MeProfile>;

export async function updateProfileAction(
  input: UpdateProfileInput,
): Promise<UpdateProfileActionResult> {
  return withApiError(async () => {
    const data = await serverFetch<MeProfile>("/me", {
      method: "PATCH",
      body: input,
      schema: meProfileSchema,
    });
    revalidatePath("/dashboard");
    return data;
  });
}

// ── Username update ──

export type UpdateUsernameActionResult = ActionResult<User>;

export async function updateUsernameAction(
  username: string,
): Promise<UpdateUsernameActionResult> {
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 32) {
    return { ok: false, message: "昵称需在 3–32 字符内" };
  }
  return withApiError(async () => {
    const data = await serverFetch<User>("/me/username", {
      method: "PATCH",
      body: { username: trimmed },
      schema: userSchema,
    });
    revalidatePath("/dashboard");
    return data;
  });
}

// ── Logout ──

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/login");
}

