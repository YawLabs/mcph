# @yawlabs/mcp-connect

One install. All your MCP servers. Managed from the cloud.

mcp-connect is an MCP server that orchestrates all your other MCP servers. Configure your servers once on [mcp.hosting](https://mcp.hosting), install mcp-connect in your client, and never hand-edit MCP JSON configs again.

## How it works

```
Your MCP client (Claude Code, Cursor, etc.)
    |
    |  single stdio connection
    v
@yawlabs/mcp-connect
    |         |         |
    v         v         v
  GitHub    Slack    Stripe     ← your MCP servers (local or remote)
```

1. You add servers on [mcp.hosting](https://mcp.hosting) (name, command, args, env vars)
2. mcp-connect pulls your config on startup
3. You use 3 meta-tools to control which servers are active:
   - **`mcp_connect_discover`** — list all configured servers
   - **`mcp_connect_activate`** — connect a server and load its tools
   - **`mcp_connect_deactivate`** — disconnect and remove tools

Only activated servers load tools into context. This keeps your context window clean.

## Install

### Claude Code

```json
{
  "mcpServers": {
    "mcp-connect": {
      "command": "npx",
      "args": ["-y", "@yawlabs/mcp-connect"],
      "env": {
        "MCP_HOSTING_TOKEN": "mcp_pat_your_token_here"
      }
    }
  }
}
```

### Cursor / VS Code

Add to your MCP settings:

```json
{
  "mcp-connect": {
    "command": "npx",
    "args": ["-y", "@yawlabs/mcp-connect"],
    "env": {
      "MCP_HOSTING_TOKEN": "mcp_pat_your_token_here"
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-connect": {
      "command": "npx",
      "args": ["-y", "@yawlabs/mcp-connect"],
      "env": {
        "MCP_HOSTING_TOKEN": "mcp_pat_your_token_here"
      }
    }
  }
}
```

## Getting your token

1. Sign up at [mcp.hosting](https://mcp.hosting)
2. Go to **Settings > API Tokens**
3. Create a token — it starts with `mcp_pat_`
4. Add it to your MCP client config as shown above

## Adding servers

On [mcp.hosting](https://mcp.hosting), add each MCP server you want to orchestrate:

| Field | Description |
|-------|-------------|
| **Name** | Display name (e.g., "GitHub") |
| **Namespace** | Short prefix for tool names (e.g., "gh") |
| **Type** | `local` (stdio) or `remote` (HTTP) |
| **Command** | For local: the command to run (e.g., "npx") |
| **Args** | For local: command arguments (e.g., ["-y", "@modelcontextprotocol/server-github"]) |
| **Env** | Environment variables (API keys, tokens) |
| **URL** | For remote: the server URL |

## Usage

Once configured, your LLM will see three tools. Here's the typical flow:

### 1. Discover servers

```
> What MCP servers do I have?

Available MCP servers:

  gh — GitHub [available] (local)
  slack — Slack [available] (local)
  stripe — Stripe [available] (local)

0 active, 0 tools loaded.
```

### 2. Activate what you need

```
> Activate my GitHub server

Activated "gh" — 24 tools available: gh_create_issue, gh_list_prs, ...
```

The tool list updates automatically via `tools/list_changed`. Your client will see the new tools immediately.

### 3. Use the tools

```
> List my open PRs

[gh_list_prs is called, returns results]
```

Tools are namespaced: `{namespace}_{original_tool_name}`. This prevents collisions between servers.

### 4. Deactivate when done

```
> Deactivate GitHub

Deactivated "gh". Tools removed.
```

This frees up context for other tools.

## Config sync

mcp-connect polls [mcp.hosting](https://mcp.hosting) every 60 seconds for config changes. When you add, remove, or modify a server on the dashboard, mcp-connect picks it up automatically — no restart needed.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_HOSTING_TOKEN` | Yes | Your personal access token from mcp.hosting |
| `MCP_HOSTING_URL` | No | API URL (default: `https://mcp.hosting`) |

## Requirements

- Node.js 18+
- An [mcp.hosting](https://mcp.hosting) account

## License

MIT

## Links

- [mcp.hosting](https://mcp.hosting) — Dashboard and server management
- [@yawlabs/mcp-compliance](https://www.npmjs.com/package/@yawlabs/mcp-compliance) — Test your MCP servers for spec compliance
- [GitHub](https://github.com/YawLabs/mcp-connect) — Source code and issues
