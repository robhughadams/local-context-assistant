import { STOP_WORDS } from "./config";

export function tokenize(text: string): string[] {
  const normalized = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  const tokens = normalized.match(/[a-z0-9_]+/g) ?? [];
  return tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function tokenFrequency(tokens: string[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const token of tokens) {
    freq[token] = (freq[token] ?? 0) + 1;
  }
  return freq;
}
