export const configQueryKey = ["config"] as const;
export const meQueryKey = ["me"] as const;

export function studySubjectQueryKey(id: number) {
  return ["study-subject", id] as const;
}

export function studySubjectListQueryKey() {
  return ["study-subject", "list"] as const;
}
