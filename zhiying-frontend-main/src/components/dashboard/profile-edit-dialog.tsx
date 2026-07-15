"use client";

import { GraduationCap } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  updateProfileAction,
  updateUsernameAction,
} from "@/app/(app)/dashboard/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { User } from "@/lib/api/schemas";

interface ProfileEditDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CURRENT_YEAR = new Date().getFullYear();

function birthYearToAge(birthYear: number | null): string {
  if (birthYear === null) return "";
  const age = CURRENT_YEAR - birthYear;
  return age > 0 ? String(age) : "";
}

function ageToBirthYear(age: string): number | null {
  const n = parseInt(age, 10);
  if (isNaN(n) || n <= 0 || n > 150) return null;
  return CURRENT_YEAR - n;
}

type GenderOption = "SECRET" | "MALE" | "FEMALE";

const GENDER_LABELS: Record<GenderOption, string> = {
  SECRET: "保密",
  MALE: "男",
  FEMALE: "女",
};

function genderToOption(g: "MALE" | "FEMALE" | null): GenderOption {
  return g ?? "SECRET";
}

function optionToGender(o: GenderOption): "MALE" | "FEMALE" | null {
  return o === "SECRET" ? null : o;
}

export function ProfileEditDialog({
  user,
  open,
  onOpenChange,
}: ProfileEditDialogProps) {
  const [username, setUsername] = useState(user.username);
  const [gender, setGender] = useState<GenderOption>(
    genderToOption(user.gender),
  );
  const [age, setAge] = useState(birthYearToAge(user.birth_year));
  const [introduction, setIntroduction] = useState(user.introduction);
  const [isPending, startTransition] = useTransition();

  const nicknameId = useId();
  const ageId = useId();
  const introId = useId();

  const handleSave = () => {
    startTransition(async () => {
      const usernameChanged = username.trim() !== user.username;
      const profilePayload: Record<string, unknown> = {};

      const newGender = optionToGender(gender);
      if (newGender !== user.gender) {
        profilePayload.gender = newGender;
      }

      const newBirthYear = ageToBirthYear(age);
      if (newBirthYear !== user.birth_year) {
        profilePayload.birth_year = newBirthYear;
      }

      if (introduction !== user.introduction) {
        profilePayload.introduction = introduction;
      }

      if (usernameChanged) {
        const res = await updateUsernameAction(username);
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
      }

      if (Object.keys(profilePayload).length > 0) {
        const res = await updateProfileAction(profilePayload);
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
      }

      toast.success("个人信息已更新");
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="h-1 w-full bg-gradient-to-r from-palette-orange via-palette-yellow to-palette-blue-light" />

        <div className="flex flex-col gap-6 px-10 pt-8 pb-10">
          <DialogHeader className="items-center text-center">
            <div className="mb-2 flex size-16 items-center justify-center rounded-[20px] bg-gradient-to-br from-palette-yellow-lighter to-palette-yellow text-palette-orange shadow-[var(--shadow-soft)]">
              <GraduationCap className="size-9" strokeWidth={1.6} />
            </div>
            <DialogTitle className="text-[26px] font-extrabold tracking-tight text-brand-deep">
              完善个人信息
            </DialogTitle>
            <DialogDescription className="text-[15px] text-brand-dark">
              帮助我们更好地了解你
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label
                htmlFor={nicknameId}
                className="text-sm font-semibold text-brand-medium"
              >
                昵称
              </Label>
              <Input
                id={nicknameId}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="给自己起个名字吧"
                maxLength={32}
              />
            </div>

            <div className="flex gap-4">
              <div className="flex flex-1 flex-col gap-2">
                <Label className="text-sm font-semibold text-brand-medium">
                  性别
                </Label>
                <Select
                  value={gender}
                  onValueChange={(v) => setGender(v as GenderOption)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {GENDER_LABELS[gender]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SECRET">保密</SelectItem>
                    <SelectItem value="MALE">男</SelectItem>
                    <SelectItem value="FEMALE">女</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-1 flex-col gap-2">
                <Label
                  htmlFor={ageId}
                  className="text-sm font-semibold text-brand-medium"
                >
                  年龄
                </Label>
                <Input
                  id={ageId}
                  type="number"
                  min={1}
                  max={150}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="18"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor={introId}
                className="text-sm font-semibold text-brand-medium"
              >
                个人简介
                <span className="ml-1 text-xs font-normal text-brand-light">
                  （选填）
                </span>
              </Label>
              <Textarea
                id={introId}
                value={introduction}
                onChange={(e) => setIntroduction(e.target.value)}
                placeholder="简单介绍一下你自己吧..."
                maxLength={1024}
                rows={3}
              />
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={isPending || username.trim().length < 3}
            className="h-12 w-full bg-gradient-to-r from-palette-yellow to-palette-orange text-base font-bold text-brand-dark shadow-[0_4px_16px_color-mix(in_oklch,var(--palette-orange)_35%,transparent)] hover:opacity-90"
          >
            {isPending ? "保存中…" : "保存信息"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
