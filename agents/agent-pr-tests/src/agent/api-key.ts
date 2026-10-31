import { readFileSync, rmSync } from "node:fs";

/**
 * Reads the model key from `file` and deletes the file. The key stays out of
 * the environment, which the commands that run the model's tests inherit.
 */
export function takeApiKey(file: string): string {
  const key = readFileSync(file, "utf8").trim();
  rmSync(file);
  if (key === "") throw new Error(`The API key file ${file} is empty`);
  return key;
}
