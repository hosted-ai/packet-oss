import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getPostBySlug, getAllPosts, type BlogPost } from "../posts";
import "../blog.css";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const posts = getAllPosts();
  return posts.map((post: BlogPost) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    return {
      title: "Post Not Found | GPU Cloud",
    };
  }

  return {
    title: `${post.title} | GPU Cloud Blog`,
    description: post.excerpt,
    openGraph: {
      title: `${post.title} | GPU Cloud Blog`,
      description: post.excerpt,
      type: "article",
      url: `https://your-domain.com/blog/${slug}`,
      publishedTime: post.publishedAt,
      authors: [post.author.name],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
    },
    alternates: {
      canonical: `https://your-domain.com/blog/${slug}`,
    },
  };
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    author: {
      "@type": "Person",
      name: post.author.name,
      jobTitle: post.author.role,
    },
    publisher: {
      "@type": "Organization",
      name: "GPU Cloud",
      url: "https://your-domain.com",
    },
    datePublished: post.publishedAt,
    mainEntityOfPage: `https://your-domain.com/blog/${slug}`,
    articleSection: post.category,
  };

  return (
    <article className="blog-article">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <div className="container">
        {/* Back link */}
        <Link href="/blog" className="blog-back">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Blog
        </Link>

        {/* Article header */}
        <header className="blog-header">
          <div className="blog-meta">
            <span className="blog-category">{post.category}</span>
            <span className="blog-date">{formatDate(post.publishedAt)}</span>
          </div>
          <h1 className="display blog-title">{post.title}</h1>
          <div className="blog-author-info">
            <div className="blog-author-details">
              <span className="blog-author-name">{post.author.name}</span>
              <span className="blog-author-role">{post.author.role}</span>
            </div>
            <span className="blog-reading-time">{post.readingTime}</span>
          </div>
        </header>

        {/* Article content */}
        <div className="blog-content prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
        </div>

        {/* Article footer */}
        <footer className="blog-footer">
          <Link href="/blog" className="blog-back-footer">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to all posts
          </Link>
        </footer>
      </div>
    </article>
  );
}
