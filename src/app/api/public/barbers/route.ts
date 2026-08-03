import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { barbers } from "@/db/schema";

export async function GET() {
  const rows = await db
    .select({ id: barbers.id, slug: barbers.slug, name: barbers.name, photo: barbers.photo, bio: barbers.bio })
    .from(barbers)
    .where(eq(barbers.active, true))
    .orderBy(barbers.name);
  return NextResponse.json({ barbers: rows });
}
