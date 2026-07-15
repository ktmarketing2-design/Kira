import { logClientFailure } from "./errors.js";

const SOURCE = "lunarcrush";
const BASE_URL = "https://lunarcrush.com/api4/public/coins";

export type InfluencerSentiment = "Bullish" | "Neutral" | "Bearish";

export interface TopInfluencer {
  name: string;
  sentiment: InfluencerSentiment;
  followers: number;
}

export interface SocialInsights {
  mindshare: number;
  mindshareChange: number;
  sentiment: number; // 0-10
  galaxyScore: number; // 0-100
  altRank: number;
  topInfluencers: TopInfluencer[];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeSentimentLabel(value: unknown): InfluencerSentiment {
  const s = String(value ?? "").toLowerCase();
  if (s.includes("bull")) return "Bullish";
  if (s.includes("bear")) return "Bearish";
  return "Neutral";
}

/**
 * UNVERIFIED response shape. The provisioned LUNARCRUSH_API_KEY returns 402 "You must have an
 * active Individual or higher subscription to use this endpoint" on every endpoint tried
 * (confirmed the key itself is valid: an invalid key gets a 401 instead, this is a billing tier
 * issue on the account, not a bad key). Field extraction below is defensive on purpose, mapping
 * this feature's requested fields (mindshare, galaxyScore, etc.) to LunarCrush's likely v4 field
 * names (social_volume_24h / interactions_24h, galaxy_score, alt_rank, sentiment), with fallbacks
 * across a few plausible names per field. If the real shape differs once the subscription is
 * active, this fails soft (returns null) rather than crashing the DD card, adjust the field-name
 * candidates below once a real 200 response can be inspected.
 */
export async function getSocialInsights(symbol: string): Promise<SocialInsights | null> {
  const apiKey = process.env.LUNARCRUSH_API_KEY;
  if (!apiKey) {
    logClientFailure(SOURCE, new Error("LUNARCRUSH_API_KEY not set"));
    return null;
  }

  try {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(symbol)}/v1`, {
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      // Common and expected for brand-new memecoins with no social history yet (and, right now,
      // for the account's subscription tier), never treated as a hard failure.
      logClientFailure(SOURCE, new Error(`unexpected status ${res.status}`));
      return null;
    }

    const json = (await res.json()) as unknown;
    const data =
      json && typeof json === "object" && "data" in json
        ? (json as { data: unknown }).data
        : json;

    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;

    const mindshare = toNumber(d.mindshare ?? d.social_volume_24h ?? d.interactions_24h);
    const mindshareChange = toNumber(
      d.mindshareChange ?? d.social_volume_24h_change ?? d.percent_change_24h,
    );
    const sentiment = toNumber(d.sentiment);
    const galaxyScore = toNumber(d.galaxyScore ?? d.galaxy_score);
    const altRank = toNumber(d.altRank ?? d.alt_rank);

    // No data at all for this token, common for a token too new to have social history.
    if (mindshare == null && sentiment == null && galaxyScore == null && altRank == null) {
      return null;
    }

    const rawInfluencers = Array.isArray(d.topInfluencers ?? d.top_influencers)
      ? ((d.topInfluencers ?? d.top_influencers) as unknown[])
      : [];
    const topInfluencers: TopInfluencer[] = rawInfluencers
      .map((entry): TopInfluencer | null => {
        if (!entry || typeof entry !== "object") return null;
        const e = entry as Record<string, unknown>;
        const name = typeof e.name === "string" ? e.name : null;
        if (!name) return null;
        return {
          name,
          sentiment: normalizeSentimentLabel(e.sentiment),
          followers: toNumber(e.followers) ?? 0,
        };
      })
      .filter((x): x is TopInfluencer => x !== null);

    return {
      mindshare: mindshare ?? 0,
      mindshareChange: mindshareChange ?? 0,
      sentiment: sentiment ?? 0,
      galaxyScore: galaxyScore ?? 0,
      altRank: altRank ?? 0,
      topInfluencers,
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}
