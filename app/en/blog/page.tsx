import { BlogIndex } from "@/components/BlogIndex";
import { blogPageMetadata } from "@/lib/blog";
export const metadata = blogPageMetadata("en");
export default function BlogPage() { return <BlogIndex locale="en" />; }
