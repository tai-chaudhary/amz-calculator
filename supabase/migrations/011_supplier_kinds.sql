-- Companies you pay aren't all stock suppliers: carriers, printers, agencies,
-- accountants. One list, tagged with what each is for.
update suppliers set data = jsonb_set(data, '{kinds}', '["stock"]'::jsonb) where not (data ? 'kinds');

insert into suppliers (name, data)
select v.name, jsonb_build_object('kinds', jsonb_build_array('carrier'), 'source', 'manual',
                                  'moq', 0, 'delivery', 0, 'leadDays', 0)
from (values ('Evri'), ('DPD'), ('DHL')) as v(name)
where not exists (select 1 from suppliers s where lower(s.name) = lower(v.name));
