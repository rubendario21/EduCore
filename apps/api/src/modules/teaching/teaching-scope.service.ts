import { type PermissionCode } from '@educore/shared';
import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { scopesOf } from '../access-control/authorization';
import { type AuthContext } from '../auth/auth.types';
import { TeachingRepository } from './teaching.repository';

/**
 * Alcance ASSIGNED de los docentes. Con un permiso de alcance ALL no hay
 * restricción (`null`); con ASSIGNED, el usuario solo alcanza los grupos donde
 * tiene una asignación vigente en un año no cerrado.
 *
 * Los registros fuera del alcance se tratan como inexistentes (404), igual
 * que los de otra institución: así un id manipulado no revela nada.
 */
@Injectable()
export class TeachingScope {
  constructor(private readonly repository: TeachingRepository) {}

  /** `null` = toda la institución; si no, el miembro del personal del usuario (o ninguno). */
  async staffFilter(auth: AuthContext, code: PermissionCode): Promise<string | null | 'NONE'> {
    if (scopesOf(auth, code).has('ALL')) return null;
    const staff = await this.repository.staffOfMembership(auth.membershipId);
    return staff && staff.status === 'ACTIVE' ? staff.id : 'NONE';
  }

  /** `null` = toda la institución; si no, los grupos asignados (posiblemente ninguno). */
  async groupIds(auth: AuthContext, code: PermissionCode): Promise<string[] | null> {
    const staffId = await this.staffFilter(auth, code);
    if (staffId === null) return null;
    if (staffId === 'NONE') return [];
    return this.repository.assignedGroupIds(staffId);
  }

  /** Condición sobre estudiantes: ubicados hoy, con matrícula vigente, en los grupos asignados. */
  async studentWhere(
    auth: AuthContext,
    code: PermissionCode,
  ): Promise<Prisma.StudentWhereInput | undefined> {
    const groups = await this.groupIds(auth, code);
    if (groups === null) return undefined;
    return { enrollments: { some: this.currentIn(groups) } };
  }

  /** Condición sobre matrículas: vigentes y ubicadas hoy en los grupos asignados. */
  async enrollmentWhere(
    auth: AuthContext,
    code: PermissionCode,
  ): Promise<Prisma.EnrollmentWhereInput | undefined> {
    const groups = await this.groupIds(auth, code);
    if (groups === null) return undefined;
    return this.currentIn(groups);
  }

  private currentIn(groups: string[]): Prisma.EnrollmentWhereInput {
    return {
      status: { in: ['PRE_ENROLLED', 'ACTIVE'] },
      placements: { some: { toDate: null, schoolGroupId: { in: groups } } },
    };
  }
}
