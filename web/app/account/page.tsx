import type { Metadata } from "next";
import AccountPage from "../../components/AccountPage";

export const metadata: Metadata = { title: "Your account · Hundredfoldz", robots: { index: false } };

export default function Page() {
  return <AccountPage />;
}
