import { describe, expect, it } from "vitest";
import { ENTRY_NAME, INSTALL_TARGETS, buildLaunchEntry, resolveInstallPath } from "../install-targets.js";

describe("INSTALL_TARGETS metadata", () => {
  it("includes the four expected clients", () => {
    expect(INSTALL_TARGETS.map((t) => t.clientId).sort()).toEqual([
      "claude-code",
      "claude-desktop",
      "cursor",
      "vscode",
    ]);
  });

  it("Claude Desktop is marked unavailable on Linux (no Linux build)", () => {
    const cd = INSTALL_TARGETS.find((t) => t.clientId === "claude-desktop");
    expect(cd?.availableOn).not.toContain("linux");
    expect(cd?.availableOn).toContain("macos");
    expect(cd?.availableOn).toContain("windows");
  });

  it("VS Code uses the `servers` root key, not `mcpServers`", () => {
    // This is the wire contract — getting it wrong silently fails.
    // code.visualstudio.com/docs/copilot/customization/mcp-servers
    const vscode = INSTALL_TARGETS.find((t) => t.clientId === "vscode");
    expect(vscode?.jsonShape).toBe("servers");
  });

  it("Claude Code + Desktop + Cursor all use `mcpServers` root key", () => {
    const mcpServerClients = INSTALL_TARGETS.filter((t) => t.jsonShape === "mcpServers").map((t) => t.clientId);
    expect(mcpServerClients.sort()).toEqual(["claude-code", "claude-desktop", "cursor"]);
  });

  it("every client lists at least one scope", () => {
    for (const t of INSTALL_TARGETS) {
      expect(t.scopes.length, `${t.clientId} has no scopes`).toBeGreaterThan(0);
    }
  });
});

describe("resolveInstallPath — Claude Code", () => {
  it("user scope on macOS resolves to ~/.claude/settings.json (NOT ~/.claude.json)", () => {
    const r = resolveInstallPath({
      clientId: "claude-code",
      scope: "user",
      os: "macos",
      home: "/Users/alice",
    });
    // Locks the bug we specifically guard against: .claude.json (no slash) is
    // Claude Code's per-session state file, pasting there doesn't load globally.
    expect(r.absolute).toMatch(/[\\/]\.claude[\\/]settings\.json$/);
    expect(r.absolute).not.toMatch(/[\\/]\.claude\.json$/);
    expect(r.display).toBe("~/.claude/settings.json");
  });

  it("user scope on Windows uses %USERPROFILE% display path", () => {
    const r = resolveInstallPath({
      clientId: "claude-code",
      scope: "user",
      os: "windows",
      home: "C:\\Users\\alice",
    });
    expect(r.display).toBe("%USERPROFILE%\\.claude\\settings.json");
  });

  it("project scope resolves to <project>/.mcp.json", () => {
    const r = resolveInstallPath({
      clientId: "claude-code",
      scope: "project",
      os: "linux",
      home: "/home/alice",
      projectDir: "/home/alice/repo",
    });
    expect(r.absolute).toMatch(/[\\/]\.mcp\.json$/);
  });

  it("local scope resolves to <project>/.claude/settings.local.json", () => {
    const r = resolveInstallPath({
      clientId: "claude-code",
      scope: "local",
      os: "linux",
      home: "/home/alice",
      projectDir: "/home/alice/repo",
    });
    expect(r.absolute).toMatch(/[\\/]\.claude[\\/]settings\.local\.json$/);
  });

  it("project scope without projectDir throws", () => {
    expect(() =>
      resolveInstallPath({ clientId: "claude-code", scope: "project", os: "linux", home: "/home/alice" }),
    ).toThrow(/requires a project directory/);
  });
});

describe("resolveInstallPath — Claude Desktop", () => {
  it("macOS resolves to ~/Library/Application Support/Claude/claude_desktop_config.json", () => {
    const r = resolveInstallPath({
      clientId: "claude-desktop",
      scope: "user",
      os: "macos",
      home: "/Users/alice",
    });
    expect(r.display).toBe("~/Library/Application Support/Claude/claude_desktop_config.json");
  });

  it("Windows uses %APPDATA%\\Claude\\claude_desktop_config.json", () => {
    const r = resolveInstallPath({
      clientId: "claude-desktop",
      scope: "user",
      os: "windows",
      home: "C:\\Users\\alice",
      appData: "C:\\Users\\alice\\AppData\\Roaming",
    });
    expect(r.display).toBe("%APPDATA%\\Claude\\claude_desktop_config.json");
  });

  it("Linux is refused (no Linux build)", () => {
    expect(() =>
      resolveInstallPath({ clientId: "claude-desktop", scope: "user", os: "linux", home: "/home/alice" }),
    ).toThrow(/not available on linux/);
  });
});

describe("resolveInstallPath — Cursor", () => {
  it("user scope uses ~/.cursor/mcp.json", () => {
    const r = resolveInstallPath({ clientId: "cursor", scope: "user", os: "macos", home: "/Users/alice" });
    expect(r.display).toBe("~/.cursor/mcp.json");
  });

  it("project scope uses <project>/.cursor/mcp.json", () => {
    const r = resolveInstallPath({
      clientId: "cursor",
      scope: "project",
      os: "linux",
      home: "/home/alice",
      projectDir: "/home/alice/repo",
    });
    expect(r.absolute).toMatch(/[\\/]\.cursor[\\/]mcp\.json$/);
  });
});

describe("resolveInstallPath — VS Code", () => {
  it("only supports project/workspace scope", () => {
    const vscode = INSTALL_TARGETS.find((t) => t.clientId === "vscode");
    expect(vscode?.scopes.map((s) => s.scope)).toEqual(["project"]);
  });

  it("resolves to <project>/.vscode/mcp.json", () => {
    const r = resolveInstallPath({
      clientId: "vscode",
      scope: "project",
      os: "linux",
      home: "/home/alice",
      projectDir: "/home/alice/repo",
    });
    expect(r.absolute).toMatch(/[\\/]\.vscode[\\/]mcp\.json$/);
  });
});

describe("buildLaunchEntry", () => {
  it("Windows wraps npx in cmd /c (npx.cmd shim workaround)", () => {
    const e = buildLaunchEntry({ os: "windows" });
    expect(e.command).toBe("cmd");
    expect(e.args).toEqual(["/c", "npx", "-y", "@yawlabs/mcph"]);
    expect(e.env).toBeUndefined();
  });

  it("macOS/Linux runs npx directly", () => {
    for (const os of ["macos", "linux"] as const) {
      const e = buildLaunchEntry({ os });
      expect(e.command).toBe("npx");
      expect(e.args).toEqual(["-y", "@yawlabs/mcph"]);
    }
  });

  it("embeds MCPH_TOKEN only when token is explicitly passed", () => {
    const withToken = buildLaunchEntry({ os: "macos", token: "mcp_pat_abc" });
    expect(withToken.env).toEqual({ MCPH_TOKEN: "mcp_pat_abc" });
    const without = buildLaunchEntry({ os: "macos" });
    expect(without.env).toBeUndefined();
  });
});

describe("ENTRY_NAME", () => {
  it("is the stable key mcph writes under mcpServers / servers", () => {
    // Doctor depends on this constant to detect an existing install.
    // If we ever rename it (e.g., "yawlabs-mcph"), user installs collide
    // until they re-run `mcph install` — document before changing.
    expect(ENTRY_NAME).toBe("mcp.hosting");
  });
});
