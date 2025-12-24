/**
 * Hugging Face Router – FINAL FINAL VERSION
 * ONLY uses:
 * POST https://router.huggingface.co/v1/chat/completions
 * Model: Meta-Llama-3-8B-Instruct
 */

import dotenv from "dotenv";
dotenv.config();

import fetch from "node-fetch";
import { postProcessLLMOutput } from "./textPostProcess.js";

/* ======================
   ENV
====================== */
const HF_API_TOKEN = process.env.HF_API_TOKEN;
const HF_MODEL =
  process.env.HF_MODEL || "meta-llama/Meta-Llama-3-8B-Instruct";

if (!HF_API_TOKEN) {
  throw new Error("HF_API_TOKEN is not set");
}

const HF_URL = "https://router.huggingface.co/v1/chat/completions";

/* ======================
   Prompt
====================== */
function buildMessages(message, strict = false) {
  const system = strict
    ? [
        "You must answer ONLY in Traditional Chinese (Taiwan).",
        "DO NOT output any English words.",
        "If the content is originally English, translate it to Traditional Chinese.",
        "Do not add citations, authors, years, or notes.",
        "Answer directly."
      ].join("\n")
    : [
        "You are an assistant that answers ONLY in Traditional Chinese (Taiwan).",
        "Do not use any English words.",
        "Do not add citations, authors, years, or notes.",
        "Answer directly."
      ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: String(message || "").trim() }
  ];
}

/* ======================
   Call Router
====================== */
async function callHF(messages) {
  const res = await fetch(HF_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages,
      temperature: Number(process.env.HF_TEMPERATURE || 0.3),
      max_tokens: Number(process.env.HF_MAX_TOKENS || 512),
    }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HF Router error ${res.status}: ${text}`);
  }

  const data = JSON.parse(text);
  return data?.choices?.[0]?.message?.content || "";
}

/* ======================
   Public API
====================== */
export async function askHuggingFace({ message }) {
  const threshold = Number(process.env.EN_RATIO_THRESHOLD || 0.18);

  // First try
  const raw1 = await callHF(buildMessages(message, false));
  const p1 = postProcessLLMOutput(raw1);

  if (!p1.meta.garbled && p1.meta.english_ratio <= threshold) {
    return { ...p1, usedRetry: false };
  }

  // Retry (strict Chinese)
  const raw2 = await callHF(buildMessages(message, true));
  const p2 = postProcessLLMOutput(raw2);

  return {
    ...p2,
    usedRetry: true,
    firstTryMeta: p1.meta,
  };
}
