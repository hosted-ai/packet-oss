"use client";

interface SectionHeaderProps {
  title: string;
}

export function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <h2 className="text-lg font-semibold text-[#0b0f1c] mb-4 flex items-center gap-2">
      {title}
    </h2>
  );
}
