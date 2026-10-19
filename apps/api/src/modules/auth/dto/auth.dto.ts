import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';

/**
 * Límite de longitud de las contraseñas recibidas. Es mayor que el máximo de la
 * política (128) para no revelarla en el login, pero acota el costo de Argon2
 * ante entradas enormes.
 */
const MAX_PASSWORD_INPUT = 256;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @ApiProperty({ example: 'rectoria@colegio.edu.co' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1, { message: 'Ingresa tu contraseña.' })
  @MaxLength(MAX_PASSWORD_INPUT)
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'rectoria@colegio.edu.co' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido.' })
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recibido en el enlace del correo' })
  @IsString()
  @Length(20, 200, { message: 'El enlace no es válido.' })
  token: string;

  @ApiProperty({ format: 'password', minLength: 10, maxLength: 128 })
  @IsString()
  @MaxLength(MAX_PASSWORD_INPUT)
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1, { message: 'Ingresa tu contraseña actual.' })
  @MaxLength(MAX_PASSWORD_INPUT)
  currentPassword: string;

  @ApiProperty({ format: 'password', minLength: 10, maxLength: 128 })
  @IsString()
  @MaxLength(MAX_PASSWORD_INPUT)
  newPassword: string;
}

// --- Respuestas ---------------------------------------------------------

export class AuthInstitutionDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class AuthRoleDto {
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

export class AuthPermissionDto {
  @ApiProperty({ example: 'users.accounts.read' }) code: string;
  @ApiProperty({ enum: ['ALL', 'ASSIGNED', 'OWN', 'LINKED'], isArray: true }) scopes: string[];
}

export class AuthUserDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() firstNames: string;
  @ApiProperty() lastNames: string;
  @ApiProperty({ type: AuthInstitutionDto }) institution: AuthInstitutionDto;
  @ApiProperty({ type: [AuthRoleDto] }) roles: AuthRoleDto[];
  @ApiProperty({ type: [AuthPermissionDto] }) permissions: AuthPermissionDto[];
}

export class AuthSessionResponseDto {
  @ApiProperty({ description: 'Token de acceso (JWT). Guardarlo solo en memoria.' })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ description: 'Segundos hasta que el token de acceso expire', example: 900 })
  expiresIn: number;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}
