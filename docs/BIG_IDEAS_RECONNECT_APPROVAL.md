# Approving a Big Ideas Day reconnect

**One extra step when you approve a partner who came in from the Big Ideas Day
invitations. Skip it and they hit a wall after paying.**

---

## Why this exists

The Big Ideas Day rates are sold to a **named list** — not to partners in
general. `conference_entities.attributes.direct_purchase_org_ids` holds the
organisations allowed to buy each rate, and it was built that way deliberately:
Steve excluded two companies by name over suitcasing, and a category rule would
have swept them back in.

The reconnect invitations go to roughly 25 companies that are **not currently
members or partners**. The email tells them the whole cost up front: **$600 to
rejoin**, then **$500** (publisher) or **$1,000** (platform / solution /
service) to take part.

So the sequence they're promised is: pay $600 → board approves → buy their rate.

Without this step, the third part fails. A newly approved partner is not on the
named list, so `/big-ideas-day` tells them:

> Partner places on Big Ideas Day are offered by invitation. Talk to us if you
> would like to be in the room.

They have paid, they have waited for a board decision, and the page says they
are not invited — to the thing that invited them.

---

## The step

When you approve a signup application that came from the Big Ideas Day
reconnect list, add the new organisation to the named list for the rate the
email quoted them.

| They were quoted | Add them to |
|---|---|
| $500 — publisher | `Big Ideas Day — Publisher` |
| $1,000 — platform / solution / service | `Big Ideas Day — Operations Partner` |

Everyone taking part may also pitch a session, so add them to
`Big Ideas Presentations` as well.

Do it in **Build** (`/admin/conference/<id>/build`), on the entity's
`direct_purchase_org_ids` attribute. Add the new org's id to the existing array
— do not replace it.

---

## Checking it worked

The partner should see their rate with an enabled **Add to cart** on
`/big-ideas-day`. If they still see "by invitation", the id did not land.

To see who is currently named on each rate:

```sql
select e.name as offer,
       coalesce(string_agg(o.name, ', ' order by o.name), '(nobody)') as named
from conference_entities e
left join lateral jsonb_array_elements_text(e.attributes->'direct_purchase_org_ids') x(id) on true
left join organizations o on o.id = x.id::uuid
where e.attributes ? 'direct_purchase_org_ids'
group by e.name
order by e.name;
```

---

## If this starts happening often

This is a human step on purpose, because the volume is ~25 companies and every
one passes a board decision anyway. It is not worth automating a gate that
exists to be deliberate.

⚠️ But the cost of forgetting lands on someone who has already paid $600, so if
the reconnect list grows or approvals get delegated, replace this with a marker
set at approval time — not by widening the gate to all partners, which is the
door the named list was closed to keep shut.
