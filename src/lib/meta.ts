import crypto from "crypto";

// Verify Meta's X-Hub-Signature-256 over the EXACT raw request body (handoff §7).
// Must be called with the raw body string (request.text()), never a re-serialized
// object, or the HMAC won't match.
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export type FbField = { name: string; values: string[] };

// Flatten Meta lead field_data into our lead shape. Handles common English +
// Thai field names, and normalises a +66 phone to leading 0.
export function flattenLeadFields(fieldData: FbField[]): {
  customerName: string | null;
  phone: string | null;
  modelInterest: string | null;
  budgetRange: string | null;
  rawMessage: string | null;
} {
  const fields: Record<string, string> = {};
  for (const f of fieldData ?? []) fields[f.name] = String((f.values ?? [])[0] ?? "").trim();

  const pick = (...needles: string[]): string | null => {
    for (const n of needles) {
      const k = Object.keys(fields).find((x) => x.toLowerCase().includes(n));
      if (k && fields[k]) return fields[k];
    }
    return null;
  };

  let phone = pick("phone", "เบอร์", "โทร");
  if (phone) phone = phone.replace(/[^0-9+]/g, "").replace(/^\+66/, "0");

  const extra = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");

  return {
    customerName: pick("full_name", "name", "ชื่อ"),
    phone,
    modelInterest: pick("model", "รุ่น", "car", "vehicle"),
    budgetRange: pick("budget", "งบ", "ราคา"),
    rawMessage: extra || null,
  };
}
