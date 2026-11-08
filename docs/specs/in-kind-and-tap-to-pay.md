# Spec: in-kind gifts (QR drop-off) and Tap to Pay

Owner: Shasta. Status: Draft, waiting on owner decisions. Legal basis: Felix's memo
"In-Kind Gifts and Tap to Pay" (https://claude.ai/artifact/DQ4cNeud7mkpabouwAmzVQ, Nov 8, 2026),
which holds the exact wording quoted below.

## Problem
Phoenix can only take donations online. Neighbors want to drop off items (coats, food, supplies)
and give by card at events. Today an in-kind gift gets no receipt and no record.

## Goal and measure
Every in-kind gift and in-person card gift gets a compliant emailed receipt the same day and
shows up in the donor's gift history. Measure: share of drop-offs with a confirmed list and
receipt within 24 hours (target 100%); zero receipts showing a dollar value for items.

## Non-goals
- No sales at events. That waits until the owner gets a Maryland sales-tax license (CPA).
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
- Phoenix Stripe account only. First version: the Stripe Dashboard app's Tap to Pay, with no
  custom app build.
- Before the tap, show "Donation to The Phoenix Catalyst Inc (501(c)(3), EIN 41-3050300)",
  the amount, and an email field for the receipt.
- The webhook already handles Checkout and invoices. Add `payment_intent.succeeded` for
  card-present payments: record the gift in the Phoenix ledger and send the standard donation
  receipt with "Paid by card in person, [brand] ending [last 4]".
- No surcharge, no minimum or maximum, never split one gift. Refund line on the page and in
  the receipt footer: "Donations are generally final. If you were charged in error, contact us
  within 60 days and we will refund it."
- Recurring gifts in person: not in version 1.

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
1. Who is the Phoenix Stripe admin who accepts Apple's Tap to Pay terms, and which phones.
2. Board adoption of the item acceptance policy.
3. One CPA session: donor estimate on receipts (memo recommends leaving it off), recording
   in-kind fair value in the books and Form 990, Maryland sales tax, donated gift cards.
