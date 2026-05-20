import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import SignInForm from "@/components/SignInForm";

export default async function HomePage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (user) redirect("/dashboard");

  const hasGoogle = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const isDev = process.env.NODE_ENV !== "production";

  // In dev mode, fetch existing users so we can show a quick switcher
  let devUsers: { id: string; email: string; name: string | null; role: string }[] = [];
  if (isDev && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("users")
        .select("id, email, name, role")
        .order("created_at", { ascending: true });
      devUsers = data ?? [];
    } catch { /* ignore */ }
  }

  const errorMessages: Record<string, string> = {
    domain_not_allowed: "Sign-in is restricted to your organization's Google Workspace domain.",
    no_code: "Authorization was cancelled.",
    email_unverified: "Your Google email address must be verified.",
    provision_failed: "Could not create your account. Please contact support.",
    signin_failed: "Invalid email or password.",
    dev_signin_failed: "Dev sign-in failed. Check the server logs for details.",
    rate_limited: "Too many attempts. Please wait a moment and try again.",
    invalid_state: "Sign-in was interrupted or expired. Please try again.",
    oauth_error: "Google sign-in was denied or cancelled.",
  };

  const initialError = searchParams.error && errorMessages[searchParams.error]
    ? errorMessages[searchParams.error]
    : null;

  return (
    <main className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #EFF6FF 0%, #E0F2FE 40%, #F0F9FF 70%, #F8FAFC 100%)" }}>
      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-30 blur-3xl animate-float"
          style={{ background: "radial-gradient(circle, #93C5FD 0%, transparent 70%)", animationDuration: "8s" }} />
        <div className="absolute top-1/3 -right-24 w-80 h-80 rounded-full opacity-25 blur-3xl animate-float"
          style={{ background: "radial-gradient(circle, #7DD3FC 0%, transparent 70%)", animationDelay: "2s", animationDuration: "10s" }} />
        <div className="absolute -bottom-24 left-1/3 w-72 h-72 rounded-full opacity-20 blur-3xl animate-float"
          style={{ background: "radial-gradient(circle, #BFDBFE 0%, transparent 70%)", animationDelay: "4s", animationDuration: "12s" }} />
        {/* Subtle grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #2563EB 1px, transparent 0)", backgroundSize: "32px 32px" }} />
      </div>

      <div className="max-w-md w-full relative z-10 animate-slideUp">
        {/* Logo + Branding */}
        <div className="flex items-center gap-3.5 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-pop relative group ring-1 ring-primary/10">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10">
              {/* Orka swoosh: blue 3/4 ring + dark fin */}
              <path d="M16 4 A12 12 0 1 0 26.4 22.4" stroke="#2563EB" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              <path d="M16 4 A12 12 0 0 1 24 7.5" stroke="#0EA5E9" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              <path d="M14.5 1 L22 5 L17.5 9 Z" fill="#0F172A" />
            </svg>
            <div className="absolute inset-0 rounded-2xl bg-brand-grad opacity-0 group-hover:opacity-20 blur-lg transition-opacity duration-500" />
          </div>
          <div>
            <div className="font-extrabold text-xl leading-tight tracking-tight text-ink">Orka Project</div>
            <div className="text-xs text-soft font-medium tracking-wide">Plan. Execute. Deliver.</div>
          </div>
        </div>

        <h1 className="text-[32px] font-extrabold tracking-tight mb-2 text-ink leading-none">Welcome back</h1>
        <p className="text-soft text-sm mb-7 leading-relaxed">
          Sign in to your workspace. New accounts are provisioned by your admin.
        </p>

        {/* Sign-in card with glass effect */}
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white/60 shadow-float p-7"
          style={{ boxShadow: "0 20px 48px -12px rgba(37,99,235,0.10), 0 8px 16px -8px rgba(15,23,42,0.06), 0 0 0 1px rgba(255,255,255,0.6) inset" }}>
          <SignInForm initialError={initialError} />

          {hasGoogle && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
                <span className="text-[10.5px] text-mute font-semibold uppercase tracking-wider">or</span>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
              </div>
              <a
                href="/api/auth/google/signin"
                className="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-xl bg-white border border-line hover:border-ink hover:shadow-md text-ink text-sm font-semibold transition-all duration-200"
              >
                <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                Sign in with Google
              </a>
            </>
          )}
        </div>

        {isDev && devUsers.length > 0 && (
          <details className="mt-5 bg-white/50 backdrop-blur-sm rounded-2xl border border-white/60 shadow-subtle p-4 text-xs group">
            <summary className="font-semibold text-soft cursor-pointer select-none flex items-center gap-2 hover:text-primary transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-mute group-open:text-primary transition-colors">
                <path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
              </svg>
              Dev quick-switch ({devUsers.length} seeded users)
            </summary>
            <div className="mt-3 flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {devUsers.map((u) => (
                <form key={u.id} action="/api/auth/dev-signin" method="POST">
                  <input type="hidden" name="email" value={u.email} />
                  <button
                    type="submit"
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/70 border border-line hover:border-primary/40 hover:bg-white hover:shadow-soft transition-all duration-200 text-left group/btn"
                  >
                    <div className="w-8 h-8 rounded-xl bg-brand-grad flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0 shadow-sm group-hover/btn:shadow-pop transition-shadow">
                      {(u.name || u.email)[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[12px] text-ink truncate">{u.name || u.email}</div>
                      <div className="text-[10.5px] text-soft truncate">{u.email}</div>
                    </div>
                    <span className="text-[9px] font-bold uppercase tracking-wide text-mute px-1.5 py-0.5 rounded-md bg-bg">{u.role}</span>
                  </button>
                </form>
              ))}
            </div>
          </details>
        )}

        {/* Footer branding */}
        <div className="mt-8 text-center text-[11px] text-mute/60 font-medium">
          Part of the Orka suite · Secure by design
        </div>
      </div>
    </main>
  );
}
