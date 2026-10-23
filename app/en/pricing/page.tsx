import { PublicFooter } from "@/components/PublicFooter";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { PriceTable } from "@/components/PriceTable";
export const metadata = { title: "Pricing" };
export default function PricingPage() { return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><span className="landing-eyebrow">TOKVILO / PRICING</span><h1>Find the right model at the right price.</h1><p>Compare versions by provider and family. We reserve your balance before a request, settle confirmed usage, and release the remainder.</p><div className="landing-hero-actions"><a className="button button-primary" href="/dashboard/wallet?lang=en">Balance & top up ↗</a><Link className="button button-secondary" href="/en/billing">Payment options</Link></div></header><PriceTable /></main><PublicFooter /></div>; }
