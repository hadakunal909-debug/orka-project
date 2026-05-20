import { NextRequest, NextResponse } from "next/server";
import { requireUser, dbError } from "@/lib/api-helpers";
import { requireCardAccess } from "@/lib/card-access";

const BUCKET = "card-attachments";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB cap

/**
 * GET /api/cards/[id]/attachments
 * Lists attachments for a card with signed download URLs (5 minute expiry).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const card = await requireCardAccess(ctx, params.id);
  if (card instanceof NextResponse) return card;

  const { data: rows, error } = await ctx.sb
    .from("card_attachments")
    .select("*")
    .eq("card_id", params.id)
    .order("created_at", { ascending: false });
  if (error) return dbError(error);

  // Resolve signed URLs in parallel
  const withUrls = await Promise.all(
    (rows ?? []).map(async (r) => {
      const { data: signed } = await ctx.sb.storage
        .from(BUCKET)
        .createSignedUrl(r.storage_path, 60 * 5);
      return { ...r, url: signed?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ attachments: withUrls });
}

/**
 * POST /api/cards/[id]/attachments
 * Body: multipart/form-data with field "file"
 * Uploads the file to Supabase Storage and inserts a card_attachments row.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const card = await requireCardAccess(ctx, params.id);
  if (card instanceof NextResponse) return card;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected multipart 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 400 });
  }

  // Build a unique storage path so two uploads with the same name don't collide.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${ctx.orgId}/${params.id}/${stamp}-${rand}-${safeName}`;

  const buffer = await file.arrayBuffer();
  const { error: uploadErr } = await ctx.sb.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type || undefined, upsert: false });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: row, error: insertErr } = await ctx.sb
    .from("card_attachments")
    .insert({
      card_id: params.id,
      org_id: ctx.orgId,
      uploader_id: ctx.userId,
      storage_path: path,
      filename: file.name,
      content_type: file.type || null,
      size_bytes: file.size,
    })
    .select()
    .single();

  if (insertErr) {
    await ctx.sb.storage.from(BUCKET).remove([path]).catch(() => {});
    return dbError(insertErr);
  }

  const { data: signed } = await ctx.sb.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 5);

  return NextResponse.json({ attachment: { ...row, url: signed?.signedUrl ?? null } }, { status: 201 });
}

/**
 * DELETE /api/cards/[id]/attachments?attachment_id=<uuid>
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const card = await requireCardAccess(ctx, params.id);
  if (card instanceof NextResponse) return card;

  const url = new URL(req.url);
  const attachmentId = url.searchParams.get("attachment_id");
  if (!attachmentId) return NextResponse.json({ error: "attachment_id required" }, { status: 400 });

  const { data: row, error: fetchErr } = await ctx.sb
    .from("card_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .eq("card_id", params.id)
    .single();
  if (fetchErr || !row) return NextResponse.json({ error: "not found" }, { status: 404 });

  await ctx.sb.storage.from(BUCKET).remove([row.storage_path]).catch(() => {});
  const { error: delErr } = await ctx.sb
    .from("card_attachments")
    .delete()
    .eq("id", attachmentId);
  if (delErr) return dbError(delErr);

  return NextResponse.json({ ok: true });
}
