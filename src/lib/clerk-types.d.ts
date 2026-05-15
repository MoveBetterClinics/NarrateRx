// Minimal global type augmentation for the Clerk JS SDK.
// Clerk is loaded via <script> and attaches to window; this lets @ts-check
// files reference window.Clerk without a TS2339 error.
// Full types available if/when we add @clerk/types as a dev dependency.

interface ClerkSession {
  getToken?: (options?: { skipCache?: boolean }) => Promise<string | null>
}

interface ClerkInstance {
  session?: ClerkSession | null
}

interface Window {
  Clerk?: ClerkInstance
}
