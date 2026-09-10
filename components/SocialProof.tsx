'use client';

import { useEffect, useState } from 'react';
import { Star, Users, Download, GithubIcon as Github } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/* Social Proof Widgets                                                        */
/*                                                                              */
/* Reusable social proof components: testimonials, stats counter, logo wall,  */
/* GitHub stars counter. Used on landing page, pricing, and marketing pages.  */
/* -------------------------------------------------------------------------- */

interface Testimonial {
  name: string;
  role: string;
  company: string;
  quote: string;
  avatar?: string;
}

const DEFAULT_TESTIMONIALS: Testimonial[] = [
  {
    name: '—',
    role: 'Developer',
    company: '—',
    quote: 'Connect the testimonial system to your database to display real customer quotes here.',
  },
];

export function TestimonialCard({ testimonial }: { testimonial: Testimonial }) {
  return (
    <div className="rounded-2xl border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-white dark:bg-[#171714] p-6 shadow-sm">
      <p className="text-sm text-[#0F0F0D]/80 dark:text-[#F4F4F0]/60 italic mb-4">
        &ldquo;{testimonial.quote}&rdquo;
      </p>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10 flex items-center justify-center text-xs font-bold text-[#0F0F0D]/60">
          {testimonial.name[0]}
        </div>
        <div>
          <p className="text-sm font-medium text-[#0F0F0D] dark:text-[#F4F4F0]/90">{testimonial.name}</p>
          <p className="text-xs text-[#0F0F0D]/70">{testimonial.role}, {testimonial.company}</p>
        </div>
      </div>
    </div>
  );
}

export function TestimonialsGrid({ testimonials }: { testimonials?: Testimonial[] }) {
  const items = testimonials?.length ? testimonials : DEFAULT_TESTIMONIALS;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {items.map((t, i) => (
        <TestimonialCard key={i} testimonial={t} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stats Counter                                                               */
/* -------------------------------------------------------------------------- */

interface Stat {
  label: string;
  value: string;
  icon: React.ReactNode;
}

const DEFAULT_STATS: Stat[] = [
  { label: 'Folios Published', value: '—', icon: <Download size={18} /> },
  { label: 'Active Users', value: '—', icon: <Users size={18} /> },
  { label: 'GitHub Stars', value: '0', icon: <Star size={18} /> },
  { label: 'AI Agents Connected', value: '—', icon: <Star size={18} /> },
];

export function StatsBar({ stats }: { stats?: Stat[] }) {
  const items = stats?.length ? stats : DEFAULT_STATS;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((s, i) => (
        <div key={i} className="text-center p-4">
          <div className="flex items-center justify-center gap-2 mb-2 text-[#0F0F0D]/60">
            {s.icon}
            <span className="text-2xl font-bold text-[#0F0F0D] dark:text-[#F4F4F0] tabular-nums">{s.value}</span>
          </div>
          <p className="text-xs text-[#0F0F0D]/70 dark:text-[#F4F4F0]/60">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GitHub Stars Counter                                                        */
/* -------------------------------------------------------------------------- */

export function GitHubStarsCounter({ repo = 'LiveFolio-Cloud/LiveFolio-oss' }: { repo?: string }) {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${repo}`)
      .then((r) => r.json())
      .then((d) => setStars(d.stargazers_count ?? 0))
      .catch(() => setStars(0));
  }, [repo]);

  if (stars === null) return null;

  return (
    <a
      href={`https://github.com/${repo}`}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-white dark:bg-[#171714] shadow-sm hover:border-[#FF3B00] transition-colors"
    >
      <Github size={16} />
      <span className="text-sm font-medium text-[#0F0F0D]/90 dark:text-[#F4F4F0]/70">Star us on GitHub</span>
      <span className="text-sm font-bold text-[#0F0F0D] dark:text-[#F4F4F0] tabular-nums">{stars}</span>
      <Star size={14} className="text-amber-400" />
    </a>
  );
}

/* -------------------------------------------------------------------------- */
/* Logo Wall                                                                   */
/* -------------------------------------------------------------------------- */

interface Logo {
  name: string;
  url?: string;
}

export function LogoWall({ logos }: { logos?: Logo[] }) {
  if (!logos?.length) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-[#0F0F0D]/60 dark:text-[#F4F4F0]/50">
          Used by teams everywhere. Add your customers&apos; logos to build trust.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-8 opacity-50">
      {logos.map((l, i) => (
        <span key={i} className="text-sm font-bold text-[#0F0F0D]/60 dark:text-[#F4F4F0]/50">{l.name}</span>
      ))}
    </div>
  );
}
