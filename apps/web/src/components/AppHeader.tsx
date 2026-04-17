import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import logo from "../logo.png";
import { SessionState } from "../api";

type ViewMode = "dashboard" | "settings" | "jobs";

type AppHeaderProps = {
  session: SessionState;
  accountMenuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onNavigate: (view: ViewMode) => void;
  onLogout: () => void;
  activeView: ViewMode;
};

export function AppHeader({ session, accountMenuOpen, onMenuToggle, onMenuClose, onNavigate, onLogout, activeView }: AppHeaderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        onMenuClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [accountMenuOpen, onMenuClose]);

  return (
    <header className="mb-5 grid gap-4 sm:mb-6">
      <div className="flex items-center justify-between gap-4">
        <Link to="/dashboard" className="flex items-center gap-3">
          <img
            src={logo}
            alt="BurnAlias logo"
            className="h-12 w-12 rounded-2xl object-cover shadow-[0_12px_30px_rgba(0,0,0,0.28)]"
          />
          <p className="text-lg font-semibold uppercase tracking-[0.18em] text-[#d7a968] sm:text-xl">BurnAlias</p>
        </Link>

        <div ref={containerRef} className="relative lg:hidden">
          <div className="w-full sm:w-auto lg:hidden">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-[1.1rem] border border-white/10 bg-[#10161f]/88 px-4 py-3 text-left shadow-[0_20px_50px_rgba(0,0,0,0.28)] backdrop-blur sm:min-w-40"
              onClick={onMenuToggle}
            >
              <span className="grid min-w-0 flex-1">
                <strong className="truncate text-sm text-white">Menu</strong>
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
          </div>

          {accountMenuOpen ? (
            <div className="absolute right-0 z-10 mt-2 w-full overflow-hidden rounded-[1.1rem] border border-white/10 bg-[#0f141c]/96 shadow-[0_24px_64px_rgba(0,0,0,0.38)] sm:w-64 lg:w-56">
              <button
                type="button"
                className={[
                  "block w-full px-4 py-3 text-left text-sm transition hover:bg-white/5",
                  activeView === "dashboard" ? "bg-white/5 text-white" : "text-white"
                ].join(" ")}
                onClick={() => onNavigate("dashboard")}
              >
                Dashboard
              </button>
              <button
                type="button"
                className={[
                  "block w-full px-4 py-3 text-left text-sm transition hover:bg-white/5",
                  activeView === "jobs" ? "bg-white/5 text-white" : "text-white"
                ].join(" ")}
                onClick={() => onNavigate("jobs")}
              >
                Jobs
              </button>
              <button
                type="button"
                className={[
                  "block w-full px-4 py-3 text-left text-sm transition hover:bg-white/5",
                  activeView === "settings" ? "bg-white/5 text-white" : "text-white"
                ].join(" ")}
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
      </div>

      <nav className="hidden lg:block">
        <div className="flex items-center justify-between gap-4 rounded-[1.2rem] border border-white/10 bg-[#10161f]/88 px-2 py-2 shadow-[0_20px_50px_rgba(0,0,0,0.28)] backdrop-blur">
          <div className="inline-flex items-center gap-1">
            {(["dashboard", "jobs", "settings"] as ViewMode[]).map((view) => (
              <button
                key={view}
                type="button"
                className={[
                  "rounded-[0.95rem] px-4 py-3 text-sm transition",
                  activeView === view
                    ? "bg-[#e7edf5] text-[#121822]"
                    : "text-slate-200 hover:bg-white/5"
                ].join(" ")}
                onClick={() => onNavigate(view)}
              >
                {view[0].toUpperCase() + view.slice(1)}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="rounded-[0.95rem] px-4 py-3 text-sm text-red-200 transition hover:bg-white/5"
            onClick={onLogout}
          >
            Log out
          </button>
        </div>
      </nav>
    </header>
  );
}
