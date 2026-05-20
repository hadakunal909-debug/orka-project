"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { A2uiSurface, basicCatalog } from "@a2ui/react/v0_9";
import { injectStyles as injectA2uiStyles } from "@a2ui/react/styles";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import {
  Inbox, User as UserIcon, ListTree, MessageSquare, MessageCircle, Folder,
  ChevronRight, ChevronDown, Plus, X, Search, ArrowUpDown, CircleDot,
  AlertTriangle, Pause, PlayCircle, CheckCircle2, ClipboardList, Activity,
  Target, Trash2, Hash, LogOut, Users as UsersIcon, Globe, Settings, Send,
  BarChart3, PieChart as PieChartIcon, TrendingUp, Sparkles, AtSign, Calendar,
  Network, CornerDownRight, Check, Clock, UserCheck,
  LayoutGrid, List as ListIcon, Tag, Timer, GripVertical, ChevronUp,
  Paperclip, Link2, ListChecks, Eye, EyeOff, Shield, RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient as createBrowserClient } from "@/lib/supabase-browser";
import { normalizeHttpUrl } from "@/lib/security";
import {
  STAGES, CHECKPOINTS, LENSES, PRIORITIES, STAGE_PROGRESS, stageById, nextCheckpoint,
} from "@/lib/methodology";
import type {
  User, Department, Team, TeamMember, Project, Workspace, Card, FeedbackEntry, Message,
  FeedbackStatus, RoutingChainEntry, Subtask,
} from "@/lib/types";

const STAGE_ICONS: Record<string, any> = {
  on_order: ClipboardList, prep_table: Target, front_burner: Activity,
  back_burner: Timer, pass_qa: PlayCircle, served: CheckCircle2,
};
const DEBUG_REALTIME = process.env.NODE_ENV !== "production";

