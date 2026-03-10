import Link from "next/link";

export default function AuthCodeErrorPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          Authentication Error
        </h1>
        <p className="text-gray-600 mb-8">
          We couldn&apos;t verify your login link. It may have expired or already
          been used. Please try signing in again.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center px-6 py-2.5 bg-[#D60001] text-white text-sm font-medium rounded-lg hover:bg-[#B00001] transition-colors"
        >
          Back to Login
        </Link>
      </div>
    </div>
  );
}
