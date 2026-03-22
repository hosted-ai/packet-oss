"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { getLogoUrl } from "@/lib/branding";

const gpuJokes = [
  "Looks like this page got lost in the tensor cores.",
  "Error: Page not found in VRAM. Have you tried adding more memory?",
  "This page is still training... ETA: undefined epochs.",
  "404: GPU cycles wasted looking for this page.",
  "The AI hallucinated this URL. It doesn't exist.",
  "This page is on a waitlist longer than H100 availability.",
  "Segmentation fault: Page ran out of CUDA memory.",
  "This page was deprecated faster than last year's GPU.",
];

export default function NotFound() {
  const [joke, setJoke] = useState(gpuJokes[0]);
  const [glitching, setGlitching] = useState(false);

  useEffect(() => {
    setJoke(gpuJokes[Math.floor(Math.random() * gpuJokes.length)]);
  }, []);

  const scrambleText = () => {
    setGlitching(true);
    let iterations = 0;
    const interval = setInterval(() => {
      setJoke(gpuJokes[Math.floor(Math.random() * gpuJokes.length)]);
      iterations++;
      if (iterations > 5) {
        clearInterval(interval);
        setGlitching(false);
      }
    }, 100);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 overflow-hidden relative">
      {/* Animated background grid */}
      <div className="absolute inset-0 overflow-hidden opacity-20">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(26, 79, 255, 0.3) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(26, 79, 255, 0.3) 1px, transparent 1px)`,
            backgroundSize: "50px 50px",
            animation: "grid-move 20s linear infinite",
          }}
        />
      </div>

      {/* Floating GPU particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute text-4xl opacity-10"
            style={{
              left: `${15 + i * 15}%`,
              top: `${20 + (i % 3) * 25}%`,
              animation: `float ${3 + i * 0.5}s ease-in-out infinite`,
              animationDelay: `${i * 0.3}s`,
            }}
          >
            🎮
          </div>
        ))}
      </div>

      <div className="relative z-10 text-center max-w-2xl">
        {/* Logo */}
        <Link href="/" className="inline-block mb-8 opacity-60 hover:opacity-100 transition-opacity">
          <Image
            src={getLogoUrl()}
            alt="Logo"
            width={120}
            height={40}
            className="h-8 w-auto invert"
          />
        </Link>

        {/* Giant 404 */}
        <div className="relative mb-6">
          <h1
            className="text-[12rem] font-black leading-none tracking-tighter"
            style={{
              background: "linear-gradient(135deg, #1a4fff 0%, #00d4ff 50%, #1a4fff 100%)",
              backgroundSize: "200% 200%",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              animation: "gradient-shift 3s ease infinite",
              textShadow: "0 0 80px rgba(26, 79, 255, 0.5)",
            }}
          >
            404
          </h1>
          <div
            className="absolute inset-0 text-[12rem] font-black leading-none tracking-tighter opacity-30 blur-xl"
            style={{
              background: "linear-gradient(135deg, #1a4fff, #00d4ff)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            404
          </div>
        </div>

        {/* Error message box */}
        <div className="bg-[#111] border border-[#222] rounded-lg p-6 mb-8 font-mono text-sm">
          <div className="flex items-center gap-2 mb-3 text-[#666]">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="w-3 h-3 rounded-full bg-green-500" />
            <span className="ml-2">gpu_exception.log</span>
          </div>
          <div className="text-left">
            <p className="text-red-400">
              <span className="text-[#666]">[ERROR]</span> PageNotFoundException
            </p>
            <p className="text-[#888] mt-2">
              <span className="text-[#666]">[INFO]</span>{" "}
              <span className={glitching ? "animate-pulse" : ""}>{joke}</span>
            </p>
            <p className="text-green-400 mt-2">
              <span className="text-[#666]">[HINT]</span> Try the homepage, it actually exists.
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/"
            className="px-8 py-3 bg-[#1a4fff] hover:bg-[#1238c9] text-white font-medium rounded-lg transition-all hover:scale-105"
          >
            Return to Homepage
          </Link>
          <button
            onClick={scrambleText}
            className="px-8 py-3 bg-[#1a1a1a] hover:bg-[#222] border border-[#333] text-white font-medium rounded-lg transition-all hover:scale-105"
          >
            Generate New Excuse
          </button>
        </div>

        {/* Fun stats */}
        <div className="mt-12 grid grid-cols-3 gap-6 text-center opacity-50">
          <div>
            <p className="text-2xl font-bold text-[#1a4fff]">0</p>
            <p className="text-xs text-[#666]">Pages found</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1a4fff]">∞</p>
            <p className="text-xs text-[#666]">GPUs still working</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1a4fff]">1</p>
            <p className="text-xs text-[#666]">Lost user (you)</p>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes grid-move {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(50px, 50px);
          }
        }
        @keyframes gradient-shift {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
        @keyframes float {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-20px) rotate(5deg);
          }
        }
      `}</style>
    </div>
  );
}
