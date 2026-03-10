interface BlurredFieldProps {
  /** Masked teaser value (e.g., "J. D.", "@school.ca") — shown with muted styling */
  maskedValue?: string | null;
  /** Placeholder dot width when no masked value (default: 8) */
  placeholderWidth?: number;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Low-level presentational component for rendering masked or hidden field values.
 *
 * - If maskedValue is provided: renders it with muted styling (intentionally readable)
 * - If no maskedValue: renders a dot-placeholder with CSS blur
 */
export default function BlurredField({
  maskedValue,
  placeholderWidth = 8,
  className,
}: BlurredFieldProps) {
  // Masked teaser — readable but muted (not blurred)
  if (maskedValue) {
    return (
      <span
        className={`text-gray-400 italic ${className ?? ""}`}
        title="Full details available to members"
      >
        {maskedValue}
      </span>
    );
  }

  // No masked value — blur-dot placeholder
  const placeholder = "\u2022".repeat(placeholderWidth);

  return (
    <span
      className={`select-none inline-block ${className ?? ""}`}
      style={{
        filter: "blur(4px)",
        color: "#9ca3af",
        letterSpacing: "0.1em",
      }}
      aria-hidden="true"
    >
      {placeholder}
    </span>
  );
}
