import { toTraditional } from "../utils/toTraditional.js";

/**
 * Post-process LLM output:
 * 1) Remove mojibake / replacement chars
 * 2) Remove citation-like patterns (e.g. (Laine, 2021))
 * 3) Optionally keep only CJK + common punctuation
 * 4) Convert to Traditional Chinese (Taiwan)
 */
export function englishRatio(text = "") {
  const s = String(text || "");
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const total = s.replace(/\s+/g, "").length || 1;
  return letters / total;
}

export function looksGarbled(text = "") {
  const s = String(text || "");
  // replacement char, inverted question mark, stray Cyrillic/Greek often indicates garbage
  if (/[�¿]/.test(s)) return true;
  if (/[А-Яа-яЁёЇїІіЄєҐґ]/.test(s)) return true;
  return false;
}

export function stripCitations(text = "") {
  let s = String(text || "");

  // (Author, 2021) / (Author et al., 2022)
  s = s.replace(/\((?:[A-Z][A-Za-z.'\-\s]+)(?:et\s+al\.)?,\s*\d{4}\)/g, "");

  // [1], [12] style
  s = s.replace(/\[\d{1,3}\]/g, "");

  // trailing References section (simple heuristic)
  s = s.replace(/\n{2,}(References|參考資料|参考资料)[\s\S]*$/i, "");

  return s;
}

export function stripMojibake(text = "") {
  let s = String(text || "");
  s = s.replace(/[�¿]/g, "");
  // common weird prefix/suffix artifacts
  s = s.replace(/\(\s*\s*\)/g, "");
  return s;
}

export function keepChinese(text = "") {
  // Keep CJK, numbers, whitespace and common punctuation
  return String(text || "").replace(/[^\u4e00-\u9fff0-9a-zA-Z。，、！？；：「」『』（）()\-—…\s]/g, "");
}

export function postProcessLLMOutput(rawText, opts = {}) {
  const options = {
    keepChineseOnly: String(process.env.KEEP_CHINESE_ONLY || "0") === "1",
    ...opts,
  };

  const raw = String(rawText ?? "");
  let cleaned = raw;

  cleaned = stripMojibake(cleaned);
  cleaned = stripCitations(cleaned);

  // collapse spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // optional: reduce English noise while allowing product names, acronyms
  if (options.keepChineseOnly) {
    cleaned = keepChinese(cleaned).replace(/\s+/g, " ").trim();
  }

  const ratio = englishRatio(cleaned);
  const garbled = looksGarbled(raw);

  const text = toTraditional(cleaned);

  return {
    text,
    raw,
    cleaned,
    meta: { english_ratio: ratio, garbled }
  };
}
