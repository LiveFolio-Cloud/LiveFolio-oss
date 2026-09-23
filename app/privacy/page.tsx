/**
 * OSS stub for app/privacy/page.tsx — the /privacy route in a self-hosted install.
 *
 * Same shape and the same reasoning as app/tos/page.oss.tsx. The Cloud page is
 * the hosted Privacy Policy, and parts of it describe the commercial surface:
 * seller onboarding, payout handling, and the third-party payment processor as
 * a data recipient. Those describe a service this repo does not operate — a
 * self-hosted instance has no marketplace, no payment rails and no seller
 * payouts — so they should not be published as though they applied to it.
 *
 * The route is KEPT rather than deleted, exactly as it already behaved: the
 * Cloud page short-circuits with `if (!isCloud) redirect("/")` (page.tsx:75-76)
 * before rendering a paragraph, so OSS has always sent /privacy to the landing
 * page. Footer links keep working. What changes here is only that the policy
 * text is no longer compiled into the OSS bundle, where it was reachable by
 * reading the build output rather than by visiting the route.
 *
 * A self-hosting operator publishes their own privacy notice; it is not
 * LiveFolio's to impose one.
 */
import { redirect } from "next/navigation";

export default function PrivacyPage() {
  redirect("/");
}
