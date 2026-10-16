import { describe, it, expect, vi, beforeEach } from "vitest";

const loadOrRefreshThreadsTokenMock = vi.fn();
const uploadImageForThreadsMock = vi.fn();
const postImageToThreadsMock = vi.fn();

vi.mock("../../src/threads/threadsAuth.js", () => ({
  loadOrRefreshThreadsToken: loadOrRefreshThreadsTokenMock,
}));
vi.mock("../../src/threads/threadsPublish.js", () => ({
  uploadImageForThreads: uploadImageForThreadsMock,
  postImageToThreads: postImageToThreadsMock,
}));

const { postToThreadsIfConfigured } = await import("../../src/threads/postToThreads.js");

import { RunLogger } from "../../src/utils/logger.js";
import type { AppConfig } from "../../src/config/index.js";

function makeConfig(userId: string | undefined): AppConfig {
  return { threads: { userId, tokenR2Key: "x", apiBase: "https://graph.threads.net/v1.0" } } as unknown as AppConfig;
}

function makeLogger(): RunLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as RunLogger;
}

describe("postToThreadsIfConfigured - never throws, never blocks the caller", () => {
  beforeEach(() => {
    loadOrRefreshThreadsTokenMock.mockReset();
    uploadImageForThreadsMock.mockReset();
    postImageToThreadsMock.mockReset();
  });

  it("is a complete no-op (no token load, no upload, no publish call) when THREADS_USER_ID isn't set", async () => {
    await postToThreadsIfConfigured(makeConfig(undefined), makeLogger(), {
      imageBytes: Buffer.from("x"),
      mimeType: "image/jpeg",
      altText: "caption",
    });
    expect(loadOrRefreshThreadsTokenMock).not.toHaveBeenCalled();
  });

  it("skips cleanly when no usable token is available", async () => {
    loadOrRefreshThreadsTokenMock.mockResolvedValueOnce(null);
    await postToThreadsIfConfigured(makeConfig("123"), makeLogger(), {
      imageBytes: Buffer.from("x"),
      mimeType: "image/jpeg",
      altText: "caption",
    });
    expect(uploadImageForThreadsMock).not.toHaveBeenCalled();
  });

  it("skips cleanly when the image can't be hosted (storage not configured)", async () => {
    loadOrRefreshThreadsTokenMock.mockResolvedValueOnce("token-abc");
    uploadImageForThreadsMock.mockResolvedValueOnce(null);
    await postToThreadsIfConfigured(makeConfig("123"), makeLogger(), {
      imageBytes: Buffer.from("x"),
      mimeType: "image/jpeg",
      altText: "caption",
    });
    expect(postImageToThreadsMock).not.toHaveBeenCalled();
  });

  it("publishes end-to-end when everything is configured and available", async () => {
    loadOrRefreshThreadsTokenMock.mockResolvedValueOnce("token-abc");
    uploadImageForThreadsMock.mockResolvedValueOnce("https://pub.example.com/threads/images/x.jpg");
    postImageToThreadsMock.mockResolvedValueOnce("post-1");

    const logger = makeLogger();
    await postToThreadsIfConfigured(makeConfig("123"), logger, {
      imageBytes: Buffer.from("x"),
      mimeType: "image/jpeg",
      altText: "caption",
    });

    expect(postImageToThreadsMock).toHaveBeenCalledWith(expect.anything(), "token-abc", {
      imageUrl: "https://pub.example.com/threads/images/x.jpg",
      altText: "caption",
    });
    expect(logger.info).toHaveBeenCalled();
  });

  it("swallows any thrown error from the publish step rather than propagating it to the caller", async () => {
    loadOrRefreshThreadsTokenMock.mockResolvedValueOnce("token-abc");
    uploadImageForThreadsMock.mockResolvedValueOnce("https://pub.example.com/threads/images/x.jpg");
    postImageToThreadsMock.mockRejectedValueOnce(new Error("Threads API error: boom"));

    const logger = makeLogger();
    await expect(
      postToThreadsIfConfigured(makeConfig("123"), logger, { imageBytes: Buffer.from("x"), mimeType: "image/jpeg", altText: "caption" })
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
