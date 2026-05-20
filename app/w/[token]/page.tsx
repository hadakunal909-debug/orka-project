import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { STAGES, CHECKPOINTS } from "@/lib/methodology";

export const dynamic = "force-dynamic";

type CardLite = {
  id: string;
  title: string;
  stage: string;
  progress: number;
  priority: "high" | "medium" | "low";
  due_date: string | null;
  last_feedback: number | null;
  created_at: string;
};

type Payload = {
  workspace: { id: string; name: string; description: string | null };
  project: { id: string; name: string; description: string | null; status: string } | null;
  cards: CardLite[];
};

async function loadWorkspace(token: string): Promise<Payload | null> {
  const h = headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("host");
  if (!host) return null;
  const url = `${proto}://${host}/api/public/workspace/${encodeURIComponent(token)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export default async function WorkspaceShare({ params }: { params: { token: string } }) {
  const data = await loadWorkspace(params.token);
  if (!data) notFound();
  const { workspace, project, cards } = data;

  const total = cards.length;
  const done = cards.filter(c => c.stage === "served").length;
  const inProgress = cards.filter(c => ["prep_table", "front_burner", "pass_qa"].includes(c.stage)).length;
  const overall = total > 0 ? Math.round(cards.reduce((s, c) => s + c.progress, 0) / total) : 0;

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-white border-b border-line">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <div className="text-[10.5px] font-semibold text-mute uppercase tracking-wider">Client workspace</div>
          <h1 className="text-2xl font-bold text-ink mt-1">{workspace.name}</h1>
          {workspace.description && (
            <p className="text-sm text-soft mt-2 leading-relaxed">{workspace.description}</p>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {project && (
          <section className="mb-6 grid grid-cols-4 gap-3">
            <Stat label="Cards" value={String(total)} />
            <Stat label="In progress" value={String(inProgress)} />
            <Stat label="Delivered" value={String(done)} />
            <Stat label="Overall" value={`${overall}%`} highlight />
          </section>
        )}

        {cards.length === 0 ? (
          <div className="bg-white border border-line rounded-lg p-10 text-center">
            <div className="text-sm font-semibold text-ink">Nothing to show yet</div>
            <div className="text-xs text-soft mt-1">Cards added to this project will appear here.</div>
          </div>
        ) : (
          <div className="bg-white border border-line rounded-lg overflow-hidden">
            <div className="grid grid-cols-[2fr_1fr_2fr_120px] gap-3 px-4 py-2.5 border-b border-line text-[11px] font-semibold text-soft uppercase tracking-wide">
              <div>Title</div>
              <div>Stage</div>
              <div>Progress</div>
              <div>Due</div>
            </div>
            {cards.map(c => {
              const stage = STAGES.find(s => s.id === c.stage);
              return (
                <div key={c.id}
                  className="grid grid-cols-[2fr_1fr_2fr_120px] gap-3 px-4 py-3 border-b border-bg items-center text-sm">
                  <div className="font-medium text-ink truncate">{c.title}</div>
                  <div>
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold"
                      style={{ background: (stage?.color || "#94A3B8") + "15", color: stage?.color || "#94A3B8" }}>
                      {stage?.name || c.stage}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-[5px] bg-bg rounded relative min-w-[100px]">
                        <div className="h-full rounded transition-[width] duration-200"
                          style={{ width: `${c.progress}%`, background: stage?.color || "#2563EB" }} />
                        {CHECKPOINTS.map(cp => (
                          <div key={cp.pct} className="absolute top-[-1px] w-[2px] h-[7px] -translate-x-px rounded-sm"
                            style={{
                              left: `${cp.pct}%`,
                              background: c.last_feedback && c.last_feedback >= cp.pct ? (stage?.color || "#2563EB") : "#CBD5E1",
                            }} />
                        ))}
                      </div>
                      <div className="font-mono text-[11px] font-semibold text-soft min-w-9 text-right">{c.progress}%</div>
                    </div>
                  </div>
                  <div className="text-xs font-mono text-soft">{fmtDate(c.due_date)}</div>
                </div>
              );
            })}
          </div>
        )}

        <footer className="mt-8 text-center text-[11px] text-mute">
          You're viewing a read-only client workspace. Need access to make changes? Ask your contact.
        </footer>
      </main>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-3 rounded-lg border ${highlight ? "bg-primary/5 border-primary/20" : "bg-white border-line"}`}>
      <div className="text-[10.5px] font-semibold text-mute uppercase tracking-wider">{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold ${highlight ? "text-primary" : "text-ink"}`}>{value}</div>
    </div>
  );
}
