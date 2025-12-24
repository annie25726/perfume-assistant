import { Converter } from "opencc-js";

// 使用「簡體 → 台灣繁體」
const converter = Converter({ from: "cn", to: "twp" });

export function toTraditional(text) {
  return converter(text);
}