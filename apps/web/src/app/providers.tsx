import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/features/auth/auth-context';
import { ProfileProvider } from '@/features/auth/profile-provider';
import { BrandingStyles } from '@/features/branding/branding-styles';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { createQueryClient } from './query-client';

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme} position="top-right" richColors closeButton />;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ProfileProvider>
            <BrandingStyles />
            {children}
            <ThemedToaster />
          </ProfileProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
