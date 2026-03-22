"use client";

import Image from "next/image";
import { type CSSProperties } from "react";

interface BrandLogoProps {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Brand logo image that bypasses Next.js image optimization.
 * Branding images are already processed by the upload endpoint,
 * and may be SVG which the optimization pipeline doesn't handle well.
 */
export function BrandLogo({ src, alt = "Logo", width = 140, height = 50, className, style }: BrandLogoProps) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={style}
      unoptimized
    />
  );
}
