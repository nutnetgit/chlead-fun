// Central password policy — used by every place that sets/changes a password.

const COMMON = new Set([
  "password", "password1", "12345678", "123456789", "11111111", "qwerty123",
  "abcd1234", "erawan123", "fun12345", "00000000", "iloveyou",
]);

/** Returns a Thai error string if the password is too weak, or null if OK. */
export function validatePassword(pw: string): string | null {
  const v = String(pw ?? "");
  if (v.length < 8) return "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร";
  if (!/[A-Za-z]/.test(v)) return "ต้องมีตัวอักษรภาษาอังกฤษอย่างน้อย 1 ตัว";
  if (!/[0-9]/.test(v)) return "ต้องมีตัวเลขอย่างน้อย 1 ตัว";
  if (COMMON.has(v.toLowerCase())) return "รหัสผ่านนี้คาดเดาง่ายเกินไป กรุณาตั้งใหม่";
  return null;
}

/** A strong, readable one-time password (always satisfies the policy) — handed to a user once when an admin resets their password. */
export function genTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digit = "23456789";
  const all = upper + lower + digit;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let body = "";
  for (let i = 0; i < 7; i++) body += pick(all);
  const chars = (pick(upper) + pick(lower) + pick(digit) + body).split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
