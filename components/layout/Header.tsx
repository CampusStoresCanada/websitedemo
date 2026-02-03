"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 h-16 bg-white border-b transition-shadow duration-200 ${
        isScrolled ? "shadow-sm border-[#E5E5E5]" : "border-transparent"
      }`}
    >
      <div className="h-full max-w-7xl mx-auto px-6 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-[#D60001] flex items-center justify-center">
            <span className="text-white font-bold text-sm">CSC</span>
          </div>
          <span className="font-semibold text-[#1A1A1A] hidden sm:block">
            Campus Stores Canada
          </span>
        </Link>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          <Link
            href="/"
            className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors"
          >
            Network
          </Link>
          <Link
            href="/about"
            className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors"
          >
            About
          </Link>
          <Link
            href="/partners"
            className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors"
          >
            Partners
          </Link>
          <Link
            href="/resources"
            className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors"
          >
            Resources
          </Link>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors"
          >
            Login
          </Link>
          <Link
            href="/join"
            className="h-8 px-4 bg-[#D60001] hover:bg-[#B00001] text-white text-sm font-medium rounded-md flex items-center transition-colors"
          >
            Join CSC
          </Link>
        </div>
      </div>
    </header>
  );
}
