import { useEffect, useRef } from "react";
import logo from "../logo.png";
import { SessionState } from "../api";

type ViewMode = "dashboard" | "settings" | "jobs";

type AppHeaderProps = {
  session: SessionState;
  accountMenuOpen: boolean;
  onMenuToggle: () => void;
  onNavigate: (view: ViewMode) => void;
  onLogout: () => void;
};

export function AppHeader({ session, accountMenuOpen, onMenuToggle, onNavigate, onLogout }: AppHeaderProps) {
  const initial = (session.user?.username ?? "A").slice(0, 1).toUpperCase();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        onMenuToggle();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [accountMenuOpen, onMenuToggle]);

  return (
    <header className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <img
          src={logo}
          alt="BurnAlias logo"
          className="h-12 w-12 rounded-2xl object-cover shadow-[0_12px_30px_rgba(0,0,0,0.28)]"
        />
        <p className="text-lg font-semibold uppercase tracking-[0.18em] text-[#d7a968] sm:text-xl">BurnAlias</p>
      </div>

      <div ref={containerRef} className="relative w-full sm:w-auto">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-[1.1rem] border border-white/10 bg-[#10161f]/88 px-3 py-3 text-left shadow-[0_20px_50px_rgba(0,0,0,0.28)] backdrop-blur sm:min-w-64"
          onClick={onMenuToggle}
        >
          <span className="grid h-10 w-10 place-items-center rounded-full bg-linear-to-br from-[#d7a968] to-[#9c7137] font-semibold text-[#11161d]">
            {initial}
          </span>
          <span className="grid min-w-0 flex-1">
            <strong className="truncate text-sm text-white">{session.user?.username ?? "configured"}</strong>
            <small className="text-xs text-slate-400">Administrator</small>
          </span>
          <span
            aria-hidden="true"
            className={["inline-block text-slate-400 transition-transform duration-200", accountMenuOpen ? "rotate-180" : ""].join(" ")}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current">
              <path d="M5.47 7.97a.75.75 0 0 1 1.06 0L10 11.44l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </span>
        </button>

        {accountMenuOpen ? (
          <div className="absolute right-0 z-10 mt-2 w-full overflow-hidden rounded-[1.1rem] border border-white/10 bg-[#0f141c]/96 shadow-[0_24px_64px_rgba(0,0,0,0.38)] sm:w-64">
            <button
              type="button"
              className="block w-full px-4 py-3 text-left text-sm text-white transition hover:bg-white/5"
              onClick={() => onNavigate("dashboard")}
            >
              Dashboard
            </button>
            <button
              type="button"
              className="block w-full px-4 py-3 text-left text-sm text-white transition hover:bg-white/5"
              onClick={() => onNavigate("jobs")}
            >
              Jobs
            </button>
            <button
              type="button"
              className="block w-full px-4 py-3 text-left text-sm text-white transition hover:bg-white/5"
              onClick={() => onNavigate("settings")}
            >
              Settings
            </button>
            <button
              type="button"
              className="block w-full px-4 py-3 text-left text-sm text-red-200 transition hover:bg-white/5"
              onClick={onLogout}
            >
              Log out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
