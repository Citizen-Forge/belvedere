import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { LibrarySource } from "./types.js";

const execFileAsync = promisify(execFile);

function isLocalLocation(location: string): boolean {
  return location.startsWith("file://") || existsSync(location);
}

function cacheDirFor(source: LibrarySource): string {
  const hash = createHash("sha1").update(source.location).digest("hex").slice(0, 12);
  return join(tmpdir(), "belvedere", "library-cache", `${source.id}-${hash}`);
}

// Serializes concurrent checkouts of the same cache dir within this process
// (e.g. an overlapping manual + scheduled refresh) so two `git clone`/`fetch`
// calls never race against the same on-disk directory.
const inFlightCheckouts = new Map<string, Promise<string>>();

/**
 * Ensures a local, up-to-date checkout of a library source exists on disk and
 * returns its path. Local (file:// or bare path) sources are used in place;
 * remote git sources are shallow-cloned into a cache dir on first use and
 * pulled on subsequent calls.
 */
export async function checkoutSource(source: LibrarySource): Promise<string> {
  if (isLocalLocation(source.location)) {
    return source.location.startsWith("file://")
      ? fileURLToPath(source.location)
      : source.location;
  }

  const dir = cacheDirFor(source);
  const inFlight = inFlightCheckouts.get(dir);
  if (inFlight) return inFlight;

  const promise = checkoutRemote(source, dir).finally(() => {
    inFlightCheckouts.delete(dir);
  });
  inFlightCheckouts.set(dir, promise);
  return promise;
}

async function checkoutRemote(source: LibrarySource, dir: string): Promise<string> {
  const ref = source.ref ?? "HEAD";

  // Using `init` + `remote add` + `fetch <ref>` (rather than `clone --branch
  // <ref>`) works uniformly whether `ref` is a branch, a tag, or a commit —
  // `clone --branch` only accepts branches and tags.
  if (!existsSync(join(dir, ".git"))) {
    await execFileAsync("git", ["init", dir]);
    await execFileAsync("git", ["-C", dir, "remote", "add", "origin", source.location]);
  }

  await execFileAsync("git", ["-C", dir, "fetch", "--depth", "1", "origin", ref]);
  await execFileAsync("git", ["-C", dir, "reset", "--hard", "FETCH_HEAD"]);

  return dir;
}
