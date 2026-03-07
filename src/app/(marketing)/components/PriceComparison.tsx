"use client";

import { useEffect, useState } from "react";

interface Competitor {
  name: string;
  price: number;
  isPacket?: boolean;
}

const PACKET_PRICE = 0.27;

const competitors: Competitor[] = [
  { name: "the platform", price: PACKET_PRICE, isPacket: true },
  { name: "Hyperstack", price: 1.26 },
  { name: "Sesterce", price: 1.38 },
  { name: "Verda", price: 1.39 },
  { name: "Exoscale", price: 2.00 },
  { name: "CoreWeave", price: 2.50 },
];

export function PriceComparison() {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setAnimated(true);
        }
      },
      { threshold: 0.2 }
    );

    const section = document.getElementById("price-comparison");
    if (section) observer.observe(section);

    return () => observer.disconnect();
  }, []);

  const maxPrice = Math.max(...competitors.map((c) => c.price));
  const sorted = [...competitors].sort((a, b) => a.price - b.price);

  return (
    <section id="price-comparison" className="comparison-section">
      <div className="container">
        <div className="comparison-header">
          <p className="comparison-label">RTX PRO 6000 Blackwell · 96 GB · 1× GPU</p>
          <h2 className="display comparison-title">
            The lowest price. <span className="gradient-text">By far.</span>
          </h2>
        </div>

        <div className="comparison-grid">
          {sorted.map((item, i) => {
            const width = (item.price / maxPrice) * 100;
            const savings = Math.round(((item.price - PACKET_PRICE) / item.price) * 100);

            return (
              <div
                key={item.name}
                className={`comparison-row ${item.isPacket ? "is-packet" : ""}`}
              >
                <div className="row-info">
                  <span className="provider-name">
                    {item.name}
                    {item.isPacket && <span className="packet-badge">You</span>}
                  </span>
                  <span className="provider-price">
                    ${item.price.toFixed(2)}
                    <span className="price-suffix">/hr</span>
                  </span>
                </div>

                <div className="bar-track">
                  <div
                    className={`bar-fill ${item.isPacket ? "packet-fill" : ""}`}
                    style={{
                      width: animated ? `${width}%` : "0%",
                      transitionDelay: `${i * 60}ms`
                    }}
                  />
                </div>

                <div className="row-savings">
                  {item.isPacket ? (
                    <span className="savings-you">Best price</span>
                  ) : (
                    <span className="savings-amount">+{savings}% more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="comparison-source">
          Source: <a href="https://getdeploying.com/gpus/nvidia-rtx-pro-6000" target="_blank" rel="noopener noreferrer">getdeploying.com</a>
        </p>
      </div>

      <style jsx>{`
        .comparison-section {
          padding: 64px 0;
          background: var(--ink);
          color: #ffffff;
        }

        .comparison-header {
          text-align: center;
          margin-bottom: 40px;
        }

        .comparison-label {
          font-size: 13px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.45);
          letter-spacing: 0.5px;
          margin: 0 0 12px;
        }

        .comparison-title {
          font-size: clamp(1.8rem, 3.5vw, 2.4rem);
          margin: 0;
          color: #ffffff;
        }

        .gradient-text {
          background: linear-gradient(135deg, #60a5fa 0%, var(--teal) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .comparison-grid {
          max-width: 700px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .comparison-row {
          display: grid;
          grid-template-columns: 140px 1fr 90px;
          align-items: center;
          gap: 16px;
          padding: 14px 20px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 12px;
          transition: all 0.2s ease;
        }

        .comparison-row:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.1);
        }

        .comparison-row.is-packet {
          background: rgba(26, 79, 255, 0.12);
          border-color: rgba(26, 79, 255, 0.25);
        }

        .row-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .provider-name {
          font-size: 15px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.7);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .is-packet .provider-name {
          color: #60a5fa;
        }

        .packet-badge {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--teal);
          background: rgba(24, 182, 168, 0.15);
          padding: 2px 6px;
          border-radius: 4px;
        }

        .provider-price {
          font-size: 20px;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.85);
        }

        .is-packet .provider-price {
          color: #60a5fa;
        }

        .price-suffix {
          font-size: 13px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.35);
        }

        .bar-track {
          height: 8px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 4px;
          overflow: hidden;
        }

        .bar-fill {
          height: 100%;
          background: linear-gradient(90deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.25) 100%);
          border-radius: 4px;
          transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .bar-fill.packet-fill {
          background: linear-gradient(90deg, var(--blue) 0%, var(--teal) 100%);
        }

        .row-savings {
          text-align: right;
        }

        .savings-you {
          font-size: 12px;
          font-weight: 600;
          color: var(--teal);
        }

        .savings-amount {
          font-size: 12px;
          font-weight: 500;
          color: #f87171;
          opacity: 0.9;
        }

        .comparison-source {
          text-align: center;
          margin-top: 24px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.3);
        }

        .comparison-source a {
          color: rgba(255, 255, 255, 0.5);
          text-decoration: none;
        }

        .comparison-source a:hover {
          color: var(--teal);
          text-decoration: underline;
        }

        @media (max-width: 600px) {
          .comparison-row {
            grid-template-columns: 110px 1fr 70px;
            gap: 12px;
            padding: 12px 16px;
          }

          .provider-price {
            font-size: 17px;
          }

          .bar-track {
            height: 6px;
          }

          .savings-amount,
          .savings-you {
            font-size: 11px;
          }
        }
      `}</style>
    </section>
  );
}
