// GET/POST /api/slain
// Global "money slain" counter shared by every player, stored in Netlify Blobs.
// Only anonymous totals are kept: no transactions, no merchant names, nothing per user.
import { getStore } from "@netlify/blobs";

const KEY = "stats";
const EMPTY = { totalSlainYearly: 0, zombiesSlain: 0 };
const MAX_RETRIES = 5;

const round2 = (n) => Math.round(n * 100) / 100;

export default async (req) => {
  const store = getStore({ name: "graveyard", consistency: "strong" });

  try {
    if (req.method === "GET") {
      const stats = (await store.get(KEY, { type: "json" })) ?? EMPTY;
      return Response.json(stats);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      const yearlyCost = Number(body?.yearlyCost);
      if (!Number.isFinite(yearlyCost) || yearlyCost <= 0 || yearlyCost >= 10000) {
        return Response.json({ error: "yearlyCost must be a positive number below 10,000." }, { status: 400 });
      }
      return Response.json(await addSlain(store, yearlyCost));
    }

    return Response.json({ error: "Use GET or POST." }, { status: 405 });
  } catch (err) {
    console.error("slain counter failed:", err.message);
    return Response.json({ error: "The graveyard ledger is unreadable right now." }, { status: 500 });
  }
};

/**
 * Adds one slain zombie to the totals with optimistic concurrency:
 * read the stats and their ETag, write only if nobody else changed them in between,
 * and retry if they did. Two players slaying at the same moment never lose a count.
 */
async function addSlain(store, yearlyCost) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const current = await store.getWithMetadata(KEY, { type: "json" });
    const stats = current?.data ?? EMPTY;
    const next = {
      totalSlainYearly: round2(stats.totalSlainYearly + yearlyCost),
      zombiesSlain: stats.zombiesSlain + 1,
    };
    const condition = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const { modified } = await store.setJSON(KEY, next, condition);
    if (modified) return next;
  }
  throw new Error("too much contention on the stats key");
}

export const config = { path: "/api/slain" };
