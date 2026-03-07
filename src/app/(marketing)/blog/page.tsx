import Link from "next/link";
import { getAllPosts, type BlogPost } from "./posts";
import "./blog.css";

export const metadata = {
  title: "Blog - GPU Computing & AI Infrastructure Insights",
  description: "Expert insights on GPU cloud computing, AI infrastructure, LLM training, and high-performance computing. Practical guides from the GPU Cloud engineering team.",
  alternates: {
    canonical: "https://your-domain.com/blog",
  },
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogPage() {
  const posts = getAllPosts();
  const [latestPost, ...otherPosts] = posts;

  return (
    <>
      {/* Hero Section */}
      <section className="blog-hero">
        <div className="container">
          <div className="blog-hero-content">
            <h1 className="display">Blog</h1>
            <p>
              Insights on GPU computing, infrastructure, and building efficient AI workloads.
            </p>
          </div>
        </div>
      </section>

      {/* Latest Post */}
      {latestPost && (
        <section className="blog-featured">
          <div className="container">
            <Link href={`/blog/${latestPost.slug}`} className="blog-featured-card">
              <div className="blog-featured-content">
                <div className="blog-meta">
                  <span className="blog-category">{latestPost.category}</span>
                  <span className="blog-date">{formatDate(latestPost.publishedAt)}</span>
                </div>
                <h2 className="display blog-featured-title">{latestPost.title}</h2>
                <p className="blog-featured-excerpt">{latestPost.excerpt}</p>
                <div className="blog-author">
                  <span className="blog-author-name">{latestPost.author.name}</span>
                  <span className="blog-reading-time">{latestPost.readingTime}</span>
                </div>
              </div>
              <div className="blog-featured-arrow">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* Posts Grid */}
      <section className="blog-posts">
        <div className="container">
          <div className="blog-grid">
            {otherPosts.map((post: BlogPost) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="blog-card">
                <div className="blog-meta">
                  <span className="blog-category">{post.category}</span>
                  <span className="blog-date">{formatDate(post.publishedAt)}</span>
                </div>
                <h3 className="display blog-card-title">{post.title}</h3>
                <p className="blog-card-excerpt">{post.excerpt}</p>
                <div className="blog-author">
                  <span className="blog-author-name">{post.author.name}</span>
                  <span className="blog-reading-time">{post.readingTime}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
