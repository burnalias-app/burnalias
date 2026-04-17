type RefreshButtonProps = {
  loading: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
  iconClassName?: string;
};

export function RefreshButton({
  loading,
  onClick,
  label,
  disabled = false,
  className = "",
  iconClassName = "h-5 w-5"
}: RefreshButtonProps) {
  return (
    <button
      type="button"
      className={[
        "inline-flex h-8 w-8 shrink-0 items-center justify-center text-zinc-400 transition hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-45",
        className
      ].join(" ").trim()}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={loading ? `${label}ing` : label}
      title={loading ? `${label}ing` : label}
    >
      <svg
        className={`${iconClassName} ${loading ? "animate-spin" : ""}`.trim()}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}
