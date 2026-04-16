// .mcph.json loader for token, apiBase, version, servers, blocked.
//
// Config lives in three optional files, highest-precedence first:
//
//   1. <cwd>/.mcph.local.json — machine-local override; gitignore by convention
//   2. <cwd>/.mcph.json       — project-shared file (committed); MUST NOT contain a token
//   3. ~/.mcph.json           — user-global default
//
// Token precedence:    MCPH_TOKEN env  >  local  >  global   (project never holds a token)
// apiBase precedence:  MCPH_URL env    >  local  >  project  >  global  >  https://mcp.hosting
//
// servers/blocked merging matches profile.ts (allow-list: project wins;
// deny-list: union across all loaded files). Behavior under MCPH_PROFILE
// is preserved by the back-compat profile.ts shim.
//
// Why a separate module from profile.ts: profile.ts ships a stable
// fail-open API (loadEffectiveProfile etc.) used by server.ts and tested
// by 30+ existing assertions. Layering the new token/apiBase loader on
// top of the same file-read code keeps the v1 change focused; a
// follow-up can collapse the two into one I/O pass once this ships.

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseJsonc } from "./jsonc.js";
import { log } from "./logger.js";

export const CONFIG_FILENAME = ".mcph.json";
export const LOCAL_CONFIG_FILENAME = ".mcph.local.json";
/** Schema version we currently emit. Older files load fine; newer files
 *  trigger a warning so a user running an old mcph doesn't silently
 *  ignore fields it doesn't understand. */
export const CURRENT_SCHEMA_VERSION = 1;

export type ConfigScope = "local" | "project" | "global";

export interface LoadedConfigFile {
  path: string;
  scope: ConfigScope;
  version?: number;
  token?: string;
  apiBase?: string;
  servers?: string[];
  blocked?: string[];
}

export type TokenSource = "env" | "local" | "global" | "missing";
export type ApiBaseSource = "env" | "local" | "project" | "global" | "default";

export interface ResolvedConfig {
  token: string | null;
  tokenSource: TokenSource;
  apiBase: string;
  apiBaseSource: ApiBaseSource;
  /** Allow-list (project wins, else global). Undefined when neither sets it. */
  servers?: string[];
  /** Deny-list (union across all scopes that set it). */
  blocked?: string[];
  /** Files actually read + parsed (in load order). */
  loadedFiles: LoadedConfigFile[];
  /** Soft problems that don't fail loading. Surface in `mcph doctor`. */
  warnings: string[];
}

