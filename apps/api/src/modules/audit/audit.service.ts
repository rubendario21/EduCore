import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import {
  paginated,
  type Paginated,
  type PaginationQueryDto,
  toPrismaPage,
} from '../../common/pagination/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Datos de la petición que originó el evento (para trazabilidad y soporte). */
export interface AuditRequestContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEvent {
  institutionId: string | null;
  actorUserId: string | null;
  /** `modulo.entidad.accion`, p. ej. `users.account.created`. */
  action: string;
  entityType?: string;
  entityId?: string;
  changes?: AuditChanges;
  metadata?: Record<string, unknown>;
  context?: AuditRequestContext;
}

export type AuditChanges = Record<string, { from: unknown; to: unknown }>;

/** Campos que nunca se copian a la auditoría, aunque cambien. */
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'refreshToken',
  'refreshTokenHash',
]);

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object' && 'toFixed' in value) return String(value);
  return value ?? null;
}

/**
 * Calcula `{ campo: { from, to } }` solo para los campos indicados que cambiaron,
 * excluyendo siempre los campos sensibles.
 */
export function diffChanges<T extends object>(
  before: T | null,
  after: T | null,
  fields: ReadonlyArray<keyof T & string>,
): AuditChanges {
  const changes: AuditChanges = {};
  for (const field of fields) {
    if (SENSITIVE_FIELDS.has(field)) continue;
    const from = normalize(before?.[field]);
    const to = normalize(after?.[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

/**
 * Registro de auditoría de solo inserción. Debe llamarse dentro de la misma
 * transacción que la operación auditada, para que ambas se confirmen o
 * reviertan juntas.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        institutionId: event.institutionId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        changes:
          event.changes && Object.keys(event.changes).length > 0
            ? (event.changes as Prisma.InputJsonValue)
            : undefined,
        metadata: event.metadata as Prisma.InputJsonValue | undefined,
        ip: event.context?.ip?.slice(0, 45),
        userAgent: event.context?.userAgent?.slice(0, 300),
        requestId: event.context?.requestId?.slice(0, 64),
      },
    });
  }

  /** Eventos de UNA institución, del más reciente al más antiguo. */
  async list(institutionId: string, query: AuditListQuery): Promise<Paginated<AuditLogView>> {
    const where: Prisma.AuditLogWhereInput = {
      institutionId,
      ...(query.action &&
        (query.action.endsWith('*')
          ? { action: { startsWith: query.action.slice(0, -1) } }
          : { action: query.action })),
      ...(query.entityType && { entityType: query.entityType }),
      ...(query.entityId && { entityId: query.entityId }),
      ...(query.actorUserId && { actorUserId: query.actorUserId }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toPrismaPage(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Nombres de los actores en una sola consulta (y solo dentro de la institución).
    const actorIds = [
      ...new Set(rows.map((r) => r.actorUserId).filter((id): id is string => !!id)),
    ];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: {
        id: true,
        email: true,
        memberships: {
          where: { institutionId },
          select: { person: { select: { firstNames: true, lastNames: true } } },
        },
      },
    });
    const actorById = new Map(
      actors.map((a) => {
        const person = a.memberships[0]?.person;
        return [
          a.id,
          {
            id: a.id,
            email: a.email,
            name: person ? `${person.firstNames} ${person.lastNames}` : null,
          },
        ];
      }),
    );

    return paginated(
      rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actor: row.actorUserId ? (actorById.get(row.actorUserId) ?? null) : null,
        changes: row.changes,
        metadata: row.metadata,
        ip: row.ip,
        requestId: row.requestId,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }
}

export interface AuditListQuery extends PaginationQueryDto {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
}

export interface AuditLogView {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actor: { id: string; email: string; name: string | null } | null;
  changes: unknown;
  metadata: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}
