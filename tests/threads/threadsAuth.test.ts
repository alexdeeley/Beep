import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class FakeS3Client {
    send = sendMock;
  }
  class FakeGetObjectCommand {
    constructor(public input: unknown) {}
  }
  class FakePutObjectCommand {
    constructor(public input: unknown) {}
  }
  return { S3Client: FakeS3Client, GetObjectCommand: FakeGetObjectCommand, PutObjectCommand: FakePutObjectCommand };
});

// Imported AFTER the mock is registered, per vitest's hoisting model - same pattern as sync.test.ts.
const { loadOrRefreshThreadsToken, exchangeForLongLivedToken, seedThreadsToken } = await import(
  "../../src/threads/threadsAuth.js"
);

import { RunLogger } from "../../src/utils/logger.js";
import type { AppConfig } from "../../src/config/index.js";

function makeConfig(): AppConfig {
  return {
    threads: {
      userId: "123456",
      tokenR2Key: "newswire/threads-token.json",
      apiBase: "https://graph.threads.net/v1.0",
    },
    storage: {
      provider: "r2",
      bucket: "test-bucket",
      accountId: "test-account",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      publicBaseUrl: "https://pub.example.com",
      region: "auto",
      endpoint: undefined,
    },
  } as unknown as AppConfig;
}

/** Fakes the async-iterable Body shape the AWS SDK v3 GetObjectCommand response carries. */
function fakeBody(json: unknown): { Body: AsyncIterable<Buffer> } {
  return {
    Body: {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify(json));
      },
    },
  };
}

describe("threadsAuth (mocked S3Client + fetch)", () => {
  let dir: string;
  let logger: RunLogger;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMock.mockReset();
    dir = mkdtempSync(join(tmpdir(), "threads-auth-test-"));
    logger = new RunLogger(join(dir, "logs"));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null without calling fetch when no token is stored yet", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("not found"), { name: "NoSuchKey" }));
    const token = await loadOrRefreshThreadsToken(makeConfig(), logger);
    expect(token).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the stored token as-is when it's too young to be refresh-eligible", async () => {
    const stored = { accessToken: "fresh-token", obtainedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 59).toISOString() };
    sendMock.mockResolvedValueOnce(fakeBody(stored));

    const token = await loadOrRefreshThreadsToken(makeConfig(), logger);
    expect(token).toBe("fresh-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes and persists a token that's old enough and close enough to expiry", async () => {
    const stored = {
      accessToken: "old-token",
      obtainedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 48h old, past the 24h eligibility floor
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(), // 5 days left, under the 10-day refresh threshold
    };
    sendMock.mockResolvedValueOnce(fakeBody(stored));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "new-token", expires_in: 60 * 24 * 60 * 60 }) });
    sendMock.mockResolvedValueOnce({}); // the PutObjectCommand re-persisting the refreshed token

    const token = await loadOrRefreshThreadsToken(makeConfig(), logger);

    expect(token).toBe("new-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(2); // one Get, one Put
    const putArg = sendMock.mock.calls[1]![0] as { input: { Body: string } };
    expect(JSON.parse(putArg.input.Body).accessToken).toBe("new-token");
  });

  it("falls back to the current token (without throwing) when the refresh call itself fails", async () => {
    const stored = {
      accessToken: "old-token",
      obtainedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(),
    };
    sendMock.mockResolvedValueOnce(fakeBody(stored));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: "bad token" } }) });

    const token = await loadOrRefreshThreadsToken(makeConfig(), logger);
    expect(token).toBe("old-token");
  });

  it("returns null once the stored token has already fully expired, rather than attempting a refresh", async () => {
    const stored = {
      accessToken: "ancient-token",
      obtainedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 61).toISOString(),
      expiresAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1h in the past
    };
    sendMock.mockResolvedValueOnce(fakeBody(stored));

    const token = await loadOrRefreshThreadsToken(makeConfig(), logger);
    expect(token).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchangeForLongLivedToken throws with Meta's own error message on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { message: "invalid app secret" } }) });
    await expect(exchangeForLongLivedToken(makeConfig(), "short-lived", "wrong-secret")).rejects.toThrow("invalid app secret");
  });

  it("seedThreadsToken writes the token to R2 under the configured key", async () => {
    sendMock.mockResolvedValueOnce({});
    await seedThreadsToken(makeConfig(), logger, { accessToken: "seeded", obtainedAt: new Date().toISOString(), expiresAt: new Date().toISOString() });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const putArg = sendMock.mock.calls[0]![0] as { input: { Key: string } };
    expect(putArg.input.Key).toBe("newswire/threads-token.json");
  });
});
