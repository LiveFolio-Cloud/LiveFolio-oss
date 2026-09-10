/**
 * Privacy Policy page — /privacy (v2 design language)
 *
 * Cloud-only. Redirects to landing page in OSS mode.
 * Route-level exports (metadata, revalidate) live here so Next.js picks them up.
 */
import type { Metadata } from "next";
import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { isCloud } from "@/lib/env";

export const revalidate = 86400; // ISR: regenerate at most once per day

export const metadata: Metadata = {
  title: "Privacy Policy — LiveFolio",
  description:
    "LiveFolio Privacy Policy — data collection, usage, sharing, cookies, data retention, user rights, and contact information.",
};

const DISPLAY_FONT = '"Cabinet Grotesk", "Space Grotesk", sans-serif';

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mt-16 border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 pt-8 font-black tracking-tighter text-2xl text-[#0F0F0D] dark:text-[#F4F4F0] md:text-3xl"
      style={{ fontFamily: DISPLAY_FONT }}
    >
      {children}
    </h2>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="mt-8 font-black tracking-tighter text-base text-[#0F0F0D] dark:text-[#F4F4F0]"
      style={{ fontFamily: DISPLAY_FONT }}
    >
      {children}
    </h3>
  );
}
function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 text-[15px] leading-relaxed text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70">
      {children}
    </p>
  );
}
function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-4 space-y-2.5">{children}</ul>;
}
function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-[15px] leading-relaxed text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#FF3B00]" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
function Strong({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold text-[#0F0F0D] dark:text-[#F4F4F0]">{children}</strong>
  );
}
function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-[#FF3B00] underline underline-offset-4 hover:no-underline">
      {children}
    </a>
  );
}

