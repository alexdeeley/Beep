import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const uploadBytesMock = vi.fn();

vi.mock("../../src/storage/storage.js", () => ({
  uploadBytes: uploadBytesMock,
}));

// Imported AFTER the mock is registered, per vitest's hoisting model.
const { uploadImageForThreads, postImageToThreads } = await import("../../src/threads/threadsPublish.js");

import { RunLogger } from "../../src/utils/logger.js";
import type { AppConfig } from "../../src/config/index.js";

function makeConfig(): AppConfig {
  return {
    threads: { userId: "123456", apiBase: "https://graph.threads.net/v1.0", tokenR2Key: "x" },
  } as unknown as AppConfig;
}

describe("uploadImageForThreads (mocked storage.uploadBytes)", () => {
  let logger: RunLogger;
  beforeEach(() => {
    uploadBytesMock.mockReset();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as RunLogger;
  });

  it("returns the public URL uploadBytes produces, hosting the image under a throwaway threads/images/ key", async () => {
    uploadBytesMock.mockResolvedValueOnce({ publicUrl: "https://pub.example.com/threads/images/abc.jpg", provider: "r2" });
    const url = await uploadImageForThreads(makeConfig(), logger, Buffer.from("fake bytes"), "image/jpeg");
    expect(url).toBe("https://pub.example.com/threads/images/abc.jpg");
    const key = uploadBytesMock.mock.calls[0]![2] as string;
    expect(key).toMatch(/^threads\/images\/.+\.jpg$/);
  });

  it("returns null (never throws) when storage isn't configured, matching uploadBytes's own no-throw contract", async () => {
    uploadBytesMock.mockResolvedValueOnce({ publicUrl: null, provider: "r2", skippedReason: "missing storage credentials" });
    const url = await uploadImageForThreads(makeConfig(), logger, Buffer.from("fake bytes"), "image/png");
    expect(url).toBeNull();
  });
});

describe("postImageToThreads (mocked fetch, two-step container create + publish)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a media container then publishes it, returning the published post id", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "container-1" }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "post-1" }) });

    const postId = await postImageToThreads(makeConfig(), "token-abc", {
      imageUrl: "https://pub.example.com/poster.jpg",
      altText: "A great poster",
    });

    expect(postId).toBe("post-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createUrl = new URL((fetchMock.mock.calls[0]![0] as string));
    expect(createUrl.pathname).toBe("/v1.0/123456/threads");
    expect(createUrl.searchParams.get("image_url")).toBe("https://pub.example.com/poster.jpg");
    expect(createUrl.searchParams.get("alt_text")).toBe("A great poster");
    expect(createUrl.searchParams.get("media_type")).toBe("IMAGE");
    const publishUrl = new URL((fetchMock.mock.calls[1]![0] as string));
    expect(publishUrl.pathname).toBe("/v1.0/123456/threads_publish");
    expect(publishUrl.searchParams.get("creation_id")).toBe("container-1");
  });

  it("throws with Threads' own error message when container creation fails outright", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: "invalid image_url" } }) });

    await expect(
      postImageToThreads(makeConfig(), "token-abc", { imageUrl: "not-a-real-url", altText: "x" })
    ).rejects.toThrow("invalid image_url");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