// ====================================================================
// TOAST SYSTEM — uses window CustomEvent so it survives hot reloads
// ====================================================================
type Toast = { id: string; message: string; type: "info" | "success" | "warning"; from?: string };
const TOAST_EVENT = "sw:toast";
function emitToast(t: Omit<Toast, "id">) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { ...t, id: Math.random().toString(36).slice(2) } }));
}
function useToast() {
  return (message: string, type: Toast["type"] = "info", from?: string) => {
    emitToast({ message, type, from });
  };
}
function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const handler = (e: Event) => {
      const t = (e as CustomEvent).detail as Toast;
      setToasts((prev) => [...prev.slice(-4), t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 4500);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);
  if (toasts.length === 0) return null;
  const styles = {
    info:    { stripe: "bg-primary",  iconBg: "bg-primary/10",  iconColor: "text-primary",    Icon: MessageCircle },
    success: { stripe: "bg-success",  iconBg: "bg-success/10",  iconColor: "text-success-dark", Icon: CheckCircle2 },
    warning: { stripe: "bg-warning",  iconBg: "bg-warning/10",  iconColor: "text-warning-dark", Icon: AlertTriangle },
  } as const;
  return (
    <div className="fixed bottom-5 right-5 flex flex-col gap-2.5 z-[9999] pointer-events-none">
      {toasts.map((t) => {
        const s = styles[t.type];
        const Icon = s.Icon;
        return (
          <div key={t.id} className="relative flex items-start gap-3 pl-4 pr-5 py-3.5 rounded-2xl bg-white/95 backdrop-blur-xl border border-white/60 text-sm font-medium max-w-sm pointer-events-auto animate-toastIn overflow-hidden"
            style={{ boxShadow: "0 12px 40px -8px rgba(15,23,42,0.15), 0 4px 12px -4px rgba(15,23,42,0.08), 0 0 0 1px rgba(255,255,255,0.6) inset" }}>
            <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-r ${s.stripe}`} />
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${s.iconBg}`}>
              <Icon size={15} className={s.iconColor} strokeWidth={2.4} />
            </div>
            <div className="min-w-0 pt-0.5">
              {t.from && <div className="text-[11px] text-soft font-semibold mb-0.5">{t.from}</div>}
              <div className="leading-snug text-ink text-[13px]">{t.message}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- helpers ----------
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

const fmtRelative = (ts: string) => {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(ts);
};

const daysUntil = (d: string | null) =>
  d ? Math.round((new Date(d).getTime() - Date.now()) / 86400000) : null;

const personName = (user?: Pick<User, "email" | "name"> | null) =>
  user?.name || user?.email?.split("@")[0] || "";

function renderMentions(content: string, users: OrgUser[]): React.ReactNode {
  const parts = content.split(/(@[\w.-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      const handle = part.slice(1).toLowerCase();
      const found = users.find(
        (u) => (u.name || u.email.split("@")[0]).toLowerCase() === handle
      );
      if (found) {
        return (
          <span key={i} className="text-primary font-semibold bg-blue-50 px-0.5 rounded">
            {part}
          </span>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
}

// ---------- API helpers ----------
const api = {
  async patchCard(id: string, patch: Partial<Card>) {
    const r = await fetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error("patch failed");
    return (await r.json()).card as Card;
  },
  async createCard(input: Partial<Card>) {
    const r = await fetch(`/api/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) throw new Error("create failed");
    return (await r.json()).card as Card;
  },
  async deleteCard(id: string) {
    const r = await fetch(`/api/cards/${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error("delete failed");
  },
  async createFeedback(input: Partial<FeedbackEntry>) {
    const r = await fetch(`/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`feedback create failed (${r.status}): ${detail}`);
    }
    return (await r.json()).feedback as FeedbackEntry;
  },
  async getMessages(params: { project_id?: string; card_id?: string; recipient_id?: string }) {
    const q = new URLSearchParams(params as any).toString();
    const r = await fetch(`/api/messages?${q}`);
    if (!r.ok) throw new Error("messages fetch failed");
    return (await r.json()).messages as Message[];
  },
  async createMessage(input: {
    project_id?: string; card_id?: string; recipient_id?: string;
    content: string; is_encrypted?: boolean;
  }) {
    const r = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) throw new Error("message create failed");
    return (await r.json()).message as Message;
  },
  async patchFeedback(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`feedback patch failed (${r.status}): ${detail}`);
    }
    return (await r.json()).feedback as FeedbackEntry;
  },
  async getMyFeedbackAssignments() {
    const r = await fetch("/api/feedback?assigned_to_me=1");
    if (!r.ok) throw new Error("assignments fetch failed");
    return (await r.json()).feedback as FeedbackEntry[];
  },
};

// ====================================================================
// MAIN COMPONENT
// ====================================================================
type OrgUser = Pick<User, "id" | "email" | "name" | "avatar_url"> & {
  role?: User["role"];
  department_id?: string | null;
  job_title?: string | null;
  manager_id?: string | null;
  last_seen_at?: string | null;
  e2e_public_key?: string | null;
};

type Props = {
  profile: User;
  initialDepartments: Department[];
  initialTeams: Team[];
  initialTeamMembers: TeamMember[];
  initialProjects: Project[];
  initialWorkspaces: Workspace[];
  initialCards: Card[];
  initialFeedback: FeedbackEntry[];
  orgUsers: OrgUser[];
};

export default function DashboardClient({
  profile,
  initialDepartments,
  initialTeams,
  initialTeamMembers,
  initialProjects,
  initialWorkspaces,
  initialCards,
  initialFeedback,
  orgUsers,
}: Props) {
  const [departments, setDepartments] = useState(initialDepartments);
  const [teams, setTeams] = useState(initialTeams);
  const [teamMembers] = useState(initialTeamMembers);
  const [projects, setProjects] = useState(initialProjects);
  const [workspaces] = useState(initialWorkspaces);
  const [cards, setCards] = useState(initialCards);
  const [feedback, setFeedback] = useState(initialFeedback);

  const [activeView, setActiveView] = useState<{ type: string; id?: string }>({ type: "home" });
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("progress");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [groupBy, setGroupBy] = useState("stage");
  const [stageFilter, setStageFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>(
    Object.fromEntries(departments.map((d) => [d.id, true]))
  );
  const [showNewCard, setShowNewCard] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [refreshing, setRefreshing] = useState(false);

  // Re-fetch everything from the database. Picks up edits made by other users.
  const refreshFromDb = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    // Full reload: simplest way to re-run the server-side fetch the dashboard
    // page does and get fresh RLS-filtered data. Loses scroll/search position,
    // which is expected behavior for "refresh".
    window.location.reload();
  }, [refreshing]);
  const isSuperAdmin = profile.role === "super_admin";
  const isMember = profile.role === "member";
  const allCardsLabel = isMember ? "My Cards" : "All Cards";
  const allCardsDescription = isMember
    ? "Cards assigned or explicitly shared with you."
    : "Cards across your accessible workspace.";

  // Per-conversation unread counts: key = "dm-<userId>" or "project-<projectId>"
  // NOTE: initialize empty to avoid hydration mismatch; load from localStorage after mount.
  const [unreadByConv, setUnreadByConv] = useState<Record<string, number>>({});
  // Read receipts: dmReadBy[otherUserId] = ISO timestamp of when they last opened our DM
  const [dmReadBy, setDmReadBy] = useState<Record<string, string>>({});
  // Conversation activity: convLastAt["dm-<id>"|"project-<id>"] = ISO timestamp of last message
  const [convLastAt, setConvLastAt] = useState<Record<string, string>>({});

  // Hydrate from localStorage AFTER mount (client-only) to avoid SSR/CSR mismatch
  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem(`sw-unread-${profile.id}`) || "{}");
      if (u && Object.keys(u).length) setUnreadByConv(u);
      const r = JSON.parse(localStorage.getItem(`sw-read-by-${profile.id}`) || "{}");
      if (r && Object.keys(r).length) setDmReadBy(r);
      const c = JSON.parse(localStorage.getItem(`sw-conv-last-${profile.id}`) || "{}");
      if (c && Object.keys(c).length) setConvLastAt(c);
    } catch {}
  }, [profile.id]);
  const saveUnread = useCallback((next: Record<string, number>) => {
    localStorage.setItem(`sw-unread-${profile.id}`, JSON.stringify(next));
    setUnreadByConv(next);
  }, [profile.id]);
  const markConvRead = useCallback((convKey: string) => {
    setUnreadByConv(prev => {
      if (!prev[convKey]) return prev;
      const next = { ...prev };
      delete next[convKey];
      localStorage.setItem(`sw-unread-${profile.id}`, JSON.stringify(next));
      return next;
    });
  }, [profile.id]);
  // Total unread for the Chat nav badge
  const unreadMsgs = Object.values(unreadByConv).reduce((s, n) => s + n, 0);

  const orgUsersRef = useRef(orgUsers);
  useEffect(() => { orgUsersRef.current = orgUsers; }, [orgUsers]);

  // Dedupe seen message IDs across both delivery channels
  const seenMsgIdsRef = useRef<Set<string>>(new Set());

  // Persistent broadcast channel for SENDING (shared with ChatView via ref)
  const broadcastChannelRef = useRef<any>(null);

  // Process an incoming message: dispatch event, update unread, show toast
  const handleIncomingMessage = useCallback((msg: Message) => {
    if (seenMsgIdsRef.current.has(msg.id)) return;
    seenMsgIdsRef.current.add(msg.id);
    if (DEBUG_REALTIME) console.log("[realtime] incoming msg:", msg.id, "author:", msg.author_id);

    window.dispatchEvent(new CustomEvent("sw:new-msg", { detail: msg }));

    // Update conversation activity (for DM list ordering) — for ALL messages, even own
    const isCardComment = !!msg.card_id;
    if (!isCardComment) {
      const otherKey = msg.recipient_id
        ? (msg.author_id === profile.id ? `dm-${msg.recipient_id}` : `dm-${msg.author_id}`)
        : `project-${msg.project_id}`;
      setConvLastAt(prev => {
        const next = { ...prev, [otherKey]: msg.created_at };
        localStorage.setItem(`sw-conv-last-${profile.id}`, JSON.stringify(next));
        return next;
      });
    }

    if (msg.author_id === profile.id) return;

    const users = orgUsersRef.current;
    const sender = users.find((u) => u.id === msg.author_id);
    const senderName = personName(sender) || "Someone";

    if (!isCardComment) {
      const convKey = msg.recipient_id
        ? `dm-${msg.author_id}`
        : `project-${msg.project_id}`;
      setUnreadByConv(prev => {
        const next = { ...prev, [convKey]: (prev[convKey] || 0) + 1 };
        localStorage.setItem(`sw-unread-${profile.id}`, JSON.stringify(next));
        return next;
      });
    }

    const isDM = !!msg.recipient_id;
    const preview = msg.content.length > 60 ? msg.content.slice(0, 60) + "…" : msg.content;
    const context = isCardComment ? "commented on a card" : isDM ? "sent you a message" : "in a channel";
    emitToast({ message: preview, type: "info", from: `${senderName} ${context}` });
    if (DEBUG_REALTIME) console.log("[realtime] toast emitted for:", senderName);
  }, [profile.id]);

  // Process a "dm-read" broadcast: someone opened our DM, mark our sent messages as read up to that time
  const handleDmRead = useCallback((reader_id: string, target_id: string, read_at: string) => {
    if (target_id !== profile.id) return; // only care when WE are the one whose msgs were read
    setDmReadBy(prev => {
      const existing = prev[reader_id];
      if (existing && existing >= read_at) return prev;
      const next = { ...prev, [reader_id]: read_at };
      localStorage.setItem(`sw-read-by-${profile.id}`, JSON.stringify(next));
      return next;
    });
  }, [profile.id]);

  // ---- Global realtime subscription (TWO mechanisms for reliability) ----
  // 1. Supabase broadcast — fires when sender explicitly broadcasts (bypasses RLS)
  // 2. postgres_changes — backup, fires on DB INSERT (requires publication + RLS pass)
  useEffect(() => {
    const sb = createBrowserClient();
    if (DEBUG_REALTIME) console.log("[realtime] subscribing as", profile.email, "id:", profile.id, "org:", profile.org_id);
    const channel = sb
      .channel(`org-${profile.org_id}-msgs`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "new-message" }, ({ payload }: any) => {
        if (DEBUG_REALTIME) console.log("[realtime] broadcast received");
        handleIncomingMessage(payload as Message);
      })
      .on("broadcast", { event: "dm-read" }, ({ payload }: any) => {
        if (DEBUG_REALTIME) console.log("[realtime] dm-read received", payload);
        handleDmRead(payload.reader_id, payload.target_id, payload.read_at);
      })
      .on("postgres_changes" as any, {
        event: "INSERT",
        schema: "public",
        table: "messages",
      }, (payload: any) => {
        const msg = payload.new as Message;
        if (msg.org_id !== profile.org_id) return;
        if (DEBUG_REALTIME) console.log("[realtime] postgres_changes received");
        handleIncomingMessage(msg);
      })
      .subscribe((status, err) => {
        if (err) console.error("[realtime] subscription error:", err);
        else if (DEBUG_REALTIME) console.log("[realtime] status:", status);
        if (status === "SUBSCRIBED") broadcastChannelRef.current = channel;
      });
    return () => {
      broadcastChannelRef.current = null;
      sb.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  // Realtime: stream INSERT/UPDATE/DELETE for cards, feedback_log, projects so
  // edits from other users appear without a manual refresh. Requires the
  // 20260519_realtime_publications.sql migration to be applied — otherwise this
  // subscription connects but no events fire.
  useEffect(() => {
    const sb = createBrowserClient();
    const channel = sb
      .channel(`org-${profile.org_id}-data`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "cards" }, (payload: any) => {
        const row = (payload.new ?? payload.old) as Card | undefined;
        if (!row || row.org_id !== profile.org_id) return;
        if (payload.eventType === "INSERT") {
          // Skip if soft-deleted on creation (shouldn't happen, defensive).
          if (payload.new.deleted_at) return;
          setCards((prev) => prev.some((c) => c.id === payload.new.id) ? prev : [payload.new as Card, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          // Treat a newly-set deleted_at as a remove from the local list.
          if (payload.new.deleted_at && !payload.old?.deleted_at) {
            setCards((prev) => prev.filter((c) => c.id !== payload.new.id));
          } else {
            setCards((prev) => prev.map((c) => c.id === payload.new.id ? (payload.new as Card) : c));
          }
        } else if (payload.eventType === "DELETE") {
          setCards((prev) => prev.filter((c) => c.id !== payload.old.id));
        }
      })
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "feedback_log" }, (payload: any) => {
        const row = (payload.new ?? payload.old) as FeedbackEntry | undefined;
        if (!row || row.org_id !== profile.org_id) return;
        if (payload.eventType === "INSERT") {
          setFeedback((prev) => prev.some((f) => f.id === payload.new.id) ? prev : [payload.new as FeedbackEntry, ...prev]);
          if (payload.new.assigned_to_id === profile.id && payload.new.status !== "resolved") {
            setMyAssignments((prev) => prev.some((f) => f.id === payload.new.id) ? prev : [payload.new as FeedbackEntry, ...prev]);
          }
        } else if (payload.eventType === "UPDATE") {
          setFeedback((prev) => prev.map((f) => f.id === payload.new.id ? (payload.new as FeedbackEntry) : f));
          setMyAssignments((prev) => {
            const next = prev.map((f) => f.id === payload.new.id ? (payload.new as FeedbackEntry) : f);
            return next.filter((f) => f.status !== "resolved" && f.assigned_to_id === profile.id);
          });
        } else if (payload.eventType === "DELETE") {
          setFeedback((prev) => prev.filter((f) => f.id !== payload.old.id));
          setMyAssignments((prev) => prev.filter((f) => f.id !== payload.old.id));
        }
      })
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "projects" }, (payload: any) => {
        const row = (payload.new ?? payload.old) as Project | undefined;
        if (!row || row.org_id !== profile.org_id) return;
        if (payload.eventType === "INSERT") {
          setProjects((prev) => prev.some((p) => p.id === payload.new.id) ? prev : [...prev, payload.new as Project]);
        } else if (payload.eventType === "UPDATE") {
          setProjects((prev) => prev.map((p) => p.id === payload.new.id ? (payload.new as Project) : p));
        } else if (payload.eventType === "DELETE") {
          setProjects((prev) => prev.filter((p) => p.id !== payload.old.id));
        }
      })
      .subscribe((status, err) => {
        if (err) console.error("[realtime/data] subscription error:", err);
        else if (DEBUG_REALTIME) console.log("[realtime/data] status:", status);
      });
    return () => { sb.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.org_id]);

  // Function for ChatView to broadcast a newly-sent message to other clients
  const broadcastMessage = useCallback((msg: Message) => {
    // Mark our own message as seen so postgres_changes won't double-process it
    seenMsgIdsRef.current.add(msg.id);
    const ch = broadcastChannelRef.current;
    if (!ch) {
      if (DEBUG_REALTIME) console.warn("[realtime] broadcast channel not ready");
      return;
    }
    ch.send({ type: "broadcast", event: "new-message", payload: msg }).then(
      () => { if (DEBUG_REALTIME) console.log("[realtime] broadcast sent:", msg.id); },
      (e: any) => console.error("[realtime] broadcast send failed:", e)
    );
  }, []);

  // Broadcast a "dm-read" signal: tells the other user we just opened the DM
  const broadcastDmRead = useCallback((otherUserId: string) => {
    const ch = broadcastChannelRef.current;
    if (!ch) return;
    ch.send({
      type: "broadcast",
      event: "dm-read",
      payload: { reader_id: profile.id, target_id: otherUserId, read_at: new Date().toISOString() },
    });
  }, [profile.id]);
  const toast = useToast();

  // ---- mutations (optimistic) ----
  const updateCard = async (id: string, patch: Partial<Card>) => {
    const previousCards = cards;
    // When stage changes, auto-derive progress from the stage
    if (patch.stage && STAGE_PROGRESS[patch.stage] !== undefined) {
      patch = { ...patch, progress: STAGE_PROGRESS[patch.stage] };
    }
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    try {
      await api.patchCard(id, patch);
    } catch (e) {
      console.error(e);
      setCards(previousCards);
      toast("We could not save that card change. Your view was restored.", "warning", "Save failed");
    }
  };

  const deleteCard = async (id: string) => {
    const previousCards = cards;
    const previousFeedback = feedback;
    setCards((prev) => prev.filter((c) => c.id !== id));
    setFeedback((prev) => prev.filter((f) => f.card_id !== id));
    setSelectedCardId(null);
    try {
      await api.deleteCard(id);
    } catch (e) {
      console.error(e);
      setCards(previousCards);
      setFeedback(previousFeedback);
      toast("Delete did not complete, so the card has been restored.", "warning", "Delete failed");
    }
  };

  const createCard = async (input: Partial<Card>) => {
    try {
      const card = await api.createCard(input);
      setCards((prev) => [card, ...prev]);
      setSelectedCardId(card.id);
    } catch (e) {
      console.error(e);
      toast("We could not create the card. Check the required fields and try again.", "warning", "Create failed");
    }
  };

  const addFeedback = async (input: Partial<FeedbackEntry>) => {
    try {
      const fb = await api.createFeedback(input);
      setFeedback((prev) => [fb, ...prev]);
      setCards((prev) =>
        prev.map((c) =>
          c.id === input.card_id
            ? { ...c, last_feedback: Math.max(c.last_feedback || 0, input.checkpoint!) }
            : c
        )
      );
      if (fb.assigned_to_id && fb.assigned_to_id === profile.id) {
        setMyAssignments((prev) => [fb, ...prev]);
      }
    } catch (e) {
      console.error(e);
      toast("Feedback was not saved. Please try again.", "warning", "Feedback failed");
      throw e;
    }
  };

  const updateFeedbackEntry = (fb: FeedbackEntry) => {
    setFeedback((prev) => prev.map((f) => (f.id === fb.id ? fb : f)));
    setMyAssignments((prev) =>
      prev
        .map((f) => (f.id === fb.id ? fb : f))
        .filter((f) => f.status !== "resolved" && f.assigned_to_id === profile.id),
    );
  };

  // ---- derived ----
  const visibleCards = useMemo(() => {
    let cs = cards;
    if (activeView.type === "all" && isMember) {
      cs = cs.filter((c) => c.assignee_id === profile.id || c.hidden_by === profile.id || (Array.isArray(c.visible_to) && c.visible_to.includes(profile.id)));
    }
    if (activeView.type === "my") cs = cs.filter((c) => c.assignee_id === profile.id);
    if (activeView.type === "inbox")
      cs = cs.filter((c) => {
        const next = nextCheckpoint(c.progress, c.last_feedback);
        return next && c.progress >= next.pct - 5 && c.stage !== "served" && c.assignee_id === profile.id;
      });
    if (activeView.type === "department")
      cs = cs.filter((c) => {
        const proj = projects.find((p) => p.id === c.project_id);
        return proj && proj.department_id === activeView.id;
      });
    if (activeView.type === "team")
      cs = cs.filter((c) => {
        const proj = projects.find((p) => p.id === c.project_id);
        return proj && proj.team_id === activeView.id;
      });
    if (activeView.type === "project") cs = cs.filter((c) => c.project_id === activeView.id);
    if (search) {
      const q = search.trim().toLowerCase();
      cs = cs.filter((c) => {
        const project = projects.find((p) => p.id === c.project_id);
        const department = project ? departments.find((d) => d.id === project.department_id) : null;
        const assignee = orgUsers.find((u) => u.id === c.assignee_id);
        const haystack = [
          c.title,
          c.notes,
          project?.name,
          department?.name,
          personName(assignee),
          assignee?.email,
          ...(Array.isArray(c.tags) ? c.tags : []),
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }
    if (stageFilter !== "all") cs = cs.filter((c) => c.stage === stageFilter);
    if (overdueOnly) cs = cs.filter((c) => {
      const d = daysUntil(c.due_date);
      return d !== null && d < 0 && c.stage !== "served";
    });
    return cs;
  }, [cards, activeView, search, stageFilter, overdueOnly, projects, departments, orgUsers, profile.id, isMember]);

  const sortedCards = useMemo(() => {
    const sorted = [...visibleCards];
    sorted.sort((a, b) => {
      let av: any, bv: any;
      if (sortBy === "progress") { av = a.progress; bv = b.progress; }
      else if (sortBy === "due") { av = a.due_date || "9999"; bv = b.due_date || "9999"; }
      else if (sortBy === "title") { av = a.title.toLowerCase(); bv = b.title.toLowerCase(); }
      else if (sortBy === "stage") {
        av = STAGES.findIndex((s) => s.id === a.stage);
        bv = STAGES.findIndex((s) => s.id === b.stage);
      } else if (sortBy === "priority") {
        const o: any = { high: 0, medium: 1, low: 2 };
        av = o[a.priority]; bv = o[b.priority];
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [visibleCards, sortBy, sortDir]);

  const groupedCards = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", label: null, cards: sortedCards }];
    if (groupBy === "stage") {
      return STAGES.map((s) => ({
        key: s.id, label: s.name, color: s.color, icon: STAGE_ICONS[s.id],
        cards: sortedCards.filter((c) => c.stage === s.id),
      })).filter((g) => g.cards.length > 0);
    }
    if (groupBy === "project") {
      const byP: Record<string, Card[]> = {};
      sortedCards.forEach((c) => { (byP[c.project_id] ||= []).push(c); });
      return Object.entries(byP).map(([pid, cs]) => {
        const proj = projects.find((p) => p.id === pid);
        const dept = proj && departments.find((d) => d.id === proj.department_id);
        return { key: pid, label: proj?.name || "Unknown", sublabel: dept?.name, color: dept?.color, cards: cs };
      });
    }
    if (groupBy === "assignee") {
      const byA: Record<string, Card[]> = {};
      sortedCards.forEach((c) => { const a = c.assignee_id || "unassigned"; (byA[a] ||= []).push(c); });
      return Object.entries(byA).map(([aid, cs]) => {
        const u = orgUsers.find((u) => u.id === aid);
        return { key: aid, label: u?.name || u?.email || "Unassigned", cards: cs };
      });
    }
    return [];
  }, [sortedCards, groupBy, projects, departments, orgUsers]);

  const viewMeta = useMemo(() => {
    if (activeView.type === "home") return { title: "Dashboard", desc: "Your work, planning signals, and suggestions." };
    if (activeView.type === "all") return { title: allCardsLabel, desc: allCardsDescription };
    if (activeView.type === "my") return { title: "My Inbox", desc: "Cards assigned to you." };
    if (activeView.type === "inbox") return { title: "My Inbox", desc: "Your assigned cards approaching a checkpoint." };
    if (activeView.type === "chat") return { title: "Chat", desc: "Project channels and direct messages." };
    if (activeView.type === "analytics") return { title: "Analytics", desc: "Project KPIs, distributions, and timeline." };
    if (activeView.type === "people") return { title: "People & Org", desc: "Organisation hierarchy and directory." };
    if (activeView.type === "assignments") return { title: "My Inbox", desc: "Feedback items routed to you for action." };
    if (activeView.type === "department") {
      const d = departments.find((d) => d.id === activeView.id);
      return { title: d?.name, desc: "Department — all teams, projects and cards.", color: d?.color };
    }
    if (activeView.type === "team") {
      const t = teams.find((t) => t.id === activeView.id);
      const dept = t && departments.find((d) => d.id === t.department_id);
      return { title: t?.name, desc: dept ? `Team in ${dept.name}.` : "Team.", color: dept?.color };
    }
    if (activeView.type === "project") {
      const p = projects.find((p) => p.id === activeView.id);
      const dept = p && departments.find((d) => d.id === p.department_id);
      return { title: p?.name, desc: dept ? `Project under ${dept.name}.` : "Project.", color: dept?.color };
    }
    return { title: "—" };
  }, [activeView, departments, teams, projects, profile, allCardsLabel, allCardsDescription]);

  const [myAssignments, setMyAssignments] = useState<FeedbackEntry[]>([]);

  useEffect(() => {
    api.getMyFeedbackAssignments()
      .then(setMyAssignments)
      .catch(() => {});
  }, []);

  const attention = useMemo(() => {
    const overdue = cards.filter((c) => {
      const d = daysUntil(c.due_date);
      return d !== null && d < 0 && c.stage !== "served";
    }).length;
    const dueSoon = cards.filter((c) => {
      const d = daysUntil(c.due_date);
      return d !== null && d >= 0 && d <= 7 && c.stage !== "served";
    }).length;
    const unassigned = cards.filter((c) => !c.assignee_id && c.stage !== "served").length;
    const noDueDate = cards.filter((c) => !c.due_date && c.stage !== "served").length;
    const paused = cards.filter((c) => c.stage === "back_burner").length;
    const fbNeeded = cards.filter((c) => {
      const next = nextCheckpoint(c.progress, c.last_feedback);
      return next && c.progress >= next.pct - 5 && c.stage !== "served" && c.assignee_id === profile.id;
    }).length;
    return {
      overdue,
      dueSoon,
      unassigned,
      noDueDate,
      paused,
      needsFeedback: fbNeeded,
      nearCheckpoint: fbNeeded,
      myAssignments: myAssignments.length,
    };
  }, [cards, myAssignments]);

  const selectedCard = cards.find((c) => c.id === selectedCardId) || null;
  const healthItems: React.ComponentProps<typeof PortfolioHealthBar>["items"] = [
    {
      key: "overdue",
      label: "Overdue",
      value: attention.overdue,
      tone: "danger",
      icon: AlertTriangle,
      onClick: () => { setOverdueOnly((v) => !v); setStageFilter("all"); },
    },
    {
      key: "due-soon",
      label: "Due next 7d",
      value: attention.dueSoon,
      tone: "warning",
      icon: Clock,
      onClick: () => { setSortBy("due"); setSortDir("asc"); setOverdueOnly(false); },
    },
    {
      key: "unassigned",
      label: "Unassigned",
      value: attention.unassigned,
      tone: "info",
      icon: UserIcon,
      onClick: () => { setGroupBy("assignee"); setOverdueOnly(false); },
    },
    {
      key: "no-date",
      label: "No due date",
      value: attention.noDueDate,
      tone: "neutral",
      icon: Calendar,
      onClick: () => { setSortBy("due"); setSortDir("desc"); setOverdueOnly(false); },
    },
    {
      key: "paused",
      label: "Back burner",
      value: attention.paused,
      tone: "neutral",
      icon: Pause,
      onClick: () => { setStageFilter("back_burner"); setOverdueOnly(false); },
    },
  ];

  if (isSuperAdmin) {
    return (
      <SuperAdminDashboard
        profile={profile}
        departments={departments}
        teams={teams}
        teamMembers={teamMembers}
        projects={projects}
        workspaces={workspaces}
        cards={cards}
        feedback={feedback}
        orgUsers={orgUsers}
        selectedCardId={selectedCardId}
        onSelectCard={setSelectedCardId}
        onUpdateCard={updateCard}
        onDeleteCard={deleteCard}
        onAddFeedback={addFeedback}
        onUpdateFeedback={updateFeedbackEntry}
      />
    );
  }

  return (
    <div className="flex min-h-screen">
      <ToastContainer />
      {/* ============ SIDEBAR ============ */}
      <aside className="w-52 min-w-52 bg-sidebar-grad border-r border-line/80 flex flex-col h-screen sticky top-0 overflow-y-auto">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line/60">
          <div className="w-7 h-7 rounded-lg bg-white ring-1 ring-primary/10 flex items-center justify-center shadow-sm relative group">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10">
              <path d="M16 4 A12 12 0 1 0 26.4 22.4" stroke="#2563EB" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              <path d="M16 4 A12 12 0 0 1 24 7.5" stroke="#0EA5E9" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              <path d="M14.5 1 L22 5 L17.5 9 Z" fill="#0F172A" />
            </svg>
          </div>
          <div>
            <div className="text-[12px] font-bold leading-none tracking-tight text-ink">Orka Project</div>
            <div className="text-[9px] text-mute mt-0.5 font-semibold tracking-wide uppercase">Workspace</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 mx-2 mt-2 px-2 py-1.5 bg-white/80 border border-line/60 rounded-md hover:border-primary/30 focus-within:border-primary/40 focus-within:shadow-glow transition-all duration-200">
          <Search size={11} className="text-mute" />
          <input
            placeholder="Search cards…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-mute/60"
          />
        </div>

        <div className="px-2 pt-2.5 pb-1.5">
          <div className="text-[9px] font-bold text-mute/60 uppercase tracking-widest px-2 pb-1 flex items-center gap-1">
            <span className="w-0.5 h-0.5 rounded-full bg-mute/40" />
            Workspace
          </div>
          <NavItem icon={BarChart3} label="Dashboard"
            active={activeView.type === "home"}
            onClick={() => { setActiveView({ type: "home" }); setSelectedCardId(null); }} />
          <NavItem icon={Inbox} label="My Inbox"
            badge={attention.needsFeedback + attention.myAssignments}
            active={["my", "inbox", "assignments"].includes(activeView.type)}
            onClick={() => {
              // Default to whichever tab has the most attention; fall back to "my".
              const next = attention.needsFeedback > 0 ? "inbox"
                : attention.myAssignments > 0 ? "assignments"
                : isMember ? "inbox" : "my";
              setActiveView({ type: next });
              setSelectedCardId(null);
            }} />
          {!isMember && (
            <NavItem icon={ListTree} label={allCardsLabel}
              active={activeView.type === "all"}
              onClick={() => { setActiveView({ type: "all" }); setSelectedCardId(null); }} />
          )}
          <NavItem icon={MessageCircle} label="Chat" badge={unreadMsgs}
            active={activeView.type === "chat"}
            onClick={() => { setActiveView({ type: "chat" }); setSelectedCardId(null); }} />
          <NavItem icon={Network} label="People & Org"
            active={activeView.type === "people"}
            onClick={() => { setActiveView({ type: "people" }); setSelectedCardId(null); }} />
          <NavItem icon={BarChart3} label="Analytics"
            active={activeView.type === "analytics"}
            onClick={() => { setActiveView({ type: "analytics" }); setSelectedCardId(null); }} />
        </div>

        <div className="px-2.5 pb-3">
          <div className="text-[9px] font-bold text-mute/60 uppercase tracking-widest px-2 pb-1 flex items-center gap-1">
            <span className="w-0.5 h-0.5 rounded-full bg-mute/40" />
            Departments
          </div>
          {departments.length === 0 && (
            <div className="px-2.5 py-1 text-[11px] text-mute italic">
              {profile.role === "admin" ? "None yet — create one in /admin." : "None yet."}
            </div>
          )}
          {departments.map((dept) => {
            const deptProjects = projects.filter((p) => p.department_id === dept.id);
            const isOpen = expandedDepts[dept.id];
            const cardCount = cards.filter((c) =>
              deptProjects.some((p) => p.id === c.project_id)
            ).length;
            const isActive = activeView.type === "department" && activeView.id === dept.id;
            return (
              <div key={dept.id}>
                <div className="flex items-center">
                  <button
                    onClick={() => setExpandedDepts((e) => ({ ...e, [dept.id]: !e[dept.id] }))}
                    className="w-4 h-5 flex items-center justify-center text-mute">
                    {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  </button>
                  <button
                    onClick={() => { setActiveView({ type: "department", id: dept.id }); setSelectedCardId(null); }}
                    className={`flex-1 flex items-center gap-1.5 px-1.5 py-[3px] rounded text-left text-[11px] font-semibold ${isActive ? "bg-white shadow-sm border border-line text-ink" : "text-ink hover:bg-white/50"}`}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: dept.color }} />
                    <span className="flex-1 truncate">{dept.name}</span>
                    <span className="text-[9px] font-mono text-mute">{cardCount}</span>
                  </button>
                </div>
                {isOpen && (
                  <div className="pl-5 mb-px">
                    {deptProjects.map((proj) => {
                      const pCount = cards.filter((c) => c.project_id === proj.id).length;
                      const pActive = activeView.type === "project" && activeView.id === proj.id;
                      const team = teams.find((t) => t.id === proj.team_id);
                      const memberCount = team ? teamMembers.filter((m) => m.team_id === team.id).length : 0;
                      return (
                        <button key={proj.id}
                          onClick={() => { setActiveView({ type: "project", id: proj.id }); setSelectedCardId(null); }}
                          className={`w-full flex items-center gap-1 px-1.5 py-[3px] rounded text-left text-[10.5px] font-medium mb-px ${pActive ? "bg-white shadow-sm border border-line text-ink" : "text-soft hover:bg-white/50"}`}>
                          <Folder size={10} className="text-mute" />
                          <span className="flex-1 truncate">{proj.name}</span>
                          {memberCount > 0 && (
                            <span className="text-[9px] font-mono text-mute">{memberCount}p·</span>
                          )}
                          <span className="text-[9px] font-mono text-mute">{pCount}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Teams are now sub-entities of projects — see project detail and People & Org view */}

        {workspaces.length > 0 && (
          <div className="px-2 pb-2">
            <div className="text-[9px] font-bold text-mute/60 uppercase tracking-widest px-2 pb-1 flex items-center gap-1">
              <span className="w-0.5 h-0.5 rounded-full bg-mute/40" />
              Workspaces
            </div>
            {workspaces.map((ws) => (
              <Link key={ws.id} href={`/workspace/${ws.id}`}
                className="w-full flex items-center gap-1.5 px-1.5 py-[3px] rounded text-left text-[10.5px] font-medium mb-px text-soft hover:bg-white/50">
                <Globe size={10} className={ws.is_public ? "text-emerald-600" : "text-mute"} />
                <span className="flex-1 truncate">{ws.name}</span>
                {ws.is_public && <span className="text-[8px] font-semibold text-emerald-700">PUBLIC</span>}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-auto p-2 border-t border-line/60">
          {(profile.role === "admin" || profile.role === "super_admin") && (
            <Link href="/admin"
              className="flex items-center gap-2 px-2 py-1 text-[11px] font-medium text-soft hover:text-primary hover:bg-white/60 rounded mb-0.5 transition-all duration-100">
              <Settings size={11} className="text-mute" />
              <span>Admin</span>
            </Link>
          )}
          <div className="flex items-center gap-2 px-2 py-1 text-[11px] font-medium text-ink rounded hover:bg-white/50 transition-colors">
            <div className="w-[18px] h-[18px] rounded-full bg-brand-grad text-white text-[9px] font-bold flex items-center justify-center">
              {(profile.name || profile.email)[0].toUpperCase()}
            </div>
            <span className="flex-1 truncate">{profile.name || profile.email}</span>
            <a href="/api/auth/signout" title="Sign out" className="text-mute hover:text-danger p-0.5 rounded transition-colors">
              <LogOut size={11} />
            </a>
          </div>
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <main
        className={`flex-1 min-w-0 transition-[margin-right] duration-200 ${selectedCard ? "mr-[680px]" : ""}`}>
        <header className="px-4 pt-3 pb-1.5">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-2">
                {(viewMeta as any).color && (
                  <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: (viewMeta as any).color }} />
                )}
                <h1 className="text-[17px] font-bold tracking-tight text-ink">{viewMeta.title}</h1>
              </div>
              <div className="text-[11px] text-mute mt-0.5">{viewMeta.desc}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={refreshFromDb}
                disabled={refreshing}
                title="Refresh — re-fetch latest from the database">
                <RefreshCw size={12} strokeWidth={2.6} className={refreshing ? "animate-spin" : ""} />
                {refreshing ? "Refreshing…" : "Refresh"}
              </Button>
              {!["home", "chat", "analytics", "people", "assignments"].includes(activeView.type) && (
                <button
                  onClick={() => setShowNewCard(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-brand-grad text-white text-[11px] font-bold rounded-lg shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150">
                  <Plus size={12} strokeWidth={2.6} /> New Card
                </button>
              )}
            </div>
          </div>
          {!["home", "chat", "analytics", "people", "assignments", "feedback"].includes(activeView.type) && (
            <div className="grid grid-cols-4 gap-2 mt-2">
              <StatCard
                label="In view"
                value={visibleCards.length}
                icon={LayoutGrid}
                gradient="from-primary to-accent"
                active={!overdueOnly && stageFilter === "all"}
                onClick={() => { setOverdueOnly(false); setStageFilter("all"); }} />
              <StatCard
                label="Overdue"
                value={attention.overdue}
                icon={AlertTriangle}
                gradient="from-danger to-rose-400"
                pulse={attention.overdue > 0}
                active={overdueOnly}
                onClick={() => { setOverdueOnly((v) => !v); setStageFilter("all"); }} />
              <StatCard
                label="My feedback"
                value={attention.needsFeedback}
                icon={CircleDot}
                gradient="from-warning to-amber-300"
                active={activeView.type === "inbox"}
                onClick={() => { setActiveView({ type: "inbox" }); setSelectedCardId(null); }} />
              <StatCard
                label="My assignments"
                value={attention.myAssignments}
                icon={UserCheck}
                gradient="from-success to-emerald-300"
                active={activeView.type === "assignments"}
                onClick={() => { setActiveView({ type: "assignments" }); setSelectedCardId(null); }} />
            </div>
          )}
          {!["home", "chat", "analytics", "people", "assignments", "feedback"].includes(activeView.type) && cards.length > 0 && (
            <PortfolioHealthBar items={healthItems} />
          )}

          {/* Embeds bar for department / team / project views */}
          {activeView.type === "department" && activeView.id && (() => {
            const d = departments.find((d) => d.id === activeView.id);
            if (!d) return null;
            return (
              <EmbedsBar
                key={`dept-${d.id}`}
                embeds={Array.isArray((d as any).embeds) ? (d as any).embeds : []}
                onChange={async (newEmbeds) => {
                  setDepartments((prev) => prev.map((x) => x.id === d.id ? ({ ...x, embeds: newEmbeds } as any) : x));
                  await fetch(`/api/departments/${d.id}/embeds`, {
                    method: "PATCH", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ embeds: newEmbeds }),
                  });
                }}
              />
            );
          })()}
          {activeView.type === "team" && activeView.id && (() => {
            const t = teams.find((t) => t.id === activeView.id);
            if (!t) return null;
            return (
              <EmbedsBar
                key={`team-${t.id}`}
                embeds={Array.isArray((t as any).embeds) ? (t as any).embeds : []}
                onChange={async (newEmbeds) => {
                  setTeams((prev) => prev.map((x) => x.id === t.id ? ({ ...x, embeds: newEmbeds } as any) : x));
                  await fetch(`/api/teams/${t.id}/embeds`, {
                    method: "PATCH", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ embeds: newEmbeds }),
                  });
                }}
              />
            );
          })()}
          {activeView.type === "project" && activeView.id && (() => {
            const p = projects.find((p) => p.id === activeView.id);
            if (!p) return null;
            return (
              <EmbedsBar
                key={`proj-${p.id}`}
                embeds={Array.isArray((p as any).embeds) ? (p as any).embeds : []}
                onChange={async (newEmbeds) => {
                  setProjects((prev) => prev.map((x) => x.id === p.id ? ({ ...x, embeds: newEmbeds } as any) : x));
                  await fetch(`/api/projects/${p.id}`, {
                    method: "PATCH", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ embeds: newEmbeds }),
                  });
                }}
              />
            );
          })()}
        </header>

        {["my", "inbox", "assignments"].includes(activeView.type) && (
          <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-line/60 bg-white">
            {[
              { key: "my", label: "My Cards", badge: 0, hidden: isMember },
              { key: "inbox", label: "Feedback Needed", badge: attention.needsFeedback, hidden: false },
              { key: "assignments", label: "Routed to Me", badge: attention.myAssignments, hidden: false },
            ].filter((t) => !t.hidden).map((t) => {
              const active = activeView.type === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => { setActiveView({ type: t.key }); setSelectedCardId(null); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-soft hover:text-ink hover:bg-bg"
                  }`}>
                  {t.label}
                  {t.badge > 0 && (
                    <span className={`px-1.5 py-px rounded-full text-[10px] font-bold ${
                      active ? "bg-primary text-white" : "bg-bg text-soft border border-line"
                    }`}>
                      {t.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {activeView.type === "home" ? (
          <PersonalDashboardView
            profile={profile}
            cards={cards}
            projects={projects}
            departments={departments}
            feedback={feedback}
            orgUsers={orgUsers}
            onOpenView={(type) => { setActiveView({ type }); setSelectedCardId(null); }}
            onSelectCard={(id) => setSelectedCardId(id)}
          />
        ) : activeView.type === "chat" ? (
          <ChatView
            profile={profile}
            orgUsers={orgUsers}
            projects={projects}
            departments={departments}
            teams={teams}
            teamMembers={teamMembers}
            unreadByConv={unreadByConv}
            markConvRead={markConvRead}
            broadcastMessage={broadcastMessage}
            broadcastDmRead={broadcastDmRead}
            dmReadBy={dmReadBy}
            convLastAt={convLastAt}
          />
        ) : activeView.type === "analytics" ? (
          <AnalyticsView
            cards={cards}
            projects={projects}
            departments={departments}
            orgUsers={orgUsers}
          />
        ) : activeView.type === "people" ? (
          <OrgHierarchyView
            departments={departments}
            teams={teams}
            teamMembers={teamMembers}
            projects={projects}
            orgUsers={orgUsers}
            profile={profile}
          />
        ) : activeView.type === "assignments" ? (
          <FeedbackAssignmentsView
            assignments={myAssignments}
            cards={cards}
            projects={projects}
            departments={departments}
            profile={profile}
            orgUsers={orgUsers}
            onRespond={(updated) => {
              setMyAssignments((prev) =>
                prev.map((f) => f.id === updated.id ? updated : f).filter((f) => f.status !== "resolved")
              );
              setFeedback((prev) => prev.map((f) => f.id === updated.id ? updated : f));
            }}
          />
        ) : (
          <>
            {activeView.type === "all" && attention.overdue + attention.nearCheckpoint > 0 && (
              <div className="flex gap-2 px-4 pb-2">
                {attention.nearCheckpoint > 0 && (
                  <button
                    onClick={() => { setActiveView({ type: "inbox" }); setSelectedCardId(null); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 bg-bg border border-line rounded-md hover:shadow-sm transition-shadow cursor-pointer">
                    <CircleDot size={12} className="text-primary" strokeWidth={2.5} />
                    <div>
                      <div className="font-mono text-sm font-bold leading-none text-primary">
                        {attention.nearCheckpoint}
                      </div>
                      <div className="text-[10px] text-mute font-medium">My checkpoint work</div>
                    </div>
                  </button>
                )}
                {attention.overdue > 0 && (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 bg-bg border border-line rounded-md">
                    <AlertTriangle size={12} className="text-red-600" strokeWidth={2.5} />
                    <div>
                      <div className="font-mono text-sm font-bold leading-none text-red-600">
                        {attention.overdue}
                      </div>
                      <div className="text-[10px] text-mute font-medium">Overdue</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!["home", "feedback", "people", "assignments"].includes(activeView.type) && (
              <div className="flex items-center gap-3 px-4 py-1.5 bg-bg border-t border-y border-line">
                <Toolbar label="Group" value={groupBy} onChange={setGroupBy} options={[
                  ["none", "None"], ["stage", "Stage"], ["project", "Project"], ["assignee", "Assignee"],
                ]} />
                <Toolbar label="Sort" value={sortBy} onChange={setSortBy} options={[
                  ["progress", "Progress"], ["due", "Due date"], ["stage", "Stage"],
                  ["priority", "Priority"], ["title", "Title"],
                ]} />
                <button
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-line bg-white text-mute text-[10px] font-medium">
                  <ArrowUpDown size={10} />
                  {sortDir === "asc" ? "Asc" : "Desc"}
                </button>
                <Toolbar label="Stage" value={stageFilter} onChange={setStageFilter} options={[
                  ["all", "All stages"], ...STAGES.map((s) => [s.id, s.name] as [string, string]),
                ]} />
                <span className="ml-auto text-[10px] text-mute font-mono">
                  {visibleCards.length} cards
                </span>
                <div className="flex items-center gap-px ml-1 border border-line/60 rounded overflow-hidden bg-bg/80">
                  <button
                    onClick={() => setViewMode("list")}
                    title="List view"
                    className={`px-1.5 py-1 flex items-center text-[10px] font-medium transition-all duration-100 ${viewMode === "list" ? "bg-primary text-white" : "bg-white/80 text-mute hover:text-ink"}`}>
                    <ListIcon size={12} />
                  </button>
                  <button
                    onClick={() => setViewMode("board")}
                    title="Board view"
                    className={`px-1.5 py-1 flex items-center text-[10px] font-medium transition-all duration-100 ${viewMode === "board" ? "bg-primary text-white" : "bg-white/80 text-mute hover:text-ink"}`}>
                    <LayoutGrid size={12} />
                  </button>
                </div>
              </div>
            )}

            <div className={viewMode === "board" && activeView.type !== "feedback" ? "px-3 pb-6 overflow-x-auto" : "px-4 pb-6"}>
              {activeView.type === "feedback" ? (
                <FeedbackLogView
                  feedback={feedback}
                  cards={cards}
                  departments={departments}
                  projects={projects}
                  onCardClick={setSelectedCardId}
                />
              ) : viewMode === "board" ? (
                <BoardView
                  visibleCards={visibleCards}
                  departments={departments}
                  projects={projects}
                  orgUsers={orgUsers}
                  selectedCardId={selectedCardId}
                  onSelect={setSelectedCardId}
                  onMoveCard={(cardId, newStage) => updateCard(cardId, { stage: newStage as any })}
                  onAddCard={() => setShowNewCard(true)}
                />
              ) : (
                <CardListView
                  groups={groupedCards}
                  departments={departments}
                  projects={projects}
                  orgUsers={orgUsers}
                  selectedCardId={selectedCardId}
                  onSelect={setSelectedCardId}
                />
              )}
            </div>
          </>
        )}
      </main>

      {/* ============ DETAIL PANEL ============ */}
      {selectedCard && (
        <DetailPanel
          card={selectedCard}
          departments={departments}
          projects={projects}
          orgUsers={orgUsers}
          feedback={feedback.filter((f) => f.card_id === selectedCard.id)}
          profile={profile}
          onClose={() => setSelectedCardId(null)}
          onUpdate={(patch: Partial<Card>) => updateCard(selectedCard.id, patch)}
          onDelete={() => deleteCard(selectedCard.id)}
          onAddFeedback={(fb: Partial<FeedbackEntry>) => addFeedback({ ...fb, card_id: selectedCard.id })}
          onUpdateFeedback={updateFeedbackEntry}
        />
      )}

      {showNewCard && (
        <NewCardModal
          projects={projects}
          departments={departments}
          orgUsers={orgUsers}
          defaultProjectId={
            activeView.type === "project" ? activeView.id! :
            activeView.type === "department" ? (projects.find((p) => p.department_id === activeView.id)?.id || null) :
            null
          }
          onClose={() => setShowNewCard(false)}
          onCreate={(card: Partial<Card>) => { createCard(card); setShowNewCard(false); }}
        />
      )}
    </div>
  );
}

// ====================================================================
// SUB-COMPONENTS
// ====================================================================

function StatCard({ label, value, icon: Icon, gradient, pulse, onClick, active }: { label: string; value: number; icon: any; gradient: string; pulse?: boolean; onClick?: () => void; active?: boolean }) {
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`group relative bg-white/90 border rounded-lg px-3 py-2 transition-all duration-150 overflow-hidden w-full text-left ${
        onClick ? "hover:shadow-sm cursor-pointer" : ""
      } ${active ? "border-primary/50 ring-1 ring-primary/20 bg-white" : "border-line/80 hover:border-line"}`}>
      <div className={`absolute -top-6 -right-6 w-16 h-16 rounded-full bg-gradient-to-br ${gradient} opacity-8 group-hover:opacity-15 transition-opacity duration-300`} />
      <div className="flex items-center justify-between relative">
        <div>
          <div className="text-[9px] text-mute font-semibold uppercase tracking-widest">{label}</div>
          <div className="text-[20px] font-extrabold text-ink leading-tight mt-0.5 tabular-nums font-mono">{value}</div>
        </div>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center ${pulse ? "animate-badgePulse" : ""}`}>
          <Icon size={14} strokeWidth={2.4} className="text-white" />
        </div>
      </div>
    </Tag>
  );
}

function PortfolioHealthBar({ items }: {
  items: { key: string; label: string; value: number; tone: "danger" | "warning" | "info" | "neutral"; icon: any; onClick: () => void }[];
}) {
  const toneStyles = {
    danger: "text-red-700 bg-red-50 border-red-100",
    warning: "text-amber-700 bg-amber-50 border-amber-100",
    info: "text-cyan-700 bg-cyan-50 border-cyan-100",
    neutral: "text-slate-600 bg-slate-50 border-slate-200",
  };

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-line/70 bg-white/80 px-2.5 py-2 shadow-soft">
      <div className="flex items-center gap-1.5 pr-2 border-r border-line/70 text-[10px] font-bold uppercase tracking-wider text-mute">
        <Activity size={12} />
        Portfolio health
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={item.onClick}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-sm ${toneStyles[item.tone]}`}
              title={`Focus ${item.label.toLowerCase()} work`}
            >
              <Icon size={11} strokeWidth={2.4} />
              <span className="tabular-nums font-mono font-bold">{item.value}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, label, badge, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`group relative w-full flex items-center gap-2 px-2 py-[5px] rounded-md text-left text-[11.5px] font-medium mb-px transition-all duration-100 ${
        active
          ? "bg-white shadow-sm border border-line/80 text-ink font-semibold"
          : "text-soft hover:bg-white/60 hover:text-ink"
      }`}>
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-brand-grad" />
      )}
      <div className={`w-5 h-5 rounded flex items-center justify-center transition-colors duration-100 ${
        active ? "bg-primary/10" : "group-hover:bg-slate-100"
      }`}>
        <Icon size={12} strokeWidth={2} className={active ? "text-primary" : "text-mute group-hover:text-ink transition-colors"} />
      </div>
      <span className="flex-1 truncate">{label}</span>
      {badge > 0 && (
        <span className="text-[9px] font-bold text-white bg-brand-grad px-1.5 py-px rounded-full min-w-[16px] text-center shadow-sm">
          {badge}
        </span>
      )}
    </button>
  );
}

function Toolbar({ label, value, onChange, options }: any) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-mute font-semibold">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-line/80 bg-white/80 px-1.5 py-0.5 rounded text-[11px] font-medium text-ink cursor-pointer hover:border-primary/30 transition-colors appearance-auto">
        {options.map(([v, l]: [string, string]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  );
}

function CardListView({ groups, departments, projects, orgUsers, selectedCardId, onSelect }: any) {
  if (groups.length === 0 || groups.every((g: any) => g.cards.length === 0)) {
    return (
      <div className="mt-8 max-w-lg mx-auto bg-white/80 backdrop-blur-sm border border-line/60 rounded-2xl p-10 text-center shadow-subtle animate-fadeIn">
        <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-violet-600 items-center justify-center mb-4 shadow-pop">
          <Sparkles size={24} className="text-white" strokeWidth={2} />
        </div>
        <div className="text-lg font-bold text-ink">Nothing here yet</div>
        <div className="text-sm text-soft mt-2 leading-relaxed max-w-sm mx-auto">
          Create your first card to start tracking work, log feedback at every checkpoint, and chat with your team in real time.
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white/90 rounded-lg mt-2 border border-line/50 overflow-hidden">
      <div className="grid grid-cols-[minmax(220px,2.5fr)_110px_minmax(180px,1.5fr)_110px_70px_80px] gap-2 px-3 py-1.5 border-b border-line/60 text-[9px] font-bold text-mute/60 uppercase tracking-widest sticky top-0 bg-white/95 z-10">
        <div>Title</div><div>Stage</div><div>Progress · Checkpoints</div>
        <div>Assignee</div><div>Priority</div><div>Due</div>
      </div>
      {groups.map((g: any) => (
        <div key={g.key}>
          {g.label && (
            <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 text-[11px] font-semibold text-ink bg-gradient-to-r from-bg to-white border-y border-line/40">
              {g.icon && <g.icon size={11} style={{ color: g.color }} strokeWidth={2} />}
              {!g.icon && g.color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: g.color }} />}
              <span>{g.label}</span>
              {g.sublabel && <span className="text-[10px] text-mute font-medium">· {g.sublabel}</span>}
              <span className="ml-auto text-[9px] font-mono text-mute/50 bg-bg px-1 py-px rounded">{g.cards.length}</span>
            </div>
          )}
          {g.cards.map((card: Card) => (
            <CardRow
              key={card.id}
              card={card}
              departments={departments}
              projects={projects}
              orgUsers={orgUsers}
              selected={card.id === selectedCardId}
              onClick={() => onSelect(card.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ====================================================================
// BOARD VIEW (KANBAN)
// ====================================================================
function BoardView({ visibleCards, departments, projects, orgUsers, selectedCardId, onSelect, onMoveCard, onAddCard }: {
  visibleCards: Card[];
  departments: Department[];
  projects: Project[];
  orgUsers: any[];
  selectedCardId: string | null;
  onSelect: (id: string) => void;
  onMoveCard: (cardId: string, newStage: string) => void;
  onAddCard: () => void;
}) {
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    e.dataTransfer.setData("cardId", cardId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stageId);
  };

  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData("cardId");
    if (cardId) onMoveCard(cardId, stageId);
    setDragOverStage(null);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverStage(null);
    }
  };

  const stageStats = useMemo(() => {
    const stats: Record<string, { total: number; overdue: number; highPriority: number }> = {};
    STAGES.forEach((s) => {
      const sc = visibleCards.filter((c) => c.stage === s.id);
      stats[s.id] = {
        total: sc.length,
        overdue: sc.filter((c) => { const d = daysUntil(c.due_date); return d !== null && d < 0; }).length,
        highPriority: sc.filter((c) => c.priority === "high").length,
      };
    });
    return stats;
  }, [visibleCards]);

  if (visibleCards.length === 0) {
    return (
      <div className="mt-8 max-w-lg mx-auto bg-white/80 backdrop-blur-sm border border-line/60 rounded-2xl p-10 text-center shadow-subtle animate-fadeIn">
        <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-violet-600 items-center justify-center mb-4 shadow-pop">
          <Sparkles size={24} className="text-white" strokeWidth={2} />
        </div>
        <div className="text-lg font-bold text-ink">No cards to display</div>
        <div className="text-sm text-soft mt-2 leading-relaxed">Create your first card to start tracking work.</div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 mt-2 pb-3" style={{ minWidth: `${STAGES.length * 240}px` }}>
      {STAGES.map((stage) => {
        const stageCards = visibleCards.filter((c) => c.stage === stage.id);
        const stats = stageStats[stage.id];
        const SIcon = STAGE_ICONS[stage.id];
        const isOver = dragOverStage === stage.id;

        return (
          <div
            key={stage.id}
            className={`flex flex-col rounded-lg border transition-all duration-150 overflow-hidden ${isOver ? "border-2 ring-2 ring-offset-0" : "border-line/60 bg-white/90"}`}
            style={{
              minWidth: 232, width: 232,
              borderColor: isOver ? stage.color : undefined,
              boxShadow: isOver ? `0 0 0 3px ${stage.color}22` : undefined,
            }}
            onDragOver={(e) => handleDragOver(e, stage.id)}
            onDrop={(e) => handleDrop(e, stage.id)}
            onDragLeave={handleDragLeave}>

            {/* Color band at top */}
            <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${stage.color}, ${stage.color}80)` }} />

            {/* Column header */}
            <div className="px-2.5 pt-2 pb-1.5 border-b border-line/40" style={{ background: stage.bg + "80" }}>
              <div className="flex items-center gap-1.5">
                <div
                  className="flex items-center justify-center w-[18px] h-[18px] rounded"
                  style={{ background: stage.color + "18" }}>
                  <SIcon size={10} strokeWidth={2.4} style={{ color: stage.color }} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: stage.color }}>{stage.name}</span>
                <span
                  className="ml-auto text-[9px] font-mono font-bold px-1 py-px rounded"
                  style={{ background: stats.total > 0 ? stage.color + "15" : "#F1F5F9", color: stats.total > 0 ? stage.color : "#94A3B8" }}>
                  {stats.total}
                </span>
              </div>
              <div className="text-[9px] text-mute italic leading-tight mt-0.5">{stage.desc}</div>
              {(stats.overdue > 0 || stats.highPriority > 0) && (
                <div className="flex gap-1.5 mt-1">
                  {stats.overdue > 0 && (
                    <span className="flex items-center gap-0.5 text-[9px] font-semibold text-red-600 bg-red-50 px-1 py-px rounded">
                      <AlertTriangle size={8} strokeWidth={2.5} /> {stats.overdue} overdue
                    </span>
                  )}
                  {stats.highPriority > 0 && (
                    <span className="flex items-center gap-0.5 text-[9px] font-semibold text-amber-700 bg-amber-50 px-1 py-px rounded">
                      {stats.highPriority} high pri
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto px-1.5 py-1.5 flex flex-col gap-1.5" style={{ maxHeight: "calc(100vh - 220px)" }}>
              {stageCards.length === 0 && (
                <div className="flex flex-col items-center justify-center py-5 text-center">
                  <div className="text-[10px] text-mute italic">No cards here</div>
                  <div className="text-[9px] text-line mt-0.5">Drag a card or add one below</div>
                </div>
              )}
              {stageCards.map((card) => (
                <BoardCard
                  key={card.id}
                  card={card}
                  departments={departments}
                  projects={projects}
                  orgUsers={orgUsers}
                  selected={card.id === selectedCardId}
                  onClick={() => onSelect(card.id)}
                  onDragStart={(e) => handleDragStart(e, card.id)}
                />
              ))}
            </div>

            {/* Footer add button */}
            <div className="px-1.5 py-1.5 border-t border-line">
              <button
                onClick={onAddCard}
                className="w-full flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-mute hover:text-ink hover:bg-bg transition-colors border border-dashed border-line/60">
                <Plus size={11} strokeWidth={2.5} />
                Add Task
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({ card, departments, projects, orgUsers, selected, onClick, onDragStart }: {
  card: Card; departments: Department[]; projects: Project[]; orgUsers: any[];
  selected: boolean; onClick: () => void; onDragStart: (e: React.DragEvent) => void;
}) {
  const project = projects.find((p: Project) => p.id === card.project_id);
  const department = project ? departments.find((d: Department) => d.id === project.department_id) : null;
  const stage = stageById(card.stage);
  const days = daysUntil(card.due_date);
  const overdue = days !== null && days < 0 && card.stage !== "served";
  const dueSoon = days !== null && days >= 0 && days <= 3 && card.stage !== "served";
  const next = nextCheckpoint(card.progress, card.last_feedback);
  const priority = PRIORITIES[card.priority];
  const assignee = orgUsers.find((u: any) => u.id === card.assignee_id);
  const assigneeName = assignee?.name || assignee?.email?.split("@")[0] || null;
  const needsFb = next && card.progress >= next.pct - 5 && card.stage !== "served";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`group relative bg-white rounded-lg border cursor-pointer transition-all duration-100 select-none
        ${selected
          ? "border-primary shadow-md ring-2 ring-primary/20"
          : "border-line hover:border-slate-300 hover:shadow-sm"
        }`}>

      {/* Priority accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-lg"
        style={{ background: priority.color, opacity: card.priority === "low" ? 0.4 : card.priority === "medium" ? 0.65 : 1 }}
      />

      <div className="px-2 pt-2 pb-2">
        {/* Project / dept breadcrumb */}
        {project && (
          <div className="flex items-center gap-1 text-[9px] text-mute font-medium mb-1 truncate">
            {department && (
              <>
                <span className="w-[4px] h-[4px] rounded-full flex-shrink-0" style={{ background: department.color }} />
                <span className="truncate">{department.name}</span>
              </>
            )}
            <span className="truncate">{project.name}</span>
          </div>
        )}

        {/* Title */}
        <div className="text-[11.5px] font-semibold text-ink leading-snug mb-1.5 line-clamp-2">
          {card.title}
        </div>

        {/* Progress bar */}
        <div className="mb-1.5">
          <div className="flex justify-between items-center mb-0.5">
            <span className="text-[9px] text-mute font-medium">Progress</span>
            <span className="font-mono text-[9px] font-bold" style={{ color: stage.color }}>{card.progress}%</span>
          </div>
          <div className="h-[3px] bg-bg rounded-full relative">
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{ width: `${card.progress}%`, background: stage.color }}
            />
          </div>
        </div>

        {/* Meta row: assignee + priority + due */}
        <div className="flex items-center gap-1 flex-wrap">
          {assigneeName && (
            <div className="flex items-center gap-0.5 bg-bg rounded px-1 py-px">
              <div className="w-[12px] h-[12px] rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[7px] font-bold flex items-center justify-center flex-shrink-0">
                {assigneeName[0].toUpperCase()}
              </div>
              <span className="text-[9px] text-mute font-medium truncate max-w-[55px]">{assigneeName}</span>
            </div>
          )}
          <span
            className="text-[9px] font-semibold px-1 py-px rounded"
            style={{ background: priority.bg, color: priority.color }}>
            {priority.label}
          </span>
          {card.due_date && (
            <span className={`flex items-center gap-0.5 text-[9px] font-mono font-medium px-1 py-px rounded ${
              overdue ? "bg-red-50 text-red-600 font-bold" :
              dueSoon ? "bg-amber-50 text-amber-700" :
              "bg-bg text-mute"
            }`}>
              <Clock size={7} strokeWidth={2.5} />
              {overdue ? `${Math.abs(days!)}d late` : dueSoon ? `${days}d` : fmtDate(card.due_date)}
            </span>
          )}
        </div>

        {/* Notes snippet */}
        {card.notes && card.notes.trim().length > 0 && (
          <div className="mt-1 text-[9px] text-mute leading-relaxed line-clamp-1 border-t border-bg pt-1">
            {card.notes}
          </div>
        )}
      </div>
    </div>
  );
}

function CardRow({ card, departments, projects, orgUsers, selected, onClick }: {
  card: Card; departments: Department[]; projects: Project[]; orgUsers: any[];
  selected: boolean; onClick: () => void;
}) {
  const project = projects.find((p: Project) => p.id === card.project_id);
  const department = project ? departments.find((d: Department) => d.id === project.department_id) : null;
  const stage = stageById(card.stage);
  const StageIcon = STAGE_ICONS[card.stage];
  const days = daysUntil(card.due_date);
  const overdue = days !== null && days < 0 && card.stage !== "served";
  const next = nextCheckpoint(card.progress, card.last_feedback);
  const priority = PRIORITIES[card.priority];
  const assignee = orgUsers.find((u: any) => u.id === card.assignee_id);
  const assigneeName = assignee?.name || assignee?.email?.split("@")[0] || "—";

  return (
    <div
      onClick={onClick}
      className={`group grid grid-cols-[minmax(220px,2.5fr)_110px_minmax(180px,1.5fr)_110px_70px_80px] gap-2 px-3 py-1.5 border-b border-line/30 cursor-pointer items-center text-xs transition-all duration-75 ${selected ? "bg-primary/[0.04] border-l-[3px] border-l-primary !pl-[9px]" : "hover:bg-bg/60"}`}>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-ink leading-tight truncate group-hover:text-primary/90 transition-colors flex items-center gap-1">
          {card.is_hidden && <EyeOff size={10} className="text-amber-500 flex-shrink-0" />}
          {card.title}
        </div>
        {project && (
          <div className="flex items-center gap-1 text-[10px] text-mute mt-0.5 font-medium truncate">
            {department && (
              <>
                <span className="w-[4px] h-[4px] rounded-full" style={{ background: department.color }} />
                <span>{department.name}</span>
                <ChevronRight size={8} className="text-line" />
              </>
            )}
            <span>{project.name}</span>
          </div>
        )}
      </div>
      <div>
        <div
          className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-semibold whitespace-nowrap"
          style={{ background: stage.color + "12", color: stage.color }}>
          <StageIcon size={9} strokeWidth={2.2} />
          <span>{stage.name}</span>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-[4px] bg-bg rounded-full relative min-w-[80px] overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${card.progress}%`, background: stage.color }}
            />
            {CHECKPOINTS.map((cp) => (
              <div
                key={cp.pct}
                className="absolute top-[-1px] w-[1.5px] h-[6px] -translate-x-px rounded-sm"
                style={{
                  left: `${cp.pct}%`,
                  background: card.last_feedback && card.last_feedback >= cp.pct ? stage.color : "#CBD5E1",
                }}
              />
            ))}
          </div>
          <div className="font-mono text-[10px] font-semibold text-mute min-w-7 text-right">
            {card.progress}%
          </div>
        </div>
        {next && card.stage !== "served" && (
          <div className="flex items-center gap-1 text-[9px] text-primary/80 mt-0.5 font-medium">
            <CircleDot size={7} strokeWidth={2.5} />
            <span>Next: {next.pct}% · {next.label}</span>
          </div>
        )}
      </div>
      <div>
        <div className="flex items-center gap-1">
          <div className="w-[18px] h-[18px] rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[8px] font-bold flex items-center justify-center flex-shrink-0">
            {assigneeName[0]?.toUpperCase()}
          </div>
          <span className="text-[11px] text-mute font-medium truncate">{assigneeName}</span>
        </div>
      </div>
      <div>
        <span
          className="inline-block px-1.5 py-px rounded text-[9.5px] font-semibold"
          style={{ background: priority.bg, color: priority.color }}>
          {priority.label}
        </span>
      </div>
      <div>
        <span className={`text-[10px] font-mono font-medium ${overdue ? "text-red-600 font-bold" : "text-mute"}`}>
          {fmtDate(card.due_date)}
          {days !== null && days >= 0 && days <= 7 && card.stage !== "served" && (
            <span className="text-mute/70 font-medium"> · {days}d</span>
          )}
        </span>
      </div>
    </div>
  );
}

// ====================================================================
// FEEDBACK LOG VIEW
// ====================================================================
function FeedbackLogView({ feedback, cards, departments, projects, onCardClick }: any) {
  return (
    <div className="grid grid-cols-[1fr_240px] gap-4 mt-3">
      <div className="flex flex-col gap-2">
        {feedback.length === 0 && (
          <div className="py-16 text-center flex flex-col items-center gap-2">
            <MessageSquare size={32} className="text-line" strokeWidth={1.5} />
            <div className="text-sm font-semibold text-ink mt-2">No feedback logged</div>
            <div className="text-[12.5px] text-soft">Open a card and add feedback at a checkpoint.</div>
          </div>
        )}
        {feedback.map((fb: FeedbackEntry) => {
          const card = cards.find((c: Card) => c.id === fb.card_id);
          const cp = CHECKPOINTS.find((c) => c.pct === fb.checkpoint);
          const project = card && projects.find((p: Project) => p.id === card.project_id);
          const department = project && departments.find((d: Department) => d.id === project.department_id);
          return (
            <div
              key={fb.id}
              onClick={() => card && onCardClick(card.id)}
              className="flex gap-3.5 p-4 bg-white border border-line rounded-lg cursor-pointer hover:bg-bg">
              <div className="flex flex-col items-center min-w-[50px]">
                <div className="px-2 py-0.5 bg-ink text-white font-mono text-[11px] font-semibold rounded">
                  {fb.checkpoint}%
                </div>
                <div className="text-[10.5px] text-soft mt-1 font-medium">{cp?.label}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[13px] font-semibold text-ink">{fb.reviewer_name}</span>
                  <span className="text-mute">·</span>
                  <span className="text-[11.5px] text-mute font-mono">{fmtRelative(fb.created_at)}</span>
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10.5px] rounded font-semibold">
                    {fb.lens}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-soft font-medium mb-2">
                  {department && (
                    <span className="w-[5px] h-[5px] rounded-full" style={{ background: department.color }} />
                  )}
                  <span>{card?.title}</span>
                </div>
                <div className="text-[13px] text-ink leading-relaxed mb-1.5">{fb.note}</div>
                {fb.next_action && (
                  <div className="text-xs text-primary font-medium">→ {fb.next_action}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <aside className="bg-white border border-line rounded-lg p-4 self-start sticky top-5">
        <div className="text-[11.5px] font-semibold text-ink mb-2.5 pb-2 border-b border-line uppercase tracking-wide">
          FEEDBACK Lenses
        </div>
        {LENSES.map((l, i) => (
          <div key={i} className="flex items-center gap-2.5 py-1 text-[12.5px]">
            <span className="font-mono text-[11px] font-bold text-primary w-[18px] h-[18px] rounded bg-indigo-50 flex items-center justify-center">
              {l.letter}
            </span>
            <span className="font-medium text-ink">{l.word}</span>
          </div>
        ))}
        <div className="text-[11.5px] font-semibold text-ink mb-2.5 pb-2 border-b border-line uppercase tracking-wide mt-6">
          Checkpoints
        </div>
        {CHECKPOINTS.map((c) => (
          <div key={c.pct} className="flex gap-2.5 py-1.5">
            <span className="font-mono text-[11px] font-bold text-ink min-w-8 bg-bg px-1.5 py-1 rounded h-fit">
              {c.pct}%
            </span>
            <div>
              <div className="text-[12.5px] font-semibold text-ink">{c.label}</div>
              <div className="text-[11px] text-soft mt-0.5">{c.focus}</div>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}

// ====================================================================
// DETAIL PANEL
// ====================================================================
function DetailPanel({ card, departments, projects, orgUsers, feedback, profile, onClose, onUpdate, onDelete, onAddFeedback, onUpdateFeedback }: any) {
  const [activityTab, setActivityTab] = useState<"comments" | "feedback" | "activity">("comments");
  const [tagInput, setTagInput] = useState("");

  // Esc closes the full-screen panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const project = projects.find((p: Project) => p.id === card.project_id);
  const department = project ? departments.find((d: Department) => d.id === project.department_id) : null;
  const stage = stageById(card.stage);
  const days = daysUntil(card.due_date);
  const overdue = days !== null && days < 0 && card.stage !== "served";
  const assignee = orgUsers.find((u: any) => u.id === card.assignee_id);
  const tags: string[] = Array.isArray(card.tags) ? card.tags : [];

  const fmtMins = (mins: number | null) => {
    if (!mins) return "";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m > 0 ? m + "m" : ""}`.trim() : `${m}m`;
  };

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!t || tags.includes(t)) return;
    onUpdate({ tags: [...tags, t] });
    setTagInput("");
  };

  const removeTag = (tag: string) => onUpdate({ tags: tags.filter((t) => t !== tag) });

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-stretch"
      style={{ animation: "fadeIn 0.15s ease" }}
      onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="ml-auto w-full max-w-[1400px] bg-white flex flex-col overflow-hidden"
        style={{ animation: "slideIn 0.22s cubic-bezier(.4,0,.2,1)", boxShadow: "-12px 0 48px rgba(15,23,42,0.12), -4px 0 12px rgba(15,23,42,0.06)" }}>

      {/* ── Header ── */}
      <div className="flex justify-between items-center px-6 py-3.5 border-b border-line/60 bg-gradient-to-r from-[#FAFBFC] to-white">
        <div className="flex items-center gap-2 text-[12px] text-mute font-medium">
          <span className="text-soft">Task</span>
          <ChevronRight size={10} className="text-line" />
          {department && <><span className="w-2 h-2 rounded-full shadow-sm" style={{ background: department.color }} /><span>{department.name}</span><ChevronRight size={10} className="text-line" /></>}
          {project && <span className="text-ink font-semibold">{project.name}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 text-[10px] text-success-dark font-medium bg-success/10 px-2 py-0.5 rounded-full mr-1">
            <CheckCircle2 size={10} strokeWidth={2.5} />
            Auto-saved
          </span>
          <button onClick={onDelete} title="Delete" className="p-1.5 rounded-lg hover:bg-red-50 text-mute hover:text-red-600 transition-all duration-150"><Trash2 size={14} /></button>
          <button onClick={onClose} title="Close (Esc)" className="p-1.5 rounded-lg hover:bg-bg text-soft hover:text-ink transition-all duration-150"><X size={16} /></button>
        </div>
      </div>

      {/* ── Title ── */}
      <div className="px-8 pt-6 pb-2 max-w-[1200px] mx-auto w-full">
        <textarea
          value={card.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          rows={2}
          className="w-full border-none outline-none text-[28px] font-bold text-ink bg-transparent leading-snug resize-none placeholder:text-mute"
          placeholder="Task title"
        />
      </div>

      {/* ── Body: left fields + right activity ── */}
      <div className="flex flex-1 min-h-0 max-w-[1400px] mx-auto w-full">

        {/* ── LEFT: all fields + subtasks + description ── */}
        <div className="w-[480px] flex-shrink-0 border-r border-line overflow-y-auto">

          {/* Field grid — like ClickUp's field table */}
          <div className="px-6 py-3 flex flex-col divide-y divide-line/50">

            {/* Status */}
            <div className="flex items-center py-3 gap-3">
              <div className="w-28 flex items-center gap-1.5 text-[11.5px] text-soft font-semibold flex-shrink-0">
                <CircleDot size={12} className="text-mute" /> Status
              </div>
              <div className="flex gap-1 flex-wrap">
                {STAGES.map((s) => {
                  const SIcon = STAGE_ICONS[s.id];
                  const active = card.stage === s.id;
                  return (
                    <button key={s.id} onClick={() => onUpdate({ stage: s.id })}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-semibold transition-all"
                      style={active ? { borderColor: s.color, background: s.color + "15", color: s.color } : { borderColor: "#E2E8F0", background: "white", color: "#94A3B8" }}>
                      <SIcon size={9} strokeWidth={2.5} />{s.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Progress (read-only) */}
            <div className="flex items-center py-3 gap-3">
              <div className="w-28 flex items-center gap-1.5 text-[11.5px] text-soft font-semibold flex-shrink-0">
                <Activity size={12} className="text-mute" /> Progress
              </div>
              <div className="flex items-center gap-2 flex-1">
                <div className="flex-1 h-1.5 bg-[#F1F5F9] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${card.progress}%`, background: stage.color }} />
                </div>
                <span className="font-mono text-[12px] font-bold" style={{ color: stage.color }}>{card.progress}%</span>
              </div>
            </div>

            {/* Assignee */}
            <div className="flex items-center py-3 gap-3">
              <div className="w-28 flex items-center gap-1.5 text-[11.5px] text-soft font-semibold flex-shrink-0">
                <UserIcon size={12} className="text-mute" /> Assignee
              </div>
              <select value={card.assignee_id || ""} onChange={(e) => onUpdate({ assignee_id: e.target.value || null })}
                className="flex-1 px-2.5 py-1.5 border border-line rounded-lg bg-white text-xs text-ink hover:border-primary/30 transition-colors">
                <option value="">Empty</option>
                {orgUsers.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
              {assignee && (
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                  {(assignee.name || assignee.email)[0].toUpperCase()}
                </div>
              )}
            </div>

            {/* Priority */}
            <div className="flex items-center py-3 gap-3">
              <div className="w-28 flex items-center gap-1.5 text-[11.5px] text-soft font-semibold flex-shrink-0">
                <AlertTriangle size={12} className="text-mute" /> Priority
              </div>
              <div className="flex gap-1.5">
                {(["high", "medium", "low"] as const).map((p) => {
                  const pr = PRIORITIES[p];
                  return (
                    <button key={p} onClick={() => onUpdate({ priority: p })}
                      className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold border transition-colors ${card.priority === p ? "border-transparent" : "border-line bg-white text-mute"}`}
                      style={card.priority === p ? { background: pr.bg, color: pr.color, borderColor: pr.color + "40" } : {}}>
                      {pr.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dates */}
            <div className="flex items-center py-3 gap-3">
              <div className="w-28 flex items-center gap-1.5 text-[11.5px] text-soft font-semibold flex-shrink-0">
                <Calendar size={12} className="text-mute" /> Dates
              </div>
              <div className="flex items-center gap-2 flex-1">
                <input type="date" value={card.start_date || ""} onChange={(e) => onUpdate({ start_date: e.target.value || null })}
                  className="px-2.5 py-1.5 border border-line rounded-lg bg-white text-[11px] text-ink flex-1 hover:border-primary/30 transition-colors" title="Start date" />
                <span className="text-mute text-xs">→</span>
                <input type="date" value={card.due_date || ""} onChange={(e) => onUpdate({ due_date: e.target.value || null })}
                  className="px-2.5 py-1.5 border border-line rounded-lg bg-white text-[11px] text-ink flex-1 hover:border-primary/30 transition-colors" title="Due date" />
                {days !== null && card.stage !== "served" && (
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${overdue ? "bg-red-50 text-red-600" : days <= 3 ? "bg-amber-50 text-amber-700" : "bg-bg text-soft"}`}>
                    {overdue ? `${Math.abs(days)}d late` : `${days}d`}
                  </span>
                )}
              </div>
            </div>

            {/* Time estimate */}
            <div className="flex items-center py-3 gap-3">
              <div className="w-28 flex items-center gap-1.5 text-[11.5px] text-soft font-semibold flex-shrink-0">
                <Timer size={12} className="text-mute" /> Time estimate
              </div>
              <div className="flex items-center gap-2 flex-1">
                <input type="number" min={0} placeholder="mins"
                  value={card.time_estimate_mins ?? ""}
                  onChange={(e) => onUpdate({ time_estimate_mins: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-20 px-2.5 py-1.5 border border-line rounded-lg bg-white text-xs text-ink hover:border-primary/30 transition-colors" />
                {card.time_estimate_mins && (
                  <span className="text-xs text-soft font-medium">{fmtMins(card.time_estimate_mins)}</span>
                )}
              </div>
            </div>

            {/* Tags */}
            <div className="flex items-start py-3 gap-3">
              <div className="w-28 flex items-center gap-1.5 text-[11.5px] text-soft font-semibold flex-shrink-0 mt-1">
                <Tag size={12} className="text-mute" /> Tags
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="flex gap-1.5 flex-wrap">
                  {tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[10.5px] font-semibold border border-indigo-100">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="text-indigo-400 hover:text-indigo-700"><X size={9} /></button>
                    </span>
                  ))}
                  {tags.length === 0 && <span className="text-xs text-mute">Empty</span>}
                </div>
                <div className="flex gap-1.5">
                  <input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); } }}
                    placeholder="Add tag, press Enter"
                    className="flex-1 px-2.5 py-1.5 border border-line rounded-lg bg-white text-[11px] text-ink hover:border-primary/30 transition-colors" />
                  <button onClick={() => addTag(tagInput)} className="px-2.5 py-1.5 bg-primary text-white rounded-lg text-[11px] font-semibold hover:bg-primary/90 transition-colors">+</button>
                </div>
              </div>
            </div>

            {/* Project */}
            <div className="flex items-center py-3 gap-3">
              <div className="w-28 flex items-center gap-1.5 text-[11.5px] text-soft font-semibold flex-shrink-0">
                <Folder size={12} className="text-mute" /> Project
              </div>
              <select value={card.project_id} onChange={(e) => onUpdate({ project_id: e.target.value })}
                className="flex-1 px-2.5 py-1.5 border border-line rounded-lg bg-white text-xs text-ink hover:border-primary/30 transition-colors">
                {projects.map((p: Project) => {
                  const dept = departments.find((d: Department) => d.id === p.department_id);
                  return <option key={p.id} value={p.id}>{dept ? `${dept.name} › ` : ""}{p.name}</option>;
                })}
              </select>
            </div>

            {/* Visibility / Permissions */}
            <div className="flex items-start py-3 gap-3">
              <div className="w-28 flex items-center gap-1.5 text-[11.5px] text-soft font-semibold flex-shrink-0 mt-1">
                <Shield size={12} className="text-mute" /> Visibility
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onUpdate({ is_hidden: !card.is_hidden })}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all ${
                      card.is_hidden
                        ? "bg-amber-50 border-amber-200 text-amber-700"
                        : "bg-white border-line text-soft hover:border-primary/30"
                    }`}>
                    {card.is_hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                    {card.is_hidden ? "Hidden" : "Visible to all"}
                  </button>
                  {card.is_hidden && card.hidden_by === profile.id && (
                    <span className="text-[9px] text-mute">You hid this card</span>
                  )}
                  {card.is_hidden && card.hidden_by !== profile.id && (
                    <span className="text-[9px] text-amber-600">Hidden by owner</span>
                  )}
                </div>
                {card.is_hidden && card.hidden_by === profile.id && (
                  <div className="bg-bg/60 rounded-lg p-2.5 border border-line/60">
                    <div className="text-[10px] text-mute font-semibold mb-1.5">Grant access to:</div>
                    <div className="flex flex-col gap-1">
                      {orgUsers.filter((u: any) => u.id !== profile.id).map((u: any) => {
                        const hasAccess = Array.isArray(card.visible_to) && card.visible_to.includes(u.id);
                        return (
                          <label key={u.id} className="flex items-center gap-2 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={hasAccess}
                              onChange={() => {
                                const current = Array.isArray(card.visible_to) ? [...card.visible_to] : [];
                                const next = hasAccess
                                  ? current.filter((id: string) => id !== u.id)
                                  : [...current, u.id];
                                onUpdate({ visible_to: next });
                              }}
                              className="w-3.5 h-3.5 rounded border-line accent-primary"
                            />
                            <div className="w-[16px] h-[16px] rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[7px] font-bold flex items-center justify-center">
                              {(u.name || u.email)?.[0]?.toUpperCase()}
                            </div>
                            <span className="text-[11px] text-ink font-medium truncate">{u.name || u.email}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Description ── */}
          <div className="px-6 py-4 border-t border-line">
            <div className="text-[11px] font-bold text-mute uppercase tracking-widest mb-2">Description</div>
            <textarea value={card.notes || ""} onChange={(e) => onUpdate({ notes: e.target.value })}
              rows={3} placeholder="Add description, or write with AI…"
              className="w-full px-3 py-2.5 border border-line rounded-lg bg-[#FAFBFC] text-[12.5px] text-ink leading-relaxed resize-y focus:bg-white focus:border-primary/40 transition-colors" />
          </div>

          {/* ── Subtasks ── */}
          <div className="px-6 py-4 border-t border-line">
            <SubtasksPanel cardId={card.id} orgUsers={orgUsers} profile={profile} />
          </div>

          {/* ── Attachments ── */}
          <div className="px-6 py-4 border-t border-line">
            <AttachmentsPanel cardId={card.id} />
          </div>

          {/* ── Embeds ── */}
          <div className="px-6 py-4 border-t border-line">
            <EmbedsPanel card={card} onUpdate={onUpdate} />
          </div>
        </div>

        {/* ── RIGHT: Activity ── */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#FAFBFC]">
          <div className="flex border-b border-line px-4 bg-white">
            {(["comments", "feedback", "activity"] as const).map((t) => (
              <button key={t} onClick={() => setActivityTab(t)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium border-b-2 -mb-px capitalize whitespace-nowrap transition-colors ${activityTab === t ? "text-primary border-primary font-semibold" : "text-soft border-transparent hover:text-ink"}`}>
                {t === "comments" && <MessageCircle size={12} />}
                {t === "feedback" && <MessageSquare size={12} />}
                {t === "activity" && <Activity size={12} />}
                {t}
                {t === "feedback" && feedback.length > 0 && (
                  <span className="text-[9.5px] font-bold bg-primary text-white px-1.5 rounded-full">{feedback.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {activityTab === "comments" && <CommentsTab cardId={card.id} profile={profile} orgUsers={orgUsers} />}
            {activityTab === "feedback" && (
              <FeedbackTab cardFb={feedback} card={card} profile={profile} orgUsers={orgUsers}
                onAdd={onAddFeedback} onUpdate={onUpdateFeedback} />
            )}
            {activityTab === "activity" && <ActivityLog card={card} orgUsers={orgUsers} />}
          </div>
        </div>
      </div>
      </aside>
    </div>
  );
}

// ====================================================================
// SUBTASKS PANEL
// ====================================================================
function SubtasksPanel({ cardId, orgUsers, profile }: { cardId: string; orgUsers: any[]; profile: User }) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/cards/${cardId}/subtasks`)
      .then((r) => r.json())
      .then((j) => setSubtasks(j.subtasks || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cardId]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const createSubtask = async () => {
    if (!newTitle.trim()) { setAdding(false); return; }
    const res = await fetch(`/api/cards/${cardId}/subtasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    if (res.ok) {
      const { subtask } = await res.json();
      setSubtasks((prev) => [...prev, subtask]);
    }
    setNewTitle(""); setAdding(false);
  };

  const patchSubtask = async (id: string, patch: Partial<Subtask>) => {
    setSubtasks((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
    await fetch(`/api/cards/${cardId}/subtasks?subtask_id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  };

  const deleteSubtask = async (id: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/cards/${cardId}/subtasks?subtask_id=${id}`, { method: "DELETE" });
  };

  const completedCount = subtasks.filter((s) => s.completed).length;
  const overallPct = subtasks.length > 0 ? Math.round((completedCount / subtasks.length) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <ListChecks size={13} className="text-mute" />
          <span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Sub-activities</span>
          {subtasks.length > 0 && (
            <span className="text-[10.5px] font-mono text-soft">{completedCount}/{subtasks.length}</span>
          )}
        </div>
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors">
          <Plus size={11} strokeWidth={2.5} /> Add subtask
        </button>
      </div>

      {/* Overall progress bar */}
      {subtasks.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1.5 bg-[#F1F5F9] rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-[width] duration-300" style={{ width: `${overallPct}%` }} />
          </div>
          <span className="text-[10.5px] font-mono text-emerald-600 font-bold">{overallPct}%</span>
        </div>
      )}

      {loading && <div className="py-3 text-center text-xs text-mute">Loading…</div>}

      <div className="flex flex-col gap-1.5">
        {subtasks.map((sub) => (
          <div key={sub.id} className={`group flex flex-col gap-2 p-2.5 rounded-lg border transition-colors ${sub.completed ? "bg-[#F8FAFC] border-[#E2E8F0]" : "bg-white border-line hover:border-slate-300"}`}>
            <div className="flex items-start gap-2">
              {/* Checkbox */}
              <button
                onClick={() => patchSubtask(sub.id, { completed: !sub.completed, progress: sub.completed ? 0 : 100 })}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${sub.completed ? "bg-emerald-500 border-emerald-500" : "border-slate-300 hover:border-emerald-400"}`}>
                {sub.completed && <Check size={9} className="text-white" strokeWidth={3} />}
              </button>

              {/* Title */}
              {editingId === sub.id ? (
                <input
                  autoFocus
                  defaultValue={sub.title}
                  onBlur={(e) => { patchSubtask(sub.id, { title: e.target.value }); setEditingId(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingId(null); }}
                  className="flex-1 text-[12.5px] font-medium text-ink border-b border-primary outline-none bg-transparent"
                />
              ) : (
                <span
                  onDoubleClick={() => setEditingId(sub.id)}
                  className={`flex-1 text-[12.5px] font-medium leading-snug cursor-text ${sub.completed ? "line-through text-mute" : "text-ink"}`}>
                  {sub.title}
                </span>
              )}

              {/* Delete on hover */}
              <button onClick={() => deleteSubtask(sub.id)} className="opacity-0 group-hover:opacity-100 text-mute hover:text-red-500 transition-all flex-shrink-0">
                <X size={12} />
              </button>
            </div>

            {/* Progress meter + assignee */}
            <div className="pl-6 flex items-center gap-3">
              <div className="flex items-center gap-1.5 flex-1">
                <div className="flex gap-1">
                  {[0, 25, 50, 75, 100].map((pct) => (
                    <button key={pct} onClick={() => patchSubtask(sub.id, { progress: pct, completed: pct === 100 })}
                      className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold border transition-colors ${sub.progress === pct ? "bg-emerald-500 text-white border-transparent" : "border-line text-mute bg-white hover:border-slate-300"}`}>
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <select value={sub.assignee_id || ""} onChange={(e) => patchSubtask(sub.id, { assignee_id: e.target.value || null })}
                className="text-[10.5px] border border-line rounded bg-white text-soft px-1.5 py-0.5 max-w-[100px]">
                <option value="">Unassigned</option>
                {orgUsers.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
            </div>

            {/* Mini progress bar */}
            {!sub.completed && sub.progress > 0 && (
              <div className="pl-6">
                <div className="h-1 bg-[#F1F5F9] rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-[width] duration-300" style={{ width: `${sub.progress}%` }} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New subtask input */}
      {adding && (
        <div className="flex items-center gap-2 mt-2 p-2.5 rounded-lg border border-primary/30 bg-primary/5">
          <div className="w-4 h-4 rounded border-2 border-slate-300 flex-shrink-0" />
          <input
            ref={inputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createSubtask(); if (e.key === "Escape") { setAdding(false); setNewTitle(""); } }}
            placeholder="Sub-activity name… (Enter to save)"
            className="flex-1 text-[12.5px] font-medium text-ink outline-none bg-transparent"
          />
          <button onClick={createSubtask} className="px-2 py-1 bg-primary text-white rounded text-[11px] font-semibold">Save</button>
          <button onClick={() => { setAdding(false); setNewTitle(""); }} className="text-mute hover:text-ink"><X size={13} /></button>
        </div>
      )}
    </div>
  );
}

// ====================================================================
// ATTACHMENTS PANEL
// ====================================================================
type Attachment = {
  id: string;
  card_id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  url: string | null;
};

function AttachmentsPanel({ cardId }: { cardId: string }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/cards/${cardId}/attachments`)
      .then(r => r.json())
      .then(j => setAttachments(j.attachments || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cardId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert("File too large (max 25 MB)"); return; }
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await fetch(`/api/cards/${cardId}/attachments`, { method: "POST", body: form });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "Upload failed"); return; }
      const { attachment } = await r.json();
      setAttachments(prev => [attachment, ...prev]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    const r = await fetch(`/api/cards/${cardId}/attachments?attachment_id=${id}`, { method: "DELETE" });
    if (!r.ok) { alert("Delete failed"); return; }
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const fmtSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const fileIcon = (ct: string | null) => {
    if (!ct) return "📄";
    if (ct.startsWith("image/")) return "🖼️";
    if (ct.includes("pdf")) return "📕";
    if (ct.includes("spreadsheet") || ct.includes("excel") || ct.includes("csv")) return "📊";
    if (ct.includes("document") || ct.includes("word")) return "📝";
    if (ct.includes("zip") || ct.includes("archive")) return "📦";
    return "📄";
  };

  // Office files (.docx, .xlsx, .pptx) can't be opened by the browser directly.
  // Route them through Microsoft's Office Online viewer so the user can preview
  // in the browser instead of downloading.
  const isOfficeDoc = (filename: string) => /\.(docx?|xlsx?|pptx?)$/i.test(filename);
  const viewerUrl = (att: Attachment): string | null => {
    if (!att.url) return null;
    if (isOfficeDoc(att.filename)) {
      return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(att.url)}`;
    }
    return att.url;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Paperclip size={13} className="text-mute" />
          <span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Attachments</span>
          {attachments.length > 0 && (
            <span className="text-[10.5px] font-mono text-soft">{attachments.length}</span>
          )}
        </div>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors disabled:opacity-50">
          {uploading ? (
            <><span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Uploading…</>
          ) : (
            <><Plus size={11} strokeWidth={2.5} /> Upload file</>
          )}
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
      </div>

      {loading && <div className="py-3 text-center text-xs text-mute">Loading…</div>}

      {!loading && attachments.length === 0 && (
        <div className="py-4 text-center text-xs text-mute italic">No attachments yet</div>
      )}

      <div className="flex flex-col gap-1.5">
        {attachments.map(att => {
          const openUrl = viewerUrl(att);
          const isOffice = isOfficeDoc(att.filename);
          return (
            <div key={att.id} className="group flex items-center gap-2.5 p-2.5 rounded-lg border border-line bg-white hover:border-slate-300 transition-colors">
              <span className="text-base flex-shrink-0">{fileIcon(att.content_type)}</span>
              <div className="flex-1 min-w-0">
                {openUrl ? (
                  <a href={openUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[12px] font-medium text-primary hover:underline truncate block"
                    title={isOffice ? "Open in Office Online viewer" : "Open in new tab"}>
                    {att.filename}
                  </a>
                ) : (
                  <span className="text-[12px] font-medium text-ink truncate block">{att.filename}</span>
                )}
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-mute">
                  {att.size_bytes && <span>{fmtSize(att.size_bytes)}</span>}
                  <span>{fmtRelative(att.created_at)}</span>
                  {isOffice && <span className="text-primary/70 font-semibold">opens in Office viewer</span>}
                </div>
              </div>
              {att.url && (
                <a href={att.url} download={att.filename}
                  className="opacity-0 group-hover:opacity-100 text-mute hover:text-primary p-1 transition-all" title="Download">
                  <Link2 size={12} />
                </a>
              )}
              <button onClick={() => handleDelete(att.id)}
                className="opacity-0 group-hover:opacity-100 text-mute hover:text-red-500 p-1 transition-all" title="Delete">
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ====================================================================
// EMBEDS PANEL — paste any URL, render as an iframe in the card
// ====================================================================
type Embed = { id: string; url: string; title?: string; created_at?: string };

// ====================================================================
// EMBEDS BAR — compact embed list for dept/team/project view headers
// ====================================================================
function EmbedsBar({ embeds, onChange }: { embeds: Embed[]; onChange: (embeds: Embed[]) => void | Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const addEmbed = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    let normalised = trimmed;
    if (!/^https?:\/\//i.test(normalised)) normalised = "https://" + normalised;
    const safeUrl = normalizeHttpUrl(normalised);
    if (!safeUrl) { alert("Use a valid http(s) URL without embedded credentials."); return; }
    const next: Embed = {
      id: Math.random().toString(36).slice(2, 10),
      url: safeUrl,
      title: title.trim() || undefined,
      created_at: new Date().toISOString(),
    };
    onChange([next, ...embeds]);
    setUrl(""); setTitle(""); setAdding(false);
  };

  const removeEmbed = (id: string) => {
    onChange(embeds.filter((e) => e.id !== id));
    if (openId === id) setOpenId(null);
  };

  const hostOf = (u: string) => {
    try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; }
  };

  if (embeds.length === 0 && !adding) {
    return (
      <div className="mt-3 flex items-center justify-end">
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors">
          <Plus size={11} strokeWidth={2.5} /> Embed link
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-mute uppercase tracking-wider mr-1">
          <Link2 size={12} /> Embeds
        </div>
        {embeds.map((emb) => {
          const isOpen = openId === emb.id;
          return (
            <div key={emb.id} className="group flex items-center gap-1.5 px-2 py-1 rounded-lg border border-line bg-white hover:border-primary/40 transition-colors">
              <button
                onClick={() => setOpenId(isOpen ? null : emb.id)}
                className={`text-[11px] font-semibold transition-colors ${isOpen ? "text-primary" : "text-ink hover:text-primary"}`}>
                {emb.title || hostOf(emb.url)}
              </button>
              <a href={emb.url} target="_blank" rel="noopener noreferrer"
                className="text-mute hover:text-primary opacity-60 group-hover:opacity-100 transition-opacity" title="Open in new tab">
                <Link2 size={10} />
              </a>
              <button onClick={() => removeEmbed(emb.id)}
                className="text-mute hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Remove">
                <X size={10} />
              </button>
            </div>
          );
        })}
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors">
          <Plus size={11} strokeWidth={2.5} /> Add
        </button>
      </div>

      {adding && (
        <div className="mt-2 flex flex-wrap gap-2 items-center p-2.5 rounded-lg border border-primary/30 bg-primary/5">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addEmbed(); if (e.key === "Escape") { setAdding(false); setUrl(""); setTitle(""); } }}
            placeholder="Paste URL"
            className="flex-1 min-w-[240px] px-2.5 py-1.5 border border-line rounded bg-white text-[12px] text-ink"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addEmbed(); }}
            placeholder="Optional title"
            className="w-44 px-2.5 py-1.5 border border-line rounded bg-white text-[12px] text-ink"
          />
          <button onClick={addEmbed}
            className="px-3 py-1.5 bg-brand-grad text-white text-[11px] font-bold rounded-lg shadow-soft">Embed</button>
          <button onClick={() => { setAdding(false); setUrl(""); setTitle(""); }}
            className="px-2 py-1 text-[11px] font-semibold text-soft hover:text-ink">Cancel</button>
        </div>
      )}

      {openId && (() => {
        const emb = embeds.find((e) => e.id === openId);
        if (!emb) return null;
        return (
          <div className="mt-2 rounded-lg border border-line overflow-hidden bg-white">
            <div className="flex items-center justify-between px-3 py-2 border-b border-line bg-[#FAFBFC]">
              <div className="flex items-center gap-2 min-w-0">
                <Link2 size={12} className="text-primary flex-shrink-0" />
                <span className="text-[12px] font-semibold text-ink truncate">{emb.title || hostOf(emb.url)}</span>
                <a href={emb.url} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-primary hover:underline truncate">{emb.url}</a>
              </div>
              <button onClick={() => setOpenId(null)} className="text-soft hover:text-ink"><X size={14} /></button>
            </div>
            <iframe
              src={emb.url}
              title={emb.title || emb.url}
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-presentation"
              referrerPolicy="no-referrer"
              className="w-full h-[480px] bg-white"
            />
            <div className="px-3 py-1.5 text-[10px] text-mute border-t border-line">
              Some sites (Google, GitHub) block iframe embedding. If blank, use the open icon to view in a new tab.
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function EmbedsPanel({ card, onUpdate }: { card: any; onUpdate: (patch: any) => void }) {
  const embeds: Embed[] = Array.isArray(card.embeds) ? card.embeds : [];
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const addEmbed = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    let normalised = trimmed;
    if (!/^https?:\/\//i.test(normalised)) normalised = "https://" + normalised;
    const safeUrl = normalizeHttpUrl(normalised);
    if (!safeUrl) { alert("Use a valid http(s) URL without embedded credentials."); return; }
    const next: Embed = {
      id: Math.random().toString(36).slice(2, 10),
      url: safeUrl,
      title: title.trim() || undefined,
      created_at: new Date().toISOString(),
    };
    onUpdate({ embeds: [next, ...embeds] });
    setUrl(""); setTitle(""); setAdding(false);
    setOpenId(next.id);
  };

  const removeEmbed = (id: string) => {
    onUpdate({ embeds: embeds.filter((e) => e.id !== id) });
    if (openId === id) setOpenId(null);
  };

  const hostOf = (u: string) => {
    try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Link2 size={13} className="text-mute" />
          <span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Embeds</span>
          {embeds.length > 0 && (
            <span className="text-[10.5px] font-mono text-soft">{embeds.length}</span>
          )}
        </div>
        <button onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors">
          <Plus size={11} strokeWidth={2.5} /> Embed link
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 mb-3 p-2.5 rounded-lg border border-primary/30 bg-primary/5">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addEmbed(); if (e.key === "Escape") { setAdding(false); setUrl(""); setTitle(""); } }}
            placeholder="Paste URL (YouTube, Figma, Google Docs, anything…)"
            className="w-full px-2.5 py-1.5 border border-line rounded bg-white text-[12px] text-ink"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addEmbed(); }}
            placeholder="Optional title"
            className="w-full px-2.5 py-1.5 border border-line rounded bg-white text-[12px] text-ink"
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => { setAdding(false); setUrl(""); setTitle(""); }}
              className="px-2.5 py-1 text-[11px] font-semibold text-soft hover:text-ink">Cancel</button>
            <button onClick={addEmbed}
              className="px-3 py-1 bg-brand-grad text-white text-[11px] font-bold rounded-lg shadow-soft">Embed</button>
          </div>
        </div>
      )}

      {!adding && embeds.length === 0 && (
        <div className="py-4 text-center text-xs text-mute italic">No embeds yet</div>
      )}

      <div className="flex flex-col gap-1.5">
        {embeds.map((emb) => {
          const isOpen = openId === emb.id;
          return (
            <div key={emb.id} className="rounded-lg border border-line bg-white overflow-hidden">
              <div className="group flex items-center gap-2.5 p-2.5">
                <button
                  onClick={() => setOpenId(isOpen ? null : emb.id)}
                  className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center transition ${isOpen ? "bg-primary text-white" : "bg-bg text-mute hover:bg-primary/10 hover:text-primary"}`}
                  title={isOpen ? "Collapse" : "Preview"}>
                  {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-ink truncate">{emb.title || hostOf(emb.url)}</div>
                  <a href={emb.url} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline truncate block">
                    {emb.url}
                  </a>
                </div>
                <a href={emb.url} target="_blank" rel="noopener noreferrer"
                  className="opacity-0 group-hover:opacity-100 text-mute hover:text-primary p-1 transition-all"
                  title="Open in new tab">
                  <Link2 size={12} />
                </a>
                <button onClick={() => removeEmbed(emb.id)}
                  className="opacity-0 group-hover:opacity-100 text-mute hover:text-red-500 p-1 transition-all"
                  title="Remove">
                  <Trash2 size={12} />
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-line bg-[#FAFBFC]">
                  <iframe
                    src={emb.url}
                    title={emb.title || emb.url}
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-presentation"
                    referrerPolicy="no-referrer"
                    className="w-full h-[420px] bg-white"
                  />
                  <div className="px-2.5 py-1.5 text-[10px] text-mute border-t border-line bg-white">
                    Some sites block embedding (Google, GitHub, etc.). If blank, click the open icon to view in a new tab.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 py-2.5 border-b border-bg last:border-0">
      <div className="text-[10.5px] font-semibold text-mute uppercase tracking-wider">{label}</div>
      {children}
    </div>
  );
}

type ActivityRow = {
  id: string;
  event_type: string;
  user_name: string;
  payload: Record<string, any>;
  created_at: string;
};

const STAGE_LABELS: Record<string, string> = {
  on_order: "On Order", prep_table: "Prep Table", front_burner: "Front Burner",
  back_burner: "Back Burner", pass_qa: "Pass — QA", served: "Completed",
};

function activityLabel(ev: ActivityRow): { text: string; icon: string; color: string } {
  const who = ev.user_name;
  const p = ev.payload;
  switch (ev.event_type) {
    case "card_created":     return { text: `${who} created this card`, icon: "create", color: "bg-primary/10 text-primary" };
    case "stage_changed":    return { text: `${who} moved to ${STAGE_LABELS[p.to] ?? p.to}`, icon: "stage", color: "bg-blue-50 text-blue-600" };
    case "assignee_changed": return { text: p.assignee_id ? `${who} assigned this card` : `${who} removed assignee`, icon: "assignee", color: "bg-violet-50 text-violet-600" };
    case "priority_changed": return { text: `${who} changed priority to ${p.to}`, icon: "priority", color: "bg-amber-50 text-amber-600" };
    case "due_date_changed": return { text: p.due_date ? `${who} set due date to ${p.due_date}` : `${who} cleared due date`, icon: "date", color: "bg-orange-50 text-orange-600" };
    case "start_date_changed": return { text: p.start_date ? `${who} set start date to ${p.start_date}` : `${who} cleared start date`, icon: "date", color: "bg-orange-50 text-orange-600" };
    case "title_changed":    return { text: `${who} renamed card`, icon: "edit", color: "bg-slate-100 text-slate-600" };
    case "tags_changed":     return { text: `${who} updated tags`, icon: "tag", color: "bg-indigo-50 text-indigo-600" };
    case "estimate_changed": return { text: `${who} set time estimate to ${p.mins ? Math.floor(p.mins/60)+"h "+(p.mins%60)+"m" : "none"}`, icon: "time", color: "bg-teal-50 text-teal-600" };
    case "subtask_added":    return { text: `${who} added sub-activity "${p.title}"`, icon: "subtask", color: "bg-emerald-50 text-emerald-600" };
    case "subtask_completed": return { text: `${who} completed "${p.title}"`, icon: "check", color: "bg-emerald-50 text-emerald-700" };
    case "subtask_progress": return { text: `${who} updated "${p.title}" to ${p.progress}%`, icon: "progress", color: "bg-emerald-50 text-emerald-600" };
    case "subtask_deleted":  return { text: `${who} removed sub-activity "${p.title}"`, icon: "delete", color: "bg-red-50 text-red-500" };
    case "comment_added":    return { text: `${who} commented: "${p.preview}"`, icon: "comment", color: "bg-sky-50 text-sky-600" };
    case "feedback_logged":  return { text: `${who} logged ${p.checkpoint}% feedback (${p.lens})`, icon: "feedback", color: "bg-amber-50 text-amber-700" };
    case "feedback_responded": return { text: `${who} responded to feedback`, icon: "response", color: "bg-emerald-50 text-emerald-600" };
    case "feedback_routed":  return { text: `${who} routed feedback`, icon: "route", color: "bg-purple-50 text-purple-600" };
    case "feedback_resolved": return { text: `${who} resolved feedback`, icon: "resolve", color: "bg-emerald-50 text-emerald-800" };
    default: return { text: `${who} performed ${ev.event_type}`, icon: "default", color: "bg-bg text-soft" };
  }
}

function ActivityIcon({ icon, colorClass }: { icon: string; colorClass: string }) {
  const cls = `w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${colorClass}`;
  if (icon === "create")    return <div className={cls}><Plus size={9} strokeWidth={2.5} /></div>;
  if (icon === "stage")     return <div className={cls}><Activity size={9} /></div>;
  if (icon === "assignee")  return <div className={cls}><UserIcon size={9} /></div>;
  if (icon === "priority")  return <div className={cls}><AlertTriangle size={9} /></div>;
  if (icon === "date")      return <div className={cls}><Calendar size={9} /></div>;
  if (icon === "edit")      return <div className={cls}><Hash size={9} /></div>;
  if (icon === "tag")       return <div className={cls}><Tag size={9} /></div>;
  if (icon === "time")      return <div className={cls}><Timer size={9} /></div>;
  if (icon === "subtask" || icon === "progress") return <div className={cls}><ListChecks size={9} /></div>;
  if (icon === "check" || icon === "resolve") return <div className={cls}><Check size={9} strokeWidth={3} /></div>;
  if (icon === "delete")    return <div className={cls}><X size={9} /></div>;
  if (icon === "comment")   return <div className={cls}><MessageCircle size={9} /></div>;
  if (icon === "feedback")  return <div className={cls}><MessageSquare size={9} /></div>;
  if (icon === "response")  return <div className={cls}><Check size={9} /></div>;
  if (icon === "route")     return <div className={cls}><CornerDownRight size={9} /></div>;
  return <div className={cls}><CircleDot size={9} /></div>;
}

function ActivityLog({ card, orgUsers }: { card: Card; orgUsers: any[] }) {
  const [events, setEvents] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cards/${card.id}/activity`)
      .then((r) => r.json())
      .then((j) => setEvents(j.activity || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [card.id]);

  // Real-time: append new activity events as they arrive
  useEffect(() => {
    const sb = createBrowserClient();
    const channel = sb
      .channel(`activity-${card.id}`)
      .on("postgres_changes" as any, {
        event: "INSERT", schema: "public", table: "card_activity",
        filter: `card_id=eq.${card.id}`,
      }, (payload: any) => {
        const row = payload.new as ActivityRow;
        setEvents((prev) => [row, ...prev]);
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [card.id]);

  if (loading) return <div className="py-8 text-center text-xs text-mute">Loading activity…</div>;
  if (events.length === 0) {
    return (
      <div className="py-8 text-center flex flex-col items-center gap-2">
        <Activity size={24} className="text-line" strokeWidth={1.5} />
        <div className="text-xs text-mute">No activity yet. Changes will appear here.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Card creation anchor at bottom */}
      <div className="flex items-start gap-2.5 pb-4">
        <div className="flex flex-col items-center">
          <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <Plus size={9} strokeWidth={2.5} />
          </div>
          <div className="w-px flex-1 bg-line mt-1" style={{ minHeight: 16 }} />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="text-[12px] text-ink leading-snug">Card created</div>
          <div className="text-[10.5px] text-mute font-mono mt-0.5">{fmtRelative(card.created_at)}</div>
        </div>
      </div>

      {[...events].reverse().map((ev, i) => {
        const { text, icon, color } = activityLabel(ev);
        const isLast = i === events.length - 1;
        return (
          <div key={ev.id} className="flex items-start gap-2.5 pb-4">
            <div className="flex flex-col items-center">
              <ActivityIcon icon={icon} colorClass={color} />
              {!isLast && <div className="w-px flex-1 bg-line mt-1" style={{ minHeight: 16 }} />}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="text-[12px] text-ink leading-snug">{text}</div>
              <div className="text-[10.5px] text-mute font-mono mt-0.5">{fmtRelative(ev.created_at)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}



function Field({ label, children }: { label: any; children: any }) {
  return (
    <div className="mb-3.5 flex-1 min-w-0">
      <label className="block text-[11px] font-semibold text-soft uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

const FEEDBACK_STATUS_STYLES: Record<FeedbackStatus, { label: string; bg: string; color: string }> = {
  open:             { label: "Open",         bg: "#F1F5F9", color: "#64748B" },
  pending_response: { label: "Awaiting Reply", bg: "#FEF3C7", color: "#92400E" },
  responded:        { label: "Response In",  bg: "#D1FAE5", color: "#065F46" },
  resolved:         { label: "Resolved",     bg: "#F0FDF4", color: "#16A34A" },
};

function FeedbackTab({ cardFb, card, profile, orgUsers, onAdd, onUpdate }: any) {
  const [checkpoint, setCheckpoint] = useState(
    card.progress >= 80 ? 90 : card.progress >= 60 ? 70 : card.progress >= 40 ? 50 : card.progress >= 20 ? 30 : 10
  );
  const [lens, setLens] = useState("Clarity");
  const [note, setNote] = useState("");
  const [action, setAction] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");

  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!note.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd({ checkpoint, lens, note, next_action: action, assigned_to_id: assignTo || undefined });
      setNote(""); setAction(""); setAssignTo("");
      emitToast({ message: assignTo ? "Feedback sent & assigned." : "Feedback added.", type: "success" });
    } catch {
      // parent already toasts on failure; keep form values so user can retry
    } finally {
      setBusy(false);
    }
  };

  const submitResponse = async (fb: FeedbackEntry) => {
    if (!responseText.trim()) return;
    try {
      const updated = await api.patchFeedback(fb.id, { action: "respond", response: responseText });
      onUpdate(updated);
      setRespondingId(null);
      setResponseText("");
      emitToast({ message: "Response submitted.", type: "success" });
    } catch (e) {
      console.error(e);
      emitToast({ message: "Could not save your response. Please try again.", type: "warning", from: "Feedback failed" });
    }
  };

  const submitResolve = async (fb: FeedbackEntry) => {
    try {
      const updated = await api.patchFeedback(fb.id, { action: "resolve" });
      onUpdate(updated);
      emitToast({ message: "Feedback marked resolved.", type: "success" });
    } catch (e) {
      console.error(e);
      emitToast({ message: "Could not mark resolved. Please try again.", type: "warning", from: "Feedback failed" });
    }
  };

  return (
    <>
      <div className="p-3.5 bg-bg rounded-md border border-line mb-4">
        <div className="text-[13px] font-semibold mb-3 text-ink">Log feedback</div>
        <div className="flex gap-2.5">
          <Field label="Checkpoint">
            <select
              value={checkpoint}
              onChange={(e) => setCheckpoint(parseInt(e.target.value))}
              className="w-full px-2.5 py-1.5 border border-line rounded bg-white text-xs text-ink">
              {CHECKPOINTS.map((c) => (
                <option key={c.pct} value={c.pct}>{c.pct}% — {c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Lens">
            <select
              value={lens}
              onChange={(e) => setLens(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-line rounded bg-white text-xs text-ink">
              {LENSES.map((l, i) => <option key={i} value={l.word}>{l.word}</option>)}
              <option>Consistency</option>
              <option>Other</option>
            </select>
          </Field>
        </div>
        <Field label="Note">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full px-2.5 py-2 border border-line rounded bg-white text-xs text-ink leading-relaxed resize-y"
            placeholder="What did you observe?"
          />
        </Field>
        <Field label="Next Action">
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-line rounded bg-white text-xs text-ink"
            placeholder="What's the next move?"
          />
        </Field>
        <Field label="Assign to (optional)">
          <select
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-line rounded bg-white text-xs text-ink">
            <option value="">— No assignment —</option>
            {(orgUsers as OrgUser[]).filter((u) => u.id !== profile.id).map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
        </Field>
        {assignTo && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mb-2">
            <CornerDownRight size={11} />
            <span>This feedback will be routed to the selected person for action.</span>
          </div>
        )}
        <button
          onClick={submit}
          disabled={busy || !note.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded shadow-sm disabled:opacity-50">
          <Plus size={13} strokeWidth={2.5} />
          {busy ? "Saving…" : assignTo ? "Send & Assign" : "Add feedback"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {cardFb.length === 0 && (
          <div className="py-6 text-center text-mute text-xs italic">No feedback yet on this card.</div>
        )}
        {(cardFb as FeedbackEntry[]).map((fb) => {
          const statusStyle = FEEDBACK_STATUS_STYLES[fb.status] ?? FEEDBACK_STATUS_STYLES.open;
          const assignee = fb.assigned_to_id ? (orgUsers as OrgUser[]).find((u) => u.id === fb.assigned_to_id) : null;
          const isMyResponse = fb.assigned_to_id === profile.id && fb.status === "pending_response";
          const canResolve = fb.reviewer_id === profile.id && fb.status === "responded";
          return (
            <div key={fb.id} className="p-3 bg-white border border-line rounded border-l-[3px] border-l-primary">
              <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                <span className="px-1.5 py-0.5 bg-ink text-white font-mono text-[10.5px] font-semibold rounded">
                  {fb.checkpoint}%
                </span>
                <span className="text-xs font-semibold text-ink">{fb.reviewer_name}</span>
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10.5px] rounded font-semibold">
                  {fb.lens}
                </span>
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-semibold"
                  style={{ background: statusStyle.bg, color: statusStyle.color }}>
                  {statusStyle.label}
                </span>
                <span className="ml-auto text-[10.5px] text-mute font-mono">{fmtRelative(fb.created_at)}</span>
              </div>
              <div className="text-xs leading-relaxed text-soft mb-1.5">{fb.note}</div>
              {fb.next_action && (
                <div className="text-[11.5px] text-primary font-medium mb-1.5">→ {fb.next_action}</div>
              )}
              {assignee && (
                <div className="flex items-center gap-1.5 text-[11px] text-soft mb-1.5">
                  <CornerDownRight size={10} className="text-mute" />
                  <span>Assigned to <strong className="text-ink">{assignee.name || assignee.email}</strong></span>
                </div>
              )}
              {fb.response && (
                <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded text-xs text-ink leading-relaxed">
                  <div className="text-[10.5px] font-semibold text-emerald-700 mb-1 flex items-center gap-1">
                    <Check size={10} /> Response from {assignee?.name || "assignee"} · {fb.responded_at ? fmtRelative(fb.responded_at) : ""}
                  </div>
                  {fb.response}
                </div>
              )}
              {isMyResponse && respondingId !== fb.id && (
                <button
                  onClick={() => { setRespondingId(fb.id); setResponseText(""); }}
                  className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 text-white text-[11px] font-semibold rounded">
                  <Check size={11} /> Write Response
                </button>
              )}
              {isMyResponse && respondingId === fb.id && (
                <div className="mt-2">
                  <textarea
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    rows={3}
                    className="w-full px-2.5 py-2 border border-line rounded bg-white text-xs text-ink leading-relaxed resize-y mb-2"
                    placeholder="Write your response or action taken…"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => submitResponse(fb)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded">
                      <Check size={12} /> Submit Response
                    </button>
                    <button
                      onClick={() => setRespondingId(null)}
                      className="px-3 py-1.5 text-xs text-soft border border-line rounded">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {canResolve && (
                <button
                  onClick={() => submitResolve(fb)}
                  className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-100 text-green-800 text-[11px] font-semibold rounded border border-green-200">
                  <CheckCircle2 size={11} /> Mark Resolved
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ====================================================================
// COMMENTS TAB (card-level chat with @mentions)
// ====================================================================
function CommentsTab({ cardId, profile, orgUsers }: {
  cardId: string;
  profile: User;
  orgUsers: OrgUser[];
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/messages?card_id=${cardId}`)
      .then((r) => r.json())
      .then((j) => setMessages(j.messages || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cardId]);

  // Real-time subscription for card comments
  useEffect(() => {
    const sb = createBrowserClient();
    const channel = sb
      .channel(`comments-${cardId}`)
      .on("postgres_changes" as any, {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `card_id=eq.${cardId}`,
      }, (payload: any) => {
        const msg = payload.new as Message;
        setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
        // Toast for messages from others
        if (msg.author_id !== profile.id) {
          const sender = orgUsers.find((u) => u.id === msg.author_id);
          const name = sender?.name || sender?.email?.split("@")[0] || "Someone";
          emitToast({ message: msg.content.slice(0, 70), type: "info", from: name });
        }
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [cardId, profile.id, orgUsers]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim()) return;
    const content = input;
    setInput("");
    try {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: cardId, content }),
      });
      if (r.ok) {
        const { message } = await r.json();
        setMessages((prev) => prev.some((m) => m.id === message.id) ? prev : [...prev, message]);
      }
    } catch {}
  };

  if (loading) {
    return <div className="py-8 text-center text-xs text-mute">Loading comments…</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {messages.length === 0 && (
        <div className="py-8 text-center flex flex-col items-center gap-1.5">
          <MessageCircle size={24} className="text-line" strokeWidth={1.5} />
          <div className="text-xs text-mute">No comments yet. Start the discussion.</div>
        </div>
      )}
      {messages.map((msg) => {
        const author = orgUsers.find((u) => u.id === msg.author_id);
        const isMe = msg.author_id === profile.id;
        return (
          <div key={msg.id} className="flex items-start gap-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {(author?.name || author?.email || "?")[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[11.5px] font-semibold text-ink">
                  {isMe ? "You" : (author?.name || author?.email?.split("@")[0] || "?")}
                </span>
                <span className="text-[10.5px] text-mute font-mono">{fmtRelative(msg.created_at)}</span>
              </div>
              <div className="text-xs text-ink leading-relaxed bg-bg rounded-lg px-2.5 py-2 border border-line">
                {renderMentions(msg.content, orgUsers)}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
      <div className="mt-3 pt-3 border-t border-line">
        <MentionInput
          value={input}
          onChange={setInput}
          onSubmit={send}
          users={orgUsers}
          placeholder="Comment… @ to mention someone"
          rows={2}
        />
      </div>
    </div>
  );
}

// ====================================================================
// USER PROFILE CARD — popover shown when clicking a user avatar in chat
// ====================================================================
function UserProfileCard({ user, departments, onClose }: {
  user: OrgUser;
  departments: Department[];
  onClose: () => void;
}) {
  const dept = departments.find((d) => d.id === user.department_id);
  const lastSeen = user.last_seen_at ? new Date(user.last_seen_at) : null;
  const minsSinceActive = lastSeen
    ? Math.floor((Date.now() - lastSeen.getTime()) / 60000)
    : null;
  const isOnline = minsSinceActive !== null && minsSinceActive < 5;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-80 overflow-hidden">
        {/* Header gradient */}
        <div
          className="h-20"
          style={{ background: dept ? `linear-gradient(135deg, ${dept.color}30, ${dept.color}10)` : "linear-gradient(135deg, #EEF2FF, #F0FDF4)" }}
        />
        {/* Avatar */}
        <div className="flex justify-between items-end px-5 -mt-8 mb-3">
          <div className="relative">
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.name || user.email}
                className="w-16 h-16 rounded-full border-4 border-white shadow-md object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full border-4 border-white shadow-md bg-gradient-to-br from-primary to-violet-600 text-white text-2xl font-bold flex items-center justify-center">
                {(user.name || user.email)[0].toUpperCase()}
              </div>
            )}
            <span
              className={`absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full border-2 border-white ${isOnline ? "bg-emerald-500 animate-pulseRing" : "bg-slate-300"}`}
            />
          </div>
          <button onClick={onClose} className="mb-1 p-1 text-soft hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pb-5">
          <div className="text-lg font-bold text-ink leading-tight">{user.name || user.email.split("@")[0]}</div>
          {user.job_title && (
            <div className="text-sm text-soft font-medium mt-0.5">{user.job_title}</div>
          )}
          <div className="text-xs text-mute mt-0.5">{user.email}</div>

          <div className="mt-4 flex flex-col gap-2">
            {dept && (
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dept.color }} />
                <span className="text-soft font-medium">Department</span>
                <span className="ml-auto text-ink font-semibold">{dept.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs">
              <UserIcon size={12} className="text-mute flex-shrink-0" />
              <span className="text-soft font-medium">Role</span>
              <span className="ml-auto text-ink font-semibold capitalize">{user.role?.replace(/_/g, " ") || "Member"}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {isOnline ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="text-emerald-700 font-semibold">Active now</span>
                </>
              ) : lastSeen ? (
                <>
                  <Clock size={12} className="text-mute flex-shrink-0" />
                  <span className="text-soft font-medium">Last seen</span>
                  <span className="ml-auto text-ink font-semibold">{fmtRelative(user.last_seen_at!)}</span>
                </>
              ) : (
                <>
                  <Clock size={12} className="text-mute flex-shrink-0" />
                  <span className="text-soft font-medium">Last seen</span>
                  <span className="ml-auto text-ink font-semibold">Never</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// CHAT VIEW — project channels + Direct Messages with @mentions + realtime
// ====================================================================
type ChatTarget = { type: "project"; id: string } | { type: "dm"; id: string };

function ChatView({ profile, orgUsers, projects, departments, teams, teamMembers, unreadByConv, markConvRead, broadcastMessage, broadcastDmRead, dmReadBy, convLastAt }: {
  profile: User;
  orgUsers: OrgUser[];
  projects: Project[];
  departments: Department[];
  teams: Team[];
  teamMembers: TeamMember[];
  unreadByConv: Record<string, number>;
  markConvRead: (key: string) => void;
  broadcastMessage: (msg: Message) => void;
  broadcastDmRead: (otherUserId: string) => void;
  dmReadBy: Record<string, string>;
  convLastAt: Record<string, string>;
}) {
  const initialTarget: ChatTarget | null =
    projects[0] ? { type: "project", id: projects[0].id }
    : (orgUsers.find((u) => u.id !== profile.id)
        ? { type: "dm", id: orgUsers.find((u) => u.id !== profile.id)!.id }
        : null);

  const [target, setTarget] = useState<ChatTarget | null>(initialTarget);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [profileUser, setProfileUser] = useState<OrgUser | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const chatOrgUsersRef = useRef(orgUsers);
  useEffect(() => { chatOrgUsersRef.current = orgUsers; }, [orgUsers]);

  // Fetch messages whenever target changes
  useEffect(() => {
    if (!target) return;
    setLoading(true);
    setMessages([]);
    // Mark this conversation as read when opened
    const convKey = target.type === "project"
      ? `project-${target.id}`
      : `dm-${target.id}`;
    markConvRead(convKey);

    // For DMs: broadcast read receipt so sender knows we opened the thread
    if (target.type === "dm") {
      broadcastDmRead(target.id);
    }

    const url = target.type === "project"
      ? `/api/messages?project_id=${target.id}`
      : `/api/messages?recipient_id=${target.id}`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => setMessages(j.messages || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [target, markConvRead, broadcastDmRead]);

  // Real-time: receives messages via window event dispatched by the global subscription
  // (avoids dual Supabase subscription on same channel which causes one to be dropped)
  useEffect(() => {
    if (!target) return;
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<Message>).detail;
      let matches = false;
      if (target.type === "project") {
        matches = msg.project_id === target.id && !msg.recipient_id && !msg.card_id;
      } else {
        matches = !!msg.recipient_id &&
          ((msg.author_id === target.id && msg.recipient_id === profile.id) ||
           (msg.author_id === profile.id && msg.recipient_id === target.id));
      }
      if (matches) {
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
        );
      }
    };
    window.addEventListener("sw:new-msg", handler);
    return () => window.removeEventListener("sw:new-msg", handler);
  }, [target, profile.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || !target) return;
    const content = input;
    setInput("");

    const body = target.type === "project"
      ? { project_id: target.id, content, is_encrypted: false }
      : { recipient_id: target.id, content, is_encrypted: false };

    try {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const { message } = await r.json();
        setMessages((prev) =>
          prev.some((m) => m.id === message.id) ? prev : [...prev, message]
        );
        // Broadcast to other clients in the org so they get toast + unread
        broadcastMessage(message);
      }
    } catch {}
  };

  const activeProject = target?.type === "project"
    ? projects.find((p) => p.id === target.id) ?? null : null;
  const activeDept = activeProject
    ? departments.find((d) => d.id === activeProject.department_id) ?? null : null;
  const activeDmUser = target?.type === "dm"
    ? orgUsers.find((u) => u.id === target.id) ?? null : null;

  // Sort DM users: unread first, then by most-recent activity, then alphabetical
  const dmUsers = orgUsers
    .filter((u) => u.id !== profile.id)
    .slice()
    .sort((a, b) => {
      const aUnread = unreadByConv[`dm-${a.id}`] || 0;
      const bUnread = unreadByConv[`dm-${b.id}`] || 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      const aAt = convLastAt[`dm-${a.id}`] || "";
      const bAt = convLastAt[`dm-${b.id}`] || "";
      if (aAt !== bAt) return bAt.localeCompare(aAt);
      return (a.name || a.email).localeCompare(b.name || b.email);
    });
  const filteredDmUsers = search
    ? dmUsers.filter((u) =>
        (u.name || u.email).toLowerCase().includes(search.toLowerCase()))
    : dmUsers;
  const filteredProjects = search
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  const isOnline = (u: OrgUser) => {
    if (!u.last_seen_at) return false;
    return (Date.now() - new Date(u.last_seen_at).getTime()) < 5 * 60 * 1000;
  };

  return (
    <div className="flex border-t border-line" style={{ height: "calc(100vh - 120px)" }}>
      {/* Sidebar: Channels + DMs */}
      <aside className="w-64 border-r border-line flex flex-col overflow-hidden bg-bg flex-shrink-0">
        <div className="p-3 border-b border-line">
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-line rounded-md">
            <Search size={12} className="text-mute" />
            <input
              placeholder="Search people or channels"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Channels */}
          <div className="px-2 pt-3 pb-2">
            <div className="flex items-center gap-1 px-2 mb-1">
              <Hash size={11} className="text-mute" />
              <span className="text-[10.5px] font-semibold text-mute uppercase tracking-wider">Channels</span>
              <span className="ml-auto text-[10px] font-mono text-mute">{filteredProjects.length}</span>
            </div>
            {filteredProjects.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[11px] text-mute italic">No channels.</div>
            ) : (
              filteredProjects.map((p) => {
                const dept = departments.find((d) => d.id === p.department_id);
                const active = target?.type === "project" && target.id === p.id;
                const team = teams.find((t) => t.id === p.team_id);
                const members = team ? teamMembers.filter((m) => m.team_id === team.id).length : 0;
                const unread = unreadByConv[`project-${p.id}`] || 0;
                return (
                  <button key={p.id}
                    onClick={() => setTarget({ type: "project", id: p.id })}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left transition-colors mb-px ${active ? "bg-white shadow-sm border border-line text-ink font-semibold" : unread ? "text-ink font-semibold hover:bg-white/70" : "text-soft hover:bg-white/70"}`}>
                    {dept ? (
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dept.color }} />
                    ) : (
                      <Hash size={10} className="text-mute flex-shrink-0" />
                    )}
                    <span className="truncate text-[12.5px] flex-1">{p.name}</span>
                    {unread > 0 && (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                    {!unread && members > 0 && <span className="text-[10px] text-mute font-mono">{members}p</span>}
                  </button>
                );
              })
            )}
          </div>

          {/* DMs */}
          <div className="px-2 pt-3 pb-3 border-t border-line/60">
            <div className="flex items-center gap-1 px-2 mb-1">
              <AtSign size={11} className="text-mute" />
              <span className="text-[10.5px] font-semibold text-mute uppercase tracking-wider">Direct Messages</span>
              <span className="ml-auto text-[10px] font-mono text-mute">{filteredDmUsers.length}</span>
            </div>
            {filteredDmUsers.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[11px] text-mute italic">No teammates yet.</div>
            ) : (
              filteredDmUsers.map((u) => {
                const active = target?.type === "dm" && target.id === u.id;
                const online = isOnline(u);
                const unread = unreadByConv[`dm-${u.id}`] || 0;
                return (
                  <button key={u.id}
                    onClick={() => setTarget({ type: "dm", id: u.id })}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors mb-px ${active ? "bg-white shadow-sm border border-line text-ink font-semibold" : unread ? "text-ink font-semibold hover:bg-white/70" : "text-soft hover:bg-white/70"}`}>
                    <div className="relative flex-shrink-0">
                      {u.avatar_url ? (
                        <img src={u.avatar_url} className="w-6 h-6 rounded-full object-cover" alt="" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[10px] font-bold flex items-center justify-center">
                          {(u.name || u.email)[0].toUpperCase()}
                        </div>
                      )}
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-bg ${online ? "bg-emerald-500 animate-pulseRing" : "bg-slate-300"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[12.5px]">{u.name || u.email.split("@")[0]}</div>
                      {u.job_title && <div className="truncate text-[10.5px] text-mute">{u.job_title}</div>}
                    </div>
                    {unread > 0 && (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </aside>

      {/* Message area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {target ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-2.5 px-5 py-3 border-b border-line">
              {target.type === "project" ? (
                <>
                  <Hash size={15} className="text-mute" />
                  {activeDept && (
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: activeDept.color }} />
                  )}
                  <span className="text-sm font-bold text-ink">{activeProject?.name}</span>
                  {activeDept && <span className="text-xs text-soft font-medium">· {activeDept.name}</span>}
                  <span className="ml-auto text-[11px] text-mute">
                    {orgUsers.length} member{orgUsers.length !== 1 ? "s" : ""}
                  </span>
                </>
              ) : (
                <>
                  <button
                    className="relative flex-shrink-0 group"
                    onClick={() => activeDmUser && setProfileUser(activeDmUser)}>
                    {activeDmUser?.avatar_url ? (
                      <img src={activeDmUser.avatar_url} className="w-8 h-8 rounded-full object-cover ring-2 ring-transparent group-hover:ring-primary/30 transition" alt="" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-sm font-bold flex items-center justify-center group-hover:scale-105 transition">
                        {(activeDmUser?.name || activeDmUser?.email || "?")[0].toUpperCase()}
                      </div>
                    )}
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${activeDmUser && isOnline(activeDmUser) ? "bg-emerald-500" : "bg-slate-300"}`} />
                  </button>
                  <div>
                    <div className="text-sm font-bold text-ink leading-tight">
                      {activeDmUser?.name || activeDmUser?.email?.split("@")[0]}
                    </div>
                    <div className="text-[11px] text-soft leading-tight">{activeDmUser?.job_title || activeDmUser?.email}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <span className={`flex items-center gap-1 text-[11px] font-medium ${activeDmUser && isOnline(activeDmUser) ? "text-emerald-600" : "text-soft"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${activeDmUser && isOnline(activeDmUser) ? "bg-emerald-500" : "bg-slate-300"}`} />
                      {activeDmUser && isOnline(activeDmUser) ? "Active" : activeDmUser?.last_seen_at ? `Last seen ${fmtRelative(activeDmUser.last_seen_at)}` : "Offline"}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              {loading && (
                <div className="flex flex-col gap-3 py-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full skeleton" />
                      <div className="flex flex-col gap-2">
                        <div className="h-2.5 w-24 rounded skeleton" />
                        <div className="h-8 w-64 rounded-2xl skeleton" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!loading && messages.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-16 text-center animate-fadeIn">
                  <div className="w-16 h-16 rounded-2xl bg-brand-soft flex items-center justify-center shadow-soft">
                    <MessageCircle size={28} className="text-primary" strokeWidth={2} />
                  </div>
                  <div className="text-base font-bold text-ink">
                    {target.type === "project"
                      ? `Welcome to #${activeProject?.name}`
                      : `Say hi to ${activeDmUser?.name?.split(" ")[0] || "them"}`}
                  </div>
                  <div className="text-xs text-soft max-w-xs">
                    {target.type === "project" ? "Be the first to post in this channel. @mention to notify." : "No messages yet — start the conversation."}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => {
                const author = orgUsers.find((u) => u.id === msg.author_id);
                const isMe = msg.author_id === profile.id;
                const prevMsg = messages[i - 1];
                const showAvatar = !prevMsg || prevMsg.author_id !== msg.author_id;
                // Read-receipt for own DM messages: read if recipient's last-read >= this msg's created_at
                const isDmFromMe = isMe && !!msg.recipient_id;
                const recipientReadAt = isDmFromMe ? dmReadBy[msg.recipient_id!] : null;
                const isRead = isDmFromMe && recipientReadAt && recipientReadAt >= msg.created_at;
                return (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-3 ${isMe ? "flex-row-reverse" : ""} ${!showAvatar ? "-mt-3" : ""}`}>
                    {showAvatar ? (
                      <button
                        className="flex-shrink-0 mt-0.5 group"
                        onClick={() => author && setProfileUser(author)}>
                        {author?.avatar_url ? (
                          <img src={author.avatar_url} className="w-8 h-8 rounded-full object-cover group-hover:ring-2 group-hover:ring-primary/40 transition" alt="" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-xs font-bold flex items-center justify-center group-hover:scale-105 transition">
                            {(author?.name || author?.email || "?")[0].toUpperCase()}
                          </div>
                        )}
                      </button>
                    ) : (
                      <div className="w-8 flex-shrink-0" />
                    )}
                    <div className={`flex flex-col max-w-[72%] ${isMe ? "items-end" : "items-start"}`}>
                      {showAvatar && (
                        <div className={`flex items-center gap-2 mb-1 ${isMe ? "flex-row-reverse" : ""}`}>
                          <button
                            className="text-[12px] font-semibold text-ink hover:underline"
                            onClick={() => author && setProfileUser(author)}>
                            {isMe ? "You" : (author?.name || author?.email?.split("@")[0] || "?")}
                          </button>
                        </div>
                      )}
                      <div
                        className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words shadow-soft animate-fadeIn ${isMe
                          ? "bg-brand-grad text-white rounded-tr-sm"
                          : "bg-white border border-line text-ink rounded-tl-sm"
                        }`}>
                        {msg.is_encrypted
                          ? <span className="italic opacity-60 text-xs">🔒 This message was encrypted and can no longer be displayed. Please resend.</span>
                          : renderMentions(msg.content, orgUsers)}
                      </div>
                      <div className={`flex items-center gap-1 mt-0.5 text-[10px] text-mute font-mono ${isMe ? "flex-row-reverse" : ""}`}>
                        <span>{fmtRelative(msg.created_at)}</span>
                        {isDmFromMe && (
                          <span className={isRead ? "text-primary font-semibold" : "text-mute"} title={isRead ? `Read ${fmtRelative(recipientReadAt!)}` : "Sent"}>
                            {isRead ? "✓✓ Read" : "✓ Sent"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-line bg-white">
              <MentionInput
                value={input}
                onChange={setInput}
                onSubmit={send}
                users={orgUsers}
                placeholder={
                  target.type === "project"
                    ? `Message #${activeProject?.name}… (@ to mention, Enter to send)`
                    : `Message ${activeDmUser?.name || "user"}…`
                }
                rows={1}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center animate-fadeIn">
              <div className="w-20 h-20 rounded-3xl bg-brand-soft flex items-center justify-center shadow-soft">
                <MessageCircle size={36} className="text-primary" strokeWidth={1.8} />
              </div>
              <div className="text-base font-bold text-ink">Pick a conversation</div>
              <div className="text-xs text-soft max-w-xs">Choose a project channel or teammate from the left to start chatting.</div>
            </div>
          </div>
        )}
      </div>

      {profileUser && (
        <UserProfileCard
          user={profileUser}
          departments={departments}
          onClose={() => setProfileUser(null)}
        />
      )}
    </div>
  );
}

// ====================================================================
// ORG HIERARCHY VIEW — org chart / people directory
// ====================================================================
function OrgHierarchyView({ departments, teams, teamMembers, projects, orgUsers, profile }: {
  departments: Department[];
  teams: Team[];
  teamMembers: TeamMember[];
  projects: Project[];
  orgUsers: OrgUser[];
  profile: User;
}) {
  const [selectedUser, setSelectedUser] = useState<OrgUser | null>(null);
  const [search, setSearch] = useState("");

  const filt = search.toLowerCase();
  const filteredUsers = filt
    ? orgUsers.filter((u) =>
        (u.name || u.email).toLowerCase().includes(filt) ||
        u.email.toLowerCase().includes(filt) ||
        (u.job_title || "").toLowerCase().includes(filt)
      )
    : orgUsers;

  const isOnline = (u: OrgUser) =>
    !!u.last_seen_at && (Date.now() - new Date(u.last_seen_at).getTime()) < 5 * 60 * 1000;

  return (
    <div className="px-6 pb-10 pt-3">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2 px-3 py-2 bg-white border border-line rounded-lg flex-1 max-w-xs">
          <Search size={13} className="text-mute" />
          <input
            placeholder="Search people…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-xs outline-none bg-transparent"
          />
        </div>
        <div className="text-xs text-soft font-medium">{filteredUsers.length} people</div>
      </div>

      {/* Org tree by department */}
      <div className="flex flex-col gap-6">
        {departments.map((dept) => {
          const deptUsers = filteredUsers.filter((u) => u.department_id === dept.id);
          const deptTeams = teams.filter((t) => t.department_id === dept.id);
          const deptProjects = projects.filter((p) => p.department_id === dept.id);
          if (deptUsers.length === 0 && !search) return null;
          const head = deptUsers.find((u) => u.id === dept.head_user_id);

          return (
            <div key={dept.id}>
              {/* Department header */}
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-xl mb-3"
                style={{ background: dept.color + "10", borderLeft: `3px solid ${dept.color}` }}>
                <span className="w-3 h-3 rounded-full" style={{ background: dept.color }} />
                <div className="flex-1">
                  <div className="text-sm font-bold text-ink">{dept.name}</div>
                  {dept.description && <div className="text-xs text-soft">{dept.description}</div>}
                </div>
                <div className="flex gap-4 text-xs text-soft font-medium">
                  <span>{deptUsers.length} people</span>
                  <span>{deptTeams.length} teams</span>
                  <span>{deptProjects.length} projects</span>
                </div>
              </div>

              {/* Dept head + reports */}
              {head && (
                <div className="ml-4 mb-3">
                  <div className="text-[10.5px] font-semibold text-mute uppercase tracking-wider mb-2">Head</div>
                  <UserCard user={head} departments={departments} isOnline={isOnline(head)} onClick={() => setSelectedUser(head)} />
                </div>
              )}

              {/* Teams and their members */}
              {deptTeams.map((team) => {
                const members = teamMembers
                  .filter((m) => m.team_id === team.id)
                  .map((m) => filteredUsers.find((u) => u.id === m.user_id))
                  .filter(Boolean) as OrgUser[];
                if (members.length === 0 && search) return null;
                const lead = members.find((u) => u.id === team.lead_id);
                const otherMembers = members.filter((u) => u.id !== team.lead_id);
                const teamProjects = projects.filter((p) => p.team_id === team.id);

                return (
                  <div key={team.id} className="ml-8 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-px h-4" style={{ background: dept.color }} />
                      <UsersIcon size={12} className="text-soft" />
                      <span className="text-xs font-semibold text-ink">{team.name}</span>
                      <span className="text-[10.5px] text-mute">· {members.length} members</span>
                      {teamProjects.length > 0 && (
                        <span className="text-[10.5px] text-mute">· {teamProjects.map((p) => p.name).join(", ")}</span>
                      )}
                    </div>
                    <div className="ml-4 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                      {lead && (
                        <UserCard
                          user={lead}
                          departments={departments}
                          isOnline={isOnline(lead)}
                          badge="Lead"
                          onClick={() => setSelectedUser(lead)}
                        />
                      )}
                      {otherMembers.map((u) => (
                        <UserCard
                          key={u.id}
                          user={u}
                          departments={departments}
                          isOnline={isOnline(u)}
                          onClick={() => setSelectedUser(u)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Dept users not in any team */}
              {(() => {
                const assignedToTeam = new Set(
                  teamMembers
                    .filter((m) => deptTeams.some((t) => t.id === m.team_id))
                    .map((m) => m.user_id)
                );
                const unassigned = deptUsers.filter(
                  (u) => !assignedToTeam.has(u.id) && u.id !== dept.head_user_id
                );
                if (unassigned.length === 0) return null;
                return (
                  <div className="ml-8 mb-2">
                    <div className="text-[10.5px] font-semibold text-mute uppercase tracking-wider mb-2 ml-4">
                      Not in a team
                    </div>
                    <div className="ml-4 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                      {unassigned.map((u) => (
                        <UserCard
                          key={u.id}
                          user={u}
                          departments={departments}
                          isOnline={isOnline(u)}
                          onClick={() => setSelectedUser(u)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}

        {/* Users with no department */}
        {(() => {
          const noDept = filteredUsers.filter((u) => !u.department_id);
          if (noDept.length === 0) return null;
          return (
            <div>
              <div className="text-[10.5px] font-semibold text-mute uppercase tracking-wider mb-3">
                No Department
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                {noDept.map((u) => (
                  <UserCard
                    key={u.id}
                    user={u}
                    departments={departments}
                    isOnline={isOnline(u)}
                    onClick={() => setSelectedUser(u)}
                  />
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {selectedUser && (
        <UserProfileCard
          user={selectedUser}
          departments={departments}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}

function UserCard({ user, departments, isOnline, badge, onClick }: {
  user: OrgUser;
  departments: Department[];
  isOnline: boolean;
  badge?: string;
  onClick: () => void;
}) {
  const dept = departments.find((d) => d.id === user.department_id);
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 p-2.5 bg-white border border-line rounded-xl text-left hover:shadow-sm hover:border-primary/30 transition group">
      <div className="relative flex-shrink-0">
        {user.avatar_url ? (
          <img src={user.avatar_url} className="w-9 h-9 rounded-full object-cover" alt="" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-sm font-bold flex items-center justify-center">
            {(user.name || user.email)[0].toUpperCase()}
          </div>
        )}
        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${isOnline ? "bg-emerald-500 animate-pulseRing" : "bg-slate-200"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-ink truncate">
          {user.name || user.email.split("@")[0]}
          {badge && (
            <span className="ml-1.5 px-1 py-px bg-primary/10 text-primary text-[9.5px] rounded font-semibold">
              {badge}
            </span>
          )}
        </div>
        {user.job_title && <div className="text-[10.5px] text-soft truncate">{user.job_title}</div>}
        {!user.job_title && dept && (
          <div className="text-[10.5px] text-mute truncate">{dept.name}</div>
        )}
      </div>
    </button>
  );
}

// ====================================================================
// FEEDBACK ASSIGNMENTS VIEW — inbox for feedback routed to me
// ====================================================================
function FeedbackAssignmentsView({ assignments, cards, projects, departments, profile, orgUsers, onRespond }: {
  assignments: FeedbackEntry[];
  cards: Card[];
  projects: Project[];
  departments: Department[];
  profile: User;
  orgUsers: OrgUser[];
  onRespond: (updated: FeedbackEntry) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<"respond" | "route">("respond");
  const [noteText, setNoteText] = useState("");
  const [routeToId, setRouteToId] = useState("");
  const [busy, setBusy] = useState(false);

  const resetForm = () => { setActiveId(null); setNoteText(""); setRouteToId(""); setMode("respond"); };

  const submit = async (fb: FeedbackEntry) => {
    if (mode === "respond" && !noteText.trim()) return;
    if (mode === "route" && !routeToId) return;
    setBusy(true);
    try {
      let updated: FeedbackEntry;
      if (mode === "respond") {
        updated = await api.patchFeedback(fb.id, { action: "respond", response: noteText });
      } else {
        updated = await api.patchFeedback(fb.id, { action: "route", assigned_to_id: routeToId, note: noteText });
      }
      onRespond(updated);
      resetForm();
      emitToast({
        message: mode === "respond" ? "Response sent." : "Feedback routed.",
        type: "success",
      });
    } catch (e) {
      console.error(e);
      emitToast({
        message: mode === "respond"
          ? "Could not send your response. Please try again."
          : "Could not route the feedback. Please try again.",
        type: "warning",
        from: "Feedback failed",
      });
    } finally { setBusy(false); }
  };

  if (assignments.length === 0) {
    return (
      <div className="px-6 pt-6">
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
            <UserCheck size={22} className="text-emerald-600" />
          </div>
          <div className="text-sm font-semibold text-ink">All clear!</div>
          <div className="text-xs text-soft max-w-xs">
            No feedback items are currently assigned to you. When someone routes feedback your way, it'll appear here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-10 pt-3 max-w-2xl">
      <div className="text-xs text-soft mb-4 font-medium">
        {assignments.length} item{assignments.length !== 1 ? "s" : ""} awaiting your action
      </div>
      <div className="flex flex-col gap-4">
        {assignments.map((fb) => {
          const card = cards.find((c) => c.id === fb.card_id);
          const project = card ? projects.find((p) => p.id === card.project_id) : null;
          const dept = project ? departments.find((d) => d.id === project.department_id) : null;
          const cp = CHECKPOINTS.find((c) => c.pct === fb.checkpoint);
          const isActive = activeId === fb.id;
          const chain: RoutingChainEntry[] = Array.isArray(fb.routing_chain) ? fb.routing_chain : [];
          const otherUsers = orgUsers.filter((u) => u.id !== profile.id);

          return (
            <div key={fb.id} className={`bg-white border rounded-xl shadow-sm transition-all ${isActive ? "border-primary ring-2 ring-primary/10" : "border-line"}`}>
              {/* Header */}
              <div className="flex items-start gap-3 p-4 pb-3">
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div className="px-2 py-1 bg-ink text-white font-mono text-[11px] font-bold rounded">
                    {fb.checkpoint}%
                  </div>
                  {cp && <div className="text-[9.5px] text-mute font-medium">{cp.label}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-xs font-bold text-ink">{fb.reviewer_name}</span>
                    <CornerDownRight size={11} className="text-mute" />
                    <span className="text-xs font-semibold text-primary">you</span>
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold rounded-full">
                      Awaiting response
                    </span>
                    <span className="ml-auto text-[10.5px] text-mute font-mono">{fmtRelative(fb.created_at)}</span>
                  </div>
                  {card && (
                    <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
                      {dept && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dept.color }} />}
                      <span className="text-soft">{project?.name}</span>
                      <ChevronRight size={10} className="text-mute" />
                      <span className="font-semibold text-ink truncate">{card.title}</span>
                    </div>
                  )}
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] rounded-full font-semibold">
                    {fb.lens}
                  </span>
                </div>
              </div>

              {/* Original note */}
              <div className="mx-4 mb-3 px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink leading-relaxed">
                {fb.note}
              </div>
              {fb.next_action && (
                <div className="mx-4 mb-3 text-xs text-primary font-medium flex items-center gap-1">
                  <CornerDownRight size={11} /> {fb.next_action}
                </div>
              )}

              {/* Routing chain thread */}
              {chain.length > 0 && (
                <div className="mx-4 mb-3 border-l-2 border-line pl-3 flex flex-col gap-2">
                  {chain.map((step, i) => {
                    const toUser = step.to_id ? orgUsers.find((u) => u.id === step.to_id) : null;
                    const toName = toUser?.name || toUser?.email?.split("@")[0] || "someone";
                    return (
                      <div key={i} className="text-xs">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[8px] font-bold flex items-center justify-center flex-shrink-0">
                            {step.from_name[0]?.toUpperCase()}
                          </div>
                          <span className="font-semibold text-ink">{step.from_name}</span>
                          {step.action === "routed" && (
                            <><CornerDownRight size={10} className="text-mute" />
                            <span className="text-soft">routed to <span className="font-semibold text-ink">{toName}</span></span></>
                          )}
                          {step.action === "responded" && (
                            <span className="text-emerald-700 font-medium">responded</span>
                          )}
                          <span className="ml-auto text-mute font-mono">{fmtRelative(step.at)}</span>
                        </div>
                        {step.note && (
                          <div className="ml-5.5 pl-2 text-soft leading-relaxed border-l border-line ml-6">
                            {step.note}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Action area */}
              <div className="px-4 pb-4">
                {!isActive ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setActiveId(fb.id); setMode("respond"); setNoteText(""); }}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-primary/90">
                      <Check size={13} strokeWidth={2.5} /> Write Response
                    </button>
                    <button
                      onClick={() => { setActiveId(fb.id); setMode("route"); setNoteText(""); setRouteToId(""); }}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-line text-xs font-semibold text-soft rounded-lg hover:border-primary hover:text-primary">
                      <CornerDownRight size={13} /> Route to someone
                    </button>
                  </div>
                ) : (
                  <div>
                    {/* Mode tabs */}
                    <div className="flex gap-1 mb-3 p-0.5 bg-bg rounded-lg border border-line w-fit">
                      <button
                        onClick={() => setMode("respond")}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${mode === "respond" ? "bg-white shadow-sm text-primary border border-line" : "text-soft"}`}>
                        Respond
                      </button>
                      <button
                        onClick={() => setMode("route")}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${mode === "route" ? "bg-white shadow-sm text-primary border border-line" : "text-soft"}`}>
                        Route to next person
                      </button>
                    </div>

                    {mode === "route" && (
                      <div className="mb-3">
                        <label className="text-[11px] font-semibold text-soft uppercase tracking-wide mb-1.5 block">Route to</label>
                        <select
                          value={routeToId}
                          onChange={(e) => setRouteToId(e.target.value)}
                          className="w-full px-2.5 py-2 border border-line rounded-lg bg-white text-sm text-ink mb-0">
                          <option value="">— Select person —</option>
                          {otherUsers.map((u) => (
                            <option key={u.id} value={u.id}>{u.name || u.email}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      rows={3}
                      autoFocus
                      className="w-full px-3 py-2.5 border border-line rounded-lg bg-bg text-sm text-ink leading-relaxed resize-y mb-3"
                      placeholder={mode === "respond"
                        ? "Describe your findings, decisions, or next steps…"
                        : "Add a note for the next person (optional)…"}
                    />

                    <div className="flex gap-2">
                      <button
                        onClick={() => submit(fb)}
                        disabled={busy || (mode === "respond" && !noteText.trim()) || (mode === "route" && !routeToId)}
                        className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-40 shadow-sm ${mode === "respond" ? "bg-emerald-600 text-white" : "bg-primary text-white"}`}>
                        {busy ? "Saving…" : mode === "respond" ? <><Check size={13} /> Submit Response</> : <><CornerDownRight size={13} /> Route</>}
                      </button>
                      <button
                        onClick={resetForm}
                        className="px-4 py-2 text-xs text-soft border border-line rounded-lg hover:bg-bg">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ====================================================================
// PERSONAL DASHBOARD - normal users and admins
// ====================================================================
function percentOf(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function averageCardProgress(items: Card[]) {
  return items.length ? Math.round(items.reduce((sum, c) => sum + c.progress, 0) / items.length) : 0;
}

function PersonalDashboardView({ profile, cards, projects, departments, feedback, orgUsers, onOpenView, onSelectCard }: {
  profile: User;
  cards: Card[];
  projects: Project[];
  departments: Department[];
  feedback: FeedbackEntry[];
  orgUsers: OrgUser[];
  onOpenView: (type: string) => void;
  onSelectCard: (id: string) => void;
}) {
  const activeCards = cards.filter((c) => !c.deleted_at && c.stage !== "served");
  const myCards = cards.filter((c) => c.assignee_id === profile.id && !c.deleted_at);
  const myActiveCards = myCards.filter((c) => c.stage !== "served");
  const myCompleted = myCards.filter((c) => c.stage === "served").length;
  const myFeedback = feedback.filter((f) => f.reviewer_id === profile.id || f.assigned_to_id === profile.id);
  const myOpenFeedback = myFeedback.filter((f) => f.status === "open" || f.status === "pending_response");
  const ledProjects = projects.filter((p) => p.lead_id === profile.id);
  const dueSoon = myActiveCards.filter((c) => {
    const d = daysUntil(c.due_date);
    return d !== null && d >= 0 && d <= 7;
  });
  const overdue = myActiveCards.filter((c) => {
    const d = daysUntil(c.due_date);
    return d !== null && d < 0;
  });
  const noDueDate = myActiveCards.filter((c) => !c.due_date);
  const highPriority = myActiveCards.filter((c) => c.priority === "high");
  const avgProgress = averageCardProgress(myCards);

  const usageSignals = [
    {
      label: "Planning",
      value: myCards.filter((c) => ["on_order", "prep_table", "front_burner"].includes(c.stage)).length + ledProjects.length,
      detail: "cards shaped and projects led",
      icon: Target,
      color: "#7C3AED",
    },
    {
      label: "Execution",
      value: myActiveCards.filter((c) => ["front_burner", "back_burner", "pass_qa"].includes(c.stage)).length,
      detail: "active work moving now",
      icon: Activity,
      color: "#F97316",
    },
    {
      label: "Feedback",
      value: myFeedback.length,
      detail: "reviews routed or received",
      icon: MessageSquare,
      color: "#06B6D4",
    },
    {
      label: "Delivery",
      value: myCompleted,
      detail: "cards served",
      icon: CheckCircle2,
      color: "#22C55E",
    },
  ].sort((a, b) => b.value - a.value);

  const strongestSignal = usageSignals[0];
  const nextCards = [...myActiveCards]
    .sort((a, b) => {
      const ad = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      return ad - bd;
    })
    .slice(0, 5);

  const suggestions = [
    overdue.length > 0 && {
      title: "Clear overdue work first",
      body: `${overdue.length} assigned card${overdue.length === 1 ? "" : "s"} need a delivery decision.`,
      action: "Open My Work",
      onClick: () => onOpenView("my"),
      tone: "danger",
    },
    myOpenFeedback.length > 0 && {
      title: "Respond to feedback loops",
      body: `${myOpenFeedback.length} feedback item${myOpenFeedback.length === 1 ? "" : "s"} are waiting on you.`,
      action: "Open Assignments",
      onClick: () => onOpenView("assignments"),
      tone: "info",
    },
    dueSoon.length > 0 && {
      title: "Plan the next seven days",
      body: `${dueSoon.length} card${dueSoon.length === 1 ? "" : "s"} are due soon. Pull blockers into the open.`,
      action: "Review Cards",
      onClick: () => onOpenView("my"),
      tone: "warning",
    },
    noDueDate.length > 0 && {
      title: "Add dates to floating work",
      body: `${noDueDate.length} active card${noDueDate.length === 1 ? "" : "s"} do not have due dates yet.`,
      action: "Review Cards",
      onClick: () => onOpenView("my"),
      tone: "neutral",
    },
    profile.role === "admin" && activeCards.filter((c) => !c.assignee_id).length > 0 && {
      title: "Assign owners",
      body: `${activeCards.filter((c) => !c.assignee_id).length} active card${activeCards.filter((c) => !c.assignee_id).length === 1 ? " across your workspace needs an owner" : "s across your workspace need owners"}.`,
      action: "Open All Cards",
      onClick: () => onOpenView("all"),
      tone: "neutral",
    },
  ].filter(Boolean).slice(0, 4) as {
    title: string;
    body: string;
    action: string;
    onClick: () => void;
    tone: string;
  }[];

  const fallbackSuggestions = suggestions.length ? suggestions : [{
    title: "Keep momentum visible",
    body: "Your work is in a healthy shape. Protect focus time and keep feedback moving.",
    action: "Open Analytics",
    onClick: () => onOpenView("analytics"),
    tone: "success",
  }];
  const StrongestSignalIcon = strongestSignal.icon;

  return (
    <div className="px-6 pb-10 pt-2">
      <div className="grid grid-cols-[1.25fr_0.75fr] gap-4 mb-5">
        <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-brand-grad text-white flex items-center justify-center shadow-pop">
              <Sparkles size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-mute/70 uppercase tracking-widest">Personal operating view</div>
              <h2 className="text-xl font-extrabold text-ink mt-1">
                {profile.name || profile.email.split("@")[0]}
              </h2>
              <div className="text-sm text-soft mt-1 max-w-2xl">
                Your dashboard is centered on assigned work, feedback, planning, and the parts of Stagework you use most.
              </div>
            </div>
            <button
              onClick={() => onOpenView("analytics")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-bg text-xs font-semibold text-soft hover:text-primary hover:border-primary/40">
              <BarChart3 size={13} />
              Analytics
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3 mt-5">
            <PersonalMetric label="My active cards" value={myActiveCards.length} icon={ListTree} color="#7C3AED" />
            <PersonalMetric label="Due this week" value={dueSoon.length} icon={Calendar} color="#F97316" alert={dueSoon.length > 0} />
            <PersonalMetric label="Feedback waiting" value={myOpenFeedback.length} icon={MessageSquare} color="#06B6D4" alert={myOpenFeedback.length > 0} />
            <PersonalMetric label="Avg progress" value={`${avgProgress}%`} icon={TrendingUp} color="#22C55E" />
          </div>
        </div>

        <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
          <div className="flex items-center gap-2 mb-4">
            <strong className="text-sm text-ink">Most used area</strong>
            <span className="ml-auto text-[10px] font-bold text-mute uppercase tracking-widest">Signal</span>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: strongestSignal.color + "12" }}>
              <StrongestSignalIcon size={19} style={{ color: strongestSignal.color }} />
            </div>
            <div>
              <div className="text-2xl font-extrabold text-ink leading-none">{strongestSignal.label}</div>
              <div className="text-xs text-soft mt-1">{strongestSignal.value} {strongestSignal.detail}</div>
            </div>
          </div>
          <div className="space-y-2">
            {usageSignals.map((signal) => (
              <div key={signal.label} className="grid grid-cols-[84px_1fr_32px] gap-2 items-center text-xs">
                <span className="font-semibold text-soft">{signal.label}</span>
                <MiniProgress value={signal.value} max={Math.max(...usageSignals.map((s) => s.value), 1)} color={signal.color} />
                <span className="font-mono font-bold text-ink text-right">{signal.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[0.95fr_1.05fr] gap-4 mb-5">
        <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={15} className="text-mute" />
            <h3 className="text-sm font-bold text-ink">Planning Queue</h3>
          </div>
          {nextCards.length === 0 ? (
            <div className="py-8 text-center text-xs text-mute">No assigned active cards are waiting.</div>
          ) : (
            <div className="space-y-2">
              {nextCards.map((card) => {
                const project = projects.find((p) => p.id === card.project_id);
                const dept = project ? departments.find((d) => d.id === project.department_id) : null;
                const d = daysUntil(card.due_date);
                const stage = stageById(card.stage);
                return (
                  <button
                    key={card.id}
                    onClick={() => onSelectCard(card.id)}
                    className="w-full text-left bg-bg border border-line rounded-lg px-3 py-2.5 hover:border-primary/40 hover:bg-white transition-colors">
                    <div className="flex items-center gap-2">
                      {dept && <span className="w-2 h-2 rounded-full" style={{ background: dept.color }} />}
                      <span className="font-semibold text-sm text-ink truncate">{card.title}</span>
                      <span className="ml-auto text-[10px] font-bold rounded px-1.5 py-0.5" style={{ color: stage.color, background: stage.color + "12" }}>
                        {stage.name}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-soft">
                      <span className="truncate">{project?.name || "Project"}</span>
                      <span className="text-mute">/</span>
                      <span className={d !== null && d < 0 ? "text-danger font-semibold" : ""}>
                        {card.due_date ? `${fmtDate(card.due_date)}${d !== null && d < 0 ? " overdue" : ""}` : "No due date"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={15} className="text-mute" />
            <h3 className="text-sm font-bold text-ink">Suggestions</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {fallbackSuggestions.map((item) => (
              <SuggestionCard key={item.title} {...item} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
          <div className="text-[11px] font-bold text-mute/70 uppercase tracking-widest mb-3">My stage mix</div>
          <StageDistribution cards={myCards} />
        </div>
        <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
          <div className="text-[11px] font-bold text-mute/70 uppercase tracking-widest mb-3">Priority load</div>
          <PriorityDistribution cards={myActiveCards} />
        </div>
        <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
          <div className="text-[11px] font-bold text-mute/70 uppercase tracking-widest mb-3">Context</div>
          <div className="space-y-3 text-xs">
            <ContextRow label="Projects you lead" value={ledProjects.length} icon={Folder} />
            <ContextRow label="High priority assigned" value={highPriority.length} icon={AlertTriangle} />
            <ContextRow label="Visible teammates" value={orgUsers.length} icon={UsersIcon} />
            <ContextRow label="Completed cards" value={myCompleted} icon={CheckCircle2} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PersonalMetric({ label, value, icon: Icon, color, alert }: {
  label: string;
  value: string | number;
  icon: any;
  color: string;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-lg border ${alert ? "border-orange-200 bg-orange-50/50" : "border-line bg-bg"} p-3`}>
      <div className="flex items-center gap-2 text-[10.5px] font-bold text-mute/70 uppercase tracking-widest">
        <Icon size={13} style={{ color }} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-extrabold font-mono text-ink leading-none">{value}</div>
    </div>
  );
}

function MiniProgress({ value, max, color }: { value: number; max: number; color: string }) {
  const width = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-bg overflow-hidden border border-line/60">
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
    </div>
  );
}

function SuggestionCard({ title, body, action, tone, onClick }: {
  title: string;
  body: string;
  action: string;
  tone: string;
  onClick: () => void;
}) {
  const toneClass =
    tone === "danger" ? "border-red-200 bg-red-50/70 text-red-700" :
    tone === "warning" ? "border-orange-200 bg-orange-50/70 text-orange-700" :
    tone === "info" ? "border-cyan-200 bg-cyan-50/70 text-cyan-700" :
    tone === "success" ? "border-emerald-200 bg-emerald-50/70 text-emerald-700" :
    "border-line bg-bg text-soft";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="font-bold text-sm text-ink">{title}</div>
      <div className="text-xs leading-relaxed mt-1 text-soft">{body}</div>
      <button onClick={onClick} className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-primary">
        {action}
        <ChevronRight size={12} />
      </button>
    </div>
  );
}

function StageDistribution({ cards, onStageClick }: { cards: Card[]; onStageClick?: (stage: (typeof STAGES)[number]) => void }) {
  const total = Math.max(cards.length, 1);
  return (
    <div className="space-y-2.5">
      {STAGES.map((stage) => {
        const value = cards.filter((c) => c.stage === stage.id).length;
        if (value === 0) return null;
        const Tag: any = onStageClick ? "button" : "div";
        return (
          <Tag
            key={stage.id}
            type={onStageClick ? "button" : undefined}
            onClick={onStageClick ? () => onStageClick(stage) : undefined}
            className={`grid grid-cols-[96px_1fr_36px] items-center gap-2 text-xs w-full ${onStageClick ? "rounded-md px-1 py-1 text-left transition-all hover:bg-bg hover:shadow-sm" : ""}`}>
            <span className="font-medium text-soft truncate">{stage.name}</span>
            <MiniProgress value={value} max={total} color={stage.color} />
            <span className="font-mono font-bold text-ink text-right">{percentOf(value, total)}%</span>
          </Tag>
        );
      })}
      {cards.length === 0 && <div className="text-xs text-mute italic">No cards yet.</div>}
    </div>
  );
}

function PriorityDistribution({ cards }: { cards: Card[] }) {
  const priorities = ["high", "medium", "low"] as const;
  const total = Math.max(cards.length, 1);
  return (
    <div className="space-y-2.5">
      {priorities.map((priority) => {
        const value = cards.filter((c) => c.priority === priority).length;
        return (
          <div key={priority} className="grid grid-cols-[72px_1fr_36px] items-center gap-2 text-xs">
            <span className="font-medium text-soft">{PRIORITIES[priority].label}</span>
            <MiniProgress value={value} max={total} color={PRIORITIES[priority].color} />
            <span className="font-mono font-bold text-ink text-right">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

function ContextRow({ label, value, icon: Icon, onClick }: { label: string; value: number; icon: any; onClick?: () => void }) {
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex items-center gap-2 w-full ${onClick ? "rounded-md px-1 py-1 text-left transition-all hover:bg-bg hover:shadow-sm" : ""}`}>
      <Icon size={13} className="text-mute" />
      <span className="text-soft">{label}</span>
      <span className="ml-auto font-mono font-bold text-ink">{value}</span>
    </Tag>
  );
}

// ====================================================================
// SUPER ADMIN DASHBOARD - executive org view
// ====================================================================
type ExecutiveDrilldownItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  color?: string;
  onClick?: () => void;
};

type ExecutiveDrilldown = {
  title: string;
  description: string;
  items: ExecutiveDrilldownItem[];
  empty: string;
};

function SuperAdminDashboard({ profile, departments, teams, teamMembers, projects, workspaces, cards, feedback, orgUsers, selectedCardId, onSelectCard, onUpdateCard, onDeleteCard, onAddFeedback, onUpdateFeedback }: {
  profile: User;
  departments: Department[];
  teams: Team[];
  teamMembers: TeamMember[];
  projects: Project[];
  workspaces: Workspace[];
  cards: Card[];
  feedback: FeedbackEntry[];
  orgUsers: OrgUser[];
  selectedCardId: string | null;
  onSelectCard: (id: string | null) => void;
  onUpdateCard: (id: string, patch: Partial<Card>) => void;
  onDeleteCard: (id: string) => void;
  onAddFeedback: (fb: Partial<FeedbackEntry>) => void;
  onUpdateFeedback: (fb: FeedbackEntry) => void;
}) {
  const [selectedDeptId, setSelectedDeptId] = useState<string>("all");
  const [drilldown, setDrilldown] = useState<ExecutiveDrilldown | null>(null);
  const activeCards = cards.filter((c) => !c.deleted_at && c.stage !== "served");
  const completedCards = cards.filter((c) => !c.deleted_at && c.stage === "served");
  const overdueCards = activeCards.filter((c) => {
    const d = daysUntil(c.due_date);
    return d !== null && d < 0;
  });
  const dueSoonCards = activeCards.filter((c) => {
    const d = daysUntil(c.due_date);
    return d !== null && d >= 0 && d <= 7;
  });
  const unassignedCards = activeCards.filter((c) => !c.assignee_id);
  const pendingFeedback = feedback.filter((f) => f.status === "open" || f.status === "pending_response");
  const activeUserList = orgUsers.filter((u) => {
    if (!u.last_seen_at) return false;
    return Date.now() - new Date(u.last_seen_at).getTime() < 7 * 86400000;
  });
  const activeUsers = activeUserList.length;

  const teamStats = teams.map((team) => {
    const teamProjects = projects.filter((p) => p.team_id === team.id);
    const projectIds = new Set(teamProjects.map((p) => p.id));
    const teamCards = cards.filter((c) => projectIds.has(c.project_id) && !c.deleted_at);
    const teamActiveCards = teamCards.filter((c) => c.stage !== "served");
    const teamOverdue = teamActiveCards.filter((c) => {
      const d = daysUntil(c.due_date);
      return d !== null && d < 0;
    }).length;
    const members = teamMembers.filter((m) => m.team_id === team.id);
    return {
      team,
      department: departments.find((d) => d.id === team.department_id) || null,
      lead: orgUsers.find((u) => u.id === team.lead_id) || null,
      members,
      projects: teamProjects,
      cards: teamCards,
      activeCards: teamActiveCards,
      overdue: teamOverdue,
      completion: percentOf(teamCards.filter((c) => c.stage === "served").length, teamCards.length),
      avgProgress: averageCardProgress(teamCards),
    };
  });

  const departmentStats = departments.map((dept) => {
    const deptTeams = teams.filter((t) => t.department_id === dept.id);
    const deptTeamIds = new Set(deptTeams.map((t) => t.id));
    const deptProjects = projects.filter((p) => p.department_id === dept.id || (p.team_id ? deptTeamIds.has(p.team_id) : false));
    const deptProjectIds = new Set(deptProjects.map((p) => p.id));
    const deptCards = cards.filter((c) => deptProjectIds.has(c.project_id) && !c.deleted_at);
    const deptActiveCards = deptCards.filter((c) => c.stage !== "served");
    const deptMemberIds = new Set<string>();
    orgUsers.filter((u) => u.department_id === dept.id).forEach((u) => deptMemberIds.add(u.id));
    teamMembers
      .filter((m) => deptTeamIds.has(m.team_id))
      .forEach((m) => deptMemberIds.add(m.user_id));
    const deptOverdue = deptActiveCards.filter((c) => {
      const d = daysUntil(c.due_date);
      return d !== null && d < 0;
    }).length;
    const deptDueSoon = deptActiveCards.filter((c) => {
      const d = daysUntil(c.due_date);
      return d !== null && d >= 0 && d <= 7;
    }).length;
    const deptHighRisk = deptActiveCards.filter((c) => c.priority === "high" && (daysUntil(c.due_date) ?? 99) <= 3).length;
    return {
      dept,
      head: orgUsers.find((u) => u.id === dept.head_user_id) || null,
      teams: deptTeams,
      projects: deptProjects,
      cards: deptCards,
      activeCards: deptActiveCards,
      members: deptMemberIds.size,
      overdue: deptOverdue,
      dueSoon: deptDueSoon,
      highRisk: deptHighRisk,
      completion: percentOf(deptCards.filter((c) => c.stage === "served").length, deptCards.length),
      avgProgress: averageCardProgress(deptCards),
    };
  });

  const selectedDept = selectedDeptId === "all"
    ? null
    : departmentStats.find((d) => d.dept.id === selectedDeptId) || null;
  const visibleTeamStats = selectedDept
    ? teamStats.filter((t) => t.team.department_id === selectedDept.dept.id)
    : teamStats;

  const riskQueue = activeCards
    .map((card) => {
      const project = projects.find((p) => p.id === card.project_id);
      const dept = project ? departments.find((d) => d.id === project.department_id) : null;
      const assignee = orgUsers.find((u) => u.id === card.assignee_id);
      const due = daysUntil(card.due_date);
      const score =
        (card.priority === "high" ? 40 : card.priority === "medium" ? 20 : 8) +
        (due !== null && due < 0 ? 50 : due !== null && due <= 3 ? 25 : 0) +
        (!card.assignee_id ? 18 : 0) +
        (card.progress < 30 ? 10 : 0);
      return { card, project, dept, assignee, due, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const strategicSuggestions = [
    overdueCards.length > 0 && {
      title: "Escalate overdue delivery",
      body: `${overdueCards.length} active card${overdueCards.length === 1 ? "" : "s"} are past due across the company.`,
      metric: overdueCards.length,
      tone: "danger",
      action: "overdue",
    },
    unassignedCards.length > 0 && {
      title: "Close ownership gaps",
      body: `${unassignedCards.length} active card${unassignedCards.length === 1 ? " does" : "s do"} not have an assignee.`,
      metric: unassignedCards.length,
      tone: "warning",
      action: "unassigned",
    },
    departments.filter((d) => !d.head_user_id).length > 0 && {
      title: "Assign department heads",
      body: `${departments.filter((d) => !d.head_user_id).length} department${departments.filter((d) => !d.head_user_id).length === 1 ? "" : "s"} are missing accountable leadership.`,
      metric: departments.filter((d) => !d.head_user_id).length,
      tone: "neutral",
      action: "department-heads",
    },
    teams.filter((t) => !t.lead_id).length > 0 && {
      title: "Name team leads",
      body: `${teams.filter((t) => !t.lead_id).length} team${teams.filter((t) => !t.lead_id).length === 1 ? "" : "s"} have no lead assigned.`,
      metric: teams.filter((t) => !t.lead_id).length,
      tone: "neutral",
      action: "team-leads",
    },
    pendingFeedback.length > 0 && {
      title: "Unblock feedback routing",
      body: `${pendingFeedback.length} feedback item${pendingFeedback.length === 1 ? "" : "s"} are open or pending response.`,
      metric: pendingFeedback.length,
      tone: "info",
      action: "feedback",
    },
  ].filter(Boolean).slice(0, 5) as { title: string; body: string; metric: number; tone: string; action?: string }[];

  const roleOrder: User["role"][] = ["super_admin", "admin", "dept_head", "team_lead", "member"];
  const roleLabels: Record<User["role"], string> = {
    super_admin: "Super Admin",
    admin: "Admin",
    dept_head: "Dept Head",
    team_lead: "Team Lead",
    member: "Member",
  };
  const selectedCard = selectedCardId ? cards.find((c) => c.id === selectedCardId) || null : null;

  const openCardDetail = (cardId: string) => {
    setDrilldown(null);
    onSelectCard(cardId);
  };

  const buildCardItems = (targetCards: Card[]): ExecutiveDrilldownItem[] =>
    targetCards.map((card) => {
      const project = projects.find((p) => p.id === card.project_id);
      const dept = project ? departments.find((d) => d.id === project.department_id) : null;
      const assignee = orgUsers.find((u) => u.id === card.assignee_id);
      const due = daysUntil(card.due_date);
      return {
        id: card.id,
        title: card.title,
        subtitle: `${project?.name || "Unknown project"} / ${assignee ? personName(assignee) : "Unassigned"}`,
        meta: card.due_date ? `${fmtDate(card.due_date)}${due !== null && due < 0 ? " late" : ""}` : "No due date",
        badge: card.priority,
        color: dept?.color,
        onClick: () => openCardDetail(card.id),
      };
    });

  const openCards = (title: string, description: string, targetCards: Card[], empty = "No cards match this slice.") => {
    setDrilldown({
      title,
      description,
      empty,
      items: buildCardItems(targetCards.filter((card) => !card.deleted_at)),
    });
  };

  const openProjects = (title: string, description: string, targetProjects: Project[]) => {
    setDrilldown({
      title,
      description,
      empty: "No projects match this slice.",
      items: targetProjects.map((project) => {
        const dept = departments.find((d) => d.id === project.department_id);
        const team = teams.find((t) => t.id === project.team_id);
        const projectCards = cards.filter((card) => card.project_id === project.id && !card.deleted_at);
        const projectActiveCards = projectCards.filter((card) => card.stage !== "served");
        return {
          id: project.id,
          title: project.name,
          subtitle: [dept?.name, team?.name].filter(Boolean).join(" / ") || "No department",
          meta: `${projectActiveCards.length} active / ${projectCards.length} total cards`,
          badge: project.status,
          color: dept?.color,
          onClick: () => openCards(`${project.name} cards`, "Cards attached to this project.", projectCards),
        };
      }),
    });
  };

  const openUsers = (title: string, description: string, targetUsers: OrgUser[], empty = "No people match this slice.") => {
    setDrilldown({
      title,
      description,
      empty,
      items: targetUsers.map((user) => {
        const dept = user.department_id ? departments.find((d) => d.id === user.department_id) : null;
        return {
          id: user.id,
          title: user.name || user.email,
          subtitle: [user.job_title, dept?.name, user.email].filter(Boolean).join(" / "),
          meta: user.last_seen_at ? `Seen ${fmtRelative(user.last_seen_at)}` : "No recent activity",
          badge: user.role ? roleLabels[user.role] : undefined,
          color: dept?.color,
        };
      }),
    });
  };

  const openFeedback = (title: string, description: string, targetFeedback: FeedbackEntry[]) => {
    setDrilldown({
      title,
      description,
      empty: "No feedback items match this slice.",
      items: targetFeedback.map((entry) => {
        const card = cards.find((c) => c.id === entry.card_id);
        const project = card ? projects.find((p) => p.id === card.project_id) : null;
        const dept = project ? departments.find((d) => d.id === project.department_id) : null;
        return {
          id: entry.id,
          title: card?.title || "Feedback item",
          subtitle: `${entry.reviewer_name} / ${entry.lens}`,
          meta: `${entry.checkpoint}% checkpoint / ${fmtDate(entry.created_at)}`,
          badge: entry.status.replace("_", " "),
          color: dept?.color,
          onClick: card ? () => openCardDetail(card.id) : undefined,
        };
      }),
    });
  };

  const openWorkspaces = () => {
    setDrilldown({
      title: "Shared Workspaces",
      description: "Workspace surfaces available across the organization.",
      empty: "No shared workspaces yet.",
      items: workspaces.map((workspace) => {
        const project = projects.find((p) => p.id === workspace.project_id);
        const dept = project ? departments.find((d) => d.id === project.department_id) : null;
        return {
          id: workspace.id,
          title: workspace.name,
          subtitle: project?.name || workspace.description || "No linked project",
          meta: workspace.is_public ? "Public" : "Private",
          badge: workspace.share_token ? "shareable" : undefined,
          color: dept?.color,
        };
      }),
    });
  };

  const openDepartments = () => {
    setDrilldown({
      title: "Departments",
      description: "Department rollups with ownership, project load, and active risk.",
      empty: "No departments yet.",
      items: departmentStats.map((item) => ({
        id: item.dept.id,
        title: item.dept.name,
        subtitle: `Head: ${item.head ? personName(item.head) : "Unassigned"}`,
        meta: `${item.teams.length} teams / ${item.projects.length} projects / ${item.activeCards.length} active cards`,
        badge: item.highRisk > 0 ? `Risk ${item.highRisk}` : `${item.completion}% done`,
        color: item.dept.color,
        onClick: () => openCards(`${item.dept.name} cards`, "All cards connected to this department.", item.cards),
      })),
    });
  };

  const openTeams = (title = "Teams", description = "Team rollups with lead, membership, projects, and active delivery load.", targetTeams = teamStats) => {
    setDrilldown({
      title,
      description,
      empty: "No teams match this slice.",
      items: targetTeams.map((item) => ({
        id: item.team.id,
        title: item.team.name,
        subtitle: `${item.department?.name || "Cross-functional"} / Lead: ${item.lead ? personName(item.lead) : "Unassigned"}`,
        meta: `${item.members.length} people / ${item.projects.length} projects / ${item.activeCards.length} active cards`,
        badge: item.overdue > 0 ? `${item.overdue} late` : `${item.avgProgress}% avg`,
        color: item.department?.color,
        onClick: () => openCards(`${item.team.name} cards`, "All cards connected to this team.", item.cards),
      })),
    });
  };

  const openSuggestion = (action?: string) => {
    if (action === "overdue") openCards("Overdue Delivery", "Active cards that are past due.", overdueCards);
    else if (action === "unassigned") openCards("Ownership Gaps", "Active cards that do not have an assignee.", unassignedCards);
    else if (action === "department-heads") {
      const missingHeadIds = new Set(departments.filter((dept) => !dept.head_user_id).map((dept) => dept.id));
      setDrilldown({
        title: "Departments Missing Heads",
        description: "Departments without accountable leadership assigned.",
        empty: "Every department has a head assigned.",
        items: departmentStats
          .filter((item) => missingHeadIds.has(item.dept.id))
          .map((item) => ({
            id: item.dept.id,
            title: item.dept.name,
            subtitle: `${item.members} people / ${item.projects.length} projects`,
            meta: "Head unassigned",
            badge: "Admin",
            color: item.dept.color,
          })),
      });
    } else if (action === "team-leads") {
      openTeams(
        "Teams Missing Leads",
        "Teams that need an accountable lead assigned.",
        teamStats.filter((item) => !item.team.lead_id)
      );
    } else if (action === "feedback") {
      openFeedback("Open Feedback Loops", "Feedback items that are open or awaiting response.", pendingFeedback);
    }
  };

  return (
    <div className="min-h-screen bg-page-grad text-ink">
      <ToastContainer />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-white/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-brand-grad text-white flex items-center justify-center shadow-pop">
            <Shield size={20} />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-mute">Super Admin Dashboard</div>
            <h1 className="text-xl font-extrabold tracking-tight">Company Command Center</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/admin" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg border border-line text-xs font-semibold text-soft hover:text-primary hover:border-primary/40">
              <Settings size={13} />
              Manage Org
            </Link>
            <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-line text-xs text-soft">
              <span className="w-2 h-2 rounded-full bg-success" />
              {profile.name || profile.email}
            </div>
            <a href="/api/auth/signout" title="Sign out" className="p-2 rounded-lg border border-line bg-white text-mute hover:text-danger">
              <LogOut size={14} />
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <section className="grid grid-cols-6 gap-3 mb-5">
          <ExecutiveMetric label="Departments" value={departments.length} icon={Network} color="#7C3AED" onClick={openDepartments} />
          <ExecutiveMetric label="Teams" value={teams.length} icon={UsersIcon} color="#06B6D4" onClick={() => openTeams()} />
          <ExecutiveMetric label="Active projects" value={projects.filter((p) => p.status === "active").length} icon={Folder} color="#2563EB" onClick={() => openProjects("Active Projects", "Projects currently moving work through the organization.", projects.filter((p) => p.status === "active"))} />
          <ExecutiveMetric label="Active cards" value={activeCards.length} icon={ListTree} color="#F97316" onClick={() => openCards("Active Cards", "All non-completed cards across the organization.", activeCards)} />
          <ExecutiveMetric label="Completion" value={`${percentOf(completedCards.length, cards.filter((c) => !c.deleted_at).length)}%`} icon={CheckCircle2} color="#22C55E" onClick={() => openCards("Completed Cards", "Cards that have reached the completed stage.", completedCards)} />
          <ExecutiveMetric label="Overdue" value={overdueCards.length} icon={AlertTriangle} color="#EF4444" alert={overdueCards.length > 0} onClick={() => openCards("Overdue Cards", "Active cards that are currently past due.", overdueCards)} />
        </section>

        <section className="grid grid-cols-[1.1fr_0.9fr] gap-4 mb-5">
          <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
            <div className="flex items-start gap-3 mb-5">
              <div>
                <div className="text-[11px] font-bold text-mute/70 uppercase tracking-widest">CEO review</div>
                <h2 className="text-lg font-extrabold mt-1">Portfolio Health</h2>
              </div>
              <div className="ml-auto grid grid-cols-3 gap-2 text-center">
                <ExecutivePill label="Due 7d" value={dueSoonCards.length} tone="warning" onClick={() => openCards("Due In Seven Days", "Active cards due in the next seven days.", dueSoonCards)} />
                <ExecutivePill label="Unassigned" value={unassignedCards.length} tone="neutral" onClick={() => openCards("Unassigned Cards", "Active cards without an assignee.", unassignedCards)} />
                <ExecutivePill label="Active users" value={activeUsers} tone="success" onClick={() => openUsers("Active Users", "People seen in the last seven days.", activeUserList)} />
              </div>
            </div>
            <div className="grid grid-cols-[0.9fr_1.1fr] gap-5">
              <div>
                <div className="text-[11px] font-bold text-mute/70 uppercase tracking-widest mb-3">Work by stage</div>
                <StageDistribution
                  cards={cards.filter((c) => !c.deleted_at)}
                  onStageClick={(stage) => openCards(`${stage.name} Cards`, `Cards currently in ${stage.name}.`, cards.filter((c) => !c.deleted_at && c.stage === stage.id))}
                />
              </div>
              <div>
                <div className="text-[11px] font-bold text-mute/70 uppercase tracking-widest mb-3">Executive actions</div>
                <div className="space-y-2">
                  {(strategicSuggestions.length ? strategicSuggestions : [{
                    title: "Portfolio is steady",
                    body: "No major structural risks are visible from the current card, department, and team data.",
                    metric: 0,
                    tone: "success",
                  }]).map((item) => (
                    <ExecutiveSuggestion key={item.title} {...item} onClick={() => openSuggestion(item.action)} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={15} className="text-mute" />
              <h3 className="text-sm font-bold">Risk Queue</h3>
              <span className="ml-auto text-[10px] font-bold text-mute uppercase tracking-widest">Top {riskQueue.length}</span>
            </div>
            <div className="space-y-2.5">
              {riskQueue.length === 0 && <div className="py-10 text-center text-xs text-mute">No active delivery risk yet.</div>}
              {riskQueue.map(({ card, project, dept, assignee, due }) => (
                <button key={card.id} type="button" onClick={() => openCardDetail(card.id)} className="w-full text-left rounded-lg border border-line bg-bg px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white hover:shadow-sm">
                  <div className="flex items-center gap-2">
                    {dept && <span className="w-2 h-2 rounded-full" style={{ background: dept.color }} />}
                    <span className="font-semibold text-sm truncate">{card.title}</span>
                    <span className={`ml-auto text-[10px] font-bold uppercase ${card.priority === "high" ? "text-danger" : "text-mute"}`}>
                      {card.priority}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-soft">
                    <span className="truncate">{project?.name || "Unknown project"}</span>
                    <span>/</span>
                    <span>{assignee ? personName(assignee) : "Unassigned"}</span>
                    <span className={`ml-auto ${due !== null && due < 0 ? "text-danger font-semibold" : ""}`}>
                      {card.due_date ? fmtDate(card.due_date) : "No due date"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle mb-5">
          <div className="flex items-center gap-3 mb-4">
            <div>
              <h2 className="text-base font-extrabold">Departments</h2>
              <div className="text-xs text-soft mt-0.5">Each department card rolls up teams, people, projects, cards, and delivery risk.</div>
            </div>
            <select
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value)}
              className="ml-auto px-3 py-2 rounded-lg border border-line bg-bg text-xs font-semibold text-soft">
              <option value="all">All departments</option>
              {departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {departmentStats
              .filter((item) => selectedDeptId === "all" || item.dept.id === selectedDeptId)
              .map((item) => (
                <DepartmentExecutiveCard key={item.dept.id} item={item} onClick={() => openCards(`${item.dept.name} Cards`, "All cards connected to this department.", item.cards)} />
              ))}
            {departments.length === 0 && (
              <div className="col-span-3 py-12 text-center text-sm text-mute">No departments yet. Create departments from Admin.</div>
            )}
          </div>
        </section>

        <section className="grid grid-cols-[1fr_360px] gap-4">
          <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
            <div className="flex items-center gap-2 mb-4">
              <UsersIcon size={15} className="text-mute" />
              <h2 className="text-base font-extrabold">Team Cards</h2>
              <span className="ml-auto text-[10px] font-bold text-mute uppercase tracking-widest">{visibleTeamStats.length} teams</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {visibleTeamStats.map((item) => <TeamExecutiveCard key={item.team.id} item={item} onClick={() => openCards(`${item.team.name} Cards`, "All cards connected to this team.", item.cards)} />)}
              {visibleTeamStats.length === 0 && (
                <div className="col-span-2 py-12 text-center text-sm text-mute">No teams in this view yet.</div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
              <div className="text-[11px] font-bold text-mute/70 uppercase tracking-widest mb-3">People by role</div>
              <div className="space-y-2">
                {roleOrder.map((role) => {
                  const value = orgUsers.filter((u) => u.role === role).length;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => openUsers(`${roleLabels[role]}s`, `People with the ${roleLabels[role]} role.`, orgUsers.filter((u) => u.role === role))}
                      className="w-full grid grid-cols-[96px_1fr_32px] gap-2 items-center text-xs rounded-md px-1 py-1 text-left transition-all hover:bg-bg hover:shadow-sm">
                      <span className="font-semibold text-soft">{roleLabels[role]}</span>
                      <MiniProgress value={value} max={Math.max(orgUsers.length, 1)} color={role === "super_admin" ? "#7C3AED" : role === "admin" ? "#EF4444" : "#06B6D4"} />
                      <span className="font-mono font-bold text-ink text-right">{value}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="bg-white/90 border border-line/60 rounded-xl p-5 shadow-subtle">
              <div className="text-[11px] font-bold text-mute/70 uppercase tracking-widest mb-3">Operating footprint</div>
              <div className="space-y-3 text-xs">
                <ContextRow label="Shared workspaces" value={workspaces.length} icon={Globe} onClick={openWorkspaces} />
                <ContextRow label="Open feedback loops" value={pendingFeedback.length} icon={MessageSquare} onClick={() => openFeedback("Open Feedback Loops", "Feedback items that are open or awaiting response.", pendingFeedback)} />
                <ContextRow label="Due in seven days" value={dueSoonCards.length} icon={Clock} onClick={() => openCards("Due In Seven Days", "Active cards due in the next seven days.", dueSoonCards)} />
                <ContextRow label="Average progress" value={averageCardProgress(cards.filter((c) => !c.deleted_at))} icon={TrendingUp} onClick={() => openCards("All Tracked Cards", "Cards included in the organization progress calculation.", cards.filter((c) => !c.deleted_at))} />
              </div>
            </div>
          </div>
        </section>
      </main>
      {drilldown && (
        <ExecutiveDrilldownPanel drilldown={drilldown} onClose={() => setDrilldown(null)} />
      )}
      {selectedCard && (
        <DetailPanel
          card={selectedCard}
          departments={departments}
          projects={projects}
          orgUsers={orgUsers}
          feedback={feedback.filter((f) => f.card_id === selectedCard.id)}
          profile={profile}
          onClose={() => onSelectCard(null)}
          onUpdate={(patch: Partial<Card>) => onUpdateCard(selectedCard.id, patch)}
          onDelete={() => onDeleteCard(selectedCard.id)}
          onAddFeedback={(fb: Partial<FeedbackEntry>) => onAddFeedback({ ...fb, card_id: selectedCard.id })}
          onUpdateFeedback={onUpdateFeedback}
        />
      )}
    </div>
  );
}

function ExecutiveMetric({ label, value, icon: Icon, color, alert, onClick }: {
  label: string;
  value: string | number;
  icon: any;
  color: string;
  alert?: boolean;
  onClick?: () => void;
}) {
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`w-full text-left bg-white/90 border ${alert ? "border-red-200" : "border-line/60"} rounded-xl p-4 shadow-subtle transition-all ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white hover:shadow-md" : ""}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color + "12" }}>
          <Icon size={15} style={{ color }} />
        </div>
        <span className="text-[10px] font-bold text-mute/70 uppercase tracking-widest leading-tight">{label}</span>
      </div>
      <div className={`text-2xl font-extrabold font-mono leading-none ${alert ? "text-danger" : "text-ink"}`}>{value}</div>
    </Tag>
  );
}

function ExecutivePill({ label, value, tone, onClick }: { label: string; value: number; tone: string; onClick?: () => void }) {
  const toneClass =
    tone === "warning" ? "bg-orange-50 text-orange-700 border-orange-200" :
    tone === "success" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    "bg-bg text-soft border-line";
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-center transition-all ${toneClass} ${onClick ? "hover:-translate-y-0.5 hover:shadow-sm" : ""}`}>
      <div className="text-lg font-mono font-extrabold leading-none">{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-widest mt-1">{label}</div>
    </Tag>
  );
}

function ExecutiveSuggestion({ title, body, metric, tone, onClick }: { title: string; body: string; metric: number; tone: string; onClick?: () => void }) {
  const accent =
    tone === "danger" ? "#EF4444" :
    tone === "warning" ? "#F97316" :
    tone === "info" ? "#06B6D4" :
    tone === "success" ? "#22C55E" :
    "#94A3B8";
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`w-full text-left rounded-lg border border-line bg-bg px-3 py-2.5 flex gap-3 transition-all ${onClick ? "hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white hover:shadow-sm" : ""}`}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-mono font-extrabold text-sm" style={{ color: accent, background: accent + "12" }}>
        {metric}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold text-ink">{title}</div>
        <div className="text-xs text-soft leading-relaxed mt-0.5">{body}</div>
      </div>
    </Tag>
  );
}

function DepartmentExecutiveCard({ item, onClick }: {
  item: {
    dept: Department;
    head: OrgUser | null;
    teams: Team[];
    projects: Project[];
    cards: Card[];
    activeCards: Card[];
    members: number;
    overdue: number;
    dueSoon: number;
    highRisk: number;
    completion: number;
    avgProgress: number;
  };
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left rounded-xl border border-line bg-bg overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white hover:shadow-md">
      <div className="px-4 py-3 bg-white border-b border-line" style={{ borderLeft: `4px solid ${item.dept.color}` }}>
        <div className="flex items-center gap-2">
          <h3 className="font-extrabold text-ink truncate">{item.dept.name}</h3>
          {item.highRisk > 0 && (
            <span className="ml-auto text-[10px] font-bold text-danger bg-red-50 px-1.5 py-0.5 rounded">RISK {item.highRisk}</span>
          )}
        </div>
        <div className="text-xs text-soft mt-1 truncate">Head: {item.head ? personName(item.head) : "Unassigned"}</div>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-4 gap-2 mb-4">
          <TinyStat label="Teams" value={item.teams.length} />
          <TinyStat label="People" value={item.members} />
          <TinyStat label="Projects" value={item.projects.length} />
          <TinyStat label="Cards" value={item.cards.length} />
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-soft w-20">Completion</span>
            <MiniProgress value={item.completion} max={100} color={item.dept.color} />
            <span className="font-mono font-bold text-ink w-9 text-right">{item.completion}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-soft w-20">Progress</span>
            <MiniProgress value={item.avgProgress} max={100} color="#06B6D4" />
            <span className="font-mono font-bold text-ink w-9 text-right">{item.avgProgress}%</span>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <RiskBadge label="Overdue" value={item.overdue} alert={item.overdue > 0} />
          <RiskBadge label="Due 7d" value={item.dueSoon} alert={item.dueSoon > 0} />
          <RiskBadge label="Active" value={item.activeCards.length} />
        </div>
      </div>
    </button>
  );
}

function TeamExecutiveCard({ item, onClick }: {
  item: {
    team: Team;
    department: Department | null;
    lead: OrgUser | null;
    members: TeamMember[];
    projects: Project[];
    cards: Card[];
    activeCards: Card[];
    overdue: number;
    completion: number;
    avgProgress: number;
  };
  onClick: () => void;
}) {
  const color = item.department?.color || "#94A3B8";
  return (
    <button type="button" onClick={onClick} className="w-full text-left rounded-xl border border-line bg-bg p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white hover:shadow-md">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <div className="min-w-0">
          <div className="font-bold text-sm text-ink truncate">{item.team.name}</div>
          <div className="text-[11px] text-soft truncate">{item.department?.name || "Cross-functional"} / Lead: {item.lead ? personName(item.lead) : "Unassigned"}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        <TinyStat label="People" value={item.members.length} />
        <TinyStat label="Projects" value={item.projects.length} />
        <TinyStat label="Active" value={item.activeCards.length} />
        <TinyStat label="Late" value={item.overdue} alert={item.overdue > 0} />
      </div>
      <div className="grid grid-cols-[72px_1fr_38px] gap-2 items-center text-xs">
        <span className="font-semibold text-soft">Progress</span>
        <MiniProgress value={item.avgProgress} max={100} color={color} />
        <span className="font-mono font-bold text-ink text-right">{item.avgProgress}%</span>
      </div>
      <div className="grid grid-cols-[72px_1fr_38px] gap-2 items-center text-xs mt-2">
        <span className="font-semibold text-soft">Complete</span>
        <MiniProgress value={item.completion} max={100} color="#22C55E" />
        <span className="font-mono font-bold text-ink text-right">{item.completion}%</span>
      </div>
    </button>
  );
}

function TinyStat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={`rounded-lg border px-2 py-2 text-center ${alert ? "bg-red-50 border-red-200 text-danger" : "bg-white border-line text-ink"}`}>
      <div className="font-mono font-extrabold text-sm leading-none">{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-widest text-mute mt-1">{label}</div>
    </div>
  );
}

function RiskBadge({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${alert ? "bg-red-50 text-danger" : "bg-white text-soft border border-line"}`}>
      {label}
      <span className="font-mono">{value}</span>
    </span>
  );
}

function ExecutiveDrilldownPanel({ drilldown, onClose }: { drilldown: ExecutiveDrilldown; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm flex justify-end"
      style={{ animation: "fadeIn 0.15s ease" }}
      onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] bg-white shadow-float border-l border-line flex flex-col"
        style={{ animation: "slideIn 0.22s cubic-bezier(.4,0,.2,1)" }}>
        <div className="px-5 py-4 border-b border-line bg-gradient-to-r from-bg to-white flex items-start gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-mute">Drill-down</div>
            <h2 className="text-lg font-extrabold text-ink mt-0.5">{drilldown.title}</h2>
            <p className="text-xs text-soft mt-1 leading-relaxed">{drilldown.description}</p>
          </div>
          <button type="button" onClick={onClose} title="Close" className="ml-auto p-1.5 rounded-lg text-mute hover:text-ink hover:bg-bg">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {drilldown.items.length === 0 && (
            <div className="py-14 text-center text-sm text-mute">{drilldown.empty}</div>
          )}
          <div className="space-y-2">
            {drilldown.items.map((item) => {
              const Tag: any = item.onClick ? "button" : "div";
              return (
                <Tag
                  key={item.id}
                  type={item.onClick ? "button" : undefined}
                  onClick={item.onClick}
                  className={`w-full rounded-xl border border-line bg-bg px-3 py-3 text-left transition-all ${item.onClick ? "hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white hover:shadow-sm" : ""}`}>
                  <div className="flex items-start gap-2.5">
                    <span className="mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color || "#CBD5E1" }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-sm text-ink truncate">{item.title}</div>
                        {item.badge && (
                          <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-soft bg-white border border-line px-1.5 py-0.5 rounded flex-shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.subtitle && <div className="text-xs text-soft mt-1 truncate">{item.subtitle}</div>}
                      {item.meta && <div className="text-[11px] text-mute mt-1">{item.meta}</div>}
                    </div>
                    {item.onClick && <ChevronRight size={14} className="mt-1 text-mute flex-shrink-0" />}
                  </div>
                </Tag>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ====================================================================
// ANALYTICS VIEW — KPIs + Pie charts + Bar chart + Gantt timeline
// ====================================================================
function AnalyticsView({ cards, projects, departments, orgUsers }: {
  cards: Card[];
  projects: Project[];
  departments: Department[];
  orgUsers: OrgUser[];
}) {
  const stageData = useMemo(() => STAGES.map((s) => ({
    label: s.name,
    value: cards.filter((c) => c.stage === s.id).length,
    color: s.color,
  })).filter((d) => d.value > 0), [cards]);

  const priorityData = useMemo(() => (["high", "medium", "low"] as const).map((p) => ({
    label: PRIORITIES[p].label,
    value: cards.filter((c) => c.priority === p).length,
    color: PRIORITIES[p].color,
  })).filter((d) => d.value > 0), [cards]);

  const assigneeData = useMemo(() => {
    const counts: Record<string, number> = {};
    cards.forEach((c) => {
      if (c.stage === "served") return;
      const k = c.assignee_id || "unassigned";
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([id, value]) => {
        const u = orgUsers.find((u) => u.id === id);
        return { id, label: u?.name || u?.email?.split("@")[0] || "Unassigned", value };
      })
      .sort((a, b) => b.value - a.value);
  }, [cards, orgUsers]);

  const totalCards = cards.length;
  const completed = cards.filter((c) => c.stage === "served").length;
  const inProgress = cards.filter((c) => c.stage !== "served" && c.stage !== "on_order").length;
  const overdue = cards.filter((c) => {
    const d = daysUntil(c.due_date);
    return d !== null && d < 0 && c.stage !== "served";
  }).length;
  const avgProgress = cards.length
    ? Math.round(cards.reduce((s, c) => s + c.progress, 0) / cards.length) : 0;

  return (
    <div className="px-6 pb-10 pt-2">
      {cards.length === 0 ? (
        <div className="py-20 text-center flex flex-col items-center gap-3">
          <BarChart3 size={48} className="text-line" strokeWidth={1.2} />
          <div className="text-sm font-semibold text-ink">No data to chart yet</div>
          <div className="text-xs text-soft max-w-xs">
            Create some cards in your projects to see KPIs, distributions, and timeline charts here.
          </div>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-5 gap-3 mb-5">
            <KPICard label="Total Cards" value={totalCards} icon={ListTree} color="#2563EB" />
            <KPICard label="In Progress" value={inProgress} icon={Activity} color="#F59E0B" />
            <KPICard label="Completed" value={completed} icon={CheckCircle2} color="#10B981" />
            <KPICard label="Overdue" value={overdue} icon={AlertTriangle} color="#EF4444"
              alert={overdue > 0} />
            <KPICard label="Avg Progress" value={`${avgProgress}%`} icon={TrendingUp} color="#8B5CF6" />
          </div>

          {/* Pie charts row */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <ChartCard title="Cards by Stage" icon={PieChartIcon}>
              <div className="flex items-center gap-6">
                <PieChart data={stageData} size={160} />
                <ChartLegend data={stageData} total={cards.length} />
              </div>
            </ChartCard>

            <ChartCard title="Cards by Priority" icon={PieChartIcon}>
              <div className="flex items-center gap-6">
                <PieChart data={priorityData} size={160} />
                <ChartLegend data={priorityData} total={cards.length} />
              </div>
            </ChartCard>
          </div>

          {/* Assignee bar chart */}
          <ChartCard title="Active Workload by Assignee" icon={UsersIcon} className="mb-5">
            <BarChart data={assigneeData} />
          </ChartCard>

          {/* Gantt */}
          <ChartCard title="Project Timeline (Gantt)" icon={Calendar}>
            <GanttChart cards={cards} projects={projects} departments={departments} />
          </ChartCard>
        </>
      )}
    </div>
  );
}

function KPICard({ label, value, icon: Icon, color, alert }: {
  label: string; value: number | string; icon: any; color: string; alert?: boolean;
}) {
  return (
    <div className={`bg-white/90 backdrop-blur-sm border ${alert ? "border-red-200" : "border-line/60"} rounded-xl p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 shadow-subtle`}>
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color + "12" }}>
          <Icon size={15} style={{ color }} strokeWidth={2.2} />
        </div>
        <span className="text-[10.5px] font-bold text-mute/70 uppercase tracking-widest">{label}</span>
      </div>
      <div className="text-2xl font-extrabold text-ink font-mono leading-none" style={{ color: alert ? "#DC2626" : undefined }}>
        {value}
      </div>
    </div>
  );
}

function ChartCard({ title, icon: Icon, children, className = "" }: {
  title: string; icon?: any; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white/90 backdrop-blur-sm border border-line/60 rounded-xl p-5 shadow-subtle ${className}`}>
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon size={14} className="text-mute" strokeWidth={2} />}
        <h3 className="text-sm font-bold text-ink">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function PieChart({ data, size = 160 }: {
  data: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0 || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-mute text-xs"
        style={{ width: size, height: size }}>
        No data
      </div>
    );
  }

  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;

  if (data.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill={data[0].color} />
        <circle cx={cx} cy={cy} r={r * 0.55} fill="white" />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
          className="font-mono font-bold" style={{ fontSize: 18, fill: "#0F172A" }}>
          {total}
        </text>
      </svg>
    );
  }

  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.map((d, i) => {
        const start = (acc / total) * Math.PI * 2;
        acc += d.value;
        const end = (acc / total) * Math.PI * 2;
        const x1 = cx + r * Math.sin(start);
        const y1 = cy - r * Math.cos(start);
        const x2 = cx + r * Math.sin(end);
        const y2 = cy - r * Math.cos(end);
        const large = end - start > Math.PI ? 1 : 0;
        const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
        return <path key={i} d={path} fill={d.color} stroke="white" strokeWidth="2" />;
      })}
      <circle cx={cx} cy={cy} r={r * 0.55} fill="white" />
      <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="central"
        className="font-mono font-bold" style={{ fontSize: 22, fill: "#0F172A" }}>
        {total}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 10, fill: "#94A3B8", fontWeight: 600, letterSpacing: 0.5 }}>
        TOTAL
      </text>
    </svg>
  );
}

function ChartLegend({ data, total }: {
  data: { label: string; value: number; color: string }[]; total: number;
}) {
  return (
    <div className="flex flex-col gap-2 flex-1 min-w-0">
      {data.map((d, i) => {
        const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
            <span className="font-medium text-ink truncate">{d.label}</span>
            <span className="ml-auto font-mono text-soft">{d.value}</span>
            <span className="font-mono text-mute w-10 text-right">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function BarChart({ data }: {
  data: { id: string; label: string; value: number }[];
}) {
  if (data.length === 0) {
    return <div className="text-mute text-xs italic py-6 text-center">No active workload.</div>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((d) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={d.id} className="grid grid-cols-[140px_1fr_36px] gap-3 items-center">
            <div className="text-xs font-medium text-ink truncate">{d.label}</div>
            <div className="h-5 bg-bg rounded relative overflow-hidden">
              <div
                className="h-full rounded bg-gradient-to-r from-primary to-violet-600 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-xs font-mono font-bold text-ink text-right">{d.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function GanttChart({ cards, projects, departments }: {
  cards: Card[]; projects: Project[]; departments: Department[];
}) {
  const cardsWithDates = cards.filter((c) => c.due_date && c.stage !== "served");
  if (cardsWithDates.length === 0) {
    return (
      <div className="text-mute text-xs italic py-6 text-center">
        No active cards with due dates yet.
      </div>
    );
  }

  // Date range: 14 days back to 60 days forward, or expand to fit data
  const now = new Date();
  let minDate = new Date(now); minDate.setDate(minDate.getDate() - 14);
  let maxDate = new Date(now); maxDate.setDate(maxDate.getDate() + 60);
  cardsWithDates.forEach((c) => {
    const created = new Date(c.created_at);
    const due = new Date(c.due_date!);
    if (created < minDate) minDate = created;
    if (due > maxDate) maxDate = due;
  });
  const totalMs = maxDate.getTime() - minDate.getTime();
  const totalDays = Math.ceil(totalMs / 86400000);

  // Date markers — every ~7 days
  const markers: { pct: number; label: string }[] = [];
  const step = Math.max(1, Math.ceil(totalDays / 8));
  for (let d = 0; d <= totalDays; d += step) {
    const date = new Date(minDate); date.setDate(date.getDate() + d);
    markers.push({
      pct: (d / totalDays) * 100,
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    });
  }

  const todayPct = ((now.getTime() - minDate.getTime()) / totalMs) * 100;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* Date axis */}
        <div className="grid mb-2" style={{ gridTemplateColumns: "180px 1fr" }}>
          <div />
          <div className="relative h-6 border-b border-line">
            {markers.map((m, i) => (
              <div key={i} className="absolute top-0 -translate-x-1/2 text-[10px] text-mute font-mono"
                style={{ left: `${m.pct}%` }}>
                {m.label}
              </div>
            ))}
          </div>
        </div>

        {/* Rows */}
        <div className="relative">
          {/* Today marker */}
          {todayPct >= 0 && todayPct <= 100 && (
            <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10 pointer-events-none"
              style={{ left: `calc(180px + (100% - 180px) * ${todayPct / 100})` }}>
              <div className="absolute -top-5 -translate-x-1/2 text-[9px] font-bold text-red-500 uppercase">
                Today
              </div>
            </div>
          )}

          {cardsWithDates.map((card) => {
            const project = projects.find((p) => p.id === card.project_id);
            const dept = project ? departments.find((d) => d.id === project.department_id) : null;
            const stage = stageById(card.stage);
            const created = new Date(card.created_at);
            const due = new Date(card.due_date!);
            const startPct = ((created.getTime() - minDate.getTime()) / totalMs) * 100;
            const endPct = ((due.getTime() - minDate.getTime()) / totalMs) * 100;
            const widthPct = Math.max(0.5, endPct - startPct);
            const isOverdue = due < now && card.stage !== "served";

            return (
              <div key={card.id} className="grid items-center mb-1.5"
                style={{ gridTemplateColumns: "180px 1fr" }}>
                <div className="text-xs pr-3 truncate">
                  <div className="flex items-center gap-1.5">
                    {dept && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dept.color }} />}
                    <span className="font-semibold text-ink truncate">{card.title}</span>
                  </div>
                </div>
                <div className="relative h-6">
                  <div className="absolute h-full bg-bg rounded" style={{ left: 0, right: 0 }} />
                  <div
                    className={`absolute h-full rounded flex items-center px-1.5 ${isOverdue ? "ring-1 ring-red-300" : ""}`}
                    style={{
                      left: `${Math.max(0, startPct)}%`,
                      width: `${Math.max(0.5, widthPct)}%`,
                      background: stage.color + "30",
                      border: `1px solid ${stage.color}80`,
                    }}>
                    <div className="h-1.5 rounded-full"
                      style={{ width: `${card.progress}%`, background: stage.color, minWidth: 2 }} />
                    <span className="absolute right-1 text-[9.5px] font-mono font-bold" style={{ color: stage.color }}>
                      {card.progress}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// MENTION INPUT (shared input with @user autocomplete)
// ====================================================================
function MentionInput({ value, onChange, onSubmit, users, placeholder, rows = 1 }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  users: OrgUser[];
  placeholder?: string;
  rows?: number;
}) {
  const [mentionAnchor, setMentionAnchor] = useState<{ start: number; query: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const filtered = mentionAnchor
    ? users
        .filter((u) => {
          const handle = (u.name || u.email.split("@")[0]).toLowerCase();
          return handle.includes(mentionAnchor.query.toLowerCase());
        })
        .slice(0, 6)
    : [];

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const cursor = e.target.selectionStart ?? text.length;
    onChange(text);
    const before = text.slice(0, cursor);
    const match = before.match(/@([\w.-]*)$/);
    if (match) {
      setMentionAnchor({ start: cursor - match[0].length, query: match[1] });
    } else {
      setMentionAnchor(null);
    }
  };

  const selectUser = (u: OrgUser) => {
    const handle = u.name || u.email.split("@")[0];
    const cursor = taRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, mentionAnchor!.start);
    const after = value.slice(cursor);
    onChange(`${before}@${handle} ${after}`);
    setMentionAnchor(null);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  return (
    <div className="relative">
      {filtered.length > 0 && mentionAnchor && (
        <div className="absolute bottom-full mb-1.5 left-0 bg-white border border-line rounded-xl shadow-xl z-50 min-w-[200px] max-h-52 overflow-y-auto">
          <div className="px-3 py-1.5 text-[10.5px] font-semibold text-mute uppercase tracking-wide border-b border-line">
            Mention a person
          </div>
          {filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectUser(u); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-bg text-left transition-colors">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                {(u.name || u.email)[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-ink truncate">
                  {u.name || u.email.split("@")[0]}
                </div>
                {u.name && (
                  <div className="text-[10.5px] text-mute truncate">{u.email}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <textarea
          ref={taRef}
          value={value}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setMentionAnchor(null); return; }
            if (e.key === "Enter" && !e.shiftKey) {
              if (filtered.length > 0 && mentionAnchor) return;
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          rows={rows}
          className="flex-1 px-3 py-2.5 border border-line rounded-xl bg-bg text-sm resize-none leading-relaxed text-ink placeholder:text-mute"
          style={{ minHeight: rows === 1 ? "40px" : "64px" }}
        />
        <button
          onClick={onSubmit}
          disabled={!value.trim()}
          className="flex items-center justify-center w-9 h-9 bg-primary text-white rounded-xl disabled:opacity-40 transition-opacity flex-shrink-0 mb-0.5">
          <Send size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ====================================================================
// NEW CARD MODAL
// ====================================================================
function NewCardModal({ projects, departments, orgUsers, defaultProjectId, onClose, onCreate }: any) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [project_id, setProjectId] = useState(defaultProjectId || projects[0]?.id || "");
  const [assignee_id, setAssigneeId] = useState("");
  const [due_date, setDueDate] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");

  // AI draft state (used in both the static-form path and the A2UI path)
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // A2UI integration: surface the agent renders the form into
  const [a2uiSurface, setA2uiSurface] = useState<any>(null);
  const onCreateRef = useRef(onCreate);
  useEffect(() => { onCreateRef.current = onCreate; }, [onCreate]);

  // Inject A2UI structural styles once on mount (idempotent if already present)
  useEffect(() => { injectA2uiStyles(); }, []);

  const handleA2uiAction = useCallback((action: { name: string; context: Record<string, any> }) => {
    if (action.name !== "submit_card") return;
    const ctx = action.context || {};
    // ChoicePicker values are arrays per v0.9 spec — unwrap to first element.
    const firstOr = (v: any, fallback: any) => {
      if (Array.isArray(v)) return v[0] ?? fallback;
      return v ?? fallback;
    };
    const t = String(ctx.title ?? "").trim();
    if (!t) {
      emitToast({ message: "Title is required.", type: "warning", from: "Create card" });
      return;
    }
    const tagsRaw = String(ctx.tags ?? "").trim();
    const tags = tagsRaw
      ? tagsRaw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10)
      : [];
    const picked_project_id = String(firstOr(ctx.project_id, "") || project_id);
    const picked_priority = String(firstOr(ctx.priority, "medium"));
    onCreateRef.current({
      title: t,
      notes: String(ctx.notes ?? ""),
      project_id: picked_project_id,
      priority: (["high", "medium", "low"].includes(picked_priority) ? picked_priority : "medium") as any,
      due_date: ctx.due_date ? String(ctx.due_date) : null,
      assignee_id: null,
      tags,
    });
  }, [project_id]);

  const draftWithAi = async () => {
    if (!aiPrompt.trim() || aiBusy) return;
    setAiBusy(true);
    setA2uiSurface(null);
    try {
      const r = await fetch("/api/agent/draft-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, project_id: project_id || undefined }),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        throw new Error(`draft failed (${r.status}): ${detail}`);
      }
      const { messages } = await r.json();
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error("agent returned no messages");
      }

      // Build a fresh processor for this draft. Global action handler routes
      // submit_card back to our onCreate.
      const processor = new MessageProcessor([basicCatalog as any], (act: any) => {
        handleA2uiAction({ name: act?.action?.event?.name || act?.name, context: act?.context || act?.action?.event?.context || {} });
      });
      processor.processMessages(messages);
      const surface = Array.from(processor.model.surfacesMap.values())[0];
      if (!surface) throw new Error("no surface created");
      setA2uiSurface(surface);
      emitToast({ message: "Draft ready — review and create.", type: "success", from: "AI assistant" });
    } catch (e) {
      console.error(e);
      emitToast({ message: "Couldn't draft the card. Try again or fill it in manually.", type: "warning", from: "AI assistant" });
    } finally {
      setAiBusy(false);
    }
  };

  const submit = () => {
    if (!title.trim()) return;
    onCreate({
      title,
      project_id,
      assignee_id: assignee_id || null,
      due_date: due_date || null,
      priority,
      notes,
      tags: [],
    });
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm flex items-center justify-center p-5"
      style={{ animation: "fadeIn 0.1s ease" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white/95 backdrop-blur-xl rounded-2xl w-full max-w-[520px] overflow-hidden animate-modalIn"
        style={{ boxShadow: "0 24px 64px -16px rgba(15,23,42,0.2), 0 8px 24px -8px rgba(15,23,42,0.1), 0 0 0 1px rgba(255,255,255,0.6) inset" }}>
        <div className="flex justify-between items-center px-5 py-3.5 border-b border-line/50 bg-gradient-to-r from-[#FAFBFC] to-white">
          <span className="text-xs text-soft font-medium flex items-center gap-1.5">
            <Plus size={12} className="text-primary" />
            New card · starts at <strong className="text-ink">On Order</strong>
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg text-soft hover:text-ink hover:bg-bg transition-all"><X size={15} /></button>
        </div>
        <div className="p-5">
          {/* AI draft panel */}
          <div className="mb-4 p-3 rounded-xl border border-primary/15 bg-gradient-to-br from-primary/5 to-accent/5">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles size={13} className="text-primary" strokeWidth={2.5} />
              <span className="text-[11px] font-bold uppercase tracking-wide text-primary">Draft with AI</span>
              <span className="text-[10.5px] text-mute font-medium">Gemini renders the form below</span>
            </div>
            <div className="flex gap-2">
              <input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), draftWithAi())}
                disabled={aiBusy}
                className="flex-1 px-3 py-2 border border-line/80 rounded-lg bg-white text-xs text-ink placeholder:text-mute/60 focus:border-primary"
                placeholder='e.g. "Set up Q3 launch — landing page + emails by July 18, urgent"'
              />
              <button
                onClick={draftWithAi}
                disabled={!aiPrompt.trim() || aiBusy}
                className="px-3 py-2 bg-primary text-white text-xs font-bold rounded-lg shadow-sm hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap">
                {aiBusy ? "Drafting…" : "Draft"}
              </button>
            </div>
            {a2uiSurface && (
              <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px] text-soft">
                <span className="flex items-center gap-1 text-mute">
                  <CornerDownRight size={10} /> Form rendered by Gemini via A2UI v0.9
                </span>
                <button
                  onClick={() => setA2uiSurface(null)}
                  className="text-primary font-semibold hover:underline">
                  Switch to manual form
                </button>
              </div>
            )}
          </div>

          {a2uiSurface ? (
            <div className="mb-3 rounded-xl border border-line/80 bg-white p-3">
              <A2uiSurface surface={a2uiSurface} />
            </div>
          ) : (
          <>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full px-4 py-3.5 border border-line/80 rounded-xl bg-white text-base font-semibold text-ink mb-3 hover:border-primary/30 focus:border-primary focus:shadow-glow transition-all duration-200 placeholder:text-mute/50"
            placeholder="What needs to be done?"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-line/80 rounded-lg bg-white text-xs text-ink leading-relaxed resize-y mb-3 placeholder:text-mute/60"
            placeholder="Notes (optional) — what + why"
          />
          <div className="flex gap-3">
            <Field label="Project">
              <select
                value={project_id}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-2.5 py-2 border border-line/80 rounded-lg bg-white text-xs text-ink hover:border-primary/30 transition-colors">
                {projects.map((p: Project) => {
                  const dept = departments.find((d: Department) => d.id === p.department_id);
                  return (
                    <option key={p.id} value={p.id}>
                      {dept ? `${dept.name} \u2192 ` : ""}{p.name}
                    </option>
                  );
                })}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full px-2.5 py-2 border border-line/80 rounded-lg bg-white text-xs text-ink hover:border-primary/30 transition-colors">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-3">
            <Field label="Assignee">
              <select
                value={assignee_id}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full px-2.5 py-2 border border-line/80 rounded-lg bg-white text-xs text-ink hover:border-primary/30 transition-colors">
                <option value="">Unassigned</option>
                {orgUsers.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </select>
            </Field>
            <Field label="Due Date">
              <input
                type="date"
                value={due_date}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-2.5 py-2 border border-line/80 rounded-lg bg-white text-xs text-ink hover:border-primary/30 transition-colors"
              />
            </Field>
          </div>
          </>
          )}
          <div className="flex gap-2.5 justify-end mt-3 pt-3 border-t border-line/40">
            <button
              onClick={onClose}
              className="px-4 py-2.5 bg-white border border-line/80 rounded-xl text-xs font-medium text-soft hover:text-ink hover:border-line transition-all">
              {a2uiSurface ? "Close" : "Cancel"}
            </button>
            {!a2uiSurface && (
              <button
                onClick={submit}
                className="px-5 py-2.5 bg-brand-grad text-white text-xs font-bold rounded-xl shadow-pop hover:shadow-neon hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200">
                Create card
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
