import Image from "next/image";
import Link from "next/link";
import { Metadata } from "next";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "Technology - How We Deliver GPU Performance at Lower Cost",
  description: "Learn how GPU Cloud delivers full NVIDIA GPU performance at up to 75% less. Intelligent scheduling, higher utilisation, no slicing or oversubscription.",
  alternates: {
    canonical: "https://example.com/technology",
  },
};

const FAQS = [
  { q: "How does GPU Cloud offer lower GPU prices?", a: "GPU Cloud uses dynamic placement technology that achieves higher GPU utilisation rates. Instead of treating a GPU as one-job-one-card, we schedule workloads based on real-time resource consumption, passing the efficiency gains to customers." },
  { q: "Does GPU sharing affect performance?", a: "No. Unlike oversubscription, GPU Cloud's scheduler co-locates only complementary workloads and enforces strict isolation. When contention would impact performance, workloads are moved automatically. From the user's perspective, it feels like a dedicated GPU." },
  { q: "How is this different from MIG or vGPU slicing?", a: "MIG and vGPU carve GPUs into fixed partitions regardless of actual workload needs. GPU Cloud dynamically allocates resources based on what your workload actually consumes in real time — VRAM, compute, bandwidth — without rigid partitions." },
  { q: "Is this suitable for production workloads?", a: "Yes. GPU Cloud prioritises predictable execution over raw density. All customers get a 99.9% SLA, and the platform is backed by 40+ engineers providing 24/7 support." },
];

