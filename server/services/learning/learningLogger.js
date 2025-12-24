import fs from "fs";
import path from "path";

const LOG_PATH = path.join(process.cwd(), "learning", "learning_log.json");

function ensureFile() {
  if (!fs.existsSync(path.dirname(LOG_PATH))) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  }
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, "[]", "utf-8");
  }
}

export function logLearningEvent(event) {
  ensureFile();
  const logs = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));

  logs.push({
    ...event,
    timestamp: new Date().toISOString()
  });

  fs.writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2));
}
