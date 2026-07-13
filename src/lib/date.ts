// House date format for the whole app: dd/mm/yyyy, Gregorian (ค.ศ., NOT Buddhist
// era — th-TH locale formatting defaults to Buddhist year, so every date
// display must go through this helper instead of toLocaleDateString("th-TH").
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Short day/month for compact "due" chips (no year — never needs the
// Buddhist-vs-Gregorian question at all).
export function fmtDayMonth(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// "วันนี้" / "เมื่อวาน" / dd/mm — LINE-app-style relative day label for chat
// lists (user req 2026-07-11). Falls back to fmtDayMonth beyond yesterday.
export function fmtRelativeDay(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  const startOfDay = (x: Date) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c; };
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diffDays = Math.round((today.getTime() - target.getTime()) / 864e5);
  if (diffDays === 0) return "วันนี้";
  if (diffDays === 1) return "เมื่อวาน";
  return fmtDayMonth(date);
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${fmtDate(date)} ${hh}:${min}`;
}
