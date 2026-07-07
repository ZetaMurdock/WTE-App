export interface UserProfile {
  id: string;
  displayName?: string;
  email?: string;
  /** Firebase uid when signed in. */
  uid?: string | null;
}
