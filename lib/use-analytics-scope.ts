"use client"

import * as React from "react"
import { useStore } from "@/lib/store"
import {
  scopeMembersForAnalytics,
  scopeProjectsForAnalytics,
  scopeWorkSessionsForAnalytics,
} from "@/lib/analytics-scope"

/**
 * Escopo único para Dashboard e Relatórios.
 * Admin recebe a visão consolidada do workspace.
 * Qualquer outra role recebe somente dados relacionados ao próprio usuário.
 */
export function useAnalyticsScope() {
  const { currentUserId, currentUserRole, members, projects, workSessions } = useStore()
  const isAdmin = currentUserRole === "admin"

  const scopedProjects = React.useMemo(
    () => scopeProjectsForAnalytics(projects, currentUserId, currentUserRole),
    [currentUserId, currentUserRole, projects],
  )

  const scopedWorkSessions = React.useMemo(
    () => scopeWorkSessionsForAnalytics(workSessions, currentUserId, currentUserRole),
    [currentUserId, currentUserRole, workSessions],
  )

  const scopedMembers = React.useMemo(
    () => scopeMembersForAnalytics(members, currentUserId, currentUserRole),
    [currentUserId, currentUserRole, members],
  )

  return {
    currentUserId,
    currentUserRole,
    isAdmin,
    projects: scopedProjects,
    workSessions: scopedWorkSessions,
    members: scopedMembers,
  }
}
