# Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Default Deny**: All paths Not explicitly matched in `/databases/{database}/documents` are denied read and write access.
2. **Role Hierarchy & Trusted Source**:
   - `isAdmin()`: True only if the user's UID exists in `/admins/{uid}`, or their `/users/{uid}` document has `role == 'ADMIN'`, or their verified email matches the bootstrapped admin (`lakshya.tech2026@gmail.com` with `email_verified == true`).
   - `isStaff()`: True if `isAdmin()` or their `/users/{uid}` document has `role == 'STAFF'` and `status == 'ACTIVE'`.
   - Self-registration to `/users/{userId}` can only assign `role == 'CUSTOMER'` unless the user is the verified bootstrapped admin.
3. **PII & Customer Isolation**:
   - `/users/{userId}`: Only readable by the document owner (`userId == request.auth.uid`) or `isStaff()`.
   - `/customers/{customerId}`, `/quotations/{quotationId}`, `/subscriptions/{subscriptionId}`, `/invoices/{invoiceId}`, `/payments/{paymentId}`: Customers can only read (`get`/`list`) documents where `resource.data.customerId == request.auth.uid` (or `resource.data.userId == request.auth.uid`). Staff and Admin can read and manage operational records.
4. **Admin-Only Configuration**:
   - `/staff/{staffId}`, `/products/{productId}`, `/productVariants/{variantId}`, `/plans/{planId}`, `/taxRules/{taxId}`, `/discountRules/{discountId}` mutations (`create`, `update`, `delete`) are restricted strictly to `isAdmin()`.
5. **Immutable Audit Logs**:
   - `/auditLogs/{logId}` allows `create` by authenticated users where `actorId == request.auth.uid` and strictly forbids `update` and `delete`.
6. **Path ID & String Size Hardening**:
   - Every single-document operation validates `isValidId(docId)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars) and enforces strict string `.size()` bounds and key allowlists (`hasAll` + `hasOnly`).

## 2. The "Dirty Dozen" Payloads

1. **Privilege Escalation on Registration**: Unprivileged user creates `/users/uid1` with `role: "ADMIN"`. -> `PERMISSION_DENIED`
2. **Shadow Field Injection**: Authenticated user creates `/users/uid1` with extra key `isSuperAdmin: true`. -> `PERMISSION_DENIED`
3. **Spoofed Unverified Admin Email**: User with `email: "lakshya.tech2026@gmail.com"` and `email_verified: false` writes to `/staff/s1`. -> `PERMISSION_DENIED`
4. **Cross-Customer Invoice Read**: Customer `cust_A` attempts `get` or `list` on `/invoices/inv_B` belonging to `cust_B`. -> `PERMISSION_DENIED`
5. **Staff Creating Staff Account**: Staff user (`role: "STAFF"`) attempts to `create` `/staff/staff_new`. -> `PERMISSION_DENIED`
6. **Customer Modifying Tax Rules**: Customer attempts to `update` `/taxRules/tax_gst18`. -> `PERMISSION_DENIED`
7. **Customer Modifying Discount Usage**: Customer attempts to `update` `/discountRules/disc_1` to lower `usedCount`. -> `PERMISSION_DENIED`
8. **ID Poisoning Attack**: User attempts to create a document with a 500-character or special-character document ID. -> `PERMISSION_DENIED`
9. **Value Poisoning on Update**: Staff updates `/invoices/inv_1` setting `status` to an integer `999` or string > 64 chars. -> `PERMISSION_DENIED`
10. **Audit Log Tampering**: Admin or Staff attempts to `update` or `delete` `/auditLogs/log_1`. -> `PERMISSION_DENIED`
11. **Negative Price / Financial Manipulation by Customer**: Customer attempts to `update` `grandTotalPaise` on `/invoices/inv_1`. -> `PERMISSION_DENIED`
12. **Immortal Field Mutation**: User attempts to change `createdAt` or `id` during a profile `update` on `/users/uid1`. -> `PERMISSION_DENIED`
