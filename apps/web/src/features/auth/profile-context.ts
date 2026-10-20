import { createContext, useContext } from 'react';
import { type Profile } from './profiles';

export interface ProfileContextValue {
  /** Perfiles que tiene la cuenta. */
  profiles: Profile[];
  /** Perfil activo (null sin sesión). */
  profile: Profile | null;
  setProfile: (profile: Profile) => void;
}

export const ProfileContext = createContext<ProfileContextValue | null>(null);

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useProfile debe usarse dentro de ProfileProvider');
  return context;
}
