// Data service layer for API calls
// This abstracts database operations and provides a clean interface for components

// Remaining methods are typed incrementally as they are modified. See Task 17 rationale.
import type {
  Goal,
  GoalCreateInput,
  GoalUpdateInput,
  Comment,
  CommentInsertInput,
  FieldHistory,
  OOOItem,
  OOOList,
  Team,
  User,
  AuditLog,
} from "@theoakbridgeway/types"
import { fetchWithAuth } from "./fetch-with-auth"

export class DataService {
  private static async fetchAPI(endpoint: string, options?: RequestInit) {
    const response = await fetchWithAuth(endpoint, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    })

    if (!response.ok) {
      // Try to extract JSON error; fallback to text
      let msg = `HTTP ${response.status}`
      let errorDetails: any = null
      let hasEmptyResponse = false
      
      // Clone response before reading so we can try multiple formats if needed
      const responseClone = response.clone()
      
      try {
        const body = await response.json()
        
        // Check if body is empty object
        if (body && typeof body === 'object' && Object.keys(body).length === 0) {
          hasEmptyResponse = true
          msg = `${msg} (Empty error response - API returned empty object)`
          // Try to get more context from response headers
          const contentType = response.headers.get('content-type')
          const contentLength = response.headers.get('content-length')
          console.error(`[DataService] Empty error response detected for ${endpoint}:`, {
            status: response.status,
            statusCode: response.status,
            statusText: response.statusText,
            contentType,
            contentLength,
            endpoint,
            headers: Object.fromEntries(response.headers.entries()),
          })
          // Log additional context for debugging
          if (process.env.NODE_ENV === 'development') {
            console.error(`[DataService] HTTP Status: ${response.status} ${response.statusText}`)
            if (response.status === 401) {
              console.error(`[DataService] - Authentication required. Check if you're signed in.`)
            } else if (response.status === 403) {
              console.error(`[DataService] - Access forbidden. Check RLS policies in staging database.`)
            } else if (response.status === 431) {
              console.error(`[DataService] - Request headers too large (431 error)`)
              console.error(`[DataService] - This is usually caused by large cookies (Supabase session cookies can be large)`)
              console.error(`[DataService] - Solution: Clear browser cookies or sign out and sign back in`)
              if (typeof document !== 'undefined') {
                const cookies = document.cookie
                const cookieSize = new Blob([cookies]).size
                console.error(`[DataService] - Current cookie size: ${cookieSize} bytes`)
                console.error(`[DataService] - Cookie count: ${cookies.split(';').filter(c => c.trim()).length}`)
              }
            } else if (response.status >= 500) {
              console.error(`[DataService] - Server error. Check API route implementation.`)
            }
          }
        } else {
          // Extract error message from various possible fields
          msg = body?.error || body?.message || body?.details || msg
          if (body?.details && body?.details !== msg) {
            msg = `${msg}: ${body.details}`
          }
        }
        errorDetails = body
        
        // Handle authentication errors - these are expected when user is not authenticated
        if (response.status === 401) {
          // Check if this is a scope="my" request (expected to require auth)
          const isScopedRequest = endpoint.includes('scope=my')
          if (isScopedRequest) {
            // This is expected - user may not be authenticated yet
            // Log as warning instead of error to reduce noise
            // Authentication required for scope=my (expected)
          } else {
            // Unexpected 401 for other endpoints - provide helpful diagnostics
            console.error(`[DataService] API Error for ${endpoint}:`, String(msg))
            console.error(`[DataService] This endpoint requires authentication. Please ensure you are signed in.`)
            console.error(`[DataService] If you are signed in, your session may have expired. Try refreshing the page.`)
          }
          msg = `Authentication required: ${msg}. Please sign in to access this resource.`
        } else if (response.status >= 500) {
          // Server errors - log with more context
          // Always log the error message as the primary log, then details as secondary
          console.error(`[DataService] API Error for ${endpoint}: ${String(msg)}`)
          console.error(`[DataService] Error details:`, {
            status: response.status,
            statusText: response.statusText,
            requestId: errorDetails?.requestId,
            endpoint,
            hasEmptyResponse,
            body: errorDetails && Object.keys(errorDetails).length > 0 ? errorDetails : (hasEmptyResponse ? '(empty object)' : undefined),
          })
          // In development, include request ID if available
          if (process.env.NODE_ENV === "development" && errorDetails?.requestId) {
            msg = `${msg} (Request ID: ${errorDetails.requestId})`
          }
        } else if (response.status >= 400) {
          // Client errors (400-499) - log with context
          // Always log the error message as the primary log, then details as secondary
          console.error(`[DataService] API Error for ${endpoint}: ${String(msg)}`)
          console.error(`[DataService] Error details:`, {
            status: response.status,
            statusText: response.statusText,
            requestId: errorDetails?.requestId,
            endpoint,
            hasEmptyResponse,
            body: errorDetails && Object.keys(errorDetails).length > 0 ? errorDetails : (hasEmptyResponse ? '(empty object)' : undefined),
          })
        }
      } catch (parseError) {
        // If JSON parsing fails, try to get text response from clone
        try {
          const text = await responseClone.text()
          if (text && text.trim()) {
            msg = `${msg}: ${text}`
          } else {
            // If response is empty, provide more context
            hasEmptyResponse = true
            msg = `${msg} (Empty response body - no content)`
            console.error(`[DataService] Empty response body for ${endpoint}:`, {
              status: response.status,
              statusText: response.statusText,
              endpoint,
              contentType: response.headers.get('content-type'),
              headers: Object.fromEntries(response.headers.entries()),
            })
            // Log additional context for debugging
            if (process.env.NODE_ENV === 'development') {
              console.error(`[DataService] This may indicate:`)
              console.error(`[DataService] - RLS policies blocking access in staging database`)
              console.error(`[DataService] - Authentication/session issues`)
              console.error(`[DataService] - API endpoint error (check server logs)`)
              console.error(`[DataService] - Staging database structure mismatch`)
            }
          }
        } catch (textError) {
          // If we can't read the response at all, log the parse error
          // Failed to parse error response
          msg = `${msg} (Unable to parse error response)`
        }
      }
      
      // Only log as error if it's not an expected 401 for scope=my
      const isExpected401 = response.status === 401 && endpoint.includes('scope=my')
      if (!isExpected401) {
        // Always log as string to avoid logging empty objects
        console.error(`[DataService] API Error for ${endpoint}:`, String(msg))
        // Also log additional context if available
        if (errorDetails && Object.keys(errorDetails).length > 0) {
          console.error(`[DataService] Error details:`, errorDetails)
        } else if (hasEmptyResponse) {
          // Log when we have an empty error object for debugging
          console.error(`[DataService] Empty error response body received. Status: ${response.status}, StatusText: ${response.statusText}, Endpoint: ${endpoint}`)
          console.error(`[DataService] This may indicate an issue with the API endpoint. Check server logs for more details.`)
        }
      }
      const err = new Error(String(msg))
      if (errorDetails?.code) {
        ;(err as any).code = errorDetails.code
        ;(err as any).reason = errorDetails.reason
        ;(err as any).operation = errorDetails.operation
      }
      throw err
    }

