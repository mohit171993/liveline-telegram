import { prisma } from "@liveline/db";
import {
  bindDecision,
  envAdminTokens,
  envTokenCovered,
  normalizeAdminToken,
  revokeGuard,
  roleChangeGuard,
  type AdminGrantView,
  type AdminRole,
} from "@liveline/shared";
import { env } from "../env";
import { httpError } from "../httpError";

let seeded: Promise<void> | null = null;

function roleLabel(role: string): string {
  return role === "owner" ? "owner" : "full admin";
}

function toGrant(row: { id: string; telegramId: string | null; usernameNorm: string | null; role: string; revokedAt: Date | null }): AdminGrantView {
  return {
    id: row.id,
    telegramId: row.telegramId,
    usernameNorm: row.usernameNorm,
    role: row.role === "owner" ? "owner" : "full",
    revoked: Boolean(row.revokedAt),
  };
}

async function writeAudit(entry: {
  actorId?: string | null;
  action: string;
  targetId?: string | null;
  targetUser?: string | null;
  role?: string | null;
  detail: string;
}) {
  await prisma.adminAudit.create({
    data: {
      actorId: entry.actorId || null,
      action: entry.action,
      targetId: entry.targetId || null,
      targetUser: entry.targetUser || null,
      role: entry.role || null,
      detail: entry.detail,
    },
  });
}

export function ensureEnvAdmins(): Promise<void> {
  if (!seeded) {
    seeded = seedEnvAdmins().catch((err) => {
      seeded = null;
      throw err;
    });
  }
  return seeded;
}

