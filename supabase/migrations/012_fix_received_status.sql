-- Orders recorded as delivered before the status fix kept saying "awaiting
-- delivery". Put them right; the portal now works this out from the lines anyway.
with progress as (
  select po.id, sum(i.qty) as ordered, sum(least(i.qty_received, i.qty)) as got
  from purchase_orders po join purchase_order_items i on i.po_id = po.id
  where po.status in ('awaiting_delivery', 'partially_received')
  group by po.id
)
update purchase_orders po
set status = case when p.got >= p.ordered then 'received' when p.got > 0 then 'partially_received' else po.status end
from progress p
where p.id = po.id and p.got > 0;
