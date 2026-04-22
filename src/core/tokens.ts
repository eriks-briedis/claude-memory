import { countTokens as anthropicCount } from "@anthropic-ai/tokenizer";

export function countTokens(text: string): number {
  try {
    return anthropicCount(text);
  } catch {
    return Math.ceil(text.length / 4);
  }
}
