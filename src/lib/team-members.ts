import { TeamMember } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Get all team members for a Stripe customer
export async function getTeamMembers(stripeCustomerId: string): Promise<TeamMember[]> {
  return prisma.teamMember.findMany({
    where: { stripeCustomerId },
    orderBy: { invitedAt: "asc" },
  });
}

// Get a team member by email (for login - may belong to multiple teams)
export async function getTeamMemberByEmail(email: string): Promise<TeamMember | null> {
  return prisma.teamMember.findFirst({
    where: { email: email.toLowerCase() },
    orderBy: { invitedAt: "desc" }, // Return most recent if multiple
  });
}

// Get all teams a user belongs to (as a member)
export async function getTeamMemberships(email: string): Promise<TeamMember[]> {
  return prisma.teamMember.findMany({
    where: { email: email.toLowerCase() },
    orderBy: { invitedAt: "desc" },
  });
}

// Add a new team member (invite)
export async function addTeamMember(params: {
  email: string;
  name?: string | null;
  stripeCustomerId: string;
  invitedBy?: string;
}): Promise<TeamMember> {
  return prisma.teamMember.create({
    data: {
      email: params.email.toLowerCase(),
      name: params.name,
      stripeCustomerId: params.stripeCustomerId,
      role: "member",
      invitedBy: params.invitedBy,
    },
  });
}

// Mark team member as having accepted (first login)
export async function acceptTeamInvite(memberId: string): Promise<TeamMember> {
  return prisma.teamMember.update({
    where: { id: memberId },
    data: { acceptedAt: new Date() },
  });
}

// Remove a team member
export async function removeTeamMember(
  memberId: string,
  stripeCustomerId: string
): Promise<void> {
  await prisma.teamMember.delete({
    where: {
      id: memberId,
      stripeCustomerId, // Ensure ownership
    },
  });
}

// Check if email is already a team member
export async function isTeamMember(
  email: string,
  stripeCustomerId: string
): Promise<boolean> {
  const member = await prisma.teamMember.findUnique({
    where: {
      email_stripeCustomerId: {
        email: email.toLowerCase(),
        stripeCustomerId,
      },
    },
  });
  return member !== null;
}

// Get or create owner record (when owner first accesses team management)
export async function ensureOwnerRecord(
  email: string,
  stripeCustomerId: string,
  name?: string
): Promise<TeamMember> {
  const existing = await prisma.teamMember.findUnique({
    where: {
      email_stripeCustomerId: {
        email: email.toLowerCase(),
        stripeCustomerId,
      },
    },
  });

  if (existing) {
    return existing;
  }

  // Create owner record
  return prisma.teamMember.create({
    data: {
      email: email.toLowerCase(),
      name,
      stripeCustomerId,
      role: "owner",
      acceptedAt: new Date(), // Owner is implicitly accepted
    },
  });
}
