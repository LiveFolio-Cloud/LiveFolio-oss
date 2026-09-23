/**
 * OSS stub for app/tos/page.tsx — the /tos route in a self-hosted install.
 *
 * The Cloud page is the hosted Terms of Service. Most of it is ordinary
 * contract text, but section 7 states the commercial terms of the marketplace:
 * the platform's take rate on each sale, that payouts are deducted before they
 * reach the seller, and how sales and refunds are settled. Those are terms for
 * a service this repo does not operate — a self-hosted instance has no
 * marketplace, no payment rails and no seller payouts — so they must not be
 * published as though they applied.
 *
 * The route is KEPT rather than deleted, exactly as it already behaved: the
 * Cloud page short-circuits with `if (!isCloud) redirect("/")` before it
 * renders a single paragraph, so OSS has always sent /tos to the landing page.
 * Footer links to it therefore keep working. What changes here is only that
 * the Terms text is no longer compiled into the OSS bundle, where it was
 * reachable by reading the build output rather than by visiting the route.
 *
 * A self-hosting operator sets their own terms; they are not LiveFolio's to
 * impose.
 */
import { redirect } from "next/navigation";

export default function TermsOfServicePage() {
  redirect("/");
}
