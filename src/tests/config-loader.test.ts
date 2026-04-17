import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_FILENAME,
  CURRENT_SCHEMA_VERSION,
  LOCAL_CONFIG_FILENAME,
  loadMcphConfig,
  tokenFingerprint,
} from "../config-loader.js";

let synthHome: string;
let synthCwd: string;

beforeEach(() => {
  synthHome = mkdtempSync(join(tmpdir(), "mcph-cfg-home-"));
  synthCwd = mkdtempSync(join(tmpdir(), "mcph-cfg-cwd-"));
});

afterEach(() => {
  rmSync(synthHome, { recursive: true, force: true });
  rmSync(synthCwd, { recursive: true, force: true });
});

// Default to 0o600 — matches what `mcph install` writes, so test fixtures
// don't trip the loose-perms warning on POSIX CI runners. Tests that
// specifically need 644 chmodSync after this call.
function writeJson(path: string, obj: unknown): void {
  writeFileSync(path, JSON.stringify(obj, null, 2));
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

describe("loadMcphConfig — defaults & env-only", () => {
  it("returns defaults when no files exist and no env is set", async () => {
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.token).toBeNull();
    expect(r.tokenSource).toBe("missing");
    expect(r.apiBase).toBe("https://mcp.hosting");
    expect(r.apiBaseSource).toBe("default");
    expect(r.loadedFiles).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("reads MCPH_TOKEN + MCPH_URL from env when no files exist", async () => {
    const r = await loadMcphConfig({
      cwd: synthCwd,
      home: synthHome,
      env: { MCPH_TOKEN: "mcp_pat_env_aaaa", MCPH_URL: "https://staging.mcp.hosting" },
    });
    expect(r.token).toBe("mcp_pat_env_aaaa");
    expect(r.tokenSource).toBe("env");
    expect(r.apiBase).toBe("https://staging.mcp.hosting");
    expect(r.apiBaseSource).toBe("env");
  });
});

describe("loadMcphConfig — global ~/.mcph.json", () => {
  it("loads token + apiBase from ~/.mcph.json when env is empty", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), {
      version: 1,
      token: "mcp_pat_global_aaaa",
      apiBase: "https://corp.mcp.hosting",
    });
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.token).toBe("mcp_pat_global_aaaa");
    expect(r.tokenSource).toBe("global");
    expect(r.apiBase).toBe("https://corp.mcp.hosting");
    expect(r.apiBaseSource).toBe("global");
    expect(r.loadedFiles.map((f) => f.scope)).toEqual(["global"]);
  });

  it("env still wins over global file", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { token: "mcp_pat_global_aaaa" });
    const r = await loadMcphConfig({
      cwd: synthCwd,
      home: synthHome,
      env: { MCPH_TOKEN: "mcp_pat_env_bbbb" },
    });
    expect(r.token).toBe("mcp_pat_env_bbbb");
    expect(r.tokenSource).toBe("env");
  });
});

describe("loadMcphConfig — precedence", () => {
  it("local file beats global file for token", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { token: "mcp_pat_global_aaaa" });
    writeJson(join(synthCwd, LOCAL_CONFIG_FILENAME), { token: "mcp_pat_local_bbbb" });
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.token).toBe("mcp_pat_local_bbbb");
    expect(r.tokenSource).toBe("local");
    // Both files were loaded.
    expect(r.loadedFiles.map((f) => f.scope).sort()).toEqual(["global", "local"]);
  });

  it("apiBase precedence: env > local > project > global > default", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { apiBase: "https://global.example" });
    writeJson(join(synthCwd, CONFIG_FILENAME), { apiBase: "https://project.example" });
    writeJson(join(synthCwd, LOCAL_CONFIG_FILENAME), { apiBase: "https://local.example" });

    const localWins = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(localWins.apiBase).toBe("https://local.example");
    expect(localWins.apiBaseSource).toBe("local");

    rmSync(join(synthCwd, LOCAL_CONFIG_FILENAME));
    const projectWins = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(projectWins.apiBase).toBe("https://project.example");
    expect(projectWins.apiBaseSource).toBe("project");

    rmSync(join(synthCwd, CONFIG_FILENAME));
    const globalWins = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(globalWins.apiBase).toBe("https://global.example");
    expect(globalWins.apiBaseSource).toBe("global");

    const envWins = await loadMcphConfig({
      cwd: synthCwd,
      home: synthHome,
      env: { MCPH_URL: "https://env.example" },
    });
    expect(envWins.apiBase).toBe("https://env.example");
    expect(envWins.apiBaseSource).toBe("env");
  });

  it("project file token does NOT contribute to token resolution (only warns)", async () => {
    // The committed file is the wrong place for a token; we ignore it for
    // resolution and surface a warning instead. Only local + global supply tokens.
    writeJson(join(synthCwd, CONFIG_FILENAME), { token: "mcp_pat_should_not_use_aaaa" });
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.token).toBeNull();
    expect(r.tokenSource).toBe("missing");
    expect(r.warnings.some((w) => w.includes("project-shared file"))).toBe(true);
  });
});

