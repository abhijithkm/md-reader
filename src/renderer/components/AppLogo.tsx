/** The app mark: a Markdown "M" with a downward arrow, as in the application icon. */
export function AppLogo({ size = 64 }: { size?: number }) {
  return (
    <svg
      className="app-logo"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="256" height="256" rx="56" fill="#0f6cbd" />
      <g fill="none" stroke="#ffffff" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round">
        <path d="M44 176V80l44 48 44-48v96" />
        <path d="M188 80v72M162 128l26 26 26-26" />
      </g>
    </svg>
  );
}
