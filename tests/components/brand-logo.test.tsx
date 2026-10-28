// @vitest-environment jsdom
//
// PA-287: unit coverage for BrandLogo (src/components/BrandLogo.tsx). A thin
// wrapper over next/image that forces `unoptimized` and applies sensible
// default width/height/alt. next/image is mocked to a plain <img> so we can
// assert the props that flow through.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next/image renders a complex client component; stub it to a plain <img>
// that forwards the props BrandLogo cares about.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    width,
    height,
    className,
    unoptimized,
  }: {
    src: string;
    alt: string;
    width?: number;
    height?: number;
    className?: string;
    unoptimized?: boolean;
  }) => (
     
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      data-unoptimized={unoptimized ? "true" : "false"}
    />
  ),
}));

import { BrandLogo } from "@/components/BrandLogo";

describe("BrandLogo", () => {
  it("renders an image with the given src", () => {
    render(<BrandLogo src="/logo.svg" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "/logo.svg");
  });

  it("defaults the alt text to 'Logo'", () => {
    render(<BrandLogo src="/logo.svg" />);
    expect(screen.getByAltText("Logo")).toBeInTheDocument();
  });

  it("uses the provided alt text when supplied", () => {
    render(<BrandLogo src="/logo.svg" alt="Acme Corp" />);
    expect(screen.getByAltText("Acme Corp")).toBeInTheDocument();
  });

  it("applies the default width and height", () => {
    render(<BrandLogo src="/logo.svg" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("width", "140");
    expect(img).toHaveAttribute("height", "50");
  });

  it("honors custom dimensions and className", () => {
    render(
      <BrandLogo src="/logo.svg" width={200} height={80} className="my-logo" />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("width", "200");
    expect(img).toHaveAttribute("height", "80");
    expect(img).toHaveClass("my-logo");
  });

  it("always requests the unoptimized rendering path", () => {
    render(<BrandLogo src="/logo.svg" />);
    expect(screen.getByRole("img")).toHaveAttribute("data-unoptimized", "true");
  });
});
