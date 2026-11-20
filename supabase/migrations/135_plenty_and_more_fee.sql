-- 135: Plenty&More (Shopify) carries its payment fee. Shopify Payments, UK cards: 1.7% + 25p (the owner's rate card,
-- 17 Nov 2026). There is no channel report for the website, so HELM's figures plus this fee are what the P&L shows.
insert into public.channel_fees (channel, listing_id, from_date, pct, per_order, note, created_by)
select 'Shopify', null, date '2026-11-01', 1.7, 0.25, 'Plenty&More on Shopify: Shopify Payments, UK cards 1.7% + 25p (the owner''s rate card, 17 Nov 2026). EEA, international and Amex cards are 2.7% + 25p and Klarna 4.99% + 30p; an order is estimated at the UK card rate.', 'Claude'
where not exists (select 1 from public.channel_fees where channel = 'Shopify' and listing_id is null and removed_at is null);
select public.channel_fee_reapply('Shopify');
