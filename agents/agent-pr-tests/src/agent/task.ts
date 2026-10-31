export const PR_SKILL = "pr-unit-tests";

export function parsePrNumber(raw: string | undefined): number {
  const pr = Number(raw);
  if (!Number.isSafeInteger(pr) || pr <= 0) {
    throw new Error("--pr <number> is required");
  }
  return pr;
}

export function prPrompt(pr: number): string {
  return `/skill:${PR_SKILL} ${pr}`;
}
