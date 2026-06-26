"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { UserPlus, Edit2, Trash2, Users } from "lucide-react"
import { useCurrentUser } from "@/lib/current-user-context"
import { useTeams } from "@/lib/teams-context"
import { useToast } from "@/hooks/use-toast"
import { fetchWithAuth } from "@/lib/fetch-with-auth"
import { OwnershipTransferDialog } from "./ownership-transfer-dialog"

export interface TeamMember {
  id: string
  name: string
  email: string
  avatar?: string
  role: string
  joinedAt?: string
}

interface TeamMembersSectionProps {
  teamId: string
  initialMembers: TeamMember[]
  onMembersChange: (members: TeamMember[]) => void
}

export function TeamMembersSection({
  teamId,
  initialMembers,
  onMembersChange,
}: TeamMembersSectionProps) {
  const { currentUser } = useCurrentUser()
  const { allUsers } = useTeams()
  const { toast } = useToast()
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(initialMembers)
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false)
  const [showEditMemberDialog, setShowEditMemberDialog] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [newMemberUserId, setNewMemberUserId] = useState("")
  const [newMemberRole, setNewMemberRole] = useState("Team Member")

  // Task 7.5: Ownership transfer dialog state
  const [transferDialog, setTransferDialog] = useState<{
    open: boolean
    memberUserId: string
    memberName: string
    items: { id: string; title: string; status?: string; item_type?: string }[]
    goals: { id: string; title: string; status?: string }[]
  } | null>(null)

  const loadTeamMembers = async () => {
    try {
      setLoadingMembers(true)
      const response = await fetchWithAuth(`/api/team-members?teamId=${teamId}`)
      if (!response.ok) {
        throw new Error(`Failed to load team members: ${response.status}`)
      }
      const result = await response.json()
      
      // Deduplicate members by user_id to avoid duplicate keys
      const membersMap = new Map<string, TeamMember>()
      
      ;(result.data || []).forEach((member: any) => {
        // Skip if we already have this member (deduplicate)
        if (membersMap.has(member.user_id)) {
          return
        }
        
        // Use user data from API response if available, otherwise fallback to state.allUsers
        const userFromApi = member.user
        const userFromState = allUsers.find((u) => u.id === member.user_id)
        const user = userFromApi || userFromState
        
        membersMap.set(member.user_id, {
          id: member.user_id,
          name: user?.full_name || user?.name || "Unknown",
          email: user?.email || "",
          avatar: user?.avatar_url || user?.avatar,
          role: member.role || "Team Member",
          joinedAt: member.joined_at,
        })
      })
      
      const membersWithUsers = Array.from(membersMap.values())
      setTeamMembers(membersWithUsers)
      onMembersChange(membersWithUsers)
    } catch (error: any) {
      console.error("[v0] Error loading team members:", error)
      toast({
        title: "Error",
        description: "Failed to load team members",
        variant: "destructive",
      })
      setTeamMembers([])
    } finally {
      setLoadingMembers(false)
    }
  }

  // Load team members on mount to ensure we have the latest data with all user details
  useEffect(() => {
    loadTeamMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]) // Reload when teamId changes

  const handleAddMember = async () => {
    if (!newMemberUserId) {
      toast({
        title: "Validation Error",
        description: "Please select a user",
        variant: "destructive",
      })
      return
    }

    // Check if user is already a member
    const isAlreadyMember = teamMembers.some((m) => m.id === newMemberUserId)
    if (isAlreadyMember) {
      const existingMember = teamMembers.find((m) => m.id === newMemberUserId)
      toast({
        title: "User Already in Team",
        description: `${existingMember?.name || "This user"} is already a member of this team with role "${existingMember?.role || "Unknown"}".`,
        variant: "destructive",
      })
      return
    }

    try {
      setSaving(true)
      const response = await fetchWithAuth("/api/team-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          userId: newMemberUserId,
          role: newMemberRole,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to add team member" }))
        console.error("[Team Members] Error response:", errorData)
        throw new Error(errorData.error || "Failed to add team member")
      }

      const result = await response.json()
      
      if (!result.data) {
        console.error("[Team Members] No data in response:", result)
        throw new Error("Server returned success but no data")
      }

      // Check if this was an update vs new addition
      const wasUpdate = result.data.joined_at && new Date(result.data.joined_at).getTime() < Date.now() - 1000
      
      toast({
        title: "Success",
        description: wasUpdate 
          ? "Team member role updated successfully" 
          : "Team member added successfully",
      })

      setNewMemberUserId("")
      setNewMemberRole("Team Member")
      setShowAddMemberDialog(false)
      
      // Force reload members list
      await loadTeamMembers()
    } catch (error: any) {
      console.error("[Team Members] Error adding team member:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to add team member",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleEditMember = async () => {
    if (!editingMember || !editingMember.role) {
      toast({
        title: "Validation Error",
        description: "Please select a role",
        variant: "destructive",
      })
      return
    }

    try {
      setSaving(true)
      const response = await fetchWithAuth("/api/team-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          userId: editingMember.id,
          role: editingMember.role,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to update team member" }))
        throw new Error(errorData.error || "Failed to update team member")
      }

      const result = await response.json()
      if (!result.data) {
        throw new Error("Server returned success but no data")
      }

      toast({
        title: "Success",
        description: "Team member role updated successfully",
      })

      setEditingMember(null)
      setShowEditMemberDialog(false)
      await loadTeamMembers()
    } catch (error: any) {
      console.error("[v0] Error updating team member:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to update team member",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteMember = async (userId: string, userName: string) => {
    if (!confirm(`Are you sure you want to remove ${userName} from this team?`)) {
      return
    }

    try {
      setSaving(true)
      const response = await fetchWithAuth(`/api/team-members?teamId=${teamId}&userId=${userId}`, {
        method: "DELETE",
      })

      // HTTP 409: ownership transfer required before the deletion can proceed.
      // Parse the body first so we can populate the dialog before short-circuiting.
      if (response.status === 409) {
        const result = await response.json().catch(() => ({}))
        if (result.status === "OWNERSHIP_TRANSFER_REQUIRED") {
          setTransferDialog({
            open: true,
            memberUserId: userId,
            memberName: userName,
            items: result.items ?? [],
            goals: result.goals ?? [],
          })
          return
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to remove team member" }))
        throw new Error(errorData.error || "Failed to remove team member")
      }

      const result = await response.json()

      toast({
        title: "Success",
        description: "Team member removed successfully",
      })

      await loadTeamMembers()
    } catch (error: any) {
      console.error("[v0] Error removing team member:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to remove team member",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  // Check if user can manage team members (Team Owner/Admin or Admin/Super Admin)
  const canManageTeamMembers = (): boolean => {
    // Admins and Super Admins can manage any team
    if (currentUser?.systemRole === "Super Admin" || currentUser?.systemRole === "Admin") {
      return true
    }
    
    // Check if user is Team Owner or Team Admin for this team
    const teamRole = currentUser?.teamRoles?.find((tr) => tr.teamId === teamId)
    return teamRole?.role === "Team Owner" || teamRole?.role === "Team Admin"
  }

  const canManage = canManageTeamMembers()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-foreground">Team Members</h2>
        {canManage && (
          <Dialog open={showAddMemberDialog} onOpenChange={setShowAddMemberDialog}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="mr-2 h-4 w-4" />
                Add Member
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Team Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="newMemberUser">User</Label>
                <SearchableSelect
                  value={newMemberUserId || null}
                  onValueChange={(val) => setNewMemberUserId(val ?? "")}
                  placeholder="Select user"
                  options={allUsers
                    .filter((user) => {
                      // Filter out users who are already team members
                      const isAlreadyMember = teamMembers.some((m) => m.id === user.id)
                      return !isAlreadyMember
                    })
                    .map((user) => ({
                      value: user.id,
                      label: user.name,
                      description: user.email,
                      meta: user.role,
                    }))}
                  variant="inline"
                  listClassName="max-h-64 overflow-y-auto"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newMemberRole">Role</Label>
                <Select value={newMemberRole} onValueChange={setNewMemberRole}>
                  <SelectTrigger id="newMemberRole">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Team Owner">Team Owner</SelectItem>
                    <SelectItem value="Team Admin">Team Admin</SelectItem>
                    <SelectItem value="Team Member">Team Member</SelectItem>
                    <SelectItem value="Team Viewer">Team Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddMemberDialog(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleAddMember} disabled={saving}>
                {saving ? "Adding..." : "Add Member"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {loadingMembers ? (
        <div className="text-center py-8 text-muted-foreground">Loading team members...</div>
      ) : teamMembers.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold text-foreground">No Team Members Yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Add members to this team to get started
          </p>
        </Card>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{member.role}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "N/A"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingMember(member)
                            setShowEditMemberDialog(true)
                          }}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteMember(member.id, member.name)}
                          disabled={saving}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Edit Member Dialog */}
      <Dialog open={showEditMemberDialog} onOpenChange={setShowEditMemberDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team Member Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editMemberRole">Role</Label>
              <Select
                value={editingMember?.role || "Team Member"}
                onValueChange={(value) => setEditingMember({ ...editingMember!, role: value })}
              >
                <SelectTrigger id="editMemberRole">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Team Owner">Team Owner</SelectItem>
                  <SelectItem value="Team Admin">Team Admin</SelectItem>
                  <SelectItem value="Team Member">Team Member</SelectItem>
                  <SelectItem value="Team Viewer">Team Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowEditMemberDialog(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleEditMember} disabled={saving}>
              {saving ? "Updating..." : "Update Role"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Task 7.5: Ownership Transfer Dialog */}
      {transferDialog && (
        <OwnershipTransferDialog
          open={transferDialog.open}
          onClose={() => setTransferDialog(null)}
          onTransferComplete={async () => {
            setTransferDialog(null)
            await loadTeamMembers()
          }}
          memberUserId={transferDialog.memberUserId}
          memberName={transferDialog.memberName}
          teamId={teamId}
          eligibleRecipients={teamMembers
            .filter((m) => m.id !== transferDialog.memberUserId)
            .map((m) => ({ id: m.id, name: m.name, email: m.email }))}
          items={transferDialog.items}
          goals={transferDialog.goals}
        />
      )}
    </div>
  )
}

