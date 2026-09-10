'use client';

/**
 * Shared state + handlers for the Billing and Teammates sections (Cloud).
 * One fetch on mount; both sections read from the same store-like hook.
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';

export interface BillingUsage {
  plan: string;
  monthly_message_count: number;
  monthly_message_limit: number;
  name: string;
  storage_used_bytes?: number;
  storage_limit_bytes?: number;
}

export interface Teammate {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  isSelf?: boolean;
}

export function useBillingTeammates() {
  const { toast } = useToast();

  const [billingUsage, setBillingUsage] = useState<BillingUsage | null>(null);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [teamSeats, setTeamSeats] = useState(5);
  const [plan, setPlan] = useState<'Pro' | 'Team' | 'Enterprise'>('Team');

  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('Owner');
  const [loadingTeammates, setLoadingTeammates] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'Admin' | 'Member'>('Member');
  const [invitingTeammate, setInvitingTeammate] = useState(false);
  const [showUpgradeCTA, setShowUpgradeCTA] = useState(false);
  const [isUpdatingRole, setIsUpdatingRole] = useState<string | null>(null);
  const [isRemovingTeammate, setIsRemovingTeammate] = useState<string | null>(null);

  const fetchBillingUsage = async () => {
    try {
      const res = await fetch('/api/billing/usage');
      if (res.ok) {
        const data = await res.json();
        setBillingUsage(data);
      }
    } catch (err) {
      console.error('Failed to load billing usage:', err);
    }
  };

  const fetchTeammates = async () => {
    setLoadingTeammates(true);
    try {
      const res = await fetch('/api/organizations/members');
      if (res.ok) {
        const data = await res.json();
        setTeammates(data.teammates || []);
        const self = (data.teammates || []).find((m: Teammate) => m.isSelf);
        if (self?.role) setCurrentUserRole(self.role);
      }
    } catch (err) {
      console.error('Failed to load teammates:', err);
    } finally {
      setLoadingTeammates(false);
    }
  };

  const handleInviteTeammate = async (e: FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInvitingTeammate(true);
    try {
      const res = await fetch('/api/organizations/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ variant: 'success', title: data.message || 'Invitation sent successfully!' });
        setInviteEmail('');
        fetchTeammates();
        fetchBillingUsage();
      } else {
        if (data.needsUpgrade) {
          setShowUpgradeCTA(true);
        } else {
          toast({ variant: 'error', title: data.error || 'Failed to send invitation.' });
        }
      }
    } catch (err) {
      console.error('Invite teammate error:', err);
      toast({ variant: 'error', title: 'Failed to connect to invitation service.' });
    } finally {
      setInvitingTeammate(false);
    }
  };

  const handleUpdateTeammateRole = async (memberId: string, newRole: 'Admin' | 'Member') => {
    setIsUpdatingRole(memberId);
    try {
      const res = await fetch('/api/organizations/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, role: newRole }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchTeammates();
      } else {
        toast({ variant: 'error', title: data.error || 'Failed to update member role.' });
      }
    } catch (err) {
      console.error('Update role error:', err);
    } finally {
      setIsUpdatingRole(null);
    }
  };

  const handleRemoveTeammate = async (memberId: string) => {
    if (!confirm("Are you sure you want to revoke this teammate's seat access?")) return;
    setIsRemovingTeammate(memberId);
    try {
      const res = await fetch(`/api/organizations/members?id=${memberId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        fetchTeammates();
      } else {
        toast({ variant: 'error', title: data.error || 'Failed to revoke teammate.' });
      }
    } catch (err) {
      console.error('Remove teammate error:', err);
    } finally {
      setIsRemovingTeammate(null);
    }
  };

  const handleBillingAction = async () => {
    setLoadingBilling(true);
    setBillingError(null);
    try {
      const isUpgrading = !billingUsage || billingUsage.plan === 'Free';
      const endpoint = isUpgrading ? '/api/billing/checkout' : '/api/billing/portal';
      const body = isUpgrading ? { plan, seats: teamSeats } : {};

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        }
      } else {
        const err = await res.json();
        setBillingError(err.error || 'Failed to process billing action.');
      }
    } catch (err) {
      console.error('Billing redirect error:', err);
      setBillingError('Network error connecting to billing services.');
    } finally {
      setLoadingBilling(false);
    }
  };

  useEffect(() => {
    fetchBillingUsage();
    fetchTeammates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Soft wall: meters turn amber at ≥80% of an allowance so users upgrade
  // (or trim) BEFORE hitting the hard 402 at 100%. Launch threshold: 80.
  const SOFT_WALL_PCT = 80;

  const usagePct = billingUsage
    ? Math.min(100, (billingUsage.monthly_message_count / billingUsage.monthly_message_limit) * 100)
    : 0;
  const nearLimit = usagePct >= SOFT_WALL_PCT;

  const storagePct = billingUsage?.storage_limit_bytes
    ? Math.min(100, ((billingUsage.storage_used_bytes || 0) / billingUsage.storage_limit_bytes) * 100)
    : 0;
  const storageNearLimit = storagePct >= SOFT_WALL_PCT;

  const isAdmin = currentUserRole !== 'Member';

  return {
    billingUsage, loadingBilling, billingError, teamSeats, setTeamSeats, plan, setPlan,
    handleBillingAction, usagePct, nearLimit, storagePct, storageNearLimit,
    teammates, loadingTeammates, currentUserRole, isAdmin,
    inviteEmail, setInviteEmail, inviteRole, setInviteRole, invitingTeammate,
    handleInviteTeammate, showUpgradeCTA, setShowUpgradeCTA,
    isUpdatingRole, isRemovingTeammate, handleUpdateTeammateRole, handleRemoveTeammate,
  };
}
