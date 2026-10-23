import type { ReactNode } from "react";
import { LocaleProvider } from "@/components/LocaleProvider";
export const metadata = { title: { default: "tokvilo — Find your next AI model", template: "%s · tokvilo" }, description: "Discover AI models by provider and family, compare versions and prices, and build with tokvilo." };
export default function EnglishLayout({ children }: { children: ReactNode }) { return <LocaleProvider locale="en">{children}</LocaleProvider>; }
