import PageTracker from "@/components/PageTracker";

// PA-416: /account is the sign-up/login page but lives outside the
// (marketing) route group, so it (and /account/settings) never mounted
// PageTracker and never recorded a pageView — "Visited" in the marketing
// funnel undercounted anyone who landed directly on the sign-up page.
export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PageTracker />
      {children}
    </>
  );
}
