import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ValidationException } from '../../common/errors/app.exception';
import { isValidNit } from '../../common/validation/colombia';
import {
  type Campus,
  type InstitutionSettings,
  type Prisma,
  type Shift,
} from '../../generated/prisma/client';
import { AuditService, diffChanges } from '../audit/audit.service';
import { FileErrors, FilesService, type IncomingFile, UPLOAD_RULES } from '../files/files.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import {
  type BrandingViewDto,
  type CampusViewDto,
  type CreateCampusDto,
  type CreateShiftDto,
  type InstitutionViewDto,
  type SettingsViewDto,
  type ShiftViewDto,
  type UpdateCampusDto,
  type UpdateInstitutionDto,
  type UpdateSettingsDto,
  type UpdateShiftDto,
} from './dto/institution.dto';
import { InstitutionsRepository } from './institutions.repository';

const SUPPORTED_TIMEZONES = new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]);
const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

const Errors = {
  notConfigured: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      'INSTITUTION_NOT_CONFIGURED',
      'La institución aún no está configurada.',
    ),
  campusNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'CAMPUS_NOT_FOUND', 'La sede no existe.'),
  shiftNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'SHIFT_NOT_FOUND', 'La jornada no existe.'),
  codeTaken: (what: string) =>
    new AppException(HttpStatus.CONFLICT, 'CODE_TAKEN', `Ya existe ${what} con ese código.`),
  lastActive: (what: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'LAST_ACTIVE_RECORD',
      `La institución debe conservar al menos ${what} activa.`,
    ),
  mainCampusInactive: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'MAIN_CAMPUS_INACTIVE',
      'La sede principal no se puede desactivar. Marca otra sede como principal primero.',
    ),
  inUse: (what: string, count: number) =>
    new AppException(
      HttpStatus.CONFLICT,
      'IN_USE',
      `No se puede desactivar ${what}: tiene ${count} grupo(s) activo(s) en años no cerrados.`,
      { groupCount: count },
    ),
};

interface StoredBranding {
  primaryColor?: string | null;
  accentColor?: string | null;
}
interface StoredPreferences {
  guardianAbsenceExcusesEnabled?: boolean;
}

/** URL del logo; `v` cambia con cada logo nuevo e invalida las cachés. */
function logoUrlOf(settings: InstitutionSettings | null): string | null {
  return settings?.logoFileId ? `/api/v1/institution/branding/logo?v=${settings.logoFileId}` : null;
}

function toSettingsView(settings: InstitutionSettings | null): SettingsViewDto {
  const branding = (settings?.branding ?? {}) as StoredBranding;
  const preferences = (settings?.preferences ?? {}) as StoredPreferences;
  return {
    timezone: settings?.timezone ?? 'America/Bogota',
    locale: settings?.locale ?? 'es-CO',
    currency: settings?.currency ?? 'COP',
    branding: {
      primaryColor: branding.primaryColor ?? null,
      accentColor: branding.accentColor ?? null,
    },
    preferences: {
      guardianAbsenceExcusesEnabled: preferences.guardianAbsenceExcusesEnabled ?? false,
    },
    logoUrl: logoUrlOf(settings),
  };
}

const toCampusView = (c: Campus): CampusViewDto => ({
  id: c.id,
  code: c.code,
  name: c.name,
  isMain: c.isMain,
  daneCode: c.daneCode,
  address: c.address,
  city: c.city,
  phone: c.phone,
  status: c.status,
});

const toShiftView = (s: Shift): ShiftViewDto => ({
  id: s.id,
  code: s.code,
  name: s.name,
  status: s.status,
});

const CAMPUS_FIELDS = [
  'code',
  'name',
  'isMain',
  'daneCode',
  'address',
  'city',
  'phone',
  'status',
] as const;

