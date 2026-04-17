import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

const SERVER_ROOT = path.resolve(process.cwd(), "..", "..");
const SERVER_ENTRY = path.join(SERVER_ROOT, "apps", "server", "dist", "cli.js");
const PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$EDXdPdcJePuU4aqdDTFmng$kdZKRipS6Ru3B9QQq9uwcsEVwmPfX9c9oDi+gXkReJM";
const PASSWORD = "averylongpassword123";
const USERNAME = "admin";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate test port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Timed out waiting for test server.");
}

class TestClient {
  private cookieHeader = "";
  private csrfToken: string | null = null;

  constructor(private readonly baseUrl: string) {}

  async request(
    pathname: string,
    init?: RequestInit & { includeCsrf?: boolean }
  ): Promise<Response> {
    const headers = new Headers(init?.headers ?? {});
    if (this.cookieHeader) {
      headers.set("Cookie", this.cookieHeader);
    }

    if (init?.includeCsrf && this.csrfToken) {
      headers.set("X-CSRF-Token", this.csrfToken);
    }

    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...init,
      headers
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      this.cookieHeader = setCookie.split(";")[0];
    }

    return response;
  }

  async login(password: string): Promise<Response> {
    const response = await this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: USERNAME,
        password
      })
    });

    if (response.ok) {
      const json = (await response.clone().json()) as { csrfToken?: string };
      this.csrfToken = json.csrfToken ?? null;
    }

    return response;
  }

  clearSession(): void {
    this.cookieHeader = "";
    this.csrfToken = null;
  }
}

async function startServer(options?: {
  loginLimitMaxAttempts?: number;
  loginLimitWindowMs?: number;
  sessionTtlMs?: number;
}): Promise<{
  baseUrl: string;
  client: TestClient;
  stop: () => Promise<void>;
}> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "burnalias-test-"));
  const port = await getFreePort();
  const dbPath = path.join(tempDir, "burnalias-test.db");

  const child = spawn(process.execPath, [SERVER_ENTRY, "server"], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: dbPath,
      BURN_USER: USERNAME,
      BURN_PASSWORD_HASH: PASSWORD_HASH,
      BURN_SESSION_SECRET: "test-session-secret",
      BURN_SESSION_TTL_MS: String(options?.sessionTtlMs ?? 1000 * 60 * 60 * 24 * 7),
      BURN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: String(options?.loginLimitMaxAttempts ?? 5),
      BURN_LOGIN_RATE_LIMIT_WINDOW_MS: String(options?.loginLimitWindowMs ?? 900_000)
    },
    stdio: "pipe"
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    child.kill("SIGTERM");
    await rm(tempDir, { recursive: true, force: true });
    throw new Error(
      `Failed to start test server.${stderr ? `\nServer stderr:\n${stderr}` : ""}\n${String(error)}`
    );
  }

  return {
    baseUrl,
    client: new TestClient(baseUrl),
    stop: async () => {
      await stopChild(child);
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 5_000).unref();
  });
}

test("protected routes require authentication", async () => {
  const server = await startServer();
  try {
    const response = await server.client.request("/api/aliases");
    assert.equal(response.status, 401);

    const settingsResponse = await server.client.request("/api/settings");
    assert.equal(settingsResponse.status, 401);

    const providersResponse = await server.client.request("/api/providers");
    assert.equal(providersResponse.status, 401);

    const sessionResponse = await server.client.request("/api/auth/session");
    assert.equal(sessionResponse.status, 200);
    assert.deepEqual(await sessionResponse.json(), { authenticated: false });
  } finally {
    await server.stop();
  }
});

test("login establishes a session and returns csrf token", async () => {
  const server = await startServer();
  try {
    const loginResponse = await server.client.login(PASSWORD);
    assert.equal(loginResponse.status, 200);

    const loginJson = (await loginResponse.json()) as {
      authenticated: boolean;
      csrfToken?: string;
      user?: { username: string | null };
    };

    assert.equal(loginJson.authenticated, true);
    assert.equal(typeof loginJson.csrfToken, "string");
    assert.equal(loginJson.user?.username, USERNAME);

    const aliasesResponse = await server.client.request("/api/aliases");
    assert.equal(aliasesResponse.status, 200);

    const forwardAddressesResponse = await server.client.request("/api/forward-addresses");
    assert.equal(forwardAddressesResponse.status, 200);
    assert.deepEqual(await forwardAddressesResponse.json(), {
      forwardAddresses: [],
      source: "none",
      providerName: null
    });
  } finally {
    await server.stop();
  }
});

test("csrf token is required for authenticated state-changing routes", async () => {
  const server = await startServer();
  try {
    const loginResponse = await server.client.login(PASSWORD);
    assert.equal(loginResponse.status, 200);

    const noCsrfResponse = await server.client.request("/api/aliases", {
      method: "POST",
      body: JSON.stringify({
        localPart: "no-csrf",
        destinationEmail: "me@example.com",
        expiresInHours: null,
        label: null
      })
    });
    assert.equal(noCsrfResponse.status, 403);

    const withCsrfResponse = await server.client.request("/api/aliases", {
      method: "POST",
      includeCsrf: true,
      body: JSON.stringify({
        localPart: "with-csrf",
        destinationEmail: "me@example.com",
        expiresInHours: null,
        label: null
      })
    });
    // CSRF token is accepted; alias creation fails because no provider is configured in a fresh test instance.
    assert.notEqual(withCsrfResponse.status, 403);
  } finally {
    await server.stop();
  }
});

test("login rate limiting throttles repeated failed attempts", async () => {
  const server = await startServer({
    loginLimitMaxAttempts: 2,
    loginLimitWindowMs: 60_000
  });
  try {
    const firstFailure = await server.client.login("wrongwrongwrong");
    assert.equal(firstFailure.status, 401);
    server.client.clearSession();

    const secondFailure = await server.client.login("wrongwrongwrong");
    assert.equal(secondFailure.status, 401);
    server.client.clearSession();

    const throttled = await server.client.login("wrongwrongwrong");
    assert.equal(throttled.status, 429);
  } finally {
    await server.stop();
  }
});

test("logout invalidates the session and blocks protected routes again", async () => {
  const server = await startServer();
  try {
    const loginResponse = await server.client.login(PASSWORD);
    assert.equal(loginResponse.status, 200);

    const logoutResponse = await server.client.request("/api/auth/logout", {
      method: "POST",
      includeCsrf: true
    });
    assert.equal(logoutResponse.status, 204);

    const aliasesResponse = await server.client.request("/api/aliases");
    assert.equal(aliasesResponse.status, 401);

    const sessionResponse = await server.client.request("/api/auth/session");
    assert.equal(sessionResponse.status, 200);
    assert.deepEqual(await sessionResponse.json(), { authenticated: false });
  } finally {
    await server.stop();
  }
});

test("expired sessions are rejected after ttl elapses", async () => {
  const server = await startServer({
    sessionTtlMs: 200
  });
  try {
    const loginResponse = await server.client.login(PASSWORD);
    assert.equal(loginResponse.status, 200);

    await new Promise((resolve) => setTimeout(resolve, 350));

    const aliasesResponse = await server.client.request("/api/aliases");
    assert.equal(aliasesResponse.status, 401);

    const sessionResponse = await server.client.request("/api/auth/session");
    assert.equal(sessionResponse.status, 200);
    assert.deepEqual(await sessionResponse.json(), { authenticated: false });
  } finally {
    await server.stop();
  }
});
