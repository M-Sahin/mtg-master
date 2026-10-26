import App from "../components/App";

// /?opening=open&name=…: coming from My decks; the "Opening …" screen is rendered on the server
// too, so a slow phone doesn't show the setup page while the deck loads.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const kind = typeof q.opening === "string" && ["open", "rebuild", "upgrade"].includes(q.opening) ? (q.opening as "open" | "rebuild" | "upgrade") : null;
  const name = typeof q.name === "string" ? q.name.slice(0, 120) : "your deck";
  return <App opening={kind ? { kind, name } : null} />;
}
