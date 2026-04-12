import { ConfigError } from "./config.js";
import { log } from "./logger.js";
import { ConnectServer } from "./server.js";

const token = process.env.MCPH_TOKEN;
const apiUrl = process.env.MCPH_URL ?? "https://mcp.hosting";

if (!token) {
  process.stderr.write(
    "\n  mcph: MCPH_TOKEN is required.\n\n" +
      "  1. Create a token at https://mcp.hosting → Settings → API Tokens\n" +
      "  2. Add it to your MCP client config:\n\n" +
      "     {\n" +
      '       "mcpServers": {\n' +
      '         "mcp.hosting": {\n' +
      '           "command": "npx",\n' +
      '           "args": ["@yawlabs/mcph"],\n' +
      '           "env": {\n' +
      '             "MCPH_TOKEN": "mcph_pat_your_token_here"\n' +
      "           }\n" +
      "         }\n" +
      "       }\n" +
      "     }\n\n",
  );
  process.exit(1);
}

const server = new ConnectServer(apiUrl, token);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  if (forceExit.unref) forceExit.unref();
  await server.shutdown();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.start().catch((err) => {
  if (err instanceof ConfigError && err.fatal) {
    process.stderr.write(`\n  mcph: ${err.message}\n\n`);
    process.exit(1);
  }

  log("error", "Fatal startup error", { error: err.message });
  process.exit(1);
});
