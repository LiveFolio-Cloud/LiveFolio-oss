import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Metadata } from 'next';
import React from 'react';
import { PencilRuler, ShieldAlert, FileX2 } from 'lucide-react';
import { getProjectForShare } from '@/lib/db';
import { isLocalHost } from '@/lib/network';
import { isOSS } from '@/lib/env';
import { getProjectShareSlug } from '@/lib/slug';
import { computeShareGate } from '@/app/api/_lib/share-gate';
import GuestPresentationPage from './ShareClient';

/**
 * /share/[id] — gate screens + interactive folio viewer.
 *
 * Route segment config and generateMetadata live in this route file so
 * Next.js can statically detect them. The interactive folio viewer
 * (ShareClient) is rendered once the gates pass.
 */

export const dynamic = 'force-dynamic';
export const dynamicParams = true;
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const project = await getProjectForShare(id);
  if (!project) {
    return {
      title: 'Project Not Found | LiveFolio',
    };
  }

  const title = `${project.title} | LiveFolio`;
  const description = project.description || 'A living canvas published on LiveFolio.';

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'LiveFolio',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Share gate — v2 smooth chrome for not-found / draft / restricted   */
/* ------------------------------------------------------------------ */

function ShareGate({
  kind,
  title,
  icon: Icon,
  children,
  rows,
  accent,
}: {
  kind: string;
  title: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
  rows?: Array<[string, string]>;
  /** Org Owner accent — defaults to vermillion; powers --lf-accent below. */
  accent?: string;
}) {
  return (
    <div
      className="flex min-h-screen items-center justify-center p-6 antialiased select-none bg-[#F4F4F0] text-[#0F0F0D]"
      style={{ '--lf-accent': accent || '#FF3B00' } as React.CSSProperties}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5 md:p-10">
        {/* Brand mark — v2 logo */}
        <div className="mb-8 flex items-center gap-2">
          <span className="inline-flex h-4 w-4 items-center justify-center">
            <span className="inline-block h-2.5 w-2.5 bg-[var(--lf-accent)]" />
          </span>
          <span
            className="font-black text-xl tracking-tighter text-[#0F0F0D]"
            style={{ fontFamily: '"Cabinet Grotesk", "Space Grotesk", sans-serif' }}
          >
            LiveFolio
          </span>
        </div>

        {/* Icon tile */}
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--lf-accent)]/10 text-[var(--lf-accent)]">
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>

        <div className="mt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lf-accent)]">{kind}</div>
        <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[#0F0F0D]">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#0F0F0D]/70">{children}</p>

        {rows && rows.length > 0 && (
          <div className="mt-6 divide-y divide-[#0F0F0D]/5 overflow-hidden rounded-xl bg-[#0F0F0D]/[0.03]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40">{k}</span>
                <span className="truncate text-xs font-medium text-[#0F0F0D]">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const headersList = await headers();
  const host = headersList.get('host');

  const isLocal = isLocalHost(host);

  const project = await getProjectForShare(id);

  if (!project) {
    return (
      <ShareGate kind="ERROR · 404" title="Project Not Found" icon={FileX2}>
        The requested folio does not exist or has been deleted.
      </ShareGate>
    );
  }

  // Keep query params across redirects — the paid-gate purchase flow relies
  // on `?purchase=success&session_id=...` surviving the canonical / share
  // redirects (Next's redirect() drops the query string by default).
  const sp = await searchParams;
  const queryString = Object.entries(sp)
    .flatMap(([k, v]) => (v == null ? [] : Array.isArray(v) ? v.map((x) => `${k}=${encodeURIComponent(x)}`) : [`${k}=${encodeURIComponent(v)}`]))
    .join('&');
  const withQuery = (path: string) => (queryString ? `${path}?${queryString}` : path);

  // SSR gate state: minimal (owner check + accent); the client reconciles
  // grants/preview standing via the public route on mount.
  const gateState = await computeShareGate({
    paidAccess: project.paidAccess,
    projectId: project.projectId,
    organization_id: project.organization_id,
  });

  // Redirect to new @username/folio-slug format if possible
  if (project.slug && !isOSS) {
    try {
      const { supabaseAdmin } = await import('@/lib/supabase');
      const { data: ownerMembership } = await supabaseAdmin!
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', project.organization_id)
        .eq('role', 'Owner')
        .single();

      if (ownerMembership) {
        const { data: ownerProfile } = await supabaseAdmin!
          .from('profiles')
          .select('username')
          .eq('id', ownerMembership.user_id)
          .single();

        if (ownerProfile?.username) {
          redirect(withQuery(`/@${ownerProfile.username}/${project.slug}`));
        }
      }
    } catch {
      // Fall through to old share page if lookup fails
    }
  }

  // Canonical Redirect check (legacy)
  const canonicalSlug = getProjectShareSlug(project.title, project.id);
  if (id !== canonicalSlug) {
    redirect(withQuery(`/share/${canonicalSlug}`));
  }

  // Draft gate — only the owner can preview. Everyone else sees "Not Published".
  const isDraft = project.status === 'draft';
  if (isDraft) {
    return (
      <ShareGate
        kind="STATUS · DRAFT"
        title="Not Published"
        icon={PencilRuler}
        accent={gateState.accentColor}
        rows={[
          ['FOLIO', project.title],
          ['STATUS', 'Draft'],
        ]}
      >
        This folio is still a{' '}
        <strong className="font-semibold text-[var(--lf-accent)]">draft</strong>. The owner needs to publish
        it before it can be shared publicly.
      </ShareGate>
    );
  }

  // Tunnel gating only in OSS mode. Cloud folios are publicly hosted by default.
  if (isOSS && !isLocal && !project.publicTunnelEnabled) {
    return (
      <ShareGate
        kind="ACCESS · RESTRICTED"
        title="Access Restricted"
        icon={ShieldAlert}
        accent={gateState.accentColor}
        rows={[
          ['DOMAIN', host || 'unknown'],
          ['FOLIO ID', id],
          ['SECURITY', 'Tunnel-Isolation Active'],
        ]}
      >
        This folio is currently isolated locally. To view it via the public sharing tunnel, enable{' '}
        <strong className="font-semibold text-[var(--lf-accent)]">&ldquo;Public Link&rdquo;</strong> inside
        the Studio Share panel.
      </ShareGate>
    );
  }

  // Pass server-fetched project as initial data so the client doesn't re-fetch.
  // Shape matches what /api/files/[id]/public returns.
  const latestVersion = project.versions[project.versions.length - 1];
  const isPrivate = !!project.isPrivate;
  // Private folios: withhold comments/reactions/file lists — the guest must
  // prove the access key client-side before content is revealed.
  const hasContentAccess = !isPrivate;
  const initialData = {
    id: project.id,
    title: project.title,
    description: project.description,
    isPrivate,
    allowComments: project.allowComments !== false,
    presentationModeOnly: !!project.presentationModeOnly,
    hasAccessKey: !!project.accessKey,
    status: project.status || 'published',
    draft: isDraft,
    latestVersionId: latestVersion?.versionId,
    activeFileList: hasContentAccess ? Object.keys(latestVersion?.files || {}) : [],
    comments: hasContentAccess ? (project.comments || []).filter(
      (c) => c.versionId === latestVersion?.versionId && !c.resolved
    ) : [],
    reactions: hasContentAccess ? (project.reactions || {}) : {},
    // Paid-gate fields (cloud only; null/absent in OSS) — the client
    // reconciles the authoritative viewerAccess via the public route.
    paidAccess: gateState.paidAccess,
    viewerAccess: gateState.viewerAccess,
    accentColor: gateState.accentColor ?? null,
    thumbnailUrl: project.thumbnailUrl || null,
  };

  return <GuestPresentationPage initialProject={initialData} />;
}
