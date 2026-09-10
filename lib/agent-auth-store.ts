import { isOSS } from './env';
import { supabaseAdmin } from './supabase';
import crypto from 'crypto';

export interface AgentRegistrationSession {
  id: string;
  email?: string;
  otpCode?: string;
  otpExpiresAt?: string;
  preclaimToken: string;
  /** Claim token issued by the /claim endpoint (persisted in cloud mode). */
  claimToken?: string;
  /** Expiry of the claim token (the one-click authorize link). */
  claimTokenExpiresAt?: string;
  /** Account status at claim time — lets the session poll say 'created'. */
  claimAccount?: 'existing' | 'new';
  status: 'pending_claim' | 'awaiting_otp' | 'completed';
  createdAt: string;
}

// In-memory store for OSS local development
const ossRegistrationStore = new Map<string, AgentRegistrationSession>();

export async function createRegistrationSession(): Promise<{ id: string; preclaimToken: string }> {
  const sessionId = crypto.randomUUID();
  const preclaimToken = `lf_preclaim_${crypto.randomBytes(24).toString('hex')}`;
  const now = new Date().toISOString();

  if (isOSS) {
    ossRegistrationStore.set(sessionId, {
      id: sessionId,
      preclaimToken,
      status: 'pending_claim',
      createdAt: now,
    });
    return { id: sessionId, preclaimToken };
  }

  // Cloud Mode - Supabase
  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');

  const { data, error } = await supabaseAdmin
    .from('agent_registrations')
    .insert({
      id: sessionId,
      preclaim_token: preclaimToken,
      status: 'pending_claim',
    })
    .select('id, preclaim_token')
    .single();

  if (error) {
    console.error('Error creating registration session in Supabase:', error);
    throw new Error('Failed to create registration session.');
  }

  return { id: data.id, preclaimToken: data.preclaim_token };
}

export async function getRegistrationSession(id: string): Promise<AgentRegistrationSession | null> {
  if (isOSS) {
    return ossRegistrationStore.get(id) || null;
  }

  // Cloud Mode
  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');

  const { data, error } = await supabaseAdmin
    .from('agent_registrations')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching registration session from Supabase:', error);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    email: data.email,
    otpCode: data.otp_code,
    otpExpiresAt: data.otp_expires_at,
    preclaimToken: data.preclaim_token,
    claimToken: data.claim_token || undefined,
    claimTokenExpiresAt: data.claim_token_expires_at || undefined,
    claimAccount: data.account_at_claim || undefined,
    status: data.status,
    createdAt: data.created_at,
  };
}

export async function updateRegistrationSessionEmail(
  id: string,
  email: string,
  otpCode: string,
  expiresAt: Date,
  claimToken: string,
  claimTokenExpiresAt: Date,
  claimAccount: 'existing' | 'new'
): Promise<boolean> {
  if (isOSS) {
    const session = ossRegistrationStore.get(id);
    if (!session) return false;

    session.email = email;
    session.otpCode = otpCode;
    session.otpExpiresAt = expiresAt.toISOString();
    session.claimToken = claimToken;
    session.claimTokenExpiresAt = claimTokenExpiresAt.toISOString();
    session.claimAccount = claimAccount;
    session.status = 'awaiting_otp';
    ossRegistrationStore.set(id, session);
    return true;
  }

  // Cloud Mode
  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');

  const { error } = await supabaseAdmin
    .from('agent_registrations')
    .update({
      email,
      otp_code: otpCode,
      otp_expires_at: expiresAt.toISOString(),
      claim_token: claimToken,
      claim_token_expires_at: claimTokenExpiresAt.toISOString(),
      account_at_claim: claimAccount,
      status: 'awaiting_otp',
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating registration session email in Supabase:', error);
    return false;
  }

  return true;
}

export async function completeRegistrationSession(id: string): Promise<boolean> {
  if (isOSS) {
    const session = ossRegistrationStore.get(id);
    if (!session) return false;

    session.status = 'completed';
    ossRegistrationStore.set(id, session);
    return true;
  }

  // Cloud Mode
  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');

  const { error } = await supabaseAdmin
    .from('agent_registrations')
    .update({
      status: 'completed',
    })
    .eq('id', id);

  if (error) {
    console.error('Error completing registration session in Supabase:', error);
    return false;
  }

  return true;
}