@Injectable()
export class InstitutionsService {
  constructor(
    private readonly repository: InstitutionsRepository,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  private record(
    auth: AuthContext,
    client: ClientInfo,
    action: string,
    entityType: string,
    entityId: string,
    changes: Record<string, { from: unknown; to: unknown }>,
    tx: Prisma.TransactionClient,
  ) {
    if (Object.keys(changes).length === 0) return Promise.resolve();
    return this.audit.record(
      {
        institutionId: auth.institutionId,
        actorUserId: auth.userId,
        action,
        entityType,
        entityId,
        changes,
        context: client,
      },
      tx,
    );
  }

  // --- Institución ----------------------------------------------------------

  async get(auth: AuthContext): Promise<InstitutionViewDto> {
    const institution = await this.repository.findInstitution(auth.institutionId);
    if (!institution) throw Errors.notConfigured();
    const { settings, createdAt: _c, updatedAt: _u, status: _s, ...data } = institution;
    return { ...data, settings: toSettingsView(settings) };
  }

  async branding(): Promise<BrandingViewDto> {
    const institution = await this.repository.findPublicInstitution();
    if (!institution) throw Errors.notConfigured();
    const settings = toSettingsView(institution.settings);
    return {
      name: institution.tradeName ?? institution.legalName,
      legalName: institution.legalName,
      primaryColor: settings.branding.primaryColor,
      accentColor: settings.branding.accentColor,
      logoUrl: logoUrlOf(institution.settings),
    };
  }

  // --- Logo -----------------------------------------------------------------

  async uploadLogo(
    auth: AuthContext,
    file: IncomingFile | undefined,
    client: ClientInfo,
  ): Promise<InstitutionViewDto> {
    await this.repository.transaction(async (tx) => {
      const institution = await this.repository.findInstitution(auth.institutionId, tx);
      if (!institution) throw Errors.notConfigured();
      const stored = await this.files.store(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          file,
          rule: UPLOAD_RULES.institutionLogo,
        },
        tx,
      );
      await this.repository.setLogo(auth.institutionId, stored.id, tx);
      await this.record(
        auth,
        client,
        'institution.logo.updated',
        'institution',
        auth.institutionId,
        {
          logoFileId: { from: institution.settings?.logoFileId ?? null, to: stored.id },
        },
        tx,
      );
    });
    return this.get(auth);
  }

  async removeLogo(auth: AuthContext, client: ClientInfo): Promise<InstitutionViewDto> {
    await this.repository.transaction(async (tx) => {
      const institution = await this.repository.findInstitution(auth.institutionId, tx);
      if (!institution) throw Errors.notConfigured();
      const previous = institution.settings?.logoFileId ?? null;
      if (!previous) return;
      // El archivo se conserva (trazabilidad); solo deja de ser el logo.
      await this.repository.setLogo(auth.institutionId, null, tx);
      await this.record(
        auth,
        client,
        'institution.logo.removed',
        'institution',
        auth.institutionId,
        {
          logoFileId: { from: previous, to: null },
        },
        tx,
      );
    });
    return this.get(auth);
  }

  /** Logo público (pantalla de inicio de sesión). */
  async publicLogo() {
    const institution = await this.repository.findPublicInstitution();
    const logoFileId = institution?.settings?.logoFileId;
    if (!institution || !logoFileId) throw FileErrors.notFound();
    const file = await this.repository.findStoredFile(institution.id, logoFileId);
    if (!file || file.classification !== 'INSTITUTIONAL') throw FileErrors.notFound();
    return { file, stream: await this.files.open(file) };
  }

