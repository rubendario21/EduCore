import { apiClient, downloadFile } from '@/lib/api-client';

export interface ImportReport {
  fileName: string;
  format: 'CSV' | 'XLSX';
  sha256: string;
  totals: {
    rows: number;
    valid: number;
    invalid: number;
    newPersons: number;
    reusedPersons: number;
    guardians: number;
    enrollments: number;
  };
  ignoredColumns: string[];
  rows: Array<{
    row: number;
    status: 'VALID' | 'INVALID';
    student: string;
    errors: Array<{ column: string; message: string }>;
    actions: string[];
  }>;
}

const form = (file: File) => {
  const body = new FormData();
  body.append('file', file);
  return body;
};

export const importsService = {
  template: () => downloadFile('/imports/students/template', 'plantilla-estudiantes.csv'),
  validate: (file: File) => apiClient.post<ImportReport>('/imports/students/validate', form(file)),
  import: (file: File) =>
    apiClient.post<{ imported: true; report: ImportReport }>('/imports/students', form(file)),
};