export interface LoadConfigOptions {
  /** Project root to search for local + project files. Defaults to process.cwd(). */
  cwd?: string;
  /** Home directory override for tests. Defaults to os.homedir(). */
  home?: string;
  /** Process env override for tests. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_API_BASE = "https://mcp.hosting";

async function readConfigAt(path: string, scope: ConfigScope, warnings: string[]): Promise<LoadedConfigFile | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // Missing file is normal, not a warning.
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseJsonc(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`${path}: invalid JSON (${msg}) — file ignored`);
    log("warn", "Config file is not valid JSON; ignoring", { path, error: msg });
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnings.push(`${path}: root must be a JSON object — file ignored`);
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  const version = typeof obj.version === "number" ? obj.version : undefined;
  if (version !== undefined && version > CURRENT_SCHEMA_VERSION) {
    warnings.push(
      `${path}: schema version ${version} is newer than this mcph (${CURRENT_SCHEMA_VERSION}); upgrade with \`npm i -g @yawlabs/mcph@latest\`. Loading best-effort.`,
    );
  }

  const token = typeof obj.token === "string" && obj.token.length > 0 ? obj.token : undefined;
  const apiBase = typeof obj.apiBase === "string" && obj.apiBase.length > 0 ? obj.apiBase : undefined;
  const servers = Array.isArray(obj.servers)
    ? obj.servers.filter((v): v is string => typeof v === "string")
    : undefined;
  const blocked = Array.isArray(obj.blocked)
    ? obj.blocked.filter((v): v is string => typeof v === "string")
    : undefined;

  if (token) {
    if (scope === "project") {
      warnings.push(
        `${path}: 'token' should not appear in a project-shared file. Move it to ${LOCAL_CONFIG_FILENAME} (gitignored) or ~/${CONFIG_FILENAME}.`,
      );
    }
    await checkPermissions(path, warnings);
  }

  return { path, scope, version, token, apiBase, servers, blocked };
}

async function checkPermissions(path: string, warnings: string[]): Promise<void> {
  // Synthetic POSIX modes on Windows are unreliable (almost always 0o666);
  // skip the check on Windows so we don't emit false-positive warnings.
  if (process.platform === "win32") return;
  try {
    const st = await stat(path);
    const mode = st.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      warnings.push(
        `${path}: contains a token but is readable by group/other (mode ${mode.toString(8)}). Run \`chmod 600 ${path}\` to restrict.`,
      );
    }
  } catch {
    // Stat failure is rare; not worth surfacing.
  }
}

/** Merge servers (allow-list): project wins if set, else local, else global. */
function pickServers(files: LoadedConfigFile[]): string[] | undefined {
  const project = files.find((f) => f.scope === "project")?.servers;
  if (project !== undefined) return project;
  const local = files.find((f) => f.scope === "local")?.servers;
  if (local !== undefined) return local;
  return files.find((f) => f.scope === "global")?.servers;
}

/** Merge blocked (deny-list): union across all scopes that declare it. */
function unionBlocked(files: LoadedConfigFile[]): string[] | undefined {
  const set = new Set<string>();
  let touched = false;
  for (const f of files) {
    if (f.blocked) {
      touched = true;
      for (const b of f.blocked) set.add(b);
    }
  }
  return touched ? [...set] : undefined;
}

export async function loadMcphConfig(opts: LoadConfigOptions = {}): Promise<ResolvedConfig> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const home = resolve(opts.home ?? homedir());
  const env = opts.env ?? process.env;

  const localPath = join(cwd, LOCAL_CONFIG_FILENAME);
  const projectPath = join(cwd, CONFIG_FILENAME);
  const globalPath = join(home, CONFIG_FILENAME);

  const warnings: string[] = [];
  const loadedFiles: LoadedConfigFile[] = [];

  const local = await readConfigAt(localPath, "local", warnings);
  if (local) loadedFiles.push(local);

  // Avoid double-loading when cwd === home (the project file IS the global file).
  const projectIsGlobal = projectPath === globalPath;
  const project = projectIsGlobal ? null : await readConfigAt(projectPath, "project", warnings);
  if (project) loadedFiles.push(project);

  const global = projectIsGlobal
    ? // When cwd === home, treat the single ~/.mcph.json as global only.
      await readConfigAt(globalPath, "global", warnings)
    : await readConfigAt(globalPath, "global", warnings);
  if (global) loadedFiles.push(global);

  // Token resolution.
  let token: string | null = null;
  let tokenSource: TokenSource = "missing";
  if (typeof env.MCPH_TOKEN === "string" && env.MCPH_TOKEN.length > 0) {
    token = env.MCPH_TOKEN;
    tokenSource = "env";
  } else if (local?.token) {
    token = local.token;
    tokenSource = "local";
  } else if (global?.token) {
    token = global.token;
    tokenSource = "global";
  }

  // apiBase resolution.
  let apiBase = DEFAULT_API_BASE;
  let apiBaseSource: ApiBaseSource = "default";
  if (typeof env.MCPH_URL === "string" && env.MCPH_URL.length > 0) {
    apiBase = env.MCPH_URL;
    apiBaseSource = "env";
  } else if (local?.apiBase) {
    apiBase = local.apiBase;
    apiBaseSource = "local";
  } else if (project?.apiBase) {
    apiBase = project.apiBase;
    apiBaseSource = "project";
  } else if (global?.apiBase) {
    apiBase = global.apiBase;
    apiBaseSource = "global";
  }

  return {
    token,
    tokenSource,
    apiBase,
    apiBaseSource,
    servers: pickServers(loadedFiles),
    blocked: unionBlocked(loadedFiles),
    loadedFiles,
    warnings,
  };
}

/** Last-4-of-token fingerprint for safe display in `mcph doctor`. */
export function tokenFingerprint(token: string | null): string {
  if (!token) return "(none)";
  if (token.length <= 8) return `***${token.slice(-2)}`;
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}
