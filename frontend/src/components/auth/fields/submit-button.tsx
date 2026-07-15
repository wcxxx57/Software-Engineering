import type { ReactNode } from "react";
import { Loader2Icon } from "lucide-react";

import { submitClass } from "./styles";

export type SubmitButtonProps = {
  pending: boolean;
  disabled?: boolean;
  icon: ReactNode;
  children: ReactNode;
};

export function SubmitButton({ pending, disabled, icon, children }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={submitClass}
    >
      {pending ? <Loader2Icon className="size-5 animate-spin" /> : icon}
      {children}
    </button>
  );
}
