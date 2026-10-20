import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useAuth } from './auth-context';
import { ProfileContext } from './profile-context';
import {
  type Profile,
  profilesOf,
  readPreferredProfile,
  resolveProfile,
  savePreferredProfile,
} from './profiles';

/** Perfil activo de la sesión: el preferido si la cuenta lo tiene, si no el primero. */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [preferred, setPreferred] = useState<Profile | null>(readPreferredProfile);
  const profiles = useMemo(() => (user ? profilesOf(user) : []), [user]);
  const profile = resolveProfile(profiles, preferred);

  const setProfile = useCallback((next: Profile) => {
    savePreferredProfile(next);
    setPreferred(next);
  }, []);

  const value = useMemo(() => ({ profiles, profile, setProfile }), [profiles, profile, setProfile]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
