-- Migration 097: add 'referral' to campaigns.content_style enum
--
-- Part of the singleton campaign-mode retirement. The legacy
-- clinic_settings.campaign_mode supported 'referrals' as a value, which
-- generated a peer-to-peer voice for content aimed at trainers, coaches,
-- and other referring providers. Adding 'referral' to the tentpole
-- campaigns content_style enum preserves that capability in the new model.

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_content_style_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_content_style_check
  CHECK (content_style IN ('clinical', 'promotional', 'relationship', 'referral'));
