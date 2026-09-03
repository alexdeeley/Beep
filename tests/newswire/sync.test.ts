import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
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

// Imported AFTER the mock is registered, per vitest's hoisting model.
const { downloadStoryDb, uploadStoryDb } = await import("../../src/newswire/db/sync.js");

import { RunLogger } from "../../src/utils/logger.js";
import type { AppConfig } from "../../src/config/index.js";

function makeConfig(overrides: Partial<AppConfig["storage"]> = {}): AppConfig {
  return {
    news: { dbR2Key: "newswire/story.db" },
    storage: {
      provider: "r2",
      bucket: "test-bucket",
      accountId: "test-account",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      publicBaseUrl: "https://pub.example.com",
      region: "auto",
      endpoint: undefined,
      ...overrides,
    },
  } as unknown as AppConfig;
}

describe("downloadStoryDb / uploadStoryDb (mocked S3Client)", () => {
  let dir: string;
  let logger: RunLogger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "newswire-sync-test-"));
    logger = new RunLogger(join(dir, "logs"));
    sendMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("treats a NoSuchKey response as a first-ever run - no error, no downloaded file, null etag", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("not found"), { name: "NoSuchKey" }));

    const localPath = join(dir, "story.db");
    const handle = await downloadStoryDb(makeConfig(), logger, localPath);

    expect(handle.downloadedEtag).toBeNull();
    expect(existsSync(localPath)).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("re-throws an unexpected download error rather than silently treating it as first-run", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("access denied"), { name: "AccessDenied" }));

    await expect(downloadStoryDb(makeConfig(), logger, join(dir, "story.db"))).rejects.toThrow("access denied");
  });

  it("skips both download and upload cleanly when storage credentials are missing (local/dev mode)", async () => {
    const handle = await downloadStoryDb(makeConfig({ accessKeyId: undefined }), logger, join(dir, "story.db"));
    expect(handle.client).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();

    // Upload with a null-client handle should also no-op without throwing.
    await expect(uploadStoryDb(handle, logger, join(dir, "story.db"))).resolves.toBeUndefined();
  });

  it("uploads the local file with an IfMatch precondition when an etag was recorded on download", async () => {
    const localPath = join(dir, "story.db");
    writeFileSync(localPath, "fake sqlite bytes");

    const handle = { client: { send: sendMock } as never, bucket: "test-bucket", key: "newswire/story.db", downloadedEtag: '"abc123"' };
    sendMock.mockResolvedValueOnce({});

    await uploadStoryDb(handle, logger, localPath);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const commandArg = sendMock.mock.calls[0]![0] as { input: { IfMatch?: string } };
    expect(commandArg.input.IfMatch).toBe('"abc123"');
  });

  it("surfaces a PreconditionFailed upload error (concurrent write detected) rather than swallowing it", async () => {
    const localPath = join(dir, "story.db");
    writeFileSync(localPath, "fake sqlite bytes");

    const handle = { client: { send: sendMock } as never, bucket: "test-bucket", key: "newswire/story.db", downloadedEtag: '"abc123"' };
    sendMock.mockRejectedValueOnce(Object.assign(new Error("precondition failed"), { name: "PreconditionFailed" }));

    await expect(uploadStoryDb(handle, logger, localPath)).rejects.toThrow("precondition failed");
  });
});
