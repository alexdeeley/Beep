import { Container, getContainer } from "@cloudflare/containers";

/**
 * The whole app (client, API, WebSocket server, SQLite file) runs unmodified
 * inside this container - the same Dockerfile used for any other deploy
 * target. This class is just Cloudflare's routing/lifecycle wrapper around
 * it, not a second implementation of anything.
 *
 * `max_instances: 1` in wrangler.jsonc plus the singleton id `getContainer()`
 * uses by default keeps this to exactly one canonical instance - matching
 * "one canonical wall," not a fleet of independent walls.
 */
export class WallContainer extends Container {
  defaultPort = 8787;
  // Sleep only after real inactivity - an open WebSocket connection counts as
  // in-flight for as long as it's open, so active drawers keep it warm.
  sleepAfter = "10m";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.WALL_CONTAINER);
    return container.fetch(request);
  },
};