async function seedEnvAdmins() {
  const tokens = envAdminTokens(env.adminRaw);
  for (const token of tokens) {
    const rows = await prisma.adminAccount.findMany();
    const handle = token.kind === "username" ? `@${token.value}` : token.value;
    const active = rows.find((row) => !row.revokedAt && (token.kind === "id" ? row.telegramId === token.value : row.usernameNorm === token.value));
    if (active?.source === "env" && active.role !== token.role) {
      await prisma.adminAccount.update({ where: { id: active.id }, data: { role: token.role } });
      await writeAudit({
        action: "role",
        targetId: active.telegramId,
        targetUser: active.username,
        role: token.role,
        detail: `Env set ${handle} to ${roleLabel(token.role)}`,
      });
    }
    if (envTokenCovered(rows, token)) continue;
    try {
      const created = await prisma.adminAccount.create({
        data: {
          telegramId: token.kind === "id" ? token.value : null,
          username: token.kind === "username" ? token.value : null,
          usernameNorm: token.kind === "username" ? token.value : null,
          role: token.role,
          source: "env",
          boundAt: token.kind === "id" ? new Date() : null,
        },
      });
      await writeAudit({
        action: "seed",
        targetId: created.telegramId,
        targetUser: created.username,
        role: created.role,
        detail: `Env listed ${handle} as ${roleLabel(token.role)}`,
      });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }
}

export async function userIsAdmin(telegramId: string | number, username?: string | null): Promise<boolean> {
  await ensureEnvAdmins();
  const id = String(telegramId);
  const rows = await prisma.adminAccount.findMany();
  const decision = bindDecision(rows.map(toGrant), id, username);
  if (decision.action === "none" || decision.action === "deny") return false;
  if (decision.action === "already") return true;
  const updated = await prisma.adminAccount.updateMany({
    where: { id: decision.grantId, telegramId: null, revokedAt: null },
    data: { telegramId: id, boundAt: new Date() },
  });
  if (updated.count === 1) {
    const grant = rows.find((row) => row.id === decision.grantId);
    const handle = grant?.username || username || id;
    await writeAudit({
      actorId: id,
      action: "bind",
      targetId: id,
      targetUser: grant?.username || null,
      role: grant?.role || "full",
      detail: `Bound @${String(handle).replace(/^@/, "")} to ${id}`,
    });
    return true;
  }
  const winner = await prisma.adminAccount.findFirst({ where: { telegramId: id, revokedAt: null } });
  return Boolean(winner);
}

export async function adminChatIds(): Promise<string[]> {
  await ensureEnvAdmins();
  const rows = await prisma.adminAccount.findMany({ where: { revokedAt: null, telegramId: { not: null } } });
  return [...new Set(rows.map((row) => row.telegramId).filter((id): id is string => Boolean(id)))];
}

function present(row: {
  id: string;
  telegramId: string | null;
  username: string | null;
  role: string;
  source: string;
  addedBy: string | null;
  boundAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    telegramId: row.telegramId,
    username: row.username,
    role: row.role === "owner" ? "owner" : "full",
    roleLabel: roleLabel(row.role),
    source: row.source,
    bound: Boolean(row.telegramId),
    addedBy: row.addedBy,
    boundAt: row.boundAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAdminRoster() {
  await ensureEnvAdmins();
  const [admins, audit] = await Promise.all([
    prisma.adminAccount.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.adminAudit.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  return {
    admins: admins.map(present),
    audit: audit.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      targetId: row.targetId,
      targetUser: row.targetUser,
      role: row.role,
      detail: row.detail,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

async function activeGrants() {
  const rows = await prisma.adminAccount.findMany({ where: { revokedAt: null } });
  return rows.map((row) => ({ id: row.id, role: (row.role === "owner" ? "owner" : "full") as AdminRole }));
}

export async function addAdmin(actorTelegramId: string, handle: string, role: AdminRole) {
  await ensureEnvAdmins();
  const token = normalizeAdminToken(handle);
  if (!token) throw httpError(400, "BAD_HANDLE", "Enter a numeric Telegram id or a username like @Liveline_proadmin.");
  const existing = await prisma.adminAccount.findMany({ where: { revokedAt: null } });
  if (token.kind === "id" && existing.some((row) => row.telegramId === token.value)) {
    throw httpError(409, "EXISTS", "That Telegram id is already an admin.");
  }
  if (token.kind === "username" && existing.some((row) => row.usernameNorm === token.value)) {
    throw httpError(409, "EXISTS", "That username is already an admin.");
  }
  const known = token.kind === "id" ? await prisma.user.findUnique({ where: { telegramId: token.value } }) : null;
  const created = await prisma.adminAccount.create({
    data: {
      telegramId: token.kind === "id" ? token.value : null,
      username: token.kind === "username" ? token.value : known?.username?.replace(/^@/, "") || null,
      usernameNorm: token.kind === "username" ? token.value : null,
      role,
      source: "panel",
      addedBy: actorTelegramId,
      boundAt: token.kind === "id" ? new Date() : null,
    },
  });
  const label = token.kind === "username" ? `@${token.value}` : token.value;
  await writeAudit({
    actorId: actorTelegramId,
    action: "add",
    targetId: created.telegramId,
    targetUser: created.username,
    role,
    detail: `Added ${label} as ${roleLabel(role)}`,
  });
  return present(created);
}

export async function removeAdmin(actorTelegramId: string, id: string) {
  await ensureEnvAdmins();
  const guard = revokeGuard(await activeGrants(), id);
  if (guard === "NOT_FOUND") throw httpError(404, "NOT_FOUND", "That admin is not on the list.");
  if (guard === "LAST_OWNER") throw httpError(409, "LAST_OWNER", "The last owner stays. Add another owner first.");
  const row = await prisma.adminAccount.update({ where: { id }, data: { revokedAt: new Date() } });
  const label = row.username ? `@${row.username}` : row.telegramId || id;
  await writeAudit({
    actorId: actorTelegramId,
    action: "remove",
    targetId: row.telegramId,
    targetUser: row.username,
    role: row.role,
    detail: `Removed ${label}`,
  });
  return { ok: true };
}

export async function setAdminRole(actorTelegramId: string, id: string, role: AdminRole) {
  await ensureEnvAdmins();
  const guard = roleChangeGuard(await activeGrants(), id, role);
  if (guard === "NOT_FOUND") throw httpError(404, "NOT_FOUND", "That admin is not on the list.");
  if (guard === "LAST_OWNER") throw httpError(409, "LAST_OWNER", "The last owner stays an owner.");
  if (guard === "SAME") {
    const row = await prisma.adminAccount.findUniqueOrThrow({ where: { id } });
    return present(row);
  }
  const row = await prisma.adminAccount.update({ where: { id }, data: { role } });
  const label = row.username ? `@${row.username}` : row.telegramId || id;
  await writeAudit({
    actorId: actorTelegramId,
    action: "role",
    targetId: row.telegramId,
    targetUser: row.username,
    role,
    detail: `Set ${label} to ${roleLabel(role)}`,
  });
  return present(row);
}
