import fs from "fs";
import path from "path";

const LOG_PATH = path.join(process.cwd(), "learning", "learning_log.json");
const RULE_PATH = path.join(process.cwd(), "learning", "learned_intents.json");

function ensureFiles() {
  if (!fs.existsSync(path.dirname(RULE_PATH))) {
    fs.mkdirSync(path.dirname(RULE_PATH), { recursive: true });
  }
  if (!fs.existsSync(RULE_PATH)) {
    fs.writeFileSync(RULE_PATH, "{}", "utf-8");
  }
}

export function updateIntentRules() {
  ensureFiles();
  if (!fs.existsSync(LOG_PATH)) return;

  const logs = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
  const rules = JSON.parse(fs.readFileSync(RULE_PATH, "utf-8"));

  for (const log of logs) {
    if (log.final_engine === "chatgpt") {
      rules[log.intent] = (rules[log.intent] || 0) + 1;
    }
  }

  fs.writeFileSync(RULE_PATH, JSON.stringify(rules, null, 2));
}

export function shouldForceGPT(intent) {
  ensureFiles();
  const rules = JSON.parse(fs.readFileSync(RULE_PATH, "utf-8"));
  return rules[intent] >= 3; // 3 次就學會
}
