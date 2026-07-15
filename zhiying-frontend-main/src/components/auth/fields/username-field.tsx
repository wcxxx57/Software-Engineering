import type { AnyFieldApi } from "@tanstack/react-form";
import { UserRoundIcon } from "lucide-react";

import { TextField } from "./text-field";

export function UsernameField({ field }: { field: AnyFieldApi }) {
  return (
    <TextField
      field={field}
      placeholder="请输入用户名"
      autoComplete="username"
      icon={<UserRoundIcon className="size-[18px] text-brand-medium" />}
    />
  );
}
