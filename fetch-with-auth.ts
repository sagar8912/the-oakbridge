/**
 * Wrapper around fetch that ensures authentication cookies are sent.
 *
 * For Supabase-authenticated APIs we must forward cookies on every request so
 * the server can resolve the current user (or impersonation context). The
 * built-in fetch defaults to `same-origin`, which can drop cookies in certain
 * dev setups (e.g. file:// origins, custom hosts) and leads to spurious 401s.
 *
 * This helper provides a single place to enforce the correct defaults. Callers
 * can still override the RequestInit options if they need to customise the
 * request.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

async function getBrowserClient(): Promise<SupabaseClient | null> {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const { createClient } = await import("@/lib/supabase/client")
    return createClient()
  } catch {
    return null
  }
}

async function resolveAccessToken(): Promise<string | null> {
  try {
    const client = await getBrowserClient()
    if (!client) {
      return null
    }

    // Try getSession first (faster, uses cached session)
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession()

    if (sessionError) {
      // Try getUser as fallback (forces refresh)
      try {
        const {
          data: { user },
          error: userError,
        } = await client.auth.getUser()
        
        if (userError || !user) {
          return null
        }
        
        // If getUser succeeded, try getSession again to get the refreshed token
        const {
          data: { session: refreshedSession },
        } = await client.auth.getSession()
        
        return refreshedSession?.access_token ?? null
      } catch {
        return null
      }
    }

    // Check if session is expired (within 60 seconds of expiry)
    if (session?.expires_at) {
      const expiresAt = session.expires_at * 1000 // Convert to milliseconds
      const now = Date.now()
      const timeUntilExpiry = expiresAt - now
      
      // If token expires within 60 seconds, try to refresh
      if (timeUntilExpiry < 60000) {
        try {
          const {
            data: { user },
            error: refreshError,
          } = await client.auth.getUser()
          
          if (!refreshError && user) {
            // Get the refreshed session
            const {
              data: { session: refreshedSession },
            } = await client.auth.getSession()
            
            if (refreshedSession?.access_token) {
              return refreshedSession.access_token
            }
          }
        } catch {
          // Fall through to return existing token
        }
      }
    }

    return session?.access_token ?? null
  } catch {
    return null
  }
}

export async function fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}) {
  const { headers: initHeaders, credentials: initCredentials, ...rest } = init

  const headers = initHeaders instanceof Headers ? initHeaders : new Headers(initHeaders || {})

  if (!headers.has("Authorization")) {
    const accessToken = await resolveAccessToken()
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`)
    }
  }

  const requestInit: RequestInit = {
    credentials: initCredentials ?? "include",
    headers,
    ...rest,
  }

  // Make the initial request
  const response = await fetch(input, requestInit)

  // If we get a 401 and didn't have an auth token, try one more time after a short delay
  // This handles race conditions where auth is initializing
  if (response.status === 401 && !headers.has("Authorization")) {
    // Wait 500ms for auth to potentially initialize
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Try to get the access token again
    const retryToken = await resolveAccessToken()
    if (retryToken) {
      headers.set("Authorization", `Bearer ${retryToken}`)
      
      const retryInit: RequestInit = {
        credentials: initCredentials ?? "include",
        headers,
        ...rest,
      }
      
      return fetch(input, retryInit)
    }
  }

  return response
}


