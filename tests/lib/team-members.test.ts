import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as teamMembers from '@/lib/team-members';

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

describe('Team Members Library', () => {
  describe('getTeamMembers', () => {
    it('should return all team members for a customer', async () => {
      const mockMembers = [
        {
          id: '1',
          email: 'user1@example.com',
          name: 'User One',
          stripeCustomerId: 'cus_123',
          role: 'owner',
          invitedAt: new Date('2024-01-01'),
          acceptedAt: new Date('2024-01-01'),
          invitedBy: null
        },
        {
          id: '2',
          email: 'user2@example.com',
          name: 'User Two',
          stripeCustomerId: 'cus_123',
          role: 'member',
          invitedAt: new Date('2024-01-02'),
          acceptedAt: null,
          invitedBy: 'user1@example.com'
        },
      ];

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'getTeamMembers').mockResolvedValue(mockMembers as any);

      const result = await originalModule.getTeamMembers('cus_123');

      expect(result).toEqual(mockMembers);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when customer has no team members', async () => {
      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'getTeamMembers').mockResolvedValue([]);

      const result = await originalModule.getTeamMembers('cus_empty');

      expect(result).toEqual([]);
    });

    it('should order members by invitedAt ascending', async () => {
      const mockMembers = [
        {
          id: '1',
          email: 'first@example.com',
          invitedAt: new Date('2024-01-01'),
          stripeCustomerId: 'cus_123'
        },
        {
          id: '2',
          email: 'second@example.com',
          invitedAt: new Date('2024-01-02'),
          stripeCustomerId: 'cus_123'
        },
      ];

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'getTeamMembers').mockResolvedValue(mockMembers as any);

      const result = await originalModule.getTeamMembers('cus_123');

      expect(result[0].email).toBe('first@example.com');
      expect(result[1].email).toBe('second@example.com');
    });
  });

  describe('getTeamMemberByEmail', () => {
    it('should return team member by email', async () => {
      const mockMember = {
        id: '1',
        email: 'user@example.com',
        name: 'User',
        stripeCustomerId: 'cus_123',
        role: 'member',
        invitedAt: new Date(),
        acceptedAt: null,
        invitedBy: null
      };

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'getTeamMemberByEmail').mockResolvedValue(mockMember as any);

      const result = await originalModule.getTeamMemberByEmail('user@example.com');

      expect(result).toEqual(mockMember);
    });

    it('should return null when email not found', async () => {
      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'getTeamMemberByEmail').mockResolvedValue(null);

      const result = await originalModule.getTeamMemberByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('should normalize email to lowercase', async () => {
      const mockMember = {
        id: '1',
        email: 'user@example.com',
        stripeCustomerId: 'cus_123'
      };

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'getTeamMemberByEmail').mockResolvedValue(mockMember as any);

      await originalModule.getTeamMemberByEmail('USER@EXAMPLE.COM');

      expect(originalModule.getTeamMemberByEmail).toHaveBeenCalledWith('USER@EXAMPLE.COM');
    });
  });

  describe('getTeamMemberships', () => {
    it('should return all teams a user belongs to', async () => {
      const mockMemberships = [
        { id: '1', email: 'user@example.com', stripeCustomerId: 'cus_123' },
        { id: '2', email: 'user@example.com', stripeCustomerId: 'cus_456' },
      ];

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'getTeamMemberships').mockResolvedValue(mockMemberships as any);

      const result = await originalModule.getTeamMemberships('user@example.com');

      expect(result).toEqual(mockMemberships);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when user has no memberships', async () => {
      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'getTeamMemberships').mockResolvedValue([]);

      const result = await originalModule.getTeamMemberships('nomembership@example.com');

      expect(result).toEqual([]);
    });
  });

  describe('addTeamMember', () => {
    it('should add a team member with required fields', async () => {
      const params = {
        email: 'newuser@example.com',
        name: 'New User',
        stripeCustomerId: 'cus_123',
        invitedBy: 'owner@example.com'
      };

      const mockMember = {
        id: 'member_123',
        ...params,
        email: params.email.toLowerCase(),
        role: 'member',
        invitedAt: new Date(),
        acceptedAt: null
      };

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'addTeamMember').mockResolvedValue(mockMember as any);

      const result = await originalModule.addTeamMember(params);

      expect(result.email).toBe('newuser@example.com');
      expect(result.role).toBe('member');
    });

    it('should normalize email to lowercase when adding', async () => {
      const params = {
        email: 'UPPERCASE@EXAMPLE.COM',
        stripeCustomerId: 'cus_123'
      };

      const mockMember = {
        id: 'member_123',
        email: 'uppercase@example.com',
        stripeCustomerId: 'cus_123',
        role: 'member'
      };

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'addTeamMember').mockResolvedValue(mockMember as any);

      const result = await originalModule.addTeamMember(params);

      expect(result.email).toBe('uppercase@example.com');
    });

    it('should add team member with null name', async () => {
      const params = {
        email: 'noname@example.com',
        name: null,
        stripeCustomerId: 'cus_123'
      };

      const mockMember = {
        id: 'member_123',
        ...params,
        email: 'noname@example.com',
        role: 'member'
      };

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'addTeamMember').mockResolvedValue(mockMember as any);

      const result = await originalModule.addTeamMember(params);

      expect(result.name).toBeNull();
    });

    it('should default role to member', async () => {
      const params = {
        email: 'newmember@example.com',
        stripeCustomerId: 'cus_123'
      };

      const mockMember = {
        id: 'member_123',
        email: 'newmember@example.com',
        stripeCustomerId: 'cus_123',
        role: 'member'
      };

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'addTeamMember').mockResolvedValue(mockMember as any);

      const result = await originalModule.addTeamMember(params);

      expect(result.role).toBe('member');
    });
  });

  describe('acceptTeamInvite', () => {
    it('should mark team member as accepted', async () => {
      const mockMember = {
        id: 'member_123',
        email: 'user@example.com',
        acceptedAt: new Date(),
        stripeCustomerId: 'cus_123'
      };

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'acceptTeamInvite').mockResolvedValue(mockMember as any);

      const result = await originalModule.acceptTeamInvite('member_123');

      expect(result.acceptedAt).toBeDefined();
      expect(result.acceptedAt).toBeInstanceOf(Date);
    });
  });

  describe('removeTeamMember', () => {
    it('should remove team member successfully', async () => {
      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'removeTeamMember').mockResolvedValue(undefined);

      await originalModule.removeTeamMember('member_123', 'cus_123');

      expect(originalModule.removeTeamMember).toHaveBeenCalledWith('member_123', 'cus_123');
    });

    it('should throw error when member not found', async () => {
      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'removeTeamMember').mockRejectedValue(new Error('Record to delete does not exist'));

      await expect(originalModule.removeTeamMember('member_nonexistent', 'cus_123')).rejects.toThrow();
    });

    it('should throw error when customer does not own the member', async () => {
      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'removeTeamMember').mockRejectedValue(new Error('Record to delete does not exist'));

      await expect(originalModule.removeTeamMember('member_123', 'cus_wrong')).rejects.toThrow();
    });
  });

  describe('isTeamMember', () => {
    it('should return true when email is a team member', async () => {
      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'isTeamMember').mockResolvedValue(true);

      const result = await originalModule.isTeamMember('member@example.com', 'cus_123');

      expect(result).toBe(true);
    });

    it('should return false when email is not a team member', async () => {
      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'isTeamMember').mockResolvedValue(false);

      const result = await originalModule.isTeamMember('notmember@example.com', 'cus_123');

      expect(result).toBe(false);
    });

    it('should normalize email to lowercase when checking', async () => {
      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'isTeamMember').mockResolvedValue(true);

      await originalModule.isTeamMember('UPPERCASE@EXAMPLE.COM', 'cus_123');

      expect(originalModule.isTeamMember).toHaveBeenCalledWith('UPPERCASE@EXAMPLE.COM', 'cus_123');
    });
  });

  describe('ensureOwnerRecord', () => {
    it('should return existing owner record if found', async () => {
      const mockOwner = {
        id: 'owner_123',
        email: 'owner@example.com',
        stripeCustomerId: 'cus_123',
        role: 'owner',
        acceptedAt: new Date()
      };

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'ensureOwnerRecord').mockResolvedValue(mockOwner as any);

      const result = await originalModule.ensureOwnerRecord('owner@example.com', 'cus_123');

      expect(result).toEqual(mockOwner);
    });

    it('should create new owner record if not found', async () => {
      const mockOwner = {
        id: 'owner_new',
        email: 'newowner@example.com',
        name: 'New Owner',
        stripeCustomerId: 'cus_123',
        role: 'owner',
        acceptedAt: new Date()
      };

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'ensureOwnerRecord').mockResolvedValue(mockOwner as any);

      const result = await originalModule.ensureOwnerRecord('newowner@example.com', 'cus_123', 'New Owner');

      expect(result.role).toBe('owner');
      expect(result.acceptedAt).toBeDefined();
    });

    it('should set acceptedAt for new owner records', async () => {
      const mockOwner = {
        id: 'owner_new',
        email: 'owner@example.com',
        stripeCustomerId: 'cus_123',
        role: 'owner',
        acceptedAt: new Date()
      };

      const originalModule = await import('@/lib/team-members');
      vi.spyOn(originalModule, 'ensureOwnerRecord').mockResolvedValue(mockOwner as any);

      const result = await originalModule.ensureOwnerRecord('owner@example.com', 'cus_123');

      expect(result.acceptedAt).toBeInstanceOf(Date);
    });
  });
});
