import Link from "next/link";
import Image from "next/image";
import { getPlatformIdentity } from "@/lib/data";

export default async function Footer() {
  const identity = await getPlatformIdentity();
  const domainHref = identity.clientDomain ? `https://${identity.clientDomain}` : null;

  return (
    <footer className="bg-white border-t border-[var(--border-subtle)]">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="mb-4">
              <Image
                src={identity.logoUrl ?? "/logos/csc-logo-horizontal-wordmark.svg"}
                alt={identity.clientName}
                width={160}
                height={100}
                className="h-9 w-auto"
              />
            </div>
            <p className="text-sm text-[var(--text-secondary)] max-w-sm">
              Connecting {identity.clientName}&rsquo;s members and partners with
              resources, partnerships, and expertise.
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
                  Join {identity.clientShortName}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-[var(--text-primary)] mb-4">Resources</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/about" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                  About {identity.clientShortName}
                </Link>
              </li>
              <li>
                <Link href="/resources" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                  Resources
                </Link>
              </li>
              <li>
                <Link href="/playbook" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                  Partner Playbook
                </Link>
              </li>
              {domainHref ? (
                <li>
                  <a
                    href={domainHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {identity.clientDomain}
                  </a>
                </li>
              ) : null}
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
            © {new Date().getFullYear()} {identity.clientName}. All rights reserved.
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
