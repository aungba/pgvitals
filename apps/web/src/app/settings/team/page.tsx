"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getOrganization,
  updateOrganization,
  getTeamMembers,
  inviteTeamMember,
  updateMemberRole,
  removeMember,
} from "../../lib/api";
import type { Organization, TeamMember } from "../../lib/api";

/* ===================================================================
   Team Settings Page — Organization & Member Management
   =================================================================== */

const ROLE_BADGES: Record<string, { color: string; bg: string }> = {
  owner: { color: "var(--brand)", bg: "var(--brand-dim)" },
  admin: { color: "var(--signal-warning)", bg: "var(--signal-warning-dim)" },
  member: { color: "var(--text-secondary)", bg: "var(--surface-alt)" },
};

export default function TeamPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState("");
  const [saving, setSaving] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [orgData, memberData] = await Promise.all([
        getOrganization(),
        getTeamMembers(),
      ]);
      setOrg(orgData);
      setOrgName(orgData.name);
      setMembers(memberData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveOrg = async () => {
    if (!orgName.trim()) return;
    setSaving(true);
    try {
      const updated = await updateOrganization(orgName.trim());
      setOrg(updated);
      setStatus({ type: "success", message: "Organization updated!" });
    } catch {
      setStatus({ type: "error", message: "Failed to update organization" });
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(null), 3000);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await inviteTeamMember(inviteEmail.trim(), inviteRole);
      setInviteEmail("");
      await fetchData();
      setStatus({ type: "success", message: "Member invited!" });
    } catch {
      setStatus({ type: "error", message: "Failed to invite member" });
    } finally {
      setInviting(false);
      setTimeout(() => setStatus(null), 3000);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: "admin" | "member") => {
    try {
      await updateMemberRole(memberId, newRole);
      await fetchData();
    } catch {
      setStatus({ type: "error", message: "Failed to update role" });
      setTimeout(() => setStatus(null), 3000);
    }
  };

  const handleRemove = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email} from the organization?`)) return;
    try {
      await removeMember(memberId);
      await fetchData();
      setStatus({ type: "success", message: "Member removed" });
    } catch {
      setStatus({ type: "error", message: "Failed to remove member" });
    }
    setTimeout(() => setStatus(null), 3000);
  };

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="skeleton" style={{ width: 300, height: 32, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="detail-header">
        <div className="detail-header-left">
          <Link
            href="/"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: "var(--radius-md)",
              background: "var(--surface-alt)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", fontSize: "1rem",
              transition: "all var(--transition-fast)", flexShrink: 0,
            }}
            title="Back to dashboard"
          >
            ←
          </Link>
          <div>
            <h1>Team Settings</h1>
            <p className="text-secondary" style={{ fontSize: "0.9rem" }}>
              Manage your organization and team members
            </p>
          </div>
        </div>
      </div>

      {/* Status */}
      {status && (
        <div
          className={`alert ${status.type === "success" ? "alert-success" : "alert-error"}`}
          style={{ marginBottom: "var(--space-lg)" }}
        >
          <span>{status.type === "success" ? "✅" : "⚠️"}</span>
          <span>{status.message}</span>
        </div>
      )}

      {/* Organization Settings */}
      <div className="section-title">Organization</div>
      <div className="glass-card-static" style={{ padding: "var(--space-lg)", marginBottom: "var(--space-xl)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-md)", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="form-label">Organization Name</label>
            <input
              type="text"
              className="form-input"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
          <div>
            <span style={{
              display: "inline-block", padding: "6px 14px", borderRadius: "var(--radius-full)",
              background: "var(--brand-dim)", color: "var(--brand)",
              fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase",
              marginBottom: 6,
            }}>
              {org?.planTier ?? "free"} plan
            </span>
          </div>
          <button
            className="btn-primary"
            onClick={handleSaveOrg}
            disabled={saving || !orgName.trim()}
            style={{ height: 44 }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Invite Member */}
      <div className="section-title">Invite Member</div>
      <div className="glass-card-static" style={{ padding: "var(--space-lg)", marginBottom: "var(--space-xl)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-md)", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-input"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="form-label">Role</label>
            <select
              className="form-input"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
              style={{ height: 44 }}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            className="btn-primary"
            onClick={handleInvite}
            disabled={inviting || !inviteEmail.trim()}
            style={{ height: 44 }}
          >
            {inviting ? "Inviting..." : "➕ Invite"}
          </button>
        </div>
      </div>

      {/* Members List */}
      <div className="section-title">Team Members ({members.length})</div>
      <div className="glass-card-static" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="alert-table-th">Email</th>
              <th className="alert-table-th" style={{ width: 100 }}>Role</th>
              <th className="alert-table-th" style={{ width: 140 }}>Joined</th>
              <th className="alert-table-th" style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const badge = ROLE_BADGES[m.role] ?? ROLE_BADGES.member;
              return (
                <tr key={m.id} className="alert-table-row">
                  <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
                    {m.email}
                  </td>
                  <td className="alert-table-td">
                    <span style={{
                      fontSize: "0.75rem", fontWeight: 600, color: badge.color,
                      padding: "2px 10px", borderRadius: "var(--radius-full)", background: badge.bg,
                      textTransform: "uppercase",
                    }}>
                      {m.role}
                    </span>
                  </td>
                  <td className="alert-table-td" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="alert-table-td">
                    {m.role !== "owner" && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.id, e.target.value as "admin" | "member")}
                          style={{
                            padding: "4px 8px", fontSize: "0.75rem", borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--border)", background: "var(--surface)",
                            color: "var(--text-primary)", cursor: "pointer",
                          }}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          onClick={() => handleRemove(m.id, m.email)}
                          style={{
                            padding: "4px 8px", fontSize: "0.75rem", borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--signal-critical-dim)", background: "var(--signal-critical-dim)",
                            color: "var(--signal-critical)", cursor: "pointer", fontWeight: 600,
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
