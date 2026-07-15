import type { AnyFieldApi } from "@tanstack/react-form";
import type { ReactNode } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Field, FieldError } from "@/components/ui/field";

import { fieldGroupClass, inputClass } from "./styles";

export type TextFieldProps = {
  field: AnyFieldApi;
  placeholder: string;
  autoComplete?: string;
  icon: ReactNode;
  endAddon?: ReactNode;
  type?: string;
};

export function TextField({
  field,
  placeholder,
  autoComplete,
  icon,
  endAddon,
  type = "text",
}: TextFieldProps) {
  const invalid = field.state.meta.errors.length > 0 || undefined;
  return (
    <Field data-invalid={invalid}>
      <InputGroup className={fieldGroupClass}>
        <InputGroupAddon>{icon}</InputGroupAddon>
        <InputGroupInput
          id={field.name}
          name={field.name}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          value={field.state.value as string}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
          aria-invalid={invalid}
          className={inputClass}
        />
        {endAddon}
      </InputGroup>
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}
