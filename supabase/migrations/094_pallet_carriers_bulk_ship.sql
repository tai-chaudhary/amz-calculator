-- ALREADY APPLIED to the live database on 13-11-2026 (do not re-run the data part).
-- 094: pallet carriers (Farrall's) and "cheapest way to send a bulk order" (13-11-2026).
-- Farrall's price sheet lives in Cost Settings (settings.app_settings.palletCarriers): a price per postcode band,
-- service (24hr / 48hr / 72hr) and pallet size or count, plus a fuel surcharge % that is dated like every other cost
-- (cost_versions kind 'pallet'). Pallets are worked out from the weight: up to 250kg a Quarter, up to 500kg a Half,
-- up to 1,250kg a Full, then 2, 3, 4, 5 pallets and a per-pallet price beyond 5.
-- Everything is worked out here, not in the browser, so the warehouse gets the answer ("send by pallet") without
-- ever being sent a cost: money is only returned to people who see costs (public.sees_costs()).

-- The outward half of a postcode ("TF9 2DU" → area TF, district 9; "M14" → M, 14)
create or replace function public.postcode_parts(p_postcode text, out area text, out district int)
language plpgsql immutable as $$
declare pc text := upper(regexp_replace(coalesce(p_postcode,''), '[^A-Za-z0-9]', '', 'g')); o text;
begin
  o := case when pc ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' then left(pc, length(pc) - 3) else pc end;
  area := substring(o from '^[A-Z]{1,2}');
  district := nullif(substring(o from '^[A-Z]{1,2}([0-9]{1,2})'), '')::int;
end $$;

-- Which of a pallet carrier's bands a postcode falls in. A band naming districts (CH1-5) beats one naming the whole area.
create or replace function public.pallet_band(p_carrier jsonb, p_postcode text)
returns jsonb language plpgsql stable as $$
declare a text; d int; b jsonb; hit jsonb;
begin
  select area, district into a, d from public.postcode_parts(p_postcode);
  if a is null then return null; end if;
  if d is not null then
    select x into hit from jsonb_array_elements(p_carrier->'bands') x
      where exists (select 1 from jsonb_array_elements(x->'districts') ds, jsonb_array_elements(ds->'ranges') r
                    where ds->>'area' = a and d between (r->>0)::int and (r->>1)::int) limit 1;
    if hit is not null then return hit; end if;
  end if;
  select x into b from jsonb_array_elements(p_carrier->'bands') x where x->'areas' ? a limit 1;
  return b;
end $$;

-- The pallet carrier as it was on a date (the dated version if there is one, else today's Cost Settings)
create or replace function public.pallet_carrier_on(p_ref text, p_on date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.value from cost_versions v where v.kind = 'pallet' and v.ref = p_ref and v.effective_from <= coalesce(p_on, current_date)
      order by v.effective_from desc, v.created_at desc limit 1),
    (select s.value->'palletCarriers'->p_ref from settings s where s.key = 'app_settings'))
$$;
revoke all on function public.pallet_carrier_on(text, date) from public, anon, authenticated;

-- What a pallet delivery costs: postcode band × pallets for the weight × service, plus the fuel surcharge in force.
-- Internal: returns money, so it is not callable from the browser (pallet_quote and bulk_ship_options wrap it).
create or replace function public.pallet_cost(p_postcode text, p_kg numeric, p_service text default null, p_on date default null, p_ref text default 'farralls')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c jsonb := public.pallet_carrier_on(p_ref, p_on); band jsonb; svc text; r jsonb;
  q numeric; h numeric; f numeric; n int; size text; base numeric; fuel numeric; pct numeric;
begin
  if c is null then return jsonb_build_object('ok', false, 'why', 'No pallet carrier is set up'); end if;
  if coalesce(p_kg, 0) <= 0 then return jsonb_build_object('ok', false, 'why', 'No weight'); end if;
  band := public.pallet_band(c, p_postcode);
  if band is null then return jsonb_build_object('ok', false, 'carrier', c->>'name', 'why', 'Postcode is not on the price sheet — ask ' || (c->>'name')); end if;
  -- The service asked for, else the usual one, else the fastest the band has a price for
  select s into svc from unnest(array[p_service, c->>'defaultService', '24hr', '48hr', '72hr']) with ordinality t(s, o)
    where s is not null and jsonb_typeof(band->'rates'->s) = 'array' order by o limit 1;
  if svc is null then return jsonb_build_object('ok', false, 'carrier', c->>'name', 'band', band->>'id', 'why', 'Price on application for this postcode — ask ' || (c->>'name')); end if;
  r := band->'rates'->svc;
  q := (c->'sizes'->0->>'maxKg')::numeric; h := (c->'sizes'->1->>'maxKg')::numeric; f := (c->'sizes'->2->>'maxKg')::numeric;
  if p_kg <= q then n := 1; size := c->'sizes'->0->>'label'; base := (r->>0)::numeric;
  elsif p_kg <= h then n := 1; size := c->'sizes'->1->>'label'; base := (r->>1)::numeric;
  elsif p_kg <= f then n := 1; size := c->'sizes'->2->>'label'; base := (r->>2)::numeric;
  else n := ceil(p_kg / f)::int; size := n || ' pallets';
    base := case when n <= 5 then (r->>(n + 1))::numeric else n * (r->>7)::numeric end;
  end if;
  pct := coalesce((c->>'fuelPct')::numeric, 0);
  fuel := round(base * pct / 100, 2);
  return jsonb_build_object('ok', true, 'carrier', c->>'name', 'band', band->>'id', 'service', svc,
    'asked_service', p_service, 'pallets', n, 'size', size, 'kg', p_kg,
    'base', base, 'fuel_pct', pct, 'fuel', fuel, 'total', base + fuel);
end $$;
revoke all on function public.pallet_cost(text, numeric, text, date, text) from public, anon, authenticated;

-- Cost Settings' "price a pallet": for people who see costs
create or replace function public.pallet_quote(p_postcode text, p_kg numeric, p_service text default null, p_on date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  return public.pallet_cost(p_postcode, p_kg, p_service, p_on);
end $$;
grant execute on function public.pallet_quote(text, numeric, text, date) to authenticated;

-- What n parcels of one weight cost on each parcel carrier (Next Day), cheapest first. Same rules as parcelsCost() in calc.js:
-- "subsequent" = first parcel at its rate then a lower rate each; "all" = a different rate for every parcel when 2 or more.
create or replace function public.parcels_cost(p_kg numeric, p_n int)
returns table (carrier_id text, carrier text, cost numeric)
language sql stable security definer set search_path = public as $$
  with c as (select k, v from settings s, jsonb_each(s.value->'carriers') e(k, v) where s.key = 'app_settings'),
  r as (
    select c.k, c.v, (select (cat->'rates'->>'nextday')::numeric from jsonb_array_elements(c.v->'categories') cat
                       where p_kg <= (cat->>'maxKg')::numeric order by (cat->>'maxKg')::numeric limit 1) rate
    from c where p_kg <= coalesce((c.v->>'maxWeight')::numeric, 0) and coalesce((c.v->'services'->>'nextday')::boolean, false))
  select r.k, r.v->>'name',
    case when p_n <= 1 or coalesce(r.v->'multi'->>'rule', 'same') = 'same' or (r.v->'multi'->>'rate') is null then r.rate * greatest(p_n, 1)
         when r.v->'multi'->>'rule' = 'subsequent' then r.rate + (r.v->'multi'->>'rate')::numeric * (p_n - 1)
         when r.v->'multi'->>'rule' = 'all' then (r.v->'multi'->>'rate')::numeric * p_n
         else r.rate * p_n end
  from r where coalesce(r.rate, 0) > 0 order by 3
$$;
revoke all on function public.parcels_cost(numeric, int) from public, anon, authenticated;

-- The cheapest way to send a bulk order: public.bulk_ship_options(p_code, p_units, p_postcode, p_tracked, p_per_parcel,
-- p_service, p_unit_kg) — every unit as its own parcel, or a pallet (plus one tracked parcel when the order came from
-- Amazon / eBay / TikTok, which need a parcel tracking number). Anyone on Dispatch can ask; the £ figures are only
-- returned to people who see costs. The function body is live in the database (read it there with pg_get_functiondef);
-- it uses pallet_cost() and parcels_cost() above and the packaging of the product's own listing.

-- Data (already applied 13-11-2026): Farrall's Oct 2026 price sheet, 18% fuel surcharge, 24hr as the usual service.
update public.settings set value = jsonb_set(value, '{palletCarriers}', $pj${"farralls":{"name":"Farrall's","sheet":"Farrall's Group Oct 2026","fuelPct":18,"defaultService":"24hr","sizes":[{"id":"qtr","label":"Quarter pallet","maxKg":250},{"id":"half","label":"Half pallet","maxKg":500},{"id":"full","label":"Full pallet","maxKg":1250}],"extras":[{"name":"Before 10.00am","cost":25},{"name":"Before 12.00","cost":10},{"name":"Saturday AM","cost":65},{"name":"Time specific delivery","cost":20},{"name":"Amazon","cost":10},{"name":"Book window","cost":10},{"name":"Tail-lift","cost":0},{"name":"Book-in","cost":0}],"bands":[{"id":"Local","postcodes":"TF","areas":["TF"],"districts":[],"rates":{"48hr":[30.0,30.0,30.0,60.0,90.0,120.0,150.0,30.0],"24hr":[30.0,30.0,30.0,60.0,90.0,120.0,150.0,30.0]}},{"id":"01","postcodes":"B BD BL CH 1-5,41-49,60-66,88,90,99 CV CW DE DN DY HD HX L LE LN 1-3,5-6 LS LU M MK NG NN OL S SK ST WA WF WN WS WV","areas":["B","BD","BL","CV","CW","DE","DN","DY","HD","HX","L","LE","LS","LU","M","MK","NG","NN","OL","S","SK","ST","WA","WF","WN","WS","WV"],"districts":[{"area":"CH","ranges":[[1,5],[41,49],[60,66],[88,88],[90,90],[99,99]]},{"area":"LN","ranges":[[1,3],[5,6]]}],"rates":{"48hr":[47.05,48.95,50.25,99.15,142.45,183.15,221.0,44.2],"24hr":[48.35,52.3,56.1,108.25,151.2,191.6,231.75,46.35]}},{"id":"02","postcodes":"BB CH 6-8 FY HG HU LN 4,7-13 NR PE PR SS","areas":["BB","FY","HG","HU","NR","PE","PR","SS"],"districts":[{"area":"CH","ranges":[[6,8]]},{"area":"LN","ranges":[[4,4],[7,13]]}],"rates":{"48hr":[48.35,50.25,51.75,101.85,147.9,192.65,237.5,47.5],"24hr":[52.3,56.15,60.15,113.85,164.35,209.9,254.5,50.9]}},{"id":"03","postcodes":"CM 4,6,14-15,22-24 RG SL","areas":["RG","SL"],"districts":[{"area":"CM","ranges":[[4,4],[6,6],[14,15],[22,24]]}],"rates":{"48hr":[51.0,52.95,54.3,107.1,155.85,203.4,251.0,50.2],"24hr":[54.95,58.7,62.7,118.6,172.0,220.15,267.0,53.4]}},{"id":"04","postcodes":"WD","areas":["WD"],"districts":[],"rates":{"48hr":[52.95,52.95,56.95,112.45,162.65,214.05,264.25,52.85],"24hr":[61.4,61.4,65.35,123.9,179.95,230.65,280.5,56.1]}},{"id":"05","postcodes":"G KA 1-26,29+ ML","areas":["G","ML"],"districts":[{"area":"KA","ranges":[[1,26],[29,999]]}],"rates":{"48hr":[66.55,74.75,81.2,158.9,225.1,291.1,347.5,69.5],"24hr":[70.55,78.6,91.2,171.75,250.7,321.15,396.0,79.2]}},{"id":"06","postcodes":"BN CT RH TN","areas":["BN","CT","RH","TN"],"districts":[],"rates":{"48hr":[60.75,62.95,64.5,127.15,185.3,238.75,294.8,58.95],"24hr":[65.05,73.9,78.25,148.8,218.0,278.1,338.75,67.75]}},{"id":"07","postcodes":"BR CR DA SM","areas":["BR","CR","DA","SM"],"districts":[],"rates":{"48hr":[58.3,58.3,62.2,122.8,178.5,235.35,291.25,58.25],"24hr":[66.15,66.15,69.65,133.15,194.2,250.25,305.25,61.05]}},{"id":"08","postcodes":"NE 19,46-49,65-71 SY 1-2","areas":[],"districts":[{"area":"NE","ranges":[[19,19],[46,49],[65,71]]},{"area":"SY","ranges":[[1,2]]}],"rates":{"48hr":[52.45,55.8,57.0,113.95,170.75,226.3,277.75,55.55],"24hr":[56.15,65.9,72.4,142.05,199.4,256.55,316.25,63.25]}},{"id":"09","postcodes":"CA EX","areas":["CA","EX"],"districts":[],"rates":{"48hr":[57.55,63.65,68.2,134.65,201.7,267.55,329.0,65.8],"24hr":[64.1,72.15,81.65,160.15,224.75,289.25,360.0,72.0]}},{"id":"10","postcodes":"PL TQ","areas":["PL","TQ"],"districts":[],"rates":{"48hr":[60.45,66.55,71.05,140.25,210.25,278.7,343.0,68.6],"24hr":[66.7,74.9,84.25,165.45,232.85,300.0,373.25,74.65]}},{"id":"12","postcodes":"EN HA IG KT RM TW UB","areas":["EN","HA","IG","KT","RM","TW","UB"],"districts":[],"rates":{"48hr":[61.35,61.35,62.7,123.7,180.85,235.35,291.25,58.25],"24hr":[66.85,66.85,70.9,134.95,197.6,252.55,307.75,61.55]}},{"id":"13","postcodes":"FK PA 1-19 SY 3+ TD","areas":["FK","TD"],"districts":[{"area":"PA","ranges":[[1,19]]},{"area":"SY","ranges":[[3,999]]}],"rates":{"48hr":[63.05,70.55,76.45,149.7,212.45,274.95,328.75,65.75],"24hr":[69.55,77.6,90.2,169.75,247.7,317.15,391.0,78.2]}},{"id":"14","postcodes":"TR","areas":["TR"],"districts":[],"rates":{"48hr":[64.4,71.85,77.75,152.45,216.5,280.7,347.25,69.45],"24hr":[70.55,78.5,90.5,171.05,249.95,320.2,395.0,79.0]}},{"id":"15","postcodes":"DG LL 32-78","areas":["DG"],"districts":[{"area":"LL","ranges":[[32,78]]}],"rates":{"48hr":[68.8,68.8,74.75,146.35,207.55,268.65,321.25,64.25],"24hr":[75.55,75.55,87.8,165.15,241.1,308.5,380.5,76.1]}},{"id":"16","postcodes":"KY","areas":["KY"],"districts":[],"rates":{"48hr":[67.45,74.85,86.45,163.15,238.5,305.65,377.25,75.45],"24hr":[72.45,79.8,91.35,173.0,253.3,325.45,402.25,80.45]}},{"id":"17","postcodes":"DD PH 1-7,14","areas":["DD"],"districts":[{"area":"PH","ranges":[[1,7],[14,14]]}],"rates":{"48hr":[89.1,89.1,90.5,179.55,259.2,338.75,418.5,83.7],"24hr":[91.55,91.55,108.1,209.45,301.9,392.8,481.3,96.25]}},{"id":"18","postcodes":"BT 1-21,23,27-29,36-42","areas":[],"districts":[{"area":"BT","ranges":[[1,21],[23,23],[27,29],[36,42]]}],"rates":{"48hr":[93.15,93.65,94.2,188.35,282.5,370.15,462.6,91.45],"24hr":[105.45,106.0,106.5,213.0,319.45,419.5,524.35,103.85]}},{"id":"19","postcodes":"PO 30-41","areas":[],"districts":[{"area":"PO","ranges":[[30,41]]}],"rates":{"48hr":[97.55,97.55,103.85,203.65,302.05,395.0,472.25,94.45],"24hr":null}},{"id":"20","postcodes":"AB 10-25 IV 1-3,5,8-10","areas":[],"districts":[{"area":"AB","ranges":[[10,25]]},{"area":"IV","ranges":[[1,3],[5,5],[8,10]]}],"rates":{"48hr":[96.4,96.4,105.05,209.9,312.15,396.15,479.25,95.85],"24hr":[102.65,102.65,126.25,252.3,378.3,498.0,618.0,123.6]}},{"id":"21","postcodes":"AB 30-56 IV 4,6-7,11-40,52-54,57+","areas":[],"districts":[{"area":"AB","ranges":[[30,56]]},{"area":"IV","ranges":[[4,4],[6,7],[11,40],[52,54],[57,999]]}],"rates":{"48hr":[97.45,97.45,105.35,210.55,315.8,410.5,503.75,100.75],"24hr":null}},{"id":"23","postcodes":"BT 22,24-26,30-35,43+","areas":[],"districts":[{"area":"BT","ranges":[[22,22],[24,26],[30,35],[43,999]]}],"rates":{"48hr":[99.95,100.5,101.0,202.0,302.95,397.45,496.75,98.25],"24hr":null}},{"id":"24","postcodes":"KW 1-14 PH 15+","areas":[],"districts":[{"area":"KW","ranges":[[1,14]]},{"area":"PH","ranges":[[15,999]]}],"rates":{"48hr":[112.25,112.25,122.1,244.2,366.3,488.4,610.5,122.1],"24hr":null}},{"id":"27","postcodes":"IM","areas":["IM"],"districts":[],"rates":{"72hr":[154.85,159.55,164.3,328.6,492.9,657.2,821.5,164.3],"48hr":null}},{"id":"28","postcodes":"GY JE","areas":["GY","JE"],"districts":[],"rates":{"72hr":[122.45,122.45,134.8,269.6,404.4,539.2,674.0,134.8],"48hr":[176.75,176.75,176.75,353.5,530.25,707.0,883.75,176.75]}},{"id":"29","postcodes":"IV 41-51,55-56 KA 27-28 PA 20+","areas":[],"districts":[{"area":"IV","ranges":[[41,51],[55,56]]},{"area":"KA","ranges":[[27,28]]},{"area":"PA","ranges":[[20,999]]}],"rates":{"72hr":[160.15,160.15,160.15,320.3,480.45,640.6,800.75,160.15],"48hr":[186.05,186.05,186.05,372.1,558.15,744.2,930.25,186.05]}},{"id":"30","postcodes":"BH PO 1-29 SO SP 3,7-11","areas":["BH","SO"],"districts":[{"area":"PO","ranges":[[1,29]]},{"area":"SP","ranges":[[3,3],[7,11]]}],"rates":{"48hr":[55.6,58.05,59.6,117.5,170.45,221.65,273.25,54.65],"24hr":[60.35,65.05,69.85,131.55,190.1,242.3,293.0,58.6]}},{"id":"32","postcodes":"ME OX 1-3,33","areas":["ME"],"districts":[{"area":"OX","ranges":[[1,3],[33,33]]}],"rates":{"48hr":[56.4,58.5,59.6,117.9,172.0,222.05,274.75,54.95],"24hr":[60.15,63.95,67.9,129.05,188.85,241.0,293.25,58.65]}},{"id":"33","postcodes":"AL GL HP SG","areas":["AL","GL","HP","SG"],"districts":[],"rates":{"48hr":[50.15,52.0,53.25,105.1,151.85,196.1,237.5,47.5],"24hr":[51.85,55.55,59.05,114.5,161.3,205.6,249.75,49.95]}},{"id":"34","postcodes":"DT GU SP 1-2,4-6","areas":["DT","GU"],"districts":[{"area":"SP","ranges":[[1,2],[4,6]]}],"rates":{"48hr":[59.25,61.75,63.4,124.85,181.45,236.25,291.25,58.25],"24hr":[63.9,68.85,73.55,138.95,201.0,256.55,311.0,62.2]}},{"id":"35","postcodes":"CF NP","areas":["CF","NP"],"districts":[],"rates":{"48hr":[49.95,51.9,53.25,105.0,152.6,199.0,245.75,49.15],"24hr":[53.75,57.7,61.45,116.35,168.75,215.8,262.0,52.4]}},{"id":"37","postcodes":"LL 1-31 YO","areas":["YO"],"districts":[{"area":"LL","ranges":[[1,31]]}],"rates":{"48hr":[52.9,55.05,56.4,111.3,161.85,208.4,257.25,51.45],"24hr":[56.95,60.9,64.85,122.95,179.65,228.35,277.25,55.45]}},{"id":"38","postcodes":"E N NW SE SW 2+ W 2+","areas":["E","N","NW","SE"],"districts":[{"area":"SW","ranges":[[2,999]]},{"area":"W","ranges":[[2,999]]}],"rates":{"48hr":[70.75,70.75,73.5,141.1,205.95,270.75,335.25,67.05],"24hr":[78.95,78.95,81.65,157.65,233.6,301.35,370.0,74.0]}},{"id":"39","postcodes":"LA","areas":["LA"],"districts":[],"rates":{"48hr":[53.15,56.65,58.05,115.75,173.55,229.9,282.5,56.5],"24hr":[57.2,67.3,73.9,145.0,203.2,261.35,322.25,64.45]}},{"id":"40","postcodes":"LD","areas":["LD"],"districts":[],"rates":{"48hr":[64.95,72.5,78.55,153.75,218.45,283.05,338.5,67.7],"24hr":[71.2,79.35,91.9,173.2,252.95,323.9,399.5,79.9]}},{"id":"41","postcodes":"PH 8-13","areas":[],"districts":[{"area":"PH","ranges":[[8,13]]}],"rates":{"48hr":[110.0,110.0,120.1,240.2,360.3,480.4,600.5,120.1],"24hr":null}},{"id":"42","postcodes":"EH","areas":["EH"],"districts":[],"rates":{"48hr":[66.35,73.85,79.8,156.4,222.4,288.25,345.5,69.1],"24hr":[73.65,81.85,94.65,178.5,260.7,334.15,412.25,82.45]}},{"id":"43","postcodes":"SA","areas":["SA"],"districts":[],"rates":{"48hr":[60.95,67.55,72.85,142.85,203.55,264.2,317.25,63.45],"24hr":[66.45,73.45,84.35,159.6,233.55,299.65,370.0,74.0]}},{"id":"44","postcodes":"HS KW 15-17 ZE","areas":["HS","ZE"],"districts":[{"area":"KW","ranges":[[15,17]]}],"rates":{"72hr":[186.8,186.8,186.8,373.6,560.4,747.2,934.0,186.8],"48hr":null}},{"id":"45","postcodes":"BS SN","areas":["BS","SN"],"districts":[],"rates":{"48hr":[49.75,51.75,52.95,104.5,150.6,193.95,234.5,46.9],"24hr":[52.3,56.15,60.15,113.85,164.35,209.9,254.5,50.9]}},{"id":"46","postcodes":"OX 4-29,39+","areas":[],"districts":[{"area":"OX","ranges":[[4,29],[39,999]]}],"rates":{"48hr":[49.75,51.75,52.95,104.5,150.6,193.95,234.5,46.9],"24hr":[53.95,58.15,62.3,117.45,169.8,216.65,262.5,52.5]}},{"id":"47","postcodes":"BA TA","areas":["BA","TA"],"districts":[],"rates":{"48hr":[53.9,56.05,57.4,113.3,164.85,212.4,262.25,52.45],"24hr":[57.95,61.9,65.85,124.95,182.65,232.35,282.25,56.45]}},{"id":"48","postcodes":"EC SW 1 W 1 WC","areas":["EC","WC"],"districts":[{"area":"SW","ranges":[[1,1]]},{"area":"W","ranges":[[1,1]]}],"rates":{"48hr":[78.7,78.7,81.55,158.55,231.55,305.8,379.0,75.8],"24hr":[86.7,86.7,89.4,169.05,247.35,327.0,405.75,81.15]}},{"id":"49","postcodes":"SE 1,11","areas":[],"districts":[{"area":"SE","ranges":[[1,1],[11,11]]}],"rates":{"48hr":[72.05,72.05,74.9,143.75,209.9,276.0,342.0,68.4],"24hr":[80.15,80.15,82.9,160.15,237.4,306.5,376.75,75.35]}},{"id":"50","postcodes":"HR WR","areas":["HR","WR"],"districts":[],"rates":{"48hr":[48.1,50.0,51.25,101.15,145.9,188.25,227.75,45.55],"24hr":[49.4,53.05,56.6,109.5,153.9,195.8,237.5,47.5]}},{"id":"51","postcodes":"CB CM 0-3,5,7-9,11-13,16-21,77,99 CO DH DL IP NE 1-18,20-45,50-64,80+ SR TS","areas":["CB","CO","DH","DL","IP","SR","TS"],"districts":[{"area":"CM","ranges":[[0,3],[5,5],[7,9],[11,13],[16,21],[77,77],[99,99]]},{"area":"NE","ranges":[[1,18],[20,45],[50,64],[80,999]]}],"rates":{"48hr":[49.4,51.25,52.6,103.7,150.95,197.05,243.5,48.7],"24hr":[53.05,56.7,60.35,114.85,166.15,212.9,258.75,51.75]}}]}}$pj$::jsonb), updated_at = now() where key = 'app_settings';
insert into public.cost_versions (kind, ref, effective_from, value, summary, note, created_by)
select 'pallet', 'farralls', date '2026-08-01', value->'palletCarriers'->'farralls', 'Farrall''s: Oct 2026 price sheet, fuel surcharge 18%', 'Starting version', 'Claude'
from public.settings where key = 'app_settings'
  and not exists (select 1 from public.cost_versions where kind = 'pallet' and ref = 'farralls');
insert into public.activity_log (at, user_name, entity_type, entity_name, action, detail, source)
values (now(), 'Claude', 'settings', 'Pallet carriers', 'Farrall''s added', 'Oct 2026 price sheet (46 postcode bands), fuel surcharge 18%, usual service 24hr. Pallets by weight: 250kg Quarter, 500kg Half, 1,250kg Full.', 'chat');
