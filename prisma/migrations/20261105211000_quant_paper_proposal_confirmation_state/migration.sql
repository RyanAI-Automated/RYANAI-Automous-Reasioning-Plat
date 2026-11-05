ALTER TABLE "quant_paper_order_proposals"
  DROP CONSTRAINT "quant_paper_order_proposals_status_check";

ALTER TABLE "quant_paper_order_proposals"
  ADD CONSTRAINT "quant_paper_order_proposals_status_check"
    CHECK ("status" IN ('pending', 'confirming', 'confirmed', 'rejected', 'expired'));
