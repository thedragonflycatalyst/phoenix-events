# Spec: in-kind gifts (QR drop-off) and Tap to Pay

Owner: Shasta. Status: Draft, waiting on owner decisions. Legal basis: Felix's memo
"In-Kind Gifts and Tap to Pay" (https://claude.ai/artifact/DQ4cNeud7mkpabouwAmzVQ, Nov 8, 2026),
which holds the exact wording quoted below.

## Problem
Phoenix can only take donations online. Neighbors want to drop off items (household goods, food, supplies)
and give by card at events. Today an in-kind gift gets no receipt and no record.

## Goal and measure
Every in-kind gift and in-person card gift gets a compliant emailed receipt the same day and
shows up in the donor's gift history. Measure: share of drop-offs with a confirmed list and
receipt within 24 hours (target 100%); zero receipts showing a dollar value for items.

## Non-goals
- No gift cards (owner decision, Nov 8). They're blocked at the form like other declined items.
- No clothing, shoes, coats or accessories (owner decision, Nov 8). Blocked by category and by description; blankets and linens are still accepted as household goods.
- No sales at events (owner decision, Nov 8).
- Selling donated items online (eBay or similar) is planned, not in version 1. Felix and a CPA
  check marketplace sales tax, Form 8282 and recall rules first; the platform choice comes later.
- No vehicle, real estate, securities or crypto gifts.
- No paper slips. No SSN or tax ID collected.

## Flow: in-kind gift
1. Donor scans the QR code at the drop-off point. It opens a web page (no account needed),
   with the event or location and the date filled in.
2. Donor enters name and email (required), mailing address (optional; required if any item is
   estimated over $5,000), then the items: description, quantity, condition
   (new / good used / fair), category, and their own estimated value (optional, private).
3. Categories on the "do not accept" list can't be submitted. The form says why and names
   alternatives. Categories in "staff approval" are marked pending.
4. Donor ticks the acceptance-terms checkbox (exact text in the memo) and submits.
5. A volunteer, signed in with their own account, edits the list to match what was received
   (count, condition, declined items) and confirms it. The time and the volunteer are logged.
6. The confirmed list produces the receipt PDF, emailed through the existing receipt system.
7. The gift is recorded in the Phoenix ledger under the donor's email, so the email-link lookup
   and a signed-in account both show it with their money gifts.

Photos: optional, items only, offered when an item's estimate is $500 or more or for bulk
drop-offs. Volunteers and the donor can see them. They're deleted with the gift record.

## Receipt (in-kind)
Organization name, EIN 41-3050300 and address; donor; date; each item's quantity, description
and condition as confirmed; **no dollar values, including the donor's estimate**; the
goods-or-services line; the valuation note; the Maryland disclosure (memo's statement block,
with the phone number already on cash receipts); receipt number; confirming volunteer's name.

## High-value items (over $5,000 per item or similar group)
Set `high_value`, require the address, and prompt staff to sign Form 8283 Part V and store a
copy of Section B. Record the disposition (kept, given away free, sold, discarded), its date
and price. A monthly job lists high-value items disposed of in the last 125 days with no
Form 8282 filed. Items given away free for the mission are exempt from Form 8282.

## Flow: Tap to Pay
- Phoenix Stripe account only. The owner is the Stripe admin who accepts Apple's Tap to Pay
  terms (owner decision, Nov 8).
- Version 1: the Stripe Dashboard app. Each Phoenix admin who takes payments is invited as a
  limited-role team member on the Phoenix Stripe account, and the site's admin page links
  them to it.
- Version 2: Tap to Pay inside the Phoenix app (Stripe Terminal SDK), available to anyone with
  the Phoenix admin role, with no separate Stripe login. A website can't use the phone's tap
  reader, so this needs the app.
- Before the tap, show "Donation to The Phoenix Catalyst Inc (501(c)(3), EIN 41-3050300)",
  the amount, and an email field for the receipt.
- The webhook already handles Checkout and invoices. Add `payment_intent.succeeded` for
  card-present payments: record the gift in the Phoenix ledger and send the standard donation
  receipt with "Paid by card in person, [brand] ending [last 4]".
- No surcharge, no minimum or maximum, never split one gift. Refund line on the page and in
  the receipt footer: "Donations are generally final. If you were charged in error, contact us
  within 60 days and we will refund it."
- Recurring gifts in person: not in version 1.

## Books (Phoenix ledger) workflow
Owned by Will; requirements from this spec:
- In-kind gift: a noncash contribution entry on the Phoenix ledger (own category, separate from
  cash donations) linked to the gift record, donor email and receipt number.
- Fair value is Phoenix's own estimate for its books (method: eBay sold listings for similar
  items, or the actual sale price once sold). It is never shown on the donor's receipt or to
  the donor, and is separate from the donor's private estimate.
