import { DEMO_SEEDS } from "./demo";
import { SKILL_VERSION } from "../skill/content";

export function serverConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || "";
  const demo = process.env.DEMO_MODE === "1" || !apiKey;
  return {
    apiKey,
    demo,
    model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5",
    accessCode: process.env.ACCESS_CODE?.trim() || "",
    // Without an access code, anyone with the URL spends your API credits. Opt in explicitly.
    publicAccess: process.env.PUBLIC_ACCESS === "1",
    buildsPerHour: Math.max(1, Number(process.env.BUILDS_PER_HOUR_PER_IP) || 6),
  };
}

export interface PublicConfig {
  mode: "live" | "demo";
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
    model: c.demo ? "demo (scripted)" : c.model,
    skillVersion: SKILL_VERSION,
    accessCodeRequired: Boolean(c.accessCode) && !c.demo,
    setupProblem: !c.demo && !c.accessCode && !c.publicAccess ? "This deployment has an API key but no ACCESS_CODE. Set ACCESS_CODE (or PUBLIC_ACCESS=1 to allow anyone) in the Vercel project settings." : null,
    demoSeeds: DEMO_SEEDS,
  };
}