export default function PrivacyPage() {
  if (!isCloud) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0] antialiased">
      <div className="mx-auto max-w-3xl px-6 py-16">
        {/* Masthead */}
        <header className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 pb-10">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 transition-colors hover:text-[#FF3B00]"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
            Back to LiveFolio
          </Link>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF3B00]">
            § LEGAL — PRIVACY
          </div>
          <h1
            className="mt-4 font-black tracking-tighter text-5xl leading-[0.9] text-[#0F0F0D] dark:text-[#F4F4F0] md:text-7xl"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            Privacy
            <br />
            Policy
          </h1>
          <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
            Last updated: September 3, 2026
          </p>
        </header>

        {/* Content */}
        <div className="pb-24">
          <H2>1. Introduction</H2>
          <P>
            LiveFolio (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is committed to
            protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and
            safeguard your information when you use the LiveFolio cloud-hosted Service (&ldquo;the
            Service&rdquo;).
          </P>
          <P>
            The open-source (OSS) version of LiveFolio runs locally on your machine and does not
            transmit data to our servers. This Privacy Policy applies only to the cloud-hosted
            Service.
          </P>

          <H2>2. Information We Collect</H2>
          <H3>2.1 Information You Provide</H3>
          <UL>
            <LI>
              <Strong>Account Information:</Strong> When you register, we collect your name, email
              address, and organization name.
            </LI>
            <LI>
              <Strong>User Content:</Strong> HTML documents, files, and other content you create,
              upload, or publish through the Service.
            </LI>
            <LI>
              <Strong>Payment Information:</Strong> When you subscribe to a paid plan, our payment
              processor (Stripe) collects your payment card details. We do not store full card
              numbers on our servers.
            </LI>
            <LI>
              <Strong>Communications:</Strong> When you contact us for support or send us feedback,
              we collect your message and any information you choose to include.
            </LI>
            <LI>
              <Strong>Marketplace &mdash; sellers:</Strong> When you list folios for sale, we record
              your Seller Terms acceptance (the version and time you accepted) and, through Stripe
              Connect, the payout account information Stripe requires to pay you. We do not receive
              or store your full bank or payout details.
            </LI>
            <LI>
              <Strong>Marketplace &mdash; buyers:</Strong> When you buy a folio, Stripe processes the
              payment and we record the order (what you bought, when, and for how much) so we can
              deliver access. If you check out before creating an account, we keep the email you
              provided to attach your purchase to your account when you sign up.
            </LI>
            <LI>
              <Strong>Reports:</Strong> If you report content through the in-app report or
              legal@livefolio.cloud, we collect the reason, the details you provide, and your
              identity if you are signed in.
            </LI>
          </UL>
          <H3>2.2 Information Collected Automatically</H3>
          <UL>
            <LI>
              <Strong>Usage Data:</Strong> We collect information about how you interact with the
              Service, including pages visited, features used, and actions performed.
            </LI>
            <LI>
              <Strong>Technical Data:</Strong> We collect IP addresses, browser type and version,
              device information, and timestamps for requests made to the Service.
            </LI>
            <LI>
              <Strong>Folio Analytics:</Strong> For shared folios, we collect aggregate view counts
              and reaction metrics. We do not track individual viewer identities for public folios.
            </LI>
          </UL>

          <H2>3. How We Use Your Information</H2>
          <P>We use the collected information to:</P>
          <UL>
            <LI>Provide, maintain, and improve the Service.</LI>
            <LI>Process your subscription payments and manage your account.</LI>
            <LI>
              Send you transactional emails (account notifications, billing receipts, product
              updates).
            </LI>
            <LI>Respond to your support requests and feedback.</LI>
            <LI>
              Monitor and analyze usage patterns to improve performance and user experience.
            </LI>
            <LI>Detect, prevent, and address technical issues, fraud, or abuse.</LI>
            <LI>
              Fulfill marketplace purchases: deliver access to purchased folios, record purchase
              grants, and pay sellers through Stripe Connect.
            </LI>
            <LI>
              Enforce our Terms of Service: review reports, investigate infringing or abusive
              content, and take down content or suspend accounts that violate them.
            </LI>
          </UL>

          <H2>4. Data Sharing</H2>
          <P>
            We do not sell your personal information. We share your data only in the following
            circumstances:
          </P>
          <UL>
            <LI>
              <Strong>Service Providers:</Strong> We use third-party services to operate the Service
              — Supabase (database and authentication), Stripe (payment processing), and Resend
              (email delivery). These providers only receive the data necessary to perform their
              functions.
            </LI>
            <LI>
              <Strong>Legal Obligations:</Strong> We may disclose information if required by law,
              regulation, or valid legal process &mdash; including copyright or other takedown
              notices under our Terms of Service.
            </LI>
            <LI>
              <Strong>Marketplace transactions:</Strong> Payment card details are handled by Stripe
              and never stored by us. Sellers receive payout through Stripe Connect, and parties to
              a sale receive only the order information needed to fulfill it (what was bought, when,
              and delivery access). Your email is not shared with sellers.
            </LI>
            <LI>
              <Strong>Business Transfers:</Strong> In the event of a merger, acquisition, or sale of
              assets, your information may be transferred to the successor entity.
            </LI>
          </UL>

          <H2>5. Cookies</H2>
          <P>
            We use essential cookies for authentication and session management. These cookies are
            necessary for the Service to function and cannot be disabled. We do not use third-party
            tracking cookies for advertising purposes.
          </P>
          <P>
            You can configure your browser to reject cookies, but this may prevent you from using
            certain features of the Service.
          </P>

          <H2>6. Data Retention</H2>
          <P>
            We retain your account information and User Content for as long as your account is
            active. When you delete your account:
          </P>
          <UL>
            <LI>Your User Content is permanently deleted within 30 days.</LI>
            <LI>
              Account and billing records are retained for legal and audit purposes for a period of
              up to 7 years.
            </LI>
            <LI>Aggregate, anonymized data may be retained indefinitely.</LI>
          </UL>
          <P>Marketplace records are kept as required by law and to honor the transactions themselves:</P>
          <UL>
            <LI>
              <Strong>Purchase records:</Strong> Orders and access grants are retained for the life
              of the license or rental period you purchased (and longer where required by tax or
              audit law) so that buyers keep access and sellers can be paid.
            </LI>
            <LI>
              <Strong>Seller terms acceptance:</Strong> The record of your acceptance (version and
              time) is retained for legal and audit purposes.
            </LI>
            <LI>
              <Strong>Reports:</Strong> Content reports and takedown records are retained as long as
              needed to enforce our Terms and respond to legal requests.
            </LI>
          </UL>

          <H2>7. Data Security</H2>
          <P>
            We implement appropriate technical and organizational measures to protect your data,
            including:
          </P>
          <UL>
            <LI>Encryption in transit (TLS 1.3) and at rest (AES-256).</LI>
            <LI>Regular security audits and penetration testing.</LI>
            <LI>Access controls limiting employee access to production data.</LI>
            <LI>
              Incident response procedures with mandatory breach notification within 72 hours.
            </LI>
          </UL>

          <H2>8. Your Rights</H2>
          <P>
            Depending on your jurisdiction, you may have the following rights regarding your personal
            data:
          </P>
          <UL>
            <LI>
              <Strong>Access:</Strong> Request a copy of your personal data.
            </LI>
            <LI>
              <Strong>Rectification:</Strong> Correct inaccurate or incomplete data.
            </LI>
            <LI>
              <Strong>Erasure:</Strong> Request deletion of your personal data.
            </LI>
            <LI>
              <Strong>Portability:</Strong> Receive your data in a structured, machine-readable
              format.
            </LI>
            <LI>
              <Strong>Objection:</Strong> Object to certain processing activities.
            </LI>
          </UL>
          <P>
            To exercise these rights, contact us at{" "}
            <A href="mailto:privacy@livefolio.cloud">privacy@livefolio.cloud</A>. We will respond
            within 30 days.
          </P>

          <H2>9. International Data Transfers</H2>
          <P>
            LiveFolio Cloud is hosted on infrastructure provided by Supabase and may process your
            data in the United States or other jurisdictions. We ensure adequate safeguards are in
            place for international transfers in compliance with applicable data protection laws.
          </P>

          <H2>10. Children&apos;s Privacy</H2>
          <P>
            The Service is not intended for individuals under the age of 16. We do not knowingly
            collect personal information from children. If we become aware that a child has provided
            us with personal data, we will delete it promptly.
          </P>

          <H2>11. Changes to This Policy</H2>
          <P>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes via email or through the Service. Your continued use after changes take effect
            constitutes acceptance of the updated policy.
          </P>

          <H2>12. Contact</H2>
          <P>
            For questions about this Privacy Policy or to exercise your data rights, contact us at{" "}
            <A href="mailto:privacy@livefolio.cloud">privacy@livefolio.cloud</A>.
          </P>
        </div>
      </div>
    </div>
  );
}
