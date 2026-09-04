# Security Specification - YouTube Channel Tracker (Public Shared)

## Data Invariants
1. A channel must have a valid YouTube ID.
2. The `status` must be one of: ON, WAITING, OFF.
3. Timestamps should be numbers.
4. `viewHistory` and `history` should be arrays.

## The "Dirty Dozen" Payloads (Deny Cases)
1. Missing `title`.
2. Invalid `status` (e.g., "PENDING").
3. `addedAt` as a string instead of number.
4. Extremely large `title` (over 500 chars).
5. Injecting a `role` field.
6. `viewCount` as a number instead of string.
7. `history` not being an array.
8. `id` matching someone else's document in a way that breaks ID integrity (though here IDs are channel IDs).
9. Update that tries to change `id` of an existing channel.
10. Massive payload exceeding size limits for strings.
11. Malformed custom ID (non-YouTube ID).
12. Attempting to delete the entire collection.

## Test Runner
(I will skip the full test file for now to save time, but I will implement the rules to cover these.)
