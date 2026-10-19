import { PERMISSIONS } from '@educore/shared';
import { Lock, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/feedback';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { useAuth } from '@/features/auth/auth-context';
import { useRoles } from '../roles.service';

export function RolesPage() {
  const { can } = useAuth();
  const { data, isPending, error, refetch } = useRoles();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Roles y permisos"
        description="Los roles de sistema los define EduCore. Puedes crear roles personalizados con los permisos que tú tienes."
        actions={
          can(PERMISSIONS.ROLES_MANAGE) && (
            <Button asChild>
              <Link to="/roles/nuevo">
                <Plus aria-hidden /> Nuevo rol
              </Link>
            </Button>
          )
        }
      />
      <Card>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Rol</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Permisos</Th>
                <Th className="text-right">Usuarios</Th>
              </tr>
            </THead>
            <TBody>
              {data.map((role) => (
                <tr key={role.id} className="hover:bg-surface-muted/50">
                  <Td>
                    <Link
                      to={`/roles/${role.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {role.name}
                    </Link>
                    {role.description && (
                      <span className="block max-w-xl text-xs text-muted-foreground">
                        {role.description}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {role.isSystem ? (
                      <Badge>
                        <Lock className="size-3" aria-hidden /> Sistema
                      </Badge>
                    ) : (
                      <Badge tone="primary">Personalizado</Badge>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{role.permissions.length}</Td>
                  <Td className="text-right tabular-nums">{role.memberCount}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
