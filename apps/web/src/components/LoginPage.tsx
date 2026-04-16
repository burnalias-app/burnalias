import { FormEvent, useRef, useState } from "react";
import { fieldClassName, panelClassName } from "../lib/utils";

type LoginPageProps = {
  loginError: string | null;
  loginSubmitting: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
};

export function LoginPage({ loginError, loginSubmitting, onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const password = passwordRef.current?.value ?? "";
    await onLogin(username, password);
    if (passwordRef.current) {
      passwordRef.current.value = "";
    }
  }

  return (
    <main className="mx-auto box-border grid min-h-screen w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
      <section className="py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7a968]">BurnAlias</p>
        <h1 className="mt-4 max-w-xl font-serif text-4xl leading-none text-white sm:text-5xl lg:text-6xl">
          Alias management stays dark until you authenticate.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
          No alias data, provider settings, or forwarding targets are available before login.
        </p>
      </section>

      <section className={panelClassName("p-6 sm:p-8")}>
        <div className="mb-6">
          <h2 className="font-serif text-2xl text-white">Admin login</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Use the credentials configured with <code>BURN_USER</code> and <code>BURN_PASSWORD_HASH</code>.
          </p>
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Username</span>
            <input
              className={fieldClassName()}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Password</span>
            <input
              className={fieldClassName()}
              type="password"
              ref={passwordRef}
              autoComplete="current-password"
              required
            />
          </label>

          {loginError ? (
            <div className="rounded-[1.1rem] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {loginError}
            </div>
          ) : null}

          <button
            className="mt-2 rounded-[1.1rem] bg-linear-to-r from-[#c7924a] to-[#e0b777] px-5 py-3 font-semibold text-[#11161d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={loginSubmitting}
          >
            {loginSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
