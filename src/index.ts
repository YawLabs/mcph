import { runComplianceCommand } from "./compliance-cmd.js";
import { ConfigError } from "./config.js";
import { log } from "./logger.js";
import { ConnectServer } from "./server.js";

// Subcommand dispatcher. `mcph` with no args (or with flags only) runs as
// the MCP server that talks to mcp.hosting. Known subcommands branch off
// before the MCPH_TOKEN check so local-only commands like `compliance`
// don't require an account.
const subcommand = process.argv[2];
if (subcommand === "compliance") {
  runComplianceCommand(process.argv.slice(3)).then((code) => process.exit(code));
} else if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
  process.stdout.write(
    "\n  mcph — MCP server orchestrator for mcp.hosting\n\n" +
      "  Usage:\n" +
      "    mcph                              Run as MCP server (requires MCPH_TOKEN)\n" +
      "    mcph compliance <target> [flags]  Run the compliance suite against an MCP server\n" +
      "    mcph --version                    Print version\n\n" +
      "  Compliance flags:\n" +
      "    --publish   Publish the report to mcp.hosting and print the URL\n\n",
  );
  process.exit(0);
} else if (subcommand === "--version" || subcommand === "-V") {
  // Version string is replaced at build time by tsup's define; falls back
  // to "dev" when running from source.
  process.stdout.write(`mcph ${process.env.npm_package_version ?? "dev"}\n`);
  process.exit(0);
} else {
  runServer();
}

function runServer(): void {
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
        '             "MCPH_TOKEN": "mcp_pat_your_token_here"\n' +
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
}
