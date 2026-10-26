import { CREDIT_EXCHANGE_LABEL } from "@/lib/credits";
import { PublicFooter } from "@/components/PublicFooter";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { PriceTable } from "@/components/PriceTable";
export const metadata = { title: "Pricing" };
export default function PricingPage() { return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><span className="landing-eyebrow">TOKVILO / PRICING</span><h1>Find the right model at the right price.</h1><p>Compare versions by provider and family. API credits and their USD equivalent represent the same service balance, at a fixed {CREDIT_EXCHANGE_LABEL.en}. We reserve credits before a request, settle confirmed usage, and release the remainder.</p><div className="landing-hero-actions"><a className="button button-primary" href="/dashboard/wallet?lang=en">API credits & billing ↗</a><Link className="button button-secondary" href="/en/billing">Payment options</Link></div></header><PriceTable /></main><PublicFooter /></div>; }
