// Known subscription merchants.
// `aliases` are matched (case-insensitively, on word boundaries) against the bank
// description; the longest matching alias wins, so "GOOGLE YOUTUBE" beats "GOOGLE".
export const MERCHANTS = [
  { id: "netflix", name: "Netflix", aliases: ["NETFLIX", "NETFLIX.COM"], category: "streaming", cancelUrl: "https://www.netflix.com/account" },
  { id: "spotify", name: "Spotify", aliases: ["SPOTIFY", "SPOTIFY AB"], category: "music", cancelUrl: "https://www.spotify.com/account/subscription/" },
  { id: "disney-plus", name: "Disney+", aliases: ["DISNEY PLUS", "DISNEYPLUS", "DISNEY+"], category: "streaming", cancelUrl: "https://www.disneyplus.com/account" },
  { id: "stan", name: "Stan", aliases: ["STAN.COM.AU", "STAN ENTERTAINMENT"], category: "streaming", cancelUrl: "https://www.stan.com.au/my-account" },
  { id: "binge", name: "Binge", aliases: ["BINGE", "STREAMOTION BINGE"], category: "streaming", cancelUrl: "https://binge.com.au/account" },
  { id: "kayo", name: "Kayo", aliases: ["KAYO", "STREAMOTION KAYO"], category: "streaming", cancelUrl: "https://kayosports.com.au/account" },
  { id: "youtube-premium", name: "YouTube Premium", aliases: ["YOUTUBE", "GOOGLE YOUTUBE", "YOUTUBEPREMIUM"], category: "streaming", cancelUrl: "https://www.youtube.com/paid_memberships" },
  { id: "amazon-prime", name: "Amazon Prime", aliases: ["AMAZON PRIME", "PRIME VIDEO", "AMZNPRIME"], category: "shopping", cancelUrl: "https://www.amazon.com.au/gp/primecentral" },
  { id: "apple", name: "Apple (iCloud / Apple One)", aliases: ["APPLE.COM/BILL", "APPLE.COM", "ITUNES"], category: "cloud", cancelUrl: "https://apps.apple.com/account/subscriptions" },
  { id: "google-one", name: "Google One", aliases: ["GOOGLE ONE", "GOOGLE STORAGE"], category: "cloud", cancelUrl: "https://one.google.com/settings" },
  { id: "microsoft-365", name: "Microsoft 365", aliases: ["MICROSOFT", "MSFT"], category: "software", cancelUrl: "https://account.microsoft.com/services" },
  { id: "adobe", name: "Adobe Creative Cloud", aliases: ["ADOBE", "ADOBE CREATIVE CLOUD"], category: "software", cancelUrl: "https://account.adobe.com/plans" },
  { id: "canva", name: "Canva", aliases: ["CANVA"], category: "software", cancelUrl: "https://www.canva.com/settings/billing-and-teams" },
  { id: "chatgpt-plus", name: "ChatGPT Plus", aliases: ["OPENAI", "CHATGPT"], category: "software", cancelUrl: "https://chatgpt.com/#settings/Subscription" },
  { id: "claude-pro", name: "Claude Pro", aliases: ["ANTHROPIC", "CLAUDE.AI"], category: "software", cancelUrl: "https://claude.ai/settings/billing" },
  { id: "duolingo", name: "Duolingo", aliases: ["DUOLINGO"], category: "education", cancelUrl: "https://www.duolingo.com/settings/subscription" },
  { id: "audible", name: "Audible", aliases: ["AUDIBLE"], category: "books", cancelUrl: "https://www.audible.com.au/account/overview" },
  { id: "uber-one", name: "Uber One", aliases: ["UBER ONE"], category: "delivery", cancelUrl: "https://www.uber.com/au/en/u/uber-one/" },
  { id: "anytime-fitness", name: "Anytime Fitness", aliases: ["ANYTIME FITNESS"], category: "gym", cancelUrl: "https://www.anytimefitness.com.au/" },
  { id: "fitness-first", name: "Fitness First", aliases: ["FITNESS FIRST"], category: "gym", cancelUrl: "https://www.fitnessfirst.com.au/" },
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// Pre-compile one word-boundary regex per alias, longest first.
const ALIAS_PATTERNS = MERCHANTS.flatMap((m) =>
  m.aliases.map((alias) => ({
    merchant: m,
    length: alias.length,
    re: new RegExp(`(^|[^A-Z0-9])${escapeRegex(alias)}($|[^A-Z0-9])`),
  }))
).sort((a, b) => b.length - a.length);

/** Returns the known merchant whose alias appears in `text` (uppercase), or null. */
export function matchMerchant(text) {
  const hit = ALIAS_PATTERNS.find((p) => p.re.test(text));
  return hit ? hit.merchant : null;
}
