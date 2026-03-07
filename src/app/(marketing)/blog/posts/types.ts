/**
 * Blog Post Types
 *
 * Shared types for blog posts.
 *
 * @module blog/posts/types
 */

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  author: {
    name: string;
    role: string;
  };
  publishedAt: string;
  readingTime: string;
  category: string;
  featured?: boolean;
}
