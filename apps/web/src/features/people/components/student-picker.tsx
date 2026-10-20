import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fullName } from '@/lib/format';
import { peopleService } from '../people.service';

export interface PickedStudent {
  id: string;
  name: string;
}

/** Busca y selecciona un estudiante por nombre, documento o código. */
export function StudentPicker({
  value,
  onChange,
  invalid,
}: {
  value: PickedStudent | null;
  onChange: (student: PickedStudent | null) => void;
  invalid?: boolean;
}) {
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const { data, isFetching } = useQuery({
    queryKey: ['students', 'picker', term],
    queryFn: ({ signal }) => peopleService.students({ search: term, pageSize: 8, page: 1 }, signal),
    enabled: !value && term.length >= 2,
  });

  if (value) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border bg-surface-muted/40 px-3 text-sm">
        <span className="truncate font-medium">{value.name}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(null)}
          aria-label="Cambiar estudiante"
        >
          <X aria-hidden />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          aria-label="Buscar estudiante"
          aria-invalid={invalid || undefined}
          placeholder="Escribe al menos 2 letras del nombre, documento o código"
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {term.length >= 2 && (
        <ul className="max-h-48 overflow-y-auto rounded-md border text-sm" aria-label="Resultados">
          {isFetching && !data ? (
            <li className="px-3 py-2 text-muted-foreground">Buscando…</li>
          ) : data && data.data.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">Sin resultados.</li>
          ) : (
            data?.data.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-surface-muted"
                  onClick={() => onChange({ id: s.id, name: fullName(s.person) })}
                >
                  <span>{fullName(s.person)}</span>
                  <span className="text-muted-foreground">
                    {s.person.documentType} {s.person.documentNumber}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
