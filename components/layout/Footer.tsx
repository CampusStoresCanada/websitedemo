import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-white border-t border-[#E5E5E5]">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-md bg-[#D60001] flex items-center justify-center">
                <span className="text-white font-bold text-sm">CSC</span>
              </div>
              <span className="font-semibold text-[#1A1A1A]">
                Campus Stores Canada
              </span>
            </div>
            <p className="text-sm text-[#6B6B6B] max-w-sm">
              Connecting campus stores coast-to-coast with resources,
              partnerships, and expertise for over 30 years.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="font-semibold text-sm text-[#1A1A1A] mb-4">Network</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
                  Explore Members
                </Link>
              </li>
              <li>
                <Link href="/partners" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
                  Our Partners
                </Link>
              </li>
              <li>
                <Link href="/join" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
                  Join CSC
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-[#1A1A1A] mb-4">Resources</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/about" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
                  About CSC
                </Link>
              </li>
              <li>
                <a
                  href="https://campusstores.ca"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors"
                >
                  campusstores.ca
                </a>
              </li>
              <li>
                <Link href="/contact" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-12 pt-8 border-t border-[#E5E5E5] flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-[#9B9B9B]">
            © {new Date().getFullYear()} Campus Stores Canada. All rights reserved.
          </p>
          <div className="flex gap-6">
            <Link href="/privacy" className="text-sm text-[#9B9B9B] hover:text-[#6B6B6B] transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="text-sm text-[#9B9B9B] hover:text-[#6B6B6B] transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
