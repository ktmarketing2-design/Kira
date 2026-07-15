export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      LUNARCRUSH_API_KEY?: string;
    }
  }
}
