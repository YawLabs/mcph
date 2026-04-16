// Per-client, per-OS config file metadata for `mcph install <client>`.
// This is the authoritative mapping of {client, scope, OS} → file path +
// JSON shape; the dashboard's install UI at mcp-hosting/dashboard/src/
// components/onboarding/mcphInstall.ts is the visual mirror of this and
// should stay in sync. The tests in install-targets.test.ts lock the
// specifics (file names, JSON root keys) that would silently break the
// install flow if regressed.
//
// Bugs we've discovered in the wild and encode as invariants here:
//   • Claude Code reads `~/.claude/settings.json`, NOT `~/.claude.json`.
//     The latter is Claude Code's per-session state file (rewritten
//     constantly); pasting mcpServers there doesn't register globally
//     and risks clobbering conversation state.
//   • VS Code uses `servers` (not `mcpServers`) as the top-level key in
//     `.vscode/mcp.json`. Pasting a Claude Code shape fails silently.
//   • Claude Desktop has no Linux build, so install on Linux for that
//     client must refuse with a clear message rather than writing a
//     file the app will never read.
//   • On Windows, `npx` is a `.cmd` shim; MCP clients that spawn it
//     directly get ENOENT. The launch entry must be
//     `{ command: "cmd", args: ["/c", "npx", "-y", "@yawlabs/mcph"] }`.

import { homedir } from "node:os";
import { join } from "node:path";

export type InstallOS = "macos" | "linux" | "windows";
export type InstallClientId = "claude-code" | "claude-desktop" | "cursor" | "vscode";
export type InstallScope = "user" | "project" | "local";
export type JsonShape = "mcpServers" | "servers";

export interface ResolvedPath {
  /** Absolute path to the config file (with ~ / env vars expanded). */
  absolute: string;
  /** Human-friendly display path with ~ / env-var form preserved. */
  display: string;
}

export interface InstallScopeSpec {
  scope: InstallScope;
  /** Short label for help output. */
  label: string;
  /** Why you'd choose this scope. */
  description: string;
  /** Whether project folder is needed to resolve the path. */
  requiresProjectDir: boolean;
}

export interface InstallTarget {
  clientId: InstallClientId;
  label: string;
  jsonShape: JsonShape;
  /** Scopes this client supports. Empty = client unavailable. */
  scopes: InstallScopeSpec[];
  /** OSes the client ships on. Install on other OSes refuses. */
  availableOn: InstallOS[];
  /** Extra user-facing caveats (e.g., "restart the app after editing"). */
  notes?: string;
}

export const CURRENT_OS: InstallOS =
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";

export const INSTALL_TARGETS: InstallTarget[] = [
  {
    clientId: "claude-code",
    label: "Claude Code",
    jsonShape: "mcpServers",
    availableOn: ["macos", "linux", "windows"],
    scopes: [
      {
        scope: "user",
        label: "User (global)",
        description: "Private to this machine; applies to every project.",
        requiresProjectDir: false,
      },
      {
        scope: "project",
        label: "Project",
        description: "Commit to share with your team.",
        requiresProjectDir: true,
      },
      {
        scope: "local",
        label: "Local",
        description: "Per-project override; typically gitignored.",
        requiresProjectDir: true,
      },
    ],
  },
  {
    clientId: "claude-desktop",
    label: "Claude Desktop",
    jsonShape: "mcpServers",
    availableOn: ["macos", "windows"],
    notes: "Claude Desktop reads one file per OS — no project scope. Restart the app after editing.",
    scopes: [
      {
        scope: "user",
        label: "User",
        description: "The only config file Claude Desktop reads.",
        requiresProjectDir: false,
      },
    ],
  },
  {
    clientId: "cursor",
    label: "Cursor",
    jsonShape: "mcpServers",
    availableOn: ["macos", "linux", "windows"],
    scopes: [
      {
        scope: "user",
        label: "User (global)",
        description: "Private to this machine; applies to every Cursor project.",
        requiresProjectDir: false,
      },
      {
        scope: "project",
        label: "Project",
        description: "Commit to share with your team.",
        requiresProjectDir: true,
      },
    ],
  },
  {
    clientId: "vscode",
    label: "VS Code",
    jsonShape: "servers",
    availableOn: ["macos", "linux", "windows"],
    notes: "VS Code uses `servers` (not `mcpServers`) as the top-level key in .vscode/mcp.json.",
    scopes: [
      {
        scope: "project",
        label: "Workspace",
        description: "Per-project config; commit to share.",
        requiresProjectDir: true,
      },
    ],
  },
];

