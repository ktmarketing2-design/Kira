export type Launchpad =
  | "pumpfun"
  | "letsbonk"
  | "moonshot"
  | "bags"
  | "launchlab"
  | "believe"
  | "heavendex"
  | "raydium"
  | "unknown";

/**
 * Best-effort launchpad classification from the mint address suffix (a real Solana convention:
 * launchpads vanity-grind mint addresses to end in a recognizable suffix) and, where the suffix
 * is inconclusive, the DexScreener dexId of the token's most liquid pair.
 */
export function detectLaunchpad(mintAddress: string, dexId?: string, programId?: string): Launchpad {
  const lower = mintAddress.toLowerCase();

  if (lower.endsWith("pump")) return "pumpfun";
  if (lower.endsWith("bonk")) return "letsbonk";
  if (lower.endsWith("bags")) return "bags";

  const normalizedDexId = dexId?.toLowerCase();
  if (normalizedDexId === "moonshot") return "moonshot";
  if (normalizedDexId === "raydium-launchlab" || normalizedDexId === "launchlab") return "launchlab";
  if (normalizedDexId === "believe") return "believe";
  if (normalizedDexId === "heavendex" || normalizedDexId === "heaven") return "heavendex";
  if (normalizedDexId === "raydium" || normalizedDexId === "pumpswap") return "raydium";

  void programId; // reserved: token-program-based detection if a suffix/dexId match is ever needed

  return "unknown";
}
