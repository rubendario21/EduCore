import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Users } from 'lucide-react';
import { PERMISSIONS } from '@educore/shared';
import { Link, useParams } from 'react-router';
import { PageHeader } from '@/components/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/features/auth/auth-context';
import { GradebookView } from '@/features/gradebook/components/gradebook-view';
import { formatDate, fullName } from '@/lib/format';
import { teachingService } from '../teaching.service';

/**
 * Cursos vigentes. Un docente (alcance ASSIGNED) ve solo los suyos; quien
 * tiene alcance institucional ve todos.
 */
export function MyClassesPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['teaching-assignments', 'mine'],
    queryFn: ({ signal }) => teachingService.assignments({}, signal),
  });
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Mis cursos"
        description="Asignaturas y grupos que tienes a cargo en el año en curso."
      />
      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          title="No tienes cursos asignados"
          description="La coordinación o la rectoría hacen la asignación académica."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((a) => (
            <Link
              key={a.id}
              to={`/mis-cursos/${a.id}`}
              className="rounded-lg focus-visible:outline-2"
            >
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle>{a.subject.name}</CardTitle>
                  <CardDescription>
                    {a.group.name} · {a.group.gradeName} · {a.academicYear.year}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="size-4" aria-hidden /> {fullName(a.teacher)}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function RosterPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['teaching-assignments', 'roster', id],
    queryFn: ({ signal }) => teachingService.roster(id, signal),
  });
  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const { assignment, students } = data;

  const roster = (
    <Card>
      {students.length === 0 ? (
        <EmptyState title="El grupo aún no tiene estudiantes ubicados" />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th className="w-12">#</Th>
              <Th>Estudiante</Th>
              <Th>Documento</Th>
              <Th>En el grupo desde</Th>
            </tr>
          </THead>
          <TBody>
            {students.map((s, i) => (
              <tr key={s.studentId}>
                <Td className="text-muted-foreground">{i + 1}</Td>
                <Td className="font-medium">
                  {s.lastNames}, {s.firstNames}
                </Td>
                <Td className="whitespace-nowrap">
                  {s.documentType} {s.documentNumber}
                </Td>
                <Td>{formatDate(s.inGroupSince)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <Link
        to="/mis-cursos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Mis cursos
      </Link>
      <PageHeader
        title={`${assignment.subject.name} · ${assignment.group.name}`}
        description={`${assignment.group.gradeName} · ${fullName(assignment.teacher)} · ${students.length} estudiante(s)`}
      />
      {can(PERMISSIONS.GRADES_READ) ? (
        <Tabs defaultValue="grades">
          <TabsList>
            <TabsTrigger value="grades">Notas</TabsTrigger>
            <TabsTrigger value="roster">Lista de clase</TabsTrigger>
          </TabsList>
          <TabsContent value="grades">
            <GradebookView
              schoolGroupId={assignment.group.id}
              subjectId={assignment.subject.id}
              academicYearId={assignment.academicYear.id}
            />
          </TabsContent>
          <TabsContent value="roster">{roster}</TabsContent>
        </Tabs>
      ) : (
        roster
      )}
    </div>
  );
}
