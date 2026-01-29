const { spawn } = require("child_process");

const server = spawn(
  "/Users/annielee/.pyenv/versions/3.10.13/bin/python3",
  ["-m", "accounting_mcp.server"],
  { cwd: "/Users/annielee/Documents/00.Work/00.專案外包/03.Project/accounting-mcp-master" }
);

let id = 1;

function send(msg) {
  server.stdin.write(JSON.stringify(msg) + "\n");
}

server.stdout.on("data", (data) => {
  const lines = data.toString().trim().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      console.log("<<", msg);
    } catch {
      console.log(line);
    }
  }
});

server.stderr.on("data", (data) => {
  console.error(data.toString());
});

// 1) initialize
send({
  jsonrpc: "2.0",
  id: id++,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "perfume-assistant", version: "1.0.0" },
    capabilities: {}
  }
});

// 2) initialized (notification)
send({
  jsonrpc: "2.0",
  method: "initialized",
  params: {}
});

// 3) 呼叫工具：add_transaction
send({
  jsonrpc: "2.0",
  id: id++,
  method: "tools/call",
  params: {
    name: "add_transaction",
    arguments: { amount: -50, category: "food", description: "午餐" }
  }
});

// 4) 查餘額
send({
  jsonrpc: "2.0",
  id: id++,
  method: "tools/call",
  params: { name: "get_balance", arguments: { detailed: true } }
});
