# mcp-connect Roadmap

## Phase 1 — v0.1 (Complete)

- [x] Cloud-configured, locally-executed MCP orchestrator
- [x] discover / activate / deactivate meta-tools
- [x] Local server spawning (stdio) + remote server connections (HTTP)
- [x] Namespace-based tool routing
- [x] tools/list_changed notifications on activate/deactivate
- [x] 60s config polling with version hash comparison
- [x] Auto-deactivate servers idle for 10+ tool calls
- [x] Directive tool descriptions for context-aware LLM behavior
- [x] Graceful shutdown (SIGTERM/SIGINT)
- [x] Plan-based server limits (free: 3, paid: unlimited)

## Phase 2 — Smart Routing & Observability

- [ ] **Context cost estimates in discover()** — Show token cost per server (e.g., "npm: 22 tools, ~2,800 tokens") so the LLM can reason about context budget
- [ ] **Usage pattern hints** — Track which servers are frequently activated together and surface suggestions in discover() ("based on your last 3 calls, you probably need github next")
- [ ] **Suggested activation** — Orchestrator infers what to activate based on recent tool call patterns, LLM confirms
- [ ] **Automatic activation** — Pre-activate servers based on learned patterns without LLM confirmation (opt-in)
- [ ] **Routing analytics upload** — Send tool call patterns, activation/deactivation events, and error rates to mcp.hosting dashboard
- [ ] **Error tracking in discover()** — Show server health in discover results ("npm: last 3 calls failed, might be down")
- [ ] **Concurrent server cap** — Limit max active servers (5 for free, unlimited for paid) as both a business lever and context protection
- [ ] **Resource proxying** — Proxy MCP resources from upstream servers, not just tools
- [ ] **Prompt proxying** — Proxy MCP prompts from upstream servers
- [ ] **Per-tool activation** — Activate specific tools from a server instead of all tools (category-based subsets)
- [ ] **Marketplace integration** — Browse and one-click add servers from the mcp.hosting marketplace directly through discover()
- [ ] **Multi-device config sync** — Same token, same config, across all machines (already works implicitly, but needs marketing)

## Phase 3 — Platform Intelligence

- [ ] **Server recommendation engine** — "Users who use GitHub MCP also use Slack MCP" based on anonymized activation patterns
- [ ] **Pre-built orchestrator configs** — Curated bundles ("The DevOps Stack: GitHub + AWS + PagerDuty", "The Marketing Stack: HubSpot + Slack + Analytics")
- [ ] **Compliance-aware routing** — Only activate servers that pass a minimum compliance grade
- [ ] **Tool deduplication** — Detect overlapping tools across servers and surface the best one
- [ ] **Conversation-aware routing** — If mcp-connect could receive conversation context (future MCP spec), route automatically based on what the user is talking about
