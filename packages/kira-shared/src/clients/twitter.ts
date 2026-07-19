import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "twitter";
const BASE_URL = "https://api.twitterapi.io";

// Free-tier hard limit is 1 request per 5 seconds (verified live: a second request inside that
// window returns 429 "For free-tier users, the QPS limit is one request every 5 seconds").
// Deliberately its own limiter, not shared with GMGN's -- these are two unrelated third-party
// APIs with unrelated quotas, and coupling them would make either one's throttling bleed into
// the other for no reason.
const limiter = new RateLimiter(1, 5_000);

function apiKey(): string {
  const key = process.env.TWITTER_API_KEY;
  if (!key) throw new KiraClientError(SOURCE, "TWITTER_API_KEY not set in environment");
  return key;
}

const authorSchema = z.object({
  userName: z.string(),
  id: z.string(),
  name: z.string().optional(),
  isVerified: z.boolean().optional(),
  isBlueVerified: z.boolean().optional(),
  followers: z.number().optional(),
});

const tweetSchema = z.object({
  id: z.string(),
  url: z.string().optional(),
  text: z.string(),
  retweetCount: z.number().optional(),
  replyCount: z.number().optional(),
  likeCount: z.number().optional(),
  viewCount: z.number().optional(),
  createdAt: z.string(),
  author: authorSchema.optional(),
});

export interface Tweet {
  id: string;
  url: string | null;
  text: string;
  retweetCount: number;
  replyCount: number;
  likeCount: number;
  viewCount: number;
  createdAt: string;
  authorUsername: string | null;
  authorFollowers: number | null;
}

function mapTweet(raw: z.infer<typeof tweetSchema>): Tweet {
  return {
    id: raw.id,
    url: raw.url ?? null,
    text: raw.text,
    retweetCount: raw.retweetCount ?? 0,
    replyCount: raw.replyCount ?? 0,
    likeCount: raw.likeCount ?? 0,
    viewCount: raw.viewCount ?? 0,
    createdAt: raw.createdAt,
    authorUsername: raw.author?.userName ?? null,
    authorFollowers: raw.author?.followers ?? null,
  };
}

const searchResponseSchema = z.object({
  tweets: z.array(tweetSchema),
  has_next_page: z.boolean().optional(),
});

/** Search recent tweets for a query (e.g. a token ticker or address). Verified live against
 * $BONK: GET /twitter/tweet/advanced_search?query=...&queryType=Latest returns
 * { tweets: Tweet[], has_next_page, next_cursor } at the top level. */
export async function searchTweets(query: string, limit = 20): Promise<Tweet[]> {
  await limiter.acquire();
  try {
    const url = `${BASE_URL}/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}&queryType=Latest`;
    const res = await fetch(url, { headers: { "X-API-Key": apiKey() } });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = searchResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `search response validation failed: ${parsed.error.message}`);
    }
    return parsed.data.tweets.slice(0, limit).map(mapTweet);
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

const userTweetsResponseSchema = z.object({
  data: z.object({
    tweets: z.array(tweetSchema),
  }),
});

/** Recent tweets from one user. Verified live against @elonmusk: GET
 * /twitter/user/last_tweets?userName=... returns { status, code, msg, data: { pin_tweet, tweets },
 * has_next_page, next_cursor } -- note has_next_page/next_cursor sit beside data, not inside it,
 * but this function only needs data.tweets. */
export async function getUserTweets(username: string, limit = 10): Promise<Tweet[]> {
  await limiter.acquire();
  try {
    const url = `${BASE_URL}/twitter/user/last_tweets?userName=${encodeURIComponent(username)}`;
    const res = await fetch(url, { headers: { "X-API-Key": apiKey() } });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = userTweetsResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `user-tweets response validation failed: ${parsed.error.message}`);
    }
    return parsed.data.data.tweets.slice(0, limit).map(mapTweet);
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

export interface TweetCountResult {
  count: number;
  isFloor: boolean; // true when the real total is >= count (has_next_page was true)
}

/** twitterapi.io has no dedicated count endpoint (verified live: GET /twitter/tweet/count
 * returns 404 "Not Found" on this plan). This returns how many results came back on the one
 * search page (capped at ~20 by the API itself) plus whether more exist, rather than fabricating
 * an exact 24h total the API doesn't provide. Callers must render isFloor results as "N+", never
 * as an exact count. */
export async function getTweetCount(query: string): Promise<TweetCountResult> {
  await limiter.acquire();
  try {
    const url = `${BASE_URL}/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}&queryType=Latest`;
    const res = await fetch(url, { headers: { "X-API-Key": apiKey() } });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = searchResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `count response validation failed: ${parsed.error.message}`);
    }
    return { count: parsed.data.tweets.length, isFloor: parsed.data.has_next_page === true };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return { count: 0, isFloor: false };
  }
}