describe("loadMcphConfig — JSONC support", () => {
  it("strips line + block comments before parsing", async () => {
    const path = join(synthHome, CONFIG_FILENAME);
    writeFileSync(
      path,
      `{
  // user-global config with comments
  "version": 1,
  "token": "mcp_pat_jsonc_aaaa", /* end-of-line block */
  "apiBase": "https://mcp.hosting"
}`,
    );
    if (process.platform !== "win32") chmodSync(path, 0o600);
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.token).toBe("mcp_pat_jsonc_aaaa");
    expect(r.warnings).toEqual([]);
  });
});

describe("loadMcphConfig — schema versioning", () => {
  it("warns when a file declares a newer schema version than this mcph supports", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { version: CURRENT_SCHEMA_VERSION + 1, token: "mcp_pat_aaaa" });
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.token).toBe("mcp_pat_aaaa");
    expect(r.warnings.some((w) => w.includes("schema version"))).toBe(true);
  });

  it("loads silently when version is current or absent", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { version: CURRENT_SCHEMA_VERSION, token: "x" });
    const r1 = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r1.warnings).toEqual([]);
    writeJson(join(synthHome, CONFIG_FILENAME), { token: "x" });
    const r2 = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r2.warnings).toEqual([]);
  });
});

describe("loadMcphConfig — fail-open on bad files", () => {
  it("malformed JSON in local file falls back to global", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { token: "mcp_pat_global_aaaa" });
    writeFileSync(join(synthCwd, LOCAL_CONFIG_FILENAME), "{ this is not json");
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.token).toBe("mcp_pat_global_aaaa");
    expect(r.tokenSource).toBe("global");
    expect(r.warnings.some((w) => w.includes("invalid JSON"))).toBe(true);
  });

  it("non-object root is ignored with a warning", async () => {
    writeFileSync(join(synthHome, CONFIG_FILENAME), JSON.stringify(["not", "an", "object"]));
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.token).toBeNull();
    expect(r.warnings.some((w) => w.includes("must be a JSON object"))).toBe(true);
  });
});

describe("loadMcphConfig — servers/blocked merging", () => {
  it("project allow-list wins over global", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { servers: ["a", "b"] });
    writeJson(join(synthCwd, CONFIG_FILENAME), { servers: ["c"] });
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.servers).toEqual(["c"]);
  });

  it("blocked unions across all scopes", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { blocked: ["a", "b"] });
    writeJson(join(synthCwd, CONFIG_FILENAME), { blocked: ["b", "c"] });
    writeJson(join(synthCwd, LOCAL_CONFIG_FILENAME), { blocked: ["d"] });
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect((r.blocked ?? []).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("loadMcphConfig — same-dir guard (cwd === home)", () => {
  it("does not double-load ~/.mcph.json when cwd === home", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { token: "mcp_pat_aaaa" });
    const r = await loadMcphConfig({ cwd: synthHome, home: synthHome, env: {} });
    // The single file should appear once, scoped as global (not duplicated as project).
    expect(r.loadedFiles.length).toBe(1);
    expect(r.loadedFiles[0].scope).toBe("global");
  });
});

describe("checkPermissions (POSIX only)", () => {
  it.skipIf(process.platform === "win32")("warns on world-readable file with token", async () => {
    const file = join(synthHome, CONFIG_FILENAME);
    writeJson(file, { token: "mcp_pat_loose_aaaa" });
    chmodSync(file, 0o644);
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.warnings.some((w) => w.includes("readable by group/other"))).toBe(true);
  });

  it.skipIf(process.platform === "win32")("does not warn on 0600 file", async () => {
    const file = join(synthHome, CONFIG_FILENAME);
    writeJson(file, { token: "mcp_pat_strict_aaaa" });
    chmodSync(file, 0o600);
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.warnings).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("does not warn on file without a token even if loose perms", async () => {
    const file = join(synthHome, CONFIG_FILENAME);
    writeJson(file, { servers: ["a"] });
    chmodSync(file, 0o644);
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.warnings).toEqual([]);
  });
});

describe("tokenFingerprint", () => {
  it("returns (none) for null", () => {
    expect(tokenFingerprint(null)).toBe("(none)");
  });

  it("masks long tokens to first-8…last-4", () => {
    expect(tokenFingerprint("mcp_pat_abcdef1234567890")).toBe("mcp_pat_…7890");
  });

  it("masks short tokens with last-2 only", () => {
    expect(tokenFingerprint("ab")).toBe("***ab");
  });
});

describe("loadMcphConfig — empty/invalid string fields are ignored", () => {
  it("empty token string is treated as missing", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { token: "" });
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.token).toBeNull();
    expect(r.tokenSource).toBe("missing");
  });

  it("non-string apiBase is ignored", async () => {
    writeJson(join(synthHome, CONFIG_FILENAME), { apiBase: 123 });
    const r = await loadMcphConfig({ cwd: synthCwd, home: synthHome, env: {} });
    expect(r.apiBase).toBe("https://mcp.hosting");
    expect(r.apiBaseSource).toBe("default");
  });
});
