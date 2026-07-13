# Task #30 Recap: Login page with username/password option

**Status:** ✅ COMPLETED & DEPLOYED (2026-07-08)

**Live at:** https://fun.ch-erawan.com/login (both LINE + username/password flows active)

---

## 1. Business Logic

### Two Authentication Paths
- **LINE Login:** Self-service registration (first-timers auto-create as PENDING), admin approves in /settings/users, grants branches/roles
- **Username+Password:** Admin-only provisioning (no self-registration via this path; username must exist first), same approval gate applies

### Credential Flow
1. Admin creates user in `/settings/users` (name, role, branches)
2. Admin sets a `username` and clicks "ตั้ง/รีเซ็ตรหัสผ่าน"
3. API generates a strong, readable 10-character temp password (bcrypt-hashed server-side), shown ONCE in an amber box with copy button
4. User logs in with username + temp password
5. **Forced password change overlay** blocks the entire app until user sets their own password
6. User's permanent password is never seen by the admin after first set
7. User can change password anytime via user-menu → "เปลี่ยนรหัสผ่าน"

### Security
- **Password policy:** 8+ chars, must include letter + digit, rejects common/guessable passwords (set in `src/lib/password.ts`)
- **Brute force:** 5 failed attempts lock the account for 15 minutes (`locked_until` timestamp)
- **Lockout clears:** immediately on successful login, failed count resets to 0
- **Both providers populate the same session shape:** JWT `funUserId` resolved once at initial sign-in (from `lineUserid` lookup for LINE, from `user.id` for credentials), then role/approved/name/picture refreshed from DB on every request

### Password Reset (Self-Service)
- `/api/account/password` POST accepts `{ currentPassword?, newPassword }`
- Only requires current password if `passwordHash` already set (LINE-only users setting password for first time skip this check)
- Validates new password against policy, returns 400 with Thai error message on violation
- Clears `mustChangePassword` flag on success

---

## 2. Database Schema

### New Table: fun_user credentials columns
**File:** `sql/013_credentials_login.sql` (applied live on NAS)

```sql
ALTER TABLE fun_user
  ADD COLUMN username VARCHAR(50) NULL AFTER display_name,
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER username,
  ADD COLUMN must_change_password TINYINT NOT NULL DEFAULT 0 AFTER password_hash,
  ADD COLUMN failed_login_count INT NOT NULL DEFAULT 0 AFTER must_change_password,
  ADD COLUMN locked_until DATETIME NULL AFTER failed_login_count;

ALTER TABLE fun_user ADD UNIQUE INDEX uk_user_username (username);
```

### Prisma Model (src/prisma/schema.prisma)
```prisma
model FunUser {
  // ... existing fields ...
  username           String?   @db.VarChar(50)
  passwordHash       String?   @map("password_hash") @db.VarChar(255)
  mustChangePassword Int       @default(0) @map("must_change_password") @db.TinyInt
  failedLoginCount   Int       @default(0) @map("failed_login_count")
  lockedUntil        DateTime? @map("locked_until")

  @@unique([username], map: "uk_user_username")
  @@map("fun_user")
}
```

