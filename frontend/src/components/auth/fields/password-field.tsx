import type { AnyFieldApi } from "@tanstack/react-form";
import { useState } from "react";
import { EyeIcon, EyeOffIcon, LockKeyholeIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";

import { TextField } from "./text-field";

export type PasswordFieldProps = {
  field: AnyFieldApi;
  placeholder?: string;
  autoComplete?: string;
  icon?: LucideIcon;
};

export function PasswordField({
  field,
  placeholder = "请输入密码",
  autoComplete = "current-password",
  icon: Icon = LockKeyholeIcon,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      field={field}
      type={visible ? "text" : "password"}
      placeholder={placeholder}
      autoComplete={autoComplete}
      icon={<Icon className="size-[18px] text-brand-medium" />}
      endAddon={
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label={visible ? "隐藏密码" : "显示密码"}
            onClick={() => setVisible((v) => !v)}
            className="text-brand-medium hover:text-brand-dark"
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      }
    />
  );
}