  async update(
    auth: AuthContext,
    dto: UpdateInstitutionDto,
    client: ClientInfo,
  ): Promise<InstitutionViewDto> {
    await this.repository.transaction(async (tx) => {
      const before = await this.repository.findInstitution(auth.institutionId, tx);
      if (!before) throw Errors.notConfigured();

      const taxId = dto.taxId === undefined ? before.taxId : dto.taxId;
      const taxIdDv = dto.taxIdDv === undefined ? before.taxIdDv : dto.taxIdDv;
      if (taxId && !taxIdDv) {
        throw new ValidationException([
          { field: 'taxIdDv', messages: ['Indica el dígito de verificación del NIT.'] },
        ]);
      }
      if (taxId && taxIdDv && !isValidNit(taxId, taxIdDv)) {
        throw new ValidationException([
          { field: 'taxIdDv', messages: ['El dígito de verificación no corresponde al NIT.'] },
        ]);
      }

      const after = await this.repository.updateInstitution(auth.institutionId, dto, tx);
      await this.record(
        auth,
        client,
        'institution.profile.updated',
        'institution',
        auth.institutionId,
        diffChanges(before, after, [
          'legalName',
          'tradeName',
          'taxId',
          'taxIdDv',
          'daneCode',
          'email',
          'phone',
          'website',
          'address',
          'city',
          'department',
        ]),
        tx,
      );
    });
    return this.get(auth);
  }

  async updateSettings(
    auth: AuthContext,
    dto: UpdateSettingsDto,
    client: ClientInfo,
  ): Promise<InstitutionViewDto> {
    const problems = [
      ...(dto.timezone && !SUPPORTED_TIMEZONES.has(dto.timezone)
        ? [
            {
              field: 'timezone',
              messages: ['Zona horaria no válida (formato IANA, p. ej. America/Bogota).'],
            },
          ]
        : []),
      ...(dto.currency && !SUPPORTED_CURRENCIES.has(dto.currency)
        ? [{ field: 'currency', messages: ['Moneda no reconocida (ISO 4217).'] }]
        : []),
    ];
    if (problems.length > 0) throw new ValidationException(problems);

    await this.repository.transaction(async (tx) => {
      const institution = await this.repository.findInstitution(auth.institutionId, tx);
      if (!institution) throw Errors.notConfigured();
      const before = toSettingsView(institution.settings);

      const branding = { ...before.branding, ...dto.branding };
      const preferences = { ...before.preferences, ...dto.preferences };
      await this.repository.upsertSettings(
        auth.institutionId,
        {
          timezone: dto.timezone ?? before.timezone,
          locale: dto.locale ?? before.locale,
          currency: dto.currency ?? before.currency,
          branding,
          preferences,
        },
        tx,
      );
      const after: SettingsViewDto = {
        timezone: dto.timezone ?? before.timezone,
        locale: dto.locale ?? before.locale,
        currency: dto.currency ?? before.currency,
        branding,
        preferences,
        logoUrl: before.logoUrl,
      };
      await this.record(
        auth,
        client,
        'institution.settings.updated',
        'institution',
        auth.institutionId,
        diffChanges(before, after, ['timezone', 'locale', 'currency', 'branding', 'preferences']),
        tx,
      );
    });
    return this.get(auth);
  }

  // --- Sedes ----------------------------------------------------------------

  async listCampuses(auth: AuthContext): Promise<CampusViewDto[]> {
    return (await this.repository.listCampuses(auth.institutionId)).map(toCampusView);
  }

  async createCampus(
    auth: AuthContext,
    dto: CreateCampusDto,
    client: ClientInfo,
  ): Promise<CampusViewDto> {
    const created = await this.repository.transaction(async (tx) => {
      if (await this.repository.findCampusByCode(auth.institutionId, dto.code, tx))
        throw Errors.codeTaken('una sede');
      if (dto.isMain) await this.repository.clearMainCampus(auth.institutionId, tx);
      const campus = await this.repository.createCampus(
        { ...dto, institutionId: auth.institutionId },
        tx,
      );
      await this.record(
        auth,
        client,
        'institution.campus.created',
        'campus',
        campus.id,
        diffChanges(null, campus, CAMPUS_FIELDS),
        tx,
      );
      return campus;
    });
    return toCampusView(created);
  }

