"use client";

// In-house LINE chat inbox (user req 2026-07-08, redesigned 2026-07-11 to
// match LINE's own app conventions — compact rows: circular avatar, name +
// last-message preview, relative date top-right, green unread-count badge).
// Two-pane on desktop; on mobile only one pane shows at a time (list, or
// thread-with-back-button), matching how LINE itself behaves on a phone —
// staff reply to customers from here instead of LINE OA Manager.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Send, Loader2, MessageCircleQuestion, ChevronLeft, FileText, Trash2 } from "lucide-react";
import { fmtRelativeDay, fmtDateTime } from "@/lib/date";

type Conversation = {
  leadId: number; customerName: string; pictureUrl: string | null; brand: string; branch: string;
  ownerName: string | null;
  lastMessage: string | null; lastMessageAt: string | null; unreadCount: number;
};
type Unresolved = { lineUserId: string; lastMessage: string | null; lastMessageAt: string | null };
type ChatMsg = { messageId: number; direction: string; body: string | null; sentByUserId: number | null; createdAt: string };

// Deterministic pastel-ish color from a name, so avatars aren't all identical
// (LINE does this too) — reuses the app's existing accent/amber/red-soft
// tokens rather than inventing a new palette.
const AVATAR_TONES = ["bg-[var(--accent-soft)] text-[var(--accent-text)]", "bg-[var(--amber-soft)] text-[var(--amber)]", "bg-[var(--red-soft)] text-[var(--red)]", "bg-[var(--green-soft)] text-[var(--green)]"];
function avatarTone(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

// A sent quotation's chat log includes a staff-only reopen link (see
// /api/quotes/[id]/send) as a bare "/api/quotes/{id}/pdf" line — this is the
// only place PDF links show up in chat, so render it as a real link rather
// than adding a message "type" column for one case (user-reported 2026-07-13:
// no way to reopen a PDF once sent).
const PDF_LINK_RE = /\/api\/quotes\/\d+\/pdf/;
function MessageBody({ body, outbound }: { body: string | null; outbound: boolean }) {
  if (!body) return null;
  const match = body.match(PDF_LINK_RE);
  if (!match) return <div className="whitespace-pre-line">{body}</div>;
  const [before, after] = [body.slice(0, match.index).trim(), body.slice((match.index ?? 0) + match[0].length).trim()];
  return (
    <div>
      {before && <div className="whitespace-pre-line">{before}</div>}
      <a href={match[0]} target="_blank" rel="noreferrer"
        className={`inline-flex items-center gap-1 mt-1.5 px-2.5 py-1 rounded-lg text-[.78rem] font-medium ${
          outbound ? "bg-white/15 text-white hover:bg-white/25" : "bg-[var(--accent-soft)] text-[var(--accent-text)] hover:opacity-80"}`}>
        <FileText size={12} /> เปิดใบเสนอราคา (PDF)
      </a>
      {after && <div className="whitespace-pre-line mt-1">{after}</div>}
    </div>
  );
}

// LINE profile picture when the customer has one (user req 2026-07-11) —
// falls back to the deterministic color-initials avatar otherwise.
function Avatar({ name, pictureUrl, size }: { name: string; pictureUrl?: string | null; size: "sm" | "lg" }) {
  const cls = size === "lg" ? "h-11 w-11 text-[.8rem]" : "h-8 w-8 text-[.7rem]";
  if (pictureUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={pictureUrl} alt="" className={`${cls} rounded-full object-cover shrink-0`} />;
  }
  return (
    <div className={`${cls} rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarTone(name)}`}>
      {name.slice(0, 2)}
    </div>
  );
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [unresolved, setUnresolved] = useState<Unresolved[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Feature switch (ตั้งค่า > ตั้งค่าใบเสนอราคา) — the quote button below
  // only renders while an admin has it turned on.
  const [quotationEnabled, setQuotationEnabled] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loadInboxRef = useRef<() => void>(() => {});

  useEffect(() => {
    const loadInbox = () => fetch("/api/chat/inbox").then((r) => r.json()).then((d) => {
      setConversations(d.conversations ?? []); setUnresolved(d.unresolved ?? []);
    }).catch(() => {});
    loadInboxRef.current = loadInbox;
    loadInbox();
    fetch("/api/settings/features").then((r) => r.json()).then((f) => setQuotationEnabled(!!f.quotationEnabled)).catch(() => {});
    const t = setInterval(loadInbox, 5000);
    return () => clearInterval(t);
  }, []);

  async function removeUnresolved(lineUserId: string) {
    if (!confirm("ลบข้อความชุดนี้ออกจากระบบ?")) return;
    await fetch(`/api/chat/unresolved/${encodeURIComponent(lineUserId)}`, { method: "DELETE" });
    loadInboxRef.current();
  }

  useEffect(() => {
    if (!selectedLeadId) { setMessages(null); return; }
    const loadThread = () => fetch(`/api/leads/${selectedLeadId}/chat`).then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) setMessages(d);
    }).catch(() => {});
    loadThread();
    const t = setInterval(loadThread, 5000);
    return () => clearInterval(t);
  }, [selectedLeadId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    if (!text.trim() || !selectedLeadId) return;
    setSending(true); setError(null);
    const res = await fetch(`/api/leads/${selectedLeadId}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
    });
    setSending(false);
    if (res.ok) {
      setText("");
      fetch(`/api/leads/${selectedLeadId}/chat`).then((r) => r.json()).then((d) => { if (Array.isArray(d)) setMessages(d); });
      fetch("/api/chat/inbox").then((r) => r.json()).then((d) => setConversations(d.conversations ?? []));
    } else setError((await res.json().catch(() => ({}))).error ?? "ส่งไม่สำเร็จ");
  }

  const selected = conversations?.find((c) => c.leadId === selectedLeadId);

  return (
    <div className="h-[calc(100vh-100px)] flex gap-4">
      {/* ── conversation list ── hidden on mobile once a thread is open */}
      <div className={`w-full md:w-[300px] shrink-0 bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-hidden flex-col ${selectedLeadId ? "hidden md:flex" : "flex"}`}>
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h1 className="text-[.95rem] font-semibold">แชทลูกค้า</h1>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations === null ? (
            <p className="p-4 text-sm text-[var(--text-2)]">กำลังโหลด…</p>
          ) : conversations.length === 0 && unresolved.length === 0 ? (
            <p className="p-4 text-sm text-[var(--text-2)]">ยังไม่มีข้อความ</p>
          ) : (
            <>
              {conversations.map((c) => (
                <button key={c.leadId} onClick={() => setSelectedLeadId(c.leadId)}
                  className={`w-full text-left px-3.5 py-3 flex items-center gap-3 border-b border-[var(--border)] transition ${
                    selectedLeadId === c.leadId ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]"}`}>
                  <Avatar name={c.customerName} pictureUrl={c.pictureUrl} size="lg" />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[.86rem] truncate ${c.unreadCount > 0 ? "font-semibold" : "font-medium"}`}>{c.customerName}</div>
                    <div className={`text-[.76rem] truncate mt-0.5 ${c.unreadCount > 0 ? "text-[var(--text)]" : "text-[var(--text-3)]"}`}>
                      {c.lastMessage ?? `${c.brand} · ${c.branch}`}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[.66rem] text-[var(--text-3)]">{fmtRelativeDay(c.lastMessageAt)}</span>
                    {c.unreadCount > 0 && (
                      <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-[var(--green)] text-white text-[.64rem] font-semibold flex items-center justify-center">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {unresolved.length > 0 && (
                <div className="px-4 py-2 text-[.68rem] font-semibold text-[var(--text-3)] uppercase tracking-wide bg-[var(--bg)]">
                  ไม่ทราบที่มา ({unresolved.length})
                </div>
              )}
              {unresolved.map((u) => (
                <div key={u.lineUserId} className="px-3.5 py-3 border-b border-[var(--border)] flex items-start gap-3">
                  <div className="h-11 w-11 rounded-full bg-[var(--bg)] text-[var(--text-3)] flex items-center justify-center shrink-0">
                    <MessageCircleQuestion size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[.8rem] text-[var(--text-2)] truncate">{u.lastMessage ?? "—"}</div>
                    <div className="text-[.66rem] text-[var(--text-3)] mt-0.5">{fmtRelativeDay(u.lastMessageAt)}</div>
                  </div>
                  <button onClick={() => removeUnresolved(u.lineUserId)} title="ลบ"
                    className="p-1.5 rounded hover:bg-[var(--red-soft)] text-[var(--text-3)] hover:text-[var(--red)] shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── thread ── on mobile this is the only pane shown once selected */}
      <div className={`flex-1 bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-hidden flex-col min-w-0 ${selectedLeadId ? "flex" : "hidden md:flex"}`}>
        {!selectedLeadId ? (
          <div className="flex-1 flex items-center justify-center text-[var(--text-2)] text-sm">เลือกการสนทนาทางซ้าย</div>
        ) : (
          <>
            <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center gap-2.5">
              <button onClick={() => setSelectedLeadId(null)} className="md:hidden p-1 -ml-1 rounded-lg text-[var(--text-2)] hover:bg-[var(--surface-2)]">
                <ChevronLeft size={20} />
              </button>
              <Avatar name={selected?.customerName ?? "?"} pictureUrl={selected?.pictureUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-[.86rem] font-semibold truncate">{selected?.customerName ?? "…"}</div>
                <div className="text-[.7rem] text-[var(--text-3)] truncate">
                  {selected?.brand} · {selected?.branch}{selected?.ownerName ? ` · ${selected.ownerName}` : ""}
                </div>
              </div>
              {quotationEnabled && (
                <Link href={`/quotes/new?lead=${selectedLeadId}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[.76rem] font-medium border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)] text-[var(--text-2)] shrink-0">
                  <FileText size={13} /> สร้างใบเสนอราคา
                </Link>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages === null ? (
                <p className="text-sm text-[var(--text-2)]">กำลังโหลด…</p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-[var(--text-3)]">ยังไม่มีข้อความ</p>
              ) : messages.map((m) => (
                <div key={m.messageId} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-[.84rem] ${
                    m.direction === "outbound" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg)] text-[var(--text)]"}`}>
                    <MessageBody body={m.body} outbound={m.direction === "outbound"} />
                    <div className={`text-[.62rem] mt-1 ${m.direction === "outbound" ? "text-white/70" : "text-[var(--text-3)]"}`}>
                      {fmtDateTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="p-3 border-t border-[var(--border)]">
              {error && <p className="text-[.74rem] text-[var(--red)] mb-1.5">❌ {error}</p>}
              <div className="flex items-center gap-2">
                <input value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !sending) send(); }}
                  className="flex-1 px-3.5 py-2.5 text-[.9rem] bg-white border border-[var(--border-2)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  placeholder="พิมพ์ข้อความ…" />
                <button onClick={send} disabled={sending || !text.trim()}
                  className="p-2.5 rounded-xl bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
