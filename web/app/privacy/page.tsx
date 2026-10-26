import type { Metadata } from "next";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";

export const metadata: Metadata = { title: "Privacy · Hundredfoldz" };

// What the app stores, in plain words. The operator of a copy should check it matches their setup.
export default function Page() {
  return (
    <div className="app">
      <SiteHeader active={null} />
      <main className="account-page prose">
        <h1>Privacy</h1>
        <p>Hundredfoldz works without an account. This page says what it keeps, and where.</p>
        <h3>Without an account</h3>
        <ul>
          <li>Your decks, settings and (if you choose) your Claude API key are kept in your own browser. They aren&apos;t sent to us except to do what you ask, like building a deck.</li>
          <li>An API key you paste is sent with each build to make it, and is never stored on the server or in logs.</li>
          <li>Share links contain the deck. Short share links store the deck on our server so the link can open it.</li>
        </ul>
        <h3>With an account</h3>
        <ul>
          <li>We store your email address (or the name your Discord or Google login gives us) and the decks you save, in a Supabase database in the EU.</li>
          <li>Login uses cookies that are needed to keep you logged in. There are no tracking or advertising cookies.</li>
          <li>You can delete your account and all your decks at any time on the account page. It happens right away.</li>
        </ul>
        <h3>Services we use</h3>
        <ul>
          <li>Vercel hosts the site, with Vercel Web Analytics, which counts visits without cookies.</li>
          <li>Scryfall for card data and images, Commander Spellbook for combos, and Anthropic&apos;s Claude for building decks. Your deck requests go to Anthropic to be built.</li>
          <li>Supabase for accounts and saved decks.</li>
        </ul>
        <p>
          Questions or a request about your data: open an issue on <a href="https://github.com/M-Sahin/mtg-master/issues">GitHub</a>.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