  async updateCampus(
    auth: AuthContext,
    id: string,
    dto: UpdateCampusDto,
    client: ClientInfo,
  ): Promise<CampusViewDto> {
    const updated = await this.repository.transaction(async (tx) => {
      const before = await this.repository.findCampus(auth.institutionId, id, tx);
      if (!before) throw Errors.campusNotFound();

      if (
        dto.code &&
        dto.code !== before.code &&
        (await this.repository.findCampusByCode(auth.institutionId, dto.code, tx))
      ) {
        throw Errors.codeTaken('una sede');
      }
      const deactivating = dto.status === 'INACTIVE' && before.status === 'ACTIVE';
      if (deactivating) {
        if (before.isMain && dto.isMain !== false) throw Errors.mainCampusInactive();
        if ((await this.repository.countActiveCampuses(auth.institutionId, tx)) <= 1)
          throw Errors.lastActive('una sede');
        const groups = await this.repository.countOpenGroupsUsing({ campusId: id }, tx);
        if (groups > 0) throw Errors.inUse('la sede', groups);
      }
      if (dto.isMain === false && before.isMain) {
        // Siempre debe haber una sede principal: se cambia marcando otra como principal.
        throw new ValidationException([
          {
            field: 'isMain',
            messages: ['Para cambiar la sede principal, marca otra sede como principal.'],
          },
        ]);
      }
      if (dto.isMain && !before.isMain) {
        if ((dto.status ?? before.status) !== 'ACTIVE') throw Errors.mainCampusInactive();
        await this.repository.clearMainCampus(auth.institutionId, tx);
      }

      const after = await this.repository.updateCampus(id, dto, tx);
      await this.record(
        auth,
        client,
        'institution.campus.updated',
        'campus',
        id,
        diffChanges(before, after, CAMPUS_FIELDS),
        tx,
      );
      return after;
    });
    return toCampusView(updated);
  }

  // --- Jornadas -------------------------------------------------------------

  async listShifts(auth: AuthContext): Promise<ShiftViewDto[]> {
    return (await this.repository.listShifts(auth.institutionId)).map(toShiftView);
  }

  async createShift(
    auth: AuthContext,
    dto: CreateShiftDto,
    client: ClientInfo,
  ): Promise<ShiftViewDto> {
    const created = await this.repository.transaction(async (tx) => {
      if (await this.repository.findShiftByCode(auth.institutionId, dto.code, tx))
        throw Errors.codeTaken('una jornada');
      const shift = await this.repository.createShift(
        { ...dto, institutionId: auth.institutionId },
        tx,
      );
      await this.record(
        auth,
        client,
        'institution.shift.created',
        'shift',
        shift.id,
        diffChanges(null, shift, ['code', 'name', 'status']),
        tx,
      );
      return shift;
    });
    return toShiftView(created);
  }

  async updateShift(
    auth: AuthContext,
    id: string,
    dto: UpdateShiftDto,
    client: ClientInfo,
  ): Promise<ShiftViewDto> {
    const updated = await this.repository.transaction(async (tx) => {
      const before = await this.repository.findShift(auth.institutionId, id, tx);
      if (!before) throw Errors.shiftNotFound();
      if (
        dto.code &&
        dto.code !== before.code &&
        (await this.repository.findShiftByCode(auth.institutionId, dto.code, tx))
      ) {
        throw Errors.codeTaken('una jornada');
      }
      if (dto.status === 'INACTIVE' && before.status === 'ACTIVE') {
        if ((await this.repository.countActiveShifts(auth.institutionId, tx)) <= 1)
          throw Errors.lastActive('una jornada');
        const groups = await this.repository.countOpenGroupsUsing({ shiftId: id }, tx);
        if (groups > 0) throw Errors.inUse('la jornada', groups);
      }
      const after = await this.repository.updateShift(id, dto, tx);
      await this.record(
        auth,
        client,
        'institution.shift.updated',
        'shift',
        id,
        diffChanges(before, after, ['code', 'name', 'status']),
        tx,
      );
      return after;
    });
    return toShiftView(updated);
  }
}
