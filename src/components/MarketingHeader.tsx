"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";

export interface MarketingHeaderProps {
  isDefault?: boolean;
  brandName?: string;
  logoUrl?: string;
}

interface DropdownItem {
  label: string;
  href: string;
  description?: string;
}

interface NavDropdownProps {
  label: string;
  items: DropdownItem[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function NavDropdown({ label, items, isOpen, onToggle, onClose }: NavDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  return (
    <div className="nav-dropdown-wrapper" ref={dropdownRef}>
      <button
        className={`nav-dropdown-trigger ${isOpen ? "active" : ""}`}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        {label}
        <svg
          className={`nav-dropdown-chevron ${isOpen ? "rotated" : ""}`}
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
        >
          <path
            d="M1 1L5 5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isOpen && (
        <div className="nav-dropdown-menu">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nav-dropdown-item"
              onClick={onClose}
            >
              <span className="nav-dropdown-item-label">{item.label}</span>
              {item.description && (
                <span className="nav-dropdown-item-desc">{item.description}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const productItems: DropdownItem[] = [
  { label: "CLI", href: "/cli", description: "Command-line interface" },
  { label: "Technology", href: "/technology", description: "How vGPUs work" },
  { label: "How It Works", href: "/#how-it-works", description: "Platform overview" },
];

const solutionsItems: DropdownItem[] = [
  { label: "Use Cases", href: "/use-cases", description: "Real-world examples" },
  { label: "Bare Metal", href: "/clusters", description: "Dedicated clusters" },
  { label: "For Providers", href: "/for-providers", description: "List your GPUs" },
];

const aboutItems: DropdownItem[] = [
  { label: "About Us", href: "/about", description: "Our mission & team" },
  { label: "Blog", href: "/blog", description: "News & insights" },
  { label: "Contact", href: "/contact", description: "Get in touch" },
];

export default function MarketingHeader({ isDefault = true, brandName, logoUrl }: MarketingHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const toggleDropdown = (name: string) => {
    setOpenDropdown(openDropdown === name ? null : name);
  };

  const closeDropdown = () => setOpenDropdown(null);

  // White-label tenant header
  if (!isDefault) {
    return (
      <header className="header">
        <div className="container nav">
          <Link href="/" className="brand" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={brandName || "Home"}
                width={140}
                height={50}
                className="h-10 w-auto"
                unoptimized={logoUrl.startsWith("http")}
              />
            ) : (
              <span style={{ fontSize: 18, fontWeight: 700 }}>{brandName}</span>
            )}
          </Link>
          <nav className="nav-links">
            <Link href="/#pricing">Pricing</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/contact">Contact</Link>
          </nav>
          <div className="nav-actions">
            <Link href="/account" className="nav-login">Log in</Link>
            <Link href="/account" className="btn primary nav-cta">
              Get Started
            </Link>
            <Link
              href="/account"
              className="md:hidden text-sm font-medium text-[var(--foreground)] hover:text-[var(--blue)] transition-colors"
            >
              Log in
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="mobile-menu-btn"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="mobile-menu">
            <a href="/#pricing" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
            <Link href="/docs" onClick={() => setMobileMenuOpen(false)}>Docs</Link>
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)}>Contact</Link>
            <Link href="/account" onClick={() => setMobileMenuOpen(false)} className="mobile-login">Log in</Link>
          </div>
        )}
      </header>
    );
  }

  // Default GPU Cloud header
  return (
    <header className="header">
      <div className="container nav">
        <Link href="/" className="brand" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Image
            src="/packet-logo.png"
            alt="GPU Cloud"
            width={140}
            height={50}
            className="h-10 w-auto"
          />
          <span style={{
            fontSize: "9px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "2px 5px",
            borderRadius: "3px",
            background: "linear-gradient(135deg, #14b8a6, #0d9488)",
            color: "white",
            opacity: 0.7,
          }}>Beta</span>
        </Link>
        <nav className="nav-links">
          <Link href="/features">Features</Link>
          <NavDropdown
            label="Product"
            items={productItems}
            isOpen={openDropdown === "product"}
            onToggle={() => toggleDropdown("product")}
            onClose={closeDropdown}
          />
          <NavDropdown
            label="Solutions"
            items={solutionsItems}
            isOpen={openDropdown === "solutions"}
            onToggle={() => toggleDropdown("solutions")}
            onClose={closeDropdown}
          />
          <a href="/#pricing">Pricing</a>
          <NavDropdown
            label="About"
            items={aboutItems}
            isOpen={openDropdown === "about"}
            onToggle={() => toggleDropdown("about")}
            onClose={closeDropdown}
          />
        </nav>
        <div className="nav-actions">
          <Link href="/account" className="nav-login">Log in</Link>
          <Link href="/account" className="btn primary nav-cta">
            Start Building
          </Link>
          {/* Mobile login button - visible only on mobile */}
          <Link
            href="/account"
            className="md:hidden text-sm font-medium text-[var(--foreground)] hover:text-[var(--blue)] transition-colors"
          >
            Log in
          </Link>
          {/* Mobile burger button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="mobile-menu-btn"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="mobile-menu">
          <Link href="/features" onClick={() => setMobileMenuOpen(false)}>Features</Link>
          <div className="mobile-menu-section">
            <span className="mobile-menu-label">Product</span>
            <Link href="/cli" onClick={() => setMobileMenuOpen(false)}>CLI</Link>
            <Link href="/technology" onClick={() => setMobileMenuOpen(false)}>Technology</Link>
            <a href="/#how-it-works" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
          </div>
          <div className="mobile-menu-section">
            <span className="mobile-menu-label">Solutions</span>
            <Link href="/use-cases" onClick={() => setMobileMenuOpen(false)}>Use Cases</Link>
            <Link href="/clusters" onClick={() => setMobileMenuOpen(false)}>Bare Metal</Link>
            <Link href="/for-providers" onClick={() => setMobileMenuOpen(false)}>For Providers</Link>
          </div>
          <a href="/#pricing" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
          <div className="mobile-menu-section">
            <span className="mobile-menu-label">About</span>
            <Link href="/about" onClick={() => setMobileMenuOpen(false)}>About Us</Link>
            <Link href="/blog" onClick={() => setMobileMenuOpen(false)}>Blog</Link>
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)}>Contact</Link>
          </div>
          <Link href="/account" onClick={() => setMobileMenuOpen(false)} className="mobile-login">Log in</Link>
        </div>
      )}
      {/* Torn corner game link - hidden on mobile */}
      <Link href="/game" className="header-corner-game hidden md:flex" title="Play GPU Tetris!">
        <Image
          src="/gaming-icon.png"
          alt="Play Game"
          width={24}
          height={24}
          className="header-corner-icon"
        />
      </Link>
    </header>
  );
}
