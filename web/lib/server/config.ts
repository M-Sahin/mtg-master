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
  };
}

export interface PublicConfig {
  mode: "live" | "demo";
  model: string;
  skillVersion: string;
  accessCodeRequired: boolean;
  demoSeeds: string[];
}

export function publicConfig(): PublicConfig {
  const c = serverConfig();
  return {
    mode: c.demo ? "demo" : "live",
    model: c.demo ? "demo (scripted)" : c.model,
    skillVersion: SKILL_VERSION,
    accessCodeRequired: Boolean(c.accessCode) && !c.demo,
    demoSeeds: DEMO_SEEDS,
  };
}