export default function TechnologyPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "Technology", href: "/technology" }]} />
      {/* Hero Section */}
      <section className="hero" style={{ paddingTop: "80px", paddingBottom: "40px" }}>
        <div className="container">
          <div className="pill" style={{ marginBottom: "20px" }}>Technology</div>
          <h1 className="display" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", marginBottom: "24px", lineHeight: 1.15 }}>
            How We Deliver B200 Performance at $2/Hour
          </h1>
          <p style={{ fontSize: "1.15rem", lineHeight: 1.7, color: "var(--muted)" }}>
            GPU infrastructure has always been sold as if performance and price are opposing forces.
            the platform removes that false trade-off.
          </p>
        </div>
      </section>

      {/* Introduction */}
      <section style={{ padding: "48px 0" }}>
        <div className="container">
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "24px" }}>
            You either buy or rent dedicated GPUs and accept that large parts of the hardware will sit idle most of the time—or you oversubscribe aggressively and accept unpredictable performance, noisy neighbours, and brittle workloads.
          </p>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "24px" }}>
            Our GPU utilisation technology is designed around a simple observation: <strong>modern AI workloads rarely consume all aspects of a GPU at the same time</strong>. VRAM, compute, memory bandwidth, and interconnects are stressed differently depending on whether you&apos;re doing inference, fine-tuning, evaluation, or burst training.
          </p>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8 }}>
            Traditional infrastructure ignores this reality and prices GPUs as if they are a single, indivisible resource. They&apos;re not.
          </p>
        </div>
      </section>

      {/* Core Idea */}
      <section style={{ padding: "48px 0", background: "rgba(26, 79, 255, 0.03)" }}>
        <div className="container">
          <h2 className="display" style={{ fontSize: "clamp(1.6rem, 2.5vw, 2rem)", marginBottom: "24px" }}>
            The Core Idea
          </h2>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "24px" }}>
            Instead of treating a GPU as &ldquo;one job, one card&rdquo;, the platform allocates and schedules GPU resources based on what workloads actually consume in real time.
          </p>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "24px" }}>
            We track and manage GPU usage across multiple dimensions—not just whether a GPU is occupied, but <em>how</em> it is being used. This allows multiple compatible workloads to share the same physical hardware safely and predictably, without slicing the GPU into hard partitions or degrading performance.
          </p>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8 }}>
            The result is significantly higher utilisation of each GPU, while maintaining performance characteristics that feel close to dedicated infrastructure from the user&apos;s perspective.
          </p>
        </div>
      </section>

      {/* GPU Comparison Image */}
      <div className="container">
        <Image
          src="/gpu2a.png"
          alt="Standard GPU utilisation vs with the platform optimisation"
          width={1120}
          height={498}
          style={{ width: "100%", height: "auto" }}
        />
      </div>

      {/* Difference from Slicing */}
      <section style={{ padding: "48px 0" }}>
        <div className="container">
          <h2 className="display" style={{ fontSize: "clamp(1.6rem, 2.5vw, 2rem)", marginBottom: "24px" }}>
            How This Differs from Slicing and Oversubscription
          </h2>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "32px" }}>
            A lot of platforms claim &ldquo;sharing&rdquo;, but what they usually mean is one of two things:
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "24px",
              border: "1px solid var(--line)"
            }}>
              <h3 className="display" style={{ fontSize: "1.1rem", marginBottom: "12px", color: "var(--ink)" }}>
                Hard Slicing (MIG, vGPU)
              </h3>
              <p style={{ color: "var(--muted)", lineHeight: 1.7, margin: 0 }}>
                Technologies like MIG or vGPU carve a GPU into fixed partitions. This is simple, but inflexible. If your workload needs more VRAM but less compute, or vice versa, you&apos;re stuck paying for a shape that doesn&apos;t really fit.
              </p>
            </div>

            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "24px",
              border: "1px solid var(--line)"
            }}>
              <h3 className="display" style={{ fontSize: "1.1rem", marginBottom: "12px", color: "var(--ink)" }}>
                Oversubscription
              </h3>
              <p style={{ color: "var(--muted)", lineHeight: 1.7, margin: 0 }}>
                Multiple jobs are thrown onto the same GPU and hope for the best. This can look affordable on paper, but it creates unpredictable latency, throttling, and failure modes that are unacceptable for anything beyond experimentation.
              </p>
            </div>

            <div style={{
              background: "linear-gradient(135deg, rgba(26, 79, 255, 0.08), rgba(24, 182, 168, 0.08))",
              borderRadius: "12px",
              padding: "24px",
              border: "1px solid rgba(26, 79, 255, 0.2)"
            }}>
              <h3 className="display" style={{ fontSize: "1.1rem", marginBottom: "12px", color: "var(--blue)" }}>
                the platform: Dynamic Placement
              </h3>
              <p style={{ color: "var(--ink)", lineHeight: 1.7, margin: 0 }}>
                We dynamically place workloads based on live resource availability and workload profiles, enforcing isolation and fairness at the scheduler level rather than through rigid hardware partitions.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Performance */}
      <section style={{ padding: "48px 0", background: "rgba(0, 0, 0, 0.02)" }}>
        <div className="container">
          <h2 className="display" style={{ fontSize: "clamp(1.6rem, 2.5vw, 2rem)", marginBottom: "24px" }}>
            Why Performance Stays High
          </h2>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "24px" }}>
            Performance degradation usually happens when workloads compete for the same bottleneck at the same time.
          </p>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "24px" }}>
            Our scheduler is built to avoid exactly that. By understanding how different workloads stress the GPU, we can co-locate jobs that complement each other rather than collide. For example, a memory-heavy inference workload can run alongside a compute-heavy task without either seeing meaningful slowdown.
          </p>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "24px" }}>
            When contention would impact performance, workloads are moved or queued automatically. The system prioritises predictable execution over raw density.
          </p>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, fontStyle: "italic", color: "var(--muted)" }}>
            From the user&apos;s point of view, this feels like running on a well-behaved, dedicated GPU—not a noisy shared environment.
          </p>
        </div>
      </section>

      {/* Pricing Economics */}
      <section style={{ padding: "64px 0" }}>
        <div className="container">
          <h2 className="display" style={{ fontSize: "clamp(1.6rem, 2.5vw, 2rem)", marginBottom: "24px" }}>
            Why Pricing Becomes Dramatically Better
          </h2>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "24px" }}>
            Once you can safely drive higher utilisation, the economics change completely.
          </p>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "24px" }}>
            Traditional GPU pricing assumes low average utilisation, so prices have to cover idle time. the platform removes much of that waste. The same physical GPU can do more useful work per hour, which means the cost of that GPU can be spread across more customers without degrading their experience.
          </p>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.8, fontWeight: 500 }}>
            That&apos;s why the platform consistently delivers a better performance-to-price ratio than both hyperscale cloud GPUs and typical &ldquo;budget&rdquo; oversubscribed offerings.
          </p>
          <div style={{
            marginTop: "32px",
            padding: "20px 24px",
            background: "rgba(24, 182, 168, 0.1)",
            borderRadius: "12px",
            borderLeft: "4px solid var(--teal)"
          }}>
            <p style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.7 }}>
              <strong>You&apos;re not paying for idle silicon.</strong> You&apos;re paying for the resources your workload actually uses.
            </p>
          </div>
        </div>
      </section>

      {/* Win-Win Grid */}
      <section style={{ padding: "64px 0", background: "rgba(26, 79, 255, 0.03)" }}>
        <div className="container">
          <div className="section-title" style={{ textAlign: "center", marginBottom: "48px" }}>
            <h2 className="display" style={{ fontSize: "clamp(1.6rem, 2.5vw, 2rem)", marginBottom: "12px" }}>
              The Win for Everyone
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px" }}>
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "28px",
              border: "1px solid var(--line)"
            }}>
              <h3 className="display" style={{ fontSize: "1.15rem", marginBottom: "16px", color: "var(--blue)" }}>
                For Customers
              </h3>
              <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: "16px" }}>
                Access to high-end GPUs with pricing that makes sense beyond short experiments. Predictable performance, fast startup times, and the ability to scale without being forced into long commitments or inflated hourly rates.
              </p>
              <p style={{ color: "var(--ink)", lineHeight: 1.7, margin: 0, fontWeight: 500 }}>
                Workloads that would be uneconomical on dedicated GPUs suddenly become viable to run continuously.
              </p>
            </div>

            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "28px",
              border: "1px solid var(--line)"
            }}>
              <h3 className="display" style={{ fontSize: "1.15rem", marginBottom: "16px", color: "var(--teal)" }}>
                For Infrastructure Providers
              </h3>
              <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: "16px" }}>
                Higher utilisation means better returns on extremely expensive hardware. GPUs that would normally sit partially idle can now be monetised efficiently, without turning the platform into a support nightmare.
              </p>
              <p style={{ color: "var(--ink)", lineHeight: 1.7, margin: 0, fontWeight: 500 }}>
                Providers can offer competitive pricing while protecting margins, because the underlying economics finally work.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Summary */}
      <section style={{ padding: "64px 0" }}>
        <div className="container">
          <h2 className="display" style={{ fontSize: "clamp(1.6rem, 2.5vw, 2rem)", marginBottom: "32px" }}>
            Best of All Worlds
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px", marginBottom: "32px" }}>
            {[
              "Performance that feels close to dedicated GPUs",
              "Pricing that reflects real usage rather than worst-case assumptions",
              "Stability and isolation without rigid hardware slicing",
              "High utilisation without noisy-neighbour chaos"
            ].map((item, i) => (
              <div key={i} style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "16px 20px",
                background: "white",
                borderRadius: "10px",
                border: "1px solid var(--line)"
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" fill="rgba(26, 79, 255, 0.1)" />
                  <path d="M8 12L11 15L16 9" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: "1.05rem" }}>{item}</span>
              </div>
            ))}
          </div>

          <p style={{ fontSize: "1.15rem", lineHeight: 1.8, marginBottom: "24px" }}>
            That&apos;s what creates the true win-win. Customers get more compute for their money. Providers get healthier economics. And GPUs finally spend their time doing what they were bought for—<strong>useful work, not sitting idle</strong>.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "48px 0 80px" }}>
        <div className="cta-section">
          <h2 className="display" style={{ fontSize: "clamp(1.6rem, 2.5vw, 2rem)", marginBottom: "12px" }}>
            Ready to experience the difference?
          </h2>
          <p style={{ marginBottom: "24px", color: "var(--muted)" }}>
            Launch a B200 in minutes and see B200-class performance at $2/hour.
          </p>
          <div className="cta-row" style={{ justifyContent: "center" }}>
            <Link href="/checkout" className="btn primary">Get Started</Link>
            <Link href="/contact" className="btn ghost">Talk to Us</Link>
          </div>
        </div>
      </section>
    </>
  );
}
