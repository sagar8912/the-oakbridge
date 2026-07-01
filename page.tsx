"use client"

import { AppSidebar } from "@/components/global/navigation/app-sidebar"
import { OrganizationClient } from "@/components/organizations"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatsCard } from "@/components/shared/stats-card"
import Link from "next/link"
import {
  Network,
  TrendingUp,
  FileText,
  TrendingUp as TrendingUpIcon,
  AlertCircle,
  CheckCircle,
  Lightbulb,
  Target,
  ArrowUp,
  UserPlus,
  Trophy,
  Building2,
} from "lucide-react"
import { useMemo, useState, useEffect } from "react"
import { useItems } from "@/lib/items-context"
import { useTeams } from "@/lib/teams-context"
import { DataService } from "@/lib/data-service"
import { computeOwnerLeaderboard } from "@/lib/leaderboard"
import type { OwnerLeaderboardEntry } from "@/lib/leaderboard"
import type React from "react"

export default function TeamsPage() {
  const { items } = useItems()
  const { employees, allUsers } = useTeams()

  // Team-wide stats
  const [teamStats, setTeamStats] = useState<{
    total: number
    opportunities: number
    obstacles: number
    resolved: number
  } | null>(null)
  const [teamLeaderboard, setTeamLeaderboard] = useState<OwnerLeaderboardEntry[]>([])
  const [teamLeaders, setTeamLeaders] = useState<{
    topIdeaContributor: { id: string; name: string; department: string; ideasContributed: number } | null
    topAdoptedIdeas: { id: string; name: string; department: string; ideasAdopted: number } | null
    topObstacleCloser: { id: string; name: string; department: string; obstaclesResolved: number } | null
    topElevator: { id: string; name: string; department: string; itemsElevated: number } | null
    topDelegator: { id: string; name: string; department: string; itemsDelegated: number } | null
  } | null>(null)

  // Fetch team-wide data on mount
  useEffect(() => {
    async function fetchTeamData() {
      try {
        const [stats, leaderboard, leaders] = await Promise.all([
          DataService.getDashboardStats(),
          DataService.getDashboardLeaderboard(),
          DataService.getDashboardLeaders(),
        ])
        setTeamStats(stats)
        setTeamLeaderboard(leaderboard || [])
        setTeamLeaders(leaders)
      } catch (error) {
        console.error("[Teams] Error fetching team-wide data:", error)
        // Continue with empty data - don't block the page
      }
    }
    fetchTeamData()
  }, [])

  // Use team-wide stats if available, otherwise fall back to user-filtered stats
  const stats = teamStats || {
    total: items.length,
    opportunities: items.filter((i) => i.category === "Opportunity").length,
    obstacles: items.filter((i) => i.category === "Obstacle").length,
    resolved: items.filter((i) => i.status === "solved").length,
  }

  // Use team-wide leaders if available, otherwise fall back to user-filtered leaders
  const topIdeaContributor =
    teamLeaders?.topIdeaContributor ||
    (employees.length > 0 ? employees.sort((a, b) => b.ideasContributed - a.ideasContributed)[0] : null)
  const topAdoptedIdeas =
    teamLeaders?.topAdoptedIdeas ||
    (employees.length > 0 ? employees.sort((a, b) => b.ideasAdopted - a.ideasAdopted)[0] : null)
  const topObstacleCloser =
    teamLeaders?.topObstacleCloser ||
    (employees.length > 0 ? employees.sort((a, b) => b.obstaclesResolved - a.obstaclesResolved)[0] : null)
  const topElevator =
    teamLeaders?.topElevator ||
    (employees.length > 0 ? employees.sort((a, b) => b.itemsElevated - a.itemsElevated)[0] : null)
  const topDelegator =
    teamLeaders?.topDelegator ||
    (employees.length > 0 ? employees.sort((a, b) => b.itemsDelegated - a.itemsDelegated)[0] : null)

  // Use team-wide leaderboard if available, otherwise fall back to user-filtered leaderboard
  const leaderboardEntries = useMemo(() => {
    if (teamLeaderboard.length > 0) {
      return teamLeaderboard
    }
    return computeOwnerLeaderboard(items, employees, allUsers)
  }, [teamLeaderboard, items, employees, allUsers])

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-hidden">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="border-b bg-background p-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
                <p className="text-muted-foreground mt-1">Team structure, statistics, and leaderboard</p>
              </div>
              <Link href="/">
                <Badge variant="outline" className="text-sm p-2 cursor-pointer hover:bg-accent">
                  <Building2 className="h-4 w-4 mr-2" />
                  Back to Dashboard
                </Badge>
              </Link>
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="structure" className="flex-1 flex flex-col overflow-hidden">
            <div className="border-b px-6 pt-4">
              <TabsList>
                <TabsTrigger value="structure" className="gap-2">
                  <Network className="h-4 w-4" />
                  Structure
                </TabsTrigger>
                <TabsTrigger value="stats" className="gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Stats & Leaderboard
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Structure Tab */}
            <TabsContent value="structure" className="flex-1 overflow-auto m-0 p-0">
              <div className="h-full overflow-auto">
                <OrganizationClient />
              </div>
            </TabsContent>

            {/* Stats & Leaderboard Tab */}
            <TabsContent value="stats" className="flex-1 overflow-auto p-6 space-y-8">
              {/* Team Stats */}
              <div>
                <h2 className="text-2xl font-bold mb-4">Team Statistics</h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                  <StatsCard
                    key="total-items"
                    title="Total Items"
                    value={stats.total}
                    icon={FileText}
                    description="Team-wide active OOO items"
                    href="/"
                  />
                  <StatsCard
                    key="opportunities"
                    title="Opportunities"
                    value={stats.opportunities}
                    icon={TrendingUpIcon}
                    description="Team-wide growth potential"
                    href="/?category=Opportunity"
                  />
                  <StatsCard
                    key="obstacles"
                    title="Obstacles"
                    value={stats.obstacles}
                    icon={AlertCircle}
                    description="Team-wide items needing attention"
                    href="/?category=Obstacle"
                  />
                  <StatsCard
                    key="resolved"
                    title="Resolved"
                    value={stats.resolved}
                    icon={CheckCircle}
                    description="Team-wide completed items"
                    href="/?status=Resolved"
                  />
                </div>
              </div>

              {/* Team Leaders */}
              {(teamLeaders || employees.length > 0) && (
                <div>
                  <h2 className="text-2xl font-bold mb-4">Team Leaders</h2>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                    {[
                      topIdeaContributor
                        ? {
                            key: "top-idea-contributor",
                            content: (
                              <Card className="p-4 hover:bg-accent/50 transition-colors">
                                <div className="flex items-start gap-3">
                                  <div className="p-2 rounded-lg bg-blue-500/10">
                                    <Lightbulb className="h-5 w-5 text-blue-500" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-muted-foreground mb-1">Top Idea Contributor</p>
                                    <p className="font-semibold text-sm truncate">{topIdeaContributor.name || "Unknown"}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {topIdeaContributor.department || "Unknown"} • {topIdeaContributor.ideasContributed}{" "}
                                      ideas
                                    </p>
                                  </div>
                                </div>
                              </Card>
                            ),
                          }
                        : null,
                      topAdoptedIdeas
                        ? {
                            key: "top-adopted-ideas",
                            content: (
                              <Link href="/adopted-ideas">
                                <Card className="p-4 hover:bg-accent/50 transition-colors cursor-pointer">
                                  <div className="flex items-start gap-3">
                                    <div className="p-2 rounded-lg bg-green-500/10">
                                      <Trophy className="h-5 w-5 text-green-500" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs text-muted-foreground mb-1">Most Adopted Ideas</p>
                                      <p className="font-semibold text-sm truncate">{topAdoptedIdeas.name || "Unknown"}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {topAdoptedIdeas.department || "Unknown"} • {topAdoptedIdeas.ideasAdopted} adopted
                                      </p>
                                    </div>
                                  </div>
                                </Card>
                              </Link>
                            ),
                          }
                        : null,
                      topObstacleCloser
                        ? {
                            key: "top-obstacle-closer",
                            content: (
                              <Card className="p-4 hover:bg-accent/50 transition-colors">
                                <div className="flex items-start gap-3">
                                  <div className="p-2 rounded-lg bg-red-500/10">
                                    <Target className="h-5 w-5 text-red-500" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-muted-foreground mb-1">Top Obstacle Closer</p>
                                    <p className="font-semibold text-sm truncate">{topObstacleCloser.name || "Unknown"}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {topObstacleCloser.department || "Unknown"} • {topObstacleCloser.obstaclesResolved}{" "}
                                      resolved
                                    </p>
                                  </div>
                                </div>
                              </Card>
                            ),
                          }
                        : null,
                      topElevator
                        ? {
                            key: "top-elevator",
                            content: (
                              <Card className="p-4 hover:bg-accent/50 transition-colors">
                                <div className="flex items-start gap-3">
                                  <div className="p-2 rounded-lg bg-purple-500/10">
                                    <ArrowUp className="h-5 w-5 text-purple-500" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-muted-foreground mb-1">Top Elevator</p>
                                    <p className="font-semibold text-sm truncate">{topElevator.name || "Unknown"}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {topElevator.department || "Unknown"} • {topElevator.itemsElevated} elevated
                                    </p>
                                  </div>
                                </div>
                              </Card>
                            ),
                          }
                        : null,
                      topDelegator
                        ? {
                            key: "top-delegator",
                            content: (
                              <Card className="p-4 hover:bg-accent/50 transition-colors">
                                <div className="flex items-start gap-3">
                                  <div className="p-2 rounded-lg bg-orange-500/10">
                                    <UserPlus className="h-5 w-5 text-orange-500" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-muted-foreground mb-1">Top Delegator</p>
                                    <p className="font-semibold text-sm truncate">{topDelegator.name || "Unknown"}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {topDelegator.department || "Unknown"} • {topDelegator.itemsDelegated} delegated
                                    </p>
                                  </div>
                                </div>
                              </Card>
                            ),
                          }
                        : null,
                    ]
                      .filter((item): item is { key: string; content: React.ReactElement } => item !== null)
                      .map((item) => {
                        return <div key={item.key}>{item.content}</div>
                      })}
                  </div>
                </div>
              )}

              {/* Team Leaderboard */}
              {leaderboardEntries.length > 0 && (
                <div>
                  <h2 className="text-2xl font-bold mb-4">Team Leaderboard</h2>
                  <p className="text-sm text-muted-foreground mb-4">Showing team-wide metrics across all users</p>
                  <Card>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="border-b border-border">
                          <tr className="text-left">
                            <th className="p-4 text-sm font-semibold">Rank</th>
                            <th className="p-4 text-sm font-semibold">Employee</th>
                            <th className="p-4 text-sm font-semibold">Department</th>
                            <th className="p-4 text-sm font-semibold text-right">Owned Items</th>
                            <th className="p-4 text-sm font-semibold text-right">Ideas Contributed</th>
                            <th className="p-4 text-sm font-semibold text-right">Ideas Adopted</th>
                            <th className="p-4 text-sm font-semibold text-right">Obstacles Resolved</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leaderboardEntries.map((entry, index) => (
                            <tr key={entry.ownerId ?? entry.name} className="border-b border-border hover:bg-accent/50">
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  {index === 0 && <Trophy className="h-4 w-4 text-yellow-500" />}
                                  {index === 1 && <Trophy className="h-4 w-4 text-gray-400" />}
                                  {index === 2 && <Trophy className="h-4 w-4 text-orange-600" />}
                                  <span className="text-sm font-medium">{index + 1}</span>
                                </div>
                              </td>
                              <td className="p-4 text-sm font-medium">{entry.name}</td>
                              <td className="p-4 text-sm text-muted-foreground">{entry.department}</td>
                              <td className="p-4 text-sm text-right font-medium">{entry.totalOwned}</td>
                              <td className="p-4 text-sm text-right">{entry.ideasContributed}</td>
                              <td className="p-4 text-sm text-right font-medium">{entry.ideasAdopted}</td>
                              <td className="p-4 text-sm text-right">{entry.obstaclesResolved}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
