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
   - **`mcp_connect_suggest`** — surface recurring multi-server workflows mcph has watched in this session. When you repeatedly use `gh` → `linear` → `slack` for the same kind of task, `suggest` lists the pattern so you can dispatch it as one intent next time.

Only activated servers load tools into context. This keeps your context window clean.

Ranking is two-stage when the backend has a Voyage embeddings key configured: a local BM25 pass narrows to a shortlist, then a `/api/connect/rerank` call semantically reorders. With no key on the backend it gracefully degrades to BM25-only — `dispatch` and `discover(context)` keep working, just with slightly weaker ranking on ambiguous queries.

On top of the ranker, mcph applies three session-local signals to dispatch scores:

- **Health-aware**: servers that have recently failed to activate or have high error rates get down-ranked. Never boosts above raw — "all else equal, prefer the one that works".
- **Learning**: servers that have succeeded this session get a small (+10% max) nudge, so the router remembers what's been useful.
- **Sampling tiebreak**: when the top two candidates are within 10% of each other and your client supports [MCP sampling](https://modelcontextprotocol.io/specification/server/sampling), mcph asks your client's LLM to pick. Uses the model you're already running — no extra provider key, no extra cost to mcph.

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

Servers also auto-deactivate after ~10 tool calls to other servers, so context stays clean even if you forget. The threshold is adaptive per-namespace: a server that's been called in bursts recently gets more patience (up to +20) before it's deactivated, so heavily-used servers don't get torn down mid-task. Long-idle servers still deactivate at the baseline.

## Project profiles (`.mcph.json`)

A project can scope which of your configured mcph servers are allowed to activate inside it by committing a `.mcph.json` at the project root:

```json
{
  "servers": ["gh", "pg", "linear"],
  "blocked": ["prod-db"]
}
```

Both fields are optional:

- `servers` — if set, only these namespaces can activate while you're inside this project tree.
- `blocked` — these namespaces are denied even if listed in `servers`.

mcph walks up from the current working directory looking for a `.mcph.json`. You can also keep a personal baseline at `~/.mcph.json` that applies everywhere, and layer a per-project file on top:

- **Only user-global** → use as-is.
- **Only project-local** → use as-is.
- **Both** → the project's `servers` list wins (explicit per-project scope); `blocked` is the UNION (fail-safe on deny).

`MCPH_PROFILE=/path/to/profile.json` overrides everything and skips user-global entirely. Malformed files log a warning and fall through — fail-open so a typo doesn't brick the session.

`mcp_connect_health` shows which profile(s) are currently applied so you can see what's active at a glance.

## Elicitation for missing credentials

When a server fails to start with stderr like `GITHUB_TOKEN is required` and your client advertises the MCP [elicitation](https://modelcontextprotocol.io/specification/server/elicitation) capability, mcph prompts you for the missing value inline and retries activation. Values stay in-memory for the current mcph session only — persist them in the mcp.hosting dashboard if you want them across restarts.

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
| `MCP_CONNECT_IDLE_THRESHOLD` | No | Baseline for idle auto-deactivate (default: `10`). The per-namespace adaptive cap is `[5, 50]` — bursty namespaces extend past the baseline, long-idle ones deactivate at it. |
| `MCPH_PROFILE` | No | Absolute path to an explicit `.mcph.json` profile. Overrides both project-walk-up discovery and `~/.mcph.json`. |

## Runtime detection

On startup, mcph probes your machine for `node`, `npx`, `python`, `uvx`, and `docker` and reports the snapshot to mcp.hosting. The dashboard uses this to warn before you add a catalog server whose runtime isn't installed (e.g., adding the Sentry server when Python isn't on your PATH). No prompt, no LLM round-trip — just a yellow banner on the Add Server form.

The detection is best-effort: each probe has a 3-second timeout and missing runtimes are recorded as absent rather than blocking startup. mcph itself only requires Node.js — every other runtime is optional and only matters for servers that need it.

### Automatic `uv` bootstrap

The popular Python-based MCP servers (`fetch`, `sqlite`, `time`, `sentry`, etc.) all launch via Astral's `uv`/`uvx`. mcph ships its own bootstrap for these: on first encounter with a `uv`/`uvx` command, if the binary isn't on your PATH, mcph lazily downloads Astral's standalone `uv` release, verifies the sha256, and caches it under the platform-appropriate cache dir. Subsequent activations reuse the cached binary. If you already have `uv` installed, mcph uses your version and never downloads.

`uvx ARGS` is always rewritten to `uv tool run ARGS` at spawn time — so only `uv` needs to be reachable, not `uvx` separately. Fixes Windows setups where one was on PATH and the other wasn't.

## Requirements

- Node.js 18+
- An [mcp.hosting](https://mcp.hosting) account

## Links

- [mcp.hosting](https://mcp.hosting) — Dashboard and server management
- [@yawlabs/mcp-compliance](https://www.npmjs.com/package/@yawlabs/mcp-compliance) — Test your MCP servers for spec compliance
- [GitHub](https://github.com/YawLabs/mcph) — Source code and issues
