import { notFound } from "next/navigation";
import { BlogArticle } from "@/components/BlogArticle";
import { blogPageMetadata, blogPosts, getBlogPost } from "@/lib/blog";
type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return blogPosts.map(post => ({ slug: post.slug })); }
export async function generateMetadata({ params }: Props) {
  const post = getBlogPost((await params).slug);
  if (!post) notFound();
  return blogPageMetadata("zh", post);
}
export default async function BlogPostPage({ params }: Props) {
  const post = getBlogPost((await params).slug);
  if (!post) notFound();
  return <BlogArticle post={post} locale="zh" />;
}
