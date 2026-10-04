import { NextResponse } from "next/server";
import { providerStatus } from "@/lib/kazi/status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await providerStatus());
}