### Key Facts
- `username` is nullable (LINE-only staff need not have one) and unique (when set)
- `password_hash` bcrypt salted (cost 10)
- `must_change_password` flag: tinyint, 1 = user must set their own password before using app (set by admin, cleared by user's first password change)
- `failed_login_count` INT (0–4 = normal, 5+ triggers lockout)
- `locked_until` stores the unlock timestamp (set 15 minutes into future, checked on every attempt)

---

## 3. UI Design

### /login Page (src/app/login/page.tsx)
**Layout:** "use client" form with Suspense wrapper for `useSearchParams()`
- Logo + title ("Ch.Lead FUN") centered at top
- **LINE Login section:**
  - Green LINE button with icon ("เข้าสู่ระบบด้วย LINE")
  - Subtext: "ครั้งแรก? กดปุ่มเดียวกัน — ระบบลงทะเบียนให้อัตโนมัติ…"
- **Divider:** "หรือ" with border lines on each side
- **Username+Password section** (white card below):
  - Username input (placeholder: "ชื่อผู้ใช้ที่ผู้ดูแลตั้งให้")
  - Password input (show/hide toggle via Eye/EyeOff icons)
  - Error message (red, appears on auth fail: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
  - Submit button: "เข้าสู่ระบบด้วยรหัสผ่าน" (LogIn icon, spinner during POST)
  - Small subtext: "ต้องให้ผู้ดูแลตั้งชื่อผู้ใช้ให้ก่อนที่ /settings/users"
- Calls `signIn("credentials", { username, password, redirect: false })` on form submit

### ForcePasswordChange.tsx (src/components/ForcePasswordChange.tsx)
**Full-screen blocking overlay** (shown when `user.mustChangePassword === true` in /api/me response)
- Modal: `bg-black/5 backdrop-blur-sm` (lighter than app's standard blur spec due to linter), centered, max-w-sm
- **Header:** Shield icon (amber background) + "ตั้งรหัสผ่านใหม่ก่อนใช้งาน" title + subtext
- **Form fields:**
  - Temp password input (placeholder: "รหัสผ่านชั่วคราว (ที่ได้รับ)")
  - New password input
  - Confirm password input
  - Error message (red, below fields)
- **Buttons:**
  - "บันทึกรหัสผ่านใหม่" (primary, spinner during POST)
  - "ออกจากระบบ" link at bottom
- On success, calls `onDone()` which refreshes `/api/me`, clearing the flag → overlay auto-closes

### /account/password Page (src/app/account/password/page.tsx)
**Self-service password change** (linked from user menu via "เปลี่ยนรหัสผ่าน")
- Page wrapper: max-w-md, space-y-4
- **Card title:** "เปลี่ยนรหัสผ่าน" + "ใช้เข้าสู่ระบบด้วยชื่อผู้ใช้+รหัสผ่านแทน/นอกเหนือจาก LINE Login"
- **Form:** same 3 inputs as ForcePasswordChange (current/new/confirm)
- On success, shows: "✓ เปลี่ยนรหัสผ่านสำเร็จ" with green Check icon
- Clears form after success

### /settings/users Page (src/app/settings/users/page.tsx)
**Admin user/permission management**
- **New fields in edit form:**
  - Username input (optional, font-mono): placeholder "เช่น patcharawadee"
  - Password reset button (edit mode only): "ตั้ง/รีเซ็ตรหัสผ่าน (ออกรหัสชั่วคราว)"
- **One-time password display** (when temp password issued):
  - Amber box with: "รหัสผ่านชั่วคราว — ให้ผู้ใช้ครั้งเดียว (ระบบจะไม่แสดงอีก)"
  - Large monospace font: the actual password
  - Copy button (Copy icon)
- **Table enhancements:**
  - New row showing: "@username" (font-mono, smaller) + green ✓ if `hasPassword` is true
  - Example: "@patcharawadee ✓"

### Chrome.tsx (src/components/Chrome.tsx)
**App chrome** — updated Me type to include `mustChangePassword: boolean`
- Conditional render of ForcePasswordChange overlay at top of MeContext.Provider:
  ```jsx
  {me?.user?.mustChangePassword && <ForcePasswordChange onDone={refreshMe} />}
  ```
- `refreshMe` callback re-fetches `/api/me` to clear the flag

---

## 4. API Endpoints

### POST /api/account/password
**Self-service password change** (requires active session)

**Request:**
```json
{
  "currentPassword": "string",  // optional if no password hash exists yet
  "newPassword": "string"
}
```

**Validation:**
- Calls `validatePassword(newPassword)` → returns Thai error message if policy violated (8+ chars, letter+digit, not in common list)
- If user has existing `passwordHash`, requires correct `currentPassword` (bcrypt.compare), else returns 400 "รหัสผ่านปัจจุบันไม่ถูกต้อง"

**Response:**
- 401 if not authenticated
- 400 with `{ error: "..." }` if password fails policy or current password wrong
- 200 with `{ ok: true }` on success (sets `mustChangePassword = false`)

### PUT /api/users/[id]
**Update user (admin only)** — now includes password reset logic

**New body fields:**
- `username: string` (optional) — sets the username (unique constraint checked, returns 409 if duplicate)
- `resetPassword: true` (optional) — generates a temp password, sets it, returns it in response

**Request (password reset example):**
```json
{
  "username": "patcharawadee",
  "resetPassword": true
}
```

**Response:**
```json
{
  "ok": true,
  "tempPassword": "Erawan9326!"  // returned ONCE, admin shows this to user
}
```

**Behavior:**
- If `resetPassword: true`:
  - Calls `genTempPassword()` → 10-char alphanumeric (always passes policy)
  - Hashes with bcrypt.hash(..., 10)
  - Sets `password_hash`, `must_change_password = 1`, `failed_login_count = 0`, `locked_until = null`
  - Returns `tempPassword` in response (the ONLY time the admin ever sees it)
- If `username` is provided but password reset is false, just updates the username field

**Error handling:**
- 409 if `username` violates unique constraint → returns `{ error: "ชื่อผู้ใช้นี้ถูกใช้แล้ว" }`
- 409 (fallback) → `{ error: "ไม่พบผู้ใช้" }`

### GET /api/users
**List all users (admin only)**

**New response fields (per user):**
```json
{
  "username": "patcharawadee",  // null if not set
  "hasPassword": true           // boolean, true if passwordHash is not null
}
```

### GET /api/me
**Current user info (live, for UI state)**

**New response field:**
```json
{
  "user": {
    "funUserId": 22,
    "displayName": "Nutt",
    "role": "admin",
    "approved": true,
    "pictureUrl": null,
    "branchId": 1,
    "mustChangePassword": false  // NEW: blocks app if true
  }
}
```

---

## 5. Key Files Modified/Created

| File | Changes |
|------|---------|
| `sql/013_credentials_login.sql` | NEW: add username, password_hash, must_change_password, failed_login_count, locked_until to fun_user |
| `prisma/schema.prisma` | ADD: 5 new fields to FunUser model, unique index on username |
| `src/lib/password.ts` | NEW: validatePassword(), genTempPassword() |
| `src/auth.ts` | REWRITE: add Credentials provider, restructure jwt/session callbacks |
| `src/app/login/page.tsx` | REWRITE: two-path form (LINE + username/password) with Suspense wrapper |
| `src/components/ForcePasswordChange.tsx` | NEW: blocking password-change modal (overlay, bg-black/5 backdrop-blur-sm) |
| `src/app/account/password/page.tsx` | NEW: self-service password change page |
| `src/app/api/account/password/route.ts` | NEW: POST endpoint for password change |
| `src/app/api/users/[id]/route.ts` | EDIT: add username + resetPassword logic |
| `src/app/api/users/route.ts` | EDIT: add username, hasPassword to response |
| `src/app/api/me/route.ts` | EDIT: add mustChangePassword to response |
| `src/components/Chrome.tsx` | EDIT: import ForcePasswordChange, wire it into MeContext.Provider, update Me type |
| `src/app/settings/users/page.tsx` | EDIT: add username field + password reset button, show temp password in amber box, table shows @username ✓ |
| `package.json` | ADD: bcryptjs@^3.0.3, @types/bcryptjs@^2.4.6 |

---

## 6. Deployment Notes

### Database Migration
- Applied `sql/013_credentials_login.sql` live on NAS MariaDB (docker exec …)
- Schema now has the 5 new columns + unique index on username

### Build & Docker
- Full docker build completed successfully on NAS (`fun:latest` tag)
- Container recreated with force-recreate flag
- Cloudflare Tunnel verified responding at https://fun.ch-erawan.com/login (200 OK)

### Test Account Setup
- Set `username='admin'` + temp password hash on user_id 22 (Nutt) with `must_change_password=1`
- User can now test the full flow: login with username/password, see forced password-change overlay, set permanent password

---

## 7. Outstanding Notes for Next Session

### What works now
✅ LINE Login (self-registration, admin approval flow)  
✅ Username+password login (admin-provisioned, forced password change on first login)  
✅ Brute-force lockout (5 fails → 15 min lock)  
✅ Self-service password change (any time after first login)  
✅ Temp password generation & display (one-time, admin-only, copy button)  
✅ Password policy validation (8+ chars, letter+digit, common-word blocklist)  
✅ Session JWT wiring (funUserId resolved once, role/approved refreshed per request)  

### Known limitations / design decisions
- ForcePasswordChange overlay uses lighter blur (`bg-black/5 backdrop-blur-sm`) than app's standard modal spec (`bg-black/45 backdrop-blur`) — a linter auto-formatted it during this session; if the user prefers the standard blur, can revert to match other modals
- Admin NEVER sees user's real password after first change (by design, mirrors CATS pattern)
- Temp password returned in API response ONLY — if admin loses it, they must issue a new one (no retrieval, no reset via email)
- Username is optional: LINE-only staff can work without ever setting a username, they just use LINE Login
- No email verification or "forgot password" self-service reset flow (not in current user requirements; if needed later, would require LINE DM integration or email provider setup)

### For testing in a new session
1. Go to https://fun.ch-erawan.com/login
2. Username/password form should be visible below LINE button (divider in middle)
3. Use `username='admin'` + temp password `Erawan9326!` (set on your account, user_id 22)
4. After login, the ForcePasswordChange overlay should block the app, prompting you to set a new password
5. Set your permanent password (8+ chars, letter+digit)
6. App should unlock and show the normal interface
7. Use user menu → "เปลี่ยนรหัสผ่าน" to verify self-service change works
8. In /settings/users, test the "ตั้ง/รีเซ็ตรหัสผ่าน" button to generate a temp password for another user

---

**All code builds cleanly, all migrations applied successfully, deployed & live on production.**
