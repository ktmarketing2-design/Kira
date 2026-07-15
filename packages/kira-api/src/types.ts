export type KiraTier = "scout" | "pro" | "elite" | "studio";

export interface KiraProfile {
  id: string;
  telegram_user_id: number | null;
  telegram_username: string | null;
  tier: KiraTier;
  tier_expires_at: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email?: string };
      userTier?: KiraTier;
      profile?: KiraProfile;
    }
  }
}

export {};