- Inventory (owner decision, Nov 8): every confirmed item gets an inventory ID when the
  volunteer confirms the gift (format PC-INV-YYYYMMDD-NNN), and the receipt prints that ID next
  to each item line. One inventory record per item: ID, receipt number, donor link, date
  received, description, quantity, condition, storage location, status.
- Status history is append-only (no edits, each change logged with who and when):
  in stock -> distributed free under a named Phoenix program or event / sold / discarded or
  recycled (with reason) / declined at drop-off.
- Sold: platform (eBay or other), listing ID, sale date, sale price, fees, payout, and the
  Books income entry it produced.
- Distributed: the program or event name and date (no recipient's personal data).
- Reports: current inventory by location and age; dispositions by type for any period. A sale on eBay or a
  similar marketplace records the payout, marketplace fees and the sale price against the item.
  Sales tax collected by the marketplace is not Phoenix income or liability.
- High-value items (signed Form 8283-B): monthly report of dispositions within 3 years with no
  Form 8282 filed (due 125 days after disposition).
- Tap to Pay gifts record exactly like online card gifts (card-present payments via the webhook).
- No gift cards. No Dragonfly entries, links or marketing use. Entries follow the existing
  rules: no edits or deletes, voids with a reason, every action audited. Kept 7 years
  (high-value: 3 + 7).
- Year-end report: total noncash contributions and their value, for the yearly IRS filing.

## Data, retention and privacy
- Stored in the Phoenix ledger only, never in Dragonfly tables. Not used for Dragonfly marketing.
- Keep gift records 7 years; high-value items 3 years plus 7. Declined items: a note only.
- The privacy policy adds the in-kind section from the memo (Felix's wording) before launch.

## Acceptance criteria
- Given a donor estimate of $300, when the receipt is generated, then no dollar amount for
  any item appears in the PDF.
- Given a car seat, crib, mattress, medication, firearm, vehicle or hazardous item, when the
  donor submits, then it's blocked with a message.
- Given an unconfirmed gift, then no receipt is sent. Given a confirmed one, the receipt
  reflects only the confirmed list.
- Given an item estimated over $5,000, then the address is required and `high_value` is set.
- Given a high-value item disposed of over 100 days ago with no 8282, then it appears on the
  monthly report.
- Given a Tap to Pay donation with an email, then the donor gets the Phoenix receipt with brand
  and last 4, and the gift appears in their email-link lookup.
- Every receipt carries the Maryland disclosure.

## Open decisions (owner, via Ops)
1. Decided: the owner is the admin and uses the Dashboard app. Still open: which admins'
   phones take payments.
2. Board adoption of the item acceptance policy.
3. CPA session deferred to the first yearly filing (owner decision, Nov 8). Researched answers:
   donor's estimate stays off receipts (Pub. 1771: description, not value); record donated goods
   in the Phoenix ledger as noncash contributions at fair value (the eBay sale price is the best
   evidence), on their own line; online sales only through a marketplace facilitator such as eBay
   need no Maryland sales-tax license (Comptroller tax alert, Sept 25, 2019). Gift cards are
   not accepted.
