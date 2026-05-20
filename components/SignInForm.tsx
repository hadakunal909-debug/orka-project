"use client";

import React, { useState } from "react";
import { Mail, Key, Loader2, AlertCircle } from "lucide-react";

export default function SignInForm({
  initialError,
}: {
  initialError: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter both email and password.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Sign-in failed.");
        setSubmitting(false);
        return;
      }
      // Full reload so the server picks up the new session cookie.
      window.location.href = "/dashboard";
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && (
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-xs animate-slideDown">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <div className="font-semibold">{error}</div>
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-soft uppercase tracking-wider">Email</span>
        <div className="relative group">
          <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute group-focus-within:text-primary transition-colors duration-200" />
          <input
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full pl-10 pr-3.5 py-3 rounded-xl border border-line bg-white/80 text-sm text-ink placeholder:text-mute/60 hover:border-slate-300 focus:border-primary focus:bg-white focus:shadow-glow transition-all duration-200"
          />
        </div>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-soft uppercase tracking-wider">Password</span>
        <div className="relative group">
          <Key size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute group-focus-within:text-primary transition-colors duration-200" />
          <input
            type={showPass ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full pl-10 pr-16 py-3 rounded-xl border border-line bg-white/80 text-sm text-ink placeholder:text-mute/60 hover:border-slate-300 focus:border-primary focus:bg-white focus:shadow-glow transition-all duration-200"
          />
          <button
            type="button"
            onClick={() => setShowPass((v) => !v)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10.5px] font-bold text-primary/70 hover:text-primary transition-colors"
          >
            {showPass ? "Hide" : "Show"}
          </button>
        </div>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="mt-1.5 flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-brand-grad text-white text-sm font-bold shadow-pop hover:shadow-neon hover:-translate-y-0.5 active:translate-y-0 active:shadow-soft transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-soft"
      >
        {submitting ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}
