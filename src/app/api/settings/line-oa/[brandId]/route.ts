import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ brandId: string }> };

// Save/replace a brand's LINE OA credentials. Body: { channelAccessToken, channelSecret,
// isActive? } — a full replace every time (no partial-field patching), since we never
// send the existing secret back to the client to merge against.
//
// `destination` (the bot's own userId, matched against LINE's webhook `destination`
// field) is deliberately NOT collected here — LINE's console doesn't expose a
// copyable field for it anywhere (confirmed live 2026-07-11), so it's
// auto-detected the first time this brand's channel sends a real webhook
// event, by testing the signature against every configured secret. See
// resolveLineCreds in src/lib/lineConfig.ts.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { brandId: brandIdStr } = await params;
  const brandId = Number(brandIdStr);
  if (!Number.isInteger(brandId)) return NextResponse.json({ error: "invalid brandId" }, { status: 400 });

  const brand = await prisma.brand.findUnique({ where: { brandId } });
  if (!brand) return NextResponse.json({ error: "ไม่พบยี่ห้อ" }, { status: 404 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const channelAccessToken = typeof b.channelAccessToken === "string" ? b.channelAccessToken.trim() : "";
  const channelSecret = typeof b.channelSecret === "string" ? b.channelSecret.trim() : "";
  const isActive = b.isActive !== false;
  if (!channelAccessToken || !channelSecret) {
    return NextResponse.json({ error: "กรุณากรอก Channel Access Token และ Channel Secret ให้ครบ" }, { status: 400 });
  }

  try {
    await prisma.brandLineConfig.upsert({
      where: { brandId },
      create: { brandId, channelAccessToken, channelSecret, isActive: isActive ? 1 : 0 },
      update: { channelAccessToken, channelSecret, isActive: isActive ? 1 : 0 },
    });
  } catch (e) {
    console.error(`[line-oa] save failed for brand ${brandId}:`, e);
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ — ดู docker logs fun-app สำหรับรายละเอียด" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// Toggle isActive (pause a brand's messaging OA) and/or set the LIFF app id
// — both independent of the Messaging token/secret, so this upserts (a
// brand's LIFF can be configured before its Messaging credentials exist).
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { brandId: brandIdStr } = await params;
  const brandId = Number(brandIdStr);
  if (!Number.isInteger(brandId)) return NextResponse.json({ error: "invalid brandId" }, { status: 400 });

  const brand = await prisma.brand.findUnique({ where: { brandId } });
  if (!brand) return NextResponse.json({ error: "ไม่พบยี่ห้อ" }, { status: 404 });

  const b = (await request.json().catch(() => ({}))) as { isActive?: boolean; liffId?: string };
  const liffIdProvided = typeof b.liffId === "string";
  const liffId = liffIdProvided ? (b.liffId as string).trim() || null : undefined;
  const isActiveProvided = typeof b.isActive === "boolean";

  await prisma.brandLineConfig.upsert({
    where: { brandId },
    create: { brandId, liffId: liffId ?? null, isActive: isActiveProvided ? (b.isActive ? 1 : 0) : 1 },
    update: {
      ...(liffIdProvided ? { liffId } : {}),
      ...(isActiveProvided ? { isActive: b.isActive ? 1 : 0 } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
