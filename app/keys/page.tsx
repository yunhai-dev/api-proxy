import { PageHead } from "@/components/page-head";
import { db, schema } from "@/lib/db";
import { KeysTable } from "@/components/keys/keys-table";
import { requireUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { usePostgres } from "@/lib/db/runtime";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const user = await requireUser();
  const all = usePostgres()
    ? await (async () => {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      return pgDb.select().from(pgSchema.keys).where(eq(pgSchema.keys.userId, user.id));
    })()
    : db.select().from(schema.keys).where(eq(schema.keys.userId, user.id)).all();
  const active = all.filter(k => k.status === "active").length;
  const disabled = all.length - active;

  return (
    <div className="container data-container">
      <PageHead
        title="API 密钥"
        sub={
          <>
            <span>{all.length} 个密钥</span>
            <span className="sep">/</span>
            <span>{active} 个活跃</span>
            <span className="sep">/</span>
            <span>{disabled} 个已停用</span>
          </>
        }
      />
      <KeysTable />
    </div>
  );
}
