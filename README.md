# @yawlabs/mcph

One install. All your MCP servers. Managed from the cloud.

mcph is an MCP server that orchestrates all your other MCP servers. Configure your servers once on [mcp.hosting](https://mcp.hosting), install mcph in your client, and never hand-edit MCP JSON configs again.

## How it works

```
Your MCP client (Claude Code, Cursor, etc.)
    |
    |  single stdio connection
    v
@yawlabs/mcph
    |         |         |
    v         v         v
  GitHub    Slack    Stripe     ← your MCP servers (local or remote)
```

1. You add servers on [mcp.hosting](https://mcp.hosting) (name, command, args, env vars)
2. mcph pulls your config on startup
3. You use a handful of meta-tools to control which servers are active:
   - **`mcp_connect_dispatch`** — describe a task in plain English; mcph picks the right server, activates it, and exposes its tools. The fast path when you know what you want.
   - **`mcp_connect_discover`** — list all configured servers, optionally ranked by relevance to a context string. Auto-activates the top match when one server clearly wins.
   - **`mcp_connect_activate`** — connect specific servers by namespace.
   - **`mcp_connect_deactivate`** — disconnect and remove tools.
   - **`mcp_connect_import`** — bulk-import servers from an existing client config (`claude_desktop_config.json`, `mcp.json`, etc.).
   - **`mcp_connect_health`** — show call counts, error rates, and latency per active connection.

Only activated servers load tools into context. This keeps your context window clean.

Ranking is two-stage when the backend has a Voyage embeddings key configured: a local BM25 pass narrows to a shortlist, then a `/api/connect/rerank` call semantically reorders. With no key on the backend it gracefully degrades to BM25-only — `dispatch` and `discover(context)` keep working, just with slightly weaker ranking on ambiguous queries.

## Install

### Claude Code

```json
{
  "mcpServers": {
    "mcph": {
      "command": "npx",
      "args": ["-y", "@yawlabs/mcph"],
      "env": {
        "MCPH_TOKEN": "mcp_pat_your_token_here"
      }
    }
  }
}
```

### Cursor / VS Code

Add to your MCP settings:

```json
{
  "mcph": {
    "command": "npx",
    "args": ["-y", "@yawlabs/mcph"],
    "env": {
      "MCPH_TOKEN": "mcp_pat_your_token_here"
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcph": {
      "command": "npx",
      "args": ["-y", "@yawlabs/mcph"],
      "env": {
        "MCPH_TOKEN": "mcp_pat_your_token_here"
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

### Fast path — `dispatch`

When you know what you want to do, skip the discover/activate dance:

```
> Create a GitHub issue for the login bug

[mcp_connect_dispatch is called with intent="create a GitHub issue for the login bug"]

Dispatched "create a GitHub issue for the login bug" — activated top 1 of 1 matching server.
gh (score 4.32): Activated "gh" — 24 tools: gh_create_issue, gh_list_prs, ...

[gh_create_issue is then called, returns the new issue]
```

`dispatch` ranks every configured server, activates the top match, and immediately exposes its tools so the LLM can call them. Default budget is 1 (one server). For tasks that need multiple servers, pass `budget: 3` etc.

### Manual control

```
> What MCP servers do I have?

Available MCP servers:

  gh — GitHub [available] (local)
  slack — Slack [available] (local)
  stripe — Stripe [available] (local)

0 active, 0 tools loaded.
```

```
> Activate my GitHub server

Activated "gh" — 24 tools available: gh_create_issue, gh_list_prs, ...
```

You can activate multiple at once: `> Activate GitHub and Slack`. Tools are namespaced as `{namespace}_{original_tool_name}` to prevent collisions. The tool list updates automatically via `tools/list_changed`.

```
> Deactivate GitHub when you're done

Deactivated "gh". Tools removed.
```

Servers also auto-deactivate after 10 tool calls to other servers, so context stays clean even if you forget.

### Test from the dashboard

The `/dashboard/connect` page in mcp.hosting has a **Test** button per server that probes activation through your running mcph and shows pass/fail inline — no LLM round-trip needed. Useful when you've just added a server and want to confirm the token works without prompting your AI.

### Errors come with deep-links

When activation fails (missing token, runtime not on PATH, server crashes on init), mcph emits a message ending with `→ Edit at https://mcp.hosting/dashboard/connect#server-<id>`. Most LLMs render that as a clickable link, and the dashboard scrolls to and highlights the matching card so you find the right server in one click.

## Config sync

mcph polls [mcp.hosting](https://mcp.hosting) every 60 seconds for config changes. When you add, remove, or modify a server on the dashboard, mcph picks it up automatically — no restart needed.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCPH_TOKEN` | Yes | Your personal access token from mcp.hosting |
| `MCPH_URL` | No | API URL (default: `https://mcp.hosting`) |
| `LOG_LEVEL` | No | Log verbosity: `debug`, `info`, `warn`, `error` (default: `info`) |
| `MCPH_POLL_INTERVAL` | No | Config-poll interval in seconds. `0` disables polling (config fetched once at startup). Default: `60` |
| `MCPH_AUTO_ACTIVATE` | No | When `discover` is called with a context string and one server clearly wins, auto-activate it. Set to `0` to disable. Default: enabled |
| `MCP_CONNECT_TIMEOUT` | No | Connection timeout in ms for upstream servers (default: `15000`) |
| `MCP_CONNECT_IDLE_THRESHOLD` | No | Tool calls to other servers before auto-deactivating an idle server (default: `10`) |

## Runtime detection

On startup, mcph probes your machine for `node`, `npx`, `python`, `uvx`, and `docker` and reports the snapshot to mcp.hosting. The dashboard uses this to warn before you add a catalog server whose runtime isn't installed (e.g., adding the Sentry server when Python isn't on your PATH). No prompt, no LLM round-trip — just a yellow banner on the Add Server form.

The detection is best-effort: each probe has a 3-second timeout and missing runtimes are recorded as absent rather than blocking startup. mcph itself only requires Node.js — every other runtime is optional and only matters for servers that need it.

## Requirements

- Node.js 18+
- An [mcp.hosting](https://mcp.hosting) account

## Links

- [mcp.hosting](https://mcp.hosting) — Dashboard and server management
- [@yawlabs/mcp-compliance](https://www.npmjs.com/package/@yawlabs/mcp-compliance) — Test your MCP servers for spec compliance
- [GitHub](https://github.com/YawLabs/mcph) — Source code and issues
