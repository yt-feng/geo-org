import { BlogIndex } from "@/components/BlogIndex";
import { blogPageMetadata } from "@/lib/blog";
export const metadata = blogPageMetadata("zh");
export default function BlogPage() { return <BlogIndex locale="zh" />; }
