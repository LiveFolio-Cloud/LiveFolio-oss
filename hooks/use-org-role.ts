'use client';

import { useState, useEffect, useCallback } from 'react';
import { isCloud } from '@/lib/env';

interface OrgInfo {
  role: string | null;
  orgId: string | null;
  orgName: string | null;
  plan: string | null;
  loading: boolean;
}

interface OrgMembership {
  organization_id: string;
  role: string;
  org_name: string;
  plan: string;
}

/**
 * Hook: useOrgRole
 *
 * Returns the current user's role + org in the active workspace context.
 * In OSS mode, everyone is Owner.
 */
export function useOrgRole() {
  const [org, setOrg] = useState<OrgInfo>({
    role: null,
    orgId: null,
    orgName: null,
    plan: null,
    loading: true,
  });

  const fetchOrg = useCallback(async () => {
    if (!isCloud) {
      setOrg({ role: 'Owner', orgId: 'local-workspace', orgName: 'Local Workspace', plan: 'Free', loading: false });
      return;
    }

    try {
      // Fetch organization members to get current user's role
      const membersRes = await fetch('/api/organizations/members');
      if (membersRes.ok) {
        const data = await membersRes.json();
        // Find self in the members list
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- /api/organizations/members returns untyped JSON; teammate rows carry no shared isSelf type
        const self = data.teammates?.find((m: any) => m.isSelf);
        if (self) {
          setOrg({
            role: self.role,
            orgId: self.organization_id,
            orgName: data.orgName || null,
            plan: data.plan || null,
            loading: false,
          });
          return;
        }
      }
    } catch {
      // Silently fail — UI defaults to safe state
    }

    setOrg((prev) => ({ ...prev, loading: false }));
  }, []);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  const isOwner = org.role === 'Owner';
  const isAdmin = org.role === 'Admin' || org.role === 'Owner';
  const isMember = org.role === 'Member';

  return { ...org, isOwner, isAdmin, isMember, refetch: fetchOrg };
}

/**
 * Hook: useOrgList
 *
 * Returns all organizations the current user belongs to.
 */
export function useOrgList() {
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrgs = useCallback(async () => {
    if (!isCloud) {
      setOrgs([{ organization_id: 'local-workspace', role: 'Owner', org_name: 'Local Workspace', plan: 'Free' }]);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/organizations/members');
      if (res.ok) {
        const data = await res.json();
        setOrgs(data.allOrgs || data.teammates || []);
      }
    } catch {
      // Silently fail
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  return { orgs, loading, refetch: fetchOrgs };
}

/**
 * Switch the active organization.
 * Calls the server endpoint and refreshes the page.
 */
export async function switchOrg(orgId: string): Promise<boolean> {
  try {
    const res = await fetch('/api/organizations/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
