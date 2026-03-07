"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import type { GpuOffering, CarouselSettings } from "@/app/admin/types";

interface GPUCarouselProps {
  offerings: GpuOffering[];
  carouselSettings: CarouselSettings;
  email?: string;
  onEmailChange?: (email: string) => void;
  emailTouched?: boolean;
  onEmailBlur?: () => void;
  showEmailError?: boolean;
  billingType: "hourly" | "monthly";
  onBillingTypeChange: (type: "hourly" | "monthly") => void;
  loading?: boolean;
  onSubmit?: (e?: React.FormEvent) => void;
}

export function GPUCarousel({
  offerings,
  carouselSettings,
  email,
  onEmailChange,
  emailTouched,
  onEmailBlur,
  showEmailError,
  billingType,
  onBillingTypeChange,
  loading,
  onSubmit,
}: GPUCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const activeOfferings = offerings.filter((o) => o.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const currentOffering = activeOfferings[currentIndex] || activeOfferings[0];

  // Auto-rotate carousel
  useEffect(() => {
    if (isPaused || activeOfferings.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % activeOfferings.length);
    }, carouselSettings.autoRotateMs);

    return () => clearInterval(interval);
  }, [isPaused, activeOfferings.length, carouselSettings.autoRotateMs]);

  const goToSlide = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + activeOfferings.length) % activeOfferings.length);
  }, [activeOfferings.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % activeOfferings.length);
  }, [activeOfferings.length]);

  if (!currentOffering) {
    return null;
  }

  const hero = currentOffering.hero;
  const hourlyPrice = currentOffering.hourlyPrice;
  const monthlyPrice = Math.round(hourlyPrice * 730);

  return (
    <section
      className="hero"
      onMouseEnter={() => carouselSettings.pauseOnHover && setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="container hero-grid">
        <div className="hero-copy">
          <div className="pill">{hero.pill}</div>
          <h1 className="display">
            {hero.headline}
            <span className="subhead">{hero.subhead}</span>
          </h1>
          <p>{hero.description}</p>

          {/* CTA */}
          <div className="signup-form">
            <div className="cta-row" style={{ gap: "12px", marginTop: "4px" }}>
              <a
                href={`/account?gpu=${currentOffering.id}&plan=hourly`}
                className="btn primary"
                style={{ padding: "14px 32px", fontSize: "15px" }}
              >
                Start Free — No Credit Card
              </a>
            </div>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "10px" }}>
              Pay as you go. Free account includes 10,000 API tokens.
            </p>
          </div>

          <div className="signal-row">
            {hero.signals.map((signal, index) => (
              <div key={index}>{signal}</div>
            ))}
          </div>
        </div>

        <div className="hero-media">
          {/* Left Arrow */}
          {activeOfferings.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                goToPrevious();
              }}
              className="carousel-arrow carousel-arrow-prev"
              aria-label="Previous GPU"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
          )}

          <div className="hero-frame">
            {currentOffering.image && (
              <Image
                src={currentOffering.image}
                alt={currentOffering.fullName}
                width={650}
                height={450}
                priority
                unoptimized
              />
            )}
          </div>
          <div className="hero-shadow"></div>

          {/* Right Arrow */}
          {activeOfferings.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                goToNext();
              }}
              className="carousel-arrow carousel-arrow-next"
              aria-label="Next GPU"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          )}

        </div>
      </div>
    </section>
  );
}
