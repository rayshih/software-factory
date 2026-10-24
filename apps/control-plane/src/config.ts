import { decodePrivateKeyB64 } from "./github/private-key.js";

export const DEFAULT_ALLOWED_REPOS = "rayshih/sf-demo-todo-api";
export const DEFAULT_TRIGGER_LABEL = "factory:run";
export const DEFAULT_BASE_BRANCH = "main";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const DEFAULT_AGENT_TIMEOUT_MS = 1_200_000;

export interface SharedConfig {
  databaseUrl: string;
  githubAppId: string;
  githubAppPrivateKey: string;
  allowedRepos: ReadonlySet<string>;
  triggerLabel: string;
  baseBranch: string;
  anthropicApiKey: string | null;
  anthropicModel: string;
  anthropicEnvironmentId: string | null;
  agentTimeoutMs: number;
  triggerProjectRef: string;
}

export interface ServerConfig extends SharedConfig {
  webhookSecret: string;
  port: number;
}

export function parseAllowedRepos(value: string | undefined): Set<string> {
  const raw = value === undefined ? DEFAULT_ALLOWED_REPOS : value;
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

export function loadDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return required(env, "DATABASE_URL");
}

export function loadSharedConfig(env: NodeJS.ProcessEnv): SharedConfig {
  const databaseUrl = loadDatabaseUrl(env);
  const githubAppId = required(env, "GITHUB_APP_ID");
  const githubAppPrivateKey = decodePrivateKeyB64(required(env, "GITHUB_APP_PRIVATE_KEY_B64"));
  const agentTimeoutMs = parsePositiveInt(env.AGENT_SESSION_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS);
  return {
    databaseUrl,
    githubAppId,
    githubAppPrivateKey,
    allowedRepos: parseAllowedRepos(env.ALLOWED_REPOS),
    triggerLabel: env.TRIGGER_LABEL?.trim() || DEFAULT_TRIGGER_LABEL,
    baseBranch: env.BASE_BRANCH?.trim() || DEFAULT_BASE_BRANCH,
    anthropicApiKey: blankToNull(env.ANTHROPIC_API_KEY),
    anthropicModel: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    anthropicEnvironmentId: blankToNull(env.ANTHROPIC_ENVIRONMENT_ID),
    agentTimeoutMs,
    triggerProjectRef: env.TRIGGER_PROJECT_REF?.trim() || "proj_replace_me",
  };
}

export function loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const port = parsePositiveInt(env.PORT, 3000);
  return {
    ...loadSharedConfig(env),
    webhookSecret: required(env, "GITHUB_WEBHOOK_SECRET"),
    port,
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, received ${value}`);
  }
  return parsed;
}
