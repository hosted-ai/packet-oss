# Library Unit Tests

This directory contains comprehensive unit tests for the core library modules.

## Test Coverage

### 1. SSH Keys Tests (`ssh-keys.test.ts`)
**26 tests covering:**
- `validatePublicKey()` - 10 tests
  - Valid RSA, ED25519, ECDSA keys
  - Invalid format handling
  - Unsupported key types
  - Base64 validation
  - Whitespace trimming
  
- `calculateFingerprint()` - 5 tests
  - MD5 fingerprint generation
  - Consistency checks
  - Uniqueness verification
  - Error handling
  
- `getSSHKeys()` - 2 tests
  - Fetch all keys for customer
  - Empty result handling
  
- `addSSHKey()` - 5 tests
  - Valid key addition
  - Invalid key rejection
  - Whitespace trimming
  - Unsupported type handling
  
- `deleteSSHKey()` - 3 tests
  - Successful deletion
  - Non-existent key handling
  - Ownership verification
  
- `getSSHKey()` - 3 tests
  - Fetch single key
  - Not found handling
  - Ownership checks

### 2. Team Members Tests (`team-members.test.ts`)
**22 tests covering:**
- `getTeamMembers()` - 3 tests
  - Fetch all team members
  - Empty teams
  - Ordering by invite date
  
- `getTeamMemberByEmail()` - 3 tests
  - Find by email
  - Not found handling
  - Email normalization
  
- `getTeamMemberships()` - 2 tests
  - All teams for user
  - Empty memberships
  
- `addTeamMember()` - 4 tests
  - Add with required fields
  - Email normalization
  - Null name handling
  - Default role assignment
  
- `acceptTeamInvite()` - 1 test
  - Mark invitation as accepted
  
- `removeTeamMember()` - 3 tests
  - Successful removal
  - Not found handling
  - Ownership verification
  
- `isTeamMember()` - 3 tests
  - Member check (true/false)
  - Email normalization
  
- `ensureOwnerRecord()` - 3 tests
  - Return existing owner
  - Create new owner
  - Auto-accept owner

### 3. API Keys Tests (`api-keys.test.ts`)
**28 tests covering:**
- `generateApiKey()` - 5 tests
  - Correct prefix format
  - Uniqueness
  - Hash generation
  - Prefix length
  - Base64url encoding
  
- `hashApiKey()` - 4 tests
  - Consistent hashing
  - Different hashes for different keys
  - SHA256 format
  - Empty string handling
  
- `authenticateApiKey()` - 7 tests
  - Missing header
  - Invalid format
  - Invalid key format
  - Valid authentication
  - Revoked key
  - Expired key
  - Bearer token extraction
  
- `hasScope()` - 7 tests
  - Exact scope match
  - Missing scope
  - Wildcard scope (*)
  - Prefix wildcard (e.g., instances:*)
  - Non-matching prefix
  - Multiple scopes
  - Empty scopes
  
- `requireScope()` - 5 tests
  - Valid scope
  - Missing scope
  - Wildcard scope
  - Prefix wildcard
  - Error message validation

### 4. Referral Tests (`referral.test.ts`)
**33 tests covering:**
- **Code Generator Functions:**
  - `generateReferralCode()` - 4 tests
  - `isValidCodeFormat()` - 4 tests
  - `normalizeCode()` - 4 tests
  
- **Referral Management:**
  - `getReferralSettings()` - 2 tests
  - `getOrCreateReferralCode()` - 3 tests
  - `validateReferralCode()` - 4 tests
  - `applyReferralCode()` - 4 tests
  - `getReferralStats()` - 2 tests
  - `checkAndProcessReferralQualification()` - 4 tests
  - `getReferralProgramStats()` - 1 test

### 5. Voucher Tests (`voucher.test.ts`)
**31 tests covering:**
- `validateVoucherPublic()` - 7 tests
  - Valid voucher
  - Invalid code
  - Inactive voucher
  - Not-yet-started voucher
  - Expired voucher
  - Max redemptions
  - Code normalization
  
- `validateVoucher()` - 5 tests
  - Valid with sufficient top-up
  - Below minimum top-up
  - Already used by customer
  - No minimum requirement
  - Per-customer limit
  
- `processVoucherRedemption()` - 4 tests
  - Successful redemption
  - Invalid voucher
  - Failed validation
  - Session ID handling
  
- `createVoucher()` - 4 tests
  - Required fields
  - Code normalization
  - Duplicate code handling
  - All optional fields
  
- `updateVoucher()` - 2 tests
  - Update fields
  - Partial updates
  
- `deleteVoucher()` - 3 tests
  - Delete without redemptions
  - Cannot delete with redemptions
  - Not found handling
  
- `getAllVouchers()` - 2 tests
  - Fetch all vouchers
  - Empty list
  
- `getVoucherWithRedemptions()` - 2 tests
  - With redemptions
  - Not found
  
- `getVoucherStats()` - 2 tests
  - Comprehensive statistics
  - Monthly statistics

## Running Tests

```bash
# Run all library tests
pnpm test:unit tests/lib/

# Run specific test file
pnpm test:unit tests/lib/ssh-keys.test.ts

# Run with coverage
pnpm test:coverage

# Watch mode
pnpm test:watch
```

## Test Strategy

- **Unit Testing**: Tests focus on individual functions in isolation
- **Mocking**: Prisma and external dependencies are mocked
- **Happy Path**: All tests include successful scenarios
- **Error Handling**: Comprehensive error case coverage
- **Edge Cases**: Empty inputs, invalid data, boundary conditions
- **Coverage**: 8-10+ tests per file with 140 total tests

## Key Testing Patterns

1. **Mocking Prisma**: Using `vi.mock()` to mock database operations
2. **Request Mocking**: Creating mock Request objects for API authentication
3. **Async Testing**: All database operations tested with async/await
4. **Error Validation**: Checking both error occurrence and messages
5. **Data Validation**: Verifying output format and structure
6. **Normalization**: Testing case conversion and whitespace handling

## Notes

- Tests do not require a live database connection
- All external dependencies are mocked
- Tests are isolated and can run in parallel
- Each test file can be run independently
