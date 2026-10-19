import { PERMISSION_SCOPES, type PermissionScope } from '@educore/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RolePermissionInputDto {
  @ApiProperty({ example: 'users.accounts.read' })
  @Matches(/^[a-z]+\.[a-z_]+\.[a-z_]+$/, { message: 'Código de permiso no válido.' })
  code: string;

  @ApiPropertyOptional({ enum: PERMISSION_SCOPES, default: 'ALL' })
  @IsOptional()
  @IsIn(PERMISSION_SCOPES, { message: 'Alcance no válido.' })
  scope: PermissionScope = 'ALL';
}

export class CreateRoleDto {
  @ApiProperty({ example: 'ORIENTADOR', description: 'Mayúsculas, números y guion bajo' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, {
    message: 'El código debe empezar por una letra y usar solo mayúsculas, números y guion bajo.',
  })
  code: string;

  @ApiProperty({ example: 'Orientador escolar' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres.' })
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({ type: [RolePermissionInputDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RolePermissionInputDto)
  permissions: RolePermissionInputDto[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres.' })
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ type: [RolePermissionInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RolePermissionInputDto)
  permissions?: RolePermissionInputDto[];
}

// --- Respuestas -------------------------------------------------------------

export class PermissionDto {
  @ApiProperty() code: string;
  @ApiProperty() module: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: PERMISSION_SCOPES, isArray: true }) allowedScopes: PermissionScope[];
}

export class RolePermissionDto {
  @ApiProperty() code: string;
  @ApiProperty({ enum: PERMISSION_SCOPES }) scope: PermissionScope;
}

export class RoleDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty({ description: 'Los roles de sistema no se pueden editar' }) isSystem: boolean;
  @ApiProperty({ description: 'Usuarios con este rol' }) memberCount: number;
  @ApiProperty({ type: [RolePermissionDto] }) permissions: RolePermissionDto[];
}