    return response.json()
  }

  // Items
  static async getItems(filters?: {
    category?: string
    status?: string
    department?: string
    owner_id?: string
    scope?: "my" | "all"
  }): Promise<OOOItem[]> {
    const params = new URLSearchParams()
    if (filters?.category) params.append("category", filters.category)
    if (filters?.status) params.append("status", filters.status)
    if (filters?.department) params.append("department", filters.department)
    if (filters?.owner_id) params.append("owner_id", filters.owner_id)
    if (filters?.scope) params.append("scope", filters.scope)

    const queryString = params.toString()
    const endpoint = queryString ? `/api/items?${queryString}` : `/api/items`
    const { data } = await this.fetchAPI(endpoint)
    return data
  }

  static async getItem(id: string): Promise<OOOItem> {
    const { data } = await this.fetchAPI(`/api/items/${id}`)
    return data
  }

  static async createItem(item: Partial<OOOItem>): Promise<OOOItem> {
    const { data } = await this.fetchAPI("/api/items", {
      method: "POST",
      body: JSON.stringify(item),
    })
    return data
  }

  static async updateItem(id: string, updates: Partial<OOOItem>): Promise<OOOItem> {
    const { data } = await this.fetchAPI(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    })
    return data
  }

  static async deleteItem(id: string) {
    await this.fetchAPI(`/api/items/${id}`, { method: "DELETE" })
  }

  /**
   * Move an item to a target team (unified replacement for elevateItem / delegateItem / transferItem).
   * The /move route determines movement_type from the team hierarchy relationship.
   */
  static async moveItem(
    itemId: string,
    options: {
      targetTeamId: string
      targetListId?: string
      comment?: string
    }
  ) {
    const { data } = await this.fetchAPI(`/api/items/${itemId}/move`, {
      method: "POST",
      body: JSON.stringify(options),
    })
    return data
  }

  // Lists
  static async getLists(filters?: { department?: string; hierarchy_level?: string; owner_id?: string; teamId?: string }): Promise<OOOList[]> {
    const params = new URLSearchParams()
    if (filters?.department) params.append("department", filters.department)
    if (filters?.hierarchy_level) params.append("hierarchy_level", filters.hierarchy_level)
    if (filters?.owner_id) params.append("owner_id", filters.owner_id)
    if (filters?.teamId) params.append("teamId", filters.teamId)

    const { data } = await this.fetchAPI(`/api/lists?${params}`)
    return data
  }

  static async createList(list: any) {
    const { data } = await this.fetchAPI("/api/lists", {
      method: "POST",
      body: JSON.stringify(list),
    })
    return data
  }

  static async getList(id: string): Promise<OOOList> {
    const { data } = await this.fetchAPI(`/api/lists/${id}`)
    return data
  }

  static async updateList(id: string, updates: any) {
    const { data } = await this.fetchAPI(`/api/lists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    })
    return data
  }

  static async deleteList(id: string) {
    await this.fetchAPI(`/api/lists/${id}`, { method: "DELETE" })
  }

  // List Security Settings
  static async getListSecuritySettings(listId: string) {
    const { data } = await this.fetchAPI(`/api/lists/${listId}/security`)
    return data
  }

  static async updateListSecuritySettings(listId: string, settings: any) {
    const { data } = await this.fetchAPI(`/api/lists/${listId}/security`, {
      method: "PUT",
      body: JSON.stringify(settings),
    })
    return data
  }

  // Goals
  static async getGoals(filters?: { goal_level?: string; parent_goal_ids?: string[] }): Promise<{ goals: Goal[]; hiddenByAccessCount: number }> {
    const params = new URLSearchParams()
    if (filters?.goal_level) params.append("goal_level", filters.goal_level)
    // Support array of parent goal IDs for M2M filtering
    if (filters?.parent_goal_ids && filters.parent_goal_ids.length > 0) {
      // For backward compatibility, use first parent ID if backend doesn't support array yet
      // TODO: Update backend to accept parent_goal_ids array
      params.append("parent_goal_id", filters.parent_goal_ids[0])
    }

    const response: { data?: Goal[]; hiddenByAccessCount?: number } = await this.fetchAPI(`/api/goals?${params}`)
    return {
      goals: response.data ?? [],
      hiddenByAccessCount: response.hiddenByAccessCount ?? 0,
    }
  }

  static async getGoal(id: string) {
    const { data } = await this.fetchAPI(`/api/goals/${id}`)
    return data as Goal
  }

  static async createGoal(goal: GoalCreateInput) {
    try {
      const { data } = await this.fetchAPI("/api/goals", {
        method: "POST",
        body: JSON.stringify(goal),
      })
      return data as Goal
    } catch (error: any) {
      throw error
    }
  }

  static async updateGoal(id: string, updates: GoalUpdateInput): Promise<Goal & { strippedFields?: Array<{ field: string; reason: string }> }> {
    const { data } = await this.fetchAPI(`/api/goals/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    })
    return data as Goal & { strippedFields?: Array<{ field: string; reason: string }> }
  }

  static async deleteGoal(id: string) {
    await this.fetchAPI(`/api/goals/${id}`, { method: "DELETE" })
  }

  // Comments
  static async getComments(entityType: "item" | "goal", entityId: string): Promise<Comment[]> {
    const params = new URLSearchParams()
    if (entityType === "item") params.append("item_id", entityId)
    if (entityType === "goal") params.append("goal_id", entityId)
    const { data } = await this.fetchAPI(`/api/comments?${params}`)
    return data
  }

  static async createComment(comment: CommentInsertInput): Promise<Comment> {
    const { data } = await this.fetchAPI("/api/comments", {
      method: "POST",
      body: JSON.stringify(comment),
    })
    return data
  }

  static async updateComment(id: string, content: string) {
    const { data } = await this.fetchAPI("/api/comments", {
      method: "PATCH",
      body: JSON.stringify({ id, content }),
    })
    return data
  }

  static async deleteComment(id: string) {
    await this.fetchAPI(`/api/comments?id=${id}`, {
      method: "DELETE",
    })
  }

  // Field History
  // Note: /api/field-history returns the array directly (no { data } wrapper),
  // unlike most other API routes. This method returns the array as-is.
  // Not to be confused with ActivityProvider.getFieldHistory which filters
  // the in-memory fieldHistory array — that is an in-memory filter, not an API call.
  static async getFieldHistory(entityType: "item" | "goal", entityId: string): Promise<FieldHistory[]> {
    const params = new URLSearchParams({ entity_type: entityType, entity_id: entityId })
    return this.fetchAPI(`/api/field-history?${params}`)
  }

  // Teams
  static async getTeams(): Promise<Team[]> {
    const { data } = await this.fetchAPI("/api/teams")
    return data
  }

  // Team Hierarchy Levels
  static async getTeamHierarchyLevels() {
    const { data } = await this.fetchAPI("/api/team-hierarchy-levels")
    return data
  }

  static async createTeam(team: any) {
    const { data } = await this.fetchAPI("/api/teams", {
      method: "POST",
      body: JSON.stringify(team),
    })
    return data
  }

  static async updateTeam(id: string, updates: any) {
    // fetchAPI already logs errors, so we just re-throw here
    const { data } = await this.fetchAPI(`/api/teams/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    })
    return data
  }

  /**
   * Fetch orphan summary for a team before soft-deleting.
   * Returns counts of items, lists, and goals, or a 409 if child teams exist.
   */
  static async getTeamDeletionSummary(id: string) {
    const { data } = await this.fetchAPI(`/api/teams/${id}?mode=soft`, { method: "DELETE" })
    return data
  }

  /**
   * Soft-delete a team after resolving orphans.
   * orphanAction: 'reparent' | 'delete'
   * reparentTeamId: required when orphanAction === 'reparent'
   */
  static async softDeleteTeam(id: string, orphanAction: "reparent" | "delete", reparentTeamId?: string) {
    const { data } = await this.fetchAPI(`/api/teams/${id}?mode=soft`, {
      method: "DELETE",
      body: JSON.stringify({ mode: "soft", orphanAction, reparentTeamId }),
    })
    return data
  }

  /**
   * Permanently hard-delete a team that has already been soft-deleted.
   */
  static async hardDeleteTeam(id: string) {
    const { data } = await this.fetchAPI(`/api/teams/${id}?mode=hard`, {
      method: "DELETE",
      body: JSON.stringify({ mode: "hard" }),
    })
    return data
  }

  // User Roles
  static async getUserRoles() {
    const { data } = await this.fetchAPI("/api/user-roles")
    return data
  }

  static async createUserRole(userRole: any) {
    const { data } = await this.fetchAPI("/api/user-roles", {
      method: "POST",
      body: JSON.stringify(userRole),
    })
    return data
  }

  // Categories
  static async getCategories() {
    const { data } = await this.fetchAPI("/api/categories")
    return data
  }

  static async createCategory(category: any) {
    const { data } = await this.fetchAPI("/api/categories", {
      method: "POST",
      body: JSON.stringify(category),
    })
    return data
  }

  static async updateCategory(id: string, updates: any) {
    const { data } = await this.fetchAPI("/api/categories", {
      method: "PATCH",
      body: JSON.stringify({ id, ...updates }),
    })
    return data
  }

  static async deleteCategory(id: string) {
    await this.fetchAPI(`/api/categories?id=${id}`, { method: "DELETE" })
  }

  // Strategic Pillars
  static async getPillars() {
    const { data } = await this.fetchAPI("/api/pillars")
    return data
  }

  static async createPillar(pillar: any) {
    const { data } = await this.fetchAPI("/api/pillars", {
      method: "POST",
      body: JSON.stringify(pillar),
    })
    return data
  }

  static async updatePillar(id: string, updates: any) {
    const { data } = await this.fetchAPI("/api/pillars", {
      method: "PATCH",
      body: JSON.stringify({ id, ...updates }),
    })
    return data
  }

  static async deletePillar(id: string) {
    await this.fetchAPI(`/api/pillars?id=${id}`, { method: "DELETE" })
  }

  // Audit Logs
  static async getAuditLogs(filters?: { limit?: number; user_id?: string; resource_type?: string }) {
    const params = new URLSearchParams()
    if (filters?.limit) params.append("limit", filters.limit.toString())
    if (filters?.user_id) params.append("user_id", filters.user_id)
    if (filters?.resource_type) params.append("resource_type", filters.resource_type)

    const { data } = await this.fetchAPI(`/api/audit-logs?${params}`)
    return data
  }

  static async createAuditLog(log: any) {
    const { data } = await this.fetchAPI("/api/audit-logs", {
      method: "POST",
      body: JSON.stringify(log),
    })
    return data
  }

  // Profiles (for employee stats)
  static async getProfiles(): Promise<User[]> {
    const { data } = await this.fetchAPI("/api/profiles")
    return data
  }

  // Dashboard - Organization-wide stats (bypasses RLS)
  static async getDashboardStats() {
    const { data } = await this.fetchAPI("/api/dashboard/stats")
    return data
  }

  static async getDashboardLeaderboard() {
    const { data } = await this.fetchAPI("/api/dashboard/leaderboard")
    return data
  }

  static async getDashboardLeaders() {
    const { data } = await this.fetchAPI("/api/dashboard/leaders")
    return data
  }
}
