/**
 * Terms of Service page — /tos (v2 design language)
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
  title: "Terms of Service — LiveFolio",
  description:
    "LiveFolio Terms of Service — service description, user obligations, marketplace listings and seller responsibilities, copyright/DMCA, intellectual property, and limitations of liability.",
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

export default function TosPage() {
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
            § LEGAL — TERMS
          </div>
          <h1
            className="mt-4 font-black tracking-tighter text-5xl leading-[0.9] text-[#0F0F0D] dark:text-[#F4F4F0] md:text-7xl"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            Terms of
            <br />
            Service
          </h1>
          <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
            Last updated: September 3, 2026
          </p>
        </header>

        {/* Content */}
        <div className="pb-24">
          <H2>1. Acceptance of Terms</H2>
          <P>
            By accessing or using LiveFolio (&ldquo;the Service&rdquo;), you agree to be bound by
            these Terms of Service (&ldquo;Terms&rdquo;). If you do not agree to these Terms, you may
            not access or use the Service. These Terms constitute a legally binding agreement between
            you and LiveFolio (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;).
          </P>

          <H2>2. Description of Service</H2>
          <P>
            LiveFolio is an AI-native publishing platform that allows users to create, version,
            share, and collect feedback on interactive HTML documents (&ldquo;Folios&rdquo;). The
            Service includes a web-based studio editor, a dashboard for managing folios, an MCP
            server for AI agent integration, sharing infrastructure, and a public discovery index
            (&ldquo;Explore&rdquo;) where creators may opt to list published folios — some free,
            some offered for sale by their creators.
          </P>
          <P>
            LiveFolio is a hosting and facilitation intermediary. Creators publish, list, and sell
            their own work; buyers purchase from the creators, not from LiveFolio. See Section 7
            (Marketplace, Listings &amp; Seller Responsibilities).
          </P>
          <P>LiveFolio is available in two modes:</P>
          <UL>
            <LI>
              <Strong>OSS Mode</Strong> — A free, open-source, self-hosted version with local
              file-based storage and no centralized authentication.
            </LI>
            <LI>
              <Strong>Cloud Mode</Strong> — A hosted, multi-tenant version with organization
              management, authentication, and paid subscription tiers.
            </LI>
          </UL>
          <P>
            These Terms apply primarily to the cloud-hosted Service. The OSS version is governed by
            its open-source license.
          </P>

          <H2>3. User Obligations</H2>
          <P>As a user of the Service, you agree to:</P>
          <UL>
            <LI>
              Provide accurate and complete registration information and keep it up to date.
            </LI>
            <LI>
              Maintain the confidentiality of your account credentials and notify us immediately of
              any unauthorized use.
            </LI>
            <LI>Use the Service in compliance with all applicable laws and regulations.</LI>
            <LI>
              Not use the Service to distribute malware, spam, or content that is illegal, harmful,
              or infringes on others&apos; rights.
            </LI>
            <LI>
              Ensure you have all necessary rights before publishing, listing, or selling content —
              including content generated with the assistance of AI tools. You are responsible for
              what you publish and sell, not LiveFolio.
            </LI>
            <LI>
              Not list or sell content that impersonates, copies, or substantially reproduces
              third-party websites, brands, copyrighted works, logos, fonts, or other proprietary
              assets without authorization.
            </LI>
            <LI>
              Not attempt to gain unauthorized access to the Service, other accounts, or our systems.
            </LI>
          </UL>

          <H2>4. Intellectual Property</H2>
          <P>
            <Strong>Your Content:</Strong> You retain all rights to the HTML documents, files, and
            other content you upload, create, or publish through the Service (&ldquo;User
            Content&rdquo;). By publishing User Content, you grant us a limited license to host,
            display, and distribute it solely for the purpose of providing the Service.
          </P>
          <P>
            <Strong>Sales do not transfer ownership to us:</Strong> Listing content for sale does
            not give LiveFolio ownership of it. When a buyer purchases your listed folio, the rights
            they receive are exactly what your listing&apos;s license grants — nothing more. You set
            that license and are responsible for honoring it.
          </P>
          <P>
            <Strong>Our IP:</Strong> The LiveFolio platform, including its code, design, branding,
            and documentation, is protected by copyright and other intellectual property laws. You
            may not copy, modify, or reverse-engineer the Service except as permitted by its
            open-source license (for OSS components).
          </P>

          <H2>5. Third-Party Services</H2>
          <P>
            LiveFolio Cloud Mode integrates with third-party services including Supabase (database
            and authentication), Stripe (payment processing), and Resend (email delivery). Use of
            these services is subject to their respective terms and privacy policies.
          </P>

          <H2>6. Payment and Billing (Cloud Mode)</H2>
          <P>
            Paid subscription tiers are billed monthly or annually as selected during sign-up. You
            are responsible for all charges incurred under your account. Subscription fees are
            non-refundable except as required by law. We reserve the right to change pricing with 30
            days&apos; notice.
          </P>

          <H2>7. Marketplace, Listings &amp; Seller Responsibilities (Cloud Mode)</H2>
          <P>
            <Strong>Who sells.</Strong> Creators may opt to list published folios in the Explore
            discovery index and, where a price is set, sell them. LiveFolio is <Strong>not a
            party to any sale</Strong>. LiveFolio provides hosting, discovery, payment
            facilitation (through Stripe), and license metadata relay — it is the seller who makes
            the sale, grants the license, and is responsible for the content and its delivery.
          </P>
          <P>
            <Strong>Accepting the Seller Terms.</Strong> Listing content requires the workspace
            owner to accept these Seller Terms (recorded on the account) and, for each listing, to
            affirm: <em>&ldquo;I own this content or have the necessary rights/licenses to sell and
            distribute it.&rdquo;</em> Acceptance is a precondition to listing — not a verification
            by LiveFolio.
          </P>
          <P>
            <Strong>Seller representations and warranty.</Strong> By listing content for sale you
            represent and warrant that you: own the content or hold all necessary rights and
            licenses — including for every component, image, font, code library, logo, and
            third-party asset within it; that the content does not infringe or misappropriate any
            third party&apos;s intellectual property, trademark, trade dress, or other rights; that
            it is not illegal and does not violate these Terms; and that the listing metadata
            (category, tags, description, license, price) is accurate.
          </P>
          <P>
            <Strong>No verification.</Strong> Unless we state otherwise, LiveFolio does not
            pre-review, verify, or &ldquo;license-check&rdquo; listed content. Listings appear
            because their creators listed them — buyers acquire from sellers at their own risk,
            subject to the license the seller attached.
          </P>
          <P>
            <Strong>Licenses are between buyer and seller.</Strong> The license displayed on a
            listing is the seller&apos;s license. LiveFolio merely records and relays it. Disputes
            about a license, the quality of purchased content, or a sale (other than payment
            processing errors) are resolved between buyer and seller. We may assist in good faith
            but are not responsible for the outcome.
          </P>
          <P>
            <Strong>Fees.</Strong> A platform fee (10% of each sale, unless otherwise shown) is
            deducted before seller payouts. Prices are set by sellers. Sellers are responsible for
            applicable taxes on their sales.
          </P>
          <P>
            <Strong>Content takedowns and delinquent sellers.</Strong> We may remove, hide, or
            unpublish listings or User Content, and we may suspend or terminate accounts — with or
            without notice — when we reasonably believe the content or conduct is delinquent:
            infringing or allegedly infringing (see Section 8, Copyright &amp; DMCA), illegal,
            abusive, deceptive, spam, in violation of these Terms, or otherwise harmful to the
            Service or other users. Hidden content and suspended accounts are blocked from public
            discovery, new sales, and access, as applicable. We may also cancel pending payouts
            pending review. This right is in addition to Section 9 (Termination).
          </P>
          <P>
            <Strong>Refunds.</Strong> Payment processing errors are refunded by LiveFolio. All
            other refund requests are handled between buyer and seller under the license and any
            terms attached to the listing. We may issue refunds and charge sellers where required
            by law or our payment processors.
          </P>

          <H2>8. Copyright &amp; DMCA (Cloud Mode)</H2>
          <P>
            We respect intellectual property rights and expect our users to do the same. Content
            that infringes copyright, trademark, or other proprietary rights is prohibited.
          </P>
          <UL>
            <LI>
              <Strong>Report:</Strong> If you believe content on the Service infringes your rights,
              file an in-app report or send a notice to{" "}
              <A href="mailto:legal@livefolio.cloud">legal@livefolio.cloud</A> with enough
              information for us to locate the content and evaluate your claim (a description of
              the work, the URL or folio, and your ownership or authorization).
            </LI>
            <LI>
              <Strong>Takedown:</Strong> Upon a valid notice we will act promptly — including
              hiding the content pending review — and notify the affected user.
            </LI>
            <LI>
              <Strong>Repeat infringers:</Strong> Users who repeatedly post infringing content may
              have their content removed and their accounts suspended or terminated.
            </LI>
            <LI>
              <Strong>Counter-notices:</Strong> If you believe content you posted was removed in
              error, you may respond with a counter-notice to{" "}
              <A href="mailto:legal@livefolio.cloud">legal@livefolio.cloud</A>.
            </LI>
          </UL>

          <H2>9. Limitations of Liability</H2>
          <P>
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTIES OF ANY KIND, EITHER
            EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, LIVEFOLIO SHALL NOT BE LIABLE
            FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM
            YOUR USE OF THE SERVICE.
          </P>
          <P>
            In particular, LiveFolio is not liable for the content, quality, legality, or
            infringement of anything sold through the marketplace, for disputes between buyers and
            sellers, or for a seller&apos;s failure to honor a license. Responsibility lies with the
            person who listed the content.
          </P>
          <P>
            Our total liability for any claim arising from these Terms or the Service shall not
            exceed the amount you paid us in the 12 months preceding the claim.
          </P>

          <H2>10. Termination</H2>
          <P>
            You may stop using the Service at any time. We may suspend or terminate your access to
            the Service if you violate these Terms (including as a repeat infringer or delinquent
            seller, see Section 7) or if your use poses a risk to the Service or other users. Upon
            termination, your right to access the Service ceases immediately. We will retain your
            User Content for 30 days after termination, during which you may export it. Suspended
            sellers may not list, sell, or access payouts while suspended.
          </P>

          <H2>11. Changes to These Terms</H2>
          <P>
            We may update these Terms from time to time. We will notify you of material changes via
            email or through the Service. Your continued use of the Service after changes take effect
            constitutes acceptance of the updated Terms. Changes to the Seller Terms require
            re-acceptance before you list new content.
          </P>

          <H2>12. Contact</H2>
          <P>
            For questions about these Terms, copyright notices, or takedown requests, contact us at{" "}
            <A href="mailto:legal@livefolio.cloud">legal@livefolio.cloud</A>.
          </P>
        </div>
      </div>
    </div>
  );
}
