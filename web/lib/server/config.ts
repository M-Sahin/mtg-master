import { DEMO_SEEDS } from "./demo";
import { SKILL_VERSION } from "../skill/content";
import { parseEngine, type EngineOptions } from "./engine";

function engineFromEnv(demo: boolean): EngineOptions {
  if (demo) return parseEngine("v1"); // the scripted demo follows the original flow
  try {
    return parseEngine(process.env.ENGINE);
  } catch (e) {
    console.warn(`${(e as Error).message} Falling back to v1.`);
    return parseEngine("v1");
  }
}

export function serverConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || "";
  // without a server key, builds run on the visitor's own key, or the scripted demo
  const demo = process.env.DEMO_MODE === "1" || !apiKey;
  const donation = process.env.DONATION_URL?.trim() || "";
  return {
    apiKey,
    demo,
    model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5",
    accessCode: process.env.ACCESS_CODE?.trim() || "",
    // Without an access code, anyone with the URL spends your API credits. Opt in explicitly.
    publicAccess: process.env.PUBLIC_ACCESS === "1",
    buildsPerHour: Math.max(1, Number(process.env.BUILDS_PER_HOUR_PER_IP) || 6),
    // visitors may use their own Claude API key (on unless OWN_KEYS=0)
    ownKeys: process.env.OWN_KEYS !== "0",
    ownKeyBuildsPerHour: Math.max(1, Number(process.env.OWN_KEY_BUILDS_PER_HOUR) || 20),
    donationUrl: /^https:\/\/[^\s"'<>]+$/.test(donation) ? donation : null,
    engine: engineFromEnv(demo),
    liveEngine: engineFromEnv(false),
  };
}

export interface PublicConfig {
  mode: "live" | "demo";
  /** Visitors can build with their own Claude API key. */
  ownKeys: boolean;
  donationUrl: string | null;
  model: string;
  skillVersion: string;
  accessCodeRequired: boolean;
  setupProblem: string | null;
  demoSeeds: string[];
}

export function publicConfig(): PublicConfig {
  const c = serverConfig();
  return {
    mode: c.demo ? "demo" : "live",
    ownKeys: c.ownKeys,
    donationUrl: c.donationUrl,
    model: c.demo ? "demo (scripted)" : c.model,
    skillVersion: SKILL_VERSION,
    accessCodeRequired: Boolean(c.accessCode) && !c.demo,
    setupProblem: !c.demo && !c.accessCode && !c.publicAccess ? "This deployment has an API key but no ACCESS_CODE. Set ACCESS_CODE (or PUBLIC_ACCESS=1 to allow anyone) in the Vercel project settings." : null,
    demoSeeds: DEMO_SEEDS,
  };
}