export interface ResolvePathOptions {
  clientId: InstallClientId;
  scope: InstallScope;
  os: InstallOS;
  projectDir?: string;
  /** Override for tests; defaults to os.homedir(). */
  home?: string;
  /** Override for tests; defaults to process.env.APPDATA (Windows). */
  appData?: string;
}

export function resolveInstallPath(opts: ResolvePathOptions): ResolvedPath {
  const home = opts.home ?? homedir();
  const appData = opts.appData ?? process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const { clientId, scope, os, projectDir } = opts;
  const target = INSTALL_TARGETS.find((t) => t.clientId === clientId);
  if (!target) throw new Error(`Unknown client: ${clientId}`);
  const scopeSpec = target.scopes.find((s) => s.scope === scope);
  if (!scopeSpec) throw new Error(`Client ${clientId} does not support scope ${scope}`);
  if (!target.availableOn.includes(os)) {
    throw new Error(`${target.label} is not available on ${os}`);
  }
  if (scopeSpec.requiresProjectDir && !projectDir) {
    throw new Error(`Scope ${scope} for ${clientId} requires a project directory`);
  }

  const p = pathFor(clientId, scope, os, { home, appData, projectDir: projectDir ?? "" });
  return p;
}

function pathFor(
  client: InstallClientId,
  scope: InstallScope,
  os: InstallOS,
  base: { home: string; appData: string; projectDir: string },
): ResolvedPath {
  const { home, appData, projectDir } = base;
  const sep = os === "windows" ? "\\" : "/";
  const joinPath = (...parts: string[]): string => parts.join(sep);

  if (client === "claude-code") {
    if (scope === "user") {
      if (os === "windows") {
        return { absolute: join(home, ".claude", "settings.json"), display: "%USERPROFILE%\\.claude\\settings.json" };
      }
      return { absolute: join(home, ".claude", "settings.json"), display: "~/.claude/settings.json" };
    }
    if (scope === "project") {
      return {
        absolute: join(projectDir, ".mcp.json"),
        display: joinPath("<project folder>", ".mcp.json"),
      };
    }
    // local
    return {
      absolute: join(projectDir, ".claude", "settings.local.json"),
      display: joinPath("<project folder>", ".claude", "settings.local.json"),
    };
  }

  if (client === "claude-desktop") {
    if (os === "macos") {
      return {
        absolute: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
        display: "~/Library/Application Support/Claude/claude_desktop_config.json",
      };
    }
    if (os === "windows") {
      return {
        absolute: join(appData, "Claude", "claude_desktop_config.json"),
        display: "%APPDATA%\\Claude\\claude_desktop_config.json",
      };
    }
    // linux — unreachable because availableOn guards this, but belt+suspenders.
    throw new Error("Claude Desktop is not available on Linux");
  }

  if (client === "cursor") {
    if (scope === "user") {
      if (os === "windows") {
        return { absolute: join(home, ".cursor", "mcp.json"), display: "%USERPROFILE%\\.cursor\\mcp.json" };
      }
      return { absolute: join(home, ".cursor", "mcp.json"), display: "~/.cursor/mcp.json" };
    }
    // project
    return {
      absolute: join(projectDir, ".cursor", "mcp.json"),
      display: joinPath("<project folder>", ".cursor", "mcp.json"),
    };
  }

  if (client === "vscode") {
    // VS Code only supports workspace/project scope today.
    return {
      absolute: join(projectDir, ".vscode", "mcp.json"),
      display: joinPath("<project folder>", ".vscode", "mcp.json"),
    };
  }

  throw new Error(`Unhandled client: ${client as string}`);
}

export interface BuildLaunchEntryOptions {
  os: InstallOS;
  /** Optional token to embed in env. Omit to keep env empty (preferred:
   *  token lives in ~/.mcph.json, not in the client config). */
  token?: string;
  /** Optional override for the `args` binary (defaults to @yawlabs/mcph). */
  pkg?: string;
}

/** The MCP client `mcpServers["mcp.hosting"]` entry — what `install` writes. */
export interface LaunchEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function buildLaunchEntry(opts: BuildLaunchEntryOptions): LaunchEntry {
  const pkg = opts.pkg ?? "@yawlabs/mcph";
  const entry: LaunchEntry =
    opts.os === "windows" ? { command: "cmd", args: ["/c", "npx", "-y", pkg] } : { command: "npx", args: ["-y", pkg] };
  if (opts.token) entry.env = { MCPH_TOKEN: opts.token };
  return entry;
}

/** The entry key we write into `mcpServers` (Claude Code / Desktop / Cursor)
 *  or `servers` (VS Code). Stable across clients so doctor can detect
 *  collisions deterministically. */
export const ENTRY_NAME = "mcp.hosting";
