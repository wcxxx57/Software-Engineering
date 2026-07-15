"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { LogInIcon } from "lucide-react";

import { PasswordField } from "./fields/password-field";
import { SubmitButton } from "./fields/submit-button";
import { UsernameField } from "./fields/username-field";
import { FieldGroup } from "@/components/ui/field";
import { meQueryKey } from "@/lib/query/keys";

const schema = z.object({
  username: z.string().min(3, "用户名至少 3 位").max(32, "用户名最多 32 位"),
  password: z.string().min(8, "密码至少 8 位").max(72, "密码最多 72 位"),
});

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const next = searchParams.get("next") || "/dashboard";
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { username: "", password: "" },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setSubmitError(data.message ?? "请求失败，请稍后再试");
        return;
      }
      // 让 root layout 重新拉 /me 并注水；同时让 client cache 失效，
      // 防止登录后旧 tab 仍持有“未登录态”的 me 缓存。
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
      router.push(next);
      router.refresh();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="flex flex-col gap-6"
    >
      <FieldGroup className="gap-4">
        <form.Field name="username">{(field) => <UsernameField field={field} />}</form.Field>
        <form.Field name="password">{(field) => <PasswordField field={field} />}</form.Field>
      </FieldGroup>

      {submitError && (
        <p
          role="alert"
          className="rounded-xl border-l-[3px] border-destructive bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
        >
          {submitError}
        </p>
      )}

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <SubmitButton
            pending={isSubmitting}
            disabled={!canSubmit}
            icon={<LogInIcon className="size-5" />}
          >
            立即登录
          </SubmitButton>
        )}
      </form.Subscribe>
    </form>
  );
}
