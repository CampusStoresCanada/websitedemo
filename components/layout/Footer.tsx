import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="bg-white border-t border-[var(--border-subtle)]">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="mb-4">
              <Image
                src="/logos/csc-logo-horizontal-wordmark.svg"
                alt="Campus Stores Canada"
                width={210}
                height={62}
                className="h-7 w-auto"
              />
            </div>
            <p className="text-sm text-[var(--text-secondary)] max-w-sm">
              Connecting campus stores coast-to-coast with resources,
              partnerships, and expertise for over 30 years.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="font-semibold text-sm text-[var(--text-primary)] mb-4">Network</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                  Explore Members
                </Link>
              </li>
              <li>
                <Link href="/partners" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                  Our Partners
                </Link>
              </li>
              <li>
                <Link href="/join" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                  Join CSC
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-[var(--text-primary)] mb-4">Resources</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/about" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                  About CSC
                </Link>
              </li>
              <li>
                <a
                  href="https://campusstores.ca"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  campusstores.ca
                </a>
              </li>
              <li>
                <Link href="/contact" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-12 pt-8 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-[var(--text-tertiary)]">
            © {new Date().getFullYear()} Campus Stores Canada. All rights reserved.
          </p>
          <div className="flex gap-6">
            <Link href="/privacy" className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
