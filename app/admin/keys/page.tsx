import { PageHead } from "@/components/page-head";
import { db, schema } from "@/lib/db";
import { KeysTable } from "@/components/keys/keys-table";
import { requireAdmin } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";

export const dynamic = "force-dynamic";

export default async function AdminKeysPage() {
  await requireAdmin();
  const all = usePostgres()
    ? await (async () => {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      return pgDb.select().from(pgSchema.keys);
    })()
    : db.select().from(schema.keys).all();
  const active = all.filter(k => k.status === "active").length;
  const disabled = all.length - active;

  return (
    <div className="container data-container">
      <PageHead
        title="管理 API 密钥"
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
      <KeysTable mode="admin" />
    </div>
  );
}
