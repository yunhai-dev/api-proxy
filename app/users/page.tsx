import { PageHead } from "@/components/page-head";
import { UsersTable } from "@/components/users/users-table";
import { requireAdmin } from "@/lib/auth";

export default async function UsersPage() {
  await requireAdmin();
  return (
    <div className="container data-container">
      <PageHead
        title="用户管理"
        sub="管理控制台用户与角色，角色包括超级管理员、管理员和用户。"
      />
      <UsersTable />
    </div>
  );
}
