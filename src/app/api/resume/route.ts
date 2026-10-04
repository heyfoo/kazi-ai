import { NextResponse } from "next/server";
import { store } from "@/lib/kazi/store";
import { collapseWhitespace } from "@/lib/kazi/text";

export async function GET() {
  const db = await store.get();
  return NextResponse.json({ resume: db.resume ?? null });
}

async function extractText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const { extractText: pdfText } = await import("unpdf");
    const { text } = await pdfText(buf, { mergePages: true });
    return text;
  }
  return new TextDecoder().decode(buf);
}

export async function POST(req: Request) {
  let rawText = "";
  let fileName: string | undefined;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const text = form.get("text");
    if (file instanceof File && file.size > 0) {
      if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "File is larger than 5 MB." }, { status: 413 });
      try {
        rawText = await extractText(file);
        fileName = file.name;
      } catch (err) {
        return NextResponse.json({ error: `Could not read ${file.name}: ${(err as Error).message}` }, { status: 400 });
      }
    } else if (typeof text === "string") {
      rawText = text;
    }
  } else {
    const body = (await req.json().catch(() => ({}))) as { text?: string };
    rawText = body.text ?? "";
  }

  rawText = collapseWhitespace(rawText);
  if (rawText.length < 200) {
    return NextResponse.json({ error: "That resume is too short to work with (need at least 200 characters of text)." }, { status: 400 });
  }

  const resume = await store.update((db) => {
    db.resume = { rawText, fileName, updatedAt: new Date().toISOString() };
    return db.resume;
  });
  return NextResponse.json({ resume });
}

export async function DELETE() {
  await store.update((db) => {
    db.resume = undefined;
  });
  return NextResponse.json({ ok: true });
}
